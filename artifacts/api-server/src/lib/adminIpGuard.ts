import type { RequestHandler } from "express";

import { logger } from "./logger";

// Admin requests are only accepted from allowlisted source IPs/CIDRs
// (ADMIN_IP_ALLOWLIST, comma-separated, e.g. "203.0.113.7/32,198.51.100.0/24").
// Unset → allow with a startup warning, so local development works; the prod
// task definition MUST set it.

let warned = false;

type Cidr = { base: bigint; maskBits: number; v6: boolean };

function parseIp(raw: string): { value: bigint; v6: boolean } | null {
  let ip = raw.trim();
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7); // IPv4-mapped
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let value = 0n;
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 0 || n > 255 || part !== String(n)) return null;
      value = (value << 8n) + BigInt(n);
    }
    return { value, v6: false };
  }
  // IPv6
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const expand = (half: string) => (half === "" ? [] : half.split(":"));
  const head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1] ?? "") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return { value, v6: true };
}

function parseCidr(raw: string): Cidr | null {
  const [ipPart, maskPart] = raw.trim().split("/");
  if (!ipPart) return null;
  const parsed = parseIp(ipPart);
  if (!parsed) return null;
  const width = parsed.v6 ? 128 : 32;
  const maskBits = maskPart === undefined ? width : Number(maskPart);
  if (!Number.isInteger(maskBits) || maskBits < 0 || maskBits > width) return null;
  const shift = BigInt(width - maskBits);
  return { base: parsed.value >> shift, maskBits, v6: parsed.v6 };
}

function allowlist(): Cidr[] | null {
  const raw = process.env.ADMIN_IP_ALLOWLIST?.trim();
  if (!raw) return null;
  const cidrs: Cidr[] = [];
  for (const entry of raw.split(",")) {
    if (!entry.trim()) continue;
    const cidr = parseCidr(entry);
    if (!cidr) throw new Error(`ADMIN_IP_ALLOWLIST contains an invalid entry: "${entry.trim()}"`);
    cidrs.push(cidr);
  }
  return cidrs.length ? cidrs : null;
}

export function ipAllowed(rawIp: string): boolean {
  const cidrs = allowlist();
  if (!cidrs) {
    if (!warned) {
      warned = true;
      logger.warn("ADMIN_IP_ALLOWLIST is not set — admin routes accept any source IP (dev only)");
    }
    return true;
  }
  const parsed = parseIp(rawIp);
  if (!parsed) return false;
  const width = parsed.v6 ? 128 : 32;
  return cidrs.some(
    (cidr) =>
      cidr.v6 === parsed.v6 &&
      parsed.value >> BigInt(width - cidr.maskBits) === cidr.base,
  );
}

export const adminIpGuard: RequestHandler = (req, res, next) => {
  if (!ipAllowed(req.ip ?? "")) {
    req.log.warn({ ip: req.ip }, "Admin request from non-allowlisted IP rejected");
    res.status(403).json({ error: "Access from this network is not permitted" });
    return;
  }
  next();
};
