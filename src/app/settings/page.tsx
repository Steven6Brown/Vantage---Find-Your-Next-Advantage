import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { LocationForm, QueriesForm, ResumePanel } from "@/components/SettingsForms";
import { requireSession } from "@/lib/session";
import { getProfile, readSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();
  const [settings, profile] = await Promise.all([readSettings(), getProfile()]);
  return (
    <main id="main" className="wrap">
      <PageHeader title="Settings">
        Your search area, job titles, resume and certifications. Everything here stays on this computer.
      </PageHeader>
      <LocationForm query={profile.localArea.adzunaWhere} radiusMiles={Math.round(profile.localArea.distanceKm / 1.609)} />
      <QueriesForm queries={profile.queries} areaLabel={profile.localArea.label} />
      <ResumePanel resume={settings.resume ?? null} certs={settings.certsHeld ?? settings.resume?.certs ?? profile.certsHeld} />
    </main>
  );
}
