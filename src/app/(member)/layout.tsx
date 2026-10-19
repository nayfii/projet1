import { getLocale, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { isCompanyAdmin } from "@/lib/auth/context";
import { AppShell, type NavSection } from "@/components/shell/app-shell";
import { getShellLabels } from "@/components/shell/labels";
import { listConversations } from "@/modules/conversations/server/queries";
import { ChatListProvider } from "@/modules/conversations/ui/chat-list";
import { ChatSidebarSection } from "@/modules/conversations/ui/chat-sidebar";

/** Member app: every signed-in employee of an active company. */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireMember();
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("roles");
  const conversations = await listConversations(ctx.active.companyId, { limit: 30 });

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
        { href: "/clients", label: t("clients"), icon: "clients" },
        { href: "/memory", label: t("memory"), icon: "memory" },
        { href: "/library", label: t("library"), icon: "library" },
      ],
    },
  ];

  return (
    <ChatListProvider initial={conversations} meId={ctx.user.id}>
      <AppShell
        sections={sections}
        context={{ title: ctx.active.companyName, subtitle: tRoles(ctx.active.role) }}
        user={{ name: ctx.profile.fullName, email: ctx.user.email, avatarUrl: ctx.profile.avatarUrl }}
        menuLinks={[{ href: "/profile", label: t("profile"), icon: "profile" }]}
        footerLink={isCompanyAdmin(ctx.active) ? { href: "/admin", label: t("adminConsole"), icon: "settings" } : undefined}
        sidebarExtra={<ChatSidebarSection />}
        locale={(await getLocale()) as "fr" | "en"}
        labels={await getShellLabels()}
      >
        {children}
      </AppShell>
    </ChatListProvider>
  );
}
