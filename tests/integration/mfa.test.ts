import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, createCompany, createUser, makePlatformAdmin, passTwoStep, sql, type TestUser } from "../helpers/supabase";

/**
 * Two-step sign-in (migration 20261113000001_mfa.sql), checked in the database itself: a person who set
 * up an authenticator gets nothing with a password alone, and our team's powers always need the code.
 */
let owner: TestUser, company: string;

beforeAll(async () => {
  owner = await createUser("mfa-owner", "Owner");
  company = await createCompany(owner, "MFA Co");
});

/** A fresh session for `user`, signed in with the password only (first step). */
async function passwordOnly(user: TestUser) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

describe("once a person has set up two-step sign-in", () => {
  it("a session that only passed the password reads and calls nothing", async () => {
    await passTwoStep(owner);
    const firstStep = await passwordOnly(owner);
    const profile = await firstStep.from("profiles").select("id").eq("id", owner.id);
    expect(profile.error?.message).toBe("mfa_required");
    expect((await firstStep.rpc("my_memberships")).error?.message).toBe("mfa_required");
    expect((await firstStep.from("companies").select("id").eq("id", company)).error?.message).toBe("mfa_required");
  });

  it("the same session works once the code is given", async () => {
    const client = await passwordOnly(owner);
    const second = { ...owner, client };
    await passTwoStep(second);
    expect((await client.from("profiles").select("id").eq("id", owner.id)).data).toEqual([{ id: owner.id }]);
    expect((await client.rpc("my_memberships")).error).toBeNull();
  });

  it("people without it are not affected", async () => {
    const member = await createUser("mfa-plain", "Plain");
    expect((await member.client.from("profiles").select("id").eq("id", member.id)).data).toEqual([{ id: member.id }]);
  });
});

describe("our team's powers", () => {
  it("need the code: before it, the person only sees that they are in our team", async () => {
    const team = await createUser("mfa-team", "Team");
    await sql("insert into public.platform_admins (user_id) values ($1)", [team.id]);
    expect((await team.client.rpc("platform_team")).error?.message).toBe("forbidden");
    expect((await team.client.from("platform_admins").select("user_id")).data).toEqual([{ user_id: team.id }]);
    expect((await team.client.from("companies").select("id").eq("id", company)).data).toEqual([]);

    await makePlatformAdmin(team);
    expect((await team.client.rpc("platform_team")).error).toBeNull();
    expect((await team.client.from("platform_admins").select("user_id")).data!.length).toBeGreaterThan(1);
  });
});

describe("live updates and files", () => {
  it("are guarded by the same rule (restrictive policies)", async () => {
    const policies = await sql<{ tablename: string }>(
      "select tablename from pg_policies where policyname in ('messages_mfa', 'conversation_participants_mfa', 'objects_mfa') and permissive = 'RESTRICTIVE' order by tablename",
    );
    expect(policies.map((p) => p.tablename)).toEqual(["conversation_participants", "messages", "objects"]);
  });
});
