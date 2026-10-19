import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/guards";
import { getChatPageData } from "@/modules/conversations/server/page-data";
import { ChatView } from "@/modules/conversations/ui/chat-view";

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
  return <ChatView key="new" conversation={null} initialClientId={initialClientId} {...data} />;
}
