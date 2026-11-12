import { getLocale, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { canRestrictClients, isCompanyAdmin } from "@/lib/auth/context";
import { AppShell, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";
import { listConversations } from "@/modules/conversations/server/queries";
import { ChatListProvider } from "@/modules/conversations/ui/chat-list";
import { ChatSidebarSection } from "@/modules/conversations/ui/chat-sidebar";
import { listClientsLite } from "@/modules/clients/server/queries";
import { ClientsSidebarSection } from "@/modules/clients/ui/clients-sidebar";

/** Member app: every signed-in employee of an active company. */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireMember();
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("roles");
  const [conversations, clients] = await Promise.all([listConversations(ctx.active.companyId, { limit: 30, meId: ctx.user.id }), listClientsLite(ctx.active.companyId)]);
  // The clients worked on lately first (from recent conversations), then the others by name.
  const recentIds = [...new Set(conversations.flatMap((c) => (c.clientId ? [c.clientId] : [])))];
  const sidebarClients = [...recentIds.flatMap((id) => clients.filter((c) => c.id === id)), ...clients.filter((c) => !recentIds.includes(c.id))].slice(0, 6);

  const sections: NavSection[] = [
    {
      items: [
        { href: "/chat", label: t("newConversation"), icon: "newChat", exact: true },
        { href: "/", label: t("home"), icon: "home", exact: true },
      ],
    },
    {
      label: t("workspace"),
      items: [
        { href: "/memory", label: t("memory"), icon: "memory" },
        { href: "/apps", label: t("library"), icon: "apps" },
        { href: "/workflows", label: t("workflows"), icon: "workflows" },
      ],
    },
  ];

  return (
    <ChatListProvider initial={conversations} meId={ctx.user.id}>
      <AppShell
        sections={sections}
        context={{ title: ctx.active.companyName, subtitle: tRoles(ctx.active.role) }}
        user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
        menuLinks={[
          { href: "/profile", label: t("profile"), icon: "profile" },
          // Our team only: the way back to our console when the same account also belongs to a company.
          ...(ctx.isPlatformAdmin ? [{ href: "/platform", label: t("platformConsole"), icon: "console" as const }] : []),
        ]}
        footerLink={isCompanyAdmin(ctx.active) ? { href: "/admin", label: t("adminConsole"), icon: "settings" } : undefined}
        sidebarExtra={
          <>
            <ClientsSidebarSection clients={sidebarClients} canRestrict={canRestrictClients(ctx.active)} />
            <ChatSidebarSection />
          </>
        }
        locale={(await getLocale()) as "fr" | "en"}
        labels={await getShellLabels()}
      >
        {children}
      </AppShell>
    </ChatListProvider>
  );
}
