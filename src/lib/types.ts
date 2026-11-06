import { z } from "zod";

export const profileSchema = z.object({
  queries: z.array(z.string().min(1).max(80)).min(1).max(20),
  localArea: z.object({
    label: z.string(),
    adzunaWhere: z.string(),
    distanceKm: z.number().int().min(1).max(200),
    towns: z.array(z.string().min(1)),
  }),
  maxYearsExperience: z.number().int().min(0).max(20),
  certsHeld: z.array(z.string()),
  // Board tokens are interpolated into URLs, so restrict to a safe allowlist pattern.
  greenhouseBoards: z.array(z.string().regex(/^[a-z0-9_-]{1,64}$/i)),
  leverCompanies: z.array(z.string().regex(/^[a-z0-9_-]{1,64}$/i)),
  maxDaysOld: z.number().int().min(1).max(60),
  // Skills found in the resume; filled from saved settings, not from profile.json.
  resumeSkills: z.array(z.string()).default([]),
  resumeHasBachelor: z.boolean().default(false),
});
export type Profile = z.infer<typeof profileSchema>;

/** A listing as returned by a source, before matching. Untrusted data. */
export interface RawJob {
  source: "adzuna" | "greenhouse" | "lever" | "import";
  externalId: string;
  title: string;
  company: string;
  location: string;
  description: string; // plain text, may be a truncated snippet
  url: string;
  postedAt: string | null; // ISO
  nearQuery?: boolean; // returned by a location-limited search (source already checked distance)
  contractType?: string; // Adzuna: "permanent" or "contract"
  contractTime?: string; // Adzuna: "full_time" or "part_time"
  salaryMin?: number; // yearly, USD
  salaryMax?: number;
  salaryEstimated?: boolean; // Adzuna predicted the pay; the employer did not state it
}

export interface JobSource {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}

export type Verdict = "fit" | "stretch" | "mismatch";
export type Status = "new" | "seen" | "saved" | "applied" | "dismissed";
export const STATUSES: readonly Status[] = ["new", "seen", "saved", "applied", "dismissed"];

export interface MatchResult {
  relevant: boolean; // title looks like a target role
  locationOk: boolean;
  locationType: "remote" | "local" | "other";
  score: number; // 0-100
  verdict: Verdict;
  reasons: string[]; // why it matched
  gaps: string[]; // obvious gaps
  yearsRequired: number | null;
  certsRequired: string[];
  certsPreferred: string[];
}

export interface StoredJob extends RawJob {
  id: string;
  dedupeKey: string;
  firstSeen: string;
  status: Status;
  appliedAt?: string; // ISO date you applied (set when status becomes Applied, or imported)
  imported?: boolean; // added by you through Import, not found by a check
  match: MatchResult;
  alsoSeenOn: string[];
}

export interface RunRecord {
  at: string;
  fetched: number;
  added: number;
  errors: string[];
  emailed: boolean | "skipped";
}

export interface StoreData {
  jobs: Record<string, StoredJob>;
  runs: RunRecord[];
  recoveredFrom?: string; // set when an unreadable list was moved aside and the app started fresh
}
