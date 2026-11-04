import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/modules/identity/ui/password-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotTitle") };
}

/** Public: asks for a link to choose a new password. */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
