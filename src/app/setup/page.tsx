import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/AuthForms";
import { ownerExists } from "@/lib/accounts";

export const metadata: Metadata = { title: "Create your account" };

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (ownerExists()) redirect("/login");
  return <SetupForm needsToken={process.env.NODE_ENV === "production"} />;
}
