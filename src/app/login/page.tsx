import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/AuthForms";
import { ownerExists } from "@/lib/accounts";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!ownerExists()) redirect("/setup");
  if (await getSession()) redirect("/");
  return <LoginForm />;
}
