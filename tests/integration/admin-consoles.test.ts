import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 9, the admin consoles (CLAUDE.md §4.8, §4.9): the company usage dashboard keeps AI and video
 * credits apart and is reserved to the "usage" scope; the platform's margin view, company detail,
 * provider health, exchange rate and plan prices are reserved to our team and return totals only.
 */
let owner: TestUser, member: TestUser, usageAdmin: TestUser, modelsAdmin: TestUser, ownerB: TestUser, platform: TestUser;
let company: string, companyB: string;

// A month in the past, so other test files' usage cannot change the figures.
const FROM = "2001-02-01T00:00:00Z";
const TO = "2001-03-01T00:00:00Z";
const AT = "2001-02-14T10:00:00Z";

beforeAll(async () => {
  [owner, member, usageAdmin, modelsAdmin, ownerB, platform] = await Promise.all([
    createUser("consoles-owner", "Owner"),
    createUser("consoles-member", "Member"),
    createUser("consoles-usage", "Usage Admin"),
    createUser("consoles-models", "Models Admin"),
    createUser("consoles-owner-b", "Owner B"),
    createUser("consoles-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  company = await createCompany(owner, "Consoles Co");
  companyB = await createCompany(ownerB, "Consoles Co B");
  await addMember(owner, company, member);
  await addMember(owner, company, usageAdmin, "admin", ["usage"]);
  await addMember(owner, company, modelsAdmin, "admin", ["models"]);

  // One shape for every row: a bulk insert sends null for the keys a row leaves out.
  const base = {
    company_id: company,
    provider: "openai" as "openai" | null,
    model_id: "gpt-test" as string | null,
    credit_pool: "standard",
    error_code: null as string | null,
    estimated_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    latency_ms: null as number | null,
    created_at: AT,
  };
  const { error } = await serviceClient()
    .from("usage_events")
    .insert([
      { ...base, user_id: owner.id, feature: "chat", status: "ok", credits: 10, estimated_cost_usd: 0.012, input_tokens: 900, output_tokens: 100, latency_ms: 800 },
      { ...base, user_id: member.id, feature: "agent", status: "ok", credits: 5, estimated_cost_usd: 0.006, input_tokens: 400, output_tokens: 50, latency_ms: 600 },
      { ...base, user_id: member.id, feature: "chat", status: "error", error_code: "unavailable", credits: 0, estimated_cost_usd: 0 },
      { ...base, user_id: member.id, feature: "render", status: "ok", credits: 30, credit_pool: "video", provider: null, model_id: null },
      { ...base, company_id: companyB, user_id: ownerB.id, feature: "chat", status: "ok", credits: 99, estimated_cost_usd: 0.5 },
    ]);
  if (error) throw error;
});

afterAll(async () => {
  await sql("update public.platform_settings set usd_to_eur = null");
});

const range = { p_from: FROM, p_to: TO };

describe("company usage dashboard", () => {
  it("separates AI credits from video credits and counts active people", async () => {
    const { data, error } = await owner.client.rpc("company_usage_summary", { p_company: company, ...range });
    expect(error).toBeNull();
    const summary = data as {
      totals: Record<string, number>;
      by_feature: { feature: string; credits: number }[];
      by_user: { user_id: string }[];
      video: Record<string, number>;
    };
    expect(summary.totals).toMatchObject({ requests: 3, errors: 1, credits: 15, active_users: 2 });
    expect(summary.by_feature.map((f) => f.feature).sort()).toEqual(["agent", "chat"]);
    expect(summary.video.credits).toBe(30);
    // The other company's usage never shows.
    expect(summary.by_user.map((u) => u.user_id)).not.toContain(ownerB.id);
  });

  it("is reserved to the Owner and admins with the usage scope", async () => {
    expect((await usageAdmin.client.rpc("company_usage_summary", { p_company: company, ...range })).error).toBeNull();
    for (const refused of [member, modelsAdmin, ownerB, platform]) {
      expect((await refused.client.rpc("company_usage_summary", { p_company: company, ...range })).error?.message).toBe("forbidden");
    }
  });
});

describe("platform margin view", () => {
  it("returns usage, estimated cost and plan price per company, to our team only", async () => {
    const { data, error } = await platform.client.rpc("platform_usage_overview", range);
    expect(error).toBeNull();
    const row = data?.find((r) => r.company_id === company);
    expect(row).toMatchObject({ name: "Consoles Co", requests: 3, errors: 1, seats_active: 4 });
    expect(Number(row?.credits)).toBe(15);
    expect(Number(row?.video_credits)).toBe(30);
    expect(Number(row?.estimated_cost_usd)).toBeCloseTo(0.018, 6);
    // Metadata only: no column that could carry content.
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "company_id",
        "created_at",
        "credits",
        "errors",
        "estimated_cost_usd",
        "name",
        "plan_name",
        "price_currency",
        "price_per_seat",
        "renders",
        "requests",
        "seats_active",
        "status",
        "video_credits",
      ].sort(),
    );
    for (const refused of [owner, usageAdmin, member]) {
      expect((await refused.client.rpc("platform_usage_overview", range)).error?.message).toBe("forbidden");
    }
  });

  it("details one company per day, model and feature, never per person", async () => {
    const { data, error } = await platform.client.rpc("platform_company_usage", { p_company: company, ...range });
    expect(error).toBeNull();
    const detail = data as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(["by_day", "by_feature", "by_model", "totals", "video"]);
    expect(JSON.stringify(detail)).not.toContain(owner.id);
    expect(JSON.stringify(detail)).not.toContain(member.id);
    expect(detail.totals).toMatchObject({ requests: 3, active_users: 2 });
    expect((await owner.client.rpc("platform_company_usage", { p_company: company, ...range })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_company_usage", { p_company: crypto.randomUUID(), ...range })).error?.message).toBe("not_found");
  });

  it("lets only our team set the exchange rate, through its function", async () => {
    expect((await owner.client.rpc("platform_set_exchange_rate", { p_usd_to_eur: 0.5 })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_set_exchange_rate", { p_usd_to_eur: -1 })).error?.message).toBe("validation");
    expect((await platform.client.rpc("platform_set_exchange_rate", { p_usd_to_eur: 0.92 })).error).toBeNull();
    expect((await platform.client.from("platform_settings").select("usd_to_eur").single()).data).toEqual({ usd_to_eur: 0.92 });
    expect((await owner.client.from("platform_settings").select("usd_to_eur")).data).toEqual([]);
    // No direct writes, even for our team: the function logs every change.
    expect((await platform.client.from("platform_settings").update({ usd_to_eur: 2 }).eq("id", true)).error).not.toBeNull();
    const [logged] = await sql<{ metadata: { usd_to_eur: number } }>(
      "select metadata from public.audit_log where scope = 'platform' and action = 'settings.exchange_rate' order by created_at desc limit 1",
    );
    expect(Number(logged.metadata.usd_to_eur)).toBe(0.92);
  });

  it("lets only our team set a plan's price per seat", async () => {
    const [plan] = await sql<{ id: string }>("select plan_id as id from public.companies where id = $1", [company]);
    const tried = await owner.client.from("plans").update({ monthly_price_per_seat: 1 }).eq("id", plan.id).select("id");
    expect(tried.data ?? []).toEqual([]);
    const done = await platform.client.from("plans").update({ monthly_price_per_seat: 35, price_currency: "EUR" }).eq("id", plan.id).select("monthly_price_per_seat");
    expect(done.data).toEqual([{ monthly_price_per_seat: 35 }]);
    expect((await platform.client.from("plans").update({ price_currency: "GBP" }).eq("id", plan.id)).error).not.toBeNull();
    await sql("update public.plans set monthly_price_per_seat = null where id = $1", [plan.id]);
  });
});

describe("provider health", () => {
  it("reports requests and errors per provider and the render queue, to our team only", async () => {
    await serviceClient()
      .from("usage_events")
      .insert([
        { company_id: company, user_id: owner.id, provider: "anthropic", feature: "chat", status: "ok", error_code: null, latency_ms: 1200 },
        { company_id: company, user_id: owner.id, provider: "anthropic", feature: "chat", status: "error", error_code: "rate_limited", latency_ms: null },
        { company_id: company, user_id: owner.id, provider: "anthropic", feature: "chat", status: "error", error_code: "content_filtered", latency_ms: null },
      ]);
    const { data, error } = await platform.client.rpc("platform_provider_health", { p_hours: 24 });
    expect(error).toBeNull();
    const health = data as { providers: Record<string, number | string | null>[]; render: Record<string, unknown> };
    const anthropic = health.providers.find((p) => p.provider === "anthropic")!;
    expect(Number(anthropic.requests)).toBeGreaterThanOrEqual(3);
    // A refusal by the safety filter says nothing about the provider's health.
    expect(Number(anthropic.errors) - Number(anthropic.service_errors)).toBeGreaterThanOrEqual(1);
    expect(Object.keys(health.render).sort()).toEqual(["failed", "last_heartbeat_at", "last_succeeded_at", "oldest_queued_at", "queued", "running", "succeeded"]);
    expect((await owner.client.rpc("platform_provider_health", { p_hours: 24 })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_provider_health", { p_hours: 0 })).error?.message).toBe("validation");
  });

  it("logs a live test as metadata, out of the companies' activity log", async () => {
    expect((await owner.client.rpc("platform_log_provider_test", { p_provider: "openai", p_ok: true, p_code: "", p_latency_ms: 5 })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_log_provider_test", { p_provider: "mistral", p_ok: true, p_code: "", p_latency_ms: 5 })).error?.message).toBe("validation");
    expect((await platform.client.rpc("platform_log_provider_test", { p_provider: "google", p_ok: false, p_code: "Some <provider> text", p_latency_ms: 940 })).error).toBeNull();
    const [event] = await sql<{ company_id: string | null; metadata: Record<string, unknown> }>(
      "select company_id, metadata from public.audit_log where action = 'provider.tested' and target_id = 'google' order by created_at desc limit 1",
    );
    // Only a short code is kept: anything that looks like provider text is dropped.
    expect(event).toEqual({ company_id: null, metadata: { ok: false, code: null, latency_ms: 940 } });
    const visible = await owner.client.from("audit_log").select("id").eq("action", "provider.tested");
    expect(visible.data).toEqual([]);
  });
});
