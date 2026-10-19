import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  createClientRecord,
  createCompany,
  createUser,
  makePlatformAdmin,
  serviceClient,
  sql,
  type TestUser,
} from "../helpers/supabase";

/**
 * Step 2 security rules, with real users and real JWTs through the public API:
 * private conversations, restricted clients, AI answers and usage that users cannot forge,
 * quotas, model settings, search and attachment storage, platform admin without content.
 */
let ownerA: TestUser, olivier: TestUser, nathalie: TestUser, usageAdmin: TestUser, modelsAdmin: TestUser;
let ownerB: TestUser, platform: TestUser;
let companyA: string, companyB: string, clientA: string, clientB: string;
let olivierConversation: string, olivierMessage: string, clientConversation: string;

beforeAll(async () => {
  [ownerA, olivier, nathalie, usageAdmin, modelsAdmin, ownerB, platform] = await Promise.all([
    createUser("chat-owner-a", "Owner A"),
    createUser("chat-olivier", "Olivier"),
    createUser("chat-nathalie", "Nathalie"),
    createUser("chat-usage-admin", "Usage Admin"),
    createUser("chat-models-admin", "Models Admin"),
    createUser("chat-owner-b", "Owner B"),
    createUser("chat-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  companyA = await createCompany(ownerA, "Chat Co A");
  companyB = await createCompany(ownerB, "Chat Co B");
  await addMember(ownerA, companyA, olivier);
  await addMember(ownerA, companyA, nathalie);
  await addMember(ownerA, companyA, usageAdmin, "admin", ["usage", "quotas"]);
  await addMember(ownerA, companyA, modelsAdmin, "admin", ["models"]);
  clientA = await createClientRecord(ownerA, companyA, "Client A", "restricted");
  clientB = await createClientRecord(ownerB, companyB, "Client B", "open");
  const assign = await ownerA.client.from("client_assignments").insert({ client_id: clientA, company_id: companyA, user_id: olivier.id });
  if (assign.error) throw assign.error;

  const conv = await olivier.client.from("conversations").insert({ company_id: companyA, model_choice: "auto" }).select("id").single();
  if (conv.error) throw conv.error;
  olivierConversation = conv.data.id;
  const msg = await olivier.client
    .from("messages")
    .insert({ conversation_id: olivierConversation, content: "Prépare la relance du devis Dupont, budget confidentiel" })
    .select("id, seq, author_type, company_id")
    .single();
  if (msg.error) throw msg.error;
  olivierMessage = msg.data.id;

  const withClient = await olivier.client.from("conversations").insert({ company_id: companyA, client_id: clientA }).select("id").single();
  if (withClient.error) throw withClient.error;
  clientConversation = withClient.data.id;
  await olivier.client.from("messages").insert({ conversation_id: clientConversation, content: "Note sur Client A" });
});

const ids = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id);

describe("conversations are private to their participants", () => {
  it("sets the sequence number, company and title on the server side", async () => {
    const { data } = await olivier.client.from("messages").select("seq, author_type, author_id, company_id").eq("id", olivierMessage).single();
    expect(data).toMatchObject({ seq: 1, author_type: "user", author_id: olivier.id, company_id: companyA });
    const { data: conv } = await olivier.client.from("conversations").select("title, owner_id").eq("id", olivierConversation).single();
    expect(conv).toEqual({ title: "Prépare la relance du devis Dupont, budget confidentiel", owner_id: olivier.id });
  });

  it("hides a member's conversation from colleagues, the Owner included, and from other companies", async () => {
    for (const other of [nathalie, ownerA, usageAdmin, ownerB]) {
      expect(ids((await other.client.from("conversations").select("id").eq("id", olivierConversation)).data)).toEqual([]);
      expect((await other.client.from("messages").select("id").eq("conversation_id", olivierConversation)).data).toEqual([]);
      expect((await other.client.from("conversation_participants").select("user_id").eq("conversation_id", olivierConversation)).data).toEqual([]);
    }
  });

  it("does not let anyone write into someone else's conversation", async () => {
    const intrusion = await nathalie.client.from("messages").insert({ conversation_id: olivierConversation, content: "coucou" });
    expect(intrusion.error).not.toBeNull();
    const rename = await nathalie.client.from("conversations").update({ title: "hacked" }).eq("id", olivierConversation);
    expect(rename.error).toBeNull();
    const [row] = await sql<{ title: string }>("select title from public.conversations where id = $1", [olivierConversation]);
    expect(row.title).not.toBe("hacked");
    await nathalie.client.from("conversations").delete().eq("id", olivierConversation);
    expect((await sql("select 1 from public.conversations where id = $1", [olivierConversation])).length).toBe(1);
  });

  it("does not let a user create a conversation in another company or for someone else", async () => {
    expect((await ownerB.client.from("conversations").insert({ company_id: companyA })).error).not.toBeNull();
    // owner_id cannot be chosen: the column is not writable by users.
    const forged = await nathalie.client.from("conversations").insert({ company_id: companyA, owner_id: olivier.id } as never);
    expect(forged.error).not.toBeNull();
  });

  it("does not find other people's conversations through search", async () => {
    const mine = await olivier.client.rpc("search_conversations", { p_company: companyA, p_query: "Dupont" });
    expect((mine.data ?? []).map((r) => r.conversation_id)).toContain(olivierConversation);
    for (const other of [nathalie, ownerA, ownerB]) {
      const { data } = await other.client.rpc("search_conversations", { p_company: companyA, p_query: "Dupont" });
      expect(data ?? []).toEqual([]);
    }
  });
});

describe("AI answers can only come from the server", () => {
  it("refuses an assistant message or model fields written by a user", async () => {
    const asAssistant = await olivier.client.from("messages").insert({ conversation_id: olivierConversation, content: "fake", author_type: "assistant" } as never);
    expect(asAssistant.error).not.toBeNull();
    const withModel = await olivier.client.from("messages").insert({ conversation_id: olivierConversation, content: "fake", model_id: "claude-sonnet-5-5" } as never);
    expect(withModel.error).not.toBeNull();
    const asOther = await olivier.client.from("messages").insert({ conversation_id: olivierConversation, content: "fake", author_id: nathalie.id } as never);
    expect(asOther.error).not.toBeNull();
  });

  it("does not let users edit or delete messages", async () => {
    await olivier.client.from("messages").update({ content: "edited" } as never).eq("id", olivierMessage);
    await olivier.client.from("messages").delete().eq("id", olivierMessage);
    const [row] = await sql<{ content: string }>("select content from public.messages where id = $1", [olivierMessage]);
    expect(row.content).toContain("Dupont");
  });

  it("lets the server write an answer, which the participant then sees", async () => {
    const { data, error } = await serviceClient()
      .from("messages")
      .insert({ conversation_id: olivierConversation, author_type: "assistant", author_id: null, content: "Voici la relance.", provider: "anthropic", model_id: "claude-sonnet-5-5", model_label: "Claude Sonnet 5.5" })
      .select("id, seq, company_id")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ seq: 2, company_id: companyA });
    const seen = await olivier.client.from("messages").select("author_type, model_id").eq("id", data!.id).single();
    expect(seen.data).toEqual({ author_type: "assistant", model_id: "claude-sonnet-5-5" });
  });
});

describe("conversations about a restricted client follow the client's access", () => {
  it("refuses to link a conversation to a restricted client one cannot access, or to another company's client", async () => {
    expect((await nathalie.client.from("conversations").insert({ company_id: companyA, client_id: clientA })).error).not.toBeNull();
    expect((await olivier.client.from("conversations").insert({ company_id: companyA, client_id: clientB })).error).not.toBeNull();
    const relink = await olivier.client.from("conversations").update({ client_id: clientB }).eq("id", olivierConversation);
    expect(relink.error).not.toBeNull();
  });

  it("removes access to the client's conversations when the person loses access to the client", async () => {
    expect(ids((await olivier.client.from("conversations").select("id").eq("id", clientConversation)).data)).toEqual([clientConversation]);
    await ownerA.client.from("client_assignments").delete().eq("client_id", clientA).eq("user_id", olivier.id);
    expect((await olivier.client.from("conversations").select("id").eq("id", clientConversation)).data).toEqual([]);
    expect((await olivier.client.from("messages").select("id").eq("conversation_id", clientConversation)).data).toEqual([]);
    expect((await olivier.client.from("messages").insert({ conversation_id: clientConversation, content: "still here?" })).error).not.toBeNull();
    await ownerA.client.from("client_assignments").insert({ client_id: clientA, company_id: companyA, user_id: olivier.id });
    expect(ids((await olivier.client.from("conversations").select("id").eq("id", clientConversation)).data)).toEqual([clientConversation]);
  });
});

describe("attachments", () => {
  let path: string;

  it("stores files in a private bucket readable only by the conversation's participants", async () => {
    path = `${olivierConversation}/notes.txt`;
    const upload = await olivier.client.storage.from("chat-attachments").upload(path, new Blob(["Budget 2027"]), { contentType: "text/plain" });
    expect(upload.error).toBeNull();
    const row = await olivier.client
      .from("conversation_attachments")
      .insert({ conversation_id: olivierConversation, filename: "notes.txt", mime_type: "text/plain", size_bytes: 11, storage_path: path, kind: "document", extracted_text: "Budget 2027" })
      .select("id, company_id")
      .single();
    expect(row.error).toBeNull();
    expect(row.data!.company_id).toBe(companyA);

    expect((await olivier.client.storage.from("chat-attachments").download(path)).error).toBeNull();
    for (const other of [nathalie, ownerA, ownerB, platform]) {
      expect((await other.client.storage.from("chat-attachments").download(path)).data).toBeNull();
      expect((await other.client.from("conversation_attachments").select("id").eq("conversation_id", olivierConversation)).data).toEqual([]);
    }
  });

  it("refuses uploads into someone else's conversation", async () => {
    const upload = await nathalie.client.storage.from("chat-attachments").upload(`${olivierConversation}/intrusion.txt`, new Blob(["x"]));
    expect(upload.error).not.toBeNull();
    const row = await nathalie.client.from("conversation_attachments").insert({
      conversation_id: olivierConversation,
      filename: "x.txt",
      mime_type: "text/plain",
      size_bytes: 1,
      storage_path: `${olivierConversation}/x.txt`,
      kind: "document",
    });
    expect(row.error).not.toBeNull();
  });
});

describe("usage cannot be forged and is visible only to the right people", () => {
  beforeAll(async () => {
    const { error } = await serviceClient().from("usage_events").insert([
      { company_id: companyA, user_id: olivier.id, feature: "chat", provider: "anthropic", model_id: "claude-sonnet-5-5", input_tokens: 1000, output_tokens: 500, credits: 7, estimated_cost_usd: 0.007, status: "ok" },
      { company_id: companyA, user_id: nathalie.id, feature: "chat", provider: "openai", model_id: "gpt-6-luna", input_tokens: 100, output_tokens: 50, credits: 0.035, estimated_cost_usd: 0.00004, status: "ok" },
    ]);
    if (error) throw error;
  });

  it("does not let a user write usage rows", async () => {
    const insert = await olivier.client.from("usage_events").insert({ company_id: companyA, user_id: olivier.id, feature: "chat", credits: 0, status: "ok" } as never);
    expect(insert.error).not.toBeNull();
    await olivier.client.from("usage_events").delete().eq("company_id", companyA);
    expect((await sql("select 1 from public.usage_events where company_id = $1", [companyA])).length).toBeGreaterThanOrEqual(2);
  });

  it("shows members their own usage only; the usage scope sees everyone's", async () => {
    const own = await nathalie.client.from("usage_events").select("user_id").eq("company_id", companyA);
    expect((own.data ?? []).every((r) => r.user_id === nathalie.id)).toBe(true);
    const all = await usageAdmin.client.from("usage_events").select("user_id").eq("company_id", companyA);
    expect(new Set((all.data ?? []).map((r) => r.user_id))).toEqual(new Set([olivier.id, nathalie.id]));
    expect((await modelsAdmin.client.from("usage_events").select("id").neq("user_id", modelsAdmin.id)).data).toEqual([]);
    expect((await ownerB.client.from("usage_events").select("id").eq("company_id", companyA)).data).toEqual([]);
  });

  it("serves the usage dashboard to the usage scope only", async () => {
    const ok = await usageAdmin.client.rpc("company_usage_summary", { p_company: companyA, p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" });
    expect(ok.error).toBeNull();
    const summary = ok.data as { totals: { requests: number; credits: number }; by_model: { model_id: string }[] };
    expect(Number(summary.totals.requests)).toBeGreaterThanOrEqual(2);
    expect(summary.by_model.map((m) => m.model_id)).toContain("claude-sonnet-5-5");
    for (const other of [nathalie, modelsAdmin, ownerB]) {
      const refused = await other.client.rpc("company_usage_summary", { p_company: companyA, p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" });
      expect(refused.error?.message).toBe("forbidden");
    }
  });
});

describe("quotas: company limit (plan + extra credits) and personal limits", () => {
  let quotaOwner: TestUser, quotaMember: TestUser, quotaCompany: string;

  beforeAll(async () => {
    [quotaOwner, quotaMember] = await Promise.all([createUser("quota-owner"), createUser("quota-member")]);
    quotaCompany = await createCompany(quotaOwner, "Quota Co");
    await addMember(quotaOwner, quotaCompany, quotaMember);
    const [plan] = await sql<{ id: string }>("insert into public.plans (name, monthly_credits) values ('Quota plan', 100) returning id");
    await sql("update public.companies set plan_id = $1 where id = $2", [plan.id, quotaCompany]);
  });

  const status = async (user: TestUser) => {
    const { data, error } = await user.client.rpc("my_quota_status", { p_company: quotaCompany });
    if (error) throw error;
    return data![0];
  };
  const spend = (user: TestUser, credits: number) =>
    serviceClient().from("usage_events").insert({ company_id: quotaCompany, user_id: user.id, feature: "chat", credits, status: "ok" });

  it("starts from the plan's monthly credits", async () => {
    expect(await status(quotaMember)).toMatchObject({ company_limit: 100, company_used: 0, user_limit: null, user_used: 0 });
  });

  it("counts everyone's credits for the company and each person's own", async () => {
    await spend(quotaMember, 50);
    await spend(quotaOwner, 35);
    expect(await status(quotaMember)).toMatchObject({ company_used: 85, user_used: 50 });
  });

  it("lets only the quotas scope set personal limits, and applies them", async () => {
    expect((await quotaMember.client.rpc("admin_set_member_quota", { p_company: quotaCompany, p_user: quotaMember.id, p_credits: 1000 })).error?.message).toBe("forbidden");
    expect((await quotaOwner.client.rpc("admin_set_default_user_quota", { p_company: quotaCompany, p_credits: 40 })).error).toBeNull();
    expect(await status(quotaMember)).toMatchObject({ user_limit: 40, user_used: 50 });
    expect((await quotaOwner.client.rpc("admin_set_member_quota", { p_company: quotaCompany, p_user: quotaMember.id, p_credits: 60 })).error).toBeNull();
    expect(await status(quotaMember)).toMatchObject({ user_limit: 60 });
    // null removes the personal override: the default applies again.
    await quotaOwner.client.rpc("admin_set_member_quota", { p_company: quotaCompany, p_user: quotaMember.id, p_credits: null as never });
    expect(await status(quotaMember)).toMatchObject({ user_limit: 40 });
  });

  it("lets only the platform admin raise the company limit for the month", async () => {
    expect((await quotaOwner.client.rpc("platform_grant_credits", { p_company: quotaCompany, p_credits: 1000 })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_grant_credits", { p_company: quotaCompany, p_credits: 50, p_note: "test" })).error).toBeNull();
    expect(await status(quotaMember)).toMatchObject({ company_limit: 150 });
    const { data } = await quotaOwner.client.from("credit_grants").select("credits").eq("company_id", quotaCompany);
    expect((data ?? []).map((g) => Number(g.credits))).toEqual([50]);
  });

  it("refuses to read another company's quota", async () => {
    expect((await ownerB.client.rpc("my_quota_status", { p_company: quotaCompany })).error?.message).toBe("forbidden");
  });
});

describe("company model settings", () => {
  it("are readable by members and changed only with the models scope", async () => {
    const { data } = await nathalie.client.from("company_allowed_models").select("model_id").eq("company_id", companyA);
    expect((data ?? []).length).toBeGreaterThan(0);
    const args = { p_company: companyA, p_allowed: ["claude-sonnet-5-5", "gpt-6-luna"], p_default: "claude-sonnet-5-5", p_auto: false };
    expect((await nathalie.client.rpc("admin_update_model_settings", args)).error?.message).toBe("forbidden");
    expect((await usageAdmin.client.rpc("admin_update_model_settings", args)).error?.message).toBe("forbidden");
    expect((await ownerB.client.rpc("admin_update_model_settings", args)).error?.message).toBe("forbidden");
    expect((await modelsAdmin.client.rpc("admin_update_model_settings", args)).error).toBeNull();
    const after = await nathalie.client.from("company_allowed_models").select("model_id").eq("company_id", companyA);
    expect((after.data ?? []).map((r) => r.model_id).sort()).toEqual(["claude-sonnet-5-5", "gpt-6-luna"]);
    const settings = await nathalie.client.from("company_ai_settings").select("auto_enabled, default_model_id").eq("company_id", companyA).single();
    expect(settings.data).toEqual({ auto_enabled: false, default_model_id: "claude-sonnet-5-5" });
  });

  it("refuses inconsistent settings", async () => {
    const run = (p_allowed: string[], p_default: string | null, p_auto: boolean) =>
      modelsAdmin.client.rpc("admin_update_model_settings", { p_company: companyA, p_allowed, p_default: p_default as string, p_auto });
    expect((await run([], null, true)).error?.message).toBe("invalid_models");
    expect((await run(["no-such-model"], null, true)).error?.message).toBe("invalid_models");
    expect((await run(["gpt-6-luna"], "claude-sonnet-5-5", true)).error?.message).toBe("invalid_models");
    expect((await run(["gpt-6-luna"], null, false)).error?.message).toBe("invalid_models");
    expect((await run(["gpt-6-luna", "claude-sonnet-5-5"], null, true)).error).toBeNull();
  });

  it("keeps the catalogue editable by the platform admin only", async () => {
    await ownerA.client.from("ai_models").update({ input_credits_per_mtok: 0 }).eq("id", "gpt-6-luna");
    const [row] = await sql<{ input_credits_per_mtok: string }>("select input_credits_per_mtok from public.ai_models where id = 'gpt-6-luna'");
    expect(Number(row.input_credits_per_mtok)).toBeGreaterThan(0);
    const ok = await platform.client.from("ai_models").update({ label: "GPT-6 Luna" }).eq("id", "gpt-6-luna").select("id");
    expect(ok.data).toHaveLength(1);
  });

  it("records changes in the activity log, metadata only", async () => {
    const { data } = await ownerA.client.from("audit_log").select("action, metadata").eq("company_id", companyA).eq("action", "models.updated");
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("platform admin: account metadata, never conversation content", () => {
  const CONTENT_TABLES = [
    "conversations",
    "conversation_participants",
    "messages",
    "conversation_attachments",
    "usage_events",
    "company_ai_settings",
    "company_allowed_models",
    "member_quotas",
    "credit_grants",
  ] as const;

  it.each(CONTENT_TABLES)("reads zero rows from %s", async (table) => {
    const { data } = await platform.client.from(table).select("*").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("cannot search conversations", async () => {
    const { data } = await platform.client.rpc("search_conversations", { p_company: companyA, p_query: "Dupont" });
    expect(data ?? []).toEqual([]);
  });

  it("sees credits and estimated cost per company, as numbers only", async () => {
    const { data, error } = await platform.client.rpc("platform_company_credits");
    expect(error).toBeNull();
    const a = data!.find((c) => c.company_id === companyA)!;
    expect(Number(a.credits_used)).toBeGreaterThan(0);
    expect(Object.keys(a).sort()).toEqual(["company_id", "credit_limit", "credits_used", "estimated_cost_usd", "granted", "requests"]);
    expect((await ownerA.client.rpc("platform_company_credits")).error?.message).toBe("forbidden");
  });
});
