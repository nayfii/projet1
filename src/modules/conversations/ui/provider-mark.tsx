import { modelDisplay } from "@/modules/providers/catalog";
import type { ProviderId } from "@/modules/providers/types";
import { cn } from "@/lib/utils";

/** Muted per-provider hue so model labels are easy to tell apart without loud colours. */
const DOT: Record<ProviderId, string> = {
  openai: "bg-[oklch(0.62_0.1_165)]",
  anthropic: "bg-[oklch(0.66_0.12_50)]",
  google: "bg-[oklch(0.6_0.12_255)]",
};

export function ProviderDot({ provider, className }: { provider: ProviderId; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[provider], className)} />;
}

/** "Claude · Sonnet 5.5" with the brand in medium weight. */
export function ModelName({ provider, label, className }: { provider: ProviderId; label: string; className?: string }) {
  const { brand, name } = modelDisplay(provider, label);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <ProviderDot provider={provider} />
      <span className="truncate">
        <span className="font-medium text-foreground">{brand}</span>
        <span className="text-muted-foreground"> · {name}</span>
      </span>
    </span>
  );
}
