import { getLocale, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { isCompanyAdmin } from "@/lib/auth/context";
import { AppShell, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";

/** Member app: every signed-in employee of an active company. */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireMember();
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("roles");

  const sections: NavSection[] = [
    {
      items: [
        { href: "/", label: t("home"), icon: "home", exact: true },
        { href: "/chat", label: t("conversations"), icon: "chat", soon: true },
      ],
    },
    {
      label: t("workspace"),
      items: [
        { href: "/clients", label: t("clients"), icon: "clients" },
        { href: "/memory", label: t("memory"), icon: "memory", soon: true },
        { href: "/library", label: t("library"), icon: "library", soon: true },
      ],
    },
  ];

  return (
    <AppShell
      sections={sections}
      context={{ title: ctx.active.companyName, subtitle: tRoles(ctx.active.role) }}
      user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
      menuLinks={[{ href: "/profile", label: t("profile"), icon: "profile" }]}
      footerLink={isCompanyAdmin(ctx.active) ? { href: "/admin", label: t("adminConsole"), icon: "settings" } : undefined}
      locale={(await getLocale()) as "fr" | "en"}
      labels={await getShellLabels()}
    >
      {children}
    </AppShell>
  );
}
