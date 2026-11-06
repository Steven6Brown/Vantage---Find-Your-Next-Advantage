import { describe, expect, it } from "vitest";
import { formatDay } from "../src/lib/dates";
import {
  clean, cleanUrl, detectDelimiter, FIELDS, guessMapping, interpretText, LIMITS, looksLikeHeader, parseCsv, parseDate, parseLine,
  rowsFromTable, type Mapping,
} from "../src/lib/importer";

const NOW = new Date(2026, 10, 6, 15, 30); // 6 Nov 2026, local time
const day = (s: string | null) => (s ? s.slice(0, 10) : null);

describe("clean and cleanUrl", () => {
  it("removes control and invisible characters and collapses spaces", () => {
    expect(clean("  SOC\u0000 ​Analyst\t\n  II  ", 50)).toBe("SOC Analyst II");
  });
  it("limits length", () => expect(clean("x".repeat(500), 10)).toHaveLength(10));
  it("copes with undefined", () => expect(clean(undefined, 10)).toBe(""));
  it("keeps only http and https links", () => {
    expect(cleanUrl("https://www.indeed.com/viewjob?jk=abc")).toBe("https://www.indeed.com/viewjob?jk=abc");
    expect(cleanUrl("http://example.com/a")).toBe("http://example.com/a");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://x.com", "example.com", "//example.com", "", "  ", "https://", "https://exa mple.com"]) {
      expect(cleanUrl(bad), bad).toBe("");
    }
  });
  it("never returns a link longer than the limit", () => expect(cleanUrl("https://a.com/" + "x".repeat(5000)).length).toBeLessThanOrEqual(LIMITS.url + 10));
});

describe("parseDate", () => {
  it.each([
    ["2026-11-03", "2026-11-03"], ["2026-11-03T10:00:00Z", "2026-11-03"], ["11/3/2026", "2026-11-03"], ["11/03/26", "2026-11-03"],
    ["11-3-2026", "2026-11-03"], ["3 Nov 2026", "2026-11-03"], ["Nov 3, 2026", "2026-11-03"], ["November 3rd, 2026", "2026-11-03"],
    ["Sept 5, 2026", "2026-09-05"], ["Nov 3", "2026-11-03"], ["Dec 20", "2025-12-20"], ["3rd of nothing", null],
    ["Applied on Nov 3, 2026", "2026-11-03"], ["Applied 3 days ago", "2026-11-03"], ["applied yesterday", "2026-11-05"],
    ["Applied today", "2026-11-06"], ["2 weeks ago", "2026-10-23"], ["1 month ago", "2026-10-07"], ["30+ days ago", "2026-10-07"],
    ["25/12/2025", "2025-12-25"], ["12/25/2025", "2025-12-25"], ["  Nov   3 ,  2026 ", "2026-11-03"],
  ])("%s -> %s", (input, expected) => expect(day(parseDate(input, NOW))).toBe(expected));

  it.each([
    "2026-02-30", "2026-13-01", "13/13/2026", "Marketing 12", "March madness", "hello", "", "   ", "0000-00-00", "1999-01-01",
    "2026-12-31", "Dec 31, 2027", "99999 days ago", "Nov", "32 Nov 2026", "Feb 30", "<script>", "𝟙𝟚/𝟛/𝟜",
  ])("rejects %j", (input) => expect(parseDate(input, NOW)).toBeNull());

  it("is stored at noon UTC, so most time zones agree on the calendar day", () => {
    const r = parseDate("2026-11-03", NOW)!;
    expect(r.endsWith("T12:00:00.000Z")).toBe(true);
    for (const tz of ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Tokyo"]) {
      expect(new Date(r).toLocaleDateString("en-CA", { timeZone: tz }), tz).toBe("2026-11-03");
    }
  });
  it("shows the same day everywhere because it is formatted in UTC (a far-east zone would shift a noon-UTC time)", () => {
    const r = parseDate("2026-11-03", NOW)!;
    expect(new Date(r).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" })).toBe("2026-11-04");
    expect(formatDay(r, NOW)).toBe("Nov 3");
    expect(formatDay(parseDate("2025-12-25", NOW), NOW)).toBe("Dec 25, 2025");
    expect(formatDay("", NOW)).toBe("");
    expect(formatDay("garbage", NOW)).toBe("");
    expect(formatDay(undefined, NOW)).toBe("");
  });
});

describe("parseCsv", () => {
  it("reads quoted commas, quotes and line breaks inside cells", () => {
    const t = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n');
    expect(t).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"]]);
  });
  it("accepts Windows, old Mac and Unix line endings, and a byte-order mark", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps ragged rows and drops blank lines", () => {
    expect(parseCsv("a,b,c\n\n1,2\n   \n,,\n4,5,6,7")).toEqual([["a", "b", "c"], ["1", "2"], ["4", "5", "6", "7"]]);
  });
  it("is lenient about an unterminated quote and a stray quote", () => {
    expect(parseCsv('a,"b\nc')).toEqual([["a", "b\nc"]]);
    expect(parseCsv('ab"c,d')).toEqual([['ab"c', "d"]]);
  });
  it("handles empty input and other delimiters", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a;b", ";")).toEqual([["a", "b"]]);
  });
  it("stops reading after the row limit instead of exhausting memory", () => {
    const big = Array.from({ length: LIMITS.rows * 4 }, (_, i) => `r${i},x`).join("\n");
    expect(parseCsv(big).length).toBeLessThanOrEqual(LIMITS.rows + 2);
  });
});

describe("detectDelimiter", () => {
  it("picks tab, semicolon or comma", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
  it("is not fooled by commas inside quoted cells", () => {
    expect(detectDelimiter('Title\tCompany\n"Analyst, SOC"\tAcme, Inc')).toBe("\t");
  });
  it("defaults to comma for plain text and empty input", () => {
    expect(detectDelimiter("just a line of words")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("finding columns", () => {
  const idx = (m: Mapping) => FIELDS.map((f) => m[f]);
  it("uses clear headers", () => {
    const t = parseCsv("Job Title,Company,Location,Date Applied,Link\nSOC Analyst,Acme,Akron OH,11/3/2026,https://x.com/1");
    expect(looksLikeHeader(t)).toBe(true);
    expect(idx(guessMapping(t, true))).toEqual([0, 1, 2, 4, 3, -1]);
  });
  it("tolerates different wording, case and punctuation", () => {
    const t = parseCsv("POSITION TITLE,Employer,City,Applied On,Job URL,Status\nA,B,C,D,E,F");
    expect(idx(guessMapping(t, true))).toEqual([0, 1, 2, 4, 3, 5]);
  });
  it("works from the cells when there is no header", () => {
    const t = parseCsv([
      "Security Analyst,Acme Corp,\"Akron, OH\",11/3/2026,https://www.indeed.com/viewjob?jk=1",
      "SOC Analyst II,Globex,Remote,11/2/2026,https://www.indeed.com/viewjob?jk=2",
      "GRC Analyst,Initech,\"Canton, OH\",10/30/2026,https://www.indeed.com/viewjob?jk=3",
    ].join("\n"));
    expect(looksLikeHeader(t)).toBe(false);
    const m = guessMapping(t, false);
    expect(m.url).toBe(4);
    expect(m.date).toBe(3);
    expect(m.location).toBe(2);
    expect(m.title).toBe(0);
    expect(m.company).toBe(1);
  });
  it("copes with an exported page whose columns have generated class names", () => {
    const t = parseCsv([
      "jcs-JobTitle href,jcs-JobTitle,css-1h7lukg,css-1p0sjhy,css-1ihavw2",
      "https://www.indeed.com/rc/clk?jk=1,SOC Analyst,Acme Corp,\"Akron, OH\",Applied 3 days ago",
      "https://www.indeed.com/rc/clk?jk=2,Security Engineer,Globex,Remote,Applied 5 days ago",
    ].join("\n"));
    expect(looksLikeHeader(t)).toBe(true);
    const m = guessMapping(t, true);
    expect(m.url).toBe(0);
    expect(m.title).toBe(1);
    expect(m.company).toBe(2);
    expect(m.location).toBe(3);
    expect(m.date).toBe(4);
  });
  it("never throws on odd shapes", () => {
    for (const t of [[], [[]], [[""]], [["a"]], [["a", "b"], []], [[], ["x"]]]) {
      expect(() => guessMapping(t as string[][], true)).not.toThrow();
      expect(() => guessMapping(t as string[][], false)).not.toThrow();
    }
  });
});

describe("rowsFromTable", () => {
  const map: Mapping = { title: 0, company: 1, location: 2, url: 3, date: 4, notes: 5 };
  it("builds clean rows and parses dates", () => {
    const r = rowsFromTable([["SOC  Analyst ", "Acme", "Akron, OH", "https://x.com/1", "Applied 2 days ago", "phone screen"]], map, false, NOW);
    expect(r.rows).toEqual([{ title: "SOC Analyst", company: "Acme", location: "Akron, OH", url: "https://x.com/1", appliedAt: parseDate("2026-11-04", NOW), notes: "phone screen" }]);
  });
  it("skips rows with no title and says why", () => {
    const r = rowsFromTable([["h"], ["", "Acme"], ["Real Job", "Acme"]], map, true, NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ line: 2, reason: "No job title" }]);
  });
  it("copes with short rows and out-of-range columns", () => {
    expect(() => rowsFromTable([["only a title"]], map, false, NOW)).not.toThrow();
    expect(rowsFromTable([["t", "c"]], { title: 0, company: 99, location: -5, url: 7, date: 3, notes: 2 }, false, NOW).rows).toHaveLength(1);
  });
  it("keeps hostile text as inert text and drops bad links", () => {
    const r = rowsFromTable([["<img src=x onerror=alert(1)>", "=HYPERLINK(\"http://evil\")", "'+cmd", "javascript:alert(1)", "not a date", "<script>x</script>"]], map, false, NOW).rows[0];
    expect(r.title).toBe("<img src=x onerror=alert(1)>");
    expect(r.url).toBe("");
    expect(r.appliedAt).toBeNull();
    expect(r.company.startsWith("=")).toBe(true);
  });
  it("limits field lengths", () => {
    const r = rowsFromTable([["t".repeat(900), "c".repeat(900), "l".repeat(900), "", "", "n".repeat(2000)]], map, false, NOW).rows[0];
    expect([r.title.length, r.company.length, r.location.length, r.notes.length]).toEqual([LIMITS.title, LIMITS.company, LIMITS.location, LIMITS.notes]);
  });
  it("flags a table that is over the row limit", () => {
    const t = Array.from({ length: LIMITS.rows + 50 }, (_, i) => [`Job ${i}`]);
    const r = rowsFromTable(t, map, false, NOW);
    expect(r.rows).toHaveLength(LIMITS.rows);
    expect(r.truncated).toBe(true);
  });
});

describe("parseLine", () => {
  it.each([
    ["SOC Analyst at Acme Corp", "SOC Analyst", "Acme Corp", ""],
    ["SOC Analyst @ Acme", "SOC Analyst", "Acme", ""],
    ["Security Analyst - Globex - Akron, OH", "Security Analyst", "Globex", "Akron, OH"],
    ["GRC Analyst | Initech", "GRC Analyst", "Initech", ""],
    ["GRC Analyst – Initech", "GRC Analyst", "Initech", ""],
    ["Threat Hunter", "Threat Hunter", "", ""],
    ["Info-Sec Analyst at Pre-Fix Inc", "Info-Sec Analyst", "Pre-Fix Inc", ""],
  ])("%s", (line, title, company, location) => {
    const r = parseLine(line, NOW)!;
    expect([r.title, r.company, r.location]).toEqual([title, company, location]);
  });
  it("reads a date in parentheses at the end", () => {
    const r = parseLine("SOC Analyst at Acme (Nov 3)", NOW)!;
    expect(r.title).toBe("SOC Analyst");
    expect(r.company).toBe("Acme");
    expect(day(r.appliedAt)).toBe("2026-11-03");
  });
  it("reads a trailing date after dashes or commas, and a place in parentheses", () => {
    const a = parseLine("SOC Analyst - Acme Corp - Akron, OH - 11/2/2026", NOW)!;
    expect([a.company, a.location, day(a.appliedAt)]).toEqual(["Acme Corp", "Akron, OH", "2026-11-02"]);
    const b = parseLine("Security Analyst, Initech, Akron, OH, Nov 3", NOW)!;
    expect([b.title, b.company, b.location, day(b.appliedAt)]).toEqual(["Security Analyst", "Initech", "Akron, OH", "2026-11-03"]);
    const c = parseLine("Network Security Engineer at Globex (Remote)", NOW)!;
    expect([c.company, c.location]).toEqual(["Globex", "Remote"]);
  });
  it("leaves parentheses alone when they are not a date", () => {
    expect(parseLine("SOC Analyst (Tier 1) at Acme", NOW)!.title).toBe("SOC Analyst (Tier 1)");
  });
  it("returns null for nothing", () => {
    for (const s of ["", "   ", "\t\n", "​"]) expect(parseLine(s, NOW)).toBeNull();
  });
});

describe("interpretText", () => {
  it("recognises a spreadsheet paste (tabs)", () => {
    const r = interpretText("Job Title\tCompany\tDate\nSOC Analyst\tAcme\t11/3/2026\nGRC\tGlobex\t11/2/2026", NOW);
    expect(r.kind).toBe("table");
    if (r.kind === "table") { expect(r.hasHeader).toBe(true); expect(r.mapping.title).toBe(0); expect(r.mapping.date).toBe(2); }
  });
  it("recognises a CSV file", () => {
    const r = interpretText("title,company\nSOC Analyst,Acme\nGRC,Globex", NOW);
    expect(r.kind).toBe("table");
  });
  it("treats plain lines as a list", () => {
    const r = interpretText("SOC Analyst at Acme\nGRC Analyst at Globex\nThreat Hunter at Initech", NOW);
    expect(r.kind).toBe("lines");
    if (r.kind === "lines") expect(r.rows.map((x) => x.company)).toEqual(["Acme", "Globex", "Initech"]);
  });
  it("treats a single line as a list entry", () => {
    const r = interpretText("SOC Analyst at Acme", NOW);
    expect(r.kind).toBe("lines");
  });
  it("says so for empty and oversized input", () => {
    expect(interpretText("", NOW).kind).toBe("empty");
    expect(interpretText("   \n\n  ", NOW).kind).toBe("empty");
    expect(interpretText("a".repeat(LIMITS.chars + 1), NOW).kind).toBe("empty");
  });
  it("handles a very long single line without hanging", () => {
    const t0 = Date.now();
    interpretText("word ".repeat(100_000), NOW);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

/* A seeded random generator, so the fuzz run is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("fuzzing: nothing breaks and the output stays bounded and safe", () => {
  const pieces = ['"', '""', ",", "\t", ";", "\n", "\r\n", "\r", " ", "SOC Analyst", "Acme", "https://x.com/a?b=c", "javascript:alert(1)", "11/3/2026", "Nov 3", "3 days ago",
    "=1+1", "<script>", "\u0000", "​", "𝕊𝕆ℂ", "é", "日本語", "😀", "(", ")", "-", "–", "|", "@", " at ", "Remote", "Akron, OH", "x".repeat(300), "﻿"];

  it("survives 400 random inputs", () => {
    const rand = rng(20261106);
    for (let n = 0; n < 400; n++) {
      const len = Math.floor(rand() * 60);
      let text = "";
      for (let i = 0; i < len; i++) text += pieces[Math.floor(rand() * pieces.length)];
      const r = interpretText(text, NOW);
      const rows =
        r.kind === "table" ? rowsFromTable(r.table, r.mapping, r.hasHeader, NOW).rows : r.kind === "lines" ? r.rows : [];
      expect(rows.length).toBeLessThanOrEqual(LIMITS.rows);
      for (const x of rows) {
        expect(x.title.length).toBeGreaterThan(0);
        expect(x.title.length).toBeLessThanOrEqual(LIMITS.title);
        expect(x.company.length).toBeLessThanOrEqual(LIMITS.company);
        expect(x.location.length).toBeLessThanOrEqual(LIMITS.location);
        expect(x.notes.length).toBeLessThanOrEqual(LIMITS.notes);
        expect(x.url === "" || /^https?:\/\//.test(x.url)).toBe(true);
        expect(x.appliedAt === null || !Number.isNaN(Date.parse(x.appliedAt))).toBe(true);
        expect([...(x.title + x.company + x.location + x.notes)].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
      }
    }
  });

  it("survives random column mappings, including nonsense indexes", () => {
    const rand = rng(7);
    const table = [["a", "b", "c"], ["d"], [], ["e", "f", "g", "h", "i"]];
    for (let n = 0; n < 200; n++) {
      const pick = () => Math.floor(rand() * 12) - 4;
      const m: Mapping = { title: pick(), company: pick(), location: pick(), url: pick(), date: pick(), notes: pick() };
      expect(() => rowsFromTable(table, m, rand() > 0.5, NOW)).not.toThrow();
    }
  });

  it("is fast on pathological input", () => {
    for (const text of ['"'.repeat(1_000_000), ",".repeat(1_000_000), "\n".repeat(500_000), "a,".repeat(300_000) + "\n", '"a""'.repeat(200_000)]) {
      const t0 = Date.now();
      interpretText(text, NOW);
      expect(Date.now() - t0).toBeLessThan(3000);
    }
  });
});
