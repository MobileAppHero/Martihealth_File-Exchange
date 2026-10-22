import type { Request } from "express";
import { auditLogTable, db } from "@workspace/db";

import type { UserSession } from "./authSession";
import { logger } from "./logger";

export type AuditAction =
  | "login"
  | "login_failed"
  | "list"
  | "upload_url"
  | "download"
  | "create_folder"
  | "client_created"
  | "client_adopted"
  | "client_disabled"
  | "sftp_user_created"
  | "sftp_key_imported"
  | "sftp_key_deleted"
  | "sftp_user_deleted"
  | "user_created"
  | "user_disabled"
  | "user_password_reset"
  | "totp_enrolled";

type AuditEntry = {
  action: AuditAction;
  actorEmail: string;
  actorUserId?: number | null;
  clientId?: string | null;
  s3Key?: string | null;
  detail?: Record<string, unknown> | null;
};

export function requestIp(req: Request): string {
  // app.set('trust proxy') is on, so req.ip resolves x-forwarded-for from the ALB.
  return req.ip ?? "";
}

// Awaited by callers that must be fail-closed (upload/download URL issuance);
// list-style callers may fire-and-forget via auditBestEffort.
export async function writeAudit(req: Request, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogTable).values({
    action: entry.action,
    actorEmail: entry.actorEmail,
    actorUserId: entry.actorUserId ?? null,
    clientId: entry.clientId ?? null,
    s3Key: entry.s3Key ?? null,
    ip: requestIp(req),
    detail: entry.detail ?? null,
  });
}

export function auditBestEffort(req: Request, entry: AuditEntry): void {
  writeAudit(req, entry).catch((err) => {
    logger.error({ err, action: entry.action }, "Audit write failed");
  });
}

export function actorOf(session: UserSession): Pick<AuditEntry, "actorEmail" | "actorUserId"> {
  return { actorEmail: session.email, actorUserId: session.userId };
}
