import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { checkPasswordPolicy, hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { decryptSecret, encryptSecret, generateSecret, verifyTotp } from "./totp";

// Framework-free account logic: users, lockout, sessions, one-time tokens, 2FA, recovery codes, audit log.

export const MS = { min: 60_000, hour: 3_600_000, day: 86_400_000 };
export const LIMITS = {
  idleMs: 8 * MS.hour, // signed out after this long without activity
  shortSessionMs: 24 * MS.hour, // default: ends with the browser, and at most a day on the server
  rememberMs: 30 * MS.day, // "Keep me signed in"
  pendingMs: 10 * MS.min, // time allowed to enter a 2FA code after the password
  lockAfter: 5, // failed attempts before the account locks
  lockMs: 15 * MS.min,
  verifyTtlMs: 24 * MS.hour,
  resetTtlMs: 30 * MS.min,
};

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export interface User {
  id: number;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  lockedUntil: number;
  createdAt: number;
  passwordChangedAt: number;
}

const toUser = (r: Row): User => ({
  id: num(r.id),
  email: String(r.email),
  emailVerified: r.email_verified_at != null,
  totpEnabled: num(r.totp_enabled) === 1,
  lockedUntil: num(r.locked_until),
  createdAt: num(r.created_at),
  passwordChangedAt: num(r.password_changed_at),
});

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/* ---------------- audit log ---------------- */

export interface Ctx {
  ip?: string;
  ua?: string;
}

/** Never put passwords, tokens, codes or secrets in `detail`. */
export function audit(event: string, ctx: Ctx & { userId?: number | null; detail?: string } = {}) {
  const d = db();
  d.prepare("INSERT INTO audit_log (user_id, event, ip, user_agent, detail, at) VALUES (?,?,?,?,?,?)").run(
    ctx.userId ?? null, event, ctx.ip ?? null, (ctx.ua ?? "").slice(0, 200) || null, ctx.detail ?? null, Date.now(),
  );
  d.prepare("DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 1000").run();
}

export function recentAudit(userId: number, limit = 40) {
  return db()
    .prepare("SELECT event, ip, user_agent AS ua, detail, at FROM audit_log WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT ?")
    .all(userId, limit)
    .map((r) => ({ event: String(r.event), ip: r.ip ? String(r.ip) : "", ua: r.ua ? String(r.ua) : "", detail: r.detail ? String(r.detail) : "", at: num(r.at) }));
}

/* ---------------- users ---------------- */

export function ownerExists(): boolean {
  return db().prepare("SELECT 1 AS x FROM users LIMIT 1").get() !== undefined;
}

export function findUser(id: number): User | null {
  const r = db().prepare("SELECT * FROM users WHERE id = ?").get(id);
  return r ? toUser(r) : null;
}

export function findUserByEmail(email: string): User | null {
  const r = db().prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
  return r ? toUser(r) : null;
}

/** Single-owner app: only the very first account can ever be created. */
export async function createOwner(email: string, password: string): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const e = normalizeEmail(email);
  if (ownerExists()) return { ok: false, error: "An owner account already exists." };
  const problem = checkPasswordPolicy(password, e);
  if (problem) return { ok: false, error: problem };
  const now = Date.now();
  const hash = await hashPassword(password);
  const r = db().prepare("INSERT INTO users (email, password_hash, created_at, password_changed_at) VALUES (?,?,?,?) RETURNING *").get(e, hash, now, now);
  return { ok: true, user: toUser(r as Row) };
}

export async function setPassword(userId: number, password: string): Promise<void> {
  const hash = await hashPassword(password);
  db().prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?").run(hash, Date.now(), userId);
}

export async function checkPasswordFor(userId: number, password: string): Promise<boolean> {
  const r = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
  return r ? verifyPassword(password, String(r.password_hash)) : verifyAgainstDummy(password);
}

export function markEmailVerified(userId: number) {
  db().prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").run(Date.now(), userId);
}

/* ---------------- login + lockout ---------------- */

export function recordFailure(userId: number, ctx: Ctx) {
  const d = db();
  const r = d.prepare("UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ? RETURNING failed_attempts").get(userId);
  if (r && num(r.failed_attempts) >= LIMITS.lockAfter) {
    d.prepare("UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?").run(Date.now() + LIMITS.lockMs, userId);
    audit("account_locked", { ...ctx, userId, detail: `after ${LIMITS.lockAfter} failed attempts` });
  }
}

export type LoginResult = { ok: true; user: User } | { ok: false; reason: "invalid" | "locked" };

/** Same work and same answer whether the email exists or not (no account enumeration). */
export async function attemptLogin(email: string, password: string, ctx: Ctx): Promise<LoginResult> {
  const row = db().prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
  if (!row) {
    await verifyAgainstDummy(password);
    audit("login_failed", { ...ctx, detail: "unknown email" });
    return { ok: false, reason: "invalid" };
  }
  const user = toUser(row);
  if (user.lockedUntil > Date.now()) {
    await verifyAgainstDummy(password);
    audit("login_blocked_locked", { ...ctx, userId: user.id });
    return { ok: false, reason: "locked" };
  }
  if (!(await verifyPassword(password, String(row.password_hash)))) {
    recordFailure(user.id, ctx);
    audit("login_failed", { ...ctx, userId: user.id, detail: "wrong password" });
    return { ok: false, reason: "invalid" };
  }
  db().prepare("UPDATE users SET failed_attempts = 0 WHERE id = ?").run(user.id);
  return { ok: true, user };
}

/* ---------------- sessions ---------------- */

export interface SessionInfo {
  publicId: string;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  ua: string;
  current: boolean;
}

export interface AuthContext {
  user: User;
  sessionId: string; // hashed token (internal)
  publicId: string;
  mfaVerified: boolean;
  remember: boolean;
}

/** Creates a session and returns the raw token (only its hash is stored). */
export function startSession(userId: number, o: { remember: boolean; mfaVerified: boolean } & Ctx) {
  const d = db();
  const now = Date.now();
  d.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  const token = newToken();
  const ttl = !o.mfaVerified ? LIMITS.pendingMs : o.remember ? LIMITS.rememberMs : LIMITS.shortSessionMs;
  d.prepare(
    "INSERT INTO sessions (id, public_id, user_id, created_at, last_seen_at, expires_at, mfa_verified, remember, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(sha(token), randomBytes(8).toString("hex"), userId, now, now, now + ttl, o.mfaVerified ? 1 : 0, o.remember ? 1 : 0, o.ip ?? null, (o.ua ?? "").slice(0, 200) || null);
  // Only "remember me" sessions get a persistent cookie; others end when the browser closes.
  return { token, cookieMaxAgeMs: o.mfaVerified && o.remember ? ttl : undefined };
}

export function readSession(token: string | undefined, opts: { allowPending?: boolean } = {}): AuthContext | null {
  if (!token) return null;
  const d = db();
  const now = Date.now();
  const r = d.prepare("SELECT * FROM sessions WHERE id = ?").get(sha(token));
  if (!r) return null;
  const mfaVerified = num(r.mfa_verified) === 1;
  const idleOk = !mfaVerified || now - num(r.last_seen_at) < LIMITS.idleMs;
  if (num(r.expires_at) < now || !idleOk) {
    d.prepare("DELETE FROM sessions WHERE id = ?").run(sha(token));
    return null;
  }
  if (!mfaVerified && !opts.allowPending) return null;
  const u = d.prepare("SELECT * FROM users WHERE id = ?").get(num(r.user_id));
  if (!u) return null;
  if (now - num(r.last_seen_at) > MS.min) d.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, String(r.id));
  return { user: toUser(u), sessionId: String(r.id), publicId: String(r.public_id), mfaVerified, remember: num(r.remember) === 1 };
}

export function endSession(token: string) {
  db().prepare("DELETE FROM sessions WHERE id = ?").run(sha(token));
}

export function listSessions(userId: number, currentPublicId: string): SessionInfo[] {
  return db()
    .prepare("SELECT * FROM sessions WHERE user_id = ? AND mfa_verified = 1 AND expires_at > ? ORDER BY last_seen_at DESC")
    .all(userId, Date.now())
    .map((r) => ({
      publicId: String(r.public_id), createdAt: num(r.created_at), lastSeenAt: num(r.last_seen_at),
      ip: r.ip ? String(r.ip) : "", ua: r.user_agent ? String(r.user_agent) : "", current: String(r.public_id) === currentPublicId,
    }));
}

export function revokeSession(userId: number, publicId: string): boolean {
  return Number(db().prepare("DELETE FROM sessions WHERE user_id = ? AND public_id = ?").run(userId, publicId).changes) > 0;
}

export function revokeOtherSessions(userId: number, keepPublicId: string | null) {
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND public_id != ?").run(userId, keepPublicId ?? "");
}

/* ---------------- one-time tokens (email verification, password reset) ---------------- */

export function createToken(userId: number, type: "verify" | "reset", ttlMs: number): string {
  const d = db();
  d.prepare("DELETE FROM tokens WHERE user_id = ? AND type = ? AND used_at IS NULL").run(userId, type); // older links stop working
  const raw = newToken();
  d.prepare("INSERT INTO tokens (user_id, type, token_hash, expires_at) VALUES (?,?,?,?)").run(userId, type, sha(raw), Date.now() + ttlMs);
  return raw;
}

/** Atomically marks a valid token used and returns its user, or null. A token works exactly once. */
export function consumeToken(raw: string, type: "verify" | "reset"): number | null {
  const now = Date.now();
  const r = db()
    .prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id")
    .get(now, sha(raw), type, now);
  return r ? num(r.user_id) : null;
}

/** Who a still-valid token belongs to, without using it up. */
export function tokenUserId(raw: string, type: "verify" | "reset"): number | null {
  const r = db().prepare("SELECT user_id FROM tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?").get(sha(raw), type, Date.now());
  return r ? num(r.user_id) : null;
}

/** Checks a token without using it (to show the reset form only for valid links). */
export function tokenIsValid(raw: string, type: "verify" | "reset"): boolean {
  return db().prepare("SELECT 1 AS x FROM tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?").get(sha(raw), type, Date.now()) !== undefined;
}

/* ---------------- two-factor authentication ---------------- */

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alike characters

function makeRecoveryCodes(userId: number): string[] {
  const d = db();
  d.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const bytes = randomBytes(10);
    const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    d.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)").run(userId, sha(raw));
  }
  return codes;
}

export function startMfaEnrollment(userId: number): string {
  const secret = generateSecret();
  db().prepare("UPDATE users SET totp_pending = ? WHERE id = ?").run(encryptSecret(secret), userId);
  return secret;
}

/** Confirms the first code from the authenticator app, turns 2FA on and returns recovery codes (shown once). */
export function confirmMfaEnrollment(userId: number, code: string): string[] | null {
  const d = db();
  const r = d.prepare("SELECT totp_pending FROM users WHERE id = ?").get(userId);
  if (!r?.totp_pending) return null;
  const secret = decryptSecret(String(r.totp_pending));
  const v = verifyTotp(secret, code, 0);
  if (!v.ok) return null;
  d.prepare("UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?").run(encryptSecret(secret), v.step, userId);
  return makeRecoveryCodes(userId);
}

export function disableMfa(userId: number) {
  const d = db();
  d.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?").run(userId);
  d.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
}

export function regenerateRecoveryCodes(userId: number): string[] {
  return makeRecoveryCodes(userId);
}

export function recoveryCodesLeft(userId: number): number {
  return num(db().prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL").get(userId)?.n);
}

/** Accepts an authenticator code or a one-time recovery code. Failures count toward lockout. */
export function checkSecondFactor(userId: number, input: { code?: string; recovery?: string }, ctx: Ctx): boolean {
  const d = db();
  if (input.recovery) {
    const raw = input.recovery.toLowerCase().replace(/[^a-z0-9]/g, "");
    const r = d
      .prepare("UPDATE recovery_codes SET used_at = ? WHERE id = (SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1) RETURNING id")
      .get(Date.now(), userId, sha(raw));
    if (r) {
      audit("recovery_code_used", { ...ctx, userId, detail: `${recoveryCodesLeft(userId)} left` });
      return true;
    }
    recordFailure(userId, ctx);
    audit("mfa_failed", { ...ctx, userId, detail: "recovery code" });
    return false;
  }
  const u = d.prepare("SELECT totp_secret, totp_last_step FROM users WHERE id = ?").get(userId);
  if (u?.totp_secret && input.code) {
    const v = verifyTotp(decryptSecret(String(u.totp_secret)), input.code, num(u.totp_last_step));
    if (v.ok) {
      d.prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(v.step, userId);
      return true;
    }
  }
  recordFailure(userId, ctx);
  audit("mfa_failed", { ...ctx, userId, detail: "authenticator code" });
  return false;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
