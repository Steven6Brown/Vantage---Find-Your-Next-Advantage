import { beforeEach, describe, expect, it } from "vitest";
import { APP_NAME } from "../src/lib/brand";

process.env.AUTH_DB_PATH = ":memory:";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

const A = await import("../src/lib/accounts");
const { db, resetDbForTests } = await import("../src/lib/db");
const { checkPasswordPolicy, hashPassword, verifyPassword } = await import("../src/lib/password");
const T = await import("../src/lib/totp");
const { allow, isBlocked, recordHit, resetLimits } = await import("../src/lib/ratelimit");

const EMAIL = "owner@example.com";
const PW = "correct horse battery staple 42";
const ctx = { ip: "1.2.3.4", ua: "vitest" };

beforeEach(() => {
  resetDbForTests();
  resetLimits();
});

async function owner() {
  const r = await A.createOwner(EMAIL, PW);
  if (!r.ok) throw new Error(r.error);
  return r.user;
}

describe("password", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword("wrong password here", h)).toBe(false);
    expect(await verifyPassword(PW, "garbage")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword(PW)).not.toBe(await hashPassword(PW));
  });
  it("enforces the policy", () => {
    expect(checkPasswordPolicy("short1!")).toMatch(/at least 12/);
    expect(checkPasswordPolicy("password123")).toMatch(/at least 12/);
    expect(checkPasswordPolicy("passw0rd")).not.toBeNull();
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(checkPasswordPolicy("owner-is-here-today", "owner@example.com")).toMatch(/email name/);
    expect(checkPasswordPolicy(PW, EMAIL)).toBeNull();
  });
});

describe("totp (RFC 6238 vectors, SHA-1)", () => {
  const secret = Buffer.from("12345678901234567890");
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("t=%i -> %s", (t, code) => {
    expect(T.hotp(secret, Math.floor(t / 30), 8)).toBe(code);
  });
  it("round-trips base32", () => {
    const b = Buffer.from("hello world");
    expect(T.base32Decode(T.base32Encode(b)).toString()).toBe("hello world");
  });
  it("accepts a code once and rejects replay", () => {
    const s = T.generateSecret();
    const code = T.totpAt(s);
    const first = T.verifyTotp(s, code, 0);
    expect(first.ok).toBe(true);
    expect(T.verifyTotp(s, code, first.step).ok).toBe(false);
  });
  it("rejects wrong and malformed codes", () => {
    const s = T.generateSecret();
    expect(T.verifyTotp(s, "000000", 0, 1_700_000_000_000).ok).toBe(T.totpAt(s, 1_700_000_000_000) === "000000");
    expect(T.verifyTotp(s, "12345", 0).ok).toBe(false);
    expect(T.verifyTotp(s, "abcdef", 0).ok).toBe(false);
  });
  it("encrypts secrets at rest", () => {
    const enc = T.encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(T.decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => T.decryptSecret(enc.slice(0, -4) + "AAAA")).toThrow();
  });
  it("builds an otpauth URI", () => {
    const label = encodeURIComponent(`${APP_NAME}:a@b.com`);
    expect(T.otpauthUri("a@b.com", "ABC").startsWith(`otpauth://totp/${label}?secret=ABC`)).toBe(true);
  });
});

describe("owner account", () => {
  it("creates exactly one owner", async () => {
    await owner();
    const again = await A.createOwner("other@example.com", PW);
    expect(again.ok).toBe(false);
  });
  it("rejects a weak password", async () => {
    const r = await A.createOwner(EMAIL, "short");
    expect(r.ok).toBe(false);
  });
  it("never stores the password in plain text", async () => {
    await owner();
    const row = db().prepare("SELECT password_hash FROM users").get() as { password_hash: string };
    expect(row.password_hash).not.toContain(PW);
  });
});

describe("login and lockout", () => {
  it("logs in with the right password, any email casing", async () => {
    await owner();
    const r = await A.attemptLogin("  OWNER@example.com ", PW, ctx);
    expect(r.ok).toBe(true);
  });
  it("gives the same answer for a wrong password and an unknown email", async () => {
    await owner();
    const a = await A.attemptLogin(EMAIL, "wrong password 1234", ctx);
    const b = await A.attemptLogin("nobody@example.com", PW, ctx);
    expect(a).toEqual({ ok: false, reason: "invalid" });
    expect(b).toEqual({ ok: false, reason: "invalid" });
  });
  it("locks after repeated failures, even for the right password", async () => {
    await owner();
    for (let i = 0; i < A.LIMITS.lockAfter; i++) await A.attemptLogin(EMAIL, "wrong password 1234", ctx);
    expect(await A.attemptLogin(EMAIL, PW, ctx)).toEqual({ ok: false, reason: "locked" });
  });
  it("unlocks after the lock period", async () => {
    const u = await owner();
    for (let i = 0; i < A.LIMITS.lockAfter; i++) await A.attemptLogin(EMAIL, "wrong password 1234", ctx);
    db().prepare("UPDATE users SET locked_until = ? WHERE id = ?").run(Date.now() - 1, u.id);
    expect((await A.attemptLogin(EMAIL, PW, ctx)).ok).toBe(true);
  });
  it("logs events without secrets", async () => {
    const u = await owner();
    await A.attemptLogin(EMAIL, "wrong password 1234", ctx);
    const text = JSON.stringify(A.recentAudit(u.id));
    expect(text).toMatch(/login_failed/);
    expect(text).not.toMatch(/wrong password 1234|correct horse/);
  });
});

describe("sessions", () => {
  it("starts, reads and ends a session; only a hash is stored", async () => {
    const u = await owner();
    const { token } = A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx });
    expect(A.readSession(token)?.user.email).toBe(EMAIL);
    const stored = db().prepare("SELECT id FROM sessions").get() as { id: string };
    expect(stored.id).not.toBe(token);
    A.endSession(token);
    expect(A.readSession(token)).toBeNull();
  });
  it("rejects unknown tokens", () => {
    expect(A.readSession("nope")).toBeNull();
    expect(A.readSession(undefined)).toBeNull();
  });
  it("treats a 2FA-pending session as signed out unless asked", async () => {
    const u = await owner();
    const { token } = A.startSession(u.id, { remember: false, mfaVerified: false, ...ctx });
    expect(A.readSession(token)).toBeNull();
    expect(A.readSession(token, { allowPending: true })).not.toBeNull();
  });
  it("expires after the idle timeout and the absolute limit", async () => {
    const u = await owner();
    const a = A.startSession(u.id, { remember: true, mfaVerified: true, ...ctx });
    db().prepare("UPDATE sessions SET last_seen_at = ?").run(Date.now() - A.LIMITS.idleMs - 1000);
    expect(A.readSession(a.token)).toBeNull();
    const b = A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx });
    db().prepare("UPDATE sessions SET expires_at = ?").run(Date.now() - 1);
    expect(A.readSession(b.token)).toBeNull();
  });
  it("only remember-me sessions get a persistent cookie", async () => {
    const u = await owner();
    expect(A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx }).cookieMaxAgeMs).toBeUndefined();
    expect(A.startSession(u.id, { remember: true, mfaVerified: true, ...ctx }).cookieMaxAgeMs).toBe(A.LIMITS.rememberMs);
  });
  it("revokes one or all other sessions", async () => {
    const u = await owner();
    const a = A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx });
    const b = A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx });
    const ctxA = A.readSession(a.token)!;
    const ctxB = A.readSession(b.token)!;
    expect(A.revokeSession(u.id, ctxB.publicId)).toBe(true);
    expect(A.readSession(b.token)).toBeNull();
    const c = A.startSession(u.id, { remember: false, mfaVerified: true, ...ctx });
    A.revokeOtherSessions(u.id, ctxA.publicId);
    expect(A.readSession(a.token)).not.toBeNull();
    expect(A.readSession(c.token)).toBeNull();
  });
});

describe("one-time tokens", () => {
  it("works exactly once", async () => {
    const u = await owner();
    const t = A.createToken(u.id, "reset", A.LIMITS.resetTtlMs);
    expect(A.tokenIsValid(t, "reset")).toBe(true);
    expect(A.consumeToken(t, "reset")).toBe(u.id);
    expect(A.consumeToken(t, "reset")).toBeNull();
    expect(A.tokenIsValid(t, "reset")).toBe(false);
  });
  it("rejects expired tokens, wrong types and garbage", async () => {
    const u = await owner();
    const t = A.createToken(u.id, "reset", -1000);
    expect(A.consumeToken(t, "reset")).toBeNull();
    const v = A.createToken(u.id, "verify", A.LIMITS.verifyTtlMs);
    expect(A.consumeToken(v, "reset")).toBeNull();
    expect(A.consumeToken("garbage", "verify")).toBeNull();
  });
  it("invalidates older links when a new one is requested", async () => {
    const u = await owner();
    const first = A.createToken(u.id, "reset", A.LIMITS.resetTtlMs);
    const second = A.createToken(u.id, "reset", A.LIMITS.resetTtlMs);
    expect(A.consumeToken(first, "reset")).toBeNull();
    expect(A.consumeToken(second, "reset")).toBe(u.id);
  });
  it("stores only a hash of the token", async () => {
    const u = await owner();
    const t = A.createToken(u.id, "verify", A.LIMITS.verifyTtlMs);
    const row = db().prepare("SELECT token_hash FROM tokens").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(t);
  });
});

describe("two-factor authentication", () => {
  async function enrolled() {
    const u = await owner();
    const secret = A.startMfaEnrollment(u.id);
    const codes = A.confirmMfaEnrollment(u.id, T.totpAt(secret));
    return { u, secret, codes: codes! };
  }
  it("refuses a wrong code at enrolment and leaves 2FA off", async () => {
    const u = await owner();
    A.startMfaEnrollment(u.id);
    expect(A.confirmMfaEnrollment(u.id, "000000")).toBeNull();
    expect(A.findUser(u.id)?.totpEnabled).toBe(false);
  });
  it("refuses to confirm when enrolment was never started", async () => {
    const u = await owner();
    expect(A.confirmMfaEnrollment(u.id, T.totpAt(T.generateSecret()))).toBeNull();
  });
  it("turns on with a correct code and returns 10 recovery codes", async () => {
    const { u, codes } = await enrolled();
    expect(codes).toHaveLength(10);
    expect(A.findUser(u.id)?.totpEnabled).toBe(true);
  });
  it("stores the secret encrypted and recovery codes hashed", async () => {
    const { u, secret, codes } = await enrolled();
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const row = db().prepare("SELECT totp_secret FROM users WHERE id = ?").get(u.id) as { totp_secret: string };
    expect(row.totp_secret).not.toContain(secret);
    const dump = JSON.stringify(db().prepare("SELECT code_hash FROM recovery_codes").all());
    expect(dump).not.toContain(codes[0].replace("-", ""));
  });
  it("accepts a fresh authenticator code once only", async () => {
    const { u, secret } = await enrolled();
    // enrolment consumed this step; the next step's code must work, the same one twice must not
    const nextStepCode = T.hotp(T.base32Decode(secret), Math.floor(Date.now() / 1000 / 30) + 1);
    expect(A.checkSecondFactor(u.id, { code: nextStepCode }, ctx)).toBe(true);
    expect(A.checkSecondFactor(u.id, { code: nextStepCode }, ctx)).toBe(false);
  });
  it("recovery codes work once and count down", async () => {
    const { u, codes } = await enrolled();
    expect(A.recoveryCodesLeft(u.id)).toBe(10);
    expect(A.checkSecondFactor(u.id, { recovery: codes[0] }, ctx)).toBe(true);
    expect(A.checkSecondFactor(u.id, { recovery: codes[0] }, ctx)).toBe(false);
    expect(A.recoveryCodesLeft(u.id)).toBe(9);
  });
  it("failed second-factor attempts lock the account", async () => {
    const { u } = await enrolled();
    for (let i = 0; i < A.LIMITS.lockAfter; i++) A.checkSecondFactor(u.id, { code: "000000" }, ctx);
    expect(A.findUser(u.id)!.lockedUntil).toBeGreaterThan(Date.now());
  });
  it("regenerating replaces the old codes", async () => {
    const { u, codes } = await enrolled();
    const fresh = A.regenerateRecoveryCodes(u.id);
    expect(A.checkSecondFactor(u.id, { recovery: codes[1] }, ctx)).toBe(false);
    expect(A.checkSecondFactor(u.id, { recovery: fresh[0] }, ctx)).toBe(true);
  });
  it("disabling removes the secret and recovery codes", async () => {
    const { u } = await enrolled();
    A.disableMfa(u.id);
    expect(A.findUser(u.id)!.totpEnabled).toBe(false);
    expect(A.recoveryCodesLeft(u.id)).toBe(0);
  });
});

describe("rate limiter", () => {
  it("blocks after the maximum within the window", () => {
    for (let i = 0; i < 3; i++) expect(allow("k", 3, 1000)).toBe(true);
    expect(allow("k", 3, 1000)).toBe(false);
    expect(allow("other", 3, 1000)).toBe(true);
  });
  it("failure-only limits: checking never counts, only recorded failures do", () => {
    for (let i = 0; i < 20; i++) expect(isBlocked("login", 3)).toBe(false); // looking does not consume
    recordHit("login", 1000);
    recordHit("login", 1000);
    expect(isBlocked("login", 3)).toBe(false);
    recordHit("login", 1000);
    expect(isBlocked("login", 3)).toBe(true);
    expect(isBlocked("someone-else", 3)).toBe(false);
  });
  it("limits reset after the window", async () => {
    recordHit("brief", 20);
    recordHit("brief", 20);
    expect(isBlocked("brief", 2)).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(isBlocked("brief", 2)).toBe(false);
  });
});
