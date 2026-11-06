/**
 * Shows a date-only value (such as the day you applied) as a calendar day.
 * These are stored as noon UTC, and are always shown in UTC, so the day never shifts with the viewer's time zone.
 */
export function formatDay(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
