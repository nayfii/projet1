import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/modules/providers/ui/provider-logo";
import type { ProviderId } from "@/modules/providers/types";
import type { AssistantState } from "../assistants";

/**
 * A model's mark: its provider's own logo (OpenAI, Claude, Gemini) on a neutral disc that follows the
 * theme; "Auto" (our Smart Router) gets a plain sparkle. While the model prepares or writes its answer
 * (`animated` and not idle) a thin ring breathes around it, still for reduced motion (globals.css).
 * Decorative: the model's name is always written next to it.
 */
export function AssistantAvatar({
  provider,
  size = 32,
  state = "idle",
  animated = false,
  halo,
  className,
}: {
  provider: ProviderId | "auto" | null | undefined;
  size?: number;
  state?: AssistantState;
  animated?: boolean;
  /** Kept for callers of the former robots: a seed made their blinking differ. */
  seed?: string;
  /** Show the working ring; by default while it works. */
  halo?: boolean;
  className?: string;
}) {
  const working = halo ?? (animated && (state === "thinking" || state === "speaking"));
  const id = provider && provider !== "auto" ? provider : "auto";
  return (
    <span
      aria-hidden
      data-assistant={id}
      data-state={state}
      className={cn(
        "assistant-avatar relative inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--avatar-surface)] text-foreground ring-1 ring-[var(--avatar-ring)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {working ? <span className="assistant-ring absolute -inset-[3px] rounded-full" /> : null}
      {id === "auto" ? <SparklesIcon className="size-[50%] opacity-85" strokeWidth={1.75} /> : <ProviderLogo provider={id} className="size-[56%]" />}
    </span>
  );
}
