import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createClientRecord, createCompany, createUser, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 12 (CLAUDE.md §11): clients for everyone, the Manager role, participant rights, transfer as a
 * fork, personal memory, automatic client memory — each rule checked in the database itself.
 */
let owner: TestUser, manager: TestUser, ana: TestUser, bruno: TestUser, carla: TestUser;
let company: string, team: string, otherTeam: string;

const newConversation = async (user: TestUser, clientId: string | null = null) => {
  const { data, error } = await user.client.from("conversations").insert({ company_id: company, client_id: clientId }).select("id").single();
  if (error) throw error;
  return data.id;
};
const post = async (user: TestUser, conversationId: string, content: string) =>
  user.client.from("messages").insert({ conversation_id: conversationId, content }).select("id, seq").single();
const contents = async (user: TestUser, conversationId: string) =>
  ((await user.client.from("messages").select("content").eq("conversation_id", conversationId).order("seq")).data ?? []).map((m) => m.content);

beforeAll(async () => {
  [owner, manager, ana, bruno, carla] = await Promise.all([
    createUser("s12-owner", "Owner"),
    createUser("s12-manager", "Maud Manager"),
    createUser("s12-ana", "Ana"),
    createUser("s12-bruno", "Bruno"),
    createUser("s12-carla", "Carla"),
  ]);
  company = await createCompany(owner, "Step 12 Co");
  for (const u of [manager, ana, bruno, carla]) await addMember(owner, company, u);
  [{ id: team }] = await sql<{ id: string }>("insert into public.teams (company_id, name) values ($1, 'Ventes') returning id", [company]);
  [{ id: otherTeam }] = await sql<{ id: string }>("insert into public.teams (company_id, name) values ($1, 'Finance') returning id", [company]);
  // Maud manages the sales team (Ana); Carla is in finance.
  for (const [user, teamId] of [[manager, team], [ana, team], [carla, otherTeam]] as const) {
    expect((await owner.client.rpc("admin_update_member", { p_company: company, p_user: user.id, p_team: teamId })).error).toBeNull();
  }
  expect((await owner.client.rpc("admin_update_member", { p_company: company, p_user: manager.id, p_role: "manager" })).error).toBeNull();
});

describe("clients", () => {
  it("can be created open by anyone; restricted only by those who manage access, who keep access", async () => {
    expect((await ana.client.from("clients").insert({ company_id: company, name: "Nike", visibility: "open" })).error).toBeNull();
    expect((await ana.client.from("clients").insert({ company_id: company, name: "Secret", visibility: "restricted" })).error).not.toBeNull();
    // The app gives the id itself: the new row is only readable once its creator has been assigned.
    const id = randomUUID();
    expect((await manager.client.from("clients").insert({ id, company_id: company, name: "Adidas", visibility: "restricted" })).error).toBeNull();
    expect(await sql("select 1 from public.client_assignments where client_id = $1 and user_id = $2", [id, manager.id])).toHaveLength(1);
    expect((await manager.client.from("clients").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await ana.client.from("clients").update({ name: "Renamed" }).eq("name", "Nike").select("id")).data ?? []).toEqual([]);
  });

  it("are deleted for good only by the Owner, once archived, with the name typed again", async () => {
    const id = await createClientRecord(owner, company, "Puma", "open");
    expect((await ana.client.rpc("delete_client", { p_client: id, p_confirm_name: "Puma" })).error?.message).toBe("not_found");
    expect((await owner.client.rpc("delete_client", { p_client: id, p_confirm_name: "Puma" })).error?.message).toBe("archive_first");
    await owner.client.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", id);
    expect((await owner.client.rpc("delete_client", { p_client: id, p_confirm_name: "Pumas" })).error?.message).toBe("name_mismatch");
    expect((await owner.client.from("clients").delete().eq("id", id).select("id")).data ?? []).toEqual([]);
    expect((await owner.client.rpc("delete_client", { p_client: id, p_confirm_name: " puma " })).error).toBeNull();
    expect(await sql("select 1 from public.clients where id = $1", [id])).toHaveLength(0);
  });
});

describe("a manager", () => {
  it("gives their own team access to restricted clients they can open, and nobody else", async () => {
    const adidas = (await sql<{ id: string }>("select id from public.clients where name = 'Adidas' and company_id = $1", [company]))[0].id;
    const hidden = await createClientRecord(owner, company, "Hidden", "restricted");
    const give = (user: TestUser, client: string) =>
      manager.client.from("client_assignments").insert({ client_id: client, company_id: company, user_id: user.id, assigned_by: manager.id });
    expect((await give(ana, adidas)).error).toBeNull();
    expect((await give(carla, adidas)).error).not.toBeNull();
    expect((await give(ana, hidden)).error).not.toBeNull();
    expect((await ana.client.from("clients").select("id").eq("id", adidas)).data).toHaveLength(1);
    expect((await manager.client.from("client_assignments").delete().eq("client_id", adidas).eq("user_id", ana.id).select("user_id")).data).toHaveLength(1);
  });

  it("never reads the team's conversations", async () => {
    const conversation = await newConversation(ana);
    expect((await post(ana, conversation, "Mes notes privées")).error).toBeNull();
    expect(await contents(manager, conversation)).toEqual([]);
    expect(await contents(owner, conversation)).toEqual([]);
  });
});

describe("participant rights", () => {
  it("read only, participate, manage participants — enforced by the database", async () => {
    const conversation = await newConversation(ana);
    await post(ana, conversation, "Bonjour");
    expect((await ana.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [bruno.id], p_role: "reader" })).error).toBeNull();
    expect((await ana.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [carla.id] })).error).toBeNull();
    // Bruno reads but cannot write; Carla writes but cannot add people.
    expect(await contents(bruno, conversation)).toEqual([]);
    expect((await post(bruno, conversation, "Je peux écrire ?")).error).not.toBeNull();
    expect((await post(carla, conversation, "Je participe")).error).toBeNull();
    expect(await contents(bruno, conversation)).toEqual(["Je participe"]);
    expect((await carla.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [manager.id] })).error?.message).toBe("not_found");
    // Ana lets Carla manage participants; Carla adds Maud, then removes Bruno.
    expect((await ana.client.rpc("set_participant_role", { p_conversation: conversation, p_user: carla.id, p_role: "manager" })).error).toBeNull();
    expect((await carla.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [manager.id] })).error).toBeNull();
    expect((await carla.client.rpc("remove_conversation_participant", { p_conversation: conversation, p_user: bruno.id })).error).toBeNull();
    expect(await contents(bruno, conversation)).toEqual([]);
    // Nobody changes or removes the owner.
    expect((await carla.client.rpc("set_participant_role", { p_conversation: conversation, p_user: ana.id, p_role: "reader" })).error?.message).toBe("not_found");
    expect((await carla.client.rpc("remove_conversation_participant", { p_conversation: conversation, p_user: ana.id })).error?.message).toBe("not_found");
  });
});

describe("a transfer", () => {
  it("forks the conversation: the sender keeps a copy up to now and never sees what follows", async () => {
    const conversation = await newConversation(ana);
    await post(ana, conversation, "Premier message");
    await post(ana, conversation, "Deuxième message");
    const { data, error } = await ana.client.rpc("transfer_conversation", { p_conversation: conversation, p_to: bruno.id, p_sections: {}, p_ai_generated: false });
    expect(error).toBeNull();
    const copy = (data as { copy: string }).copy;
    expect(await contents(ana, copy)).toEqual(["Premier message", "Deuxième message"]);
    expect(await contents(ana, conversation)).toEqual([]);
    expect(await contents(bruno, conversation)).toEqual(["Premier message", "Deuxième message"]);
    expect(await contents(bruno, copy)).toEqual([]);
    // Both branches go on separately.
    expect((await post(bruno, conversation, "Suite par Bruno")).error).toBeNull();
    expect((await post(ana, copy, "Suite par Ana")).error).toBeNull();
    expect(await contents(ana, copy)).toEqual(["Premier message", "Deuxième message", "Suite par Ana"]);
    expect(await contents(bruno, conversation)).toEqual(["Premier message", "Deuxième message", "Suite par Bruno"]);
    const [meta] = await sql<{ forked_from: string; transferred_to: string; received_from: string | null }>(
      "select c.forked_from, c.transferred_to, o.received_from from public.conversations c join public.conversations o on o.id = c.forked_from where c.id = $1",
      [copy],
    );
    expect(meta).toEqual({ forked_from: conversation, transferred_to: bruno.id, received_from: ana.id });
  });
});

describe("personal memory", () => {
  it("belongs to its person only: no colleague, Manager or Owner reads it", async () => {
    expect((await ana.client.from("personal_memory").insert({ company_id: company, content: "Réponds-moi court." })).error).toBeNull();
    expect((await ana.client.from("personal_memory").select("content")).data).toEqual([{ content: "Réponds-moi court." }]);
    for (const other of [owner, manager, bruno]) expect((await other.client.from("personal_memory").select("id")).data).toEqual([]);
    expect((await bruno.client.from("personal_memory").insert({ company_id: company, user_id: ana.id, content: "x" })).error).not.toBeNull();
  });
});

describe("client memory fed automatically", () => {
  it("accepts automatic entries from people who may write there, always under their own name", async () => {
    const nike = (await sql<{ id: string }>("select id from public.clients where name = 'Nike' and company_id = $1", [company]))[0].id;
    const [{ id: space }] = await sql<{ id: string }>("select id from public.memory_spaces where client_id = $1", [nike]);
    const entry = { space_id: space, title: "Préférence", content: "Nike préfère les rapports courts.", source_type: "auto" };
    const { data, error } = await ana.client.from("memory_entries").insert(entry).select("author_id").single();
    expect(error).toBeNull();
    expect(data?.author_id).toBe(ana.id);
    // Nobody writes under someone else's name.
    expect((await ana.client.from("memory_entries").insert({ ...entry, author_id: bruno.id } as typeof entry)).error).not.toBeNull();
    // Nor into a restricted client's memory they cannot open.
    const adidas = (await sql<{ id: string }>("select id from public.clients where name = 'Adidas' and company_id = $1", [company]))[0].id;
    const [{ id: hiddenSpace }] = await sql<{ id: string }>("select id from public.memory_spaces where client_id = $1", [adidas]);
    expect((await bruno.client.from("memory_entries").insert({ ...entry, space_id: hiddenSpace })).error).not.toBeNull();
  });
});

describe("company switches for automatic client memory and dictation", () => {
  it("are set by the Owner (or an Admin with the models scope), logged, and refused to others", async () => {
    expect((await ana.client.rpc("admin_set_ai_features", { p_company: company, p_dictation_enabled: false })).error?.message).toBe("forbidden");
    expect((await manager.client.rpc("admin_set_ai_features", { p_company: company, p_auto_client_memory: false })).error?.message).toBe("forbidden");
    expect((await owner.client.rpc("admin_set_ai_features", { p_company: company, p_auto_client_memory: false })).error).toBeNull();
    expect((await owner.client.rpc("admin_set_ai_features", { p_company: company, p_dictation_enabled: false })).error).toBeNull();
    // Members read the switches (the chat hides the microphone), nobody writes the row directly.
    expect((await ana.client.from("company_ai_settings").select("auto_client_memory, dictation_enabled").eq("company_id", company).single()).data).toEqual({
      auto_client_memory: false,
      dictation_enabled: false,
    });
    expect((await owner.client.from("company_ai_settings").update({ dictation_enabled: true }).eq("company_id", company).select("company_id")).data ?? []).toEqual([]);
    const logged = await sql<{ metadata: Record<string, unknown> }>(
      "select metadata from public.audit_log where company_id = $1 and action = 'ai.features_updated' order by created_at",
      [company],
    );
    expect(logged.map((l) => l.metadata)).toEqual([{ auto_client_memory: false }, { dictation: false }]);
    await owner.client.rpc("admin_set_ai_features", { p_company: company, p_auto_client_memory: true, p_dictation_enabled: true });
  });

  it("dictation rates are our team's only", async () => {
    expect((await owner.client.rpc("platform_set_dictation_rate", { p_credits: 0, p_cost_usd: 0 })).error?.message).toBe("forbidden");
    expect((await owner.client.from("platform_settings").select("dictation_credits_per_minute")).data ?? []).toEqual([]);
  });
});

describe("the Manager role", () => {
  it("needs a team: nobody is made Manager without one", async () => {
    const { error } = await owner.client.rpc("admin_update_member", { p_company: company, p_user: bruno.id, p_role: "manager" });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("company_members_manager_team");
  });
});

describe("deleting a client for good", () => {
  it("returns the files of its documents to remove, and nothing to anyone else", async () => {
    const id = await createClientRecord(owner, company, "Reebok", "open");
    const [{ id: space }] = await sql<{ id: string }>("select id from public.memory_spaces where client_id = $1", [id]);
    await sql(
      "insert into public.documents (company_id, space_id, filename, mime_type, size_bytes, storage_path, uploaded_by) values ($1, $2, 'brief.pdf', 'application/pdf', 10, $3, $4)",
      [company, space, `${space}/brief.pdf`, owner.id],
    );
    await owner.client.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", id);
    expect((await manager.client.rpc("delete_client", { p_client: id, p_confirm_name: "Reebok" })).error?.message).toBe("not_found");
    const { data, error } = await owner.client.rpc("delete_client", { p_client: id, p_confirm_name: "Reebok" });
    expect(error).toBeNull();
    expect(data).toEqual([`${space}/brief.pdf`]);
    expect(await sql("select 1 from public.documents where space_id = $1", [space])).toHaveLength(0);
  });
});
