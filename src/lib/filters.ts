import {
  employmentTypesOf, JOB_TYPE_LABELS, levelOf, LEVEL_LABELS, PAY_OPTIONS, payOf, POSTED_OPTIONS, postedTime,
  SETTING_LABELS, workSettingOf, type EmploymentType, type WorkSetting,
} from "./attributes";
import { OTHER_ROLE, ROLE_TYPES, roleTypeOf, type ExperienceLevel } from "./match";
import type { StoredJob } from "./types";

// Dashboard filters, modelled on Indeed's: date posted, work setting, job type, experience level,
// pay, company. They only narrow what is shown; they never change what is fetched or saved.

export interface Filters {
  q: string; // words in the title or company
  posted: "" | "1" | "3" | "7" | "14";
  setting: "" | WorkSetting;
  jtype: "" | EmploymentType;
  level: "" | ExperienceLevel;
  pay: "" | "40000" | "60000" | "80000" | "100000";
  role: string; // our own category (SOC, GRC...), or ""
  fit: "" | "fit" | "stretch";
  company: string; // exact company name, or ""
}

export const NO_FILTERS: Filters = { q: "", posted: "", setting: "", jtype: "", level: "", pay: "", role: "", fit: "", company: "" };

const ROLE_IDS = new Set<string>([...ROLE_TYPES.map((r) => r.id), OTHER_ROLE.id]);
const pick = <T extends string>(v: string, allowed: readonly T[]): T | "" => (allowed as readonly string[]).includes(v) ? (v as T) : "";

type Params = Record<string, string | string[] | undefined>;
const one = (sp: Params, k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined)) ?? "";

/** Reads filters from URL parameters, accepting only known values. */
export function parseFilters(sp: Params): Filters {
  const role = one(sp, "role");
  return {
    q: one(sp, "q").trim().slice(0, 60),
    posted: pick(one(sp, "posted"), POSTED_OPTIONS.map((o) => o.value)),
    setting: pick(one(sp, "setting"), Object.keys(SETTING_LABELS) as WorkSetting[]),
    jtype: pick(one(sp, "jtype"), Object.keys(JOB_TYPE_LABELS) as EmploymentType[]),
    level: pick(one(sp, "level"), Object.keys(LEVEL_LABELS) as ExperienceLevel[]),
    pay: pick(one(sp, "pay"), PAY_OPTIONS.map((o) => o.value)),
    role: ROLE_IDS.has(role) ? role : "",
    fit: pick(one(sp, "fit"), ["fit", "stretch"] as const),
    company: one(sp, "company").trim().slice(0, 80),
  };
}

export const isFiltering = (f: Filters) => Object.values(f).some(Boolean);

export function applyFilters(jobs: StoredJob[], f: Filters, now = Date.now()): StoredJob[] {
  const q = f.q.toLowerCase();
  const posted = POSTED_OPTIONS.find((o) => o.value === f.posted);
  const pay = PAY_OPTIONS.find((o) => o.value === f.pay);
  return jobs.filter((j) => {
    if (q && !`${j.title} ${j.company}`.toLowerCase().includes(q)) return false;
    if (posted && postedTime(j) < now - posted.days * 86_400_000) return false;
    if (f.setting && workSettingOf(j) !== f.setting) return false;
    if (f.jtype && !employmentTypesOf(j).includes(f.jtype)) return false;
    if (f.level && levelOf(j) !== f.level) return false;
    if (pay) {
      const p = payOf(j);
      if (!p || p.max < pay.min) return false; // like Indeed, openings without listed pay drop out
    }
    if (f.role && roleTypeOf(j.title).id !== f.role) return false;
    if (f.fit && j.match.verdict !== f.fit) return false;
    if (f.company && j.company.toLowerCase() !== f.company.toLowerCase()) return false;
    return true;
  });
}

export interface Facet { value: string; label: string; count: number }

/** For each filter, how many of these jobs fall under each option. Drives the counts in the menus. */
export function facets(jobs: StoredJob[], now = Date.now()) {
  const count = (test: (j: StoredJob) => boolean) => jobs.filter(test).length;
  const companies = new Map<string, { label: string; count: number }>();
  for (const j of jobs) {
    const key = j.company.toLowerCase();
    const e = companies.get(key) ?? { label: j.company, count: 0 };
    e.count += 1;
    companies.set(key, e);
  }
  return {
    posted: POSTED_OPTIONS.map((o) => ({ value: o.value, label: o.label, count: count((j) => postedTime(j) >= now - o.days * 86_400_000) })),
    setting: (Object.keys(SETTING_LABELS) as WorkSetting[]).map((v) => ({ value: v, label: SETTING_LABELS[v], count: count((j) => workSettingOf(j) === v) })),
    jtype: (Object.keys(JOB_TYPE_LABELS) as EmploymentType[]).map((v) => ({ value: v, label: JOB_TYPE_LABELS[v], count: count((j) => employmentTypesOf(j).includes(v)) })),
    level: (Object.keys(LEVEL_LABELS) as ExperienceLevel[]).map((v) => ({ value: v, label: LEVEL_LABELS[v], count: count((j) => levelOf(j) === v) })),
    pay: PAY_OPTIONS.map((o) => ({ value: o.value, label: o.label, count: count((j) => (payOf(j)?.max ?? 0) >= o.min) })),
    role: roleCounts(jobs).map((r) => ({ value: r.id, label: r.label, count: r.count })),
    fit: [
      { value: "fit", label: "Fit", count: count((j) => j.match.verdict === "fit") },
      { value: "stretch", label: "Stretch", count: count((j) => j.match.verdict === "stretch") },
    ],
    company: [...companies.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 15).map((c) => ({ value: c.label, label: c.label, count: c.count })),
  } satisfies Record<string, Facet[]>;
}

/** How many of these jobs fall under each of our own job categories (only those that are present). */
export function roleCounts(jobs: StoredJob[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, { id: string; label: string; count: number }>();
  for (const j of jobs) {
    const r = roleTypeOf(j.title);
    const e = counts.get(r.id) ?? { ...r, count: 0 };
    e.count += 1;
    counts.set(r.id, e);
  }
  const order = [...ROLE_TYPES.map((r) => r.id), OTHER_ROLE.id] as string[];
  return [...counts.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/* ---------- sorting ---------- */

export type SortKey = "score" | "newest" | "company" | "title";
export type SortDir = "asc" | "desc";
export interface Sort { key: SortKey; dir: SortDir }

export const DEFAULT_SORT: Sort = { key: "score", dir: "desc" };
const SORT_KEYS: readonly SortKey[] = ["score", "newest", "company", "title"];

export function parseSort(sp: Params): Sort {
  const key = SORT_KEYS.find((k) => k === one(sp, "sort")) ?? DEFAULT_SORT.key;
  const d = one(sp, "dir");
  const dir: SortDir = d === "asc" || d === "desc" ? d : key === "company" || key === "title" ? "asc" : "desc";
  return { key, dir };
}

/** Clicking the active column flips its direction; a new column starts in its natural direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "company" || key === "title" ? "asc" : "desc" };
}

/** Returns a sorted copy. Ties fall back to best match, then newest. */
export function sortJobs(jobs: StoredJob[], s: Sort, timeOf: (j: StoredJob) => number = postedTime): StoredJob[] {
  const sign = s.dir === "asc" ? 1 : -1;
  const by = (a: StoredJob, b: StoredJob): number => {
    switch (s.key) {
      case "score": return a.match.score - b.match.score;
      case "newest": return timeOf(a) - timeOf(b);
      case "company": return a.company.localeCompare(b.company, undefined, { sensitivity: "base" });
      case "title": return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    }
  };
  return [...jobs].sort((a, b) => sign * by(a, b) || b.match.score - a.match.score || timeOf(b) - timeOf(a));
}
