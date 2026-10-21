/**
 * Platform margin view (CLAUDE.md §4.9, §5). Revenue comes from the plan's price per seat (set by our team,
 * never hardcoded) times today's active seats; AI cost is the ESTIMATE computed from our price tables,
 * in US dollars. Nothing here is billed: it helps our team see which customers cost more than they bring.
 */

export type Currency = "EUR" | "USD";

export type MarginInput = {
  seats: number;
  /** Monthly price per seat, or null when the plan has no price yet. */
  pricePerSeat: number | null;
  currency: Currency;
  costUsd: number;
  /** Euros per US dollar, set by our team. Null: a euro price cannot be compared with a dollar cost. */
  usdToEur: number | null;
};

export type Margin = {
  currency: Currency;
  revenue: number | null;
  /** The AI cost in the plan's currency, or null when it cannot be converted. */
  cost: number | null;
  margin: number | null;
  /** Margin over revenue, 0..1 (negative when the customer costs more than they pay). */
  rate: number | null;
};

export function convert(amount: number, from: Currency, to: Currency, usdToEur: number | null): number | null {
  if (from === to) return amount;
  if (usdToEur === null || usdToEur <= 0) return null;
  return from === "USD" ? amount * usdToEur : amount / usdToEur;
}

export function companyMargin(input: MarginInput): Margin {
  const revenue = input.pricePerSeat === null ? null : input.seats * input.pricePerSeat;
  const cost = convert(input.costUsd, "USD", input.currency, input.usdToEur);
  const margin = revenue !== null && cost !== null ? revenue - cost : null;
  const rate = margin !== null && revenue !== null && revenue > 0 ? margin / revenue : null;
  return { currency: input.currency, revenue, cost, margin, rate };
}

/** Totals in euros across companies; null as soon as one amount cannot be converted. */
export function totalInEur(margins: Margin[], usdToEur: number | null): { revenue: number | null; cost: number | null; margin: number | null } {
  let revenue: number | null = 0;
  let cost: number | null = 0;
  for (const m of margins) {
    const r = m.revenue === null ? 0 : convert(m.revenue, m.currency, "EUR", usdToEur);
    const c = m.cost === null ? null : convert(m.cost, m.currency, "EUR", usdToEur);
    revenue = revenue === null || r === null ? null : revenue + r;
    cost = cost === null || c === null ? null : cost + c;
  }
  return { revenue, cost, margin: revenue !== null && cost !== null ? revenue - cost : null };
}
