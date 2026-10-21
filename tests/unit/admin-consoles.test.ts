import { describe, expect, it } from "vitest";
import { companyMargin, convert, totalInEur } from "@/modules/platform/margin";
import { classifyProvider, classifyRenderQueue, type ProviderTraffic, type RenderQueue } from "@/modules/platform/health";
import { daysOf, monthRange, recentMonths } from "@/modules/usage/period";
import { ACTIVITY_CATEGORIES, isActivityCategory } from "@/modules/audit/categories";

describe("margins", () => {
  it("compares a euro price with a dollar cost through our exchange rate", () => {
    const m = companyMargin({ seats: 8, pricePerSeat: 35, currency: "EUR", costUsd: 50, usdToEur: 0.9 });
    expect(m.revenue).toBe(280);
    expect(m.cost).toBeCloseTo(45);
    expect(m.margin).toBeCloseTo(235);
    expect(m.rate).toBeCloseTo(235 / 280);
  });

  it("shows no margin rather than a wrong one when the rate or the price is missing", () => {
    expect(companyMargin({ seats: 8, pricePerSeat: 35, currency: "EUR", costUsd: 50, usdToEur: null })).toMatchObject({ revenue: 280, cost: null, margin: null });
    expect(companyMargin({ seats: 8, pricePerSeat: null, currency: "EUR", costUsd: 50, usdToEur: 0.9 })).toMatchObject({ revenue: null, margin: null, rate: null });
    // A dollar price needs no rate.
    expect(companyMargin({ seats: 2, pricePerSeat: 40, currency: "USD", costUsd: 100, usdToEur: null })).toMatchObject({ margin: -20, rate: -0.25 });
  });

  it("adds up companies in euros, or not at all", () => {
    const a = companyMargin({ seats: 10, pricePerSeat: 30, currency: "EUR", costUsd: 100, usdToEur: 0.5 });
    const b = companyMargin({ seats: 1, pricePerSeat: 40, currency: "USD", costUsd: 10, usdToEur: 0.5 });
    expect(totalInEur([a, b], 0.5)).toEqual({ revenue: 320, cost: 55, margin: 265 });
    const noRate = companyMargin({ seats: 10, pricePerSeat: 30, currency: "EUR", costUsd: 100, usdToEur: null });
    expect(totalInEur([noRate], null)).toEqual({ revenue: 300, cost: null, margin: null });
    expect(convert(10, "EUR", "USD", 0.5)).toBe(20);
  });
});

const traffic = (over: Partial<ProviderTraffic>): ProviderTraffic => ({
  provider: "openai",
  requests: 100,
  errors: 0,
  service_errors: 0,
  top_error: null,
  avg_latency_ms: 900,
  last_ok_at: "2026-10-21T10:00:00Z",
  last_error_at: null,
  errors_last_hour: 0,
  ok_last_hour: 10,
  ...over,
});

describe("provider health", () => {
  it("classifies from configuration, then traffic", () => {
    expect(classifyProvider(false, traffic({}), undefined)).toBe("not_configured");
    expect(classifyProvider(true, undefined, undefined)).toBe("no_traffic");
    expect(classifyProvider(true, traffic({}), undefined)).toBe("operational");
    expect(classifyProvider(true, traffic({ service_errors: 6, errors: 6 }), undefined)).toBe("degraded");
    expect(classifyProvider(true, traffic({ errors: 2, service_errors: 2, errors_last_hour: 1, last_error_at: "2026-10-21T10:05:00Z" }), undefined)).toBe("degraded");
    expect(
      classifyProvider(true, traffic({ errors: 4, service_errors: 4, errors_last_hour: 4, ok_last_hour: 0, last_error_at: "2026-10-21T10:05:00Z" }), undefined),
    ).toBe("down");
  });

  it("lets a newer live test speak", () => {
    const failing = traffic({ errors: 4, service_errors: 4, errors_last_hour: 4, ok_last_hour: 0, last_error_at: "2026-10-21T10:05:00Z" });
    expect(classifyProvider(true, failing, { ok: true, code: null, latencyMs: 700, at: "2026-10-21T10:10:00Z" })).toBe("degraded");
    expect(classifyProvider(true, traffic({}), { ok: false, code: "auth_failed", latencyMs: 300, at: "2026-10-21T11:00:00Z" })).toBe("down");
    expect(classifyProvider(true, undefined, { ok: true, code: null, latencyMs: 700, at: "2026-10-21T11:00:00Z" })).toBe("operational");
    // An older test does not override what customers experience now.
    expect(classifyProvider(true, traffic({}), { ok: false, code: "unavailable", latencyMs: 300, at: "2026-10-21T09:00:00Z" })).toBe("operational");
  });

  it("spots a stopped render worker", () => {
    const now = Date.parse("2026-10-21T10:00:00Z");
    const queue = (over: Partial<RenderQueue>): RenderQueue => ({
      queued: 0,
      running: 0,
      oldest_queued_at: null,
      last_heartbeat_at: null,
      succeeded: 0,
      failed: 0,
      last_succeeded_at: null,
      ...over,
    });
    expect(classifyRenderQueue(queue({}), now)).toBe("idle");
    expect(classifyRenderQueue(queue({ queued: 1, oldest_queued_at: "2026-10-21T09:59:30Z" }), now)).toBe("working");
    expect(classifyRenderQueue(queue({ queued: 1, oldest_queued_at: "2026-10-21T09:50:00Z" }), now)).toBe("stuck");
    expect(classifyRenderQueue(queue({ running: 1, last_heartbeat_at: "2026-10-21T09:59:50Z" }), now)).toBe("working");
    expect(classifyRenderQueue(queue({ running: 1, last_heartbeat_at: "2026-10-21T09:50:00Z" }), now)).toBe("stuck");
  });
});

describe("usage periods and activity categories", () => {
  it("offers calendar months and refuses others", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const months = recentMonths(3, now);
    expect(months).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(monthRange("2025-12", months)).toMatchObject({ key: "2025-12", current: false });
    expect(monthRange("2027-01", months).key).toBe("2026-01");
    expect(monthRange(undefined, months).current).toBe(true);
    const { from, to } = monthRange("2025-11", months);
    expect(daysOf(from, to)).toHaveLength(30);
  });

  it("files every audited action family under a category", () => {
    expect(isActivityCategory("video")).toBe(true);
    expect(isActivityCategory("payments")).toBe(false);
    const prefixes = Object.values(ACTIVITY_CATEGORIES).flat();
    for (const action of ["auth.sign_in", "client.transferred", "hide.settings_updated", "render.requested", "agent.updated", "quota.updated"]) {
      expect(prefixes.some((p) => action.startsWith(p))).toBe(true);
    }
  });
});
