import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  anonClient,
  createClientRecord,
  createCompany,
  createUser,
  makePlatformAdmin,
  serviceClient,
  sql,
  type TestUser,
} from "../helpers/supabase";

/**
 * Isolation tests with real users and real JWTs, through the same API the app (or an attacker) uses.
 * Scenario: company A (owner, admin with "members" scope, Olivier, Nathalie) and company B.
 * Client A is restricted to Olivier; Client Open is open to everyone in A.
 */
let ownerA: TestUser, adminA: TestUser, olivier: TestUser, nathalie: TestUser;
let ownerB: TestUser, memberB: TestUser, platform: TestUser, outsider: TestUser;
let companyA: string, companyB: string;
let clientA: string, clientOpen: string, clientX: string;

beforeAll(async () => {
  [ownerA, adminA, olivier, nathalie, ownerB, memberB, platform, outsider] = await Promise.all([
    createUser("owner-a", "Owner A"),
    createUser("admin-a", "Admin A"),
    createUser("olivier", "Olivier"),
    createUser("nathalie", "Nathalie"),
    createUser("owner-b", "Owner B"),
    createUser("member-b", "Member B"),
    createUser("platform", "Platform Admin"),
    createUser("outsider", "Outsider"),
  ]);
  await makePlatformAdmin(platform);

  companyA = await createCompany(ownerA, "Company A");
  companyB = await createCompany(ownerB, "Company B");
  await addMember(ownerA, companyA, adminA, "admin", ["members"]);
  await addMember(ownerA, companyA, olivier);
  await addMember(ownerA, companyA, nathalie, "member", [], ["finance"]);
  await addMember(ownerB, companyB, memberB);

  clientA = await createClientRecord(ownerA, companyA, "Client A", "restricted");
  clientOpen = await createClientRecord(ownerA, companyA, "Client Open", "open");
  clientX = await createClientRecord(ownerB, companyB, "Client X", "restricted");
  const { error } = await ownerA.client
    .from("client_assignments")
    .insert({ client_id: clientA, company_id: companyA, user_id: olivier.id });
  if (error) throw error;
});

const ids = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id).sort();

describe("database safety nets", () => {
  it("has Row Level Security enabled on every table of the public schema", async () => {
    const rows = await sql<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(rows).toEqual([]);
  });

  it("never grants TRUNCATE (which bypasses RLS) or any table access to anonymous visitors", async () => {
    const rows = await sql(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type = 'TRUNCATE'))`,
    );
    expect(rows).toEqual([]);
  });

  it("does not let anonymous visitors call any RPC", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("create_company", { p_name: "Nope" });
    expect(error).not.toBeNull();
    const { data } = await anon.from("companies").select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("no cross-company access", () => {
  it("only shows a user their own company", async () => {
    const { data } = await ownerB.client.from("companies").select("id");
    expect(ids(data)).toEqual([companyB]);
  });

  it("hides another company's clients, members, invitations, teams and activity", async () => {
    const [clients, members, invitations, teams, audit] = await Promise.all([
      ownerB.client.from("clients").select("id").eq("company_id", companyA),
      ownerB.client.from("company_members").select("user_id").eq("company_id", companyA),
      ownerB.client.from("invitations").select("id").eq("company_id", companyA),
      ownerB.client.from("teams").select("id").eq("company_id", companyA),
      ownerB.client.from("audit_log").select("id").eq("company_id", companyA),
    ]);
    expect(clients.data).toEqual([]);
    expect(members.data).toEqual([]);
    expect(invitations.data).toEqual([]);
    expect(teams.data).toEqual([]);
    expect(audit.data).toEqual([]);
  });

  it("hides the profiles of people in other companies", async () => {
    const { data } = await ownerB.client.from("profiles").select("id").in("id", [ownerA.id, olivier.id, nathalie.id]);
    expect(data).toEqual([]);
  });

  it("refuses to create a client in another company", async () => {
    const { error } = await ownerB.client.from("clients").insert({ company_id: companyA, name: "Intrusion" });
    expect(error).not.toBeNull();
  });

  it("refuses invitations and member changes in another company", async () => {
    const invite = await ownerB.client.rpc("create_invitation", { p_company: companyA, p_email: "spy@test.local" });
    expect(invite.error?.message).toBe("forbidden");
    const change = await ownerB.client.rpc("admin_update_member", { p_company: companyA, p_user: olivier.id, p_status: "deactivated" });
    expect(change.error?.message).toBe("forbidden");
  });

  it("cannot rename another company", async () => {
    await ownerB.client.from("companies").update({ name: "Hacked" }).eq("id", companyA);
    const [row] = await sql<{ name: string }>("select name from public.companies where id = $1", [companyA]);
    expect(row.name).toBe("Company A");
  });

  it("cannot attach someone to a client of another company, even by lying about the company", async () => {
    const own = await ownerB.client
      .from("client_assignments")
      .insert({ client_id: clientA, company_id: companyB, user_id: memberB.id });
    expect(own.error).not.toBeNull();
    const theirs = await ownerB.client
      .from("client_assignments")
      .insert({ client_id: clientA, company_id: companyA, user_id: memberB.id });
    expect(theirs.error).not.toBeNull();
  });

  it("cannot read client X of company B from company A, even as Owner", async () => {
    const { data } = await ownerA.client.from("clients").select("id").eq("id", clientX);
    expect(data).toEqual([]);
  });
});

describe("member restrictions", () => {
  it("shows a restricted client only to assigned members (and the Owner)", async () => {
    const asNathalie = await nathalie.client.from("clients").select("id").eq("company_id", companyA);
    expect(ids(asNathalie.data)).toEqual([clientOpen]);

    const asOlivier = await olivier.client.from("clients").select("id").eq("company_id", companyA);
    expect(ids(asOlivier.data)).toEqual([clientA, clientOpen].sort());

    const asOwner = await ownerA.client.from("clients").select("id").eq("company_id", companyA);
    expect(ids(asOwner.data)).toEqual([clientA, clientOpen].sort());
  });

  it("hides who is assigned to a restricted client from people without access", async () => {
    const { data } = await nathalie.client.from("client_assignments").select("user_id").eq("client_id", clientA);
    expect(data).toEqual([]);
  });

  it("does not let a member create or change clients", async () => {
    const insert = await nathalie.client.from("clients").insert({ company_id: companyA, name: "Mine" });
    expect(insert.error).not.toBeNull();
    await nathalie.client.from("clients").update({ visibility: "open" }).eq("id", clientA);
    const [row] = await sql<{ visibility: string }>("select visibility from public.clients where id = $1", [clientA]);
    expect(row.visibility).toBe("restricted");
  });

  it("does not let a member give herself access to a restricted client", async () => {
    const { error } = await nathalie.client
      .from("client_assignments")
      .insert({ client_id: clientA, company_id: companyA, user_id: nathalie.id });
    expect(error).not.toBeNull();
  });

  it("does not let a member invite, read invitations or read the activity log", async () => {
    const invite = await nathalie.client.rpc("create_invitation", { p_company: companyA, p_email: "friend@test.local" });
    expect(invite.error?.message).toBe("forbidden");
    const invitations = await nathalie.client.from("invitations").select("id");
    expect(invitations.data).toEqual([]);
    const audit = await nathalie.client.from("audit_log").select("id");
    expect(audit.data).toEqual([]);
  });

  it("does not let a member promote herself", async () => {
    const direct = await nathalie.client.from("company_members").update({ role: "owner" }).eq("user_id", nathalie.id);
    expect(direct.error).not.toBeNull();
    const rpc = await nathalie.client.rpc("admin_update_member", { p_company: companyA, p_user: nathalie.id, p_role: "admin" });
    expect(rpc.error?.message).toBe("forbidden");
    const [row] = await sql<{ role: string }>(
      "select role from public.company_members where company_id = $1 and user_id = $2",
      [companyA, nathalie.id],
    );
    expect(row.role).toBe("member");
  });

  it("does not let a member edit the company profile", async () => {
    await nathalie.client.from("companies").update({ name: "Nathalie Corp" }).eq("id", companyA);
    const [row] = await sql<{ name: string }>("select name from public.companies where id = $1", [companyA]);
    expect(row.name).toBe("Company A");
  });

  it("does not let a user point their profile at a company they don't belong to", async () => {
    const { error } = await nathalie.client.from("profiles").update({ active_company_id: companyB }).eq("id", nathalie.id);
    expect(error).not.toBeNull();
  });

  it("lets a member update only her own member card", async () => {
    const own = await nathalie.client.rpc("update_my_member_card", {
      p_company: companyA,
      p_job_title: "CFO",
      p_expertise: ["finance", "tax"],
      p_opt_out: false,
    });
    expect(own.error).toBeNull();
    const other = await nathalie.client.rpc("update_my_member_card", {
      p_company: companyB,
      p_job_title: "x",
      p_expertise: [],
      p_opt_out: false,
    });
    expect(other.error?.message).toBe("forbidden");
  });
});

describe("admin scopes delegated by the Owner", () => {
  it("lets an Admin with the members scope invite members, but not Admins", async () => {
    const member = await adminA.client.rpc("create_invitation", { p_company: companyA, p_email: "new-member@test.local" });
    expect(member.error).toBeNull();
    const admin = await adminA.client.rpc("create_invitation", {
      p_company: companyA,
      p_email: "new-admin@test.local",
      p_role: "admin",
    });
    expect(admin.error?.message).toBe("owner_only");
  });

  it("does not give an Admin the powers they were not delegated", async () => {
    const client = await adminA.client.from("clients").insert({ company_id: companyA, name: "Admin client" });
    expect(client.error).not.toBeNull();
    const audit = await adminA.client.from("audit_log").select("id").eq("company_id", companyA);
    expect(audit.data).toEqual([]);
    const restricted = await adminA.client.from("clients").select("id").eq("id", clientA);
    expect(restricted.data).toEqual([]);
    const role = await adminA.client.rpc("admin_update_member", { p_company: companyA, p_user: olivier.id, p_role: "admin" });
    expect(role.error?.message).toBe("owner_only");
    const owner = await adminA.client.rpc("admin_update_member", { p_company: companyA, p_user: ownerA.id, p_status: "deactivated" });
    expect(owner.error?.message).toBe("owner_protected");
  });

  it("removes all access from a deactivated member", async () => {
    const temp = await createUser("temp");
    await addMember(ownerA, companyA, temp);
    expect(ids((await temp.client.from("clients").select("id")).data)).toEqual([clientOpen]);

    const off = await adminA.client.rpc("admin_update_member", { p_company: companyA, p_user: temp.id, p_status: "deactivated" });
    expect(off.error).toBeNull();
    expect((await temp.client.from("clients").select("id")).data).toEqual([]);
    expect((await temp.client.from("companies").select("id")).data).toEqual([]);
    expect((await temp.client.from("company_members").select("user_id")).data).toEqual([]);
  });
});

describe("platform admin cannot read customer content", () => {
  // Every table that holds company or client content. Later steps add conversations, messages,
  // documents, chunks, memory entries, handovers… to this list.
  const CONTENT_TABLES = ["clients", "client_assignments", "company_members", "invitations", "teams"] as const;

  it.each(CONTENT_TABLES)("reads zero rows from %s", async (table) => {
    const { data } = await platform.client.from(table).select("*").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("cannot read companies directly, nor customers' profiles, nor company activity", async () => {
    expect((await platform.client.from("companies").select("id")).data).toEqual([]);
    expect((await platform.client.from("profiles").select("id").neq("id", platform.id)).data).toEqual([]);
    expect((await platform.client.from("audit_log").select("id").eq("scope", "company")).data).toEqual([]);
  });

  it("sees only account metadata through the platform console function", async () => {
    const { data, error } = await platform.client.rpc("platform_list_companies");
    expect(error).toBeNull();
    const a = data!.find((c) => c.id === companyA)!;
    expect(a.name).toBe("Company A");
    expect(Number(a.active_seats)).toBeGreaterThanOrEqual(4);
    expect(Object.keys(a).sort()).toEqual(
      ["active_seats", "created_at", "id", "name", "owner_email", "pending_invitations", "plan_id", "plan_name", "seat_limit", "status"].sort(),
    );
  });

  it("refuses the platform console functions to customers", async () => {
    const list = await ownerA.client.rpc("platform_list_companies");
    expect(list.error?.message).toBe("forbidden");
    const suspend = await ownerA.client.rpc("platform_update_company", { p_company: companyB, p_status: "suspended" });
    expect(suspend.error?.message).toBe("forbidden");
    const plan = await ownerA.client.from("plans").insert({ name: "Free forever", monthly_credits: 999999 });
    expect(plan.error).not.toBeNull();
  });

  it("can suspend a company, which cuts its members off, then reactivate it", async () => {
    expect(ids((await memberB.client.from("companies").select("id")).data)).toEqual([companyB]);
    const off = await platform.client.rpc("platform_update_company", { p_company: companyB, p_status: "suspended" });
    expect(off.error).toBeNull();
    expect((await memberB.client.from("companies").select("id")).data).toEqual([]);
    expect((await ownerB.client.from("clients").select("id")).data).toEqual([]);
    const on = await platform.client.rpc("platform_update_company", { p_company: companyB, p_status: "active" });
    expect(on.error).toBeNull();
    expect(ids((await memberB.client.from("companies").select("id")).data)).toEqual([companyB]);
  });

  it("still cannot read a company's content after creating it", async () => {
    const { data, error } = await platform.client.rpc("platform_create_company", {
      p_name: "Created by platform",
      p_plan: (await serviceClient().from("plans").select("id").limit(1).single()).data!.id,
      p_owner_email: outsider.email,
    });
    expect(error).toBeNull();
    const created = data![0].company_id;
    await outsider.client.rpc("accept_invitation", { p_token: data![0].token });
    const clientId = await createClientRecord(outsider, created, "Secret client", "open");
    expect((await platform.client.from("clients").select("id").eq("id", clientId)).data).toEqual([]);
    expect((await platform.client.from("companies").select("id").eq("id", created)).data).toEqual([]);
  });
});

describe("invitations", () => {
  it("can only be accepted by the invited email address, once", async () => {
    const { data } = await ownerA.client.rpc("create_invitation", { p_company: companyA, p_email: "someone-else@test.local" });
    const token = data![0].token;
    const stolen = await memberB.client.rpc("accept_invitation", { p_token: token });
    expect(stolen.error?.message).toBe("invitation_wrong_email");

    const guest = await createUser("guest");
    const invite = await ownerA.client.rpc("create_invitation", { p_company: companyA, p_email: guest.email });
    const guestToken = invite.data![0].token;
    expect((await guest.client.rpc("accept_invitation", { p_token: guestToken })).error).toBeNull();
    expect((await guest.client.rpc("accept_invitation", { p_token: guestToken })).error?.message).toBe("invitation_invalid");
  });

  it("enforces the plan's seat limit", async () => {
    const owner = await createUser("seat-owner");
    const company = await createCompany(owner, "Tiny Co");
    const [plan] = await sql<{ id: string }>(
      "insert into public.plans (name, seat_limit, monthly_credits) values ('Tiny', 2, 0) returning id",
    );
    await sql("update public.companies set plan_id = $1 where id = $2", [plan.id, company]);
    expect((await owner.client.rpc("create_invitation", { p_company: company, p_email: "one@test.local" })).error).toBeNull();
    const second = await owner.client.rpc("create_invitation", { p_company: company, p_email: "two@test.local" });
    expect(second.error?.message).toBe("seat_limit_reached");
  });
});

describe("activity log", () => {
  it("records permission changes as metadata only", async () => {
    const { data } = await ownerA.client
      .from("audit_log")
      .select("action, metadata, target_id")
      .eq("company_id", companyA)
      .in("action", ["client.created", "client.assigned"]);
    const actions = (data ?? []).map((e) => e.action);
    expect(actions).toContain("client.created");
    expect(actions).toContain("client.assigned");
    // Client names never appear in the log.
    expect(JSON.stringify(data)).not.toContain("Client A");
  });
});
