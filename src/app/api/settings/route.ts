import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, sessionFromRequest } from "@/lib/session";
import { locationSchema, queriesSchema, writeSettings } from "@/lib/settings";

const body = z.object({
  location: locationSchema.optional(),
  queries: queriesSchema.optional(),
  certsHeld: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!sessionFromRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings. Search terms need 2-40 letters or numbers; keep 1 to 12 of them." }, { status: 400 });
  const { location, queries, certsHeld } = parsed.data;
  await writeSettings((s) => ({
    ...s,
    ...(location ? { location } : {}),
    ...(queries ? { queries } : {}),
    ...(certsHeld ? { certsHeld } : {}),
  }));
  return NextResponse.json({ ok: true });
}
