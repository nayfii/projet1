import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { AgentSummary } from "../server/queries";

/** "Outil · Moi", "En attente de validation"…: who can use it and where it stands. */
export function AgentBadges({ agent }: { agent: Pick<AgentSummary, "kind" | "builtin" | "visibility" | "publication"> }) {
  const t = useTranslations("tools");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={agent.kind === "agent" ? "brand" : "neutral"}>{agent.kind === "agent" ? t("kindAgent") : t("kindTool")}</Badge>
      {!agent.builtin ? <Badge variant="outline">{t(`visibilities.${agent.visibility}`)}</Badge> : null}
      {agent.publication === "pending" ? <Badge variant="warning">{t("pending")}</Badge> : null}
      {agent.publication === "rejected" ? <Badge variant="destructive">{t("rejected")}</Badge> : null}
    </span>
  );
}
