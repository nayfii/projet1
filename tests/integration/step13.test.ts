import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 13 launch choices (CLAUDE.md §11), enforced in the database: sign-up by our invitation only,
 * customers see credits only, the launch switches for video apps and the Application Review Assistant,
 * the apps our team adds for every customer, and favourites.
 */
let platform: TestUser, owner: TestUser, member: TestUser, outsider: TestUser, stranger: TestUser;
let companyId: string, otherCompany: string;

beforeAll(async () => {
  [platform, owner, member, outsider, stranger] = await Promise.all([
    createUser("s13-platform", "Équipe Cendr"),
    createUser("s13-owner", "Claire"),
    createUser("s13-member", "Olivier"),
    createUser("s13-outsider", "Autre patron"),
    createUser("s13-stranger", "Inconnu"),
  ]);
  await makePlatformAdmin(platform);
  companyId = await createCompany(owner, "Atelier Treize");
  otherCompany = await createCompany(outsider, "Autre entreprise");
  await addMember(owner, companyId, member);
});

afterAll(async () => {
  // Other test files create their own companies.
  await sql("update public.platform_settings set open_signup = true, video_apps_enabled = false, app_review_enabled = false where id");
});

describe("sign-up by invitation only", () => {
  it("closes self-serve company creation unless our team opens it", async () => {
    await sql("update public.platform_settings set open_signup = false where id");
    expect((await stranger.client.rpc("signup_open")).data).toBe(false);
    expect((await stranger.client.rpc("create_company", { p_name: "Sans invitation" })).error?.message).toBe("invite_only");

    // Only our team switches it.
    expect((await owner.client.rpc("platform_set_open_signup", { p_open: true })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_set_open_signup", { p_open: true })).error).toBeNull();
    expect((await stranger.client.rpc("signup_open")).data).toBe(true);
    const logged = await sql<{ metadata: object }>("select metadata from public.audit_log where scope = 'platform' and action = 'settings.signup' order by created_at desc limit 1");
    expect(logged).toEqual([{ metadata: { open: true } }]);
  });
});

describe("customers see credits only", () => {
  it("never return the estimated provider cost of a usage row to a customer", async () => {
    await sql(
      `insert into public.usage_events (company_id, user_id, feature, provider, model_id, input_tokens, output_tokens, credits, estimated_cost_usd, status)
       values ($1, $2, 'chat', 'openai', 'test-model', 10, 20, 3, 0.0123, 'ok')`,
      [companyId, owner.id],
    );
    expect((await owner.client.from("usage_events").select("estimated_cost_usd")).error).not.toBeNull();
    expect((await owner.client.from("usage_events").select("*")).error).not.toBeNull();
    const credits = await owner.client.from("usage_events").select("credits, model_id").eq("company_id", companyId);
    expect(credits.error).toBeNull();
    expect(credits.data).toEqual([{ credits: 3, model_id: "test-model" }]);

    const now = new Date();
    const { data: summary, error } = await owner.client.rpc("company_usage_summary", {
      p_company: companyId,
      p_from: new Date(now.getTime() - 86_400_000).toISOString(),
      p_to: new Date(now.getTime() + 86_400_000).toISOString(),
    });
    expect(error).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("cost");
  });
});

describe("launch switches", () => {
  it("are off by default, readable by everyone signed in and changed by our team only", async () => {
    await sql("update public.platform_settings set video_apps_enabled = false, app_review_enabled = false where id");
    expect((await member.client.rpc("app_availability")).data).toEqual({ video: false, app_review: false });
    expect((await owner.client.rpc("platform_set_app_switches", { p_video: true })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_set_app_switches", { p_video: true })).error).toBeNull();
    expect((await member.client.rpc("app_availability")).data).toEqual({ video: true, app_review: false });
  });
});

describe("apps our team adds for every customer", () => {
  let appId: string;
  const app = {
    p_id: null as unknown as string,
    p_name: "Résumé de rendez-vous",
    p_department: "sales",
    p_description: "Un résumé clair après chaque rendez-vous.",
    p_instructions: "Résume le rendez-vous en cinq points et propose la prochaine étape.",
    p_fields: [{ key: "notes", label: "Notes", type: "textarea", required: true }],
    p_output_format: "text",
    p_memory_scope: "company_and_client",
    p_tools: [],
    p_enabled: true,
  };

  it("are written by our team only and reach every company", async () => {
    expect((await owner.client.rpc("platform_save_app", app)).error?.message).toBe("forbidden");
    const saved = await platform.client.rpc("platform_save_app", app);
    expect(saved.error).toBeNull();
    appId = saved.data!;

    for (const user of [member, outsider]) {
      const { data } = await user.client.from("agents").select("name, company_id").eq("id", appId);
      expect(data).toEqual([{ name: "Résumé de rendez-vous", company_id: null }]);
    }
    // An employee can start a conversation with it (the database checks they may run it).
    expect((await member.client.from("conversations").insert({ company_id: companyId, agent_id: appId }).select("id")).error).toBeNull();
    // Customers cannot change it directly.
    expect((await owner.client.from("agents").update({ instructions: "Autre chose" }).eq("id", appId).select("id")).data ?? []).toEqual([]);
  });

  it("can be switched off and deleted, but our team's functions never touch the built-in agents", async () => {
    expect((await platform.client.rpc("platform_save_app", { ...app, p_id: appId, p_enabled: false })).error).toBeNull();
    const [row] = await sql<{ enabled_roles: string }>("select enabled_roles::text from public.agents where id = $1", [appId]);
    expect(row.enabled_roles).toBe("{}");
    expect((await member.client.from("conversations").insert({ company_id: companyId, agent_id: appId }).select("id")).error).not.toBeNull();

    const [builtin] = await sql<{ id: string }>("select id from public.agents where builtin_key = 'proposal_writer'");
    expect((await platform.client.rpc("platform_delete_app", { p_id: builtin.id })).error?.message).toBe("not_found");
    expect((await platform.client.rpc("platform_save_app", { ...app, p_id: builtin.id })).error?.message).toBe("not_found");

    expect((await owner.client.rpc("platform_delete_app", { p_id: appId })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_delete_app", { p_id: appId })).error).toBeNull();
    expect(await sql("select id from public.agents where id = $1", [appId])).toEqual([]);
    // The audit log records the action, not the instructions.
    const logged = await sql<{ metadata: object }>("select metadata from public.audit_log where scope = 'platform' and target_id = $1", [appId]);
    expect(logged.every((l) => JSON.stringify(l.metadata) === "{}")).toBe(true);
  });
});

describe("favourites and the most used apps", () => {
  it("are private to each person and limited to apps they can see", async () => {
    const [builtin] = await sql<{ id: string }>("select id from public.agents where builtin_key = 'proposal_writer'");
    expect((await member.client.from("app_favorites").insert({ company_id: companyId, agent_id: builtin.id })).error).toBeNull();
    expect((await member.client.from("app_favorites").select("agent_id")).data).toEqual([{ agent_id: builtin.id }]);
    expect((await owner.client.from("app_favorites").select("agent_id")).data).toEqual([]);

    // Not in a company one is not a member of, and not another company's private tool.
    expect((await member.client.from("app_favorites").insert({ company_id: otherCompany, agent_id: builtin.id })).error).not.toBeNull();
    const [tool] = await sql<{ id: string }>(
      `insert into public.agents (company_id, kind, name, instructions, visibility, created_by)
       values ($1, 'tool', 'Outil privé', 'Fais ceci.', 'private', $2) returning id`,
      [otherCompany, outsider.id],
    );
    expect((await member.client.from("app_favorites").insert({ company_id: companyId, agent_id: tool.id })).error).not.toBeNull();

    expect((await member.client.rpc("company_popular_apps", { p_company: companyId })).error).toBeNull();
    expect((await member.client.rpc("company_popular_apps", { p_company: otherCompany })).error?.message).toBe("forbidden");
  });
});

describe("automatic titles", () => {
  it("are written for people who can see the conversation, until someone renames it by hand", async () => {
    const { data: conv } = await owner.client.from("conversations").insert({ company_id: companyId }).select("id").single();
    expect((await owner.client.rpc("set_auto_title", { p_conversation: conv!.id, p_title: "  Relance du devis  " })).data).toBe(true);
    expect((await owner.client.from("conversations").select("title").eq("id", conv!.id).single()).data?.title).toBe("Relance du devis");
    // Someone who cannot see it cannot title it (nor learn that it exists).
    expect((await outsider.client.rpc("set_auto_title", { p_conversation: conv!.id, p_title: "Autre" })).error?.message).toBe("not_found");
    // Renamed by hand: automatic titles stop.
    await owner.client.from("conversations").update({ title: "Mon titre", title_auto: false }).eq("id", conv!.id);
    expect((await owner.client.rpc("set_auto_title", { p_conversation: conv!.id, p_title: "Nouveau sujet" })).data).toBe(false);
    expect((await owner.client.from("conversations").select("title").eq("id", conv!.id).single()).data?.title).toBe("Mon titre");
  });
});

describe("web search", () => {
  it("is switched by the company's Owner or a models Admin, and priced by our team only", async () => {
    expect((await member.client.rpc("admin_set_ai_features", { p_company: companyId, p_web_search: false })).error?.message).toBe("forbidden");
    expect((await owner.client.rpc("admin_set_ai_features", { p_company: companyId, p_web_search: false })).error).toBeNull();
    expect((await member.client.from("company_ai_settings").select("web_search_enabled, dictation_enabled").eq("company_id", companyId).single()).data).toEqual({
      web_search_enabled: false,
      dictation_enabled: true,
    });
    await owner.client.rpc("admin_set_ai_features", { p_company: companyId, p_web_search: true });

    expect((await owner.client.rpc("platform_set_web_search_rate", { p_credits: 1, p_cost_usd: 0 })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_set_web_search_rate", { p_credits: -1, p_cost_usd: 0 })).error?.message).toBe("validation");
    expect((await platform.client.rpc("platform_set_web_search_rate", { p_credits: 12, p_cost_usd: 0.012 })).error).toBeNull();
    const [rate] = await sql<{ web_search_credits: string; web_search_cost_usd: string }>("select web_search_credits, web_search_cost_usd from public.platform_settings");
    expect([Number(rate.web_search_credits), Number(rate.web_search_cost_usd)]).toEqual([12, 0.012]);
    // Customers never read our rates (platform settings are our team's).
    expect((await owner.client.from("platform_settings").select("web_search_cost_usd")).data).toEqual([]);
    await sql("update public.platform_settings set web_search_credits = 10, web_search_cost_usd = 0.01 where id");
  });
});

describe("passwords chosen in Cendr", () => {
  it("are recorded only through mark_password_set, logged without the password", async () => {
    // Nobody writes the date directly (it decides whether a password counts).
    await owner.client.from("profiles").update({ password_set_at: new Date().toISOString() } as never).eq("id", owner.id);
    const [before] = await sql<{ password_set_at: string | null }>("select password_set_at from public.profiles where id = $1", [owner.id]);
    expect(before.password_set_at).toBeNull();

    expect((await owner.client.rpc("mark_password_set")).error).toBeNull();
    const [after] = await sql<{ password_set_at: string | null }>("select password_set_at from public.profiles where id = $1", [owner.id]);
    expect(after.password_set_at).not.toBeNull();
    const logged = await sql<{ action: string; metadata: object }>(
      "select action, metadata from public.audit_log where company_id = $1 and action = 'auth.password_set' and actor_id = $2",
      [companyId, owner.id],
    );
    expect(logged).toEqual([{ action: "auth.password_set", metadata: {} }]);
  });
});
