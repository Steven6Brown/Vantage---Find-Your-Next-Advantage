import { readFileSync } from "node:fs";
import path from "node:path";
import { backupFile, quarantine, readTextIfExists, writeFileAtomic } from "./jsonfile";
import { dataDir } from "./paths";
import { profileSchema, STATUSES, type Profile, type Status, type StoreData } from "./types";

// Storage is behind these few functions so a database can replace the JSON file later.
const storeFile = () => path.join(dataDir(), "store.json");

let queue: Promise<unknown> = Promise.resolve();

/** Serialize read-modify-write cycles so concurrent requests cannot clobber each other. */
export function withStore<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const data = await readStore();
    const result = await fn(data);
    await writeStore(data);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

const empty = (): StoreData => ({ jobs: {}, runs: [] });

/**
 * Reads the saved list. A file that cannot be parsed is moved aside (never deleted) and the app
 * starts from an empty list, with `recoveredFrom` naming the kept copy so the page can say so.
 */
export async function readStore(): Promise<StoreData> {
  const file = storeFile();
  const r = await readTextIfExists(file);
  if (r.kind === "missing") return empty();
  try {
    const parsed = JSON.parse(r.text) as Partial<StoreData> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return {
      jobs: parsed.jobs && typeof parsed.jobs === "object" && !Array.isArray(parsed.jobs) ? parsed.jobs : {},
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      ...(typeof parsed.recoveredFrom === "string" ? { recoveredFrom: parsed.recoveredFrom } : {}),
    };
  } catch {
    const kept = await quarantine(file, "corrupt");
    return { ...empty(), recoveredFrom: kept };
  }
}

async function writeStore(data: StoreData): Promise<void> {
  data.runs = data.runs.slice(-50);
  const file = storeFile();
  await backupFile(file);
  await writeFileAtomic(file, JSON.stringify(data, null, 2));
}

export async function setStatus(id: string, status: Status): Promise<boolean> {
  if (!STATUSES.includes(status)) return false;
  return withStore((data) => {
    const job = data.jobs[id];
    if (!job) return false;
    job.status = status;
    // Remember when you applied; forget it if you move the opening out of Applied.
    if (status === "applied") job.appliedAt ??= new Date().toISOString();
    else delete job.appliedAt;
    return true;
  });
}

export function loadProfile(): Profile {
  const raw = readFileSync(path.join(dataDir(), "profile.json"), "utf8");
  return profileSchema.parse(JSON.parse(raw));
}
