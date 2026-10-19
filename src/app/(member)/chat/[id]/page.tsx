import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { getConversation } from "@/modules/conversations/server/queries";
import { getChatPageData } from "@/modules/conversations/server/page-data";
import { ChatView } from "@/modules/conversations/ui/chat-view";

export async function generateMetadata({ params }: PageProps<"/chat/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("chat");
  const conversation = /^[0-9a-f-]{36}$/i.test(id) ? await getConversation(id) : null;
  return { title: conversation?.title ?? t("newConversation") };
}

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  // RLS returns nothing for a conversation the user may not see: a 404 that does not confirm it exists.
  const conversation = /^[0-9a-f-]{36}$/i.test(id) ? await getConversation(id) : null;
  if (!conversation || conversation.company_id !== ctx.active.companyId) notFound();
  const data = await getChatPageData(ctx);
  return (
    <ChatView
      // A new key once an answer that was in progress elsewhere is finished: the view reloads its messages.
      key={`${conversation.id}:${conversation.messages.some((m) => m.status === "streaming") ? "pending" : "settled"}`}
      conversation={{
        id: conversation.id,
        title: conversation.title,
        clientId: conversation.client_id,
        modelChoice: conversation.model_choice,
        messages: conversation.messages,
      }}
      initialClientId={null}
      {...data}
    />
  );
}
