import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqualStr } from "@/lib/auth";
import { claimRun, RunBlocked, runCheck } from "@/lib/run";

export const maxDuration = 60;

// Scheduler entry point: Authorization: Bearer <CRON_SECRET>.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 32 || !timingSafeEqualStr(given, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let release: () => void;
  try {
    release = claimRun();
  } catch (e) {
    if (e instanceof RunBlocked) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  try {
    return NextResponse.json(await runCheck());
  } catch {
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  } finally {
    release();
  }
}
