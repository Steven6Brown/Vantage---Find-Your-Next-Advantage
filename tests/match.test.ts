import { describe, expect, it } from "vitest";
import { extractCerts, extractYears, matchJob, normalizeForDedupe } from "../src/lib/match";
import type { Profile, RawJob } from "../src/lib/types";

const profile: Profile = {
  queries: ["soc analyst"],
  localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 50, towns: ["akron", "cuyahoga falls"] },
  maxYearsExperience: 2,
  certsHeld: [],
  greenhouseBoards: [],
  leverCompanies: [],
  maxDaysOld: 7,
  resumeSkills: [],
  resumeHasBachelor: false,
};

const job = (o: Partial<RawJob>): RawJob => ({
  source: "adzuna", externalId: "1", title: "SOC Analyst I", company: "Acme", location: "Akron, OH",
  description: "Monitor alerts.", url: "https://example.com/1", postedAt: null, ...o,
});

describe("matchJob", () => {
  it("rates an entry-level local SOC role as a fit", () => {
    const m = matchJob(job({}), profile);
    expect(m.verdict).toBe("fit");
    expect(m.locationType).toBe("local");
  });
  it("accepts remote roles", () => {
    expect(matchJob(job({ location: "Remote, US" }), profile).locationType).toBe("remote");
  });
  it("rejects out-of-area on-site roles", () => {
    const m = matchJob(job({ location: "Austin, TX" }), profile);
    expect(m.verdict).toBe("mismatch");
  });
  it("flags senior titles as mismatches", () => {
    const m = matchJob(job({ title: "Senior Security Engineer" }), profile);
    expect(m.verdict).toBe("mismatch");
    expect(m.gaps.join()).toMatch(/Senior/);
  });
  it("flags a required cert the candidate lacks", () => {
    const m = matchJob(job({ description: "CISSP certification is required." }), profile);
    expect(m.verdict).toBe("mismatch");
    expect(m.gaps.join()).toMatch(/CISSP/);
  });
  it("does not flag a cert the candidate holds", () => {
    const m = matchJob(job({ description: "Security+ required." }), { ...profile, certsHeld: ["Security+"] });
    expect(m.verdict).toBe("fit");
  });
  it("treats preferred certs as a soft note", () => {
    const m = matchJob(job({ description: "Security+ preferred." }), profile);
    expect(m.verdict).toBe("fit");
    expect(m.certsPreferred).toContain("Security+");
  });
  it("flags years above the profile maximum", () => {
    const m = matchJob(job({ description: "Requires 5+ years of experience in security." }), profile);
    expect(m.yearsRequired).toBe(5);
    expect(m.verdict).toBe("mismatch");
  });
  it("excludes physical security roles", () => {
    expect(matchJob(job({ title: "Security Officer" }), profile).relevant).toBe(false);
  });
});

describe("helpers", () => {
  it("uses the minimum of a year range", () => expect(extractYears("3-5 years of experience")).toBe(3));
  it("ignores preferred years", () => expect(extractYears("2 years experience preferred")).toBeNull());
  it("splits required and preferred certs", () => {
    const c = extractCerts("CISSP required. Security+ is a plus.");
    expect(c.required).toEqual(["CISSP"]);
    expect(c.preferred).toEqual(["Security+"]);
  });
  it("normalizes company suffixes for dedupe", () => {
    expect(normalizeForDedupe("Acme, Inc.")).toBe(normalizeForDedupe("ACME LLC"));
  });
});
