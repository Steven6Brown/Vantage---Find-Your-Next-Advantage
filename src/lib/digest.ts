import { APP_NAME } from "./brand";
import type { StoredJob } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sends the digest through Resend. Returns "skipped" when not configured. */
export async function sendDigest(jobs: StoredJob[]): Promise<boolean | "skipped"> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_TO;
  const from = process.env.DIGEST_FROM;
  if (!key || !to || !from) return "skipped";
  if (!jobs.length) return "skipped";

  const lines = jobs.map((j) => {
    const note = j.match.gaps.length ? `Gaps: ${j.match.gaps.join("; ")}` : "No obvious gaps";
    return { j, note };
  });
  const text = lines
    .map(({ j, note }) => `${j.title} - ${j.company} (${j.location || "n/a"})\n  ${j.match.reasons.join("; ")}\n  ${note}\n  ${j.url}`)
    .join("\n\n");
  const html = `<h2>${jobs.length} new cybersecurity listing${jobs.length === 1 ? "" : "s"}</h2><ul>${lines
    .map(
      ({ j, note }) =>
        `<li><a href="${esc(j.url)}">${esc(j.title)}</a> - ${esc(j.company)} (${esc(j.location || "n/a")})<br>${esc(
          j.match.reasons.join("; "),
        )}<br><em>${esc(note)}</em></li>`,
    )
    .join("")}</ul><p>Review each listing yourself before applying. This tool does not apply for you.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `${APP_NAME}: ${jobs.length} new match${jobs.length === 1 ? "" : "es"}`, text, html }),
  });
  return res.ok;
}
