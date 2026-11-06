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

/**
 * New conversation. `?client=<id>` preselects a client the user can access; `?provider=` (from a
 * client's page: "open with Claude / ChatGPT / Gemini") preselects that provider's first allowed model.
 */
export default async function NewChatPage({ searchParams }: PageProps<"/chat">) {
  const ctx = await requireMember();
  const { client, provider } = await searchParams;
  // Without a client in the address (the usual case), everything loads at once.
  const [data, noClientColleagues] = await Promise.all([getChatPageData(ctx), typeof client === "string" ? Promise.resolve(null) : getEligibleColleagues(ctx, null)]);
  const initialClientId = typeof client === "string" && data.clients.some((c) => c.id === client) ? client : null;
  const colleagues = noClientColleagues ?? (await getEligibleColleagues(ctx, initialClientId));
  const chosen = typeof provider === "string" ? data.models.find((m) => m.provider === provider && m.available) : undefined;
  return (
    <ChatView
      key={`new-${chosen?.id ?? ""}`}
      conversation={null}
      initialClientId={initialClientId}
      participants={[]}
      colleagues={colleagues}
      handover={null}
      agent={null}
      {...data}
      defaultChoice={chosen?.id ?? data.defaultChoice}
    />
  );
}
