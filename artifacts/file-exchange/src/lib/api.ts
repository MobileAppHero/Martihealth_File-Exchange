// Minimal same-origin JSON API client (session cookie auth). The API surface
// is small enough that hand-written types beat the Orval codegen loop the
// Tech Request Intake template used.

export class ApiError extends Error {
  status: number;
  totpRequired: boolean;

  constructor(status: number, message: string, totpRequired = false) {
    super(message);
    this.status = status;
    this.totpRequired = totpRequired;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
      data.totpRequired === true,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// --- Shared types ------------------------------------------------------------

export type Me = {
  user: {
    id: number;
    email: string;
    name: string;
    role: "admin" | "client";
    clientSlug: string | null;
    totpEnabled: boolean;
  } | null;
};

export type FolderListing = {
  prefix: string;
  folders: string[];
  files: { name: string; key: string; size: number; lastModified: string }[];
};

export type ClientRow = {
  id: number;
  clientId: string;
  displayName: string;
  status: string;
  sftpUserCreated: boolean;
  sftpKeyFingerprint: string | null;
  createdAt: string;
  hasPrefix: boolean;
};

export type ClientsResponse = {
  clients: ClientRow[];
  orphanPrefixes: string[];
  sftpHost: string;
};

export type UserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
  clientId: number | null;
  status: string;
  totpEnabled: boolean;
  createdAt: string;
};

export type AuditRow = {
  id: number;
  actorEmail: string;
  action: string;
  clientId: string | null;
  s3Key: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditResponse = { rows: AuditRow[]; total: number; page: number; pageSize: number };

export type SftpDetails = {
  sftpUser: {
    userName: string;
    homeTarget: string | null;
    sshPublicKeys: { keyId: string; fingerprint: string | null }[];
  } | null;
  sftpHost: string;
  sftpEndpoint: string;
};
