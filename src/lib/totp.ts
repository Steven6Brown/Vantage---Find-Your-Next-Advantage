import { APP_NAME } from "./brand";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time passwords (what Google Authenticator, Authy, 1Password etc. generate).

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/g, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpAt(secretB32: string, nowMs = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(nowMs / 1000 / STEP_SECONDS), digits);
}

/**
 * Accepts the current code and one step either side (clock drift). `lastStep` blocks replay:
 * a code from a step at or before the last accepted one is rejected.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number, nowMs = Date.now()): { ok: boolean; step: number } {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, step: lastStep };
  const secret = base32Decode(secretB32);
  const now = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const delta of [0, -1, 1]) {
    const step = now + delta;
    if (step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    const given = Buffer.from(clean);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return { ok: true, step };
  }
  return { ok: false, step: lastStep };
}

export function otpauthUri(email: string, secretB32: string, issuer = APP_NAME): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/* Secrets are encrypted at rest (AES-256-GCM) with a key derived from SESSION_SECRET. */

function key(): Buffer {
  const ikm = process.env.SESSION_SECRET;
  if (!ikm || ikm.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return Buffer.from(hkdfSync("sha256", ikm, "aquila-job-scrubber", "totp-secret-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Bad secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
