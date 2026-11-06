import { describe, expect, it } from "vitest";
import { employmentTypesOf, levelOf, payLabel, postedTime, workSettingOf } from "../src/lib/attributes";
import { applyFilters, DEFAULT_SORT, facets, isFiltering, NO_FILTERS, nextSort, parseFilters, parseSort, roleCounts, sortJobs } from "../src/lib/filters";
import { matchJob, roleTypeOf } from "../src/lib/match";
import { queriesSchema } from "../src/lib/settings";
import type { Profile, RawJob, StoredJob } from "../src/lib/types";

const NOW = Date.parse("2026-02-10T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const profile: Profile = {
  queries: ["soc analyst"],
  localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 48, towns: ["akron"] },
  maxYearsExperience: 2, certsHeld: [], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7,
  resumeSkills: [], resumeHasBachelor: false,
};

let n = 0;
function job(title: string, o: Partial<RawJob> = {}): StoredJob {
  n += 1;
  const raw: RawJob = {
    source: "adzuna", externalId: String(n), title, company: "Acme", location: "Remote",
    description: "Monitor alerts.", url: "https://example.com/" + n, postedAt: ago(1), ...o,
  };
  return { ...raw, id: String(n).padStart(20, "0"), dedupeKey: "k" + n, firstSeen: ago(1), status: "new", alsoSeenOn: [], match: matchJob(raw, profile) };
}
const names = (js: StoredJob[]) => js.map((j) => j.title).sort();

describe("roleTypeOf", () => {
  it.each([
    ["SOC Analyst I", "soc"], ["Cyber Security Operations Analyst", "soc"], ["Information Security Analyst", "soc"],
    ["Remote GRC Analyst", "grc"], ["Compliance Analyst, Security", "grc"],
    ["Security Engineer", "engineer"], ["Cloud Security Engineer", "engineer"],
    ["Vulnerability Management Analyst", "vuln"], ["Hardware Security and Vulnerability Analyst", "vuln"], ["Penetration Tester", "vuln"],
    ["Incident Response Analyst", "ir"], ["Threat Intelligence Analyst", "ir"], ["IT Security Coordinator", "other"],
  ])("%s -> %s", (title, id) => expect(roleTypeOf(title).id).toBe(id));
});

describe("work setting", () => {
  it("is remote when the opening is remote", () => expect(workSettingOf(job("SOC Analyst", { location: "Remote, US" }))).toBe("remote"));
  it("is hybrid when the posting says hybrid", () => {
    expect(workSettingOf(job("SOC Analyst", { location: "Akron, OH", description: "This is a hybrid role, 3 days on site." }))).toBe("hybrid");
  });
  it("is on-site otherwise", () => expect(workSettingOf(job("SOC Analyst", { location: "Austin, TX" }))).toBe("onsite"));
});

describe("job type", () => {
  it("uses the source's fields", () => {
    expect(employmentTypesOf(job("Analyst", { contractTime: "full_time", contractType: "permanent" }))).toEqual(["fulltime"]);
    expect(employmentTypesOf(job("Analyst", { contractTime: "part_time" }))).toEqual(["parttime"]);
    expect(employmentTypesOf(job("Analyst", { contractType: "contract" }))).toEqual(["contract"]);
  });
  it("reads the title and wording when the source says nothing", () => {
    expect(employmentTypesOf(job("Security Analyst - 3 Years Contract"))).toContain("contract");
    expect(employmentTypesOf(job("Security Intern"))).toContain("internship");
    expect(employmentTypesOf(job("Analyst", { description: "This is a full-time position." }))).toContain("fulltime");
    expect(employmentTypesOf(job("Analyst", { description: "Temp-to-hire opportunity." }))).toContain("temporary");
  });
  it("does not guess when nothing is stated", () => expect(employmentTypesOf(job("Security Analyst"))).toEqual([]));
  it("does not treat the word contract in unrelated wording as a contract job", () => {
    expect(employmentTypesOf(job("Security Analyst", { description: "Review contractual obligations with vendors." }))).toEqual([]);
  });
});

describe("experience level", () => {
  it.each([
    ["Senior Security Engineer", "Build things.", "senior"],
    ["Security Analyst", "Requires 6+ years of experience.", "senior"],
    ["Security Analyst II", "Monitor alerts.", "mid"],
    ["Security Analyst", "Requires 3+ years of experience.", "mid"],
    ["SOC Analyst I", "Monitor alerts.", "entry"],
    ["Security Analyst", "This is an entry-level role.", "entry"],
  ])("%s / %s -> %s", (title, description, level) => expect(levelOf(job(title, { description }))).toBe(level));
  it("is unknown when the posting gives no signal", () => expect(levelOf(job("Security Analyst"))).toBeNull());
});

describe("pay and dates", () => {
  it("formats a range, a single figure and an estimate", () => {
    expect(payLabel(job("A", { salaryMin: 62_000, salaryMax: 75_000 }))).toBe("$62K to $75K");
    expect(payLabel(job("A", { salaryMin: 90_000, salaryMax: 90_000 }))).toBe("$90K");
    expect(payLabel(job("A", { salaryMin: 62_000, salaryMax: 75_000, salaryEstimated: true }))).toBe("$62K to $75K (estimated)");
  });
  it("is empty when pay is not listed", () => expect(payLabel(job("A"))).toBe(""));
  it("uses the posting date, falling back to when it was first seen", () => {
    expect(postedTime(job("A", { postedAt: ago(5) }))).toBe(NOW - 5 * DAY);
    const j = job("A", { postedAt: null });
    expect(postedTime(j)).toBe(new Date(j.firstSeen).getTime());
    expect(postedTime(job("A", { postedAt: "not a date" }))).toBe(new Date(ago(1)).getTime());
  });
});

describe("parseFilters", () => {
  it("accepts known values only", () => {
    const f = parseFilters({ q: "  acme ", posted: "7", setting: "remote", jtype: "contract", level: "entry", pay: "60000", role: "grc", fit: "stretch", company: " Acme " });
    expect(f).toEqual({ q: "acme", posted: "7", setting: "remote", jtype: "contract", level: "entry", pay: "60000", role: "grc", fit: "stretch", company: "Acme" });
  });
  it("drops anything unexpected", () => {
    const f = parseFilters({ posted: "9999", setting: "mars", jtype: "<script>", level: "god", pay: "1", role: "x", fit: "nope", q: "x".repeat(200) });
    expect(f).toEqual({ ...NO_FILTERS, q: "x".repeat(60) });
  });
  it("takes the first value when a parameter repeats", () => expect(parseFilters({ role: ["soc", "grc"] }).role).toBe("soc"));
  it("knows when nothing is being filtered", () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, pay: "40000" })).toBe(true);
  });
});

describe("applyFilters", () => {
  const jobs = [
    job("SOC Analyst I", { company: "Alpha", postedAt: ago(0.5), contractTime: "full_time", salaryMin: 60_000, salaryMax: 72_000 }),
    job("Remote GRC Analyst", { company: "Beta", postedAt: ago(2), contractType: "contract", salaryMin: 85_000, salaryMax: 95_000 }),
    job("Information Security Analyst II", { company: "Gamma", postedAt: ago(10), location: "Akron, OH", description: "Hybrid. Requires 3+ years of experience." }),
    job("Senior Security Engineer", { company: "Delta", postedAt: ago(20), location: "Austin, TX" }),
  ];
  const run = (f: Partial<typeof NO_FILTERS>) => names(applyFilters(jobs, { ...NO_FILTERS, ...f }, NOW));

  it("returns everything with no filters", () => expect(run({})).toHaveLength(4));
  it("filters by date posted", () => {
    expect(run({ posted: "1" })).toEqual(["SOC Analyst I"]);
    expect(run({ posted: "3" })).toEqual(["Remote GRC Analyst", "SOC Analyst I"]);
    expect(run({ posted: "14" })).toHaveLength(3);
  });
  it("filters by work setting", () => {
    expect(run({ setting: "remote" })).toEqual(["Remote GRC Analyst", "SOC Analyst I"]);
    expect(run({ setting: "hybrid" })).toEqual(["Information Security Analyst II"]);
    expect(run({ setting: "onsite" })).toEqual(["Senior Security Engineer"]);
  });
  it("filters by job type", () => {
    expect(run({ jtype: "fulltime" })).toEqual(["SOC Analyst I"]);
    expect(run({ jtype: "contract" })).toEqual(["Remote GRC Analyst"]);
  });
  it("filters by experience level", () => {
    expect(run({ level: "entry" })).toEqual(["SOC Analyst I"]);
    expect(run({ level: "mid" })).toEqual(["Information Security Analyst II"]);
    expect(run({ level: "senior" })).toEqual(["Senior Security Engineer"]);
  });
  it("filters by pay and drops openings that do not list pay", () => {
    expect(run({ pay: "60000" })).toEqual(["Remote GRC Analyst", "SOC Analyst I"]);
    expect(run({ pay: "80000" })).toEqual(["Remote GRC Analyst"]);
    expect(run({ pay: "100000" })).toEqual([]);
  });
  it("filters by company, category, fit and text", () => {
    expect(run({ company: "beta" })).toEqual(["Remote GRC Analyst"]);
    expect(run({ role: "grc" })).toEqual(["Remote GRC Analyst"]);
    expect(run({ fit: "stretch" })).toEqual(["Information Security Analyst II"]);
    expect(run({ q: "GAMMA" })).toEqual(["Information Security Analyst II"]);
  });
  it("combines filters", () => {
    expect(run({ setting: "remote", posted: "3", pay: "80000" })).toEqual(["Remote GRC Analyst"]);
    expect(run({ setting: "onsite", jtype: "contract" })).toEqual([]);
  });
  it("does not change the original list", () => {
    const before = jobs.map((j) => j.id);
    applyFilters(jobs, { ...NO_FILTERS, pay: "80000" }, NOW);
    expect(jobs.map((j) => j.id)).toEqual(before);
  });
});

describe("facets (menu counts)", () => {
  const jobs = [
    job("SOC Analyst I", { company: "Alpha", postedAt: ago(0.5), contractTime: "full_time", salaryMin: 60_000, salaryMax: 72_000 }),
    job("Remote GRC Analyst", { company: "Alpha", postedAt: ago(2), contractType: "contract" }),
    job("Security Analyst", { company: "Beta", postedAt: ago(10), location: "Austin, TX" }),
  ];
  const f = facets(jobs, NOW);
  it("counts each option", () => {
    expect(f.posted.map((o) => o.count)).toEqual([1, 2, 2, 3]);
    expect(Object.fromEntries(f.setting.map((o) => [o.value, o.count]))).toEqual({ remote: 2, hybrid: 0, onsite: 1 });
    expect(Object.fromEntries(f.jtype.map((o) => [o.value, o.count])).fulltime).toBe(1);
    expect(f.pay.find((o) => o.value === "60000")?.count).toBe(1);
    expect(f.pay.find((o) => o.value === "80000")?.count).toBe(0);
  });
  it("lists companies by how many openings they have", () => {
    expect(f.company.map((c) => [c.label, c.count])).toEqual([["Alpha", 2], ["Beta", 1]]);
  });
});

describe("roleCounts", () => {
  it("counts only types that are present, in a stable order", () => {
    const counts = roleCounts([job("SOC Analyst"), job("Security Analyst"), job("GRC Analyst")]);
    expect(counts.map((c) => [c.id, c.count])).toEqual([["grc", 1], ["soc", 2]]);
  });
});

describe("search terms (queriesSchema)", () => {
  it("accepts normal job titles and trims them", () => expect(queriesSchema.parse(["  SOC analyst ", "GRC analyst"])).toEqual(["SOC analyst", "GRC analyst"]));
  it("drops duplicates regardless of case, keeping the first", () => {
    expect(queriesSchema.parse(["SOC analyst", "soc ANALYST", "grc analyst"])).toEqual(["SOC analyst", "grc analyst"]);
  });
  it("rejects unsafe characters, empty and oversized lists", () => {
    expect(queriesSchema.safeParse(["soc<script>"]).success).toBe(false);
    expect(queriesSchema.safeParse(["a&b=c;drop"]).success).toBe(false);
    expect(queriesSchema.safeParse([]).success).toBe(false);
    expect(queriesSchema.safeParse(["x"]).success).toBe(false);
    expect(queriesSchema.safeParse(Array.from({ length: 13 }, (_, i) => `term number ${i}`)).success).toBe(false);
    expect(queriesSchema.safeParse(["x".repeat(41)]).success).toBe(false);
  });
});

describe("sorting", () => {
  const rows = [
    job("SOC Analyst I", { company: "Bravo", postedAt: ago(3) }),
    job("Remote GRC Analyst", { company: "alpha", postedAt: ago(1) }),
    job("Information Security Analyst II", { company: "Charlie", postedAt: ago(5) }),
  ];
  it("defaults to best match first", () => {
    const sorted = sortJobs(rows, DEFAULT_SORT);
    expect(sorted.map((j) => j.match.score)).toEqual([...sorted.map((j) => j.match.score)].sort((a, b) => b - a));
  });
  it("sorts by company ignoring case, ascending and descending", () => {
    expect(sortJobs(rows, { key: "company", dir: "asc" }).map((j) => j.company)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(sortJobs(rows, { key: "company", dir: "desc" }).map((j) => j.company)).toEqual(["Charlie", "Bravo", "alpha"]);
  });
  it("sorts by date posted", () => {
    expect(sortJobs(rows, { key: "newest", dir: "desc" }).map((j) => j.company)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(sortJobs(rows, { key: "newest", dir: "asc" }).map((j) => j.company)).toEqual(["Charlie", "Bravo", "alpha"]);
  });
  it("does not change the original order", () => {
    const before = rows.map((j) => j.id);
    sortJobs(rows, { key: "title", dir: "asc" });
    expect(rows.map((j) => j.id)).toEqual(before);
  });
  it("reads sort from the URL and rejects unknown values", () => {
    expect(parseSort({ sort: "company" })).toEqual({ key: "company", dir: "asc" });
    expect(parseSort({ sort: "score", dir: "asc" })).toEqual({ key: "score", dir: "asc" });
    expect(parseSort({ sort: "<script>", dir: "sideways" })).toEqual(DEFAULT_SORT);
  });
  it("flips direction on the active column and starts new columns in their natural direction", () => {
    expect(nextSort({ key: "score", dir: "desc" }, "score")).toEqual({ key: "score", dir: "asc" });
    expect(nextSort({ key: "score", dir: "desc" }, "company")).toEqual({ key: "company", dir: "asc" });
    expect(nextSort({ key: "company", dir: "asc" }, "newest")).toEqual({ key: "newest", dir: "desc" });
  });
});

import { enrichExisting } from "../src/lib/run";

describe("filling in pay and job type on listings saved earlier", () => {
  const saved = () => job("SOC Analyst", { source: "adzuna" });
  const incoming = (o: Partial<RawJob> = {}): RawJob => ({
    source: "adzuna", externalId: "x", title: "SOC Analyst", company: "Acme", location: "Remote", description: "",
    url: "https://example.com/x", postedAt: null, contractType: "contract", contractTime: "full_time",
    salaryMin: 70_000, salaryMax: 80_000, salaryEstimated: true, ...o,
  });
  it("adds the missing fields", () => {
    const j = saved();
    enrichExisting(j, incoming());
    expect([j.contractType, j.contractTime, j.salaryMin, j.salaryMax, j.salaryEstimated]).toEqual(["contract", "full_time", 70_000, 80_000, true]);
  });
  it("never overwrites a value that is already saved", () => {
    const j = { ...saved(), salaryMin: 50_000, salaryMax: 55_000, contractTime: "part_time" };
    enrichExisting(j, incoming());
    expect([j.salaryMin, j.salaryMax, j.contractTime]).toEqual([50_000, 55_000, "part_time"]);
  });
  it("ignores a listing that came from a different source", () => {
    const j = saved();
    enrichExisting(j, incoming({ source: "lever" }));
    expect(j.salaryMin).toBeUndefined();
  });
  it("leaves fields empty when the source has nothing to add", () => {
    const j = saved();
    enrichExisting(j, incoming({ contractType: undefined, contractTime: undefined, salaryMin: undefined, salaryMax: undefined, salaryEstimated: undefined }));
    expect(j.salaryMin).toBeUndefined();
  });
});

import { sameArea, urlKeyOf } from "../src/lib/ids";

describe("comparing places and links", () => {
  it.each([
    ["Akron, OH", "Akron, Summit County", true], ["Akron, OH", "akron", true], ["Remote", "Remote, US", true], ["Akron, OH", "", true],
    ["Akron, OH", "United States", true], ["Akron, OH", "Austin, TX", false], ["Akron, OH", "Remote", false], ["Canton, OH", "Cuyahoga Falls, OH", false],
    ["Cuyahoga Falls, OH", "Cuyahoga Falls, Summit County", true], ["New York, NY", "York, PA", false], ["Cuyahoga Falls, OH", "Cuyahoga, OH", true], ["Springfield, IL", "Springfield, MO", true],
  ])("%s vs %s -> %s", (a, b, same) => expect(sameArea(a, b)).toBe(same));

  it("compares postings by what identifies them, not by tracking parameters", () => {
    expect(urlKeyOf("https://www.indeed.com/viewjob?jk=ABC&from=serp&vjs=3")).toBe(urlKeyOf("https://indeed.com/rc/clk?jk=abc&tk=1"));
    expect(urlKeyOf("https://example.com/jobs/1?utm_source=x&b=2&a=1")).toBe(urlKeyOf("https://www.example.com/jobs/1/?a=1&b=2"));
    expect(urlKeyOf("https://example.com/jobs/1")).not.toBe(urlKeyOf("https://example.com/jobs/2"));
    for (const bad of ["", "not a url", "javascript:alert(1)", "ftp://x.com/a"]) expect(urlKeyOf(bad), bad).toBe("");
  });
});
