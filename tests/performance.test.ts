import { describe, expect, it } from "vitest";
import { explainJob } from "../src/lib/explain";
import { applyFilters, facets, NO_FILTERS, sortJobs, DEFAULT_SORT } from "../src/lib/filters";
import { matchJob } from "../src/lib/match";
import type { Settings } from "../src/lib/settings";
import type { Profile, RawJob, StoredJob } from "../src/lib/types";

const profile: Profile = {
  queries: ["soc analyst"], localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 48, towns: ["akron"] },
  maxYearsExperience: 2, certsHeld: ["Security+"], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7,
  resumeSkills: ["Splunk", "Python", "Linux", "SIEM"], resumeHasBachelor: true,
};

const BLURB = "We are hiring an analyst to monitor alerts in our SIEM, triage incidents, and write Python scripts on Linux. Requires 2+ years of experience. Security+ preferred. This is a full-time position with a hybrid schedule. Bachelor's degree preferred. ";
function make(n: number): StoredJob[] {
  return Array.from({ length: n }, (_, i) => {
    const raw: RawJob = {
      source: "adzuna", externalId: String(i), title: ["SOC Analyst I", "Senior Security Engineer", "GRC Analyst", "Information Security Analyst II", "Vulnerability Analyst"][i % 5],
      company: `Company ${i % 80}`, location: i % 3 ? "Remote" : "Akron, OH", description: BLURB.repeat(10), url: `https://example.com/${i}`,
      postedAt: new Date(Date.now() - (i % 20) * 86_400_000).toISOString(), salaryMin: i % 2 ? 60_000 : undefined, salaryMax: i % 2 ? 80_000 : undefined,
    };
    return { ...raw, id: String(i).padStart(20, "0"), dedupeKey: "k" + i, firstSeen: new Date().toISOString(), status: "new", alsoSeenOn: [], match: matchJob(raw, profile) };
  });
}

const resume = {
  terms: Array.from({ length: 60 }, (_, i) => (i < 4 ? ["Splunk", "Python", "Linux", "SIEM"][i] : `Tool${i}`)),
  certs: ["Security+"], credentials: [], education: ["B.S. Cybersecurity"], hasBachelor: true, relatedYears: 2, experience: [], projects: [],
  evidence: { Splunk: "Used Splunk daily to triage alerts.", Python: "Wrote Python tools." }, updatedAt: "2026-01-01",
} as NonNullable<Settings["resume"]>;

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, Math.round(performance.now() - t0)];
}

describe("performance with a large list", () => {
  const jobs = make(3000);

  it("builds every filter menu and count for 3,000 openings quickly", () => {
    const [, ms] = time(() => facets(jobs));
    console.log(`facets(3000): ${ms} ms`);
    expect(ms).toBeLessThan(1500);
  });
  it("filters and sorts 3,000 openings quickly", () => {
    const [, ms] = time(() => sortJobs(applyFilters(jobs, { ...NO_FILTERS, setting: "remote", level: "entry" }), DEFAULT_SORT));
    console.log(`filter+sort(3000): ${ms} ms`);
    expect(ms).toBeLessThan(1000);
  });
  it("explains the 100 visible rows quickly", () => {
    const [, ms] = time(() => jobs.slice(0, 100).map((j) => explainJob(j, resume, profile)));
    console.log(`explain(100): ${ms} ms`);
    expect(ms).toBeLessThan(1500);
  });
  it("a whole page's work for 3,000 openings stays well under a second or two", () => {
    const [, ms] = time(() => {
      facets(jobs);
      const rows = sortJobs(applyFilters(jobs, NO_FILTERS), DEFAULT_SORT).slice(0, 100);
      return rows.map((j) => explainJob(j, resume, profile));
    });
    console.log(`full page(3000): ${ms} ms`);
    expect(ms).toBeLessThan(2500);
  });
});
