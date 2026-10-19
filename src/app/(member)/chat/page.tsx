import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { getChatPageData } from "@/modules/conversations/server/page-data";
import { ChatView } from "@/modules/conversations/ui/chat-view";
import { getEligibleColleagues } from "@/modules/collaboration/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("chat");
  return { title: t("newConversation") };
}

/** New conversation. `?client=<id>` preselects a client the user can access. */
export default async function NewChatPage({ searchParams }: PageProps<"/chat">) {
  const ctx = await requireMember();
  const { client } = await searchParams;
  const data = await getChatPageData(ctx);
  const initialClientId = typeof client === "string" && data.clients.some((c) => c.id === client) ? client : null;
  const colleagues = await getEligibleColleagues(ctx, initialClientId);
  return <ChatView key="new" conversation={null} initialClientId={initialClientId} participants={[]} colleagues={colleagues} handover={null} {...data} />;
}
