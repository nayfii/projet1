import { getLocale, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { AppShell, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";

/** Platform console (our team). Metadata only: no access to any customer content. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platformNav");
  const tPassword = await getTranslations("password");

  const sections: NavSection[] = [
    {
      items: [
        { href: "/platform", label: t("home"), icon: "home", exact: true },
        { href: "/platform/companies", label: t("companies"), icon: "companies" },
        { href: "/platform/plans", label: t("plans"), icon: "plans" },
        { href: "/platform/team", label: t("team"), icon: "members" },
      ],
    },
    {
      label: t("product"),
      items: [
        { href: "/platform/apps", label: t("apps"), icon: "apps" },
        { href: "/platform/releases", label: t("releases"), icon: "releases" },
        { href: "/platform/preview", label: t("preview"), icon: "preview" },
        { href: "/platform/debug", label: t("debug"), icon: "debug" },
      ],
    },
    {
      label: t("monitoring"),
      items: [
        { href: "/platform/usage", label: t("usage"), icon: "usage" },
        { href: "/platform/health", label: t("health"), icon: "health" },
        { href: "/platform/models", label: t("models"), icon: "models" },
        { href: "/platform/audit", label: t("audit"), icon: "audit" },
      ],
    },
  ];

  return (
    <AppShell
      sections={sections}
      context={{ title: t("title"), subtitle: t("subtitle") }}
      user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
      menuLinks={[{ href: "/platform/password", label: tPassword("title"), icon: "shield" }]}
      locale={(await getLocale()) as "fr" | "en"}
      labels={await getShellLabels()}
    >
      {children}
    </AppShell>
  );
}
