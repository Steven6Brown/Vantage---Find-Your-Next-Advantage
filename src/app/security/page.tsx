import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ChangePasswordForm, MfaPanel, ResendVerify, SessionsPanel } from "@/components/SecurityPanels";
import { listSessions, recentAudit, recoveryCodesLeft } from "@/lib/accounts";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

export const dynamic = "force-dynamic";

const EVENTS: Record<string, string> = {
  owner_created: "Account created", login_success: "Signed in", login_failed: "Failed sign-in", login_blocked_locked: "Sign-in blocked (account locked)",
  account_locked: "Account locked", logout: "Signed out", password_changed: "Password changed", password_change_failed: "Password change failed",
  reset_requested: "Password reset requested", password_reset: "Password reset", email_verified: "Email verified", verification_resent: "Verification email resent",
  mfa_enroll_started: "Two-factor setup started", mfa_enabled: "Two-factor turned on", mfa_disabled: "Two-factor turned off", mfa_failed: "Failed two-factor code",
  recovery_code_used: "Recovery code used", recovery_codes_regenerated: "Recovery codes replaced", session_revoked: "Device signed out", sessions_revoked_all: "Other devices signed out",
};

function device(ua: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const when = (ms: number) => new Date(ms).toLocaleString();

export default async function SecurityPage() {
  const auth = await requireSession();
  const { user } = auth;
  const sessions = listSessions(user.id, auth.publicId).map((s) => ({
    publicId: s.publicId, ip: s.ip, device: device(s.ua), createdAt: when(s.createdAt), lastSeenAt: when(s.lastSeenAt), current: s.current,
  }));
  const audit = recentAudit(user.id);

  return (
    <main id="main" className="wrap">
      <PageHeader title="Security">
        Your password, two-factor authentication, signed-in devices and recent account activity.
      </PageHeader>

      <section className="panel" aria-labelledby="acct-h">
        <h2 className="section" id="acct-h">Account</h2>
        <p style={{ margin: "4px 0" }}>{user.email}</p>
        <p className="sub" style={{ margin: "4px 0" }}>
          {user.emailVerified ? <span className="ok">Email verified</span> : <span className="gap">Email not verified. Password reset emails are only sent to a verified address.</span>}
          {" · "}password last changed {when(user.passwordChangedAt)}
        </p>
        {!user.emailVerified && <ResendVerify />}
      </section>

      <ChangePasswordForm />
      <MfaPanel enabled={user.totpEnabled} codesLeft={user.totpEnabled ? recoveryCodesLeft(user.id) : 0} />
      <SessionsPanel sessions={sessions} />

      <section className="panel" aria-labelledby="log-h">
        <h2 className="section" id="log-h">Recent activity</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">From</th></tr></thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td>{when(a.at)}</td>
                  <td>{EVENTS[a.event] ?? a.event}{a.detail ? <span className="sub"> · {a.detail}</span> : null}</td>
                  <td>{a.ip || "n/a"} · {device(a.ua)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
