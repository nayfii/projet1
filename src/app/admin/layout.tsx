import { getLocale, getTranslations } from "next-intl/server";
import { requireCompanyAdmin } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { AppShell, type NavItem, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";
import type { AdminScope } from "@/modules/organizations/scopes";

/** Company admin console: Owner, and Admins for the scopes the Owner delegated. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyAdmin();
  const t = await getTranslations("adminNav");
  const tRoles = await getTranslations("roles");

  const item = (scope: AdminScope | null, entry: NavItem): NavItem[] =>
    scope === null || hasScope(ctx.active, scope) ? [entry] : [];

  const allSections: NavSection[] = [
    { items: [{ href: "/admin", label: t("overview"), icon: "overview", exact: true }] },
    {
      label: t("team"),
      items: [
        ...item("members", { href: "/admin/members", label: t("members"), icon: "members" }),
        ...item("clients", { href: "/admin/clients", label: t("clients"), icon: "clients" }),
        ...item("permissions", { href: "/admin/permissions", label: t("permissions"), icon: "permissions" }),
      ],
    },
    {
      label: t("ai"),
      items: [
        ...item("models", { href: "/admin/models", label: t("models"), icon: "models" }),
        ...item("agents", { href: "/admin/agents", label: t("agents"), icon: "agents" }),
        ...item("hide", { href: "/admin/hide", label: t("hide"), icon: "hide" }),
      ],
    },
    {
      label: t("usageSection"),
      items: [
        ...item("usage", { href: "/admin/usage", label: t("usage"), icon: "usage" }),
        ...item("quotas", { href: "/admin/quotas", label: t("quotas"), icon: "quotas" }),
      ],
    },
    {
      label: t("companySection"),
      items: [
        ...item("company", { href: "/admin/company", label: t("company"), icon: "company" }),
        ...item("activity", { href: "/admin/activity", label: t("activity"), icon: "activity" }),
      ],
    },
  ];
  const sections = allSections.filter((s) => s.items.length > 0);

  return (
    <AppShell
      sections={sections}
      context={{ title: t("title"), subtitle: `${ctx.active.companyName} · ${tRoles(ctx.active.role)}` }}
      user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
      menuLinks={[{ href: "/profile", label: t("profile"), icon: "profile" }]}
      footerLink={{ href: "/", label: t("backToApp"), icon: "back" }}
      locale={(await getLocale()) as "fr" | "en"}
      labels={await getShellLabels()}
    >
      {children}
    </AppShell>
  );
}
