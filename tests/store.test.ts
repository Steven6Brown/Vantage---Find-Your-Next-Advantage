import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dataDir } from "../src/lib/paths";
import { matchJob } from "../src/lib/match";
import { readSettings, writeSettings } from "../src/lib/settings";
import { readStore, setStatus, withStore } from "../src/lib/store";
import type { Profile, RawJob, StoredJob } from "../src/lib/types";

const profile: Profile = {
  queries: ["soc analyst"], localArea: { label: "Akron, OH", adzunaWhere: "Akron, OH", distanceKm: 48, towns: ["akron"] },
  maxYearsExperience: 2, certsHeld: [], greenhouseBoards: [], leverCompanies: [], maxDaysOld: 7, resumeSkills: [], resumeHasBachelor: false,
};
const storeFile = () => path.join(dataDir(), "store.json");
const settingsFile = () => path.join(dataDir(), "settings.json");
const files = () => readdirSync(dataDir());

function job(n: number): StoredJob {
  const raw: RawJob = { source: "adzuna", externalId: String(n), title: `SOC Analyst ${n}`, company: "Acme", location: "Remote", description: "x", url: "https://example.com/" + n, postedAt: null };
  return { ...raw, id: String(n).padStart(20, "0"), dedupeKey: "k" + n, firstSeen: new Date().toISOString(), status: "new", alsoSeenOn: [], match: matchJob(raw, profile) };
}

beforeEach(() => {
  for (const f of [storeFile(), settingsFile(), `${storeFile()}.bak`, `${settingsFile()}.bak`]) if (existsSync(f)) writeFileSync(f, "");
  for (const f of files()) if (/corrupt|invalid/.test(f)) writeFileSync(path.join(dataDir(), f), "");
});

async function seed(n: number) {
  await withStore((d) => { for (let i = 1; i <= n; i++) d.jobs[job(i).id] = job(i); });
}
const reset = async () => { writeFileSync(storeFile(), JSON.stringify({ jobs: {}, runs: [] })); };

describe("data folder", () => {
  it("is a temporary test folder, never the real data", () => {
    expect(dataDir()).not.toBe(path.join(process.cwd(), "data"));
    expect(existsSync(path.join(dataDir(), ".test-data"))).toBe(true);
  });
});

describe("store: normal use", () => {
  it("starts empty when there is no file", async () => {
    await reset();
    expect(Object.keys((await readStore()).jobs)).toHaveLength(0);
  });
  it("saves and reads back", async () => {
    await reset();
    await seed(3);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(3);
  });
  it("sets and clears the applied date with the status", async () => {
    await reset();
    await seed(1);
    const id = job(1).id;
    expect(await setStatus(id, "applied")).toBe(true);
    const applied = (await readStore()).jobs[id];
    expect(applied.status).toBe("applied");
    expect(Date.parse(applied.appliedAt!)).toBeGreaterThan(Date.now() - 5000);
    await setStatus(id, "saved");
    expect((await readStore()).jobs[id].appliedAt).toBeUndefined();
  });
  it("keeps the original applied date if you click Applied twice", async () => {
    await reset();
    await seed(1);
    const id = job(1).id;
    await withStore((d) => { d.jobs[id].status = "applied"; d.jobs[id].appliedAt = "2026-01-02T00:00:00.000Z"; });
    await setStatus(id, "applied");
    expect((await readStore()).jobs[id].appliedAt).toBe("2026-01-02T00:00:00.000Z");
  });
  it("rejects unknown ids and bad statuses", async () => {
    await reset();
    expect(await setStatus("f".repeat(20), "applied")).toBe(false);
    expect(await setStatus(job(1).id, "hacked" as never)).toBe(false);
  });
});

describe("store: abuse and failure", () => {
  it("never loses an update when many writes happen at once", async () => {
    await reset();
    await seed(60);
    await Promise.all(Array.from({ length: 60 }, (_, i) => setStatus(job(i + 1).id, i % 2 ? "saved" : "applied")));
    const jobs = (await readStore()).jobs;
    expect(Object.values(jobs).filter((j) => j.status === "applied")).toHaveLength(30);
    expect(Object.values(jobs).filter((j) => j.status === "saved")).toHaveLength(30);
  });
  it("leaves no temporary files behind", async () => {
    await reset();
    await seed(5);
    await Promise.all(Array.from({ length: 10 }, (_, i) => setStatus(job(1 + (i % 5)).id, "seen")));
    expect(files().filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("keeps a backup of the previous version", async () => {
    await reset();
    await seed(2);
    await setStatus(job(1).id, "saved");
    expect(existsSync(`${storeFile()}.bak`)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(`${storeFile()}.bak`, "utf8")).jobs).length).toBeGreaterThan(0);
  });
  it("recovers from a corrupt file: moves it aside, starts fresh, says so", async () => {
    writeFileSync(storeFile(), '{"jobs": {"a": ');
    const data = await readStore();
    expect(Object.keys(data.jobs)).toHaveLength(0);
    expect(data.recoveredFrom).toMatch(/^store\.corrupt-.*\.json$/);
    expect(files()).toContain(data.recoveredFrom!);
    expect(readFileSync(path.join(dataDir(), data.recoveredFrom!), "utf8")).toBe('{"jobs": {"a": ');
  });
  it.each([["null"], ["[]"], ['"text"'], ["42"], ["{}"], ['{"jobs": []}'], ['{"jobs": null, "runs": "x"}']])("survives a store file containing %s", async (text) => {
    writeFileSync(storeFile(), text);
    const data = await readStore();
    expect(typeof data.jobs).toBe("object");
    expect(Array.isArray(data.runs)).toBe(true);
    expect(Array.isArray(data.jobs)).toBe(false);
  });
  it("can still save after recovering from corruption", async () => {
    writeFileSync(storeFile(), "garbage");
    await seed(2);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(2);
  });
  it("trims run history to the last 50", async () => {
    await reset();
    await withStore((d) => { for (let i = 0; i < 80; i++) d.runs.push({ at: String(i), fetched: 0, added: 0, errors: [], emailed: "skipped" }); });
    const runs = (await readStore()).runs;
    expect(runs).toHaveLength(50);
    expect(runs[0].at).toBe("30");
  });
  it("an error inside an update does not break later updates", async () => {
    await reset();
    await expect(withStore(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await seed(1);
    expect(Object.keys((await readStore()).jobs)).toHaveLength(1);
  });
});

describe("settings", () => {
  it("never loses an update when saves overlap (the old code could)", async () => {
    writeFileSync(settingsFile(), "{}");
    await Promise.all([
      writeSettings((s) => ({ ...s, location: { query: "Akron, OH", radiusMiles: 30 } })),
      writeSettings((s) => ({ ...s, certsHeld: ["Security+"] })),
      writeSettings((s) => ({ ...s, queries: ["SOC analyst", "GRC analyst"] })),
    ]);
    const s = await readSettings();
    expect(s.location?.query).toBe("Akron, OH");
    expect(s.certsHeld).toEqual(["Security+"]);
    expect(s.queries).toEqual(["SOC analyst", "GRC analyst"]);
  });
  it("handles many overlapping saves", async () => {
    writeFileSync(settingsFile(), "{}");
    await Promise.all(Array.from({ length: 40 }, (_, i) => writeSettings((s) => ({ ...s, certsHeld: [...(s.certsHeld ?? []), `C${i}`] }))));
    expect((await readSettings()).certsHeld).toHaveLength(40);
  });
  it("moves a corrupt settings file aside instead of overwriting it later", async () => {
    writeFileSync(settingsFile(), "{not json");
    expect(await readSettings()).toEqual({});
    const kept = files().find((f) => f.startsWith("settings.corrupt-"));
    expect(kept).toBeTruthy();
    await writeSettings((s) => ({ ...s, certsHeld: ["A"] }));
    expect(readFileSync(path.join(dataDir(), kept!), "utf8")).toBe("{not json");
  });
  it("moves a file with the wrong shape aside too", async () => {
    writeFileSync(settingsFile(), JSON.stringify({ location: { query: "<script>", radiusMiles: 9999 } }));
    expect(await readSettings()).toEqual({});
    expect(files().some((f) => f.startsWith("settings.invalid-"))).toBe(true);
  });
  it("drops an old-format resume block but keeps everything else", async () => {
    writeFileSync(settingsFile(), JSON.stringify({ location: { query: "Akron, OH", radiusMiles: 30 }, resume: { skills: ["x"], yearsMentioned: 3 } }));
    const s = await readSettings();
    expect(s.location?.query).toBe("Akron, OH");
    expect(s.resume).toBeUndefined();
  });
});
