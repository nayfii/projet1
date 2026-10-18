import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "@/modules/identity/ui/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null, publicEnv.appUrl);
  if (await getAppContext()) redirect(next);

  const error = typeof params.error === "string" ? params.error : null;
  return (
    <LoginForm
      next={next}
      googleEnabled={publicEnv.googleAuthEnabled}
      linkError={error === "link_invalid" ? "linkInvalid" : error === "oauth_failed" ? "oauthFailed" : null}
      showLocalMailHint={process.env.NODE_ENV === "development"}
    />
  );
}
