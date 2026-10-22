import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { ipAllowed } from "./adminIpGuard";

// Stateless HMAC-signed session cookie, same pattern as the Marti Event app:
// base64url(JSON payload) + "." + HMAC-SHA256 signature, signed with
// SESSION_SECRET. The signature check is stateless, but because this app
// fronts PHI, every request additionally verifies the user is still active
// (cheap indexed select) so disabling an account kills live sessions.
const COOKIE_NAME = "marti_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type UserSession = {
  userId: number;
  email: string;
  name: string;
  role: "admin" | "client";
  // S3 prefix segment + Transfer username for client users; null for admins.
  clientSlug: string | null;
  exp: number;
};

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(session: Omit<UserSession, "exp">): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...session,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): UserSession | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const payload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = sign(payload);

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as UserSession;
    if (typeof session.exp !== "number") return null;
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    if (session.role !== "admin" && session.role !== "client") return null;
    if (session.role === "client" && typeof session.clientSlug !== "string") return null;
    return session;
  } catch {
    return null;
  }
}

export function readSession(req: Request): UserSession | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === COOKIE_NAME) {
      const token = decodeURIComponent(rest.join("="));
      return verifySessionToken(token);
    }
  }
  return null;
}

async function isUserActive(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.status === "active";
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = readSession(req);
  if (!session || !(await isUserActive(session.userId))) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // Admin sessions are IP-restricted everywhere, not just on /admin routes.
  if (session.role === "admin" && !ipAllowed(req.ip ?? "")) {
    res.status(403).json({ error: "Access from this network is not permitted" });
    return;
  }
  res.locals.session = session;
  next();
};

export const requireAdminSession: RequestHandler = async (req, res, next) => {
  const session = readSession(req);
  if (!session || !(await isUserActive(session.userId))) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  if (!ipAllowed(req.ip ?? "")) {
    res.status(403).json({ error: "Access from this network is not permitted" });
    return;
  }
  res.locals.session = session;
  next();
};

export function sessionFromLocals(res: Response): UserSession {
  return res.locals.session as UserSession;
}
