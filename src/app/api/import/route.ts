import { NextResponse, type NextRequest } from "next/server";
import { importBodySchema, commitImport, previewImport } from "@/lib/importjobs";
import { allow } from "@/lib/ratelimit";
import { sameOrigin, sessionFromRequest } from "@/lib/session";
import { getProfile } from "@/lib/settings";

const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Preview (dryRun) or save a batch of applications. Requires a signed-in session; the body is validated here.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const auth = sessionFromRequest(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  if (!allow(`import:${auth.user.id}`, 60, 10 * 60_000)) return json({ error: "Too many imports. Try again in a few minutes." }, 429);
  if (Number(req.headers.get("content-length") ?? 0) > 2_000_000) return json({ error: "That is too large. Import up to 500 rows at a time." }, 413);

  const parsed = importBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the rows and try again. You can import up to 500 at a time." }, 400);
  try {
    const profile = await getProfile();
    const summary = parsed.data.dryRun ? await previewImport(parsed.data.rows, profile) : await commitImport(parsed.data.rows, profile);
    return json(summary);
  } catch {
    return json({ error: "The import failed. Your list was not changed." }, 500);
  }
}
