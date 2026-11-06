import { z } from "zod";
import { clip, getJson, safeUrl, stripHtml } from "../http";
import type { JobSource, Profile, RawJob } from "../types";

const responseSchema = z.object({
  results: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      title: z.string(),
      description: z.string().default(""),
      redirect_url: z.string(),
      created: z.string().nullish(),
      contract_type: z.string().nullish(),
      contract_time: z.string().nullish(),
      salary_min: z.number().nullish(),
      salary_max: z.number().nullish(),
      salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
      company: z.object({ display_name: z.string().nullish() }).nullish(),
      location: z.object({ display_name: z.string().nullish() }).nullish(),
    }),
  ),
});

/** Adzuna free API: aggregated, ToS-compliant listings. Descriptions are truncated snippets. */
export function adzunaSource(profile: Profile, appId: string, appKey: string): JobSource {
  const HOST = "api.adzuna.com";

  async function search(what: string, where?: string): Promise<RawJob[]> {
    const url = new URL(`https://${HOST}/v1/api/jobs/us/search/1`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("results_per_page", "50");
    url.searchParams.set("what", where ? what : `${what} remote`);
    url.searchParams.set("max_days_old", String(profile.maxDaysOld));
    url.searchParams.set("sort_by", "date");
    if (where) {
      url.searchParams.set("where", where);
      url.searchParams.set("distance", String(profile.localArea.distanceKm));
    }
    const data = responseSchema.parse(await getJson(url, HOST));
    const jobs: RawJob[] = [];
    for (const r of data.results) {
      const link = safeUrl(r.redirect_url);
      if (!link) continue;
      jobs.push({
        source: "adzuna",
        externalId: r.id,
        title: clip(stripHtml(r.title), 200),
        company: clip(r.company?.display_name ?? "Unknown", 120),
        location: clip(r.location?.display_name ?? "", 120),
        description: clip(stripHtml(r.description), 4000),
        url: link,
        postedAt: r.created ?? null,
        nearQuery: Boolean(where),
        contractType: r.contract_type ?? undefined,
        contractTime: r.contract_time ?? undefined,
        // Only plausible yearly amounts are kept (guards against hourly or garbage values).
        salaryMin: r.salary_min && r.salary_min >= 10_000 && r.salary_min < 1_000_000 ? Math.round(r.salary_min) : undefined,
        salaryMax: r.salary_max && r.salary_max >= 10_000 && r.salary_max < 1_000_000 ? Math.round(r.salary_max) : undefined,
        salaryEstimated: r.salary_min != null ? String(r.salary_is_predicted) === "1" : undefined,
      });
    }
    return jobs;
  }

  return {
    name: "Adzuna",
    async fetchJobs() {
      const out: RawJob[] = [];
      const errors: string[] = [];
      // Sequential to stay well inside the free-tier rate limit.
      for (const q of profile.queries) {
        for (const where of [profile.localArea.adzunaWhere, undefined]) {
          try {
            out.push(...(await search(q, where)));
          } catch (e) {
            errors.push(e instanceof Error ? e.message : "unknown error");
          }
        }
      }
      if (!out.length && errors.length) throw new Error(`Adzuna failed: ${errors[0]}`);
      return out;
    },
  };
}
