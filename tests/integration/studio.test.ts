import { beforeAll, describe, expect, it } from "vitest";
import { createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";

/**
 * Studio (founder's request, 2026-11-11, formerly Scale): our team's space. Only platform admins read
 * or write it, checked by the database itself (a second barrier behind the server's own check).
 */
let team: TestUser, colleague: TestUser, owner: TestUser, member: TestUser;

const TABLES = [
  "scale_tasks",
  "scale_milestones",
  "scale_documents",
  "scale_categories",
  "scale_task_documents",
  "scale_milestone_documents",
  "scale_document_visits",
  "scale_projects",
  "scale_objectives",
  "scale_tests",
  "scale_decisions",
  "scale_metrics",
  "scale_activity",
] as const;

const run = Date.now().toString(36);

beforeAll(async () => {
  [team, colleague, owner, member] = await Promise.all([
    createUser("studio-team", "Équipe"),
    createUser("studio-colleague", "Collègue"),
    createUser("studio-owner", "Gérant client"),
    createUser("studio-member", "Employé client"),
  ]);
  await Promise.all([makePlatformAdmin(team), makePlatformAdmin(colleague)]);
  await createCompany(owner, "Client Studio SARL");
});

describe("Studio's records", () => {
  it("are read and written by our team, and linked together", async () => {
    const { data: category } = await team.client.from("scale_categories").select("id").eq("key", "strategy").single();
    const { data: milestone, error } = await team.client.from("scale_milestones").insert({ title: `Valider l'ICP ${run}`, target_date: "2026-12-15", category_id: category!.id }).select("id, status").single();
    expect(error).toBeNull();
    expect(milestone!.status).toBe("planned");
    const { data: task } = await team.client.from("scale_tasks").insert({ title: `Finaliser l'ICP ${run}`, milestone_id: milestone!.id }).select("id, status, priority").single();
    expect(task).toMatchObject({ status: "todo", priority: "medium" });
    const { data: doc } = await team.client.from("scale_documents").insert({ title: `ICP ${run}`, category_id: category!.id, tags: ["cible"] }).select("id").single();
    expect((await team.client.from("scale_task_documents").insert({ task_id: task!.id, document_id: doc!.id })).error).toBeNull();
    expect((await team.client.from("scale_milestone_documents").insert({ milestone_id: milestone!.id, document_id: doc!.id })).error).toBeNull();
    // Deleting a document leaves the task and the milestone, without the link.
    await team.client.from("scale_documents").delete().eq("id", doc!.id);
    expect(await sql("select count(*)::int as n from public.scale_task_documents where task_id = $1", [task!.id])).toEqual([{ n: 0 }]);
    expect(await sql("select count(*)::int as n from public.scale_tasks where id = $1", [task!.id])).toEqual([{ n: 1 }]);
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
    expect((await owner.client.from("scale_tasks").insert({ title: "Intrusion" })).error).not.toBeNull();
    expect((await owner.client.from("scale_documents").insert({ title: "Intrusion" })).error).not.toBeNull();
    expect((await owner.client.from("scale_categories").insert({ name: "Intrusion" })).error).not.toBeNull();
    const [{ id }] = await sql<{ id: string }>("select id from public.scale_categories where key = 'product'");
    await owner.client.from("scale_categories").update({ name: "Modifié" }).eq("id", id);
    await owner.client.from("scale_categories").delete().eq("id", id);
    expect(await sql("select name from public.scale_categories where id = $1", [id])).toEqual([{ name: null }]);
  });

  it("keep three statuses and three priorities; the old Scale values are refused", async () => {
    expect((await team.client.from("scale_tasks").insert({ title: "x", status: "triage" })).error).not.toBeNull();
    expect((await team.client.from("scale_tasks").insert({ title: "x", status: "blocked" })).error).not.toBeNull();
    expect((await team.client.from("scale_tasks").insert({ title: "x", priority: "urgent" })).error).not.toBeNull();
    expect((await team.client.from("scale_tasks").insert({ title: "x", priority: "none" })).error).not.toBeNull();
    expect((await team.client.from("scale_milestones").insert({ title: "x", status: "late" })).error).not.toBeNull();
    expect((await team.client.from("scale_documents").insert({ title: "x", tags: ["a".repeat(41)] })).error).not.toBeNull();
    expect((await team.client.from("scale_categories").insert({ key: "unknown", name: "x" })).error).not.toBeNull();
    expect((await team.client.from("scale_categories").insert({ icon: "folder" })).error).not.toBeNull(); // a name or a key
  });
});

describe("documents", () => {
  it("are searchable by title, text and tags, forgiving a typo; never for a customer", async () => {
    const content = [
      { id: "a", type: "h2", text: "Notre cible" },
      { id: "b", type: "p", text: `Les agences de communication de 10 à 25 personnes ${run}.` },
      { id: "c", type: "toggle", text: "Détails", body: "Elles réexpliquent souvent le contexte client." },
    ];
    const { data: doc } = await team.client.from("scale_documents").insert({ title: `Ideal Customer Profile ${run}`, content, tags: ["persona"] }).select("id, body_text").single();
    expect(doc!.body_text).toContain("agences de communication");
    expect(doc!.body_text).toContain("réexpliquent");
    const ids = async (q: string, user = team) => ((await user.client.rpc("studio_search_documents", { p_query: q })).data ?? []).map((r: { id: string }) => r.id);
    expect(await ids(`Customer Profile ${run}`)).toContain(doc!.id);
    expect(await ids(`communication de 10 à 25 personnes ${run}`)).toContain(doc!.id);
    expect(await ids("reexpliquent")).toContain(doc!.id); // accents ignored
    expect(await ids("comunication")).toContain(doc!.id); // a typo
    expect(await ids("persona")).toContain(doc!.id);
    expect(await ids("communication", owner)).toEqual([]);
  });

  it("know which documents link to them", async () => {
    const { data: target } = await team.client.from("scale_documents").insert({ title: `Pricing ${run}` }).select("id").single();
    const { data: source } = await team.client.from("scale_documents").insert({ title: `GTM ${run}`, content: [{ id: "a", type: "p", text: `Voir [[doc:${target!.id}]]` }] }).select("id, body_text").single();
    expect(source!.body_text).not.toContain("[[doc:");
    const { data } = await team.client.rpc("studio_document_mentions", { p_document: target!.id });
    expect(data).toEqual([{ id: source!.id, title: `GTM ${run}` }]);
    expect((await owner.client.rpc("studio_document_mentions", { p_document: target!.id })).data ?? []).toEqual([]);
  });

  it("remember who opened them, for that person only", async () => {
    const { data: doc } = await team.client.from("scale_documents").insert({ title: `Ouvert ${run}` }).select("id").single();
    expect((await team.client.from("scale_document_visits").upsert({ user_id: team.id, document_id: doc!.id })).error).toBeNull();
    expect((await colleague.client.from("scale_document_visits").select("document_id").eq("document_id", doc!.id)).data).toEqual([]);
    // Nobody records an opening in someone else's name.
    expect((await colleague.client.from("scale_document_visits").insert({ user_id: team.id, document_id: doc!.id })).error).not.toBeNull();
  });

  it("keep their images in a private bucket our team reads, and nobody else", async () => {
    const { data: doc } = await team.client.from("scale_documents").insert({ title: `Images ${run}` }).select("id").single();
    const path = `doc/${doc!.id}/${crypto.randomUUID()}.png`;
    expect((await team.client.storage.from("scale-files").upload(path, new Blob(["png"]), { contentType: "image/png" })).error).toBeNull();
    expect((await team.client.storage.from("scale-files").createSignedUrl(path, 60)).error).toBeNull();
    expect((await owner.client.storage.from("scale-files").createSignedUrl(path, 60)).error).not.toBeNull();
  });
});
