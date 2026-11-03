import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { getConversation } from "@/modules/conversations/server/queries";
import { getChatPageData } from "@/modules/conversations/server/page-data";
import { ChatView } from "@/modules/conversations/ui/chat-view";
import { getConversationPeople, getEligibleColleagues, getMyHandover } from "@/modules/collaboration/server/queries";
import { getAgent } from "@/modules/agents/server/queries";
import { agentText, type DynamicT } from "@/modules/agents/labels";

export async function generateMetadata({ params }: PageProps<"/chat/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("chat");
  const conversation = /^[0-9a-f-]{36}$/i.test(id) ? await getConversation(id) : null;
  return { title: conversation?.title ?? t("newConversation") };
}

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const ctx = await requireMember();
  const { id } = await params;
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  // The screen's own data loads at the same time as the conversation (nothing in it depends on it).
  const pageData = getChatPageData(ctx);
  const people = valid ? getConversationPeople(id) : Promise.resolve([]);
  // RLS returns nothing for a conversation the user may not see: a 404 that does not confirm it exists.
  const conversation = valid ? await getConversation(id) : null;
  if (!conversation || conversation.company_id !== ctx.active.companyId) {
    // Settle the requests started above before leaving.
    await Promise.allSettled([pageData, people]);
    notFound();
  }
  const [data, participants, colleagues, handover, agent] = await Promise.all([
    pageData,
    people,
    getEligibleColleagues(ctx, conversation.client_id),
    getMyHandover({ conversationId: conversation.id }),
    conversation.agent_id ? getAgent(ctx, conversation.agent_id) : Promise.resolve(null),
  ]);
  const group = participants.length > 1;
  return (
    <ChatView
      // Alone: a new key once an answer that was in progress elsewhere is finished, so the view reloads
      // its messages. In a group, real time keeps the view up to date.
      key={group ? conversation.id : `${conversation.id}:${conversation.messages.some((m) => m.status === "streaming") ? "pending" : "settled"}`}
      conversation={{
        id: conversation.id,
        title: conversation.title,
        clientId: conversation.client_id,
        modelChoice: conversation.model_choice,
        messages: conversation.messages,
        lastHideModes: conversation.lastHideModes,
        feedMemory: conversation.feed_memory,
        copyOf: conversation.forked_from
          ? { toName: conversation.to?.full_name ?? conversation.to?.email ?? null, at: conversation.transferred_at ?? conversation.created_at }
          : null,
      }}
      initialClientId={null}
      participants={participants}
      colleagues={colleagues}
      handover={handover}
      agent={
        agent
          ? {
              id: agent.id,
              name: agentText(agent, (await getTranslations("tools")) as unknown as DynamicT).name,
              attachments: agent.tools.includes("attachments"),
              allowedModels: agent.allowedModels,
              notice: agent.notice,
              renderKind: agent.builtinKey === "motion_design" ? "motion" : agent.builtinKey === "video_editor" ? "video_edit" : null,
            }
          : null
      }
      {...data}
    />
  );
}
