import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, read } from "./helpers";

import { POST as authPOST } from "../src/app/api/auth/[action]/route";
import * as A from "../src/lib/accounts";
import { db, resetDbForTests } from "../src/lib/db";
import { resetLimits } from "../src/lib/ratelimit";
import { base32Decode, hotp, totpAt } from "../src/lib/totp";

const P1 = "Initial-Phrase-Alpha-2026";
const P2 = "Second-Phrase-Bravo-2026";
const EMAIL = "tester@example.com";
let ipCounter = 0;

/** Calls /api/auth/<action> like the browser. Each call can come from its own address, so rate limits do not leak between tests. */
async function auth(action: string, body: unknown, o: { cookie?: string; origin?: string | null; ip?: string } = {}) {
  const req = call(`/api/auth/${action}`, { body, cookie: o.cookie, origin: o.origin, headers: { "x-forwarded-for": o.ip ?? `10.0.0.${++ipCounter}` } });
  const res = await authPOST(req, { params: Promise.resolve({ action }) });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const m = setCookie.join(";").match(/aq_session=([^;]*)/);
  return { ...(await read(res)), cookie: m ? m[1] : null, setCookie };
}
const as = (token: string | null) => `aq_session=${token ?? ""}`;
const user = () => A.findUserByEmail(EMAIL)!;
const unlock = () => db().prepare("UPDATE users SET locked_until = 0, failed_attempts = 0").run();

let logs: string[] = [];
beforeEach(() => {
  resetDbForTests();
  resetLimits();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function owner() {
  const r = await auth("setup", { email: EMAIL, password: P1, confirm: P1 });
  expect(r.status).toBe(200);
  return r.cookie!;
}

describe("first-run setup", () => {
  it("creates exactly one owner and signs them in", async () => {
    const r = await auth("setup", { email: EMAIL, password: P1, confirm: P1 });
    expect(r.status).toBe(200);
    expect(r.cookie).toBeTruthy();
    expect(A.readSession(r.cookie!)?.user.email).toBe(EMAIL);
    expect((await auth("setup", { email: "other@example.com", password: P2, confirm: P2 })).status).toBe(409);
  });
  it.each([
    ["a weak password", { email: EMAIL, password: "short", confirm: "short" }],
    ["mismatched passwords", { email: EMAIL, password: P1, confirm: P1 + "x" }],
    ["a password containing the email name", { email: EMAIL, password: "tester-is-here-today", confirm: "tester-is-here-today" }],
    ["a bad email", { email: "not-an-email", password: P1, confirm: P1 }],
    ["no body fields", {}],
    ["wrong types", { email: 5, password: [], confirm: {} }],
  ])("refuses %s", async (_n, body) => {
    expect((await auth("setup", body)).status).toBe(400);
    expect(A.ownerExists()).toBe(false);
  });
  it("sets a session cookie that is HttpOnly, SameSite=Strict and session-only", async () => {
    const r = await auth("setup", { email: EMAIL, password: P1, confirm: P1 });
    const c = r.setCookie.find((x) => x.startsWith("aq_session="))!.toLowerCase();
    expect(c).toContain("httponly");
    expect(c).toContain("samesite=strict");
    expect(c).not.toContain("max-age");
  });
  it("in production, needs the setup token so nobody else can claim a deployed app", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", "a-long-enough-setup-token-123");
    vi.stubEnv("APP_URL", "http://localhost");
    vi.resetModules();
    const prod = await import("../src/app/api/auth/[action]/route");
    const go = async (extra: object) => {
      const res = await prod.POST(call("/api/auth/setup", { body: { email: EMAIL, password: P1, confirm: P1, ...extra }, headers: { "x-forwarded-for": `10.1.0.${++ipCounter}` } }), { params: Promise.resolve({ action: "setup" }) });
      return res.status;
    };
    resetDbForTests();
    expect(await go({})).toBe(403);
    expect(await go({ setupToken: "wrong" })).toBe(403);
    expect(await go({ setupToken: "a-long-enough-setup-token-12" })).toBe(403);
    expect(A.ownerExists()).toBe(false);
    expect(await go({ setupToken: "a-long-enough-setup-token-123" })).toBe(200);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("in production, refuses entirely if no setup token is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", "");
    vi.resetModules();
    const prod = await import("../src/app/api/auth/[action]/route");
    resetDbForTests();
    const res = await prod.POST(call("/api/auth/setup", { body: { email: EMAIL, password: P1, confirm: P1, setupToken: "" }, headers: { "x-forwarded-for": "10.9.9.9" } }), { params: Promise.resolve({ action: "setup" }) });
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("signing in", () => {
  it("accepts the right password and any email casing", async () => {
    await owner();
    expect((await auth("login", { email: "  TESTER@Example.com ", password: P1 })).status).toBe(200);
  });
  it("gives the same answer for a wrong password and an unknown email", async () => {
    await owner();
    const a = await auth("login", { email: EMAIL, password: "wrong-password-1234" });
    const b = await auth("login", { email: "nobody@example.com", password: P1 });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.error).toBe(b.json.error);
    expect(a.cookie).toBeNull();
  });
  it("refuses a cross-site sign-in attempt", async () => {
    await owner();
    expect((await auth("login", { email: EMAIL, password: P1 }, { origin: "https://evil.example" })).status).toBe(403);
  });
  it.each([[undefined], [null], [""], ["x".repeat(500)], [{ $ne: "" }], [["a"]], [12345]])("rejects a password of %j", async (password) => {
    await owner();
    expect((await auth("login", { email: EMAIL, password })).status).toBe(401);
  });
  it("locks the account after repeated failures, even for the right password, then unlocks", async () => {
    await owner();
    for (let i = 0; i < A.LIMITS.lockAfter; i++) await auth("login", { email: EMAIL, password: "wrong-password-" + i });
    expect((await auth("login", { email: EMAIL, password: P1 })).status).toBe(401);
    unlock();
    expect((await auth("login", { email: EMAIL, password: P1 })).status).toBe(200);
  });
  it("only failed attempts count toward the rate limit, so normal use never locks you out", async () => {
    await owner();
    for (let i = 0; i < 30; i++) expect((await auth("login", { email: EMAIL, password: P1 }, { ip: "9.9.9.9" })).status).toBe(200);
  });
  it("blocks one address that keeps guessing (429)", async () => {
    await owner();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await auth("login", { email: `nobody${i}@example.com`, password: "wrong-password-1" }, { ip: "8.8.8.8" })).status;
    expect(last).toBe(429);
  });
  it('"keep me signed in" makes a persistent cookie; otherwise it is session-only', async () => {
    await owner();
    const a = await auth("login", { email: EMAIL, password: P1, remember: true });
    expect(a.setCookie.join(";").toLowerCase()).toContain("max-age");
    const b = await auth("login", { email: EMAIL, password: P1 });
    expect(b.setCookie.join(";").toLowerCase()).not.toContain("max-age");
  });
});

describe("signing out", () => {
  it("ends the session on the server, and a second sign-out is harmless", async () => {
    const c = await owner();
    expect((await auth("logout", {}, { cookie: as(c) })).status).toBe(200);
    expect(A.readSession(c)).toBeNull();
    expect((await auth("logout", {}, { cookie: as(c) })).status).toBe(200);
    expect((await auth("logout", {})).status).toBe(200);
  });
});

describe("signed-in actions are refused to visitors", () => {
  it.each(["password", "mfa-start", "mfa-confirm", "mfa-disable", "recovery-codes", "revoke-session", "revoke-others", "resend-verification"])("%s -> 401", async (action) => {
    await owner();
    expect((await auth(action, {})).status).toBe(401);
    expect((await auth(action, {}, { cookie: as("forged-forged") })).status).toBe(401);
  });
  it("unknown actions are 404 for people who are signed in", async () => {
    const c = await owner();
    expect((await auth("nonsense", {}, { cookie: as(c) })).status).toBe(404);
    expect((await auth("../../etc/passwd", {}, { cookie: as(c) })).status).toBe(404);
  });
});

describe("email verification", () => {
  it("works once, rejects garbage, and marks the address verified", async () => {
    await owner();
    expect(user().emailVerified).toBe(false);
    const t = A.createToken(user().id, "verify", A.LIMITS.verifyTtlMs);
    expect((await auth("verify", { token: t })).status).toBe(200);
    expect(user().emailVerified).toBe(true);
    expect((await auth("verify", { token: t })).status).toBe(400);
    expect((await auth("verify", { token: "x".repeat(43) })).status).toBe(400);
    expect((await auth("verify", { token: "short" })).status).toBe(400);
    expect((await auth("verify", {})).status).toBe(400);
  });
  it("an expired link is refused", async () => {
    await owner();
    expect((await auth("verify", { token: A.createToken(user().id, "verify", -1000) })).status).toBe(400);
  });
  it("a reset link cannot be used as a verification link", async () => {
    await owner();
    expect((await auth("verify", { token: A.createToken(user().id, "reset", A.LIMITS.resetTtlMs) })).status).toBe(400);
  });
  it("resending sends an email (logged in development), and is limited", async () => {
    const c = await owner();
    logs = [];
    expect((await auth("resend-verification", {}, { cookie: as(c) })).status).toBe(200);
    expect(logs.join("\n")).toMatch(/verify-email\?token=/);
    await auth("resend-verification", {}, { cookie: as(c) });
    await auth("resend-verification", {}, { cookie: as(c) });
    expect((await auth("resend-verification", {}, { cookie: as(c) })).status).toBe(429);
  });
});

describe("changing the password", () => {
  it("needs the current password, enforces the policy, and signs out other devices", async () => {
    const a = await owner();
    const b = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("password", { current: "not-my-password-1", next: P2, confirm: P2 }, { cookie: as(a) })).status).toBe(401);
    expect((await auth("password", { current: P1, next: "weakweak", confirm: "weakweak" }, { cookie: as(a) })).status).toBe(400);
    expect((await auth("password", { current: P1, next: P2, confirm: P2 + "x" }, { cookie: as(a) })).status).toBe(400);
    expect((await auth("password", { current: P1, next: P1, confirm: P1 }, { cookie: as(a) })).status).toBe(400);
    expect((await auth("password", { current: P1, next: P2, confirm: P2 }, { cookie: as(a) })).status).toBe(200);
    expect(A.readSession(b)).toBeNull();
    expect(A.readSession(a)).not.toBeNull();
    expect((await auth("login", { email: EMAIL, password: P1 })).status).toBe(401);
    expect((await auth("login", { email: EMAIL, password: P2 })).status).toBe(200);
  });
});

describe("forgot and reset password", () => {
  it("answers identically for known and unknown emails, and only emails a verified address", async () => {
    await owner();
    logs = [];
    const unknown = await auth("forgot", { email: "nobody@example.com" });
    const unverified = await auth("forgot", { email: EMAIL });
    expect(unknown.status).toBe(200);
    expect(unverified.json).toEqual(unknown.json);
    expect(logs.join("\n")).not.toMatch(/reset-password/);
    A.markEmailVerified(user().id);
    const known = await auth("forgot", { email: EMAIL });
    expect(known.json).toEqual(unknown.json);
    expect(logs.join("\n")).toMatch(/reset-password\?token=/);
  });
  it("is limited per address and per email", async () => {
    await owner();
    A.markEmailVerified(user().id);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await auth("forgot", { email: EMAIL }, { ip: "7.7.7.7" })).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
  it("a reset link works once, expires, and refuses weak passwords without being used up", async () => {
    await owner();
    const t = A.createToken(user().id, "reset", A.LIMITS.resetTtlMs);
    expect((await auth("reset", { token: t, password: "weakweak", confirm: "weakweak" })).status).toBe(400);
    expect(A.tokenIsValid(t, "reset")).toBe(true);
    expect((await auth("reset", { token: t, password: P2, confirm: P2 + "x" })).status).toBe(400);
    expect((await auth("reset", { token: t, password: P2, confirm: P2 })).status).toBe(200);
    expect((await auth("reset", { token: t, password: P2 + "!", confirm: P2 + "!" })).status).toBe(400);
    expect((await auth("reset", { token: A.createToken(user().id, "reset", -1000), password: P2, confirm: P2 })).status).toBe(400);
    expect((await auth("reset", { token: "garbage-garbage-garbage-garbage", password: P2, confirm: P2 })).status).toBe(400);
  });
  it("signs out every session and replaces the password", async () => {
    const c = await owner();
    await auth("reset", { token: A.createToken(user().id, "reset", A.LIMITS.resetTtlMs), password: P2, confirm: P2 });
    expect(A.readSession(c)).toBeNull();
    expect((await auth("login", { email: EMAIL, password: P1 })).status).toBe(401);
    expect((await auth("login", { email: EMAIL, password: P2 })).status).toBe(200);
  });
  it("a newer reset link cancels the older one", async () => {
    await owner();
    const first = A.createToken(user().id, "reset", A.LIMITS.resetTtlMs);
    A.createToken(user().id, "reset", A.LIMITS.resetTtlMs);
    expect((await auth("reset", { token: first, password: P2, confirm: P2 })).status).toBe(400);
  });
});

describe("two-factor authentication", () => {
  async function enrol() {
    const c = await owner();
    const start = await auth("mfa-start", { password: P1 }, { cookie: as(c) });
    expect(start.status).toBe(200);
    const secret = start.json.secret as string;
    expect(String(start.json.qr)).toMatch(/^data:image\/png;base64,/);
    const confirm = await auth("mfa-confirm", { code: totpAt(secret) }, { cookie: as(c) });
    expect(confirm.status).toBe(200);
    return { cookie: c, secret, codes: confirm.json.recoveryCodes as string[] };
  }
  const nextCode = (secret: string) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + 1);

  it("needs the password to begin and a correct code to finish", async () => {
    const c = await owner();
    expect((await auth("mfa-start", { password: "wrong-password-1234" }, { cookie: as(c) })).status).toBe(401);
    await auth("mfa-start", { password: P1 }, { cookie: as(c) });
    expect((await auth("mfa-confirm", { code: "000000" }, { cookie: as(c) })).status).toBe(400);
    expect(user().totpEnabled).toBe(false);
  });
  it("enrols, then the password alone is not enough to sign in", async () => {
    const { codes } = await enrol();
    expect(codes).toHaveLength(10);
    const login = await auth("login", { email: EMAIL, password: P1 });
    expect(login.json.mfaRequired).toBe(true);
    expect(A.readSession(login.cookie!)).toBeNull(); // a half-signed-in session is not a session
    expect(A.readSession(login.cookie!, { allowPending: true })).not.toBeNull();
  });
  it("a correct code completes sign-in with a new session token, and a replayed code is refused", async () => {
    const { secret } = await enrol();
    const pending = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    const code = nextCode(secret);
    const ok = await auth("mfa", { code }, { cookie: as(pending) });
    expect(ok.status).toBe(200);
    expect(ok.cookie).not.toBe(pending);
    expect(A.readSession(ok.cookie!)).not.toBeNull();
    expect(A.readSession(pending, { allowPending: true })).toBeNull();
    const pending2 = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("mfa", { code }, { cookie: as(pending2) })).status).toBe(401);
  });
  it("a wrong code is refused; without a pending session the step is refused", async () => {
    await enrol();
    const pending = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("mfa", { code: "000000" }, { cookie: as(pending) })).status).toBe(401);
    expect((await auth("mfa", { code: "123456" })).status).toBe(401);
  });
  it("a recovery code signs you in once", async () => {
    const { codes } = await enrol();
    const a = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("mfa", { recovery: codes[0] }, { cookie: as(a) })).status).toBe(200);
    const b = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("mfa", { recovery: codes[0] }, { cookie: as(b) })).status).toBe(401);
  });
  it("repeated wrong codes lock the account", async () => {
    await enrol();
    const pending = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    for (let i = 0; i < 6; i++) await auth("mfa", { code: "000000" }, { cookie: as(pending) });
    expect(user().lockedUntil).toBeGreaterThan(Date.now());
  });
  it("a password reset does not switch two-factor off", async () => {
    await enrol();
    await auth("reset", { token: A.createToken(user().id, "reset", A.LIMITS.resetTtlMs), password: P2, confirm: P2 });
    const r = await auth("login", { email: EMAIL, password: P2 });
    expect(r.json.mfaRequired).toBe(true);
  });
  it("turning it off needs the password and a valid code", async () => {
    const { cookie, codes } = await enrol();
    expect((await auth("mfa-disable", { password: P1, code: "000000" }, { cookie: as(cookie) })).status).toBe(401);
    expect((await auth("mfa-disable", { password: "wrong-password-1", recovery: codes[0] }, { cookie: as(cookie) })).status).toBe(401);
    expect(user().totpEnabled).toBe(true);
    expect((await auth("mfa-disable", { password: P1, recovery: codes[0] }, { cookie: as(cookie) })).status).toBe(200);
    expect(user().totpEnabled).toBe(false);
  });
  it("new recovery codes need the password and a code, and replace the old ones", async () => {
    const { cookie, secret, codes } = await enrol();
    expect((await auth("recovery-codes", { password: P1, code: "000000" }, { cookie: as(cookie) })).status).toBe(401);
    const fresh = await auth("recovery-codes", { password: P1, code: nextCode(secret) }, { cookie: as(cookie) });
    expect(fresh.status).toBe(200);
    expect(fresh.json.recoveryCodes as string[]).not.toContain(codes[0]);
    const pending = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    expect((await auth("mfa", { recovery: codes[0] }, { cookie: as(pending) })).status).toBe(401);
  });
  it("cannot be enrolled twice", async () => {
    const { cookie } = await enrol();
    expect((await auth("mfa-start", { password: P1 }, { cookie: as(cookie) })).status).toBe(409);
  });
});

describe("devices and the security log", () => {
  it("can sign out one device or all the others, but not the current one by that route", async () => {
    const a = await owner();
    const b = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    const c = (await auth("login", { email: EMAIL, password: P1 })).cookie!;
    const sessions = A.listSessions(user().id, A.readSession(a)!.publicId);
    expect(sessions).toHaveLength(3);
    const bId = A.readSession(b)!.publicId;
    expect((await auth("revoke-session", { id: A.readSession(a)!.publicId }, { cookie: as(a) })).status).toBe(400);
    expect((await auth("revoke-session", { id: "0".repeat(16) }, { cookie: as(a) })).status).toBe(404);
    expect((await auth("revoke-session", { id: "not-hex" }, { cookie: as(a) })).status).toBe(400);
    expect((await auth("revoke-session", { id: bId }, { cookie: as(a) })).status).toBe(200);
    expect(A.readSession(b)).toBeNull();
    expect((await auth("revoke-others", {}, { cookie: as(a) })).status).toBe(200);
    expect(A.readSession(c)).toBeNull();
    expect(A.readSession(a)).not.toBeNull();
  });
  it("records what happened, and never a password, code or link", async () => {
    const a = await owner();
    await auth("login", { email: EMAIL, password: "wrong-password-1234" });
    const t = A.createToken(user().id, "reset", A.LIMITS.resetTtlMs);
    await auth("reset", { token: t, password: P2, confirm: P2 });
    const log = JSON.stringify(A.recentAudit(user().id, 100));
    for (const e of ["owner_created", "login_failed", "password_reset"]) expect(log).toContain(e);
    for (const secret of [P1, P2, "wrong-password-1234", t]) expect(log).not.toContain(secret);
    void a;
  });
});

describe("responses never leak internals", () => {
  it("returns a generic message when something goes wrong", async () => {
    await owner();
    vi.spyOn(A, "attemptLogin").mockRejectedValue(new Error("SQLITE_CORRUPT: /secret/path/auth.db"));
    const r = await auth("login", { email: EMAIL, password: P1 });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/SQLITE|secret|path|auth\.db|stack/i);
  });
  it("sends no-store on auth responses", async () => {
    const res = await authPOST(call("/api/auth/forgot", { body: { email: "a@b.co" }, headers: { "x-forwarded-for": "6.6.6.6" } }), { params: Promise.resolve({ action: "forgot" }) });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
