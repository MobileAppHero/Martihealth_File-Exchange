import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Append-only audit trail. client_id is the denormalized slug (not an FK) so
// rows stay meaningful if a client row is ever removed.
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: integer("actor_user_id"), // nullable: failed logins
    actorEmail: text("actor_email").notNull(),
    // login | login_failed | list | upload_url | download | create_folder |
    // client_created | client_adopted | client_disabled | sftp_user_created |
    // sftp_key_imported | sftp_key_deleted | sftp_user_deleted |
    // user_created | user_disabled | user_password_reset | totp_enrolled
    action: text("action").notNull(),
    clientId: text("client_id"),
    s3Key: text("s3_key"),
    ip: text("ip"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_client_idx").on(table.clientId, table.createdAt),
    index("audit_log_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export type AuditLogRecord = typeof auditLogTable.$inferSelect;
