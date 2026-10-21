import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A key figure on a dashboard, with an optional meter (warning colour from 80 %). */
export function Stat({ label, value, hint, meter, tone }: { label: string; value: string; hint?: string; meter?: number; tone?: "danger" }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone === "danger" && "text-destructive")}>{value}</p>
      {meter !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={meter >= 0.8 ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-brand"} style={{ width: `${Math.max(meter * 100, meter > 0 ? 2 : 0)}%` }} />
        </div>
      ) : null}
      {hint ? <p className="mt-1.5 text-[13px] text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
