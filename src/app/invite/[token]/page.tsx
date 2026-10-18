import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/public-env";
import { LoginForm } from "@/modules/identity/ui/login-form";
import { AcceptInvitation } from "@/modules/organizations/ui/accept-invitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("metaTitle") };
}

/** Link from the invitation email. Signed-out visitors sign in first, then accept. */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("invite");

  if (!ctx) {
    return (
      <div className="w-full max-w-sm space-y-8">
        <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">{t("signInFirst")}</p>
        <LoginForm
          next={`/invite/${token}`}
          googleEnabled={publicEnv.googleAuthEnabled}
          linkError={null}
          showLocalMailHint={process.env.NODE_ENV === "development"}
        />
      </div>
    );
  }
  return <AcceptInvitation token={token} email={ctx.user.email} />;
}
