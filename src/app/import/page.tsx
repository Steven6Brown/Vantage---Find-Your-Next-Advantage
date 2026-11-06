import type { Metadata } from "next";
import { ImportPanel } from "@/components/ImportPanel";
import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Import applications" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireSession();
  return (
    <main id="main" className="wrap">
      <PageHeader title="Import applications">
        Add jobs you applied to elsewhere, such as on Indeed, so Vantage can track them and stop showing them as new openings.
      </PageHeader>
      <ImportPanel />
    </main>
  );
}
