import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { VerifyEmail } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthFrame title="Verification link missing" sub="Open the link from your verification email, or request a new one from the Security page.">
        <Link className="btn primary" href="/">Go to Vantage</Link>
      </AuthFrame>
    );
  }
  return <VerifyEmail token={token} />;
}
