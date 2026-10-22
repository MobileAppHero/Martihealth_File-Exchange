import bcrypt from "bcryptjs";
import { auditLogTable, clientsTable, db, usersTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { actorOf, writeAudit } from "../lib/audit";
import { adminIpGuard } from "../lib/adminIpGuard";
import { requireAdminSession, sessionFromLocals } from "../lib/authSession";
import { landingBucket } from "../lib/authz";
import { createFolderMarker, listClientPrefixes } from "../lib/s3";
import {
  CLIENT_ID_PATTERN,
  createSftpUser,
  deleteSftpUser,
  deleteSshKey,
  describeSftpUser,
  importSshKey,
  looksLikeSshPublicKey,
  sftpEndpointHost,
} from "../lib/transfer";

const router: IRouter = Router();

router.use("/admin", requireAdminSession, adminIpGuard);

function publicClient(row: typeof clientsTable.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    displayName: row.displayName,
    status: row.status,
    sftpUserCreated: row.sftpUserCreated,
    sftpKeyFingerprint: row.sftpKeyFingerprint,
    createdAt: row.createdAt,
  };
}

/**
 * GET /admin/clients — the registry merged with the live S3 prefix scan, so
 * pre-portal folders (uhc, roni, smoketest) surface as orphan prefixes until
 * adopted, and registry rows whose folder vanished are flagged too.
 */
router.get("/admin/clients", async (req, res): Promise<void> => {
  try {
    const [rows, prefixes] = await Promise.all([
      db.select().from(clientsTable).orderBy(clientsTable.clientId),
      listClientPrefixes(),
    ]);
    const registered = new Set(rows.map((row) => row.clientId));
    const prefixSet = new Set(prefixes);
    res.json({
      clients: rows.map((row) => ({
        ...publicClient(row),
        hasPrefix: prefixSet.has(row.clientId),
      })),
      orphanPrefixes: prefixes.filter((prefix) => !registered.has(prefix)),
      sftpHost: "sftp.martihealth.com",
    });
  } catch (err) {
    req.log.error({ err }, "Error listing clients");
    res.status(500).json({ error: "Failed to list clients" });
  }
});

const CreateClientBody = z.object({
  clientId: z.string().regex(CLIENT_ID_PATTERN, "2-40 chars, lowercase letters, digits, hyphens"),
  displayName: z.string().min(1).max(120),
  sshPublicKey: z.string().optional(),
  // adopt = register an existing S3 prefix / Transfer user without creating
  // AWS resources.
  adopt: z.boolean().optional(),
});

router.post("/admin/clients", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const { clientId, displayName, sshPublicKey, adopt } = parsed.data;

  if (sshPublicKey && !looksLikeSshPublicKey(sshPublicKey)) {
    res.status(400).json({ error: "That does not look like an OpenSSH public key" });
    return;
  }

  const [existing] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.clientId, clientId));
  if (existing) {
    res.status(409).json({ error: "A client with this ID already exists" });
    return;
  }

  try {
    const sftpUser = await describeSftpUser(clientId);

    if (adopt) {
      const [created] = await db
        .insert(clientsTable)
        .values({
          clientId,
          displayName,
          sftpUserCreated: sftpUser !== null,
          createdBy: session.userId,
        })
        .returning();
      await writeAudit(req, {
        action: "client_adopted",
        ...actorOf(session),
        clientId,
        detail: { sftpUserExists: sftpUser !== null },
      });
      res.status(201).json(publicClient(created));
      return;
    }

    if (sftpUser) {
      res.status(409).json({
        error: "An SFTP user with this ID already exists — use adopt instead",
      });
      return;
    }

    // Ordered DB → S3 → Transfer; a Transfer failure leaves a retriable row
    // (sftpUserCreated=false) rather than attempting distributed rollback.
    const [created] = await db
      .insert(clientsTable)
      .values({ clientId, displayName, createdBy: session.userId })
      .returning();
    await writeAudit(req, { action: "client_created", ...actorOf(session), clientId });

    await createFolderMarker(`clients/${clientId}/`);

    let provisionError: string | null = null;
    try {
      await createSftpUser(landingBucket(), clientId);
      await db
        .update(clientsTable)
        .set({ sftpUserCreated: true })
        .where(eq(clientsTable.id, created.id));
      created.sftpUserCreated = true;
      await writeAudit(req, { action: "sftp_user_created", ...actorOf(session), clientId });

      if (sshPublicKey) {
        const keyId = await importSshKey(clientId, sshPublicKey);
        await db
          .update(clientsTable)
          .set({ sftpKeyFingerprint: keyId })
          .where(eq(clientsTable.id, created.id));
        await writeAudit(req, {
          action: "sftp_key_imported",
          ...actorOf(session),
          clientId,
          detail: { keyId },
        });
      }
    } catch (err) {
      req.log.error({ err, clientId }, "SFTP provisioning failed (client row kept, retriable)");
      provisionError = "Client created, but SFTP provisioning failed — retry from the client page";
    }

    res.status(201).json({
      ...publicClient(created),
      sftpHost: "sftp.martihealth.com",
      sftpEndpoint: sftpEndpointHost(),
      provisionError,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating client");
    res.status(500).json({ error: "Failed to create client" });
  }
});

async function loadClient(id: string) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return null;
  const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, numericId));
  return row ?? null;
}

router.post("/admin/clients/:id/provision-sftp", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const client = await loadClient(req.params.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    const existing = await describeSftpUser(client.clientId);
    if (!existing) {
      await createFolderMarker(`clients/${client.clientId}/`);
      await createSftpUser(landingBucket(), client.clientId);
    }
    await db
      .update(clientsTable)
      .set({ sftpUserCreated: true })
      .where(eq(clientsTable.id, client.id));
    await writeAudit(req, {
      action: "sftp_user_created",
      ...actorOf(session),
      clientId: client.clientId,
      detail: { retry: true, alreadyExisted: existing !== null },
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error retrying SFTP provisioning");
    res.status(500).json({ error: "SFTP provisioning failed" });
  }
});

router.get("/admin/clients/:id/sftp", async (req, res): Promise<void> => {
  const client = await loadClient(req.params.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    const user = await describeSftpUser(client.clientId);
    res.json({ sftpUser: user, sftpHost: "sftp.martihealth.com", sftpEndpoint: sftpEndpointHost() });
  } catch (err) {
    req.log.error({ err }, "Error describing SFTP user");
    res.status(500).json({ error: "Failed to load SFTP details" });
  }
});

const SshKeyBody = z.object({ publicKey: z.string().min(1) });

router.post("/admin/clients/:id/ssh-keys", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const client = await loadClient(req.params.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const parsed = SshKeyBody.safeParse(req.body);
  if (!parsed.success || !looksLikeSshPublicKey(parsed.data.publicKey)) {
    res.status(400).json({ error: "That does not look like an OpenSSH public key" });
    return;
  }
  try {
    const keyId = await importSshKey(client.clientId, parsed.data.publicKey);
    await db
      .update(clientsTable)
      .set({ sftpKeyFingerprint: keyId })
      .where(eq(clientsTable.id, client.id));
    await writeAudit(req, {
      action: "sftp_key_imported",
      ...actorOf(session),
      clientId: client.clientId,
      detail: { keyId },
    });
    res.status(201).json({ keyId });
  } catch (err) {
    req.log.error({ err }, "Error importing SSH key");
    res.status(500).json({ error: "Failed to import SSH key" });
  }
});

router.delete("/admin/clients/:id/ssh-keys/:keyId", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const client = await loadClient(req.params.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    await deleteSshKey(client.clientId, req.params.keyId);
    await writeAudit(req, {
      action: "sftp_key_deleted",
      ...actorOf(session),
      clientId: client.clientId,
      detail: { keyId: req.params.keyId },
    });
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting SSH key");
    res.status(500).json({ error: "Failed to delete SSH key" });
  }
});

/**
 * Disable: web users + registry row disabled, Transfer user deleted. S3 files
 * are always retained (bucket versioning + lifecycle govern retention).
 */
router.post("/admin/clients/:id/disable", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const client = await loadClient(req.params.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    await deleteSftpUser(client.clientId);
    await db
      .update(clientsTable)
      .set({ status: "disabled", sftpUserCreated: false })
      .where(eq(clientsTable.id, client.id));
    await db
      .update(usersTable)
      .set({ status: "disabled" })
      .where(eq(usersTable.clientId, client.id));
    await writeAudit(req, {
      action: "client_disabled",
      ...actorOf(session),
      clientId: client.clientId,
    });
    await writeAudit(req, {
      action: "sftp_user_deleted",
      ...actorOf(session),
      clientId: client.clientId,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error disabling client");
    res.status(500).json({ error: "Failed to disable client" });
  }
});

// --- Web users ---------------------------------------------------------------

function publicUserRow(row: typeof usersTable.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
    role: row.role,
    clientId: row.clientId,
    status: row.status,
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt,
  };
}

router.get("/admin/users", async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.email);
  res.json(rows.map(publicUserRow));
});

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  role: z.enum(["admin", "client"]),
  clientId: z.number().int().optional(),
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Valid email and a password of at least 12 characters are required",
    });
    return;
  }
  if (parsed.data.role === "client" && !parsed.data.clientId) {
    res.status(400).json({ error: "Client users must be linked to a client" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  let clientSlug: string | null = null;
  if (parsed.data.role === "client" && parsed.data.clientId) {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, parsed.data.clientId));
    if (!client || client.status !== "active") {
      res.status(400).json({ error: "Linked client not found or not active" });
      return;
    }
    clientSlug = client.clientId;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      firstName: parsed.data.firstName ?? "",
      lastName: parsed.data.lastName ?? "",
      role: parsed.data.role,
      clientId: parsed.data.role === "client" ? parsed.data.clientId : null,
    })
    .returning();

  await writeAudit(req, {
    action: "user_created",
    ...actorOf(session),
    clientId: clientSlug,
    detail: { email, role: parsed.data.role },
  });
  res.status(201).json(publicUserRow(created));
});

router.post("/admin/users/:id/disable", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (id === session.userId) {
    res.status(400).json({ error: "You cannot disable your own account" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ status: "disabled" })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await writeAudit(req, {
    action: "user_disabled",
    ...actorOf(session),
    detail: { email: updated.email },
  });
  res.json({ ok: true });
});

const ResetPasswordBody = z.object({ password: z.string().min(12) });

router.post("/admin/users/:id/reset-password", async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const id = Number(req.params.id);
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "A password of at least 12 characters is required" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash: await bcrypt.hash(parsed.data.password, 10) })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await writeAudit(req, {
    action: "user_password_reset",
    ...actorOf(session),
    detail: { email: updated.email },
  });
  res.json({ ok: true });
});

// --- Audit viewer ------------------------------------------------------------

router.get("/admin/audit", async (req, res): Promise<void> => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;
  const action = typeof req.query.action === "string" ? req.query.action : null;
  const page = Math.max(0, Number(req.query.page) || 0);
  const pageSize = 50;

  const conditions = [];
  if (clientId) conditions.push(eq(auditLogTable.clientId, clientId));
  if (action) conditions.push(eq(auditLogTable.action, action));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(auditLogTable)
      .where(where)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLogTable).where(where),
  ]);
  res.json({ rows, total: count, page, pageSize });
});

export default router;
