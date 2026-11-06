"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "vantage-theme";
const ORDER: Mode[] = ["system", "light", "dark"];
const LABEL: Record<Mode, string> = { system: "Auto", light: "Light", dark: "Dark" };

function apply(mode: Mode) {
  const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = mode === "system" ? (systemLight ? "light" : "dark") : mode;
}

/** Cycles Auto (follows the device), Light and Dark. The choice is remembered on this device. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      setMode(saved === "light" || saved === "dark" ? saved : "system");
    } catch {}
  }, []);

  // In Auto mode, follow the device if it switches while the app is open.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
  }

  return (
    <button type="button" className="btn sm themebtn" onClick={cycle} aria-label={`Color theme: ${LABEL[mode]}. Activate to change.`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
      <span className="lbl">{LABEL[mode]}</span>
    </button>
  );
}
