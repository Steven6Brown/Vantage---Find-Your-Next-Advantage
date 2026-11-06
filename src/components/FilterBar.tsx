"use client";
import { useEffect, useId, useRef, useState } from "react";

export interface FilterOption { label: string; href: string; active: boolean; count?: number }
export interface FilterGroup {
  id: string;
  label: string;
  selected: string | null; // label of the chosen option, shown on the chip
  options: FilterOption[];
  note?: string; // shown when there is nothing to choose yet
  plain?: boolean; // never highlighted (used for Sort)
}

const Caret = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** One drop-down chip. Choosing an option follows its link, so the filter is applied straight away. */
function Chip({ group }: { group: FilterGroup }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const on = !group.plain && group.selected !== null;
  return (
    <div className="fwrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={`fchip ${on ? "on" : ""}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {group.selected ? `${group.label}: ${group.selected}` : group.label}
        <Caret />
      </button>
      {open && (
        <ul id={menuId} className="fmenu" aria-label={group.label}>
          {group.options.map((o) => (
            <li key={o.label}>
              <a href={o.href} aria-current={o.active ? "true" : undefined}>
                <span>{o.label}</span>
                {o.count !== undefined && <span className="ct">{o.count}</span>}
              </a>
            </li>
          ))}
          {group.note && <li className="fnote">{group.note}</li>}
        </ul>
      )}
    </div>
  );
}

/** Search box plus filter chips, in the style of Indeed's results page. */
export function FilterBar({ groups, query, hidden, clearHref }: { groups: FilterGroup[]; query: string; hidden: [string, string][]; clearHref: string | null }) {
  return (
    <div role="search" aria-label="Find and filter openings">
      <form method="get" action="/" className="fsearch">
        {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="field">
          <label htmlFor="f-q">Search job title, keywords or company</label>
          <input id="f-q" type="text" name="q" defaultValue={query} maxLength={60} placeholder="For example: analyst, Acme" />
        </div>
        <button className="btn primary">Find openings</button>
      </form>
      <div className="fchips">
        {groups.map((g) => <Chip key={g.id} group={g} />)}
        {clearHref && <a className="fclear" href={clearHref}>Clear all</a>}
      </div>
    </div>
  );
}
