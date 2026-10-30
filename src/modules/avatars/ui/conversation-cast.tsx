"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PROVIDER_BRANDS, type ProviderId } from "@/modules/providers/types";
import type { AssistantId, AssistantState } from "../assistants";
import { AssistantAvatar } from "./assistant-avatar";

/** Who is in the conversation: the assistants that took part (or are selected) and the people. */
export type Cast = {
  assistants: AssistantId[];
  /** The assistant working right now, if any. */
  active: { id: AssistantId; state: Exclude<AssistantState, "idle" | "happy"> } | null;
  people: { userId: string; name: string; avatarUrl: string | null; online: boolean }[];
};

function useAssistantName() {
  const t = useTranslations("chat");
  return (id: AssistantId) => (id === "auto" ? t("auto") : PROVIDER_BRANDS[id as ProviderId]);
}

/**
 * Wide screens: a quiet column beside the thread. The assistant at work is larger, breathes and
 * says what it is doing; the others wait, still. People follow, with a dot when they are here.
 */
export function CastRail({ cast, className }: { cast: Cast; className?: string }) {
  const t = useTranslations("chat");
  const name = useAssistantName();
  if (cast.assistants.length === 0 && cast.people.length < 2) return null;
  return (
    <aside aria-label={t("castTitle")} className={cn("flex w-32 flex-col gap-5", className)}>
      <ul className="flex flex-col gap-3.5">
        {cast.assistants.map((id) => {
          const active = cast.active?.id === id ? cast.active : null;
          return (
            <li key={id} className="flex items-center gap-2.5 transition-all duration-500">
              <AssistantAvatar
                provider={id}
                size={active ? 52 : 34}
                state={active?.state ?? "idle"}
                animated={Boolean(active)}
                seed="rail"
                className="transition-[width,height] duration-500 ease-[var(--ease-out-soft)]"
              />
              <span className="min-w-0">
                <span className={cn("block truncate text-[13px]", active ? "font-medium text-foreground" : "text-muted-foreground")}>{name(id)}</span>
                {active ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
                    {active.state === "thinking" ? t("castThinking") : t("castWriting")}
                    <ThinkingDots />
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {cast.people.length > 1 ? (
        <ul className="flex flex-col gap-2.5 border-t pt-4">
          {cast.people.map((p) => (
            <li key={p.userId} className="flex items-center gap-2.5">
              <span className="relative">
                <Avatar name={p.name} src={p.avatarUrl} className="size-7" />
                {p.online ? <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-background" /> : null}
              </span>
              <span className="truncate text-[13px] text-muted-foreground">{p.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

/** Smaller screens: the assistants as a small stack in the header; the one at work comes first and moves. */
export function CastStack({ cast, className }: { cast: Cast; className?: string }) {
  const name = useAssistantName();
  if (cast.assistants.length === 0) return null;
  const ordered = cast.active ? [cast.active.id, ...cast.assistants.filter((id) => id !== cast.active!.id)] : cast.assistants;
  return (
    <Tooltip content={ordered.map(name).join(", ")}>
      <span className={cn("flex -space-x-1.5", className)}>
        {ordered.slice(0, 3).map((id) => {
          const active = cast.active?.id === id ? cast.active : null;
          return (
            <AssistantAvatar
              key={id}
              provider={id}
              size={26}
              state={active?.state ?? "idle"}
              animated={Boolean(active)}
              seed="stack"
              className="rounded-full ring-2 ring-background"
            />
          );
        })}
      </span>
    </Tooltip>
  );
}

/**
 * The empty conversation: the assistants the company allows, side by side. Clicking one chooses
 * who answers; the chosen one comes alive.
 */
export function CastPicker({
  options,
  selected,
  onSelect,
}: {
  options: AssistantId[];
  selected: AssistantId;
  onSelect: (id: AssistantId) => void;
}) {
  const t = useTranslations("chat");
  const name = useAssistantName();
  return (
    <div role="radiogroup" aria-label={t("castPick")} className="flex items-end justify-center gap-4 sm:gap-6">
      {options.map((id) => {
        const on = id === selected;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(id)}
            className="group flex flex-col items-center gap-2.5 rounded-2xl px-1 pt-1 pb-1.5 outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <AssistantAvatar
              provider={id}
              size={on ? 84 : 60}
              state="idle"
              animated={on}
              halo={on}
              seed="picker"
              className={cn("transition-[width,height,transform] duration-500 ease-[var(--ease-out-soft)]", !on && "opacity-80 group-hover:-translate-y-1 group-hover:opacity-100")}
            />
            <span className={cn("text-[13px] transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{name(id)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 animate-dot-wave rounded-full bg-current" style={{ animationDelay: `${i * 140}ms` }} />
      ))}
    </span>
  );
}
