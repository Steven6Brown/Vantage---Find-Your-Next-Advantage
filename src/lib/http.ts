/** Fetch JSON from a fixed, allowlisted host with a timeout. Errors never include secrets. */
export async function getJson(url: URL, allowedHost: string): Promise<unknown> {
  if (url.protocol !== "https:" || url.hostname !== allowedHost) {
    throw new Error(`Blocked request to unexpected host`);
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json", "User-Agent": "AquilaJobScrubber/0.1" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${allowedHost} responded ${res.status}`);
  return res.json();
}

export function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Only http(s) URLs are ever rendered as links (blocks javascript: etc.). */
export function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}
