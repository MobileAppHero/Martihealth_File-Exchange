import { authenticator } from "otplib";
import { toDataURL } from "qrcode";

// TOTP 2FA for admin accounts (authenticator apps; nothing leaves the box).
// Enrollment: generate secret → user scans QR → verifies a code → totpEnabled.

const ISSUER = "Marti FX";

authenticator.options = { window: 1 }; // allow ±1 time-step of clock drift

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  return authenticator.verify({ token, secret });
}

export async function totpEnrollmentQr(
  email: string,
  secret: string,
): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { otpauthUrl, qrDataUrl };
}
