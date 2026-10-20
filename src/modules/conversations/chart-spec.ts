import { z } from "zod";

/**
 * Charts in AI answers (finance and dashboard agents): a fenced code block whose language is `chart`,
 * holding a small JSON spec. Anything that does not match stays shown as text.
 */
export const chartSpecSchema = z
  .object({
    type: z.enum(["line", "bar"]),
    title: z.string().max(120).optional(),
    unit: z.string().max(12).optional(),
    labels: z.array(z.string().max(40)).min(1).max(24),
    series: z
      .array(z.object({ name: z.string().min(1).max(60), values: z.array(z.number().finite()) }))
      .min(1)
      .max(3),
  })
  .refine((spec) => spec.series.every((s) => s.values.length === spec.labels.length), "one value per label");

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export function parseChartSpec(text: string): ChartSpec | null {
  try {
    const parsed = chartSpecSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Clean axis ticks ("nice numbers") covering [min, max], always including 0. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
