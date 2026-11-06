"use client";
import { useEffect, useState } from "react";

const KEY = "vantage-density";
type Density = "roomy" | "compact";

/** Switches the openings table between roomy and compact rows. Remembered on this device. */
export function DensityToggle() {
  const [d, setD] = useState<Density>("roomy");

  useEffect(() => {
    try { setD(localStorage.getItem(KEY) === "compact" ? "compact" : "roomy"); } catch {}
  }, []);

  function toggle() {
    const next: Density = d === "roomy" ? "compact" : "roomy";
    setD(next);
    try {
      if (next === "compact") localStorage.setItem(KEY, "compact");
      else localStorage.removeItem(KEY);
    } catch {}
    if (next === "compact") document.documentElement.dataset.density = "compact";
    else delete document.documentElement.dataset.density;
  }

  return (
    <button type="button" className="btn sm densitybtn" onClick={toggle} aria-pressed={d === "compact"} aria-label="Compact rows">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
      <span className="lbl">Compact</span>
    </button>
  );
}
