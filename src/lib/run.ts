import { sendDigest } from "./digest";
import { dedupeKeyOf, jobIdOf, sameArea } from "./ids";
import { matchJob } from "./match";
import { adzunaSource } from "./sources/adzuna";
import { greenhouseSource, leverSource } from "./sources/ats";
import { getProfile, type LocationSetting } from "./settings";
import { withStore } from "./store";
import type { JobSource, Profile, RawJob, RunRecord, StoredJob } from "./types";


/** Raised when a check cannot start right now. `status` is the HTTP code to answer with. */
export class RunBlocked extends Error {
  constructor(message: string, public status: 409 | 429, public retryAfterSeconds = 0) {
    super(message);
  }
}

const MIN_GAP_MS = 30_000; // each check spends a limited number of search requests, so repeats are spaced out
let running = false;
let lastStart = 0;

/** Starts a check only if none is running and the last one was not just now. Call release() when done. */
export function claimRun(now = Date.now()): () => void {
  if (running) throw new RunBlocked("A check is already running. It should finish in a few seconds.", 409);
  const wait = lastStart + MIN_GAP_MS - now;
  if (lastStart && wait > 0) throw new RunBlocked(`A check just ran. Wait ${Math.ceil(wait / 1000)} seconds before running another.`, 429, Math.ceil(wait / 1000));
  running = true;
  lastStart = now;
  return () => { running = false; };
}

/** For tests. */
export function resetRunGuard() { running = false; lastStart = 0; }

/**
 * Pay and job type may be missing on listings saved before those fields were captured.
 * Fill them in when the same source reports them again. Never overwrites a value already saved.
 */
export function enrichExisting(existing: StoredJob, r: RawJob): void {
  if (existing.source !== r.source) return;
  existing.contractType ??= r.contractType;
  existing.contractTime ??= r.contractTime;
  existing.salaryMin ??= r.salaryMin;
  existing.salaryMax ??= r.salaryMax;
  existing.salaryEstimated ??= r.salaryEstimated;
}

export function buildSources(profile: Profile): { sources: JobSource[]; warnings: string[] } {
  const sources: JobSource[] = [];
  const warnings: string[] = [];
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
  if (id && key) sources.push(adzunaSource(profile, id, key));
  else warnings.push("Adzuna skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
  profile.greenhouseBoards.forEach((b) => sources.push(greenhouseSource(b)));
  profile.leverCompanies.forEach((c) => sources.push(leverSource(c)));
  return { sources, warnings };
}

/** Fetch -> match -> dedupe -> persist -> digest. Source failures are isolated. */
export async function runCheck(sources?: JobSource[], location?: LocationSetting): Promise<RunRecord> {
  const profile = await getProfile(location);
  const built = sources ? { sources, warnings: [] as string[] } : buildSources(profile);
  const errors = [...built.warnings];

  const settled = await Promise.allSettled(built.sources.map((s) => s.fetchJobs()));
  const raw: RawJob[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else errors.push(`${built.sources[i].name}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
  });

  const now = new Date().toISOString();
  const added: StoredJob[] = [];

  await withStore((data) => {
    const byKey = new Map<string, StoredJob>();
    const importedByCompanyTitle = new Map<string, StoredJob[]>();
    for (const j of Object.values(data.jobs)) {
      byKey.set(j.dedupeKey, j);
      if (j.imported) {
        const ct = dedupeKeyOf(j.company, j.title, "");
        importedByCompanyTitle.set(ct, [...(importedByCompanyTitle.get(ct) ?? []), j]);
      }
    }

    for (const r of raw) {
      const id = jobIdOf(r.source, r.externalId);
      const dedupeKey = dedupeKeyOf(r.company, r.title, r.location);
      // A job you imported may spell its place differently, so match it by company and title in a compatible place.
      const existing =
        data.jobs[id] ??
        byKey.get(dedupeKey) ??
        importedByCompanyTitle.get(dedupeKeyOf(r.company, r.title, ""))?.find((j) => sameArea(r.location, j.location));
      if (existing) {
        if (existing.source !== r.source && !existing.alsoSeenOn.includes(r.source)) {
          existing.alsoSeenOn.push(r.source);
        }
        enrichExisting(existing, r);
        continue;
      }
      const match = matchJob(r, profile);
      // Unrelated roles (e.g. all openings from a company board) are not stored at all.
      if (!match.relevant) continue;
      const job: StoredJob = { ...r, id, dedupeKey, firstSeen: now, status: "new", match, alsoSeenOn: [] };
      data.jobs[id] = job;
      byKey.set(dedupeKey, job);
      added.push(job);
    }
  });

  const worthEmailing = added
    .filter((j) => j.match.verdict !== "mismatch")
    .sort((a, b) => b.match.score - a.match.score);
  let emailed: RunRecord["emailed"] = "skipped";
  try {
    emailed = await sendDigest(worthEmailing);
  } catch {
    emailed = false;
    errors.push("Email digest failed to send");
  }

  const record: RunRecord = { at: now, fetched: raw.length, added: added.length, errors, emailed };
  await withStore((data) => {
    data.runs.push(record);
  });
  return record;
}
