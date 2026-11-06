"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobExplanation, Segment } from "@/lib/explain";

/** Search area and the Check now button. */
export function RunPanel({ defaults }: { defaults: { query: string; radiusMiles: number } }) {
  const router = useRouter();
  const [query, setQuery] = useState(defaults.query);
  const [radius, setRadius] = useState(String(defaults.radiusMiles));
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { query, radiusMiles: Number(radius) }, saveAsDefault: save }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { added?: number; errors?: string[]; error?: string } | null;
    if (res?.ok && data) {
      const n = data.added ?? 0;
      setMsg({ ok: true, text: `Check complete: ${n} new opening${n === 1 ? "" : "s"}.${save ? " Area saved as your default." : ""}` });
      setSave(false);
      router.refresh();
    } else {
      setMsg({ ok: false, text: data?.error ?? "The check failed. Try again." });
    }
    setBusy(false);
  }

  return (
    <form className="searchbar" onSubmit={run} aria-label="Search area">
      <div className="field">
        <label htmlFor="loc">Area (ZIP or City, ST)</label>
        <input id="loc" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Akron, OH" required maxLength={60} />
      </div>
      <div className="field">
        <label htmlFor="rad">Radius in miles</label>
        <input id="rad" type="number" min={5} max={100} value={radius} onChange={(e) => setRadius(e.target.value)} required style={{ width: 120 }} />
      </div>
      <label className="check">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        Save as my default
      </label>
      <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
      <p role="status" className={`hint ${msg ? (msg.ok ? "ok" : "err") : ""}`}>
        {msg?.text ?? "Remote openings are always included."}
      </p>
    </form>
  );
}

const STATUS_LABELS: Record<string, string> = { new: "New", seen: "Seen", saved: "Saved", applied: "Applied", dismissed: "Dismissed" };

/** Where an opening stands in your own process. Saved instantly. */
export function StatusSelect({ id, status, title }: { id: string; status: string; title: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    const res = await fetch("/api/jobs/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null);
    if (!res?.ok) setValue(previous);
    router.refresh();
    setBusy(false);
  }

  return (
    <select aria-label={`Status of ${title}`} value={value} disabled={busy} onChange={(e) => change(e.target.value)}>
      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/* ---------- the explanation that opens under a row ---------- */

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const Alert = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 4l9 16H3L12 4zM12 10v4M12 17.5v.01" />
  </svg>
);

/** Text with the matched term highlighted. */
function Highlighted({ parts }: { parts: Segment[] }) {
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

export function InfoPanel({ info, panelId, title }: { info: JobExplanation; panelId: string; title: string }) {
  const credentials = [
    ...(info.degree ? [`The posting asks for a degree. Your resume lists: ${info.degree}`] : []),
    ...info.certsMatched.map((c) => `${c} is mentioned in the posting, and you hold it`),
  ];
  const unconfirmed = [
    ...(info.notStated.length ? [`The posting text we have does not state: ${info.notStated.join(", ").toLowerCase()}.`] : []),
    ...(info.partialText ? ["This source shows only part of the posting. Open it to confirm the requirements."] : []),
  ];

  return (
    <div id={panelId} className="info" role="region" aria-label={`Details for ${title}`}>
      <div className="info-verdict">
        <span className={`pill ${info.verdict}`}>{info.verdictLabel}</span>
        <p>{info.summary}</p>
      </div>

      {info.note && (
        <section>
          <h3>Your notes</h3>
          <p className="sub" style={{ margin: 0, maxWidth: "70ch" }}>{info.note}</p>
        </section>
      )}

      <div className="info-cols">
        <div className="info-col">
          {info.why.length > 0 && (
            <section>
              <h3>{info.verdict === "mismatch" ? "What matched" : "Why it fits"}</h3>
              <ul className="ticks">{info.why.map((w) => <li key={w} className="good"><Check /><span>{w}</span></li>)}</ul>
            </section>
          )}
          {info.watchOuts.length > 0 && (
            <section>
              <h3>Watch-outs</h3>
              <ul className="ticks">{info.watchOuts.map((w) => <li key={w} className="warn"><Alert /><span>{w}</span></li>)}</ul>
            </section>
          )}
          {credentials.length > 0 && (
            <section>
              <h3>Credentials</h3>
              <ul className="ticks">{credentials.map((c) => <li key={c} className="good"><Check /><span>{c}</span></li>)}</ul>
            </section>
          )}
          {unconfirmed.length > 0 && (
            <section className="unconfirmed">
              <h3>Not confirmed</h3>
              <ul className="ticks">{unconfirmed.map((u) => <li key={u}><span>{u}</span></li>)}</ul>
            </section>
          )}
        </div>

        <div className="info-col">
          <section>
            <h3>Your resume vs. this posting</h3>
            {!info.hasResume ? (
              <p className="sub">No resume uploaded yet. <a href="/settings">Upload one in Settings</a> to see how it lines up with this posting.</p>
            ) : info.resumeMatches.length === 0 ? (
              <p className="sub">None of the skills from your resume appear in the posting text we have.</p>
            ) : (
              <ul className="evidence">
                {info.resumeMatches.map((m) => (
                  <li key={m.term}>
                    <span className="term">{m.term}</span>
                    <dl>
                      {m.resumeLine.length > 0 && (
                        <div><dt>On your resume</dt><dd><Highlighted parts={m.resumeLine} /></dd></div>
                      )}
                      {m.postingSnippet.length > 0 && (
                        <div><dt>In the posting</dt><dd><Highlighted parts={m.postingSnippet} /></dd></div>
                      )}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            {info.matchedCount > info.resumeMatches.length && (
              <p className="sub">Plus {info.matchedCount - info.resumeMatches.length} more matching skills not shown.</p>
            )}
          </section>

          {info.resumeEntries.length > 0 && (
            <section>
              <h3>Resume entries that support it</h3>
              <ul className="ticks">{info.resumeEntries.map((e) => <li key={e} className="good"><Check /><span>{e}</span></li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
