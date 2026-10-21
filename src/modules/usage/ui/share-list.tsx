import { cn } from "@/lib/utils";

/**
 * A ranked list with one thin bar per row (share of the largest value): readable at a glance,
 * with the exact figures written beside each bar.
 */
export function ShareList({ rows, className }: { rows: { key: string; label: React.ReactNode; value: number; figure: string; hint?: string }[]; className?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className={cn("divide-y", className)}>
      {rows.map((r) => (
        <li key={r.key} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">{r.figure}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${max > 0 ? Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0) : 0}%` }} />
          </div>
          {r.hint ? <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p> : null}
        </li>
      ))}
    </ul>
  );
}
