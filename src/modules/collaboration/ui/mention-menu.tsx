"use client";

import { useTranslations } from "next-intl";
import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/modules/providers/types";
import { ProviderDot } from "@/modules/conversations/ui/provider-mark";

/** One way to call the AI in a group conversation: "@IA", "@Claude", "@ChatGPT", "@Gemini". */
export type MentionOption = { token: string; aliases: string[]; provider: ProviderId | null; hint: string };

export const PROVIDER_TOKENS: Record<ProviderId, { token: string; aliases: string[] }> = {
  anthropic: { token: "Claude", aliases: [] },
  openai: { token: "ChatGPT", aliases: ["gpt"] },
  google: { token: "Gemini", aliases: [] },
};

/** The "@…" being typed just before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|[\s(,;:"«])@([\p{L}]*)$/u.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

export function filterMentions(options: MentionOption[], query: string): MentionOption[] {
  const q = query.toLowerCase();
  return options.filter((o) => [o.token, ...o.aliases].some((name) => name.toLowerCase().startsWith(q)));
}

/** Shown above the input while "@…" is typed in a group conversation. */
export function MentionMenu({ options, active, onPick }: { options: MentionOption[]; active: number; onPick: (option: MentionOption) => void }) {
  const t = useTranslations("collaboration");
  return (
    <div role="listbox" aria-label={t("mentionTitle")} className="absolute bottom-full left-2 z-20 mb-2 w-64 rounded-xl border bg-popover p-1 shadow-lg">
      <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{t("mentionTitle")}</p>
      {options.map((o, i) => (
        <button
          key={o.token}
          type="button"
          role="option"
          aria-selected={i === active}
          // Keep the focus (and the caret) in the input.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(o)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
        >
          {o.provider ? <ProviderDot provider={o.provider} /> : <SparklesIcon className="size-3.5 text-brand" />}
          <span className="font-medium">{`@${o.token}`}</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
