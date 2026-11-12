import { beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, createClientRecord, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";

/**
 * Consciousness V1.1 (CLAUDE.md §12): team and project memory, against the real database with real
 * users and RLS. Team memory belongs to the team's members (and the Owner); a project is open to every
 * member, or, for a client's project, only to those who may open that client. Group conversations
 * use only the memories every participant may read.
 *
 * Company "Orion": Owner; Alice and Bob in team "Ventes" (Alice assigned to the restricted client
 * Atlas); Carol in team "Finance"; Dan without a team. Another company: Eve. Our team: Pat.
 */

vi.stubEnv("AI_FAKE_PROVIDER", "true");
const { buildMemoryContext } = await import("@/modules/memory/server/gateway");

let owner: TestUser, alice: TestUser, bob: TestUser, carol: TestUser, dan: TestUser, eve: TestUser, pat: TestUser;
let company: string, atlas: string, ventesSpace: string, financeSpace: string, companySpace: string;
let openProject: string, openProjectSpace: string, atlasProject: string, atlasProjectSpace: string;

const asMember = (user: TestUser) => ({ user: { id: user.id, email: user.email }, active: { companyId: company } }) as unknown as MemberContext;
const db = (user: TestUser) => user.client as unknown as UserClient;

const reads = async (user: TestUser, spaceId: string) => ((await user.client.from("memory_spaces").select("id").eq("id", spaceId)).data ?? []).length === 1;
const entries = async (user: TestUser, spaceId: string) => ((await user.client.from("memory_entries").select("content").eq("space_id", spaceId)).data ?? []).map((e) => e.content);
const write = (user: TestUser, spaceId: string, content: string) => user.client.from("memory_entries").insert({ space_id: spaceId, title: content.slice(0, 40), content });
const mySpaces = async (user: TestUser) => (await user.client.rpc("my_memory_spaces", { p_company: company })).data ?? [];

async function newProject(user: TestUser, name: string, clientId: string | null) {
  const { data, error } = await user.client.from("projects").insert({ company_id: company, client_id: clientId, name }).select("id").single();
  if (error) throw error;
  const [{ id: spaceId }] = await sql<{ id: string }>("select id from public.memory_spaces where project_id = $1", [data.id]);
  return { id: data.id, spaceId };
}

beforeAll(async () => {
  [owner, alice, bob, carol, dan, eve, pat] = await Promise.all([
    createUser("tp-owner", "Owner"),
    createUser("tp-alice", "Alice"),
    createUser("tp-bob", "Bob"),
    createUser("tp-carol", "Carol"),
    createUser("tp-dan", "Dan"),
    createUser("tp-eve", "Eve"),
    createUser("tp-pat", "Pat"),
  ]);
  company = await createCompany(owner, "Orion");
  await createCompany(eve, "Ailleurs");
  for (const u of [alice, bob, carol, dan]) await addMember(owner, company, u);
  for (const [user, team] of [
    [alice, "Ventes"],
    [bob, "Ventes"],
    [carol, "Finance"],
  ] as const) {
    const { error } = await owner.client.rpc("admin_set_member_team", { p_company: company, p_user: user.id, p_team_name: team });
    if (error) throw error;
  }
  await makePlatformAdmin(pat);
  atlas = await createClientRecord(owner, company, "Atlas", "restricted");
  const { error } = await owner.client.from("client_assignments").insert({ client_id: atlas, company_id: company, user_id: alice.id });
  if (error) throw error;
  const spaces = await sql<{ id: string; kind: string; name: string | null }>(
    "select s.id, s.kind, t.name from public.memory_spaces s left join public.teams t on t.id = s.team_id where s.company_id = $1",
    [company],
  );
  ventesSpace = spaces.find((s) => s.kind === "team" && s.name === "Ventes")!.id;
  financeSpace = spaces.find((s) => s.kind === "team" && s.name === "Finance")!.id;
  companySpace = spaces.find((s) => s.kind === "company")!.id;
  ({ id: openProject, spaceId: openProjectSpace } = await newProject(dan, "Salon 2027", null));
  ({ id: atlasProject, spaceId: atlasProjectSpace } = await newProject(alice, "Refonte Atlas", atlas));
});

describe("team memory", () => {
  it("exists for every team as soon as the team does", () => {
    expect(ventesSpace).toBeTruthy();
    expect(financeSpace).toBeTruthy();
  });

  it("is read and written by the team's members, and by the Owner", async () => {
    expect((await write(alice, ventesSpace, "Les devis Ventes partent le vendredi.")).error).toBeNull();
    expect(await entries(bob, ventesSpace)).toEqual(["Les devis Ventes partent le vendredi."]);
    expect(await entries(owner, ventesSpace)).toEqual(["Les devis Ventes partent le vendredi."]);
    expect((await write(bob, ventesSpace, "Remise maximale : 10 %.")).error).toBeNull();
  });

  it("is invisible to another team, to members without a team, to another company and to our team", async () => {
    for (const user of [carol, dan, eve, pat]) {
      expect(await reads(user, ventesSpace)).toBe(false);
      expect(await entries(user, ventesSpace)).toEqual([]);
      expect((await write(user, ventesSpace, "intrus")).error).not.toBeNull();
    }
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.memory_entries where space_id = $1 and content = 'intrus'", [ventesSpace]);
    expect(n).toBe(0);
  });

  it("follows the person: someone moved to another team loses the old team's memory", async () => {
    const { error } = await owner.client.rpc("admin_set_member_team", { p_company: company, p_user: bob.id, p_team_name: "Finance" });
    expect(error).toBeNull();
    expect(await entries(bob, ventesSpace)).toEqual([]);
    expect(await reads(bob, financeSpace)).toBe(true);
    await owner.client.rpc("admin_set_member_team", { p_company: company, p_user: bob.id, p_team_name: "Ventes" });
    expect(await reads(bob, ventesSpace)).toBe(true);
  });

  it("is listed with its team for its members only", async () => {
    const aliceTeams = (await mySpaces(alice)).filter((s) => s.kind === "team");
    expect(aliceTeams.map((s) => s.space_id)).toEqual([ventesSpace]);
    expect(aliceTeams[0]).toMatchObject({ team_id: expect.any(String), can_write: true });
    expect((await mySpaces(dan)).filter((s) => s.kind === "team")).toEqual([]);
    // The Owner sees every team's memory.
    expect((await mySpaces(owner)).filter((s) => s.kind === "team").map((s) => s.space_id).sort()).toEqual([ventesSpace, financeSpace].sort());
  });
});

describe("project memory", () => {
  it("an open project is visible to every member, who can read and write its memory", async () => {
    for (const user of [owner, alice, bob, carol, dan]) {
      expect((await user.client.from("projects").select("id").eq("id", openProject)).data).toHaveLength(1);
      expect(await reads(user, openProjectSpace)).toBe(true);
    }
    expect((await write(dan, openProjectSpace, "Stand réservé : hall 3.")).error).toBeNull();
    expect(await entries(carol, openProjectSpace)).toEqual(["Stand réservé : hall 3."]);
    for (const user of [eve, pat]) {
      expect((await user.client.from("projects").select("id").eq("id", openProject)).data).toEqual([]);
      expect(await reads(user, openProjectSpace)).toBe(false);
    }
  });

  it("a restricted client's project follows the client: only those who may open the client see it", async () => {
    expect((await write(alice, atlasProjectSpace, "Atlas veut une maquette avant le 3 mai.")).error).toBeNull();
    expect(await entries(owner, atlasProjectSpace)).toEqual(["Atlas veut une maquette avant le 3 mai."]);
    for (const user of [bob, carol, dan, eve, pat]) {
      expect((await user.client.from("projects").select("id").eq("id", atlasProject)).data).toEqual([]);
      expect(await entries(user, atlasProjectSpace)).toEqual([]);
      expect((await write(user, atlasProjectSpace, "intrus")).error).not.toBeNull();
    }
    expect((await mySpaces(bob)).some((s) => s.space_id === atlasProjectSpace)).toBe(false);
    const listed = (await mySpaces(alice)).find((s) => s.space_id === atlasProjectSpace);
    expect(listed).toMatchObject({ kind: "project", project_id: atlasProject, project_client_id: atlas });
  });

  it("nobody starts a project for a client they cannot open", async () => {
    const { error } = await dan.client.from("projects").insert({ company_id: company, client_id: atlas, name: "Pirate" });
    expect(error).not.toBeNull();
    const { error: otherCompany } = await eve.client.from("projects").insert({ company_id: company, client_id: null, name: "Pirate" });
    expect(otherCompany).not.toBeNull();
  });

  it("only its creator (or a client Admin) archives it; an archived project leaves the list", async () => {
    const { project, spaceId } = await newProject(carol, "Audit 2026", null).then((p) => ({ project: p.id, spaceId: p.spaceId }));
    await dan.client.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", project);
    expect((await mySpaces(carol)).some((s) => s.space_id === spaceId)).toBe(true);
    expect((await carol.client.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", project)).error).toBeNull();
    expect((await mySpaces(carol)).some((s) => s.space_id === spaceId)).toBe(false);
  });
});

describe("what reaches the AI", () => {
  it("a conversation without a client uses the person's team and projects", async () => {
    const ctx = await buildMemoryContext(db(alice), asMember(alice), {
      conversationId: "00000000-0000-0000-0000-000000000000",
      clientId: null,
      query: "Quand partent les devis et où est le stand ?",
      providers: ["openai"],
      ownRecent: false,
    });
    const contents = ctx.passages.map((p) => p.content);
    expect(contents).toEqual(expect.arrayContaining(["Les devis Ventes partent le vendredi.", "Stand réservé : hall 3."]));
    expect(ctx.passages.find((p) => p.content.startsWith("Les devis"))).toMatchObject({ spaceKind: "team", clientName: "Ventes" });
  });

  it("a colleague of another team never receives the team's memory, by any question", async () => {
    const ctx = await buildMemoryContext(db(carol), asMember(carol), {
      conversationId: "00000000-0000-0000-0000-000000000000",
      clientId: null,
      query: "devis Ventes vendredi remise maximale",
      providers: ["openai"],
      ownRecent: false,
    });
    expect(ctx.passages.map((p) => p.content).join("\n")).not.toMatch(/devis Ventes|Remise maximale|maquette/);
  });

  it("a group conversation uses only memories every participant may read", async () => {
    const { data: conv, error } = await alice.client.from("conversations").insert({ company_id: company, client_id: null, model_choice: "auto" }).select("id").single();
    if (error) throw error;
    expect((await alice.client.rpc("add_conversation_participants", { p_conversation: conv.id, p_users: [carol.id] })).error).toBeNull();
    const shared = ((await alice.client.rpc("conversation_shared_spaces", { p_conversation: conv.id })).data ?? []) as string[];
    expect(shared).toEqual(expect.arrayContaining([companySpace, openProjectSpace]));
    expect(shared).not.toContain(ventesSpace);
    expect(shared).not.toContain(financeSpace);
    expect(shared).not.toContain(atlasProjectSpace);
    // Alice and Bob (same team, both… but Bob cannot open Atlas): the team's memory is shared, Atlas's project is not.
    const { data: conv2 } = await alice.client.from("conversations").insert({ company_id: company, client_id: null, model_choice: "auto" }).select("id").single();
    await alice.client.rpc("add_conversation_participants", { p_conversation: conv2!.id, p_users: [bob.id] });
    const shared2 = ((await alice.client.rpc("conversation_shared_spaces", { p_conversation: conv2!.id })).data ?? []) as string[];
    expect(shared2).toContain(ventesSpace);
    expect(shared2).not.toContain(atlasProjectSpace);
  });

  it("sharing history warns by name when a cited team memory is out of a colleague's reach", async () => {
    const { data: conv } = await alice.client.from("conversations").insert({ company_id: company, client_id: null, model_choice: "auto" }).select("id").single();
    const service = serviceClient();
    const { data: answer } = await service
      .from("messages")
      .insert({ conversation_id: conv!.id, author_type: "assistant", content: "Le vendredi [S1].", provider: "openai", model_id: "gpt-6-luna", status: "complete" })
      .select("id")
      .single();
    const { error } = await service.from("message_sources").insert({
      message_id: answer!.id,
      conversation_id: conv!.id,
      position: 1,
      source_type: "memory_entry",
      space_id: ventesSpace,
      title: "Devis",
      excerpt: "Les devis Ventes partent le vendredi.",
    });
    expect(error).toBeNull();
    const { data } = await alice.client.rpc("history_unreadable_sources", { p_conversation: conv!.id, p_users: [carol.id, bob.id], p_from_seq: 1 });
    expect(data).toEqual([expect.objectContaining({ space_id: ventesSpace, kind: "team", owner_name: "Ventes", user_id: carol.id })]);
  });
});
