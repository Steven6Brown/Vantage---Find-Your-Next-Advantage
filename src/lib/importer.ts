// Turns a spreadsheet, a CSV file or a pasted list into application rows. Pure functions only (no file or
// network access), so the same code runs in the browser for the preview and is tested directly.
// Everything it reads is untrusted text: it is cleaned, length-limited and never executed.

export interface ImportRow {
  title: string;
  company: string;
  location: string;
  url: string; // "" when none (only http and https links are kept)
  appliedAt: string | null; // ISO, noon UTC so the calendar day is the same in every time zone
  notes: string;
}

export const LIMITS = { chars: 2_000_000, rows: 2000, title: 200, company: 120, location: 120, url: 2000, notes: 500 } as const;

/* ---------------------------------- text cleaning ---------------------------------- */

// Control characters, zero-width and line-separator characters. Built from character codes so the pattern stays readable.
const INVISIBLE = new RegExp(
  "[" + [[0, 31], [127, 127], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]",
  "g",
);

export function clean(s: string | undefined, max: number): string {
  // Removes control characters, collapses whitespace, trims, and limits the length.
  return (s ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
export function cleanUrl(s: string | undefined): string {
  const t = clean(s, LIMITS.url);
  if (!/^https?:\/\//i.test(t)) return "";
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/* ------------------------------------- dates -------------------------------------- */

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
];
const MONTH_ALIASES: Record<string, number> = { sept: 9 };
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (MONTH_ALIASES[w]) return MONTH_ALIASES[w];
  const i = MONTH_NAMES.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
  return i >= 0 ? i + 1 : null; // exact names only: "marketing" is not "March"
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. Feb 30
  return dt.toISOString();
}

/**
 * Understands the date styles people actually have: 2026-11-03, 11/3/2026, 11/3/26, Nov 3, 2026,
 * 3 Nov 2026, Nov 3 (current year), and Indeed-style "Applied 3 days ago", "yesterday", "today".
 * Returns null for anything else, and for dates in the future.
 */
export function parseDate(input: string, now: Date = new Date()): string | null {
  let s = clean(input, 60).toLowerCase().replace(/\s+,/g, ","); // "Nov 3 , 2026" (copied from a table) is a date too
  s = s.replace(/^(applied|application date|submitted)\b[\s:]*(on\b)?\s*/, "").replace(/^on\s+/, "").replace(/^~\s*/, "").trim();
  if (!s) return null;
  const y0 = now.getFullYear(), m0 = now.getMonth() + 1, d0 = now.getDate();
  const notFuture = (r: string | null) => (r && Date.parse(r) <= now.getTime() + 2 * 86_400_000 ? r : null);

  if (s === "today" || s === "just now") return iso(y0, m0, d0);
  if (s === "yesterday") {
    const t = new Date(y0, m0 - 1, d0 - 1);
    return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  let m = s.match(/^(\d{1,3})\+?\s*(day|week|month)s?\s+ago$/);
  if (m) {
    const n = Number(m[1]);
    const t = new Date(y0, m0 - 1, d0 - (m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30));
    return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/);
  if (m) return notFuture(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (a > 12 && b <= 12) [a, b] = [b, a]; // clearly day-first
    return notFuture(iso(y, a, b));
  }
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mo = monthOf(m[1]);
    if (mo) return yearless(Number(m[3] || 0), mo, Number(m[2]), now);
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{4})?$/);
  if (m) {
    const mo = monthOf(m[2]);
    if (mo) return yearless(Number(m[3] || 0), mo, Number(m[1]), now);
  }
  return null;
}

/** With no year given, use this year, or last year if that would put the date in the future. */
function yearless(year: number, month: number, day: number, now: Date): string | null {
  if (year) return Date.parse(iso(year, month, day) ?? "") <= now.getTime() + 2 * 86_400_000 ? iso(year, month, day) : null;
  const thisYear = iso(now.getFullYear(), month, day);
  if (thisYear && Date.parse(thisYear) <= now.getTime() + 2 * 86_400_000) return thisYear;
  return iso(now.getFullYear() - 1, month, day);
}

/* ---------------------------------------- CSV ---------------------------------------- */

/** RFC 4180 style parser. Lenient: an unterminated quote runs to the end instead of failing. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
      if (rows.length > LIMITS.rows + 1) break;
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Tab, semicolon or comma, whichever splits most lines into the same number of columns. */
export function detectDelimiter(text: string): string {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  if (!lines.length) return ",";
  let best = ",", bestScore = 0;
  for (const d of ["\t", ";", ","]) {
    const counts = lines.map((l) => parseCsv(l, d)[0]?.length ?? 1);
    const modal = Math.max(...counts);
    const agree = counts.filter((c) => c === modal).length;
    const score = modal > 1 ? agree * 10 + modal : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* ------------------------------ finding the columns ------------------------------ */

export type Field = "title" | "company" | "location" | "url" | "date" | "notes";
export type Mapping = Record<Field, number>; // column index, or -1 for none
export const FIELDS: Field[] = ["title", "company", "location", "url", "date", "notes"];

const SYNONYMS: Record<Field, string[]> = {
  title: ["title", "jobtitle", "position", "positiontitle", "role", "job", "jobname", "name", "jcsjobtitle"],
  company: ["company", "companyname", "employer", "organization", "organisation", "business"],
  location: ["location", "joblocation", "city", "where", "place", "companylocation"],
  url: ["url", "link", "joblink", "joburl", "href", "applylink", "posting", "jobposting", "jcsjobtitlehref"],
  date: ["dateapplied", "applied", "appliedon", "applieddate", "applicationdate", "dateofapplication", "date", "submitted"],
  notes: ["notes", "note", "comments", "comment", "status", "outcome", "details"],
};
const ALL_SYNONYMS = new Set(Object.values(SYNONYMS).flat());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const LOCATION_RE = /^[^,]{2,}, ?[A-Za-z]{2}\b|\bremote\b|\bhybrid\b|\bon-?site\b/i;

export function looksLikeHeader(table: string[][]): boolean {
  const first = table[0] ?? [];
  if (first.some((c) => ALL_SYNONYMS.has(norm(c)))) return true;
  if (first.some((c) => /\bhref\b|^(css|jcs)-/i.test(c.trim()))) return true;
  const second = table[1] ?? [];
  return first.length > 0 && !first.some(isUrl) && second.some(isUrl);
}

/** Header names first, then what the cells look like (links, dates, places) for anything still missing. */
export function guessMapping(table: string[][], hasHeader: boolean): Mapping {
  const map: Mapping = { title: -1, company: -1, location: -1, url: -1, date: -1, notes: -1 };
  const head = hasHeader ? table[0] ?? [] : [];
  const data = table.slice(hasHeader ? 1 : 0, 60);
  const width = Math.max(0, ...table.slice(0, 60).map((r) => r.length));
  const used = new Set<number>();

  head.forEach((h, i) => {
    const n = norm(h);
    for (const f of FIELDS) {
      if (map[f] === -1 && SYNONYMS[f].includes(n)) { map[f] = i; used.add(i); break; }
    }
  });

  const col = (i: number) => data.map((r) => (r[i] ?? "").trim()).filter(Boolean);
  const share = (cells: string[], test: (s: string) => boolean) => (cells.length ? cells.filter(test).length / cells.length : 0);
  const cols = Array.from({ length: width }, (_, i) => i).filter((i) => !used.has(i));

  if (map.url === -1) {
    const urlCols = cols.filter((i) => share(col(i), isUrl) >= 0.6);
    const pick = urlCols.find((i) => col(i).some((c) => /viewjob|\/rc\/clk|jk=|pagead/i.test(c))) ?? urlCols[0];
    if (pick !== undefined) { map.url = pick; used.add(pick); }
  }
  if (map.date === -1) {
    const pick = cols.find((i) => !used.has(i) && share(col(i), (s) => parseDate(s) !== null) >= 0.5);
    if (pick !== undefined) { map.date = pick; used.add(pick); }
  }
  if (map.location === -1) {
    const pick = cols.find((i) => !used.has(i) && share(col(i), (s) => LOCATION_RE.test(s)) >= 0.5);
    if (pick !== undefined) { map.location = pick; used.add(pick); }
  }
  const textCols = cols
    .filter((i) => !used.has(i) && share(col(i), (s) => !isUrl(s) && !/^[\d\s.,$%-]+$/.test(s)) >= 0.7 && col(i).length >= Math.max(1, data.length / 2))
    .map((i) => ({ i, avg: col(i).reduce((a, c) => a + c.length, 0) / Math.max(1, col(i).length) }))
    .sort((a, b) => b.avg - a.avg);
  if (map.title === -1 && textCols.length) map.title = textCols.shift()!.i;
  if (map.company === -1 && textCols.length) map.company = textCols[textCols.length > 1 ? textCols.length - 1 : 0].i;
  return map;
}

export interface Skipped { line: number; reason: string }
export interface Parsed { rows: ImportRow[]; skipped: Skipped[]; truncated: boolean }

/** Applies a column mapping to a table. Rows without a job title are skipped with a reason. */
export function rowsFromTable(table: string[][], map: Mapping, hasHeader: boolean, now: Date = new Date()): Parsed {
  const rows: ImportRow[] = [];
  const skipped: Skipped[] = [];
  const start = hasHeader ? 1 : 0;
  const body = table.slice(start, start + LIMITS.rows);
  const cell = (r: string[], f: Field) => (map[f] >= 0 ? r[map[f]] : undefined);
  body.forEach((r, k) => {
    const line = start + k + 1;
    const title = clean(cell(r, "title"), LIMITS.title);
    if (!title) { skipped.push({ line, reason: "No job title" }); return; }
    const dateText = cell(r, "date");
    rows.push({
      title,
      company: clean(cell(r, "company"), LIMITS.company),
      location: clean(cell(r, "location"), LIMITS.location),
      url: cleanUrl(cell(r, "url")),
      appliedAt: dateText ? parseDate(dateText, now) : null,
      notes: clean(cell(r, "notes"), LIMITS.notes),
    });
  });
  return { rows, skipped, truncated: table.length - start > LIMITS.rows };
}

/* ----------------------------- free-text lists (pasted) ----------------------------- */

/** "Title at Company", "Title - Company - Location", or a bare title; optional "(Nov 3)" date at the end. */
export function parseLine(line: string, now: Date = new Date()): ImportRow | null {
  let s = clean(line, 600);
  if (!s) return null;
  let appliedAt: string | null = null;
  const tail = s.match(/\(([^()]{3,30})\)\s*$/);
  if (tail) {
    const d = parseDate(tail[1], now);
    if (d) { appliedAt = d; s = s.slice(0, tail.index).trim(); }
  }
  let title = s, company = "", location = "";
  const m = s.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (m) {
    title = m[1]; company = m[2];
    const loc = company.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (loc && loc[1]) { company = loc[1]; location = loc[2]; }
  } else {
    let parts = s.split(/\s+[-–—|]\s+/);
    if (parts.length < 2 && s.split(",").length >= 3) parts = s.split(",").map((p) => p.trim());
    // A date at the end of the line is the day applied, not part of the place.
    if (parts.length >= 3 && !appliedAt) {
      const d = parseDate(parts[parts.length - 1], now);
      if (d) { appliedAt = d; parts = parts.slice(0, -1); }
    }
    if (parts.length >= 2) { title = parts[0]; company = parts[1]; location = parts.slice(2).join(", "); }
  }
  title = clean(title, LIMITS.title);
  if (!title) return null;
  return { title, company: clean(company, LIMITS.company), location: clean(location, LIMITS.location), url: "", appliedAt, notes: "" };
}

export type Interpreted =
  | { kind: "table"; table: string[][]; hasHeader: boolean; mapping: Mapping; truncated: boolean }
  | { kind: "lines"; rows: ImportRow[]; skipped: Skipped[]; truncated: boolean }
  | { kind: "empty"; reason: string };

/** Looks at pasted or uploaded text and decides whether it is a table or a plain list. */
export function interpretText(raw: string, now: Date = new Date()): Interpreted {
  if (raw.length > LIMITS.chars) return { kind: "empty", reason: "That is too large. Keep it under 2 MB." };
  const text = raw.replace(/\u0000/g, "");
  if (!text.trim()) return { kind: "empty", reason: "There is nothing to read yet." };
  const delimiter = detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const widths = table.slice(0, 20).map((r) => r.length);
  const tabular = widths.length > 0 && Math.max(...widths) > 1 && widths.filter((w) => w === Math.max(...widths)).length >= Math.max(2, widths.length * 0.6);
  if (tabular || (table.length === 1 && widths[0] > 2)) {
    const hasHeader = looksLikeHeader(table);
    return { kind: "table", table: table.slice(0, LIMITS.rows + 1), hasHeader, mapping: guessMapping(table, hasHeader), truncated: table.length > LIMITS.rows + 1 };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ImportRow[] = [];
  const skipped: Skipped[] = [];
  lines.slice(0, LIMITS.rows).forEach((l, i) => {
    const r = parseLine(l, now);
    if (r) rows.push(r);
    else skipped.push({ line: i + 1, reason: "Could not read this line" });
  });
  return { kind: "lines", rows, skipped, truncated: lines.length > LIMITS.rows };
}
