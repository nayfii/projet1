"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { niceTicks, type ChartSpec } from "../chart-spec";

const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
const HEIGHT = 240;
const M = { top: 12, right: 16, bottom: 28, left: 52 };

/**
 * A chart from an AI answer (line or bar, at most 3 series): thin marks, recessive grid, a legend for
 * several series, values on hover, and the same data as a table for anyone who prefers or needs it.
 * Colours are validated for colour-blind separation on the app's surfaces (globals.css --chart-*).
 */
export function Chart({ spec }: { spec: ChartSpec }) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const box = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  const [active, setActive] = React.useState<number | null>(null);
  const [showTable, setShowTable] = React.useState(false);

  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const value = (v: number) => (spec.unit ? `${number.format(v)} ${spec.unit}` : number.format(v));

  const n = spec.labels.length;
  const all = spec.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const [t0, tN] = [ticks[0], ticks[ticks.length - 1]];
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / n;
  const x = (i: number) => M.left + (i + 0.5) * band;
  const y = (v: number) => M.top + (1 - (v - t0) / (tN - t0)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));

  // Bars: at most 24px thick, 2px apart, grouped around the band's centre.
  const k = spec.series.length;
  const barW = Math.max(4, Math.min(24, (band * 0.7 - 2 * (k - 1)) / k));
  const groupW = k * barW + 2 * (k - 1);
  const bar = (i: number, s: number, v: number) => {
    const left = x(i) - groupW / 2 + s * (barW + 2);
    const base = y(0);
    const end = y(v);
    const h = Math.abs(base - end);
    const r = Math.min(4, h, barW / 2);
    // Rounded at the data end, square at the baseline.
    return v >= 0
      ? `M${left},${base} V${end + r} Q${left},${end} ${left + r},${end} H${left + barW - r} Q${left + barW},${end} ${left + barW},${end + r} V${base} Z`
      : `M${left},${base} V${end - r} Q${left},${end} ${left + r},${end} H${left + barW - r} Q${left + barW},${end} ${left + barW},${end - r} V${base} Z`;
  };
  const line = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  const tooltipLeft = active === null ? 0 : Math.min(Math.max(x(active) + 12, 8), width - 180);

  return (
    <figure className="not-prose my-4 rounded-lg border bg-card px-3 pt-3 pb-2">
      {spec.title ? <figcaption className="px-1 text-[13px] font-medium">{spec.unit ? `${spec.title} (${spec.unit})` : spec.title}</figcaption> : null}
      {k > 1 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
          {spec.series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("inline-block", spec.type === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-sm")} style={{ background: SERIES[i] }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={box} className="relative mt-1" onMouseLeave={() => setActive(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={t("chartLabel", { title: spec.title ?? "" })} className="block max-w-full">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={width - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={tick === 0 ? 1.25 : 1} />
              <text x={M.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {compact.format(tick)}
              </text>
            </g>
          ))}
          {spec.labels.map((label, i) =>
            i % labelEvery === 0 ? (
              <text key={`${label}-${i}`} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {label.length > 10 ? `${label.slice(0, 9)}…` : label}
              </text>
            ) : null,
          )}
          {active !== null && spec.type === "line" ? <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.4} /> : null}
          {spec.type === "bar"
            ? spec.series.map((s, si) => (
                <g key={s.name} fill={SERIES[si]}>
                  {s.values.map((v, i) => (
                    <path key={i} d={bar(i, si, v)} opacity={active === null || active === i ? 1 : 0.45} />
                  ))}
                </g>
              ))
            : spec.series.map((s, si) => (
                <g key={s.name}>
                  <path d={line(s.values)} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {/* End dot, and the hovered point: series colour with a ring of the surface. */}
                  {[n - 1, ...(active !== null && active !== n - 1 ? [active] : [])].map((i) => (
                    <circle key={i} cx={x(i)} cy={y(s.values[i])} r={4} fill={SERIES[si]} stroke="var(--card)" strokeWidth={2} />
                  ))}
                </g>
              ))}
          {spec.labels.map((label, i) => (
            <rect key={`hit-${i}`} x={M.left + i * band} y={M.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setActive(i)} />
          ))}
        </svg>
        {active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: tooltipLeft }}
          >
            <p className="mb-1 font-medium">{spec.labels[active]}</p>
            {spec.series.map((s, si) => (
              <p key={s.name} className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: SERIES[si] }} />
                <span className="flex-1">{s.name}</span>
                <span className="font-medium tabular-nums text-foreground">{value(s.values[active])}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" onClick={() => setShowTable((v) => !v)} className="px-1 py-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
        {showTable ? t("chartHideData") : t("chartShowData")}
      </button>
      {showTable ? (
        <div className="mb-2 overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium" />
                {spec.series.map((s) => (
                  <th key={s.name} className="px-2 py-1 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spec.labels.map((label, i) => (
                <tr key={`${label}-${i}`} className="border-t">
                  <td className="px-2 py-1">{label}</td>
                  {spec.series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-right tabular-nums">
                      {value(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
