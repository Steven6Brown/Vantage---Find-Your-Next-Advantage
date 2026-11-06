"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDay } from "@/lib/dates";
import {
  FIELDS, guessMapping, interpretText, LIMITS, rowsFromTable, type Field, type ImportRow, type Interpreted, type Mapping,
} from "@/lib/importer";

type Method = "file" | "paste" | "one";
interface Result { index: number; outcome: "new" | "update" | "unchanged" | "invalid"; title: string; company: string; reason: string }
interface Summary { results: Result[]; added: number; updated: number; unchanged: number; invalid: number }

const FIELD_LABEL: Record<Field, string> = { title: "Job title", company: "Company", location: "Location", url: "Link", date: "Date applied", notes: "Notes" };
const OUTCOME_LABEL: Record<Result["outcome"], string> = { new: "New", update: "Already in your list", unchanged: "Already applied", invalid: "Skipped" };
const BATCH = 500;

/** Sends rows in batches of 500 and merges the answers. dryRun checks only; nothing is saved. */
async function callImport(rows: ImportRow[], dryRun: boolean, signal?: AbortSignal): Promise<Summary> {
  const total: Summary = { results: [], added: 0, updated: 0, unchanged: 0, invalid: 0 };
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows.slice(i, i + BATCH), dryRun }),
      signal,
    });
    const data = (await res.json().catch(() => null)) as (Summary & { error?: string }) | null;
    if (!res.ok || !data || !Array.isArray(data.results)) throw new Error(data?.error ?? "The import failed. Try again.");
    total.results.push(...data.results.map((r) => ({ ...r, index: r.index + i })));
    total.added += data.added;
    total.updated += data.updated;
    total.unchanged += data.unchanged;
    total.invalid += data.invalid;
  }
  return total;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ImportPanel() {
  const [method, setMethod] = useState<Method>("file");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [interpreted, setInterpreted] = useState<Interpreted | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Summary | null>(null);

  function load(raw: string) {
    setDone(null);
    setError("");
    const r = interpretText(raw);
    setInterpreted(r);
    if (r.kind === "table") { setHasHeader(r.hasHeader); setMapping(r.mapping); setMessage(""); }
    else { setMapping(null); setMessage(r.kind === "empty" ? r.reason : ""); }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > LIMITS.chars) { setInterpreted(null); setMessage("That file is over 2 MB. Split it into smaller files."); return; }
    setFileName(file.name);
    load(await file.text());
  }

  const parsed = useMemo(() => {
    if (!interpreted) return { rows: [] as ImportRow[], skipped: [] as { line: number; reason: string }[], truncated: false };
    if (interpreted.kind === "table" && mapping) return rowsFromTable(interpreted.table, mapping, hasHeader);
    if (interpreted.kind === "lines") return { rows: interpreted.rows, skipped: interpreted.skipped, truncated: interpreted.truncated };
    return { rows: [] as ImportRow[], skipped: [] as { line: number; reason: string }[], truncated: false };
  }, [interpreted, mapping, hasHeader]);

  // Check the list against what is already saved (nothing is saved at this step).
  useEffect(() => {
    setPreview(null);
    setError("");
    if (!parsed.rows.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        setPreview(await callImport(parsed.rows, true, ctrl.signal));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setPreviewing(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); setPreviewing(false); };
  }, [parsed.rows]);

  async function commit() {
    setBusy(true);
    setError("");
    try {
      setDone(await callImport(parsed.rows, false));
      setInterpreted(null); setText(""); setFileName(""); setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const willChange = preview ? preview.added + preview.updated : 0;
  const table = interpreted?.kind === "table" ? interpreted.table : [];
  const width = Math.max(0, ...table.slice(0, 60).map((r) => r.length));
  const colName = (i: number) => (hasHeader && table[0]?.[i]?.trim() ? table[0][i].trim().slice(0, 30) : `Column ${i + 1}`);

  return (
    <>
      <details className="scope" style={{ marginTop: 0 }}>
        <summary><b>What can I import?</b> A spreadsheet, a CSV file, or a list you type or paste</summary>
        <div className="scope-body">
          <div>
            <p className="subhead">What you need</p>
            <ul>
              <li>A job title for each row. Company, location, a link and the date you applied are optional.</li>
              <li>The company, location and link help Vantage recognise jobs it already has, so you do not get duplicates.</li>
              <li>Dates like &quot;11/3/2026&quot;, &quot;Nov 3&quot; and &quot;Applied 3 days ago&quot; are understood.</li>
            </ul>
          </div>
          <div>
            <p className="subhead">A pasted list can look like this</p>
            <ul>
              <li>SOC Analyst at Acme (Nov 3)</li>
              <li>Security Analyst - Globex - Akron, OH</li>
              <li>Rows copied straight from a spreadsheet</li>
            </ul>
          </div>
          <div>
            <p className="subhead">Where your data goes</p>
            <p className="sub">Files are read in your browser. Only the rows you confirm are saved, on this computer.</p>
          </div>
        </div>
      </details>

      {done && (
        <div className="note" role="status" style={{ borderLeftColor: "var(--signal)" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 650 }}>
            Import complete: {plural(done.added, "application")} added
            {done.updated ? `, ${plural(done.updated, "opening")} already in your list marked as applied` : ""}
            {done.unchanged ? `, ${done.unchanged} already applied` : ""}
            {done.invalid ? `, ${done.invalid} skipped` : ""}.
          </p>
          <div className="row">
            <Link className="btn primary" href="/?view=applied">View your applied openings</Link>
            <button type="button" className="btn" onClick={() => setDone(null)}>Import more</button>
          </div>
        </div>
      )}

      <section className="panel" aria-labelledby="how-h">
        <h2 className="section" id="how-h">How do you want to add them?</h2>
        <div className="seg" role="group" aria-label="Way to add applications" style={{ marginTop: 10 }}>
          <button type="button" aria-pressed={method === "file"} onClick={() => setMethod("file")}>Upload a file</button>
          <button type="button" aria-pressed={method === "paste"} onClick={() => setMethod("paste")}>Paste a list</button>
          <button type="button" aria-pressed={method === "one"} onClick={() => setMethod("one")}>Add one</button>
        </div>

        {method === "file" && (
          <div className="field" style={{ marginTop: 16, maxWidth: 520 }}>
            <label htmlFor="imp-file">CSV or text file (up to 2 MB)</label>
            <input id="imp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={onFile} />
            {fileName && <span className="sub">Selected file: {fileName}</span>}
          </div>
        )}

        {method === "paste" && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="imp-text">Paste your list</label>
              <textarea id="imp-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={"SOC Analyst at Acme (Nov 3)\nSecurity Analyst - Globex - Akron, OH"} />
            </div>
            <div><button type="button" className="btn primary" onClick={() => load(text)} disabled={!text.trim()}>Read my list</button></div>
          </div>
        )}

        {method === "one" && <AddOne onAdded={(s) => setDone(s)} />}
        {message && method !== "one" && <p role="status" className="err" style={{ marginBottom: 0 }}>{message}</p>}
      </section>

      {method !== "one" && interpreted?.kind === "table" && mapping && (
        <section className="panel" aria-labelledby="map-h">
          <h2 className="section" id="map-h">Match your columns</h2>
          <p className="sub">Vantage guessed which column is which. Change any that are wrong.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => { setHasHeader(e.target.checked); setMapping(guessMapping(table, e.target.checked)); }}
            />
            My first row is a header
          </label>
          <div className="mapgrid">
            {FIELDS.map((f) => (
              <div className="field" key={f}>
                <label htmlFor={`map-${f}`}>{FIELD_LABEL[f]}{f === "title" ? " (required)" : ""}</label>
                <select id={`map-${f}`} value={mapping[f]} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                  <option value={-1}>Not in my file</option>
                  {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {method !== "one" && interpreted && interpreted.kind !== "empty" && (
        <section className="panel" aria-labelledby="prev-h">
          <h2 className="section" id="prev-h">Check before you import</h2>
          {parsed.rows.length === 0 ? (
            <p className="err" role="status">No applications found yet. {mapping && mapping.title < 0 ? "Choose which column holds the job title." : "Check the file and the columns above."}</p>
          ) : (
            <>
              <p className="sub" role="status">
                Found {plural(parsed.rows.length, "row")}.
                {parsed.truncated ? ` Only the first ${LIMITS.rows} were read.` : ""}
                {previewing ? " Checking against your list…" : ""}
              </p>
              {preview && (
                <div className="summary-chips" aria-label="Summary">
                  <span className="chip">{plural(preview.added, "new application")}</span>
                  {preview.updated > 0 && <span className="chip">{plural(preview.updated, "opening")} already in your list</span>}
                  {preview.unchanged > 0 && <span className="chip">{preview.unchanged} already applied</span>}
                  {preview.invalid > 0 && <span className="chip">{preview.invalid} skipped</span>}
                </div>
              )}
              {parsed.skipped.length > 0 && (
                <p className="sub">
                  {plural(parsed.skipped.length, "line")} could not be read:{" "}
                  {parsed.skipped.slice(0, 4).map((s) => `line ${s.line} (${s.reason.toLowerCase()})`).join(", ")}
                  {parsed.skipped.length > 4 ? ", and more" : ""}.
                </p>
              )}
              <div className="tablewrap">
                <table className="preview">
                  <caption className="sr">Applications to import</caption>
                  <thead>
                    <tr><th scope="col">Opening</th><th scope="col">Company</th><th scope="col">Location</th><th scope="col">Applied</th><th scope="col">Result</th></tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 100).map((r, i) => {
                      const res = preview?.results[i];
                      return (
                        <tr key={i}>
                          <td>{r.title}</td>
                          <td>{r.company || <span className="muted">Not listed</span>}</td>
                          <td>{r.location || <span className="muted">Not listed</span>}</td>
                          <td>{r.appliedAt ? formatDay(r.appliedAt) : <span className="muted">Today</span>}</td>
                          <td>
                            {res ? (
                              <>
                                <span className={`outcome ${res.outcome}`}>{OUTCOME_LABEL[res.outcome]}</span>
                                <span className="cell-sub">{res.reason}</span>
                              </>
                            ) : (
                              <span className="muted">{previewing ? "Checking…" : ""}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > 100 && <p className="sub">Showing the first 100 of {parsed.rows.length}. All of them will be imported.</p>}
              <div className="row" style={{ marginTop: 16 }}>
                <button type="button" className="btn primary" onClick={commit} disabled={busy || previewing || willChange === 0}>
                  {busy ? "Importing…" : willChange > 0 ? `Import ${plural(willChange, "application")}` : "Nothing new to import"}
                </button>
                {preview && willChange === 0 && <span className="hint">Everything here is already in your list as applied.</span>}
              </div>
            </>
          )}
          {error && <p role="alert" className="err">{error}</p>}
        </section>
      )}
    </>
  );
}

/** One application, typed in. Saved straight away. */
function AddOne({ onAdded }: { onAdded: (s: Summary) => void }) {
  const [f, setF] = useState({ title: "", company: "", location: "", url: "", date: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row: ImportRow = {
        title: f.title, company: f.company, location: f.location, url: f.url, notes: f.notes,
        appliedAt: f.date ? `${f.date}T12:00:00.000Z` : null,
      };
      const s = await callImport([row], false);
      if (s.invalid) setError(s.results[0]?.reason ?? "That could not be added.");
      else { onAdded(s); setF({ title: "", company: "", location: "", url: "", date: "", notes: "" }); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: 16, maxWidth: 560 }}>
      <div className="field"><label htmlFor="one-title">Job title (required)</label><input id="one-title" type="text" required maxLength={200} value={f.title} onChange={set("title")} /></div>
      <div className="field"><label htmlFor="one-company">Company</label><input id="one-company" type="text" maxLength={120} value={f.company} onChange={set("company")} /></div>
      <div className="field"><label htmlFor="one-location">Location</label><input id="one-location" type="text" maxLength={120} value={f.location} onChange={set("location")} placeholder="Akron, OH or Remote" /></div>
      <div className="field"><label htmlFor="one-url">Link to the posting</label><input id="one-url" type="text" inputMode="url" maxLength={2000} value={f.url} onChange={set("url")} placeholder="https://" /></div>
      <div className="field"><label htmlFor="one-date">Date you applied</label><input id="one-date" type="date" max={today} value={f.date} onChange={set("date")} /></div>
      <div className="field"><label htmlFor="one-notes">Notes</label><input id="one-notes" type="text" maxLength={500} value={f.notes} onChange={set("notes")} placeholder="Phone screen on Friday" /></div>
      <div><button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add application"}</button></div>
      {error && <p role="alert" className="err" style={{ margin: 0 }}>{error}</p>}
    </form>
  );
}
