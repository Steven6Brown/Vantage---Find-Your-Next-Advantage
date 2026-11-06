import { describe, expect, it } from "vitest";
import { extractResumeText, parseResume } from "../src/lib/resume";
import { locationSchema } from "../src/lib/settings";
import { findSkills, matchJob } from "../src/lib/match";
import type { Profile, RawJob } from "../src/lib/types";

const profile: Profile = {
  queries: ["soc analyst"],
  localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 50, towns: ["akron"] },
  maxYearsExperience: 2, certsHeld: [], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7,
  resumeSkills: ["Splunk", "Python"],
  resumeHasBachelor: false,
};
const job = (o: Partial<RawJob>): RawJob => ({
  source: "adzuna", externalId: "1", title: "SOC Analyst I", company: "Acme", location: "Canton, OH",
  description: "Use Splunk and Python to triage alerts.", url: "https://example.com/1", postedAt: null, ...o,
});

const SAMPLE = `Jane Doe
| jane.doe@example.com | 555-123-4567 | www.janedoe.dev |
EDUCATION
Example State University City, ST
B.S. Cybersecurity Analytics May 2025
• Relevant Courses: Networking, Malware Analysis.
RELATED TECHNICAL EXPERIENCE
Acme Security LLC City, VA
Technical Intern June 2024 - August 2024
• Deployed a containerized stack (Docker, Proxmox, Debian 12) including the ELK stack for log
aggregation, plus Nagios for monitoring.
• Built a honeypot integrating Suricata and Snort for intrusion detection.
Example State University City, ST
Learning Assistant January 2023 - December 2024
• Led instruction in network defense and incident response.
WORK EXPERIENCE
Big Retail Co City, ST
Store Lead May 2022 - May 2025
• Led daily store operations.
PROJECT EXPERIENCE
CloakAI: August 2024
• Built a local chatbot using Python, LangChain and Retrieval-Augmented Generation (RAG).
CERTIFICATIONS
CompTIA Security+ June 2025
Fortinet Training Institute: Getting Started in Cybersecurity. December 2025
SKILLS
Cybersecurity & Systems: Ethical hacking, incident response; SIEM (Splunk, ELK); Linux (Ubuntu, Debian).
Programming Languages: Developed applications using Java, JavaScript, Python, C#, SQL.
`;

describe("resume parser", () => {
  const r = parseResume(SAMPLE, new Date("2026-01-15"));

  it("splits sections into entries with bullets and joins wrapped lines", () => {
    expect(r.experience.map((e) => e.heading).join("|")).toMatch(/Acme Security/);
    const acme = r.experience.find((e) => /Acme/.test(e.heading))!;
    expect(acme.bullets).toHaveLength(2);
    expect(acme.bullets[0]).toMatch(/log aggregation/);
    expect(r.projects[0].heading).toMatch(/CloakAI/);
  });
  it("learns terms from lists, parentheses and the skills section", () => {
    for (const t of ["Docker", "Proxmox", "Debian", "Nagios", "Suricata", "Snort", "Splunk", "ELK", "Java", "C#", "SQL", "Python", "RAG"]) {
      expect(r.terms, t).toContain(t);
    }
  });
  it("picks up terms that are not in any built-in list", () => {
    expect(r.terms).toContain("LangChain");
  });
  it("keeps an evidence line for a term", () => {
    expect(r.evidence["Suricata"]).toMatch(/honeypot/);
  });
  it("reads education and degree level", () => {
    expect(r.hasBachelor).toBe(true);
    expect(r.education.join()).toMatch(/Cybersecurity Analytics/);
  });
  it("finds industry certs and lists other credentials", () => {
    expect(r.certs).toContain("Security+");
    expect(r.credentials.join()).toMatch(/Fortinet/);
  });
  it("computes related experience from dates, merging overlaps", () => {
    // Jun-Aug 2024 (3 mo) + Jan 2023 - Dec 2024 (24 mo) overlap -> 24 months
    expect(r.relatedYears).toBe(2);
  });
  it("never keeps contact details", () => {
    expect(JSON.stringify(r)).not.toMatch(/jane.doe@|555-123|janedoe.dev/);
  });
  it("re-derives everything when the resume changes", () => {
    const changed = parseResume(SAMPLE.replace("Suricata and Snort", "Zeek and Wazuh"), new Date("2026-01-15"));
    expect(changed.terms).toContain("Zeek");
    expect(changed.terms).not.toContain("Suricata");
  });
  it("does not match a skill inside another word", () => {
    expect(findSkills("Experience with IDSense and Bashful tools", ["IDS", "Bash"])).toEqual([]);
  });
  it("rejects files whose content does not match the extension", async () => {
    await expect(extractResumeText(Buffer.from("not a pdf"), "resume.pdf")).rejects.toThrow(/PDF, DOCX, or TXT/);
  });
  it("rejects oversized files", async () => {
    await expect(extractResumeText(Buffer.alloc(3 * 1024 * 1024, 65), "resume.txt")).rejects.toThrow(/2 MB/);
  });
  it("reads plain text", async () => {
    expect(await extractResumeText(Buffer.from("Splunk"), "resume.txt")).toBe("Splunk");
  });
});

describe("resume skills in matching", () => {
  it("adds a reason and score when job text overlaps the resume", () => {
    const withSkills = matchJob(job({ nearQuery: true }), profile);
    const without = matchJob(job({ nearQuery: true }), { ...profile, resumeSkills: [] });
    expect(withSkills.reasons.join()).toMatch(/Splunk, Python/);
    expect(withSkills.score).toBeGreaterThan(without.score);
  });
});

describe("location", () => {
  it("treats results from a distance-limited search as local", () => {
    expect(matchJob(job({ nearQuery: true }), profile).locationType).toBe("local");
    expect(matchJob(job({ nearQuery: false }), profile).locationType).toBe("other");
  });
  it("accepts a ZIP or City, ST and rejects unsafe input", () => {
    expect(locationSchema.safeParse({ query: "44301", radiusMiles: 30 }).success).toBe(true);
    expect(locationSchema.safeParse({ query: "Akron, OH", radiusMiles: 30 }).success).toBe(true);
    expect(locationSchema.safeParse({ query: "a&b=c<script>", radiusMiles: 30 }).success).toBe(false);
    expect(locationSchema.safeParse({ query: "Akron, OH", radiusMiles: 500 }).success).toBe(false);
  });
});
