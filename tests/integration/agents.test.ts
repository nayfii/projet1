import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 6 (CLAUDE.md §4.6, §4.7): who sees and runs a tool (just me / my team / the whole company after an
 * Admin's approval), roles per tool, company adaptations of built-in agents, and no access for another
 * company or the platform admin. Real users and JWTs, through the public API.
 */
let owner: TestUser, olivier: TestUser, sam: TestUser, nathalie: TestUser, paul: TestUser, fanny: TestUser, ownerB: TestUser, platform: TestUser;
let company: string, companyB: string, builtin: string;

const tool = (name: string) => ({
  name,
  description: "Résume une réunion.",
  department: "sales",
  instructions: "Résume les notes en trois points.",
  input_fields: [{ key: "notes", label: "Notes", type: "textarea", required: true }],
  allowed_models: [],
  default_model: null,
  tools: [],
  memory_scope: "company_and_client",
  output_format: "document",
});

const save = (user: TestUser, name: string, visibility: string, id: string | null = null, companyId = company) =>
  user.client.rpc("save_tool", { p_company: companyId, p_id: id as string, p_tool: tool(name), p_visibility: visibility });

const sees = async (user: TestUser, id: string) => ((await user.client.from("agents").select("id").eq("id", id)).data ?? []).length === 1;
const run = (user: TestUser, agentId: string, companyId = company) => user.client.from("conversations").insert({ company_id: companyId, agent_id: agentId }).select("id");

beforeAll(async () => {
  [owner, olivier, sam, nathalie, paul, fanny, ownerB, platform] = await Promise.all([
    createUser("agents-owner", "Owner"),
    createUser("agents-olivier", "Olivier"),
    createUser("agents-sam", "Sam"),
    createUser("agents-nathalie", "Nathalie"),
    createUser("agents-paul", "Paul"),
    createUser("agents-fanny", "Fanny"),
    createUser("agents-owner-b", "Owner B"),
    createUser("agents-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  company = await createCompany(owner, "Agents Co");
  companyB = await createCompany(ownerB, "Agents Co B");
  await addMember(owner, company, olivier);
  await addMember(owner, company, sam);
  await addMember(owner, company, nathalie);
  await addMember(owner, company, paul, "admin", ["agents"]);
  await addMember(owner, company, fanny, "admin", ["members"]);
  for (const [user, team] of [
    [olivier, "Ventes"],
    [sam, "Ventes"],
    [nathalie, "Finance"],
  ] as const) {
    const { error } = await owner.client.rpc("admin_set_member_team", { p_company: company, p_user: user.id, p_team_name: team });
    if (error) throw error;
  }
  builtin = (
    await sql<{ id: string }>(
      "insert into public.agents (builtin_key, kind, department, name, instructions) values ($1, 'agent', 'sales', 'Agent test', 'Rédige une proposition.') returning id",
      [`test_${Date.now()}`],
    )
  )[0].id;
});

describe("teams", () => {
  it("are set by Admins with the members scope only", async () => {
    expect((await paul.client.rpc("admin_set_member_team", { p_company: company, p_user: sam.id, p_team_name: "Autre" })).error?.message).toBe("forbidden");
    expect((await fanny.client.rpc("admin_set_member_team", { p_company: company, p_user: sam.id, p_team_name: "Ventes" })).error).toBeNull();
    expect((await olivier.client.rpc("admin_set_member_team", { p_company: company, p_user: olivier.id, p_team_name: "Finance" })).error?.message).toBe("forbidden");
  });
});

describe("visibility: just me, my team, the whole company", () => {
  let privateTool: string, teamTool: string;

  it("keeps a personal tool to its creator, Owner and Admins included", async () => {
    const { data, error } = await save(olivier, "Perso", "private");
    expect(error).toBeNull();
    privateTool = data!;
    expect(await sees(olivier, privateTool)).toBe(true);
    for (const other of [sam, nathalie, paul, owner, ownerB, platform]) expect(await sees(other, privateTool)).toBe(false);
    expect((await run(nathalie, privateTool)).error?.message).toBe("forbidden");
    expect((await run(olivier, privateTool)).error).toBeNull();
  });

  it("shares a team tool with the creator's team, and shows it to agents Admins", async () => {
    const { data, error } = await save(olivier, "Équipe", "team");
    expect(error).toBeNull();
    teamTool = data!;
    for (const user of [olivier, sam, paul, owner]) expect(await sees(user, teamTool)).toBe(true);
    for (const user of [nathalie, fanny, ownerB, platform]) expect(await sees(user, teamTool)).toBe(false);
    expect((await run(sam, teamTool)).error).toBeNull();
    expect((await run(nathalie, teamTool)).error?.message).toBe("forbidden");
  });

  it("refuses team sharing to someone without a team", async () => {
    expect((await save(paul, "Sans équipe", "team")).error?.message).toBe("no_team");
  });

  it("lets only the creator edit a tool", async () => {
    expect((await save(nathalie, "Volé", "private", teamTool)).error?.message).toBe("not_found");
    expect((await save(owner, "Volé", "private", teamTool)).error?.message).toBe("not_found");
    expect((await save(olivier, "Équipe v2", "team", teamTool)).error).toBeNull();
  });

  it("allows no direct writes: everything goes through the checked functions", async () => {
    expect((await olivier.client.from("agents").insert({ company_id: company, kind: "tool", name: "x", instructions: "y" } as never)).error).not.toBeNull();
    await olivier.client.from("agents").update({ name: "piraté" }).eq("id", teamTool);
    await olivier.client.from("agents").delete().eq("id", teamTool);
    expect((await sql<{ name: string }>("select name from public.agents where id = $1", [teamTool]))[0].name).toBe("Équipe v2");
    // Another company's id is refused.
    expect((await save(olivier, "Ailleurs", "private", null, companyB)).error?.message).toBe("forbidden");
  });
});

describe("company-wide publication needs an Admin's approval", () => {
  let shared: string;

  it("waits for approval when an employee shares with the whole company", async () => {
    const { data, error } = await save(olivier, "Pour tous", "company");
    expect(error).toBeNull();
    shared = data!;
    expect((await sql<{ publication: string }>("select publication from public.agents where id = $1", [shared]))[0].publication).toBe("pending");
    // The creator and the approvers see it; colleagues do not yet, and cannot run it.
    for (const user of [olivier, paul, owner]) expect(await sees(user, shared)).toBe(true);
    for (const user of [nathalie, sam, fanny]) expect(await sees(user, shared)).toBe(false);
    expect((await run(nathalie, shared)).error?.message).toBe("forbidden");
  });

  it("is decided by Admins with the agents scope only", async () => {
    expect((await fanny.client.rpc("decide_tool", { p_agent: shared, p_approve: true })).error?.message).toBe("forbidden");
    expect((await olivier.client.rpc("decide_tool", { p_agent: shared, p_approve: true })).error?.message).toBe("forbidden");
    expect((await paul.client.rpc("decide_tool", { p_agent: shared, p_approve: true })).error).toBeNull();
    for (const user of [nathalie, sam, fanny]) expect(await sees(user, shared)).toBe(true);
    expect((await run(nathalie, shared)).error).toBeNull();
    const log = await sql<{ action: string }>("select action from public.audit_log where target_id = $1 order by created_at", [shared]);
    expect(log.map((l) => l.action)).toEqual(["agent.created", "agent.approved"]);
  });

  it("asks again after the creator edits an approved tool", async () => {
    expect((await save(olivier, "Pour tous v2", "company", shared)).error).toBeNull();
    expect((await sql<{ publication: string }>("select publication from public.agents where id = $1", [shared]))[0].publication).toBe("pending");
    expect(await sees(nathalie, shared)).toBe(false);
    expect((await owner.client.rpc("decide_tool", { p_agent: shared, p_approve: true })).error).toBeNull();
  });

  it("is published directly when the creator may approve", async () => {
    const { data } = await save(owner, "Du patron", "company");
    expect((await sql<{ publication: string }>("select publication from public.agents where id = $1", [data!]))[0].publication).toBe("approved");
    expect(await sees(nathalie, data!)).toBe(true);
  });

  it("limits a shared tool to some roles", async () => {
    expect((await fanny.client.rpc("set_tool_roles", { p_agent: shared, p_roles: ["owner"] })).error?.message).toBe("forbidden");
    expect((await paul.client.rpc("set_tool_roles", { p_agent: shared, p_roles: ["owner", "admin"] })).error).toBeNull();
    expect((await run(nathalie, shared)).error?.message).toBe("forbidden");
    expect((await run(paul, shared)).error).toBeNull();
  });

  it("is deleted by its creator or an agents Admin, nobody else", async () => {
    expect((await nathalie.client.rpc("delete_tool", { p_agent: shared })).error).not.toBeNull();
    expect((await paul.client.rpc("delete_tool", { p_agent: shared })).error).toBeNull();
    expect(await sees(olivier, shared)).toBe(false);
  });
});

describe("built-in agents and the company's adaptations", () => {
  it("are offered to every company", async () => {
    for (const user of [nathalie, ownerB]) expect(await sees(user, builtin)).toBe(true);
    expect((await run(nathalie, builtin)).error).toBeNull();
    expect((await run(ownerB, builtin, companyB)).error).toBeNull();
  });

  it("are adapted and enabled per role by agents Admins, for their company only", async () => {
    const settings = { enabled: true, enabled_roles: ["owner", "admin"], instructions_addition: "Toujours en vouvoyant.", tone: "chaleureux" };
    expect((await fanny.client.rpc("admin_set_agent_settings", { p_company: company, p_agent: builtin, p_settings: settings })).error?.message).toBe("forbidden");
    expect((await paul.client.rpc("admin_set_agent_settings", { p_company: companyB, p_agent: builtin, p_settings: settings })).error?.message).toBe("forbidden");
    expect((await paul.client.rpc("admin_set_agent_settings", { p_company: company, p_agent: builtin, p_settings: settings })).error).toBeNull();
    expect((await run(nathalie, builtin)).error?.message).toBe("forbidden");
    expect((await run(paul, builtin)).error).toBeNull();
    // The other company is not affected, and cannot read these adaptations.
    expect((await run(ownerB, builtin, companyB)).error).toBeNull();
    expect((await ownerB.client.from("company_agent_settings").select("*").eq("company_id", company)).data).toEqual([]);
    expect((await nathalie.client.from("company_agent_settings").select("instructions_addition").eq("agent_id", builtin)).data).toEqual([
      { instructions_addition: "Toujours en vouvoyant." },
    ]);
  });

  it("cannot be edited or deleted by a company", async () => {
    expect((await owner.client.rpc("delete_tool", { p_agent: builtin })).error?.message).toBe("not_found");
    expect((await owner.client.rpc("save_tool", { p_company: company, p_id: builtin, p_tool: tool("x"), p_visibility: "private" })).error?.message).toBe("not_found");
  });
});

describe("no content for the platform admin or another company", () => {
  it("shows them no company tool", async () => {
    for (const outsider of [platform, ownerB]) {
      const { data } = await outsider.client.from("agents").select("id").eq("company_id", company);
      expect(data ?? []).toEqual([]);
      expect((await outsider.client.from("company_agent_settings").select("*").eq("company_id", company)).data ?? []).toEqual([]);
    }
  });
});

describe("Confronter results are written by the server only", () => {
  it("refuses a user writing a confrontation on a message", async () => {
    const conv = await olivier.client.from("conversations").insert({ company_id: company }).select("id").single();
    const message = await olivier.client.from("messages").insert({ conversation_id: conv.data!.id, content: "Question" }).select("id").single();
    expect((await olivier.client.from("messages").insert({ conversation_id: conv.data!.id, content: "x", confrontation: {} } as never)).error).not.toBeNull();
    await olivier.client.from("messages").update({ confrontation: { forged: true } } as never).eq("id", message.data!.id);
    expect((await sql<{ confrontation: unknown }>("select confrontation from public.messages where id = $1", [message.data!.id]))[0].confrontation).toBeNull();
  });
});
