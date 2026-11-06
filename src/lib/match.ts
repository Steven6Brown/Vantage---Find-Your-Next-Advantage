import type { MatchResult, Profile, RawJob } from "./types";

// Business rules live here (pure, testable) rather than in UI components.

const TARGET_TITLE = [
  /\bsoc\b/, /security operations/, /security analyst/, /cyber\s?security/, /\bcyber\b/,
  /information security/, /\binfosec\b/, /\bgrc\b/, /security (compliance|risk)/,
  /compliance analyst/, /security engineer/, /incident response/, /threat (analyst|hunter|intel)/,
  /vulnerability (analyst|management)/, /\bit security\b/, /detection (engineer|analyst)/,
  /security (administrator|specialist|associate|technician)/,
];

// Physical-security and unrelated roles that share keywords.
const EXCLUDE_TITLE = [
  /security (guard|officer|supervisor|patrol)/, /loss prevention/, /\bsales\b/, /recruiter/,
  /\bpolice\b/, /armed/, /social security/, /security (deputy|dispatcher)/,
];

const SENIOR_TITLE = [
  /\bsenior\b/, /\bsr\.?\b/, /\blead\b/, /\bprincipal\b/, /\bstaff\b/, /\bmanager\b/,
  /\bdirector\b/, /\bhead of\b/, /\barchitect\b/, /\bvp\b/, /\bchief\b/, /\b(iii|iv)\b/,
  /\blevel [34]\b/, /\btier [34]\b/,
];
const MID_TITLE = [/\bii\b/, /\blevel 2\b/, /\btier 2\b/];
const ENTRY_SIGNAL = [
  /entry[- ]level/, /\bjunior\b/, /\bjr\.?\b/, /\bassociate\b/, /\bintern(ship)?\b/,
  /\btier 1\b/, /\blevel 1\b/, /\banalyst i\b/, /early career/, /new grad/, /no experience/,
];

// [canonical name, regex]. Order matters only for display.
const CERTS: [string, RegExp][] = [
  ["Security+", /\bsecurity\s?\+|comptia security\b/i],
  ["CISSP", /\bcissp\b/i],
  ["CISM", /\bcism\b/i],
  ["CISA", /\bcisa\b/i],
  ["CEH", /\bceh\b|certified ethical hacker/i],
  ["CySA+", /\bcysa\s?\+?|cybersecurity analyst\+/i],
  ["PenTest+", /\bpentest\s?\+/i],
  ["Network+", /\bnetwork\s?\+/i],
  ["CCNA", /\bccna\b/i],
  ["OSCP", /\boscp\b/i],
  ["GSEC", /\bgsec\b/i],
  ["GCIH", /\bgcih\b/i],
  ["GCIA", /\bgcia\b/i],
  ["GCFA", /\bgcfa\b/i],
  ["SSCP", /\bsscp\b/i],
  ["CCSP", /\bccsp\b/i],
  ["CRISC", /\bcrisc\b/i],
  ["CGRC/CAP", /\bcgrc\b|\bcap certification\b/i],
  ["Azure SC-200", /\bsc-200\b/i],
  ["Azure AZ-500", /\baz-500\b/i],
];

const SOFT_WORDS = /(preferred|nice to have|a plus|desired|bonus|ideally|helpful)/i;

/** Cert names found anywhere in text (used on resumes, where any mention means held). */
export function findCerts(text: string): string[] {
  return CERTS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

export const SKILLS = [
  // security tools & platforms
  "SIEM", "Splunk", "ELK", "Elasticsearch", "Logstash", "Kibana", "QRadar", "Sentinel", "CrowdStrike", "Wireshark",
  "Nessus", "Qualys", "Metasploit", "Burp Suite", "Nmap", "Suricata", "Snort", "Zeek", "Security Onion", "Kali Linux",
  "Nagios", "Kismet", "T-Pot", "Honeypot", "Canary Tokens", "Firewall", "IDS", "IPS", "EDR", "XDR", "VPN", "IAM",
  "MFA", "Okta", "Fortinet", "Palo Alto", "Cisco",
  // security practice
  "Incident Response", "Threat Hunting", "Threat Intelligence", "Vulnerability Management", "Vulnerability Assessment",
  "Risk Assessment", "Risk Analysis", "Intrusion Detection", "Log Analysis", "System Hardening", "Network Defense",
  "Network Security", "Cloud Security", "Network Monitoring", "Ethical Hacking", "Penetration Testing", "Phishing",
  "Malware Analysis", "Digital Forensics", "OSINT", "Security Automation", "Compliance", "Audit", "CUI",
  // frameworks & regulations
  "NIST", "NIST SP 800", "ISO 27001", "SOC 2", "HIPAA", "PCI DSS", "CMMC", "GDPR", "MITRE ATT&CK", "FedRAMP",
  // systems & infrastructure
  "Linux", "Ubuntu", "Debian", "Windows Server", "Active Directory", "Docker", "Kubernetes", "Proxmox", "VMware",
  "VirtualBox", "Virtual Machines", "Azure", "AWS", "GCP", "TCP/IP", "DNS", "DHCP", "Networking",
  // languages & dev
  "Python", "PowerShell", "Bash", "Java", "JavaScript", "TypeScript", "C#", "C++", "SQL", "HTML", "CSS", "Tailwind",
  "Next.js", "React", ".NET", "Node.js", "Git", "WordPress", "Vercel",
  // AI
  "LLM", "RAG", "Prompt Engineering", "Machine Learning",
] as const;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-term, case-insensitive skill matches. */
export function findSkills(text: string, skills: readonly string[] = SKILLS): string[] {
  return skills.filter((s) => new RegExp(`(^|[^a-z0-9])${escapeRe(s)}($|[^a-z0-9])`, "i").test(text));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

/**
 * Job types, derived from the title. Order matters: the first match wins, so the more specific
 * types come before the broad "SOC / Security Analyst".
 */
export const ROLE_TYPES = [
  { id: "ir", label: "Incident Response / Threat", test: /incident response|threat (analyst|hunter|intel)|forensic|dfir/i },
  { id: "vuln", label: "Vulnerability / Pen Test", test: /vulnerabilit|penetration|pen ?test|red team|ethical hack/i },
  { id: "grc", label: "GRC / Compliance", test: /\bgrc\b|compliance|governance|risk analyst|security risk|\baudit|policy/i },
  { id: "engineer", label: "Security Engineer", test: /security engineer|detection engineer|devsecops|cloud security|network security|application security|appsec/i },
  { id: "soc", label: "SOC / Security Analyst", test: /\bsoc\b|security operations|security analyst|cyber ?security analyst|information security|cyber defense|security (specialist|administrator|technician|associate)/i },
] as const;

export const OTHER_ROLE = { id: "other", label: "Other security" } as const;

export function roleTypeOf(title: string): { id: string; label: string } {
  const t = ROLE_TYPES.find((r) => r.test.test(title));
  return t ? { id: t.id, label: t.label } : OTHER_ROLE;
}

/** Plain-language list of titles that are never kept, shown to the user. */
export const EXCLUDED_DESCRIPTION = [
  "Security guards, officers and patrol roles", "Loss prevention", "Sales and recruiting roles",
  "Police and armed roles", "Anything unrelated to cybersecurity",
];

export function normalizeForDedupe(s: string): string {
  return norm(s).replace(/\b(inc|llc|corp|corporation|co|ltd)\b/g, "").replace(/\s+/g, " ").trim();
}

export function extractYears(text: string): number | null {
  const t = text.toLowerCase();
  const found: number[] = [];
  // "3+ years", "3-5 years", "minimum of 4 years", "at least two years"
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b([^.\n]{0,60})/g;
  for (const m of t.matchAll(re)) {
    const ctxBefore = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    const around = `${ctxBefore} ${m[0]}`;
    if (/experience|exp\b|background|working in|hands-on/.test(around)) {
      if (SOFT_WORDS.test(m[2] ?? "")) continue; // "preferred" years don't count as required
      found.push(Number(m[1]));
    }
  }
  return found.length ? Math.max(...found) : null;
}

export function extractCerts(text: string): { required: string[]; preferred: string[] } {
  const required = new Set<string>();
  const preferred = new Set<string>();
  for (const [name, re] of CERTS) {
    const m = re.exec(text);
    if (!m) continue;
    const i = m.index;
    // Judge "preferred" vs "required" from the sentence/bullet containing the cert only.
    const before = text.slice(0, i);
    const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf(";")) + 1;
    const after = text.slice(i + m[0].length);
    const endRel = after.search(/[.\n;]/);
    const sentence = text.slice(start, i + m[0].length + (endRel === -1 ? after.length : endRel));
    (SOFT_WORDS.test(sentence) ? preferred : required).add(name);
  }
  return { required: [...required], preferred: [...preferred].filter((c) => !required.has(c)) };
}

export function classifyLocation(job: RawJob, profile: Profile): MatchResult["locationType"] {
  const loc = norm(job.location);
  const head = norm(`${job.title} ${job.location}`);
  if (/\bremote\b|work from home|\bwfh\b|\banywhere\b/.test(head)) return "remote";
  if (job.nearQuery) return "local";
  const hasState = /\boh\b|ohio/.test(loc);
  if (profile.localArea.towns.some((t) => loc.includes(t)) && (hasState || loc.split(" ").length <= 2)) {
    return "local";
  }
  // Fall back to the first part of the description for "this is a remote role".
  if (/\b(fully|100%|this is a) remote\b/.test(norm(job.description.slice(0, 600)))) return "remote";
  return "other";
}

export function matchJob(job: RawJob, profile: Profile): MatchResult {
  const title = norm(job.title);
  const reasons: string[] = [];
  const gaps: string[] = [];
  const text = `${job.title}\n${job.description}`;

  const relevant =
    TARGET_TITLE.some((r) => r.test(title)) && !EXCLUDE_TITLE.some((r) => r.test(title));
  const locationType = classifyLocation(job, profile);
  const locationOk = locationType !== "other";

  const yearsRequired = extractYears(job.description);
  const certs = extractCerts(text);
  const held = new Set(profile.certsHeld.map((c) => c.toLowerCase()));
  const missingRequired = certs.required.filter((c) => !held.has(c.toLowerCase()));
  const missingPreferred = certs.preferred.filter((c) => !held.has(c.toLowerCase()));

  let score = 0;
  if (relevant) {
    score += 50;
    reasons.push("Title matches a target security role");
  }
  if (locationType === "remote") {
    score += 20;
    reasons.push("Remote");
  } else if (locationType === "local") {
    score += 20;
    reasons.push(`In the ${profile.localArea.label} area`);
  }
  if (ENTRY_SIGNAL.some((r) => r.test(norm(text)))) {
    score += 15;
    reasons.push("Entry-level wording");
  }

  const sharedSkills = findSkills(text, profile.resumeSkills);
  if (sharedSkills.length) {
    score += Math.min(10, 3 * sharedSkills.length);
    reasons.push(`Matches your resume: ${sharedSkills.slice(0, 5).join(", ")}`);
  }

  if (profile.resumeHasBachelor && /bachelor|b.?s.? (degree|in)|four[- ]year degree/i.test(text)) {
    score += 3;
    reasons.push("Asks for a bachelor's degree, which your resume lists");
  }

  let hardMismatch = false;
  if (SENIOR_TITLE.some((r) => r.test(title))) {
    score -= 40;
    gaps.push("Senior-level title");
    hardMismatch = true;
  } else if (MID_TITLE.some((r) => r.test(title))) {
    score -= 15;
    gaps.push("Mid-level title (II / Level 2)");
  }
  if (yearsRequired !== null && yearsRequired > profile.maxYearsExperience) {
    score -= 15 + 5 * Math.min(5, yearsRequired - profile.maxYearsExperience);
    gaps.push(`Asks for ${yearsRequired}+ years (profile max ${profile.maxYearsExperience})`);
    if (yearsRequired >= profile.maxYearsExperience + 3) hardMismatch = true;
  }
  if (missingRequired.length) {
    score -= 20 * Math.min(2, missingRequired.length);
    gaps.push(`Required cert not held: ${missingRequired.join(", ")}`);
    hardMismatch = true;
  }
  if (missingPreferred.length) {
    score -= 3;
    gaps.push(`Preferred cert not held: ${missingPreferred.join(", ")}`);
  }
  if (!locationOk) gaps.push("Location is not remote or in the target area");

  score = Math.max(0, Math.min(100, score));

  let verdict: MatchResult["verdict"];
  if (!relevant || !locationOk || hardMismatch) verdict = "mismatch";
  else if (gaps.some((g) => !g.startsWith("Preferred"))) verdict = "stretch";
  else verdict = "fit";

  return {
    relevant, locationOk, locationType, score, verdict, reasons, gaps,
    yearsRequired, certsRequired: certs.required, certsPreferred: certs.preferred,
  };
}

export type ExperienceLevel = "entry" | "mid" | "senior";

/** Entry, mid or senior, from the title, the wording and any years the posting asks for; null if it cannot tell. */
export function experienceLevelOf(title: string, text: string, yearsRequired: number | null): ExperienceLevel | null {
  const t = norm(title);
  const all = norm(text);
  if (SENIOR_TITLE.some((r) => r.test(t)) || (yearsRequired !== null && yearsRequired >= 5)) return "senior";
  if (MID_TITLE.some((r) => r.test(t)) || (yearsRequired !== null && yearsRequired >= 3)) return "mid";
  if (ENTRY_SIGNAL.some((r) => r.test(all)) || /i$/.test(t) || (yearsRequired !== null && yearsRequired <= 2)) return "entry";
  return null;
}
