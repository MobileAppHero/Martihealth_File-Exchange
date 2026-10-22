import bcrypt from "bcryptjs";
import { clientsTable, db, usersTable, type UserRecord } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { auditBestEffort, writeAudit } from "../lib/audit";
import { ipAllowed } from "../lib/adminIpGuard";
import {
  clearSessionCookie,
  createSessionToken,
  readSession,
  requireAdminSession,
  sessionFromLocals,
  setSessionCookie,
} from "../lib/authSession";
import { generateTotpSecret, totpEnrollmentQr, verifyTotpCode } from "../lib/totp";

const router: IRouter = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

async function clientSlugFor(user: UserRecord): Promise<{ slug: string; active: boolean } | null> {
  if (!user.clientId) return null;
  const [client] = await db
    .select({ clientId: clientsTable.clientId, status: clientsTable.status })
    .from(clientsTable)
    .where(eq(clientsTable.id, user.clientId));
  if (!client) return null;
  return { slug: client.clientId, active: client.status === "active" };
}

function publicUser(user: UserRecord, clientSlug: string | null) {
  return {
    id: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
    role: user.role as "admin" | "client",
    clientSlug,
    totpEnabled: user.totpEnabled,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  // Compare against a dummy hash when the user is missing so response timing
  // does not reveal which emails exist.
  const hash =
    user?.passwordHash ??
    "$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZDzXBgVzB0K5g5O3rB1lFR3mUvGz2W";
  const valid = await bcrypt.compare(parsed.data.password, hash);
  if (!user || !valid || user.status !== "active") {
    auditBestEffort(req, { action: "login_failed", actorEmail: email });
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }

  if (user.role === "admin") {
    if (!ipAllowed(req.ip ?? "")) {
      auditBestEffort(req, {
        action: "login_failed",
        actorEmail: email,
        actorUserId: user.id,
        detail: { reason: "admin_ip_not_allowlisted" },
      });
      res.status(403).json({ error: "Access from this network is not permitted" });
      return;
    }
    // Enrolled admins must present a valid TOTP code with their password.
    if (user.totpEnabled && user.totpSecret) {
      if (!parsed.data.totpCode) {
        res.status(401).json({ error: "Verification code required", totpRequired: true });
        return;
      }
      if (!verifyTotpCode(user.totpSecret, parsed.data.totpCode)) {
        auditBestEffort(req, {
          action: "login_failed",
          actorEmail: email,
          actorUserId: user.id,
          detail: { reason: "invalid_totp" },
        });
        res.status(401).json({ error: "Verification code is incorrect", totpRequired: true });
        return;
      }
    }
  }

  let clientSlug: string | null = null;
  if (user.role === "client") {
    const client = await clientSlugFor(user);
    if (!client || !client.active) {
      auditBestEffort(req, {
        action: "login_failed",
        actorEmail: email,
        actorUserId: user.id,
        detail: { reason: "client_inactive_or_missing" },
      });
      res.status(401).json({ error: "This account is not currently active" });
      return;
    }
    clientSlug = client.slug;
  }

  const sessionUser = publicUser(user, clientSlug);
  setSessionCookie(
    res,
    createSessionToken({
      userId: user.id,
      email: user.email,
      name: sessionUser.name,
      role: sessionUser.role,
      clientSlug,
    }),
  );
  auditBestEffort(req, {
    action: "login",
    actorEmail: user.email,
    actorUserId: user.id,
    clientId: clientSlug,
  });
  res.json({ user: sessionUser });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const session = readSession(req);
  if (!session) {
    res.json({ user: null });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user || user.status !== "active") {
    res.json({ user: null });
    return;
  }
  res.json({ user: publicUser(user, session.clientSlug) });
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.status(204).end();
});

// --- Admin TOTP enrollment ---------------------------------------------------

router.post("/auth/totp/enroll", requireAdminSession, async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (user.totpEnabled) {
    res.status(409).json({ error: "Two-factor authentication is already enabled" });
    return;
  }
  const secret = generateTotpSecret();
  await db.update(usersTable).set({ totpSecret: secret }).where(eq(usersTable.id, user.id));
  const { otpauthUrl, qrDataUrl } = await totpEnrollmentQr(user.email, secret);
  res.json({ otpauthUrl, qrDataUrl, secret });
});

const TotpVerifyBody = z.object({ code: z.string().min(6).max(10) });

router.post("/auth/totp/verify", requireAdminSession, async (req, res): Promise<void> => {
  const parsed = TotpVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A 6-digit code is required" });
    return;
  }
  const session = sessionFromLocals(res);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user?.totpSecret) {
    res.status(400).json({ error: "Start enrollment first" });
    return;
  }
  if (!verifyTotpCode(user.totpSecret, parsed.data.code)) {
    res.status(400).json({ error: "Verification code is incorrect" });
    return;
  }
  await db.update(usersTable).set({ totpEnabled: true }).where(eq(usersTable.id, user.id));
  await writeAudit(req, {
    action: "totp_enrolled",
    actorEmail: session.email,
    actorUserId: session.userId,
  });
  res.json({ ok: true });
});

export default router;
