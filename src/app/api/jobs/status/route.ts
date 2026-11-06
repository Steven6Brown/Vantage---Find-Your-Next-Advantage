import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, sessionFromRequest } from "@/lib/session";
import { setStatus } from "@/lib/store";
import { STATUSES } from "@/lib/types";

const body = z.object({
  id: z.string().regex(/^[a-f0-9]{20}$/),
  status: z.enum(STATUSES as [string, ...string[]]),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!sessionFromRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const ok = await setStatus(parsed.data.id, parsed.data.status as (typeof STATUSES)[number]);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
