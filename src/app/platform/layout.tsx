import { getLocale, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { AppShell, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";

/** Platform console (our team). Metadata only: no access to any customer content. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platformNav");

  const sections: NavSection[] = [
    {
      items: [
        { href: "/platform", label: t("companies"), icon: "companies", exact: true },
        { href: "/platform/plans", label: t("plans"), icon: "plans" },
        { href: "/platform/models", label: t("models"), icon: "models" },
        { href: "/platform/audit", label: t("audit"), icon: "audit" },
      ],
    },
    {
      label: t("monitoring"),
      items: [
        { href: "/platform/usage", label: t("usage"), icon: "usage" },
        { href: "/platform/health", label: t("health"), icon: "health" },
      ],
    },
  ];

  return (
    <AppShell
      sections={sections}
      context={{ title: t("title"), subtitle: t("subtitle") }}
      user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
      menuLinks={[]}
      footerLink={ctx.active ? { href: "/", label: t("backToApp"), icon: "back" } : undefined}
      locale={(await getLocale()) as "fr" | "en"}
      labels={await getShellLabels()}
    >
      {children}
    </AppShell>
  );
}
