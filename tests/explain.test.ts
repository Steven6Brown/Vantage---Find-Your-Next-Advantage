import { describe, expect, it } from "vitest";
import { excerpt, explainJob, segmentsText } from "../src/lib/explain";
import { matchJob } from "../src/lib/match";
import type { Settings } from "../src/lib/settings";
import type { Profile, RawJob, StoredJob } from "../src/lib/types";

const profile: Profile = {
  queries: ["soc analyst"],
  localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 48, towns: ["akron"] },
  maxYearsExperience: 2, certsHeld: ["Security+"], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7,
  resumeSkills: ["Splunk", "Suricata", "Python"], resumeHasBachelor: true,
};

const resume: NonNullable<Settings["resume"]> = {
  terms: ["Splunk", "Suricata", "Python", "Docker"],
  certs: ["Security+"], credentials: [], education: ["B.S. Cybersecurity Analytics May 2025"], hasBachelor: true,
  relatedYears: 2, updatedAt: "2026-01-01",
  experience: [{ heading: "Acme Security — Technical Intern June 2024 - August 2024", months: 3, bullets: ["Built a honeypot with Suricata for intrusion detection."] }],
  projects: [{ heading: "CloakAI: August 2024", months: null, bullets: ["Local chatbot using Python."] }],
  evidence: { Suricata: "Built a honeypot with Suricata for intrusion detection.", Python: "Local chatbot using Python." },
};

function store(o: Partial<RawJob>): StoredJob {
  const raw: RawJob = {
    source: "greenhouse", externalId: "1", title: "SOC Analyst I", company: "Acme", location: "Remote",
    description: "Triage alerts in Splunk and write Python scripts. Bachelor's degree preferred. Security+ required.",
    url: "https://example.com/1", postedAt: null, ...o,
  };
  return { ...raw, id: "a".repeat(20), dedupeKey: "k", firstSeen: "2026-01-01", status: "new", alsoSeenOn: [], match: matchJob(raw, profile) };
}

describe("explainJob", () => {
  it("opens with a one-line verdict", () => {
    const e = explainJob(store({}), resume, profile);
    expect(e.bluf).toMatch(/^Fit: remote; entry-level wording; 2 of your skills appear in the posting; no required gaps\.$/);
  });
  it("carries the verdict so the UI can word its headings", () => {
    expect(explainJob(store({}), resume, profile).verdict).toBe("fit");
  });
  it("pairs each matched skill with your resume line and the posting's wording", () => {
    const e = explainJob(store({}), resume, profile);
    const py = e.resumeMatches.find((x) => x.term === "Python")!;
    expect(segmentsText(py.resumeLine)).toMatch(/chatbot/);
    expect(segmentsText(py.postingSnippet)).toMatch(/Python scripts/);
  });
  it("lists resume entries that support the match", () => {
    expect(explainJob(store({}), resume, profile).resumeEntries.join()).toMatch(/CloakAI/);
  });
  it("notes the degree and a held cert the posting mentions", () => {
    const e = explainJob(store({}), resume, profile);
    expect(e.degree).toMatch(/B\.S\./);
    expect(e.certsMatched).toEqual(["Security+"]);
  });
  it("surfaces gaps and what the posting does not state", () => {
    const e = explainJob(store({ description: "Monitor alerts. 5+ years of experience required." }), resume, profile);
    expect(e.bluf).toMatch(/^(Likely mismatch|Stretch)/);
    expect(e.watchOuts.join()).toMatch(/5\+ years/);
    expect(e.notStated).toContain("Certifications");
  });
  it("flags partial text only for Adzuna listings", () => {
    expect(explainJob(store({ source: "adzuna" }), resume, profile).partialText).toBe(true);
    expect(explainJob(store({}), resume, profile).partialText).toBe(false);
  });
  it("works without a resume and says so", () => {
    const e = explainJob(store({}), null, { ...profile, resumeSkills: [] });
    expect(e.hasResume).toBe(false);
    expect(e.resumeMatches).toEqual([]);
    expect(e.bluf).toMatch(/no resume uploaded yet/);
  });
});

describe("excerpt", () => {
  const text = "Our team protects customers every day. Alerts flow from the Splunk SIEM into a queue, and analysts triage them within minutes. Candidates should enjoy learning.";
  it("marks the matched term so it can be highlighted", () => {
    const segs = excerpt(text, "SIEM");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["SIEM"]);
  });
  it("starts and ends on sentence boundaries when it can", () => {
    const out = segmentsText(excerpt(text, "SIEM"));
    expect(out.startsWith("Alerts flow")).toBe(true);
    expect(out.endsWith("minutes.")).toBe(true);
  });
  it("never starts in the middle of a word", () => {
    const long = "word ".repeat(80) + "Splunk is used here " + "word ".repeat(80);
    const out = segmentsText(excerpt(long, "Splunk", 40));
    expect(out.replace(/^…/, "")).toMatch(/^(word|Splunk)/);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
  it("returns plain text when the term is not found", () => {
    expect(excerpt("nothing relevant here", "Splunk")).toEqual([{ text: "nothing relevant here" }]);
  });
  it("handles regex characters in terms", () => {
    expect(excerpt("We use C++ daily", "C++").some((s) => s.hit && s.text === "C++")).toBe(true);
  });
});
