import { Router, type IRouter } from "express";
import { z } from "zod";

import { actorOf, auditBestEffort, writeAudit } from "../lib/audit";
import { requireSession, sessionFromLocals } from "../lib/authSession";
import {
  AuthzError,
  assertKeyAllowed,
  clientSlugFromKey,
  normalizeRelative,
  resolvePrefix,
} from "../lib/authz";
import {
  createFolderMarker,
  listFolder,
  presignDownload,
  presignUpload,
  sanitizeFilename,
} from "../lib/s3";

const router: IRouter = Router();

// Data-exchange posture: generous allowlist of data/document formats (incl.
// PGP-encrypted payloads, common in HIE exchange); executables and anything
// browser-renderable-as-HTML are rejected.
const ALLOWED_EXTENSIONS = new Set([
  "csv", "tsv", "psv", "txt", "dat",
  "zip", "gz", "tar",
  "pdf", "doc", "docx", "xls", "xlsx",
  "json", "xml",
  "edi", "x12", "835", "837", "834", "270", "271", "276", "277",
  "pgp", "gpg", "asc",
]);
const BLOCKED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-executable",
]);
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB (single presigned PUT)

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function handleAuthzError(res: Parameters<typeof sessionFromLocals>[0], err: unknown): boolean {
  if (err instanceof AuthzError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * GET /files/list?prefix=<relative-path>
 * One level of the caller's tree. Admins browse everything under clients/;
 * client users are jailed to their own folder.
 */
router.get("/files/list", requireSession, async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const rawPrefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
  try {
    const prefix = resolvePrefix(session, rawPrefix);
    const listing = await listFolder(prefix);
    auditBestEffort(req, {
      action: "list",
      ...actorOf(session),
      clientId: clientSlugFromKey(prefix),
      s3Key: prefix,
    });
    res.json({ prefix: normalizeRelative(rawPrefix), ...listing });
  } catch (err) {
    if (handleAuthzError(res, err)) {
      auditBestEffort(req, {
        action: "list",
        ...actorOf(session),
        s3Key: rawPrefix,
        detail: { denied: true },
      });
      return;
    }
    req.log.error({ err }, "Error listing folder");
    res.status(500).json({ error: "Failed to list folder" });
  }
});

const RequestUploadUrlBody = z.object({
  relativePath: z.string().default(""),
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(255),
});

/**
 * POST /files/request-upload-url
 * The client sends metadata only, then PUTs the file to the returned presigned
 * URL. The key lands directly in the browsed folder so SFTP and web see the
 * identical tree.
 */
router.post("/files/request-upload-url", requireSession, async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { relativePath, name, size, contentType } = parsed.data;
  const filename = sanitizeFilename(name);
  const extension = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(extension) || BLOCKED_CONTENT_TYPES.has(contentType.toLowerCase())) {
    res.status(400).json({ error: `File type ".${extension || "unknown"}" is not allowed` });
    return;
  }
  if (size > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: "Files are limited to 1 GB" });
    return;
  }

  try {
    const key = `${resolvePrefix(session, relativePath)}${filename}`;
    // Fail-closed: the audit row must exist before the URL is issued.
    await writeAudit(req, {
      action: "upload_url",
      ...actorOf(session),
      clientId: clientSlugFromKey(key),
      s3Key: key,
      detail: { size, contentType },
    });
    const uploadURL = await presignUpload({ key, contentType });
    res.json({ uploadURL, key, name: filename });
  } catch (err) {
    if (handleAuthzError(res, err)) return;
    req.log.error({ err }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /files/download/*path
 * Ownership-checked 302 to a 5-minute presigned GET.
 */
router.get("/files/download/*path", requireSession, async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const raw = req.params.path;
  const rawKey = Array.isArray(raw) ? raw.join("/") : (raw ?? "");
  try {
    const key = assertKeyAllowed(session, rawKey);
    await writeAudit(req, {
      action: "download",
      ...actorOf(session),
      clientId: clientSlugFromKey(key),
      s3Key: key,
    });
    res.redirect(302, await presignDownload(key));
  } catch (err) {
    if (handleAuthzError(res, err)) {
      auditBestEffort(req, {
        action: "download",
        ...actorOf(session),
        s3Key: rawKey,
        detail: { denied: true },
      });
      return;
    }
    req.log.error({ err }, "Error serving download");
    res.status(500).json({ error: "Failed to serve download" });
  }
});

const CreateFolderBody = z.object({
  relativePath: z.string().min(1).max(512),
});

router.post("/files/create-folder", requireSession, async (req, res): Promise<void> => {
  const session = sessionFromLocals(res);
  const parsed = CreateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Folder path is required" });
    return;
  }
  try {
    const prefix = resolvePrefix(session, parsed.data.relativePath);
    await createFolderMarker(prefix);
    await writeAudit(req, {
      action: "create_folder",
      ...actorOf(session),
      clientId: clientSlugFromKey(prefix),
      s3Key: prefix,
    });
    res.status(201).json({ prefix });
  } catch (err) {
    if (handleAuthzError(res, err)) return;
    req.log.error({ err }, "Error creating folder");
    res.status(500).json({ error: "Failed to create folder" });
  }
});

export default router;
