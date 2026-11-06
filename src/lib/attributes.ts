import { experienceLevelOf, type ExperienceLevel } from "./match";
import type { StoredJob } from "./types";

// Facts about an opening that Indeed-style filters use. All derived from what the posting and the
// source actually say; when something is not stated, the answer is "unknown" (never guessed).

export type WorkSetting = "remote" | "hybrid" | "onsite";
export type EmploymentType = "fulltime" | "parttime" | "contract" | "internship" | "temporary";

export const SETTING_LABELS: Record<WorkSetting, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const JOB_TYPE_LABELS: Record<EmploymentType, string> = {
  fulltime: "Full-time", parttime: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary",
};
export const LEVEL_LABELS: Record<ExperienceLevel, string> = { entry: "Entry level", mid: "Mid level", senior: "Senior level" };

/** Days, as offered under "Date posted". */
export const POSTED_OPTIONS = [
  { value: "1", label: "Last 24 hours", days: 1 },
  { value: "3", label: "Last 3 days", days: 3 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "14", label: "Last 14 days", days: 14 },
] as const;

/** Minimum yearly pay thresholds, as offered under "Pay". */
export const PAY_OPTIONS = [
  { value: "40000", label: "$40,000+", min: 40_000 },
  { value: "60000", label: "$60,000+", min: 60_000 },
  { value: "80000", label: "$80,000+", min: 80_000 },
  { value: "100000", label: "$100,000+", min: 100_000 },
] as const;

export function workSettingOf(j: StoredJob): WorkSetting {
  if (j.match.locationType === "remote") return "remote";
  if (/\bhybrid\b/i.test(`${j.title}\n${j.location}\n${j.description}`)) return "hybrid";
  return "onsite";
}

/** Zero or more types. Empty means the posting does not say. */
export function employmentTypesOf(j: StoredJob): EmploymentType[] {
  const title = j.title.toLowerCase();
  const text = `${j.title}\n${j.description}`.toLowerCase();
  const out = new Set<EmploymentType>();
  if (j.contractTime === "full_time" || /full[- ]time/.test(text)) out.add("fulltime");
  if (j.contractTime === "part_time" || /part[- ]time/.test(text)) out.add("parttime");
  if (
    j.contractType === "contract" ||
    /\bcontract(or)?\b/.test(title) ||
    /(contract|c2h)[- ](position|role|to[- ]hire|opportunity)|w-?2 contract|\d+[- ]month contract/.test(text)
  ) out.add("contract");
  if (/\bintern(ship)?\b/.test(title)) out.add("internship");
  if (/\btemp(orary)?\b/.test(title) || /temp(orary)?[- ]to[- ]hire/.test(text)) out.add("temporary");
  return [...out];
}

export function levelOf(j: StoredJob): ExperienceLevel | null {
  return experienceLevelOf(j.title, `${j.title}\n${j.description}`, j.match.yearsRequired);
}

/** When it was posted: the source's date if valid, otherwise when we first saw it. */
export function postedTime(j: StoredJob): number {
  const posted = j.postedAt ? new Date(j.postedAt).getTime() : NaN;
  return Number.isFinite(posted) ? posted : new Date(j.firstSeen).getTime();
}

export function payOf(j: StoredJob): { min: number; max: number; estimated: boolean } | null {
  const lo = j.salaryMin ?? j.salaryMax;
  const hi = j.salaryMax ?? j.salaryMin;
  if (lo == null || hi == null) return null;
  return { min: Math.min(lo, hi), max: Math.max(lo, hi), estimated: j.salaryEstimated === true };
}

const k = (n: number) => `$${Math.round(n / 1000)}K`;

/** For example "$62K to $75K (estimated)". Empty when the pay is not listed. */
export function payLabel(j: StoredJob): string {
  const p = payOf(j);
  if (!p) return "";
  const range = p.min === p.max || Math.abs(p.max - p.min) < 1000 ? k(p.max) : `${k(p.min)} to ${k(p.max)}`;
  return p.estimated ? `${range} (estimated)` : range;
}
