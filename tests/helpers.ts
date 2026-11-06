import { NextRequest } from "next/server";

// Helpers for calling route handlers directly, the way the browser would, with a real session.

export const ORIGIN = "http://localhost";

export async function signIn(): Promise<{ cookie: string; userId: number }> {
  const A = await import("../src/lib/accounts");
  let user = A.findUserByEmail("owner@example.com");
  if (!user) {
    const r = await A.createOwner("owner@example.com", "correct horse battery staple 42");
    if (!r.ok) throw new Error(r.error);
    user = r.user;
  }
  const s = A.startSession(user.id, { remember: false, mfaVerified: true, ip: "127.0.0.1", ua: "vitest" });
  return { cookie: `aq_session=${s.token}`, userId: user.id };
}

export function call(path: string, o: { method?: string; body?: unknown; form?: FormData; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  }
  return new NextRequest(`${ORIGIN}${path}`, { method: o.method ?? (body ? "POST" : "GET"), headers, body });
}

export async function read(res: Response): Promise<{ status: number; json: Record<string, unknown> }> {
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* no body */ }
  return { status: res.status, json };
}

/** A fake Adzuna search response. */
export function adzuna(results: Array<Partial<Record<string, unknown>>>) {
  return new Response(
    JSON.stringify({
      results: results.map((r, i) => ({
        id: String(1000 + i), title: "SOC Analyst I", description: "Monitor alerts. Entry-level.", redirect_url: `https://example.com/job/${i}`,
        created: new Date().toISOString(), company: { display_name: "Acme" }, location: { display_name: "Akron, Summit County" },
        ...r,
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
