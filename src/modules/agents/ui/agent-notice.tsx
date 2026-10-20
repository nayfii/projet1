import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";
import type { AgentNotice as Notice } from "../builtins";

/** "Not legal advice", "A person decides", "Draft to review": shown on the agent's page and in its conversations. */
export function AgentNotice({ notice, className }: { notice: Notice; className?: string }) {
  const t = useTranslations("tools");
  return (
    <p role="note" className={`flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground ${className ?? ""}`}>
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-brand" />
      {t(`notices.${notice}`)}
    </p>
  );
}
