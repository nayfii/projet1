import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRightIcon, BrainIcon, CalendarClockIcon, GavelIcon, HistoryIcon, NotebookPenIcon, SlidersHorizontalIcon, SparklesIcon, UserRoundIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AssistantAvatar } from "@/modules/avatars/ui/assistant-avatar";
import type { ClientKnowledge, KnownFact } from "../server/knowledge";

/**
 * Client Room: the living brief of a client, built from its memory (facts as current as the last
 * conversation, with their dates and authors), and one click to continue with any AI model. Every
 * model receives these same facts.
 */
export async function ClientBrief({
  clientId,
  clientName,
  spaceId,
  knowledge,
}: {
  clientId: string;
  clientName: string;
  spaceId: string;
  knowledge: ClientKnowledge;
}) {
  const t = await getTranslations("consciousness.brief");
  const format = await getFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });
  const sections: { key: string; icon: typeof GavelIcon; items: KnownFact[] }[] = [
    { key: "decisions", icon: GavelIcon, items: knowledge.decisions },
    { key: "commitments", icon: CalendarClockIcon, items: knowledge.commitments },
    { key: "facts", icon: SparklesIcon, items: knowledge.facts },
    { key: "contacts", icon: UserRoundIcon, items: knowledge.contacts },
    { key: "preferences", icon: SlidersHorizontalIcon, items: knowledge.preferences },
    { key: "notes", icon: NotebookPenIcon, items: knowledge.notes.slice(0, 6) },
  ];
  const filled = sections.filter((s) => s.items.length > 0);

  return (
    <Card className="overflow-hidden" data-testid="client-brief">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <BrainIcon className="size-4 text-brand" />
            {t("title", { client: clientName })}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {knowledge.total > 0 ? t("subtitle", { count: knowledge.total, learned: knowledge.learnedThisWeek }) : t("empty")}
          </p>
        </div>
        <div className="flex items-center gap-1" aria-label={t("openWith")}>
          <span className="mr-1 text-xs text-muted-foreground">{t("openWith")}</span>
          {(["anthropic", "openai", "google"] as const).map((provider) => (
            <Link
              key={provider}
              href={`/chat?client=${clientId}&provider=${provider}`}
              className="rounded-full p-0.5 transition-transform duration-150 hover:scale-110 focus-visible:scale-110"
              aria-label={t(`with.${provider}`)}
              title={t(`with.${provider}`)}
            >
              <AssistantAvatar provider={provider} size={26} />
            </Link>
          ))}
        </div>
      </div>

      {filled.length > 0 ? (
        <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
          {filled.map(({ key, icon: Icon, items }) => (
            <section key={key} className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" />
                {t(`section.${key as "decisions"}`)}
              </h3>
              <ul className="space-y-2">
                {items.slice(0, 5).map((f) => (
                  <li key={f.id} className="text-[13.5px] leading-snug">
                    <span>{f.content}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {f.sourceType === "auto" ? t("learnedOn", { date: date(f.date) }) : t("addedOn", { date: date(f.date) })}
                      {f.author ? ` · ${f.author}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("howItLearns")}</p>
      )}

      {knowledge.changes.length > 0 ? (
        <div className="border-t px-5 py-3.5">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <HistoryIcon className="size-3.5" />
            {t("changes")}
          </h3>
          <ul className="space-y-1.5">
            {knowledge.changes.slice(0, 4).map((c) => (
              <li key={c.id} className="text-[13px] leading-snug">
                {c.after ? <span>{c.after}</span> : null}
                <span className="ml-1.5 text-muted-foreground line-through">{c.before}</span>
                <span className="ml-1.5 text-[11.5px] text-muted-foreground">{date(c.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link href={`/memory/${spaceId}`} className="flex items-center justify-between border-t px-5 py-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
        {t("openMemory")}
        <ArrowRightIcon className="size-4" />
      </Link>
    </Card>
  );
}
