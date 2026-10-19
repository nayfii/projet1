import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, BrainIcon, FileTextIcon, MessageSquareIcon, SquarePenIcon } from "lucide-react";
import { requireMember } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ComingSoon } from "@/components/ui/coming-soon";
import { Button } from "@/components/ui/button";
import { listConversations } from "@/modules/conversations/server/queries";
import { getClientById, listClients } from "@/modules/clients/server/queries";
import { AvatarStack, VisibilityBadge } from "@/modules/clients/ui/client-badges";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const client = await getClientById(id);
  return { title: client?.name };
}

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  const t = await getTranslations("clients");
  // RLS returns nothing if the user has no access: they get a 404, not an error that confirms the client exists.
  const client = await getClientById(id);
  if (!client || client.company_id !== ctx.active.companyId) notFound();
  const withAssignees = (await listClients(ctx.active.companyId, { includeArchived: true })).find((c) => c.id === id);
  // RLS: only the conversations this user takes part in.
  const conversations = await listConversations(ctx.active.companyId, { clientId: id, limit: 20 });
  const format = await getFormatter();

  const sections = [
    { icon: BrainIcon, title: t("memorySection"), body: t("memorySectionBody") },
    { icon: FileTextIcon, title: t("documentsSection"), body: t("documentsSectionBody") },
  ];

  return (
    <PageContainer>
      <Link href="/clients" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("title")}
      </Link>
      <PageHeader
        title={client.name}
        description={client.sector ?? undefined}
        actions={<VisibilityBadge visibility={client.visibility} />}
      />
      {client.description ? <p className="mb-8 max-w-2xl whitespace-pre-line text-sm leading-relaxed">{client.description}</p> : null}
      {client.visibility === "restricted" && withAssignees ? (
        <div className="mb-8 flex items-center gap-3 text-sm text-muted-foreground">
          <AvatarStack people={withAssignees.assignees} max={8} />
          <span>{t("assignedCount", { count: withAssignees.assignees.length })}</span>
        </div>
      ) : null}
      <section className="mb-8 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            {t("conversationsSection")}
          </h2>
          <Button asChild size="sm" variant="outline">
            <Link href={`/chat?client=${client.id}`}>
              <SquarePenIcon />
              {t("newConversation")}
            </Link>
          </Button>
        </div>
        {conversations.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("noConversations")}</p>
        ) : (
          <Card className="divide-y overflow-hidden">
            {conversations.map((c) => (
              <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/60">
                <span className="min-w-0 flex-1 truncate">{c.title ?? t("untitledConversation")}</span>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={c.lastMessageAt}>
                  {format.dateTime(new Date(c.lastMessageAt), { dateStyle: "medium" })}
                </time>
              </Link>
            ))}
          </Card>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="p-5">
            <div className="flex items-start justify-between">
              <Icon className="size-4 text-muted-foreground" />
              <ComingSoon />
            </div>
            <p className="mt-4 text-sm font-medium">{title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
