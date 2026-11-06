"use client";
import { Fragment, useState } from "react";
import type { JobExplanation } from "@/lib/explain";
import { InfoPanel, StatusSelect } from "./Controls";

export interface BoardJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string | null;
  status: string;
  verdict: "fit" | "stretch" | "mismatch";
  score: number;
  role: string;
  where: string; // Remote, Hybrid or On-site
  pay: string; // "" when not listed
  found: string; // already formatted on the server
  order: number; // position by date found, oldest first (drives the skyline)
  imported: boolean; // added through Import: not scored
  info: JobExplanation;
}

export interface SortLink {
  key: string;
  label: string;
  href: string;
  aria: "ascending" | "descending" | "none";
}

const VERDICT_LABEL = { fit: "Fit", stretch: "Stretch", mismatch: "Poor fit" } as const;

/** One bar per opening, in the order they were found. Height is the match score. */
function MarketView({ jobs, importedCount, openId, onPick }: { jobs: BoardJob[]; importedCount: number; openId: string | null; onPick: (id: string) => void }) {
  const bars = [...jobs].sort((a, b) => a.order - b.order).slice(-80);
  const count = (v: BoardJob["verdict"]) => jobs.filter((j) => j.verdict === v).length;
  return (
    <section className="market" aria-labelledby="market-h">
      <div className="market-head">
        <div>
          <h2 id="market-h">Market view</h2>
          <p className="cap">Each bar is one opening, oldest to newest. Taller means a stronger match. Select a bar to open its details below.</p>
        </div>
        <div className="stats">
          <div className="stat"><b>{jobs.length}</b><span>openings</span></div>
          <div className="stat"><b>{count("fit")}</b><span>fit</span></div>
          <div className="stat"><b>{count("stretch")}</b><span>stretch</span></div>
        </div>
      </div>
      {bars.length === 0 ? (
        <p className="sub" style={{ marginTop: 16 }}>{importedCount > 0 ? "Applications you imported are not scored, so there is nothing to chart here." : "Nothing to chart yet."}</p>
      ) : (
        <div className="skyline" role="group" aria-label="Openings by match score">
          {bars.map((j, i) => (
            <button
              key={j.id}
              type="button"
              className={`bar ${j.verdict} ${openId === j.id ? "on" : ""}`}
              style={{ height: `${Math.max(j.score, 6)}%`, ["--i" as string]: i }}
              title={`${j.title}, ${j.company}: ${VERDICT_LABEL[j.verdict]}, score ${j.score}`}
              aria-label={`${j.title} at ${j.company}, ${VERDICT_LABEL[j.verdict]}, score ${j.score}`}
              onClick={() => onPick(j.id)}
            />
          ))}
        </div>
      )}
      <div className="legend" aria-hidden="true">
        <span><i className="sw fit" />Fit (solid)</span>
        <span><i className="sw stretch" />Stretch (striped)</span>
        <span><i className="sw mismatch" />Poor fit (outline)</span>
      </div>
    </section>
  );
}

const ExternalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export function JobBoard({ jobs, sortLinks, controls, empty, foundHeading = "Found" }: { jobs: BoardJob[]; sortLinks: SortLink[]; controls: React.ReactNode; empty: React.ReactNode; foundHeading?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sortFor = (key: string) => sortLinks.find((s) => s.key === key);

  function pick(id: string) {
    setOpenId(id);
    // Wait for the row's detail to render, then bring the row into view.
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`job-${id}`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    });
  }

  const Th = ({ k, label }: { k: string; label: string }) => {
    const s = sortFor(k);
    return (
      <th scope="col" aria-sort={s?.aria ?? "none"}>
        {s ? <a href={s.href}>{label}<span className="sr">, sort</span></a> : label}
      </th>
    );
  };

  return (
    <>
      <MarketView jobs={jobs.filter((j) => !j.imported)} importedCount={jobs.filter((j) => j.imported).length} openId={openId} onPick={pick} />
      {controls}
      {jobs.length === 0 ? (
        empty
      ) : (
        <>
          <h2 className="sr">Openings list</h2>
          <div className="board-wrap">
            <table className="board">
              <caption className="sr">Openings. Select Details on a row to see why it was ranked this way.</caption>
              <thead>
                <tr>
                  <Th k="title" label="Opening" />
                  <th scope="col">Where</th>
                  <th scope="col">Pay</th>
                  <Th k="score" label="Match" />
                  <Th k="newest" label={foundHeading} />
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const open = openId === j.id;
                  const panelId = `info-${j.id}`;
                  const toggle = () => setOpenId(open ? null : j.id);
                  return (
                    <Fragment key={j.id}>
                      <tr id={`job-${j.id}`} className={`job ${open ? "open" : ""} ${j.status === "new" ? "fresh" : ""}`}>
                        <td className="first">
                          <button type="button" className="title" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>
                            {j.status === "new" && <span className="dot" role="img" aria-label="New" />}
                            {j.title}
                          </button>
                          <span className="cell-sub">{j.company}, {j.role}</span>
                        </td>
                        <td data-label="Where">
                          {j.where}
                          {j.location && <span className="cell-sub">{j.location}</span>}
                        </td>
                        <td data-label="Pay">{j.pay || <span className="muted">Not listed</span>}</td>
                        <td data-label="Match">
                          {j.imported ? (
                            <span className="pill imported">Imported</span>
                          ) : (
                            <div className="matchcell">
                              <span className={`pill ${j.verdict}`}>{VERDICT_LABEL[j.verdict]}</span>
                              <span className="score">{j.score}</span>
                              <span className="meter" aria-hidden="true"><i style={{ width: `${j.score}%` }} /></span>
                            </div>
                          )}
                        </td>
                        <td data-label={foundHeading}>{j.found}</td>
                        <td data-label="Status"><StatusSelect id={j.id} status={j.status} title={j.title} /></td>
                        <td>
                          <div className="actions-cell">
                            <button type="button" className="btn sm detailsbtn" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle} aria-label={`${open ? "Hide" : "Show"} details for ${j.title}`}>
                              Details <Chevron />
                            </button>
                            {j.url && (
                              <a className="iconlink" href={j.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the posting for ${j.title} in a new tab`} title="Open posting">
                                <ExternalIcon />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail">
                          <td colSpan={7}><InfoPanel info={j.info} panelId={panelId} title={j.title} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
