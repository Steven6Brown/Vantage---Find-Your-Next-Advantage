"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { PasswordInput, POLICY_HINT, post } from "./AuthForms";

type Msg = { text: string; ok: boolean } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={m.ok ? "ok" : "err"} style={{ margin: "8px 0 0" }}>{m.text}</p> : null);

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post("logout");
        window.location.href = "/login";
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function ResendVerify() {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="btn sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await post("resend-verification");
          setMsg(r.ok ? { ok: true, text: "Verification email sent." } : { ok: false, text: r.data.error ?? "Could not send." });
          setBusy(false);
        }}
      >
        Resend verification email
      </button>
      <Note m={msg} />
    </>
  );
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await post("password", { current, next, confirm });
    if (r.ok) {
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Password changed. Your other devices were signed out." });
      router.refresh();
    } else setMsg({ ok: false, text: r.data.error ?? "Could not change the password." });
    setBusy(false);
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2 className="section">Change password</h2>
      <PasswordInput id="cp-cur" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordInput id="cp-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" hint={POLICY_HINT} />
      <PasswordInput id="cp-conf" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <div><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></div>
      <Note m={msg} />
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `${APP_NAME} recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "job-radar-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div role="region" aria-label="Recovery codes">
      <p className="err" style={{ margin: "0 0 8px" }}><strong>Save these now.</strong> They are shown only once. Each works one time if you lose your authenticator.</p>
      <ul className="codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button className="btn sm" onClick={download}>Download .txt</button>
        <button className="btn primary sm" onClick={onDone}>I've saved them</button>
      </div>
    </div>
  );
}

export function MfaPanel({ enabled, codesLeft }: { enabled: boolean; codesLeft: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "password" | "scan" | "codes" | "disable" | "regen">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setPhase("idle"); setPassword(""); setCode(""); setMsg(null); };

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await post<{ qr: string; secret: string }>("mfa-start", { password });
    if (r.ok) { setQr(r.data.qr); setSecret(r.data.secret); setPassword(""); setPhase("scan"); }
    else setMsg({ ok: false, text: r.data.error ?? "Could not start." });
    setBusy(false);
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await post<{ recoveryCodes: string[] }>("mfa-confirm", { code });
    if (r.ok) { setCodes(r.data.recoveryCodes); setCode(""); setPhase("codes"); setQr(""); setSecret(""); }
    else setMsg({ ok: false, text: r.data.error ?? "That code didn't work." });
    setBusy(false);
  }
  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const looksLikeRecovery = code.includes("-") || code.replace(/\s/g, "").length > 6;
    const r = await post("mfa-disable", { password, ...(looksLikeRecovery ? { recovery: code } : { code }) });
    if (r.ok) { reset(); router.refresh(); }
    else setMsg({ ok: false, text: r.data.error ?? "Could not turn off." });
    setBusy(false);
  }
  async function regen(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await post<{ recoveryCodes: string[] }>("recovery-codes", { password, code });
    if (r.ok) { setCodes(r.data.recoveryCodes); setPassword(""); setCode(""); setPhase("codes"); }
    else setMsg({ ok: false, text: r.data.error ?? "Could not create new codes." });
    setBusy(false);
  }

  return (
    <section className="panel stack" aria-labelledby="mfa-h">
      <h2 className="section" id="mfa-h">Two-factor authentication</h2>
      {phase === "codes" ? (
        <RecoveryCodes codes={codes} onDone={() => { setPhase("idle"); setCodes([]); router.refresh(); }} />
      ) : phase === "scan" ? (
        <form className="stack" onSubmit={confirm}>
          <p className="sub" style={{ margin: 0 }}>Scan this with an authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for your authenticator app" width={220} height={220} style={{ background: "#fff", borderRadius: 8 }} />
          <p className="sub" style={{ margin: 0 }}>Can't scan? Enter this key manually: <code>{secret}</code></p>
          <div className="field">
            <label htmlFor="mfa-code">6-digit code</label>
            <input id="mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8} />
          </div>
          <div className="row"><button className="btn primary" disabled={busy}>Turn on</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
        </form>
      ) : !enabled ? (
        phase === "password" ? (
          <form className="stack" onSubmit={start}>
            <p className="sub" style={{ margin: 0 }}>Confirm your password to begin.</p>
            <PasswordInput id="mfa-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="row"><button className="btn primary" disabled={busy}>Continue</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
          </form>
        ) : (
          <>
            <p className="sub" style={{ margin: 0 }}>Off. Add a second step at sign-in using an authenticator app. Strongly recommended.</p>
            <div><button className="btn primary" onClick={() => setPhase("password")}>Set up two-factor authentication</button></div>
          </>
        )
      ) : phase === "disable" || phase === "regen" ? (
        <form className="stack" onSubmit={phase === "disable" ? disable : regen}>
          <p className="sub" style={{ margin: 0 }}>{phase === "disable" ? "Enter your password and a current code (or a recovery code) to turn this off." : "Enter your password and a current authenticator code to replace your recovery codes."}</p>
          <PasswordInput id="mfa-pw2" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="field">
            <label htmlFor="mfa-code2">{phase === "disable" ? "Code or recovery code" : "6-digit code"}</label>
            <input id="mfa-code2" type="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={20} />
          </div>
          <div className="row"><button className="btn primary" disabled={busy}>{phase === "disable" ? "Turn off" : "Create new codes"}</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
        </form>
      ) : (
        <>
          <p className="sub" style={{ margin: 0 }}><span className="ok">On.</span> {codesLeft} recovery code{codesLeft === 1 ? "" : "s"} left.{codesLeft <= 2 ? " Consider creating new ones." : ""}</p>
          <div className="row">
            <button className="btn sm" onClick={() => setPhase("regen")}>New recovery codes</button>
            <button className="btn sm danger" onClick={() => setPhase("disable")}>Turn off</button>
          </div>
        </>
      )}
      <Note m={msg} />
    </section>
  );
}

export interface SessionRow { publicId: string; ip: string; device: string; createdAt: string; lastSeenAt: string; current: boolean }

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function revoke(id: string) {
    setBusy(true);
    const r = await post("revoke-session", { id });
    setMsg(r.ok ? { ok: true, text: "Signed out that device." } : { ok: false, text: r.data.error ?? "Could not sign out." });
    router.refresh();
    setBusy(false);
  }
  async function revokeAll() {
    setBusy(true);
    const r = await post("revoke-others");
    setMsg(r.ok ? { ok: true, text: "Signed out every other device." } : { ok: false, text: r.data.error ?? "Could not sign out." });
    router.refresh();
    setBusy(false);
  }

  return (
    <section className="panel" aria-labelledby="sess-h">
      <h2 className="section" id="sess-h">Where you're signed in</h2>
      <ul className="sessions">
        {sessions.map((s) => (
          <li key={s.publicId}>
            <div>
              <strong>{s.device}</strong> {s.current && <span className="badge new">This device</span>}
              <div className="sub">{s.ip || "unknown IP"} · signed in {s.createdAt} · last active {s.lastSeenAt}</div>
            </div>
            {!s.current && <button className="btn sm danger" disabled={busy} onClick={() => revoke(s.publicId)} aria-label={`Sign out ${s.device}`}>Sign out</button>}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && <button className="btn" disabled={busy} onClick={revokeAll}>Sign out everywhere else</button>}
      <Note m={msg} />
    </section>
  );
}
