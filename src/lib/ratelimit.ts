// In-memory fixed-window limiter. Fine for one local instance; use a shared store if this is ever scaled out.
const hits = new Map<string, { n: number; reset: number }>();

function sweep(now: number) {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}

/** Counts this attempt. Returns true if allowed, false once `max` is exceeded within the window. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  e.n += 1;
  return e.n <= max;
}

/** True if `max` hits have already been recorded in the current window (does not count anything). */
export function isBlocked(key: string, max: number): boolean {
  const e = hits.get(key);
  return !!e && e.reset >= Date.now() && e.n >= max;
}

/** Records a failure. Used for sign-in so that successful sign-ins never count against the limit. */
export function recordHit(key: string, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const e = hits.get(key);
  if (!e || e.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
  else e.n += 1;
}

export function resetLimits() {
  hits.clear();
}
