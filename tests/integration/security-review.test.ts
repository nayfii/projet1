import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, anonClient, createClientRecord, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 10 security review (docs/SECURITY.md §5): the database fixes, each with the attack it stops.
 */
let owner: TestUser, olivier: TestUser, nathalie: TestUser;
let company: string, clientA: string, clientSpace: string;

beforeAll(async () => {
  [owner, olivier, nathalie] = await Promise.all([createUser("sec-owner", "Owner"), createUser("sec-olivier", "Olivier"), createUser("sec-nathalie", "Nathalie")]);
  company = await createCompany(owner, "Security Co");
  await addMember(owner, company, olivier);
  await addMember(owner, company, nathalie);
  clientA = await createClientRecord(owner, company, "Client A", "restricted");
  const assign = await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
  if (assign.error) throw assign.error;
  [{ id: clientSpace }] = await sql<{ id: string }>("select id from public.memory_spaces where client_id = $1", [clientA]);
});

describe("invitations need a confirmed address", () => {
  it("an account whose email is not confirmed neither sees nor accepts the invitation sent to that address", async () => {
    const email = `sec-squatter-${randomUUID().slice(0, 8)}@test.local`;
    const { data: invitation, error } = await owner.client.rpc("create_invitation", { p_company: company, p_email: email, p_role: "admin", p_admin_scopes: ["members"], p_expertise: [] });
    expect(error).toBeNull();
    // Someone registers the address first (as if e-mail confirmation were off) and holds a session.
    const password = `pw-${randomUUID()}`;
    const created = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true });
    const squatter = anonClient();
    await squatter.auth.signInWithPassword({ email, password });
    await sql("update auth.users set email_confirmed_at = null where id = $1", [created.data.user!.id]);

    expect((await squatter.rpc("my_pending_invitations")).data).toEqual([]);
    const [{ id }] = await sql<{ id: string }>("select id from public.invitations where email = $1", [email]);
    expect((await squatter.rpc("accept_invitation", { p_invitation: id })).error?.message).toBe("invitation_wrong_email");
    expect((await squatter.rpc("accept_invitation", { p_token: invitation![0].token })).error?.message).toBe("invitation_wrong_email");
    expect(await sql("select 1 from public.company_members where user_id = $1", [created.data.user!.id])).toHaveLength(0);
  });
});

describe("passwords", () => {
  it("are cleared at sign-in by the server only, so a password set by someone else stops working", async () => {
    const email = `sec-pw-${randomUUID().slice(0, 8)}@test.local`;
    const password = `pw-${randomUUID()}`;
    const created = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true });
    const someone = anonClient();
    expect((await someone.auth.signInWithPassword({ email, password })).error).toBeNull();
    expect((await someone.rpc("clear_user_password", { p_user: created.data.user!.id })).error).not.toBeNull();
    expect((await serviceClient().rpc("clear_user_password", { p_user: created.data.user!.id })).error).toBeNull();
    expect((await anonClient().auth.signInWithPassword({ email, password })).error).not.toBeNull();
  });
});

describe("a restricted client", () => {
  it("cannot be handed over by someone who was deactivated", async () => {
    const fired = await createUser("sec-fired", "Fired");
    await addMember(owner, company, fired);
    const clientB = await createClientRecord(owner, company, "Client B", "restricted");
    await owner.client.from("client_assignments").insert({ client_id: clientB, company_id: company, user_id: fired.id });
    expect((await owner.client.rpc("admin_update_member", { p_company: company, p_user: fired.id, p_status: "deactivated" })).error).toBeNull();
    const tried = await fired.client.rpc("transfer_client", { p_client: clientB, p_to: nathalie.id, p_sections: {}, p_ai_generated: false });
    expect(tried.error?.message).toBe("not_found");
    expect(await sql("select 1 from public.client_assignments where client_id = $1 and user_id = $2", [clientB, nathalie.id])).toHaveLength(0);
  });

  it("keeps its handover file readable only while the recipient still has access", async () => {
    const { error } = await olivier.client.rpc("transfer_client", { p_client: clientA, p_to: nathalie.id, p_sections: { summary: "Budget 80 000 €" }, p_ai_generated: false });
    expect(error).toBeNull();
    expect((await nathalie.client.from("handovers").select("sections").eq("client_id", clientA)).data).toHaveLength(1);
    // The Owner takes Client A away from Nathalie: the summary of its memory goes with it.
    await owner.client.from("client_assignments").delete().eq("client_id", clientA).eq("user_id", nathalie.id);
    expect((await nathalie.client.from("handovers").select("sections").eq("client_id", clientA)).data).toEqual([]);
    const update = await nathalie.client.from("handovers").update({ sections: { summary: "x" } }).eq("client_id", clientA).select("id");
    expect(update.data ?? []).toEqual([]);
  });

  it("keeps AI memory suggestions private to their proposer, and only while they can read the memory", async () => {
    await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
    await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: nathalie.id });
    const inserted = await olivier.client
      .from("memory_suggestions")
      .insert({ space_id: clientSpace, kind: "new_entry", title: "Remise Client A", content: "12 % sur le volume", source_ref: {} })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    // Nathalie can write in Client A's memory, but Olivier's pending suggestion is his to decide.
    expect((await nathalie.client.from("memory_suggestions").select("id").eq("id", inserted.data!.id)).data).toEqual([]);
    expect((await nathalie.client.rpc("decide_memory_suggestion", { p_suggestion: inserted.data!.id, p_approve: true })).error?.message).toBe("forbidden");
    // Once Olivier loses Client A, he cannot read it either.
    await owner.client.from("client_assignments").delete().eq("client_id", clientA).eq("user_id", olivier.id);
    expect((await olivier.client.from("memory_suggestions").select("id").eq("id", inserted.data!.id)).data).toEqual([]);
  });
});

describe("seats", () => {
  it("cannot be exceeded by reactivating someone", async () => {
    const boss = await createUser("sec-seat-owner", "Boss");
    const a = await createUser("sec-seat-a", "A");
    const b = await createUser("sec-seat-b", "B");
    const seatCompany = await createCompany(boss, "Seats Co");
    const [{ id: plan }] = await sql<{ id: string }>(
      "insert into public.plans (name, seat_limit, monthly_credits) values ($1, 2, 1000) returning id",
      [`Two seats ${randomUUID().slice(0, 6)}`],
    );
    await sql("update public.companies set plan_id = $1 where id = $2", [plan, seatCompany]);
    await addMember(boss, seatCompany, a);
    await boss.client.rpc("admin_update_member", { p_company: seatCompany, p_user: a.id, p_status: "deactivated" });
    await addMember(boss, seatCompany, b);
    const reactivated = await boss.client.rpc("admin_update_member", { p_company: seatCompany, p_user: a.id, p_status: "active" });
    expect(reactivated.error?.message).toBe("seat_limit_reached");
  });
});

describe("function rights", () => {
  it("keeps server-only functions closed to signed-in people", async () => {
    expect((await olivier.client.rpc("hide_assign_placeholders", { p_conversation: randomUUID(), p_items: [] })).error).not.toBeNull();
    const [{ ok }] = await sql<{ ok: boolean }>("select has_function_privilege('anon', 'private.is_company_member(uuid)', 'execute') as ok");
    expect(ok).toBe(false);
  });
});

/** Audit 2026-11-11: our dollar prices per model stay in our console; customers see credits only. */
describe("the model catalogue", () => {
  it("shows customers names and credit rates, never our dollar prices", async () => {
    expect((await olivier.client.from("ai_models").select("input_usd_per_mtok")).error).not.toBeNull();
    expect((await olivier.client.from("ai_models").select("*")).error).not.toBeNull();
    const visible = await olivier.client.from("ai_models").select("id, label, input_credits_per_mtok").limit(1);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(1);
  });

  it("can still be changed by our team, and only by our team", async () => {
    const team = await createUser("sec-team", "Team");
    await makePlatformAdmin(team);
    const [{ id, label }] = await sql<{ id: string; label: string }>("select id, label from public.ai_models order by sort_order limit 1");
    expect((await olivier.client.from("ai_models").update({ input_usd_per_mtok: 0 }).eq("id", id).select("id")).data).toEqual([]);
    const changed = await team.client.from("ai_models").update({ label }).eq("id", id).select("id");
    expect(changed.error).toBeNull();
    expect(changed.data).toEqual([{ id }]);
  });
});
