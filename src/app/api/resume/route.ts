import { NextResponse, type NextRequest } from "next/server";
import { extractResumeText, MAX_RESUME_BYTES, parseResume } from "@/lib/resume";
import { sameOrigin, sessionFromRequest } from "@/lib/session";
import { writeSettings } from "@/lib/settings";

const guard = (req: NextRequest) =>
  !sameOrigin(req)
    ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
    : !sessionFromRequest(req)
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : null;

// The file is read in memory and discarded; only the parsed structure (no contact details) is saved.
export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MAX_RESUME_BYTES) return NextResponse.json({ error: "File must be under 2 MB" }, { status: 413 });
  try {
    const text = await extractResumeText(Buffer.from(await file.arrayBuffer()), file.name);
    const summary = parseResume(text);
    await writeSettings((s) => ({
      ...s,
      certsHeld: summary.certs.length ? [...new Set([...(s.certsHeld ?? []), ...summary.certs])] : s.certsHeld,
      resume: { ...summary, updatedAt: new Date().toISOString() },
    }));
    return NextResponse.json({ terms: summary.terms.length, experience: summary.experience.length, projects: summary.projects.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read that file" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  await writeSettings((s) => ({ ...s, resume: undefined }));
  return NextResponse.json({ ok: true });
}
