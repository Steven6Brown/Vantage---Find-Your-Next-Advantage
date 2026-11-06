import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adzuna, call, read, signIn } from "./helpers";

import { POST as importPOST } from "../src/app/api/import/route";
import { POST as resumePOST, DELETE as resumeDELETE } from "../src/app/api/resume/route";
import { POST as runPOST } from "../src/app/api/run/route";
import { POST as settingsPOST } from "../src/app/api/settings/route";
import { POST as statusPOST } from "../src/app/api/jobs/status/route";
import { GET as cronGET } from "../src/app/api/cron/route";
import { dataDir } from "../src/lib/paths";
import { resetLimits } from "../src/lib/ratelimit";
import { resetRunGuard } from "../src/lib/run";
import { readSettings } from "../src/lib/settings";
import { readStore } from "../src/lib/store";

const storeFile = () => path.join(dataDir(), "store.json");
const fresh = () => writeFileSync(storeFile(), JSON.stringify({ jobs: {}, runs: [] }));

beforeEach(() => {
  resetLimits();
  resetRunGuard();
  fresh();
  writeFileSync(path.join(dataDir(), "settings.json"), "{}");
});
afterEach(() => vi.unstubAllGlobals());

describe("every protected route refuses a visitor who is not signed in", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["run", () => runPOST(call("/api/run", { body: {} }))],
    ["jobs/status", () => statusPOST(call("/api/jobs/status", { body: { id: "a".repeat(20), status: "seen" } }))],
    ["settings", () => settingsPOST(call("/api/settings", { body: { certsHeld: ["A"] } }))],
    ["resume upload", () => resumePOST(call("/api/resume", { form: new FormData() }))],
    ["resume delete", () => resumeDELETE(call("/api/resume", { method: "DELETE" }))],
    ["import", () => importPOST(call("/api/import", { body: { rows: [{ title: "x" }] } }))],
  ];
  it.each(cases)("%s -> 401", async (_n, fn) => expect((await fn()).status).toBe(401));

  it("a forged or expired session cookie is refused too", async () => {
    const res = await importPOST(call("/api/import", { body: { rows: [{ title: "x" }] }, cookie: "aq_session=forged-forged-forged" }));
    expect(res.status).toBe(401);
  });

  it("nothing was changed by the refused requests", async () => {
    expect(Object.keys((await readStore()).jobs)).toHaveLength(0);
    expect(await readSettings()).toEqual({});
  });
});

describe("every state-changing route refuses a cross-site request (CSRF)", () => {
  it.each([
    ["run", runPOST, "/api/run", {}],
    ["status", statusPOST, "/api/jobs/status", { id: "a".repeat(20), status: "seen" }],
    ["settings", settingsPOST, "/api/settings", { certsHeld: ["A"] }],
    ["import", importPOST, "/api/import", { rows: [{ title: "x" }] }],
  ] as const)("%s", async (_n, handler, url, body) => {
    const { cookie } = await signIn();
    const res = await handler(call(url, { body, cookie, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/jobs/status", () => {
  it("validates the id and the status, and 404s for an unknown job", async () => {
    const { cookie } = await signIn();
    const post = async (body: unknown) => (await read(await statusPOST(call("/api/jobs/status", { body, cookie })))).status;
    expect(await post({ id: "short", status: "seen" })).toBe(400);
    expect(await post({ id: "a".repeat(20), status: "hacked" })).toBe(400);
    expect(await post({ id: "g".repeat(20), status: "seen" })).toBe(400); // not hex
    expect(await post({})).toBe(400);
    expect(await post("not json")).toBe(400);
    expect(await post({ id: "a".repeat(20), status: "seen" })).toBe(404);
  });
});

describe("POST /api/settings", () => {
  it("accepts good settings and refuses bad ones", async () => {
    const { cookie } = await signIn();
    const post = async (body: unknown) => (await settingsPOST(call("/api/settings", { body, cookie }))).status;
    expect(await post({ location: { query: "Akron, OH", radiusMiles: 30 }, queries: ["SOC analyst"], certsHeld: ["Security+"] })).toBe(200);
    expect(await post({ location: { query: "<script>", radiusMiles: 30 } })).toBe(400);
    expect(await post({ location: { query: "Akron", radiusMiles: 500 } })).toBe(400);
    expect(await post({ queries: [] })).toBe(400);
    expect(await post({ queries: ["x".repeat(41)] })).toBe(400);
    expect(await post({ certsHeld: Array.from({ length: 41 }, (_, i) => `C${i}`) })).toBe(400);
    expect(await post(null)).toBe(400);
    const s = await readSettings();
    expect(s.location?.query).toBe("Akron, OH");
    expect(s.queries).toEqual(["SOC analyst"]);
  });
});

describe("resume upload", () => {
  const upload = async (name: string, content: BlobPart, cookie: string) => {
    const form = new FormData();
    form.set("resume", new File([content], name, { type: "text/plain" }));
    return read(await resumePOST(call("/api/resume", { form, cookie })));
  };
  it("reads a text resume and saves only the parsed structure", async () => {
    const { cookie } = await signIn();
    const text = "Jane Doe\njane@example.com | 555-123-4567\nSKILLS\nCybersecurity: Splunk, Python, Linux\nCERTIFICATIONS\nCompTIA Security+ 2025\n";
    const r = await upload("resume.txt", text, cookie);
    expect(r.status).toBe(200);
    const saved = JSON.stringify(await readSettings());
    expect(saved).toContain("Splunk");
    expect(saved).not.toContain("jane@example.com");
    expect(saved).not.toContain("555-123");
  });
  it("refuses wrong types, empty files, oversized files, and a file that lies about its type", async () => {
    const { cookie } = await signIn();
    expect((await upload("resume.exe", "MZ", cookie)).status).toBe(400);
    expect((await upload("resume.pdf", "this is not a pdf", cookie)).status).toBe(400);
    expect((await upload("resume.txt", "", cookie)).status).toBe(400);
    expect((await upload("resume.txt", "a".repeat(2 * 1024 * 1024 + 10), cookie)).status).toBe(413);
    const noFile = await resumePOST(call("/api/resume", { form: new FormData(), cookie }));
    expect(noFile.status).toBe(400);
  });
  it("removes the saved resume data on request", async () => {
    const { cookie } = await signIn();
    await upload("resume.txt", "SKILLS\nSplunk, Python\n", cookie);
    expect((await readSettings()).resume).toBeDefined();
    expect((await resumeDELETE(call("/api/resume", { method: "DELETE", cookie }))).status).toBe(200);
    expect((await readSettings()).resume).toBeUndefined();
  });
});

describe("import API", () => {
  const post = async (body: unknown, cookie: string) => read(await importPOST(call("/api/import", { body, cookie })));
  const rows = (...r: Array<Record<string, unknown>>) => r;

  it("a preview saves nothing; the real import saves", async () => {
    const { cookie } = await signIn();
    const r = rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH", appliedAt: "2026-11-03T12:00:00.000Z" });
    const preview = await post({ rows: r, dryRun: true }, cookie);
    expect(preview.status).toBe(200);
    expect(preview.json.added).toBe(1);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(0);

    const real = await post({ rows: r }, cookie);
    expect(real.json.added).toBe(1);
    const jobs = Object.values((await readStore()).jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "applied", imported: true, source: "import", title: "SOC Analyst", company: "Acme" });
    expect(jobs[0].appliedAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("preview wording is future tense and the import's is past tense", async () => {
    const { cookie } = await signIn();
    const r = rows({ title: "SOC Analyst", company: "Acme" });
    const a = (await post({ rows: r, dryRun: true }, cookie)).json.results as { reason: string }[];
    const b = (await post({ rows: r }, cookie)).json.results as { reason: string }[];
    expect(a[0].reason).toMatch(/^Will be added/);
    expect(b[0].reason).toMatch(/^Added/);
  });

  it("importing the same list twice does not duplicate anything", async () => {
    const { cookie } = await signIn();
    const r = rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH" }, { title: "GRC Analyst", company: "Globex" });
    await post({ rows: r }, cookie);
    const again = await post({ rows: r }, cookie);
    expect(again.json).toMatchObject({ added: 0, unchanged: 2 });
    expect(Object.keys((await readStore()).jobs)).toHaveLength(2);
  });

  it("repeats inside one batch are not added twice", async () => {
    const { cookie } = await signIn();
    const res = await post({ rows: rows({ title: "SOC Analyst", company: "Acme" }, { title: "soc analyst", company: "ACME, Inc." }, { title: "SOC  Analyst", company: "Acme" }) }, cookie);
    expect(res.json).toMatchObject({ added: 1, unchanged: 2 });
  });

  it("an opening already in your list is marked applied, not duplicated", async () => {
    const { cookie } = await signIn();
    const existing = {
      id: "e".repeat(20), dedupeKey: "k", source: "adzuna", externalId: "1", title: "SOC Analyst", company: "Acme", location: "Akron, OH", description: "", url: "https://example.com/1",
      postedAt: null, firstSeen: "2026-11-01T00:00:00.000Z", status: "new", alsoSeenOn: [], match: { relevant: true, locationOk: true, locationType: "local", score: 70, verdict: "fit", reasons: [], gaps: [], yearsRequired: null, certsRequired: [], certsPreferred: [] },
    };
    writeFileSync(storeFile(), JSON.stringify({ jobs: { [existing.id]: existing }, runs: [] }));
    const res = await post({ rows: rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH", appliedAt: "2026-11-04T12:00:00.000Z" }) }, cookie);
    expect(res.json).toMatchObject({ added: 0, updated: 1 });
    const jobs = Object.values((await readStore()).jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "applied", appliedAt: "2026-11-04T12:00:00.000Z" });
    expect(jobs[0].imported).toBeUndefined();
  });

  it("recognises the same Indeed posting from different links", async () => {
    const { cookie } = await signIn();
    await post({ rows: rows({ title: "SOC Analyst", company: "Acme", url: "https://www.indeed.com/viewjob?jk=ABC123&from=serp&vjs=3" }) }, cookie);
    const again = await post({ rows: rows({ title: "Security Analyst (SOC)", company: "Acme Corp", url: "https://indeed.com/rc/clk?jk=abc123&tk=xyz&utm_source=email" }) }, cookie);
    expect(again.json).toMatchObject({ added: 0, unchanged: 1 });
  });

  it("matches company and title when one side has no location", async () => {
    const { cookie } = await signIn();
    await post({ rows: rows({ title: "SOC Analyst", company: "Acme" }) }, cookie);
    const again = await post({ rows: rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH" }) }, cookie);
    expect(again.json).toMatchObject({ added: 0 });
  });

  it("treats Akron Summit County and Akron OH as the same place", async () => {
    const { cookie } = await signIn();
    await post({ rows: rows({ title: "SOC Analyst", company: "Acme", location: "Akron, Summit County" }) }, cookie);
    const again = await post({ rows: rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH" }) }, cookie);
    expect(again.json).toMatchObject({ added: 0 });
  });

  it("keeps two different offices of one company as separate applications", async () => {
    const { cookie } = await signIn();
    const res = await post({ rows: rows({ title: "SOC Analyst", company: "Acme", location: "Akron, OH" }, { title: "SOC Analyst", company: "Acme", location: "Austin, TX" }) }, cookie);
    expect(res.json.added).toBe(2);
  });

  it("reports rows it cannot use, and still imports the rest", async () => {
    const { cookie } = await signIn();
    const res = await post({ rows: rows({ title: "   ", company: "Acme" }, { title: "Real Job", company: "Acme" }, { title: "\u0000​", company: "x" }) }, cookie);
    expect(res.json).toMatchObject({ added: 1, invalid: 2 });
    expect((res.json.results as { outcome: string; reason: string }[])[0]).toMatchObject({ outcome: "invalid", reason: "No job title" });
  });

  it("validates dates: a bad or future date falls back to today and says so", async () => {
    const { cookie } = await signIn();
    const res = await post({ rows: rows({ title: "A job", company: "X", appliedAt: "not a date" }, { title: "B job", company: "X", appliedAt: "2099-01-01T00:00:00.000Z" }, { title: "C job", company: "X", appliedAt: "1850-05-05T00:00:00.000Z" }) }, cookie);
    const results = res.json.results as { reason: string }[];
    expect(results.every((r) => /date was not understood/.test(r.reason))).toBe(true);
    for (const j of Object.values((await readStore()).jobs)) expect(Date.parse(j.appliedAt!)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("stores hostile text as plain text and drops unsafe links", async () => {
    const { cookie } = await signIn();
    await post({ rows: rows({ title: "<script>alert(1)</script>", company: "<img src=x onerror=alert(1)>", location: "'; DROP TABLE jobs;--", url: "javascript:alert(1)", notes: "=HYPERLINK(\"http://evil\")" }) }, cookie);
    const j = Object.values((await readStore()).jobs)[0];
    expect(j.title).toBe("<script>alert(1)</script>");
    expect(j.url).toBe("");
  });

  it.each([
    ["no rows", { rows: [] }],
    ["not an array", { rows: "x" }],
    ["missing body", null],
    ["a row that is not an object", { rows: ["just text"] }],
    ["a title that is far too long", { rows: [{ title: "x".repeat(5000) }] }],
    ["more than 500 rows", { rows: Array.from({ length: 501 }, (_, i) => ({ title: `T${i}` })) }],
    ["wrong types", { rows: [{ title: 5, company: {}, url: [] }] }],
  ])("rejects %s with 400 and changes nothing", async (_n, body) => {
    const { cookie } = await signIn();
    const res = await post(body, cookie);
    expect(res.status).toBe(400);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(0);
  });

  it("refuses an enormous request body (413)", async () => {
    const { cookie } = await signIn();
    const res = await importPOST(call("/api/import", { body: { rows: [{ title: "x" }] }, cookie, headers: { "content-length": "5000000" } }));
    expect(res.status).toBe(413);
  });

  it("limits how fast imports can be sent", async () => {
    const { cookie } = await signIn();
    let last = 200;
    for (let i = 0; i < 70; i++) last = (await importPOST(call("/api/import", { body: { rows: [{ title: `Job ${i}` }], dryRun: true }, cookie }))).status;
    expect(last).toBe(429);
  });

  it("handles 500 rows at once", async () => {
    const { cookie } = await signIn();
    const t0 = Date.now();
    const res = await post({ rows: Array.from({ length: 500 }, (_, i) => ({ title: `Analyst ${i}`, company: `Company ${i % 50}`, location: i % 3 ? "Remote" : "Akron, OH" })) }, cookie);
    expect(res.json.added).toBe(500);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(500);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("many imports at once never lose a row", async () => {
    const { cookie } = await signIn();
    await Promise.all(Array.from({ length: 20 }, (_, i) => post({ rows: [{ title: `Job ${i}`, company: "Acme" }] }, cookie)));
    expect(Object.keys((await readStore()).jobs)).toHaveLength(20);
  });
});

describe("a check (Check now and the scheduled run)", () => {
  const withAdzuna = () => { process.env.ADZUNA_APP_ID = "id"; process.env.ADZUNA_APP_KEY = "key"; };
  afterEach(() => { delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY; });
  const run = async (cookie: string) => read(await runPOST(call("/api/run", { body: {}, cookie })));

  it("adds new openings and does not add them again", async () => {
    withAdzuna();
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{}, { id: "2000", title: "GRC Analyst", redirect_url: "https://example.com/g" }])));
    const { cookie } = await signIn();
    const first = await run(cookie);
    expect(first.status).toBe(200);
    expect(first.json.added).toBe(2);
    resetRunGuard();
    const second = await run(cookie);
    expect(second.json.added).toBe(0);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(2);
  });

  it("never sends the API key anywhere but the search host, and never shows it in a result", async () => {
    withAdzuna();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => { seen.push(String(url)); return adzuna([{}]); }));
    const { cookie } = await signIn();
    const res = await run(cookie);
    expect(seen.length).toBeGreaterThan(0);
    for (const u of seen) expect(new URL(u).hostname).toBe("api.adzuna.com");
    expect(JSON.stringify(res.json)).not.toContain("key");
  });

  it("fills in pay and job type on a listing saved before they were captured", async () => {
    withAdzuna();
    const { cookie } = await signIn();
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{}])));
    await run(cookie);
    expect(Object.values((await readStore()).jobs)[0].salaryMin).toBeUndefined();
    resetRunGuard();
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{ salary_min: 62000, salary_max: 75000, salary_is_predicted: "1", contract_time: "full_time" }])));
    await run(cookie);
    expect(Object.values((await readStore()).jobs)[0]).toMatchObject({ salaryMin: 62000, salaryMax: 75000, salaryEstimated: true, contractTime: "full_time" });
  });

  it("ignores nonsense pay values", async () => {
    withAdzuna();
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{ salary_min: 25, salary_max: 99999999 }])));
    const { cookie } = await signIn();
    await run(cookie);
    const j = Object.values((await readStore()).jobs)[0];
    expect(j.salaryMin).toBeUndefined();
    expect(j.salaryMax).toBeUndefined();
  });

  it("does not re-add a job you imported as applied, even when the place differs", async () => {
    withAdzuna();
    const { cookie } = await signIn();
    await importPOST(call("/api/import", { body: { rows: [{ title: "SOC Analyst I", company: "Acme" }] }, cookie }));
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{}])));
    const res = await run(cookie);
    expect(res.json.added).toBe(0);
    const jobs = Object.values((await readStore()).jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("applied");
  });

  it("does not re-add an imported job when the search spells the place differently", async () => {
    withAdzuna();
    const { cookie } = await signIn();
    await importPOST(call("/api/import", { body: { rows: [{ title: "SOC Analyst I", company: "Acme", location: "Akron, OH" }] }, cookie }));
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{ location: { display_name: "Akron, Summit County" } }])));
    const res = await run(cookie);
    expect(res.json.added).toBe(0);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(1);
  });

  it.each([
    ["the search service is down (500)", () => new Response("oops", { status: 500 })],
    ["the key is rejected (401)", () => new Response("no", { status: 401 })],
    ["it rate-limits you (429)", () => new Response("slow down", { status: 429 })],
    ["it returns text, not JSON", () => new Response("<html>hi</html>", { status: 200 })],
    ["it returns the wrong shape", () => new Response(JSON.stringify({ results: "nope" }), { status: 200 })],
    ["it returns an empty body", () => new Response("", { status: 200 })],
  ])("copes when %s: reports a note and keeps your list intact", async (_n, make) => {
    withAdzuna();
    const { cookie } = await signIn();
    await importPOST(call("/api/import", { body: { rows: [{ title: "Keep Me", company: "Acme" }] }, cookie }));
    vi.stubGlobal("fetch", vi.fn(async () => make()));
    const res = await run(cookie);
    expect(res.status).toBe(200);
    expect(res.json.added).toBe(0);
    expect((res.json.errors as string[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(res.json)).not.toMatch(/key=|app_key|app_id/);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(1);
  });

  it("copes when the network fails or times out", async () => {
    withAdzuna();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { cookie } = await signIn();
    const res = await run(cookie);
    expect(res.status).toBe(200);
    expect((res.json.errors as string[]).length).toBeGreaterThan(0);
  });

  it("says plainly when no search key is configured", async () => {
    const { cookie } = await signIn();
    const res = await run(cookie);
    expect(JSON.stringify(res.json.errors)).toMatch(/Adzuna skipped/);
  });

  it("refuses a second check while one is running (409)", async () => {
    withAdzuna();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return adzuna([{}]); }));
    const { cookie } = await signIn();
    const first = runPOST(call("/api/run", { body: {}, cookie }));
    await new Promise((r) => setTimeout(r, 20));
    const second = await read(await runPOST(call("/api/run", { body: {}, cookie })));
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it("makes you wait between checks (429 with Retry-After) so a double-click cannot burn your search requests", async () => {
    withAdzuna();
    const fetchMock = vi.fn(async () => adzuna([{}]));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = await signIn();
    expect((await runPOST(call("/api/run", { body: {}, cookie }))).status).toBe(200);
    const calls = fetchMock.mock.calls.length;
    const again = await runPOST(call("/api/run", { body: {}, cookie }));
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("releases the guard even when a check fails, so the next one can run", async () => {
    withAdzuna();
    vi.stubGlobal("fetch", vi.fn(async () => adzuna([{}])));
    const { cookie } = await signIn();
    writeFileSync(path.join(dataDir(), "profile.json"), "{ not valid");
    expect((await runPOST(call("/api/run", { body: {}, cookie }))).status).toBe(500);
    writeFileSync(path.join(dataDir(), "profile.json"), JSON.stringify({
      queries: ["soc analyst"], localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 48, towns: ["akron"] },
      maxYearsExperience: 2, certsHeld: [], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7,
    }));
    resetRunGuard();
    expect((await runPOST(call("/api/run", { body: {}, cookie }))).status).toBe(200);
  });

  it("validates the area sent with the check", async () => {
    const { cookie } = await signIn();
    const bad = await runPOST(call("/api/run", { body: { location: { query: "<script>", radiusMiles: 30 } }, cookie }));
    expect(bad.status).toBe(400);
    const worse = await runPOST(call("/api/run", { body: { location: { query: "Akron", radiusMiles: -4 } }, cookie }));
    expect(worse.status).toBe(400);
  });
});

describe("the scheduled check endpoint", () => {
  it("needs the secret, compared safely", async () => {
    for (const header of [undefined, "", "Bearer ", "Bearer wrong", "bearer cron-secret-cron-secret-cron-secret-12", "cron-secret-cron-secret-cron-secret-12x"]) {
      const res = await cronGET(call("/api/cron", { method: "GET", origin: null, headers: header === undefined ? {} : { authorization: header } }));
      expect(res.status, String(header)).toBe(401);
    }
  });
  it("runs with the right secret", async () => {
    const res = await cronGET(call("/api/cron", { method: "GET", origin: null, headers: { authorization: "Bearer cron-secret-cron-secret-cron-secret-12" } }));
    expect(res.status).toBe(200);
  });
  it("is not callable with a session cookie instead of the secret", async () => {
    const { cookie } = await signIn();
    const res = await cronGET(call("/api/cron", { method: "GET", origin: null, cookie }));
    expect(res.status).toBe(401);
  });
});
