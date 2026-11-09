import { beforeAll, describe, expect, it } from "vitest";
import { createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";

/**
 * Scale (founder's request, 2026-11-09): our team's internal space. Only platform admins read or
 * write it, checked by the database itself (a second barrier behind the server's own check).
 */
let team: TestUser, owner: TestUser, member: TestUser;
let companyId: string;

const TABLES = [
  "scale_settings",
  "scale_objectives",
  "scale_projects",
  "scale_project_dependencies",
  "scale_milestones",
  "scale_tasks",
  "scale_task_dependencies",
  "scale_tests",
  "scale_test_comparisons",
  "scale_observations",
  "scale_documents",
  "scale_decisions",
  "scale_metrics",
  "scale_measurements",
  "scale_simulations",
  "scale_weeks",
  "scale_weekly_reviews",
  "scale_company_links",
  "scale_comments",
  "scale_attachments",
  "scale_activity",
  "scale_saved_views",
] as const;

beforeAll(async () => {
  [team, owner, member] = await Promise.all([createUser("scale-team", "Équipe"), createUser("scale-owner", "Gérant client"), createUser("scale-member", "Employé client")]);
  await makePlatformAdmin(team);
  companyId = await createCompany(owner, "Client Scale SARL");
});

describe("Scale's records", () => {
  it("are read and written by our team", async () => {
    const { data: project, error } = await team.client.from("scale_projects").insert({ title: "Projet interne", created_by: team.id }).select("id").single();
    expect(error).toBeNull();
    const { data: task } = await team.client.from("scale_tasks").insert({ title: "Tâche interne", project_id: project!.id }).select("id").single();
    expect(task?.id).toBeTruthy();
    expect((await team.client.from("scale_tasks").select("title").eq("id", task!.id)).data).toEqual([{ title: "Tâche interne" }]);
  });

  it("are invisible to a customer's owner and employees, in every table", async () => {
    for (const user of [owner, member]) {
      for (const table of TABLES) {
        const { data } = await user.client.from(table).select("*").limit(1);
        expect(data ?? [], `${table} must be empty for a customer`).toEqual([]);
      }
    }
  });

  it("cannot be written by anyone outside our team, even through the API directly", async () => {
    expect((await owner.client.from("scale_projects").insert({ title: "Intrusion" })).error).not.toBeNull();
    expect((await owner.client.from("scale_documents").insert({ title: "Intrusion" })).error).not.toBeNull();
    const [{ id }] = await sql<{ id: string }>("select id from public.scale_projects where title = 'Projet interne' limit 1");
    await owner.client.from("scale_projects").update({ title: "Modifié" }).eq("id", id);
    await owner.client.from("scale_projects").delete().eq("id", id);
    expect(await sql("select title from public.scale_projects where id = $1", [id])).toEqual([{ title: "Projet interne" }]);
  });

  it("link to a customer company by its id only, and linking gives the customer nothing", async () => {
    const { data: test } = await team.client.from("scale_tests").insert({ title: "Test pilote" }).select("id").single();
    const { error } = await team.client.from("scale_company_links").insert({ company_id: companyId, entity_type: "test", entity_id: test!.id, role: "pilot" });
    expect(error).toBeNull();
    // Linked twice: refused (one link per company and item).
    expect((await team.client.from("scale_company_links").insert({ company_id: companyId, entity_type: "test", entity_id: test!.id })).error).not.toBeNull();
    expect((await owner.client.from("scale_company_links").select("id")).data).toEqual([]);
    expect((await owner.client.from("scale_tests").select("id").eq("id", test!.id)).data).toEqual([]);
  });

  it("keep their history unalterable, and refuse values outside the lists", async () => {
    const { data: row } = await team.client.from("scale_activity").insert({ entity_type: "task", action: "created", actor_id: team.id }).select("id").single();
    await team.client.from("scale_activity").update({ action: "forged" }).eq("id", row!.id);
    expect(await sql("select action from public.scale_activity where id = $1", [row!.id])).toEqual([{ action: "created" }]);
    expect((await team.client.from("scale_tasks").insert({ title: "x", status: "whatever" })).error).not.toBeNull();
    expect((await team.client.from("scale_tasks").insert({ title: "x", week_start: "2026-11-10" })).error).not.toBeNull(); // not a Monday
    expect((await team.client.from("scale_tests").insert({ title: "x", conclusion: "proven" })).error).not.toBeNull();
    expect((await team.client.from("scale_objectives").insert([{ title: "a", is_focus: true }, { title: "b", is_focus: true }])).error).not.toBeNull(); // one heading at a time
  });

  it("files are in a private bucket our team reads, and nobody else", async () => {
    const path = `task/${crypto.randomUUID()}/note.txt`;
    expect((await team.client.storage.from("scale-files").upload(path, new Blob(["note"]), { contentType: "text/plain" })).error).toBeNull();
    expect((await team.client.storage.from("scale-files").createSignedUrl(path, 60)).error).toBeNull();
    expect((await owner.client.storage.from("scale-files").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await owner.client.storage.from("scale-files").upload(`task/${crypto.randomUUID()}/x.txt`, new Blob(["x"]))).error).not.toBeNull();
  });
});
