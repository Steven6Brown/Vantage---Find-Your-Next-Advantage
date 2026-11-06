import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { claimRun, RunBlocked, runCheck } from "@/lib/run";
import { sameOrigin, sessionFromRequest } from "@/lib/session";
import { locationSchema, writeSettings } from "@/lib/settings";

export const maxDuration = 60;

const body = z.object({ location: locationSchema.optional(), saveAsDefault: z.boolean().optional() });

// Manual "Check now" from the dashboard. Requires a signed-in session; Origin check is a CSRF backstop.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!sessionFromRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter a ZIP or City, ST and a radius of 5-100 miles" }, { status: 400 });
  const { location, saveAsDefault } = parsed.data;
  let release: () => void;
  try {
    release = claimRun();
  } catch (e) {
    if (e instanceof RunBlocked) return NextResponse.json({ error: e.message }, { status: e.status, headers: e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : undefined });
    throw e;
  }
  try {
    if (location && saveAsDefault) await writeSettings((s) => ({ ...s, location }));
    return NextResponse.json(await runCheck(undefined, location));
  } catch {
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  } finally {
    release();
  }
}
