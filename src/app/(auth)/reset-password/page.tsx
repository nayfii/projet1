import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/auth/context";
import { ResetPasswordForm } from "@/modules/identity/ui/password-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("resetTitle") };
}

/** Reached from the "forgot password" e-mail link (which signs the person in). */
export default async function ResetPasswordPage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login?next=/reset-password");
  return <ResetPasswordForm email={ctx.user.email} />;
}
