import { createHash } from "node:crypto";
import { normalizeForDedupe } from "./match";

export const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

/** Stable id for an opening from one source. */
export const jobIdOf = (source: string, externalId: string) => sha(`${source}:${externalId}`);

/** Same opening seen on different sources: company, title and place, ignoring case, punctuation and "Inc". */
export const dedupeKeyOf = (company: string, title: string, location: string) =>
  sha(`${normalizeForDedupe(company)}|${normalizeForDedupe(title)}|${normalizeForDedupe(location)}`);

const TRACKING = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref", "from", "tk", "vjs", "advn", "adid", "xpse", "xfps", "sjdu", "cmp", "ceid"]);

/**
 * A link reduced to what identifies the posting, so the same job opened from a search page, an email or an
 * application list compares equal. Indeed postings are identified by their "jk" value.
 */
export function urlKeyOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const jk = u.searchParams.get("jk");
    if (host.endsWith("indeed.com") && jk) return `indeed:${jk.toLowerCase()}`;
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_"))
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    return `${host}${u.pathname.replace(/\/+$/, "")}${params.length ? `?${params.join("&")}` : ""}`.toLowerCase();
  } catch {
    return "";
  }
}

const GENERIC_PLACES = new Set(["us", "usa", "unitedstates", "unitedstatesofamerica"]);
const cityOf = (s: string) => normalizeForDedupe(s.split(",")[0] ?? "").replace(/ /g, "");

/**
 * Whether two place names could be the same place. Sources spell places differently
 * ("Akron, Summit County" and "Akron, OH"), so only the city part is compared.
 * An empty or country-wide place is compatible with anything.
 */
export function sameArea(a: string, b: string): boolean {
  const x = cityOf(a), y = cityOf(b);
  if (!x || !y || GENERIC_PLACES.has(x) || GENERIC_PLACES.has(y)) return true;
  return x === y || x.startsWith(y) || y.startsWith(x); // "Cuyahoga" matches "Cuyahoga Falls"; "York" does not match "New York"
}
