import path from "node:path";
import { z } from "zod";
import { backupFile, quarantine, readTextIfExists, writeFileAtomic } from "./jsonfile";
import { dataDir } from "./paths";
import { loadProfile } from "./store";
import type { Profile } from "./types";

const settingsFile = () => path.join(dataDir(), "settings.json");
const MILES_TO_KM = 1.609;

export const locationSchema = z.object({
  // ZIP or "City, ST". Allowlist characters; this value goes into a search query string.
  query: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9 .,'-]+$/),
  radiusMiles: z.number().int().min(5).max(100),
});
export type LocationSetting = z.infer<typeof locationSchema>;

// A job title or phrase sent to the job search. Allowlisted characters only (it goes into a query string).
export const queryTermSchema = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9 .,&/+'-]+$/);
export const queriesSchema = z
  .array(queryTermSchema)
  .min(1)
  .max(12)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((q) => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase())); // keep the first of any duplicates
  });

const entrySchema = z.object({
  heading: z.string(),
  months: z.number().nullable(),
  bullets: z.array(z.string()),
});

export const settingsSchema = z.object({
  location: locationSchema.optional(),
  queries: queriesSchema.optional(),
  certsHeld: z.array(z.string().max(40)).max(40).optional(),
  // Derived from the resume only (contact details removed). The resume file itself is never stored.
  resume: z
    .object({
      terms: z.array(z.string()),
      certs: z.array(z.string()),
      credentials: z.array(z.string()).default([]),
      education: z.array(z.string()).default([]),
      hasBachelor: z.boolean().default(false),
      relatedYears: z.number().nullable().default(null),
      experience: z.array(entrySchema).default([]),
      projects: z.array(entrySchema).default([]),
      evidence: z.record(z.string(), z.string()).default({}),
      updatedAt: z.string(),
    })
    .optional()
    // An old or malformed resume block is dropped instead of discarding location/cert settings.
    .catch(undefined),
});
export type Settings = z.infer<typeof settingsSchema>;

/**
 * Reads saved settings. A file that is not valid JSON, or does not match the expected shape, is moved
 * aside (never deleted) so a later save cannot overwrite it, and the app falls back to defaults.
 */
export async function readSettings(): Promise<Settings> {
  const file = settingsFile();
  const r = await readTextIfExists(file);
  if (r.kind === "missing") return {};
  let json: unknown;
  try {
    json = JSON.parse(r.text);
  } catch {
    await quarantine(file, "corrupt");
    return {};
  }
  const parsed = settingsSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  await quarantine(file, "invalid");
  return {};
}

let queue: Promise<unknown> = Promise.resolve();

/** Changes settings one at a time, so two saves at once cannot overwrite each other. */
export function writeSettings(patch: (s: Settings) => Settings): Promise<Settings> {
  const run = queue.then(async () => {
    const next = settingsSchema.parse(patch(await readSettings()));
    const file = settingsFile();
    await backupFile(file);
    await writeFileAtomic(file, JSON.stringify(next, null, 2));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Base profile + saved settings + optional one-off location override for a single run. */
export async function getProfile(locationOverride?: LocationSetting): Promise<Profile> {
  const base = loadProfile();
  const s = await readSettings();
  const loc = locationOverride ?? s.location;
  const profile: Profile = { ...base };

  if (loc) {
    const city = loc.query.includes(",") ? loc.query.split(",")[0].trim().toLowerCase() : "";
    profile.localArea = {
      label: loc.query,
      adzunaWhere: loc.query,
      distanceKm: Math.round(loc.radiusMiles * MILES_TO_KM),
      // The base town list belongs to the default area, so drop it for a custom location.
      towns: city ? [city] : [],
    };
  }
  if (s.queries) profile.queries = s.queries; // the user's own search terms replace the defaults
  const certs = s.certsHeld ?? s.resume?.certs ?? [];
  profile.certsHeld = [...new Set([...base.certsHeld, ...certs])];
  profile.resumeSkills = s.resume?.terms ?? [];
  profile.resumeHasBachelor = s.resume?.hasBachelor ?? false;
  return profile;
}
