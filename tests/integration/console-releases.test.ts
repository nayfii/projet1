import { beforeAll, describe, expect, it } from "vitest";
import { createCompany, createUser, makePlatformAdmin, passTwoStep, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Our console's versions, checks and Claude Code requests (CLAUDE.md §11): our team only, never a
 * customer's space, and the demo company used by the check can only hold demo accounts.
 */
let platform: TestUser, owner: TestUser, demoBoss: TestUser, demoEmployee: TestUser;

beforeAll(async () => {
  [platform, owner, demoBoss, demoEmployee] = await Promise.all([
    createUser("rel-platform", "Équipe"),
    createUser("rel-owner", "Client réel"),
    createUser("rel-demo-boss", "Gérant démo"),
    createUser("rel-demo-employee", "Employée démo"),
  ]);
  await makePlatformAdmin(platform);
  await createCompany(owner, "Client réel SARL");
});

describe("the demo company used by the version check", () => {
  it("is created by the service key only, for demo accounts only, and marked as a demo", async () => {
    expect((await owner.client.rpc("platform_seed_demo_company", { p_owner: demoBoss.id, p_member: demoEmployee.id })).error).not.toBeNull();
    expect((await platform.client.rpc("platform_seed_demo_company", { p_owner: demoBoss.id, p_member: demoEmployee.id })).error).not.toBeNull();
    // A customer's account can never be pulled into it.
    const refused = await serviceClient().rpc("platform_seed_demo_company", { p_owner: owner.id, p_member: demoEmployee.id });
    expect(refused.error?.message).toBe("forbidden");

    const first = await serviceClient().rpc("platform_seed_demo_company", { p_owner: demoBoss.id, p_member: demoEmployee.id });
    expect(first.error).toBeNull();
    const again = await serviceClient().rpc("platform_seed_demo_company", { p_owner: demoBoss.id, p_member: demoEmployee.id });
    expect(again.data).toBe(first.data);
    const [company] = await sql<{ is_demo: boolean; members: number; clients: number }>(
      `select c.is_demo, (select count(*)::int from public.company_members m where m.company_id = c.id) as members,
              (select count(*)::int from public.clients cl where cl.company_id = c.id) as clients
       from public.companies c where c.id = $1`,
      [first.data],
    );
    expect(company).toEqual({ is_demo: true, members: 2, clients: 1 });
    expect((await demoEmployee.client.from("clients").select("name")).data).toEqual([{ name: "Client démo (fictif)" }]);
  });
});

describe("check results and Claude Code requests", () => {
  it("are read by our team only and written only by our workflows or our console", async () => {
    await sql("insert into public.platform_check_runs (version, status, results) values ('v1.0', 'passed', '[]')");
    expect(((await platform.client.from("platform_check_runs").select("id")).data ?? []).length).toBeGreaterThan(0);
    expect((await owner.client.from("platform_check_runs").select("id")).data).toEqual([]);
    expect((await platform.client.from("platform_check_runs").insert({ version: "v9.9", status: "passed" })).error).not.toBeNull();

    expect((await owner.client.rpc("platform_create_fix_request", { p_request: "Changer le bouton" })).error?.message).toBe("forbidden");
    const { data: id, error } = await platform.client.rpc("platform_create_fix_request", { p_request: "Le bouton Nouveau client est trop petit" });
    expect(error).toBeNull();
    expect((await platform.client.from("platform_fix_requests").select("request").eq("id", id!)).data).toEqual([{ request: "Le bouton Nouveau client est trop petit" }]);
    expect((await owner.client.from("platform_fix_requests").select("id")).data).toEqual([]);
    expect((await platform.client.from("platform_fix_requests").insert({ request: "direct" })).error).not.toBeNull();

    // In the platform audit log without the text; customers' logs never see it.
    const logged = await sql<{ action: string; metadata: object }>("select action, metadata from public.audit_log where scope = 'platform' and target_id = $1", [id]);
    expect(logged).toEqual([{ action: "fix.requested", metadata: {} }]);
    expect((await owner.client.rpc("platform_log_release_event", { p_action: "release.launched", p_target: "next", p_version: "v1.1" })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_log_release_event", { p_action: "release.launched", p_target: "next", p_version: "v1.1" })).error).toBeNull();
    expect((await platform.client.rpc("platform_log_release_event", { p_action: "anything", p_target: "x", p_version: "v1.1" })).error?.message).toBe("validation");
  });

  it("captures are stored in a private bucket our team reads, and nobody else", async () => {
    const path = `test-${Date.now()}/owner-home.jpg`;
    expect((await serviceClient().storage.from("platform-checks").upload(path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { contentType: "image/jpeg" })).error).toBeNull();
    expect((await platform.client.storage.from("platform-checks").createSignedUrl(path, 60)).error).toBeNull();
    expect((await owner.client.storage.from("platform-checks").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await owner.client.storage.from("platform-checks").upload(`${path}.x`, new Uint8Array([1]), { contentType: "image/jpeg" })).error).not.toBeNull();
  });
});

describe("our team, managed from the console (Plateforme → Équipe)", () => {
  it("only our team adds or removes people; never oneself, never the last one; logged", async () => {
    const colleague = await createUser("rel-colleague", "Collègue Cendr");
    expect((await owner.client.rpc("platform_add_admin", { p_email: colleague.email })).error?.message).toBe("forbidden");
    expect((await owner.client.rpc("platform_team")).error?.message).toBe("forbidden");

    // An account that exists gets the console at once; an unknown address waits for its first sign-in.
    expect((await platform.client.rpc("platform_add_admin", { p_email: colleague.email })).data).toBe("added");
    // Our console opens only after two-step sign-in (an authenticator code), even for a new team member.
    expect((await colleague.client.rpc("platform_team")).error?.message).toBe("forbidden");
    await passTwoStep(colleague);
    expect((await colleague.client.rpc("platform_team")).error).toBeNull();
    const pending = `futur-${Date.now()}@test.local`;
    expect((await platform.client.rpc("platform_add_admin", { p_email: pending })).data).toBe("invited");
    expect((await platform.client.from("platform_admin_invites").select("email").eq("email", pending)).data).toEqual([{ email: pending }]);
    expect((await owner.client.from("platform_admin_invites").select("email")).data).toEqual([]);

    expect((await platform.client.rpc("platform_remove_admin", { p_user: platform.id })).error?.message).toBe("forbidden");
    expect((await owner.client.rpc("platform_remove_admin", { p_user: colleague.id })).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_remove_admin", { p_user: colleague.id })).error).toBeNull();
    expect((await colleague.client.rpc("platform_team")).error?.message).toBe("forbidden");
    expect((await platform.client.rpc("platform_remove_admin", { p_email: pending })).error).toBeNull();

    const logged = await sql<{ action: string }>(
      "select action from public.audit_log where scope = 'platform' and action like 'platform_admin.%' and (target_id = $1 or target_id = $2) order by created_at",
      [colleague.id, pending],
    );
    expect(logged.map((l) => l.action)).toEqual(["platform_admin.granted", "platform_admin.invited", "platform_admin.removed", "platform_admin.invite_cancelled"]);
  });
});
