import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The client registry. clientId (the slug) is simultaneously the S3 prefix
// segment (clients/<slug>/) and the AWS Transfer Family username — the same
// identifier convention the add-sftp-user script established.
export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(), // /^[a-z0-9-]{2,40}$/
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"), // 'active' | 'disabled'
  // Whether the AWS Transfer user exists. false after a failed/skipped
  // provisioning step → the UI offers "retry SFTP provisioning".
  sftpUserCreated: boolean("sftp_user_created").notNull().default(false),
  sftpKeyFingerprint: text("sftp_key_fingerprint"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClient = z.infer<typeof insertClientSchema>;
export type ClientRecord = typeof clientsTable.$inferSelect;
