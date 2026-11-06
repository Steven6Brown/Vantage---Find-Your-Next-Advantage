import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 32768; // CPU/memory cost (~32 MB per hash)
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024;

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

const norm = (pw: string) => pw.normalize("NFKC");

/** Format: scrypt$N$r$p$salt$hash (base64). Parameters are stored so they can be raised later. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(norm(pw), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  try {
    const expected = Buffer.from(hash, "base64");
    const key = await scrypt(norm(pw), Buffer.from(salt, "base64"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** Burn the same CPU as a real check when the account doesn't exist, so timing doesn't reveal it. */
export async function verifyAgainstDummy(pw: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(12).toString("hex"));
  await verifyPassword(pw, await dummy);
  return false;
}

const COMMON = new Set(
  (
    "password passw0rd password1 password12 password123 password1234 123456789012 1234567890123 qwertyuiopas " +
    "qwerty123456 iloveyou1234 letmein12345 welcome12345 administrator admin1234567 changeme1234 findajob12345 " +
    "football1234 baseball1234 monkey123456 dragon123456 abc123456789 111111111111 000000000000 123123123123"
  ).split(" "),
);

/** Returns a message describing the problem, or null if the password is acceptable. */
export function checkPasswordPolicy(pw: string, email?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common.";
  if (new Set(lower).size < 5) return "Use a more varied password.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "The password must not contain your email name.";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|abcdefghij|qwertyuiop)/i.test(pw)) return "Avoid simple patterns.";
  return null;
}
