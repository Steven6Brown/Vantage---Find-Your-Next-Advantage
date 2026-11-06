import { z } from "zod";
import { clean, cleanUrl, LIMITS, parseDate } from "./importer";
import { dedupeKeyOf, jobIdOf, sameArea, urlKeyOf } from "./ids";
import { matchJob } from "./match";
import { readStore, withStore } from "./store";
import type { Profile, RawJob, StoreData, StoredJob } from "./types";

// Brings applications you made elsewhere into your list, marked Applied. Rows are validated here, at the
// trust boundary: nothing the browser sends is trusted, and the same checks run for a preview and a real import.

export const MAX_ROWS = 500;
export const MAX_JOBS = 10_000;

export const importRowSchema = z.object({
  title: z.string().max(LIMITS.title * 2),
  company: z.string().max(LIMITS.company * 2).default(""),
  location: z.string().max(LIMITS.location * 2).default(""),
  url: z.string().max(LIMITS.url + 100).default(""),
  appliedAt: z.string().max(60).nullable().default(null),
  notes: z.string().max(LIMITS.notes * 2).default(""),
});
export const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(MAX_ROWS),
  dryRun: z.boolean().optional(),
});
export type ImportBody = z.infer<typeof importBodySchema>;

export type Outcome = "new" | "update" | "unchanged" | "invalid";
export interface RowResult { index: number; outcome: Outcome; title: string; company: string; reason: string }
export interface ImportSummary { results: RowResult[]; added: number; updated: number; unchanged: number; invalid: number }

/** An ISO date that is a real day between 2000 and a couple of days from now, else null. */
function validDate(s: string | null, now: Date): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now.getTime() + 2 * 86_400_000) return parseDate(s, now);
  return new Date(t).toISOString();
}

/** Applies rows to `data` in place. Used on a copy for the preview and on the real list for the import. */
export function applyRows(data: StoreData, rows: ImportBody["rows"], profile: Profile, now: Date = new Date(), preview = false): ImportSummary {
  // Wording: a preview says what will happen, the real import says what happened.
  const say = (done: string, will: string) => (preview ? will : done);
  const nowIso = now.toISOString();
  const byDedupe = new Map<string, StoredJob>();
  const byUrl = new Map<string, StoredJob>();
  const byCompanyTitle = new Map<string, StoredJob[]>();
  const index = (j: StoredJob) => {
    byDedupe.set(j.dedupeKey, j);
    const u = j.url ? urlKeyOf(j.url) : "";
    if (u) byUrl.set(u, j);
    const ct = dedupeKeyOf(j.company, j.title, "");
    byCompanyTitle.set(ct, [...(byCompanyTitle.get(ct) ?? []), j]);
  };
  for (const j of Object.values(data.jobs)) index(j);

  const out: ImportSummary = { results: [], added: 0, updated: 0, unchanged: 0, invalid: 0 };
  let total = Object.keys(data.jobs).length;

  rows.forEach((row, i) => {
    const title = clean(row.title, LIMITS.title);
    const company = clean(row.company, LIMITS.company);
    const location = clean(row.location, LIMITS.location);
    const url = cleanUrl(row.url);
    const notes = clean(row.notes, LIMITS.notes);
    const shown = { index: i, title: title || "(no title)", company: company || "Not listed" };
    const done = (outcome: Outcome, reason: string) => {
      out.results.push({ ...shown, outcome, reason });
      if (outcome === "new") out.added++;
      else if (outcome === "update") out.updated++;
      else if (outcome === "unchanged") out.unchanged++;
      else out.invalid++;
    };

    if (!title) return done("invalid", "No job title");
    const given = row.appliedAt;
    const applied = validDate(given, now);
    const dateNote = given && !applied ? " The date was not understood, so today's date is used." : "";

    const uKey = url ? urlKeyOf(url) : "";
    const dKey = dedupeKeyOf(company, title, location);
    let match: StoredJob | undefined = (uKey && byUrl.get(uKey)) || byDedupe.get(dKey) || undefined;
    if (!match) {
      // Same company and title in a compatible place (or no place on one side): the same opening.
      match = (byCompanyTitle.get(dedupeKeyOf(company, title, "")) ?? []).find((j) => sameArea(location, j.location));
    }

    if (match) {
      if (match.status !== "applied") {
        match.status = "applied";
        match.appliedAt = applied ?? nowIso;
        return done("update", say("Already in your list. Marked as applied.", "Already in your list. Will be marked as applied.") + dateNote);
      }
      if (applied && !match.appliedAt) {
        match.appliedAt = applied;
        return done("update", say("Already marked as applied. Added the date.", "Already marked as applied. The date will be added."));
      }
      return done("unchanged", "Already in your list as applied.");
    }

    if (total >= MAX_JOBS) return done("invalid", "Your list is full");
    const externalId = uKey || dKey;
    const id = jobIdOf("import", externalId);
    if (data.jobs[id]) return done("unchanged", "Already in your list as applied.");
    const raw: RawJob = { source: "import", externalId, title, company: company || "Not listed", location, description: notes, url, postedAt: applied };
    const job: StoredJob = {
      ...raw, id, dedupeKey: dKey, firstSeen: applied ?? nowIso, status: "applied", appliedAt: applied ?? nowIso,
      imported: true, match: matchJob(raw, profile), alsoSeenOn: [],
    };
    data.jobs[id] = job;
    index(job);
    total++;
    done("new", say("Added as applied.", "Will be added as applied.") + dateNote);
  });
  return out;
}

/** The preview: works out what an import would do without saving anything. */
export async function previewImport(rows: ImportBody["rows"], profile: Profile, now?: Date): Promise<ImportSummary> {
  const data = structuredClone(await readStore());
  return applyRows(data, rows, profile, now, true);
}

/** The real import: one saved change, applied in order with every other change to the list. */
export function commitImport(rows: ImportBody["rows"], profile: Profile, now?: Date): Promise<ImportSummary> {
  return withStore((data) => applyRows(data, rows, profile, now));
}
