import { beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Operations (V1.1 phase 10) against the real database: our team's health indicators are counts only
 * and ours only; the clock's heartbeat is written by our server and read by nobody else; the public
 * health check says up or down without any data.
 */
vi.stubEnv("CRON_SECRET", "test-cron-secret");
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => undefined }));

const { GET: health } = await import("@/app/api/health/route");
const { GET: cron } = await import("@/app/api/cron/workflows/route");

let owner: TestUser, member: TestUser, pat: TestUser;
let company: string;

beforeAll(async () => {
  [owner, member, pat] = await Promise.all([createUser("ops-owner"), createUser("ops-member"), createUser("ops-pat")]);
  company = await createCompany(owner, "Ops Co");
  await addMember(owner, company, member);
  await makePlatformAdmin(pat);
  // Something to count: a failed run and an imported archive in progress.
  const [wf] = await sql<{ id: string }>("insert into public.workflows (company_id, owner_id, name) values ($1, $2, 'Relance devis secrète') returning id", [company, owner.id]);
  await sql("insert into public.workflow_runs (workflow_id, company_id, mode, trigger, status, error_code, input) values ($1, $2, 'live', 'manual', 'failed', 'provider_error', $3)", [
    wf.id,
    company,
    JSON.stringify({ text: "Contrat confidentiel Atlas" }),
  ]);
  await serviceClient().from("usage_events").insert({ company_id: company, user_id: member.id, feature: "dictation", credits: 0.1, status: "ok", latency_ms: 840 });
});

describe("our team's operations indicators", () => {
  it("are counts, codes and times only, for our team", async () => {
    const { data, error } = await pat.client.rpc("platform_operations_health", { p_hours: 24 });
    expect(error).toBeNull();
    const ops = data as Record<string, Record<string, unknown> | unknown[]>;
    expect(Object.keys(ops).sort()).toEqual(["clock", "imports", "integrations", "latency", "workflows"]);
    expect(Number((ops.workflows as Record<string, unknown>).failed)).toBeGreaterThanOrEqual(1);
    expect((ops.workflows as Record<string, unknown>).top_error).toBeTruthy();
    expect((ops.latency as { feature: string }[]).some((l) => l.feature === "dictation")).toBe(true);
    // Nothing a customer wrote: not a workflow's name, not a run's data.
    const text = JSON.stringify(data);
    expect(text).not.toContain("Relance devis");
    expect(text).not.toContain("Atlas");
  });

  it("are refused to a company's Owner and members", async () => {
    for (const user of [owner, member]) {
      const { error } = await user.client.rpc("platform_operations_health", { p_hours: 24 });
      expect(error?.message).toBe("forbidden");
    }
    expect((await pat.client.rpc("platform_operations_health", { p_hours: 0 })).error?.message).toBe("validation");
  });

  it("keep the clock's heartbeat out of anyone's reach but our server", async () => {
    for (const user of [owner, pat]) {
      const read = await user.client.from("platform_heartbeats").select("name");
      expect(read.data ?? []).toEqual([]);
      const write = await user.client.from("platform_heartbeats").insert({ name: "workflows.tick" });
      expect(write.error).not.toBeNull();
    }
  });
});

describe("the clock and the health check", () => {
  it("records each run of the clock (counts only), and refuses a caller without the secret", async () => {
    const refused = await cron(new Request("http://localhost/api/cron/workflows"));
    expect(refused.status).toBe(403);
    const response = await cron(new Request("http://localhost/api/cron/workflows", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(response.status).toBe(200);
    const [beat] = await sql<{ at: string; detail: Record<string, number> }>("select at, detail from public.platform_heartbeats where name = 'workflows.tick'");
    expect(Date.now() - Date.parse(beat.at)).toBeLessThan(60_000);
    expect(Object.keys(beat.detail).sort()).toEqual(["emails", "executed", "ms", "scheduled"]);
    const { data } = await pat.client.rpc("platform_operations_health", { p_hours: 24 });
    expect((data as { clock: { at: string } | null }).clock?.at).toBeTruthy();
  });

  it("says the site and its database are up, with the version and nothing else", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", checks: { database: { ok: true } } });
    expect(Object.keys(body).sort()).toEqual(["checks", "status", "version"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
