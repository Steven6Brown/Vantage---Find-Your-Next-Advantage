import { z } from "zod";
import { clip, getJson, safeUrl, stripHtml } from "../http";
import type { JobSource, RawJob } from "../types";

// Public, no-key job-board feeds for specific employers.

const greenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      title: z.string(),
      absolute_url: z.string(),
      updated_at: z.string().nullish(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      content: z.string().nullish(),
    }),
  ),
});

export function greenhouseSource(board: string): JobSource {
  const HOST = "boards-api.greenhouse.io";
  return {
    name: `Greenhouse:${board}`,
    async fetchJobs() {
      const url = new URL(`https://${HOST}/v1/boards/${encodeURIComponent(board)}/jobs`);
      url.searchParams.set("content", "true");
      const data = greenhouseSchema.parse(await getJson(url, HOST));
      const jobs: RawJob[] = [];
      for (const j of data.jobs) {
        const link = safeUrl(j.absolute_url);
        if (!link) continue;
        jobs.push({
          source: "greenhouse",
          externalId: `${board}:${j.id}`,
          title: clip(stripHtml(j.title), 200),
          company: board,
          location: clip(j.location?.name ?? "", 120),
          description: clip(stripHtml(j.content ?? ""), 8000),
          url: link,
          postedAt: j.updated_at ?? null,
        });
      }
      return jobs;
    },
  };
}

const leverSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    createdAt: z.number().nullish(),
    categories: z.object({ location: z.string().nullish() }).nullish(),
    descriptionPlain: z.string().nullish(),
  }),
);

export function leverSource(company: string): JobSource {
  const HOST = "api.lever.co";
  return {
    name: `Lever:${company}`,
    async fetchJobs() {
      const url = new URL(`https://${HOST}/v0/postings/${encodeURIComponent(company)}`);
      url.searchParams.set("mode", "json");
      const data = leverSchema.parse(await getJson(url, HOST));
      const jobs: RawJob[] = [];
      for (const j of data) {
        const link = safeUrl(j.hostedUrl);
        if (!link) continue;
        jobs.push({
          source: "lever",
          externalId: `${company}:${j.id}`,
          title: clip(stripHtml(j.text), 200),
          company,
          location: clip(j.categories?.location ?? "", 120),
          description: clip(j.descriptionPlain ?? "", 8000),
          url: link,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        });
      }
      return jobs;
    },
  };
}
