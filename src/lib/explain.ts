import { findCerts, findSkills } from "./match";
import type { Settings } from "./settings";
import type { Profile, StoredJob } from "./types";

// Builds the "why this job" breakdown from the same rule-based facts used for scoring.
// Every claim is paired with evidence: a resume line and the posting's own wording.

/** A piece of text; `hit` marks the matched term so it can be highlighted. */
export interface Segment {
  text: string;
  hit?: boolean;
}

export interface ResumeMatch {
  term: string;
  resumeLine: Segment[]; // a line from your resume that mentions it (empty if none)
  postingSnippet: Segment[]; // the posting's wording around it
}

export interface JobExplanation {
  verdict: "fit" | "stretch" | "mismatch" | "imported";
  verdictLabel: string;
  note?: string; // your own notes, for applications you imported
  summary: string; // one plain sentence
  bluf: string; // verdict + summary, kept for plain-text uses
  why: string[];
  hasResume: boolean;
  resumeMatches: ResumeMatch[];
  matchedCount: number;
  resumeEntries: string[];
  degree: string | null;
  certsMatched: string[];
  watchOuts: string[];
  notStated: string[];
  partialText: boolean;
}

type Resume = NonNullable<Settings["resume"]>;

const LABEL = { fit: "Fit", stretch: "Stretch", mismatch: "Likely mismatch" } as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Plain text of a list of segments. */
export const segmentsText = (s: Segment[]) => s.map((x) => x.text).join("");

/**
 * A short excerpt around the first mention of `term`: starts and ends on a sentence or word boundary
 * (never mid-word), and marks the term itself so it can be highlighted.
 */
export function excerpt(text: string, term: string, radius = 120): Segment[] {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = new RegExp(`(^|[^a-z0-9])(${escapeRe(term)})(?=$|[^a-z0-9])`, "i").exec(flat);
  if (!m) return flat ? [{ text: flat.length > radius * 2 ? `${flat.slice(0, radius * 2).replace(/\s+\S*$/, "")}…` : flat }] : [];
  const at = m.index + m[1].length;
  const end = at + term.length;

  // Start: the beginning of the sentence if it is close, otherwise the nearest word boundary.
  let start = Math.max(0, at - radius);
  const before = flat.slice(start, at);
  const sentence = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "), before.lastIndexOf("; "));
  if (sentence >= 0) start += sentence + 2;
  else if (start > 0) {
    const sp = flat.indexOf(" ", start);
    start = sp >= 0 && sp < at ? sp + 1 : start;
  }

  // End: the end of the sentence if it is close, otherwise the nearest word boundary.
  let stop = Math.min(flat.length, end + radius);
  const after = flat.slice(end, stop);
  const punct = after.search(/[.!?](\s|$)/);
  if (punct >= 0) stop = end + punct + 1;
  else if (stop < flat.length) {
    const sp = flat.lastIndexOf(" ", stop);
    stop = sp > end ? sp : stop;
  }

  const lead = start > 0 && !/[.!?;]\s$/.test(flat.slice(Math.max(0, start - 2), start)) ? "…" : "";
  const tail = stop < flat.length && !/[.!?]$/.test(flat.slice(0, stop)) ? "…" : "";
  const segs: Segment[] = [];
  const pre = `${lead}${flat.slice(start, at)}`;
  if (pre) segs.push({ text: pre });
  segs.push({ text: flat.slice(at, end), hit: true });
  const post = `${flat.slice(end, stop)}${tail}`;
  if (post) segs.push({ text: post });
  return segs;
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function explainJob(job: StoredJob, resume: Resume | null, profile: Profile): JobExplanation {
  if (job.imported) {
    return {
      verdict: "imported", verdictLabel: "Imported",
      summary: "You added this application yourself, so Vantage has not scored it.",
      bluf: "Imported: you added this application yourself.",
      why: [], hasResume: resume !== null, resumeMatches: [], matchedCount: 0, resumeEntries: [], degree: null, certsMatched: [],
      watchOuts: [], notStated: [], partialText: false, ...(job.description ? { note: job.description } : {}),
    };
  }
  const m = job.match;
  const text = `${job.title}\n${job.description}`;

  const matched = resume ? findSkills(text, resume.terms) : [];
  const resumeMatches: ResumeMatch[] = matched
    .map((term) => {
      const line = resume?.evidence[term] ?? "";
      return { term, resumeLine: line ? excerpt(line, term, 90) : [], postingSnippet: excerpt(text, term, 110) };
    })
    // Terms with a resume line to show come first; they're the strongest evidence.
    .sort((a, b) => Number(b.resumeLine.length > 0) - Number(a.resumeLine.length > 0))
    .slice(0, 8);

  const entries = resume
    ? [...resume.experience, ...resume.projects]
        .filter((e) => matched.length && findSkills(`${e.heading}\n${e.bullets.join("\n")}`, matched).length)
        .map((e) => shorten(e.heading || "Untitled entry", 90))
        .slice(0, 3)
    : [];

  const wantsBachelor = /\bbachelor|\bb\.?s\.? (degree|in)\b|four[- ]year degree/i.test(text);
  const degree = resume?.hasBachelor && wantsBachelor ? (resume.education[0] ?? "Bachelor's degree") : null;

  const held = new Set(profile.certsHeld.map((c) => c.toLowerCase()));
  const certsMatched = findCerts(text).filter((c) => held.has(c.toLowerCase()));

  const entryLevel = m.reasons.some((r) => r.startsWith("Entry-level"));
  const required = m.gaps.filter((g) => !g.startsWith("Preferred"));
  const bits = [
    m.locationType === "remote" ? "remote" : m.locationType === "local" ? "in your area" : "outside your area",
    ...(entryLevel ? ["entry-level wording"] : []),
    resume
      ? matched.length
        ? `${matched.length} of your skills appear in the posting`
        : "none of your resume skills appear in the posting text"
      : "no resume uploaded yet",
    required.length ? `${required.length} gap${required.length === 1 ? "" : "s"} (${required[0]})` : "no required gaps",
  ];

  const notStated: string[] = [];
  if (m.yearsRequired === null) notStated.push("Years of experience");
  if (!m.certsRequired.length && !m.certsPreferred.length) notStated.push("Certifications");

  const summary = `${bits.join("; ")}.`.replace(/^./, (c) => c.toUpperCase());
  return {
    verdict: m.verdict,
    verdictLabel: LABEL[m.verdict],
    summary,
    bluf: `${LABEL[m.verdict]}: ${bits.join("; ")}.`,
    why: m.reasons.filter((r) => !r.startsWith("Matches your resume") && !r.startsWith("Asks for a bachelor")),
    hasResume: resume !== null,
    resumeMatches,
    matchedCount: matched.length,
    resumeEntries: entries,
    degree,
    certsMatched,
    watchOuts: m.gaps,
    notStated,
    partialText: job.source === "adzuna",
  };
}
