import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, createCompany, createUser, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * The dictation endpoint (one part of a recording → its text) against the real database, with the
 * simulated transcription model: who may use it, what stops it before any audio goes out, what the
 * server reports about its own timings, and what usage keeps (never the text).
 */
vi.stubEnv("AI_FAKE_PROVIDER", "true");

const state = vi.hoisted(() => ({ member: null as null | Record<string, unknown>, client: null as unknown, after: [] as Promise<unknown>[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/auth/guards", () => ({ memberOrNull: async () => state.member }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void state.after.push(Promise.resolve().then(task)),
}));

const { POST } = await import("@/app/api/dictation/route");

let owner: TestUser, member: TestUser;
let company: string;

const as = (user: TestUser, role: "owner" | "member") => {
  state.member = { user: { id: user.id, email: user.email }, active: { companyId: company, role, adminScopes: [] }, profile: { fullName: null } };
  state.client = user.client;
};
const webm = (): Uint8Array<ArrayBuffer> => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 2048 }, (_, i) => i % 251)]);
const part = (audio: Uint8Array<ArrayBuffer> = webm(), extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("audio", new Blob([audio], { type: "audio/webm" }), "dictation.webm");
  for (const [key, value] of Object.entries({ seconds: "3.2", locale: "fr", ...extra })) form.append(key, value);
  return new Request("http://localhost/api/dictation", { method: "POST", body: form });
};
const settle = async () => {
  await Promise.all(state.after.splice(0));
};
const usageRows = () => sql<{ feature: string; status: string; credits: string; model_id: string; error_code: string | null }>(
  "select feature, status, credits, model_id, error_code from public.usage_events where company_id = $1 and feature = 'dictation' order by created_at",
  [company],
);

beforeAll(async () => {
  [owner, member] = await Promise.all([createUser("dict-owner"), createUser("dict-member")]);
  company = await createCompany(owner, "Voix Co");
  await addMember(owner, company, member);
});
afterAll(() => vi.unstubAllEnvs());

describe("dictation endpoint", () => {
  it("turns a part into text, says how long the server took, and counts usage without the text", async () => {
    as(member, "member");
    const response = await POST(part());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, test: true });
    expect(body.text).toContain("dictée de démonstration");
    // Server-Timing: the checks before the model, the model, the total; durations only.
    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toMatch(/^checks;dur=\d+, model;dur=\d+, total;dur=\d+$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await settle();
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "dictation", status: "ok", model_id: "test", error_code: null });
    const [raw] = await sql<{ row: string }>("select row_to_json(u)::text as row from public.usage_events u where company_id = $1 and feature = 'dictation'", [company]);
    expect(raw.row).not.toContain("démonstration");
  });

  it("refuses a file that is not a recording, and a recording claimed longer than the limit", async () => {
    as(member, "member");
    const pdf = new TextEncoder().encode("%PDF-1.7 not audio");
    expect((await (await POST(part(pdf))).json()).error).toBe("invalid_audio");
    expect((await (await POST(part(webm(), { seconds: "999" }))).json()).error).toBe("too_long");
  });

  it("is refused to someone signed out", async () => {
    state.member = null;
    const response = await POST(part());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden");
  });

  it("stops before any transcription when the company switched dictation off", async () => {
    as(owner, "owner");
    expect((await owner.client.rpc("admin_set_ai_features", { p_company: company, p_dictation_enabled: false })).error).toBeNull();
    as(member, "member");
    const before = (await usageRows()).length;
    const response = await POST(part());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("disabled");
    await settle();
    expect((await usageRows()).length).toBe(before);
    as(owner, "owner");
    expect((await owner.client.rpc("admin_set_ai_features", { p_company: company, p_dictation_enabled: true })).error).toBeNull();
  });

  it("stops before any transcription when the credits are used up, and logs the blocked request", async () => {
    const [plan] = await sql<{ id: string }>("insert into public.plans (name, monthly_credits) values ('Dictation plan', 10) returning id");
    await sql("update public.companies set plan_id = $1 where id = $2", [plan.id, company]);
    await serviceClient().from("usage_events").insert({ company_id: company, user_id: owner.id, feature: "chat", credits: 10, status: "ok" });
    as(member, "member");
    const before = (await usageRows()).length;
    const response = await POST(part());
    expect(response.status).toBe(402);
    expect((await response.json()).error).toBe("quota");
    await settle();
    expect((await usageRows()).length).toBe(before);
    const blocked = await sql<{ n: string }>("select count(*)::text as n from public.audit_log where company_id = $1 and action = 'ai.request_blocked'", [company]);
    expect(Number(blocked[0].n)).toBeGreaterThan(0);
  });
});
