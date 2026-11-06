import { findCerts, findSkills, SKILLS } from "./match";

export const MAX_RESUME_BYTES = 2 * 1024 * 1024;

export interface Entry {
  heading: string; // org / title / dates lines, contact details removed
  months: number | null; // from the date range(s) in the heading
  bullets: string[];
}

export interface ParsedResume {
  education: string[];
  hasBachelor: boolean;
  experience: Entry[];
  projects: Entry[];
  certs: string[]; // recognised industry certs (used to flag required-cert gaps)
  credentials: string[]; // other lines from the certifications/training section
  terms: string[]; // skills, tools and technologies learned from the resume itself
  evidence: Record<string, string>; // term -> a resume line that mentions it
  relatedYears: number | null; // from dates under a "related/technical" experience heading
}

/* ---------- text helpers ---------- */

const BULLET = /^[•▪●◦·\-–*]\s*/;

/** Contact details never leave this function. */
function scrub(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[|]\s*$/g, "")
    .trim();
}

type SectionType = "education" | "experience" | "projects" | "certifications" | "skills" | "awards" | "summary";

const HEADING_RULES: [RegExp, SectionType][] = [
  [/educat|academic/i, "education"],
  [/project/i, "projects"],
  [/certif|licen|training|credential/i, "certifications"],
  [/skill|technolog|tools|competenc/i, "skills"],
  [/experience|employment|work history|internship/i, "experience"],
  [/award|honor|activit|leadership|volunteer/i, "awards"],
  [/summary|profile|objective|about/i, "summary"],
];

function headingType(line: string): SectionType | null {
  const t = line.trim();
  if (t.length < 3 || t.length > 45 || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return null;
  return HEADING_RULES.find(([re]) => re.test(t))?.[1] ?? null;
}

interface Section {
  type: SectionType;
  heading: string;
  lines: string[];
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const type = headingType(line);
    if (type) {
      cur = { type, heading: line, lines: [] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return sections;
}

/* ---------- dates ---------- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SEASONS: Record<string, number> = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 1 };
const DATE = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|(?:spring|summer|fall|autumn|winter)\s+\d{4}|\d{4})`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current)`, "gi");

function monthIndex(d: string, now: Date): number {
  const s = d.toLowerCase().trim();
  if (s === "present" || s === "current") return now.getFullYear() * 12 + now.getMonth();
  const year = Number(s.match(/\d{4}/)?.[0] ?? now.getFullYear());
  const word = s.match(/[a-z]+/)?.[0] ?? "";
  const mi = MONTHS.findIndex((m) => word.startsWith(m));
  if (mi >= 0) return year * 12 + mi;
  if (word in SEASONS) return year * 12 + SEASONS[word] - 1;
  return year * 12; // bare year
}

function intervals(text: string, now: Date): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(RANGE)) {
    const a = monthIndex(m[1], now);
    const b = monthIndex(m[2], now);
    if (b >= a) out.push([a, b + 1]); // inclusive of the end month
  }
  return out;
}

function unionMonths(list: [number, number][]): number {
  const sorted = [...list].sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of sorted) {
    if (a > end) total += b - a;
    else if (b > end) total += b - end;
    end = Math.max(end, b);
  }
  return total;
}

/* ---------- entries (jobs, projects) ---------- */

function parseEntries(lines: string[], now: Date): Entry[] {
  const entries: Entry[] = [];
  let header: string[] = [];
  let cur: Entry | null = null;

  const flushHeader = () => {
    if (!header.length) return;
    const raw = header.join(" ");
    const iv = intervals(raw, now);
    cur = { heading: scrub(header.join(" — ")), months: iv.length ? unionMonths(iv) : null, bullets: [] };
    entries.push(cur);
    header = [];
  };

  for (const line of lines) {
    if (BULLET.test(line)) {
      flushHeader();
      if (!cur) {
        cur = { heading: "", months: null, bullets: [] };
        entries.push(cur);
      }
      cur.bullets.push(scrub(line.replace(BULLET, "")));
      continue;
    }
    const prev = cur && cur.bullets.length ? cur.bullets[cur.bullets.length - 1] : null;
    const hasDate = new RegExp(DATE, "i").test(line);
    const continuation =
      prev !== null && !header.length && (/^[a-z(\d]/.test(line) || (!/[.!?:;)]$/.test(prev) && !hasDate));
    if (continuation && cur) {
      cur.bullets[cur.bullets.length - 1] = `${prev} ${scrub(line)}`.trim();
    } else {
      if (cur && cur.bullets.length) cur = null; // a new entry's header begins
      header.push(line);
    }
  }
  flushHeader();
  return entries.filter((e) => e.heading || e.bullets.length);
}

/* ---------- terms (skills, tools, technologies) ---------- */

const STOP = new Set(
  (
    "and or the a an of to in on for with using use used led built designed deployed managed assisted collaborated " +
    "supported maintained delivered install installed operate operating present current university college " +
    "january february march april may june july august september october november december spring summer fall winter " +
    "student students team teams faculty course courses lab labs project projects experience work company"
  ).split(" "),
);

const isAcronym = (w: string) => /^[A-Z0-9]{2,8}$/.test(w);
const isTitle = (w: string) => /^[A-Z][a-z0-9]+$/.test(w);
const isTechShaped = (w: string) => /[.#+]/.test(w) || /^[a-z]+[A-Z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w);

/** Normalise one candidate; returns null when it doesn't look like a skill or tool. */
function cleanTerm(raw: string, inSkills: boolean, vocab: Map<string, string>): string | null {
  const t = raw.replace(/^(and|or|including|such as)\s+/i, "").replace(/[.:;]+$/g, "").replace(/\s+\d+(\.\d+)*$/, "").trim();
  if (t.length < 2 || t.length > 30) return null;
  const words = t.split(/\s+/);
  if (words.length > (inSkills ? 4 : 3)) return null;
  if (words.every((w) => STOP.has(w.toLowerCase()))) return null;
  const known = vocab.get(t.toLowerCase());
  if (known) return known;
  if (inSkills) return /^[A-Za-z0-9][\w .#+&/'-]*$/.test(t) ? t : null;
  if (words.every((w) => isTitle(w) || isTechShaped(w)) && !words.some((w) => STOP.has(w.toLowerCase()))) return t;
  return null; // lowercase phrases and bare acronyms outside the skills section are too noisy
}

function splitList(s: string): string[] {
  return s
    .split(/,|;|\band\b|\bor\b/i)
    .flatMap((p) => {
      const parts = p.split("/");
      return parts.length > 1 && parts.every((x) => !isAcronym(x.trim())) ? parts : [p];
    })
    .map((p) => p.trim())
    .filter(Boolean);
}

function extractTerms(sections: Section[], fullText: string): { terms: string[]; evidence: Record<string, string> } {
  const vocab = new Map(SKILLS.map((s) => [s.toLowerCase(), s as string]));
  const found = new Map<string, string>(); // lowercased -> display
  const add = (t: string | null) => t && !found.has(t.toLowerCase()) && found.set(t.toLowerCase(), t);

  // 1. Built-in security vocabulary, matched anywhere in the resume.
  findSkills(fullText).forEach((s) => add(s));

  for (const sec of sections) {
    if (sec.type === "education" || sec.type === "summary") continue;
    const inSkills = sec.type === "skills";
    const text = sec.lines.join(" ").replace(/\s+/g, " ");

    // 2. Parenthetical lists: "SIEM (Splunk, ELK)", "(Docker, Proxmox, Debian 12)".
    for (const m of text.matchAll(/\(([^)]{2,140})\)/g)) splitList(m[1]).forEach((p) => add(cleanTerm(p, inSkills, vocab)));

    // 3. Clauses: "using X, Y and Z", "experienced with ...", "including ...".
    // A dot inside a token (Next.js, Node.js) belongs to it; a dot before a space ends the clause.
    for (const m of text.matchAll(/\b(?:using|with|including|such as|via|e\.g\.)\s+((?:[^.;]|\.(?=\w)){2,200})/gi)) {
      splitList(m[1].replace(/\([^)]*\)/g, "")).forEach((p) => add(cleanTerm(p, inSkills, vocab)));
    }

    // 4. Skills section: every comma/semicolon item (category labels before ":" dropped).
    if (inSkills) {
      // A "Label:" starts a new item; other lines are wrapped continuations of the previous one.
      const items: string[] = [];
      for (const l of sec.lines) {
        if (items.length && !/^[^:]{1,45}:/.test(l)) items[items.length - 1] += ` ${l}`;
        else items.push(l);
      }
      for (const line of items) {
        let body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
        // Sentence-style lines ("Developed apps using A, B, C"): keep only the list after the lead phrase.
        const lead = body.match(/\b(?:using|with|including)\s+([\s\S]+)$/i);
        if (lead) body = lead[1];
        // Split on commas/semicolons, and on "and" only before a capitalised item, so phrases stay whole.
        body
          .replace(/\([^)]*\)/g, "")
          .split(/[,;]|,?\s+and\s+(?=[A-Z])/)
          .forEach((p) => add(cleanTerm(p.trim(), true, vocab)));
      }
    }
  }

  // Evidence: the first resume line that mentions each term.
  const lines = sections
    .filter((s) => s.type === "experience" || s.type === "projects" || s.type === "skills")
    .flatMap((s) => (s.type === "skills" ? s.lines : parseEntries(s.lines, new Date()).flatMap((e) => e.bullets)));
  const evidence: Record<string, string> = {};
  for (const term of found.values()) {
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
    const hit = lines.find((l) => re.test(l));
    if (hit) evidence[term] = hit.length > 170 ? `${hit.slice(0, 167)}...` : hit;
  }
  return { terms: [...found.values()], evidence };
}

/* ---------- public API ---------- */

/** Rule-based, local-only parse. Derived data only; contact details are removed, the file is never kept. */
export function parseResume(text: string, now: Date = new Date()): ParsedResume {
  const sections = splitSections(text);
  const byType = (t: SectionType) => sections.filter((s) => s.type === t);

  const education = byType("education")
    .flatMap((s) => s.lines)
    .map(scrub)
    .filter((l) => /\b(B\.?S\.?|B\.?A\.?|Bachelor|Associate|A\.?S\.?|Master|M\.?S\.?|Ph\.?D|Diploma|Certificate)\b/i.test(l))
    .slice(0, 6);
  const hasBachelor = education.some((l) => /\b(B\.?S\.?|B\.?A\.?|Bachelor)/i.test(l));

  const experience = byType("experience").flatMap((s) => parseEntries(s.lines, now));
  const projects = byType("projects").flatMap((s) => parseEntries(s.lines, now));

  const related = byType("experience").filter((s) => /related|technical|cyber|security|information|it\b/i.test(s.heading));
  const relatedIv = related.flatMap((s) => parseEntries(s.lines, now).flatMap((e) => intervals(e.heading, now)));
  const relatedYears = relatedIv.length ? Math.round((unionMonths(relatedIv) / 12) * 10) / 10 : null;

  const certSection = byType("certifications").flatMap((s) => s.lines).map(scrub).filter(Boolean);
  const credentials = certSection.map((l) => l.replace(BULLET, "")).filter((l) => l.length > 3).slice(0, 12);

  const { terms, evidence } = extractTerms(sections, text);
  return {
    education, hasBachelor, experience, projects,
    certs: findCerts(text),
    credentials, terms, evidence, relatedYears,
  };
}

type Kind = "pdf" | "docx" | "txt";

function sniff(buf: Buffer, name: string): Kind | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf" && buf.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (ext === "docx" && buf[0] === 0x50 && buf[1] === 0x4b) return "docx"; // zip magic "PK"
  if (ext === "txt" && !buf.includes(0)) return "txt";
  return null;
}

/** Extracts plain text. Throws a safe, user-facing Error on bad input. */
export async function extractResumeText(buf: Buffer, name: string): Promise<string> {
  if (buf.length === 0 || buf.length > MAX_RESUME_BYTES) throw new Error("File must be under 2 MB");
  const kind = sniff(buf, name);
  if (!kind) throw new Error("Upload a PDF, DOCX, or TXT file");
  try {
    if (kind === "txt") return buf.toString("utf8");
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    }
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  } catch {
    throw new Error("Could not read that file");
  }
}
