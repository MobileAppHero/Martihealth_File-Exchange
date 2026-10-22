import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { logger } from "../lib/logger";

// Runs before the server starts listening: ensure the bootstrap admin account
// exists (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD), updating its
// password + role when it does. TOTP state is left untouched on update so a
// redeploy never silently disables the admin's 2FA.
export async function ensureBootstrap(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn(
      "BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set — skipping admin bootstrap",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    await db
      .update(usersTable)
      .set({ passwordHash, role: "admin", status: "active" })
      .where(eq(usersTable.id, existing.id));
    logger.info({ email }, "Bootstrap admin updated");
  } else {
    await db.insert(usersTable).values({
      email,
      passwordHash,
      firstName: "Marti",
      lastName: "Admin",
      role: "admin",
    });
    logger.info({ email }, "Bootstrap admin created");
  }
}
