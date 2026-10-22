import type { UserSession } from "./authSession";

// The single authorization chokepoint for every S3 key/prefix the API touches.
// Admins operate under clients/ (all client folders); client users are jailed
// to clients/<their-slug>/ — mirroring the SFTP session-policy jail.

export const CLIENTS_ROOT = "clients/";

export function landingBucket(): string {
  const bucket = process.env.LANDING_BUCKET;
  if (!bucket) {
    throw new Error("LANDING_BUCKET environment variable is required");
  }
  return bucket;
}

export function resolveRootPrefix(session: UserSession): string {
  if (session.role === "admin") return CLIENTS_ROOT;
  if (!session.clientSlug) {
    // A client-role session without a client slug can access nothing.
    throw new AuthzError("No client folder is associated with this account");
  }
  return `${CLIENTS_ROOT}${session.clientSlug}/`;
}

export class AuthzError extends Error {}

// Normalize a caller-supplied path fragment (relative folder path or full
// key suffix). Rejects traversal and anything that could alias outside the
// caller's root once joined.
export function normalizeRelative(raw: string): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  if (value.includes("\\") || value.includes("\0")) {
    throw new AuthzError("Invalid path");
  }
  const segments = value.split("/");
  const cleaned: string[] = [];
  for (const segment of segments) {
    if (segment === "") continue; // collapse '//' and strip leading/trailing '/'
    if (segment === "." || segment === "..") {
      throw new AuthzError("Invalid path");
    }
    cleaned.push(segment);
  }
  return cleaned.join("/");
}

// Resolve a relative folder path to an absolute S3 prefix inside the caller's
// root ('' → the root itself). Always ends with '/'.
export function resolvePrefix(session: UserSession, relativePath: string): string {
  const root = resolveRootPrefix(session);
  const rel = normalizeRelative(relativePath);
  return rel === "" ? root : `${root}${rel}/`;
}

// Assert a full S3 object key belongs to the caller; returns the key.
export function assertKeyAllowed(session: UserSession, rawKey: string): string {
  const root = resolveRootPrefix(session);
  const key = normalizeRelative(rawKey);
  if (!key.startsWith(root) || key === root.slice(0, -1)) {
    throw new AuthzError("Access to this object is not permitted");
  }
  return key;
}

// Extract the client slug from an absolute key/prefix (for audit rows).
export function clientSlugFromKey(key: string): string | null {
  if (!key.startsWith(CLIENTS_ROOT)) return null;
  const rest = key.slice(CLIENTS_ROOT.length);
  const slash = rest.indexOf("/");
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  return slug || null;
}
