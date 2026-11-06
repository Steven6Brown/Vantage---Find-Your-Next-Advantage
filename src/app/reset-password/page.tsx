import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { ResetForm } from "@/components/AuthForms";
import { tokenIsValid } from "@/lib/accounts";

export const metadata: Metadata = { title: "Choose a new password" };

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || !tokenIsValid(token, "reset")) {
    return (
      <AuthFrame title="This link no longer works" sub="Reset links expire after 30 minutes and can be used once.">
        <Link className="btn primary" href="/forgot-password">Request a new link</Link>
      </AuthFrame>
    );
  }
  return <ResetForm token={token} />;
}
