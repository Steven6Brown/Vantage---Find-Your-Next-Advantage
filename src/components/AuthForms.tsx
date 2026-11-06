"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthFrame } from "./AuthFrame";

export async function post<T = Record<string, unknown>>(action: string, body: object = {}): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Network error. Check your connection and try again." } as T & { error?: string } };
  }
}

export function PasswordInput({
  id, label, value, onChange, autoComplete, hint,
}: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required maxLength={128} aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" className="btn sm" onClick={() => setShow(!show)} aria-pressed={show} aria-label={`${show ? "Hide" : "Show"} ${label.toLowerCase()}`}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <span id={`${id}-hint`} className="sub">{hint}</span>}
    </div>
  );
}

export const POLICY_HINT = "At least 12 characters. A phrase of several words works well.";

const Shell = AuthFrame;

function Status({ text, ok }: { text: string; ok?: boolean }) {
  return <p role={ok ? "status" : "alert"} className={ok ? "ok" : "err"} style={{ margin: 0, minHeight: "1.5em" }}>{text}</p>;
}

/* ---------------- sign in (password, then optional 2FA code) ---------------- */

export function LoginForm() {
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await post<{ mfaRequired?: boolean }>("login", { email, password, remember });
    if (r.ok && r.data.mfaRequired) {
      setPassword("");
      setStep("mfa");
    } else if (r.ok) {
      window.location.href = "/";
      return;
    } else {
      setError(r.data.error ?? "Sign-in failed.");
    }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await post("mfa", useRecovery ? { recovery: code } : { code });
    if (r.ok) {
      window.location.href = "/";
      return;
    }
    setError(r.status === 401 && r.data.error?.includes("expired") ? "Your sign-in expired. Start again." : (r.data.error ?? "That code didn't work."));
    if (r.status === 401 && r.data.error?.includes("expired")) setStep("password");
    setBusy(false);
  }

  if (step === "mfa") {
    return (
      <Shell title="Two-step verification" sub={useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}>
        <form onSubmit={submitCode} className="stack">
          <div className="field">
            <label htmlFor="code">{useRecovery ? "Recovery code" : "Authentication code"}</label>
            <input id="code" type="text" inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={20} autoFocus />
          </div>
          <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
          <Status text={error} />
        </form>
        <button className="btn sm" type="button" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(""); }}>
          {useRecovery ? "Use authenticator app instead" : "Use a recovery code instead"}
        </button>
      </Shell>
    );
  }

  return (
    <Shell title="Sign in" sub="Welcome back.">
      <form onSubmit={signIn} className="stack">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </div>
        <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in on this device (30 days)</label>
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <Status text={error} />
      </form>
      <Link href="/forgot-password">Forgot your password?</Link>
    </Shell>
  );
}

/* ---------------- first-run owner setup ---------------- */

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await post("setup", { email, password, confirm, setupToken: needsToken ? setupToken : undefined });
    if (r.ok) {
      window.location.href = "/";
      return;
    }
    setError(r.data.error ?? "Setup failed.");
    setBusy(false);
  }

  return (
    <Shell title="Create your account" sub="This is a one-time setup for the owner of this app. We'll email you a link to verify your address.">
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="s-email">Email</label>
          <input id="s-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </div>
        <PasswordInput id="s-pw" label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint={POLICY_HINT} />
        <PasswordInput id="s-pw2" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {needsToken && (
          <div className="field">
            <label htmlFor="s-token">Setup token</label>
            <input id="s-token" type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} required maxLength={200} autoComplete="off" />
          </div>
        )}
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <Status text={error} />
      </form>
    </Shell>
  );
}

/* ---------------- forgot / reset password ---------------- */

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await post<{ message?: string }>("forgot", { email });
    setMsg(r.ok ? { ok: true, text: r.data.message ?? "Check your email." } : { ok: false, text: r.data.error ?? "Try again later." });
    setBusy(false);
  }

  return (
    <Shell title="Reset your password" sub="Enter your account email and we'll send a reset link if it matches an account.">
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="f-email">Email</label>
          <input id="f-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </div>
        <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        {msg && <Status text={msg.text} ok={msg.ok} />}
      </form>
      <Link href="/login">Back to sign in</Link>
    </Shell>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Remove the token from the address bar and history as soon as the page has it.
  useEffect(() => { window.history.replaceState(null, "", "/reset-password"); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await post("reset", { token, password, confirm });
    if (r.ok) setDone(true);
    else setError(r.data.error ?? "Could not reset the password.");
    setBusy(false);
  }

  if (done) {
    return (
      <Shell title="Password updated" sub="All devices were signed out. Sign in with your new password.">
        <Link className="btn primary" href="/login" style={{ display: "inline-grid", placeItems: "center", textDecoration: "none" }}>Go to sign in</Link>
      </Shell>
    );
  }
  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="stack">
        <PasswordInput id="r-pw" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint={POLICY_HINT} />
        <PasswordInput id="r-pw2" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
        <Status text={error} />
      </form>
    </Shell>
  );
}

/* ---------------- email verification ---------------- */

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    window.history.replaceState(null, "", "/verify-email");
    post("verify", { token }).then((r) => {
      if (r.ok) setState("ok");
      else { setError(r.data.error ?? "Verification failed."); setState("error"); }
    });
  }, [token]);

  return (
    <Shell title={state === "ok" ? "Email verified" : state === "error" ? "Couldn't verify" : "Verifying…"}>
      {state === "working" && <p className="sub" role="status">One moment…</p>}
      {state === "ok" && <p className="ok" role="status">Your email address is confirmed.</p>}
      {state === "error" && <p className="err" role="alert">{error} Sign in and use "Resend verification email" on the Security page.</p>}
      <Link href="/">Continue</Link>
    </Shell>
  );
}
