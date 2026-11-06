"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Msg = { text: string; ok: boolean } | null;

const SUGGESTIONS = [
  "SOC analyst", "security analyst", "cybersecurity analyst", "information security analyst", "GRC analyst",
  "compliance analyst", "security engineer", "vulnerability analyst", "incident response analyst",
  "threat analyst", "penetration tester", "IT security",
];

/** The job titles sent to the job search. Editing these changes what gets pulled on the next check. */
export function QueriesForm({ queries, areaLabel }: { queries: string[]; areaLabel: string }) {
  const router = useRouter();
  const [list, setList] = useState(queries);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const dirty = list.join("\n") !== queries.join("\n");

  function add(term: string) {
    const t = term.trim();
    if (t.length < 2) return;
    if (list.some((x) => x.toLowerCase() === t.toLowerCase())) { setDraft(""); return; }
    if (list.length >= 12) { setMsg({ ok: false, text: "You can keep up to 12 search terms." }); return; }
    setList([...list, t]);
    setDraft("");
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: list }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setMsg(res?.ok ? { ok: true, text: "Saved. They are used on the next check." } : { ok: false, text: data?.error ?? "Could not save." });
    if (res?.ok) router.refresh();
    setBusy(false);
  }

  const unused = SUGGESTIONS.filter((s) => !list.some((x) => x.toLowerCase() === s.toLowerCase()));

  return (
    <section className="panel" aria-labelledby="q-h">
      <h2 className="section" id="q-h">Job types to search for</h2>
      <p className="sub">
        These job titles are sent to the job search. Each one is searched near {areaLabel} and for remote work, so {list.length} term
        {list.length === 1 ? "" : "s"} means about {list.length * 2} search requests per check. A free Adzuna test key showed only 25
        calls on your Adzuna dashboard, so fewer terms go further.
      </p>
      <ul className="chips" aria-label="Current search terms">
        {list.map((q) => (
          <li key={q} className="chip termchip">
            {q}
            <button type="button" aria-label={`Remove ${q}`} onClick={() => { setList(list.filter((x) => x !== q)); setMsg(null); }} disabled={list.length <= 1}>×</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="q-new">Add a job title</label>
          <input id="q-new" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} placeholder="e.g. threat analyst" />
        </div>
        <button className="btn" type="submit">Add</button>
        <button className="btn primary" type="button" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save search terms"}</button>
      </form>
      {unused.length > 0 && (
        <>
          <p className="sub" style={{ marginBottom: 4 }}>Quick add:</p>
          <div className="chips">
            {unused.map((s) => <button key={s} type="button" className="btn sm" onClick={() => add(s)}>+ {s}</button>)}
          </div>
        </>
      )}
      <p role="status" className={`sub ${msg ? (msg.ok ? "ok" : "err") : ""}`}>{msg?.text}</p>
    </section>
  );
}

export function LocationForm({ query, radiusMiles }: { query: string; radiusMiles: number }) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [r, setR] = useState(String(radiusMiles));
  const [msg, setMsg] = useState<Msg>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { query: q, radiusMiles: Number(r) } }),
    }).catch(() => null);
    setMsg(res?.ok ? { ok: true, text: "Saved as your default." } : { ok: false, text: "Enter a ZIP or City, ST and 5-100 miles." });
    if (res?.ok) router.refresh();
  }

  return (
    <form className="panel" onSubmit={save}>
      <h2 className="section">Default search area</h2>
      <p className="sub">Used for every check unless you change it on the dashboard. Remote jobs are always included.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="s-loc">ZIP or City, ST</label>
          <input id="s-loc" type="text" value={q} onChange={(e) => setQ(e.target.value)} required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="s-rad">Radius (miles)</label>
          <input id="s-rad" type="number" min={5} max={100} value={r} onChange={(e) => setR(e.target.value)} required style={{ width: 110 }} />
        </div>
        <button className="btn primary">Save default</button>
      </div>
      <p role="status" className={`sub ${msg ? (msg.ok ? "ok" : "err") : ""}`}>{msg?.text}</p>
    </form>
  );
}

type Entry = { heading: string; months: number | null; bullets: string[] };
export type ResumeView = {
  terms: string[];
  credentials: string[];
  education: string[];
  hasBachelor: boolean;
  relatedYears: number | null;
  experience: Entry[];
  projects: Entry[];
  evidence: Record<string, string>;
  updatedAt: string;
};

const dur = (m: number | null) => (m === null ? "" : m >= 12 ? ` (${Math.round((m / 12) * 10) / 10} yr)` : ` (${m} mo)`);

function EntryList({ title, items }: { title: string; items: Entry[] }) {
  if (!items.length) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary>{title} ({items.length})</summary>
      <ul className="notes">
        {items.map((e, i) => (
          <li key={i}>
            {e.heading || "(untitled)"}{dur(e.months)}
            {e.bullets.length ? <span className="sub"> · {e.bullets.length} bullet{e.bullets.length === 1 ? "" : "s"}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ResumePanel({ resume, certs }: { resume: ResumeView | null; certs: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [certText, setCertText] = useState(certs.join(", "));

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/resume", { method: "POST", body: new FormData(e.currentTarget) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (res?.ok) {
      setMsg({ ok: true, text: "Resume read. Review the detected items below." });
      router.refresh();
    } else {
      setMsg({ ok: false, text: data?.error ?? "Upload failed." });
    }
    setBusy(false);
  }

  async function remove() {
    await fetch("/api/resume", { method: "DELETE" });
    setMsg({ ok: true, text: "Resume data removed." });
    router.refresh();
  }

  async function saveCerts(e: React.FormEvent) {
    e.preventDefault();
    const list = certText.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ certsHeld: list }),
    }).catch(() => null);
    setMsg(res?.ok ? { ok: true, text: "Certifications saved." } : { ok: false, text: "Could not save certifications." });
    if (res?.ok) router.refresh();
  }

  return (
    <>
      <form className="panel" onSubmit={upload}>
        <h2 className="section">Resume</h2>
        <p className="sub">
          Read on this computer with simple rules: no AI, nothing sent anywhere. The file is not kept; only the skills,
          certifications and years found are saved. Contact details are ignored.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="resume">PDF, DOCX or TXT (under 2 MB)</label>
            <input id="resume" name="resume" type="file" accept=".pdf,.docx,.txt" required />
          </div>
          <button className="btn primary" disabled={busy}>{busy ? "Reading…" : "Upload resume"}</button>
          {resume && <button type="button" className="btn danger" onClick={remove}>Remove resume data</button>}
        </div>
        <p role="status" className={`sub ${msg ? (msg.ok ? "ok" : "err") : ""}`}>{msg?.text}</p>
        {resume && (
          <>
            <p className="sub">
              Read {new Date(resume.updatedAt).toLocaleDateString()}: {resume.experience.length} experience entr{resume.experience.length === 1 ? "y" : "ies"},{" "}
              {resume.projects.length} project{resume.projects.length === 1 ? "" : "s"}, {resume.terms.length} skills and tools.
              {resume.relatedYears !== null ? ` About ${resume.relatedYears} yr under your related/technical experience heading (from dates).` : ""}
              {resume.hasBachelor ? " Bachelor's degree found." : ""}
            </p>
            {resume.education.length > 0 && (
              <ul className="notes" aria-label="Education found">{resume.education.map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
            <p className="sub" style={{ marginBottom: 0 }}>Skills and tools learned from your resume. Each opening's Details show where they appear:</p>
            {resume.terms.length ? (
              <ul className="chips" aria-label="Detected skills and tools">
                {resume.terms.map((s) => <li className="chip" key={s}>{s}</li>)}
              </ul>
            ) : (
              <p className="sub">Nothing found. Check that the file has readable text.</p>
            )}
            <EntryList title="Experience found" items={resume.experience} />
            <EntryList title="Projects found" items={resume.projects} />
            {resume.credentials.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary>Certifications and training listed ({resume.credentials.length})</summary>
                <ul className="notes">{resume.credentials.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            <p className="sub">Edit your resume any time and upload it again. Everything is re-read from the new file.</p>
          </>
        )}
      </form>

      <form className="panel" onSubmit={saveCerts}>
        <h2 className="section">Certifications you hold</h2>
        <p className="sub">Used to flag jobs that require a cert you lack. Fix anything the resume read got wrong. Separate with commas.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="certs">Certifications</label>
            <input id="certs" type="text" value={certText} onChange={(e) => setCertText(e.target.value)} placeholder="Security+, Network+" />
          </div>
          <button className="btn primary">Save certifications</button>
        </div>
      </form>
    </>
  );
}
