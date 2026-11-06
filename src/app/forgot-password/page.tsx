import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
