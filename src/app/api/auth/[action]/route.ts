import QRCode from "qrcode";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import * as A from "@/lib/accounts";
import { appUrl, mails } from "@/lib/mail";
import { checkPasswordPolicy, MAX_PASSWORD } from "@/lib/password";
import { allow, isBlocked, recordHit } from "@/lib/ratelimit";
import { clearSessionCookie, clientInfo, sameOrigin, SESSION_COOKIE, sessionFromRequest, setSessionCookie } from "@/lib/session";
import { otpauthUri } from "@/lib/totp";

export const dynamic = "force-dynamic";

const MIN = 60_000;
const HOUR = 3_600_000;
const PROD = process.env.NODE_ENV === "production";

const email = z.string().trim().toLowerCase().email().max(254);
const pw = z.string().min(1).max(MAX_PASSWORD);
const code6 = z.string().trim().min(6).max(12);

const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const TOO_MANY = "Too many attempts. Try again later.";
const BAD_LOGIN = "Invalid email or password, or the account is temporarily locked.";

type Info = ReturnType<typeof clientInfo>;
type Auth = NonNullable<ReturnType<typeof sessionFromRequest>>;

/** Emails are best-effort and never block or reveal anything to the caller. */
async function sendVerification(user: A.User) {
  try {
    const token = A.createToken(user.id, "verify", A.LIMITS.verifyTtlMs);
    await mails.verify(user.email, `${appUrl()}/verify-email?token=${token}`);
  } catch {
    console.error("Could not send the verification email.");
  }
}

function startFullSession(res: NextResponse, userId: number, remember: boolean, info: Info) {
  const s = A.startSession(userId, { remember, mfaVerified: true, ...info });
  setSessionCookie(res, s.token, s.cookieMaxAgeMs);
}

/* ------------------------- public actions ------------------------- */

async function setup(body: unknown, info: Info) {
  if (!allow(`setup:${info.ip}`, 5, HOUR)) return fail(TOO_MANY, 429);
  if (A.ownerExists()) return fail("Setup is already complete.", 409);
  const p = z.object({ email, password: pw, confirm: z.string(), setupToken: z.string().max(200).optional() }).safeParse(body);
  if (!p.success) return fail("Enter a valid email and a password.");
  if (p.data.password !== p.data.confirm) return fail("The passwords do not match.");
  if (PROD) {
    const t = process.env.SETUP_TOKEN;
    if (!t || t.length < 16 || !A.constantTimeEqual(p.data.setupToken ?? "", t)) return fail("Invalid setup token.", 403);
  }
  const r = await A.createOwner(p.data.email, p.data.password);
  if (!r.ok) return fail(r.error);
  A.audit("owner_created", { ...info, userId: r.user.id });
  void sendVerification(r.user);
  const res = json({ ok: true });
  startFullSession(res, r.user.id, false, info);
  return res;
}

async function login(body: unknown, info: Info) {
  const p = z.object({ email, password: pw, remember: z.boolean().optional() }).safeParse(body);
  if (!p.success) return fail(BAD_LOGIN, 401);
  // Only failed attempts count toward these limits, so normal sign-ins can never lock you out.
  const ipKey = `login-ip:${info.ip}`;
  const emailKey = `login-email:${p.data.email}`;
  // Account lockout (5 failures) is the per-account defence; these caps catch spraying across emails.
  if (isBlocked(ipKey, 20) || isBlocked(emailKey, 20)) return fail(TOO_MANY, 429);

  const r = await A.attemptLogin(p.data.email, p.data.password, info);
  if (!r.ok) {
    recordHit(ipKey, 15 * MIN);
    recordHit(emailKey, 15 * MIN);
    return fail(BAD_LOGIN, 401);
  }

  const remember = p.data.remember === true;
  if (r.user.totpEnabled) {
    // Password is right but the second factor is still owed: issue a short-lived pending session.
    const pending = A.startSession(r.user.id, { remember, mfaVerified: false, ...info });
    const res = json({ mfaRequired: true });
    setSessionCookie(res, pending.token);
    return res;
  }
  A.audit("login_success", { ...info, userId: r.user.id });
  const res = json({ ok: true });
  startFullSession(res, r.user.id, remember, info);
  return res;
}

async function mfa(req: NextRequest, body: unknown, info: Info) {
  const pending = sessionFromRequest(req, { allowPending: true });
  if (!pending || pending.mfaVerified) return fail("Your sign-in expired. Start again.", 401);
  const sessKey = `mfa:${pending.sessionId}`;
  const mfaIpKey = `mfa-ip:${info.ip}`;
  if (isBlocked(sessKey, 8) || isBlocked(mfaIpKey, 20)) return fail(TOO_MANY, 429);
  if (pending.user.lockedUntil > Date.now()) return fail(BAD_LOGIN, 401);
  const p = z.object({ code: code6.optional(), recovery: z.string().trim().max(20).optional() }).safeParse(body);
  if (!p.success || (!p.data.code && !p.data.recovery)) return fail("Enter your code.");
  if (!A.checkSecondFactor(pending.user.id, p.data, info)) {
    recordHit(sessKey, 10 * MIN);
    recordHit(mfaIpKey, 15 * MIN);
    return fail("That code didn't work.", 401);
  }

  // Rotate: the pending session is discarded and a fresh full session issued.
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (raw) A.endSession(raw);
  A.audit("login_success", { ...info, userId: pending.user.id, detail: p.data.recovery ? "recovery code" : "2fa" });
  const res = json({ ok: true });
  startFullSession(res, pending.user.id, pending.remember, info);
  return res;
}

async function forgot(body: unknown, info: Info) {
  const generic = json({ ok: true, message: "If that email belongs to an account, a reset link is on its way." });
  const p = z.object({ email }).safeParse(body);
  if (!allow(`forgot-ip:${info.ip}`, 5, HOUR)) return fail(TOO_MANY, 429);
  if (!p.success) return generic;
  if (!allow(`forgot-email:${p.data.email}`, 3, HOUR)) return generic; // silently, so it reveals nothing
  const user = A.findUserByEmail(p.data.email);
  // Only verified addresses get reset links, so a mistyped address can't receive one.
  if (user?.emailVerified) {
    try {
      const token = A.createToken(user.id, "reset", A.LIMITS.resetTtlMs);
      A.audit("reset_requested", { ...info, userId: user.id });
      void mails.reset(user.email, `${appUrl()}/reset-password?token=${token}`);
    } catch {
      console.error("Could not create or send the reset email.");
    }
  }
  return generic;
}

async function reset(body: unknown, info: Info) {
  if (!allow(`reset-ip:${info.ip}`, 10, HOUR)) return fail(TOO_MANY, 429);
  const p = z.object({ token: z.string().min(20).max(100), password: pw, confirm: z.string() }).safeParse(body);
  if (!p.success) return fail("Enter and confirm a new password.");
  if (p.data.password !== p.data.confirm) return fail("The passwords do not match.");
  const userId = A.tokenUserId(p.data.token, "reset");
  const user = userId ? A.findUser(userId) : null;
  if (!user) return fail("This reset link is invalid, expired or already used.", 400);
  const problem = checkPasswordPolicy(p.data.password, user.email);
  if (problem) return fail(problem);
  if (A.consumeToken(p.data.token, "reset") === null) return fail("This reset link is invalid, expired or already used.", 400);

  await A.setPassword(user.id, p.data.password);
  A.revokeOtherSessions(user.id, null); // every session is signed out
  A.audit("password_reset", { ...info, userId: user.id });
  void mails.passwordChanged(user.email);
  return json({ ok: true });
}

async function verify(body: unknown, info: Info) {
  if (!allow(`verify-ip:${info.ip}`, 20, HOUR)) return fail(TOO_MANY, 429);
  const p = z.object({ token: z.string().min(20).max(100) }).safeParse(body);
  const userId = p.success ? A.consumeToken(p.data.token, "verify") : null;
  if (userId === null) return fail("This verification link is invalid, expired or already used.", 400);
  A.markEmailVerified(userId);
  A.audit("email_verified", { ...info, userId });
  return json({ ok: true });
}

function logout(req: NextRequest, info: Info) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const s = sessionFromRequest(req, { allowPending: true });
  if (raw) A.endSession(raw);
  if (s) A.audit("logout", { ...info, userId: s.user.id });
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
}

/* ------------------------- signed-in actions ------------------------- */

async function resendVerification(auth: Auth, info: Info) {
  if (auth.user.emailVerified) return json({ ok: true });
  if (!allow(`resend:${auth.user.id}`, 3, HOUR)) return fail(TOO_MANY, 429);
  await sendVerification(auth.user);
  A.audit("verification_resent", { ...info, userId: auth.user.id });
  return json({ ok: true });
}

async function changePassword(auth: Auth, body: unknown, info: Info) {
  if (!allow(`pwchange:${auth.user.id}`, 5, 15 * MIN)) return fail(TOO_MANY, 429);
  const p = z.object({ current: pw, next: pw, confirm: z.string() }).safeParse(body);
  if (!p.success) return fail("Fill in all three fields.");
  if (p.data.next !== p.data.confirm) return fail("The new passwords do not match.");
  if (!(await A.checkPasswordFor(auth.user.id, p.data.current))) {
    A.recordFailure(auth.user.id, info);
    A.audit("password_change_failed", { ...info, userId: auth.user.id });
    return fail("Your current password is incorrect.", 401);
  }
  if (p.data.next === p.data.current) return fail("Choose a password you haven't just used.");
  const problem = checkPasswordPolicy(p.data.next, auth.user.email);
  if (problem) return fail(problem);
  await A.setPassword(auth.user.id, p.data.next);
  A.revokeOtherSessions(auth.user.id, auth.publicId);
  A.audit("password_changed", { ...info, userId: auth.user.id });
  void mails.passwordChanged(auth.user.email);
  return json({ ok: true });
}

async function mfaStart(auth: Auth, body: unknown, info: Info) {
  const p = z.object({ password: pw }).safeParse(body);
  if (!p.success) return fail("Enter your password.");
  if (auth.user.totpEnabled) return fail("Two-factor authentication is already on.", 409);
  if (!allow(`mfastart:${auth.user.id}`, 5, 15 * MIN)) return fail(TOO_MANY, 429);
  if (!(await A.checkPasswordFor(auth.user.id, p.data.password))) return fail("Your password is incorrect.", 401);
  const secret = A.startMfaEnrollment(auth.user.id);
  const qr = await QRCode.toDataURL(otpauthUri(auth.user.email, secret), { margin: 1, width: 220 });
  A.audit("mfa_enroll_started", { ...info, userId: auth.user.id });
  return json({ secret, qr });
}

function mfaConfirm(auth: Auth, body: unknown, info: Info) {
  if (!allow(`mfaconfirm:${auth.user.id}`, 10, 15 * MIN)) return fail(TOO_MANY, 429);
  const p = z.object({ code: code6 }).safeParse(body);
  if (!p.success) return fail("Enter the 6-digit code.");
  const codes = A.confirmMfaEnrollment(auth.user.id, p.data.code);
  if (!codes) return fail("That code didn't work. Check the code and your phone's clock, then try again.");
  A.revokeOtherSessions(auth.user.id, auth.publicId);
  A.audit("mfa_enabled", { ...info, userId: auth.user.id });
  void mails.mfaChanged(auth.user.email, true);
  return json({ recoveryCodes: codes });
}

async function mfaDisable(auth: Auth, body: unknown, info: Info) {
  if (!allow(`mfadisable:${auth.user.id}`, 5, 15 * MIN)) return fail(TOO_MANY, 429);
  const p = z.object({ password: pw, code: code6.optional(), recovery: z.string().trim().max(20).optional() }).safeParse(body);
  if (!p.success || (!p.data.code && !p.data.recovery)) return fail("Enter your password and a code.");
  if (!(await A.checkPasswordFor(auth.user.id, p.data.password))) return fail("Your password is incorrect.", 401);
  if (!A.checkSecondFactor(auth.user.id, p.data, info)) return fail("That code didn't work.", 401);
  A.disableMfa(auth.user.id);
  A.audit("mfa_disabled", { ...info, userId: auth.user.id });
  void mails.mfaChanged(auth.user.email, false);
  return json({ ok: true });
}

async function newRecoveryCodes(auth: Auth, body: unknown, info: Info) {
  if (!allow(`recovery:${auth.user.id}`, 5, 15 * MIN)) return fail(TOO_MANY, 429);
  const p = z.object({ password: pw, code: code6 }).safeParse(body);
  if (!p.success) return fail("Enter your password and a code.");
  if (!auth.user.totpEnabled) return fail("Two-factor authentication is not on.", 409);
  if (!(await A.checkPasswordFor(auth.user.id, p.data.password))) return fail("Your password is incorrect.", 401);
  if (!A.checkSecondFactor(auth.user.id, { code: p.data.code }, info)) return fail("That code didn't work.", 401);
  A.audit("recovery_codes_regenerated", { ...info, userId: auth.user.id });
  return json({ recoveryCodes: A.regenerateRecoveryCodes(auth.user.id) });
}

function revokeOne(auth: Auth, body: unknown, info: Info) {
  const p = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/) }).safeParse(body);
  if (!p.success) return fail("Invalid request.");
  if (p.data.id === auth.publicId) return fail("Use Sign out for this device.");
  if (!A.revokeSession(auth.user.id, p.data.id)) return fail("Session not found.", 404);
  A.audit("session_revoked", { ...info, userId: auth.user.id });
  return json({ ok: true });
}

function revokeOthers(auth: Auth, info: Info) {
  A.revokeOtherSessions(auth.user.id, auth.publicId);
  A.audit("sessions_revoked_all", { ...info, userId: auth.user.id });
  return json({ ok: true });
}

/* ------------------------- router ------------------------- */

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!sameOrigin(req)) return fail("Forbidden", 403);
  const info = clientInfo(req);
  const body: unknown = await req.json().catch(() => null);

  try {
    switch (action) {
      case "setup": return await setup(body, info);
      case "login": return await login(body, info);
      case "mfa": return await mfa(req, body, info);
      case "forgot": return await forgot(body, info);
      case "reset": return await reset(body, info);
      case "verify": return await verify(body, info);
      case "logout": return logout(req, info);
    }
    const auth = sessionFromRequest(req);
    if (!auth) return fail("Please sign in.", 401);
    switch (action) {
      case "resend-verification": return await resendVerification(auth, info);
      case "password": return await changePassword(auth, body, info);
      case "mfa-start": return await mfaStart(auth, body, info);
      case "mfa-confirm": return mfaConfirm(auth, body, info);
      case "mfa-disable": return await mfaDisable(auth, body, info);
      case "recovery-codes": return await newRecoveryCodes(auth, body, info);
      case "revoke-session": return revokeOne(auth, body, info);
      case "revoke-others": return revokeOthers(auth, info);
    }
    return fail("Not found", 404);
  } catch {
    return fail("Something went wrong. Try again.", 500); // details are never sent to the client
  }
}
