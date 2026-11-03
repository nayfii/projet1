import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, BrainIcon, FileTextIcon, MessageSquareIcon, SquarePenIcon, UsersIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { listMembers } from "@/modules/organizations/server/queries";
import { ClientAccessButton } from "@/modules/clients/ui/client-access-button";
import { PageContainer } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listConversations } from "@/modules/conversations/server/queries";
import { listMemorySpaces } from "@/modules/memory/server/queries";
import { getClientById, listClients } from "@/modules/clients/server/queries";
import { AvatarStack, VisibilityBadge } from "@/modules/clients/ui/client-badges";
import { getEligibleColleagues, getMyHandover } from "@/modules/collaboration/server/queries";
import { HandoverCard } from "@/modules/collaboration/ui/handover-card";
import { ClientTransferButton } from "@/modules/collaboration/ui/client-transfer";
import { ClientSummaryCard } from "@/modules/clients/ui/client-summary";
import { KindMark } from "@/modules/conversations/ui/chat-sidebar";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const client = await getClientById(id);
  return { title: client?.name };
}

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  // Everything the page needs loads at once; RLS limits each list to what this person may see.
  const [t, client, allClients, conversations, format, handover, spaces] = await Promise.all([
    getTranslations("clients"),
    // RLS returns nothing if the user has no access: they get a 404, not an error that confirms the client exists.
    getClientById(id),
    listClients(ctx.active.companyId, { includeArchived: true }),
    // RLS: only the conversations this user takes part in.
    listConversations(ctx.active.companyId, { clientId: id, limit: 50, meId: ctx.user.id }),
    getFormatter(),
    getMyHandover({ clientId: id }),
    listMemorySpaces(ctx),
  ]);
  if (!client || client.company_id !== ctx.active.companyId) notFound();
  const withAssignees = allClients.find((c) => c.id === id);
  // Smart Handover: an assigned employee can hand a restricted client over; the recipient finds the file here.
  const canTransfer = client.visibility === "restricted" && Boolean(withAssignees?.assignees.some((a) => a.userId === ctx.user.id));
  // Access to a restricted client: client Admins give it to anyone, a Manager to their own team (CLAUDE.md §11).
  const accessAll = hasScope(ctx.active, "clients");
  const accessTeam = !accessAll && ctx.active.role === "manager";
  const canManageAccess = client.visibility === "restricted" && !client.archived_at && (accessAll || accessTeam);
  const [colleagues, members] = await Promise.all([
    canTransfer ? getEligibleColleagues(ctx, null) : Promise.resolve([]),
    canManageAccess ? listMembers(ctx.active.companyId) : Promise.resolve([]),
  ]);
  const myTeam = members.find((m) => m.userId === ctx.user.id)?.teamName ?? null;
  const accessMembers = members
    .filter((m) => m.status === "active" && m.role !== "owner" && m.userId !== ctx.user.id && (accessAll || (myTeam && m.teamName === myTeam)))
    .map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }));

  // The client's memory, if this person can read it (same rights as everywhere else).
  const space = spaces.find((s) => s.clientId === id);
  const sections = [
    { icon: BrainIcon, title: t("memorySection"), body: t("memorySectionBody"), value: space ? t("entriesCount", { count: space.entryCount }) : null },
    { icon: FileTextIcon, title: t("documentsSection"), body: t("documentsSectionBody"), value: space ? t("documentsCount", { count: space.documentCount }) : null },
  ];

  const mine = conversations.filter((c) => c.mine);
  const shared = conversations.filter((c) => !c.mine);
  const list = (items: typeof conversations, empty: string) =>
    items.length === 0 ? (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{empty}</p>
    ) : (
      <Card className="divide-y overflow-hidden">
        {items.map((c) => (
          <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/60">
            <span className="min-w-0 flex-1 truncate">{c.title ?? t("untitledConversation")}</span>
            <KindMark kind={c.kind} />
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={c.lastMessageAt}>
              {format.dateTime(new Date(c.lastMessageAt), { dateStyle: "medium" })}
            </time>
          </Link>
        ))}
      </Card>
    );

  return (
    <PageContainer>
      <Link href="/clients" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("title")}
      </Link>
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-3xl font-semibold tracking-[-0.025em]">{client.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {client.sector ? <span>{client.sector}</span> : null}
            <VisibilityBadge visibility={client.visibility} />
            {client.visibility === "restricted" && withAssignees ? (
              <span className="inline-flex items-center gap-2">
                <AvatarStack people={withAssignees.assignees} max={6} />
                <span className="text-xs">{t("assignedCount", { count: withAssignees.assignees.length })}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManageAccess && withAssignees ? (
            <ClientAccessButton
              client={{ id: client.id, name: client.name, assignees: withAssignees.assignees }}
              members={accessMembers}
              note={accessTeam && myTeam ? t("managerAccessNote", { team: myTeam }) : undefined}
            />
          ) : null}
          {canTransfer ? <ClientTransferButton client={{ id: client.id, name: client.name }} colleagues={colleagues} /> : null}
          <Button asChild>
            <Link href={`/chat?client=${client.id}`}>
              <SquarePenIcon />
              {t("newConversation")}
            </Link>
          </Button>
        </div>
      </header>

      {handover ? <HandoverCard handover={handover} className="mb-8 max-w-3xl" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <ClientSummaryCard clientId={client.id} />
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              {t("myConversations")}
            </h2>
            {list(mine, t("noConversations"))}
          </section>
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <UsersIcon className="size-4 text-muted-foreground" />
              {t("sharedWithMe")}
            </h2>
            {list(shared, t("noSharedConversations"))}
          </section>
        </div>

        <aside className="space-y-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">{t("keyInfo")}</h2>
          {client.description ? <p className="whitespace-pre-line text-sm leading-relaxed">{client.description}</p> : null}
          <p className="text-xs text-muted-foreground">{t("createdOn", { date: format.dateTime(new Date(client.created_at), { dateStyle: "long" }) })}</p>
          {sections.map(({ icon: Icon, title, body, value }) => {
            const card = (
              <Card className="h-full p-4 transition-colors hover:border-foreground/20">
                <div className="flex items-start justify-between">
                  <Icon className="size-4 text-muted-foreground" />
                  {value ? <span className="text-xs text-muted-foreground">{value}</span> : null}
                </div>
                <p className="mt-3 text-sm font-medium">{title}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
              </Card>
            );
            return space ? (
              <Link key={title} href={`/memory/${space.spaceId}`} className="block rounded-xl">
                {card}
              </Link>
            ) : (
              <div key={title}>{card}</div>
            );
          })}
        </aside>
      </div>
    </PageContainer>
  );
}
