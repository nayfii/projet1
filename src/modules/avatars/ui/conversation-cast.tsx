"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PROVIDER_BRANDS, type ProviderId } from "@/modules/providers/types";
import type { AssistantId } from "../assistants";
import { AssistantAvatar } from "./assistant-avatar";

function useAssistantName() {
  const t = useTranslations("chat");
  return (id: AssistantId) => (id === "auto" ? t("auto") : PROVIDER_BRANDS[id as ProviderId]);
}

/**
 * The empty conversation: the assistants the company allows, side by side. Clicking one chooses
 * who answers; the chosen one is shown larger, with a ring.
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
              size={56}
              // Grows by scale (drawn by the graphics chip), not by size: nothing around it moves.
              className={cn(
                "transition-[transform,opacity,box-shadow] duration-300 ease-[var(--ease-out-soft)]",
                on ? "ring-2 ring-foreground/25" : "scale-[0.79] opacity-75 group-hover:-translate-y-0.5 group-hover:opacity-100",
              )}
            />
            <span className={cn("text-[13px] transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{name(id)}</span>
          </button>
        );
      })}
    </div>
  );
}
