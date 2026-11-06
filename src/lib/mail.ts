import { APP_NAME } from "./brand";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type MailResult = "sent" | "logged" | "failed";

/** Base URL used in emailed links. Never taken from request headers (host-header injection). */
export function appUrl(): string {
  const u = process.env.APP_URL;
  if (u) return u.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("APP_URL must be set in production");
}

/**
 * Sends through Resend. With no email configured: in development the message is printed to the
 * server console so flows can be tested; in production nothing is printed and the send fails.
 */
export async function sendMail(opts: { to: string; subject: string; text: string; html: string }): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? process.env.DIGEST_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[dev mail] To: ${opts.to}\nSubject: ${opts.subject}\n${opts.text}\n`);
      return "logged";
    }
    console.error("Email is not configured; message not sent.");
    return "failed";
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text, html: opts.html }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

const wrap = (title: string, body: string, link?: { href: string; label: string }) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>${esc(title)}</h2><p>${body}</p>${
    link ? `<p><a href="${esc(link.href)}" style="background:#4ade80;color:#000;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${esc(link.label)}</a></p><p style="color:#666;font-size:13px">If the button doesn't work, copy this link:<br>${esc(link.href)}</p>` : ""
  }<p style="color:#666;font-size:13px">If you didn't expect this email, you can ignore it.</p></div>`;

export const mails = {
  verify(to: string, link: string) {
    return sendMail({
      to, subject: `Verify your email for ${APP_NAME}`,
      text: `Verify your email address by opening this link (valid 24 hours):\n${link}\n\nIf you didn't create this account, ignore this email.`,
      html: wrap("Verify your email", "Confirm this address to finish setting up your account. The link is valid for 24 hours.", { href: link, label: "Verify email" }),
    });
  },
  reset(to: string, link: string) {
    return sendMail({
      to, subject: `Reset your ${APP_NAME} password`,
      text: `Reset your password using this link (valid 30 minutes, one use):\n${link}\n\nIf you didn't ask for this, ignore this email; your password has not changed.`,
      html: wrap("Reset your password", "Use the button below to choose a new password. The link is valid for 30 minutes and works once.", { href: link, label: "Reset password" }),
    });
  },
  passwordChanged(to: string) {
    return sendMail({
      to, subject: `Your ${APP_NAME} password was changed`,
      text: "Your password was just changed and all other sessions were signed out. If this wasn't you, reset your password immediately.",
      html: wrap("Password changed", "Your password was just changed and all other sessions were signed out. If this wasn't you, reset your password immediately."),
    });
  },
  mfaChanged(to: string, enabled: boolean) {
    const what = enabled ? "turned on" : "turned off";
    return sendMail({
      to, subject: `Two-factor authentication ${what}`,
      text: `Two-factor authentication was ${what} for your ${APP_NAME} account. If this wasn't you, reset your password immediately.`,
      html: wrap(`Two-factor authentication ${what}`, `Two-factor authentication was ${what} for your account. If this wasn't you, reset your password immediately.`),
    });
  },
};
