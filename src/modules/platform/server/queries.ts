import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProviderTest, ProviderTraffic, RenderQueue } from "../health";

/** Company metadata only (name, plan, seats, owner email). Never content. */
export async function listCompaniesForPlatform() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_list_companies");
  return data ?? [];
}

export async function listPlans() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, name, description, price_label, monthly_price_per_seat, price_currency, seat_limit, monthly_credits, video_credits, is_default, is_active, created_at")
    .order("created_at");
  return data ?? [];
}

export type PlanRow = Awaited<ReturnType<typeof listPlans>>[number];

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Usage, estimated AI cost and plan price per company over a period (our margin view). Never content. */
export async function getUsageOverview(from: Date, to: Date) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_usage_overview", { p_from: from.toISOString(), p_to: to.toISOString() });
  return (data ?? []).map((r) => ({
    companyId: r.company_id,
    name: r.name,
    status: r.status,
    planName: r.plan_name,
    pricePerSeat: r.price_per_seat === null ? null : Number(r.price_per_seat),
    currency: (r.price_currency === "USD" ? "USD" : "EUR") as "EUR" | "USD",
    seats: num(r.seats_active),
    requests: num(r.requests),
    errors: num(r.errors),
    credits: num(r.credits),
    costUsd: num(r.estimated_cost_usd),
    videoCredits: num(r.video_credits),
    renders: num(r.renders),
  }));
}

export async function getPlatformSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("usd_to_eur, updated_at").maybeSingle();
  return { usdToEur: data?.usd_to_eur === null || data?.usd_to_eur === undefined ? null : Number(data.usd_to_eur), updatedAt: data?.updated_at ?? null };
}

type Row = Record<string, string | number | null>;
const numbers = (rows: unknown) =>
  ((rows ?? []) as Row[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])));

/** One company's usage for our team: per day, model and feature. Never per person, never content. */
export async function getCompanyUsageForPlatform(companyId: string, from: Date, to: Date) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_company_usage", { p_company: companyId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error || !data) return null;
  const raw = data as { totals: Row; by_model: Row[]; by_feature: Row[]; by_day: Row[]; video: Row };
  const totals = raw.totals;
  return {
    totals: { requests: num(totals.requests), errors: num(totals.errors), credits: num(totals.credits), costUsd: num(totals.estimated_cost_usd), activeUsers: num(totals.active_users) },
    byModel: numbers(raw.by_model) as { model_id: string; provider: string; requests: number; credits: number; estimated_cost_usd: number }[],
    byFeature: numbers(raw.by_feature) as { feature: string; requests: number; credits: number; estimated_cost_usd: number }[],
    byDay: numbers(raw.by_day) as { day: string; requests: number; credits: number; estimated_cost_usd: number }[],
    video: { credits: num(raw.video.credits), renders: num(raw.video.renders) },
  };
}

/** Requests, errors and speed per provider over the last day, and the render queue. Metadata only. */
export async function getProviderHealth() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_provider_health", { p_hours: 24 });
  const raw = (data ?? { providers: [], render: {} }) as { providers: Row[]; render: Row };
  const r = raw.render;
  return {
    providers: numbers(raw.providers) as unknown as ProviderTraffic[],
    render: {
      queued: num(r.queued),
      running: num(r.running),
      oldest_queued_at: (r.oldest_queued_at as string | null) ?? null,
      last_heartbeat_at: (r.last_heartbeat_at as string | null) ?? null,
      succeeded: num(r.succeeded),
      failed: num(r.failed),
      last_succeeded_at: (r.last_succeeded_at as string | null) ?? null,
    } satisfies RenderQueue,
  };
}

/** The latest live test of each provider, from the platform audit log. */
export async function getLastProviderTests(): Promise<Map<string, ProviderTest>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("target_id, metadata, created_at")
    .eq("scope", "platform")
    .eq("action", "provider.tested")
    .order("created_at", { ascending: false })
    .limit(30);
  const tests = new Map<string, ProviderTest>();
  for (const e of data ?? []) {
    if (!e.target_id || tests.has(e.target_id)) continue;
    const m = (e.metadata ?? {}) as { ok?: boolean; code?: string | null; latency_ms?: number | null };
    tests.set(e.target_id, { ok: m.ok === true, code: m.code ?? null, latencyMs: m.latency_ms ?? null, at: e.created_at });
  }
  return tests;
}
