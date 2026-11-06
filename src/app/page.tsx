import type { Metadata } from "next";
import { RunPanel } from "@/components/Controls";
import { FilterBar, type FilterGroup } from "@/components/FilterBar";
import { JobBoard, type BoardJob, type SortLink } from "@/components/JobBoard";
import { PageHeader } from "@/components/PageHeader";
import { ResendVerify } from "@/components/SecurityPanels";
import { payLabel, postedTime, SETTING_LABELS, workSettingOf } from "@/lib/attributes";
import { formatDay } from "@/lib/dates";
import { explainJob } from "@/lib/explain";
import {
  applyFilters, facets, isFiltering, nextSort, parseFilters, parseSort, sortJobs,
  type Facet, type Filters, type Sort, type SortKey,
} from "@/lib/filters";
import { safeUrl } from "@/lib/http";
import { EXCLUDED_DESCRIPTION, ROLE_TYPES, roleTypeOf } from "@/lib/match";
import { requireSession } from "@/lib/session";
import { getProfile, readSettings } from "@/lib/settings";
import { readStore } from "@/lib/store";
import type { StoredJob } from "@/lib/types";

export const metadata: Metadata = { title: "Openings" };
export const dynamic = "force-dynamic";

const VIEWS = {
  active: { label: "To review", test: (j: StoredJob) => ["new", "seen", "saved"].includes(j.status) && j.match.verdict !== "mismatch" },
  applied: { label: "Applied", test: (j: StoredJob) => j.status === "applied" },
  mismatch: { label: "Likely mismatches", test: (j: StoredJob) => j.match.verdict === "mismatch" && j.status !== "dismissed" },
  dismissed: { label: "Dismissed", test: (j: StoredJob) => j.status === "dismissed" },
} as const;
type ViewKey = keyof typeof VIEWS;

const MAX_ROWS = 100;

const SORTS: { label: string; s: Sort }[] = [
  { label: "Best match", s: { key: "score", dir: "desc" } },
  { label: "Newest", s: { key: "newest", dir: "desc" } },
  { label: "Oldest", s: { key: "newest", dir: "asc" } },
  { label: "Title A to Z", s: { key: "title", dir: "asc" } },
  { label: "Company A to Z", s: { key: "company", dir: "asc" } },
];

/** A link that keeps the current view, filters and sort. */
function href(view: ViewKey, f: Filters, s?: Sort) {
  const p = new URLSearchParams({ view });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (s) { p.set("sort", s.key); p.set("dir", s.dir); }
  return `/?${p.toString()}`;
}

function foundLabel(t: number): string {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireSession();
  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "";
  const key: ViewKey = view in VIEWS ? (view as ViewKey) : "active";
  const filters = parseFilters(sp);
  const sort = parseSort(sp);

  const [store, profile, settings] = await Promise.all([readStore(), getProfile(), readSettings()]);
  const resume = settings.resume ?? null;
  const all = Object.values(store.jobs);
  const viewJobs = all.filter(VIEWS[key].test);
  const filtered = applyFilters(viewJobs, filters);
  // On the Applied tab, "date" means the day you applied; elsewhere it is when the opening was posted.
  const timeOf = (j: StoredJob) => (key === "applied" ? Date.parse(j.appliedAt ?? "") || postedTime(j) : postedTime(j));
  const sorted = sortJobs(filtered, sort, timeOf).slice(0, MAX_ROWS);

  // Position by date posted, so the Market view reads oldest to newest regardless of the table sort.
  const byDate = [...filtered].sort((a, b) => timeOf(a) - timeOf(b));
  const order = new Map(byDate.map((j, i) => [j.id, i]));

  const board: BoardJob[] = sorted.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    url: safeUrl(j.url),
    status: j.status,
    verdict: j.match.verdict,
    score: j.match.score,
    role: roleTypeOf(j.title).label,
    where: j.location || !j.imported ? SETTING_LABELS[workSettingOf(j)] : "Not listed",
    pay: payLabel(j),
    found: key === "applied" && j.appliedAt ? formatDay(j.appliedAt) : foundLabel(timeOf(j)),
    order: order.get(j.id) ?? 0,
    imported: j.imported === true,
    info: explainJob(j, resume, profile),
  }));

  const sortLinks: SortLink[] = (
    [["title", "Opening"], ["score", "Match"], ["newest", "Found"]] as [SortKey, string][]
  ).map(([k, label]) => ({
    key: k,
    label,
    href: href(key, filters, nextSort(sort, k)),
    aria: sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none",
  }));

  /* ---- Indeed-style filter chips ---- */
  const f = facets(viewJobs);
  const link = (patch: Partial<Filters>) => href(key, { ...filters, ...patch }, sort);
  function group(id: Exclude<keyof Filters, "q">, label: string, options: Facet[], note?: string): FilterGroup {
    const current = filters[id];
    const shown = options.filter((o) => o.count > 0 || o.value === current);
    return {
      id,
      label,
      selected: current ? (options.find((o) => o.value === current)?.label ?? current) : null,
      note: shown.length === 0 ? note : undefined,
      options: [
        { label: "Any", href: link({ [id]: "" } as Partial<Filters>), active: !current },
        ...shown.map((o) => ({
          label: o.label,
          count: o.count,
          active: o.value === current,
          href: link({ [id]: o.value === current ? "" : o.value } as Partial<Filters>),
        })),
      ],
    };
  }
  const currentSort = SORTS.find((o) => o.s.key === sort.key && o.s.dir === sort.dir);
  const groups: FilterGroup[] = [
    group("posted", "Date posted", f.posted),
    group("pay", "Pay", f.pay, "No opening lists its pay yet. Pay appears here as new checks bring it in."),
    group("jtype", "Job type", f.jtype, "No opening states its job type yet. It appears as new checks bring it in."),
    group("level", "Experience level", f.level),
    group("setting", "Work setting", f.setting),
    group("company", "Company", f.company),
    group("role", "Job category", f.role),
    group("fit", "Match", f.fit),
    {
      id: "sort",
      label: "Sort by",
      plain: true,
      selected: currentSort?.label ?? null,
      options: SORTS.map((o) => ({
        label: o.label,
        href: href(key, filters, o.s),
        active: o.s.key === sort.key && o.s.dir === sort.dir,
      })),
    },
  ];
  const hidden: [string, string][] = [
    ["view", key], ["sort", sort.key], ["dir", sort.dir],
    ...(Object.entries(filters).filter(([k, v]) => k !== "q" && v) as [string, string][]),
  ];

  const counts = Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((k) => [k, all.filter(VIEWS[k].test).length]));
  const lastRun = store.runs.at(-1);
  const toReview = all.filter(VIEWS.active.test);
  const fitCount = toReview.filter((j) => j.match.verdict === "fit").length;
  const miles = Math.round(profile.localArea.distanceKm / 1.609);
  const adzunaOn = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  const boards = profile.greenhouseBoards.length + profile.leverCompanies.length;

  return (
    <main id="main" className="wrap">
      <PageHeader title="Openings">
        {toReview.length === 0
          ? "No openings to review yet."
          : `${toReview.length} to review. ${fitCount} fit your profile.`}{" "}
        {lastRun
          ? `Last checked ${new Date(lastRun.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}: ${lastRun.fetched} fetched, ${lastRun.added} new.`
          : "No check has run yet."}{" "}
        Vantage finds and ranks openings. You review each one and apply yourself.
      </PageHeader>

      {store.recoveredFrom && (
        <div className="note" role="status">
          Your saved openings file could not be read, so Vantage started a fresh list. The unreadable copy was kept as{" "}
          <code>{store.recoveredFrom.split(/[\\/]/).pop()}</code> in your data folder; nothing was deleted.
        </div>
      )}

      {!auth.user.emailVerified && (
        <div className="note">
          <p style={{ margin: "0 0 10px" }}>Your email address isn&apos;t verified yet. Password reset emails are only sent to a verified address.</p>
          <ResendVerify />
        </div>
      )}

      <RunPanel defaults={{ query: profile.localArea.adzunaWhere, radiusMiles: miles }} />

      <details className="scope">
        <summary>
          <b>What&apos;s being searched:</b> {profile.queries.length} job title{profile.queries.length === 1 ? "" : "s"} within {miles} miles of {profile.localArea.label}, plus remote
        </summary>
        <div className="scope-body">
          <div>
            <p className="subhead">Job titles searched</p>
            <ul className="chips">{profile.queries.map((q) => <li className="chip" key={q}>{q}</li>)}</ul>
            <p className="sub"><a href="/settings">Change job titles in Settings</a></p>
          </div>
          <div>
            <p className="subhead">Sources</p>
            <ul>
              <li>{adzunaOn ? "Adzuna job search is on" : "Adzuna job search is off (no API key set)"}</li>
              <li>{boards ? `${boards} employer board${boards === 1 ? "" : "s"} added` : "No employer boards added"}</li>
            </ul>
          </div>
          <div>
            <p className="subhead">What gets kept</p>
            <ul className="chips">{ROLE_TYPES.map((r) => <li className="chip" key={r.id}>{r.label}</li>)}</ul>
            <p className="subhead" style={{ marginTop: 12 }}>Never kept</p>
            <ul>{EXCLUDED_DESCRIPTION.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      </details>

      {lastRun?.errors.length ? (
        <details className="note">
          <summary>{lastRun.errors.length} note{lastRun.errors.length === 1 ? "" : "s"} from the last check</summary>
          <ul>{lastRun.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      ) : null}

      <JobBoard
        foundHeading={key === "applied" ? "Applied" : "Found"}
        jobs={board}
        sortLinks={sortLinks}
        controls={
          <>
            <nav className="tabs" aria-label="Opening lists">
              {(Object.keys(VIEWS) as ViewKey[]).map((k) => (
                <a key={k} href={href(k, filters, sort)} aria-current={k === key ? "page" : undefined}>
                  {VIEWS[k].label}<span className="n">{counts[k]}</span>
                </a>
              ))}
            </nav>
            <FilterBar groups={groups} query={filters.q} hidden={hidden} clearHref={isFiltering(filters) ? `/?view=${key}` : null} />
            <p className="result-line" role="status">
              {board.length} of {viewJobs.length} openings in {VIEWS[key].label}.
              {filtered.length > MAX_ROWS ? ` The table shows the first ${MAX_ROWS}; narrow the filters to see the rest.` : ""}
            </p>
          </>
        }
        empty={
          <div className="empty">
            <strong>{isFiltering(filters) ? "No openings match these filters" : "No openings here yet"}</strong>
            {isFiltering(filters) ? (
              <a href={`/?view=${key}`}>Clear all filters</a>
            ) : (
              "Run a check above to pull openings that match your search."
            )}
          </div>
        }
      />
    </main>
  );
}
