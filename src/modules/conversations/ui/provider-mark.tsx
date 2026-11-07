import { modelDisplay } from "@/modules/providers/catalog";
import { ProviderLogo } from "@/modules/providers/ui/provider-logo";
import type { ProviderId } from "@/modules/providers/types";
import { cn } from "@/lib/utils";

/** The provider's own small logo next to a model's name (it used to be a coloured dot). */
export function ProviderDot({ provider, className }: { provider: ProviderId; className?: string }) {
  return <ProviderLogo provider={provider} className={cn("inline-block size-3.5 shrink-0", className)} />;
}

/** "Claude · Sonnet 5.5" with the brand in medium weight. */
export function ModelName({ provider, label, className, dot = true }: { provider: ProviderId; label: string; className?: string; dot?: boolean }) {
  const { brand, name } = modelDisplay(provider, label);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {dot ? <ProviderDot provider={provider} /> : null}
      <span className="truncate">
        <span className="font-medium text-foreground">{brand}</span>
        <span className="text-muted-foreground"> · {name}</span>
      </span>
    </span>
  );
}
