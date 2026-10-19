import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createClientRecord, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { retrievePassages } from "@/modules/memory/server/retrieval";

/**
 * Step 3 hard rule (CLAUDE.md §4.2): a user must never obtain content from a memory they cannot access,
 * directly or through the AI. Real users and JWTs, through the public API.
 * Company A: Owner, Olivier (assigned to restricted Client A), Nathalie (no access to Client A),
 * Paul (Admin with the "permissions" scope only), Fanny (member, later in a "Finance" group).
 */
let owner: TestUser, olivier: TestUser, nathalie: TestUser, paul: TestUser, fanny: TestUser, ownerB: TestUser, platform: TestUser;
let company: string, companyB: string, clientA: string, clientOpen: string;
let companySpace: string, clientASpace: string, clientOpenSpace: string;
let entryA: string, documentA: string;

const spaceOf = async (clientId: string | null, companyId: string) =>
  (await sql<{ id: string }>(
    clientId ? "select id from public.memory_spaces where client_id = $1" : "select id from public.memory_spaces where company_id = $1 and kind = 'company'",
    [clientId ?? companyId],
  ))[0].id;

beforeAll(async () => {
  [owner, olivier, nathalie, paul, fanny, ownerB, platform] = await Promise.all([
    createUser("mem-owner", "Owner"),
    createUser("mem-olivier", "Olivier"),
    createUser("mem-nathalie", "Nathalie"),
    createUser("mem-paul", "Paul"),
    createUser("mem-fanny", "Fanny"),
    createUser("mem-owner-b", "Owner B"),
    createUser("mem-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  company = await createCompany(owner, "Memory Co");
  companyB = await createCompany(ownerB, "Memory Co B");
  await addMember(owner, company, olivier);
  await addMember(owner, company, nathalie);
  await addMember(owner, company, paul, "admin", ["permissions"]);
  await addMember(owner, company, fanny);
  clientA = await createClientRecord(owner, company, "Client A", "restricted");
  clientOpen = await createClientRecord(owner, company, "Client Open", "open");
  await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
  companySpace = await spaceOf(null, company);
  clientASpace = await spaceOf(clientA, company);
  clientOpenSpace = await spaceOf(clientOpen, company);

  const entry = await olivier.client
    .from("memory_entries")
    .insert({ space_id: clientASpace, title: "Délai de paiement", content: "Le Client A paie ses factures à 45 jours fin de mois." })
    .select("id, company_id, author_id")
    .single();
  if (entry.error) throw entry.error;
  entryA = entry.data.id;

  const path = `${clientASpace}/contrat.txt`;
  const upload = await olivier.client.storage.from("memory-documents").upload(path, new Blob(["Contrat Client A : pénalités de retard 3 %."]), { contentType: "text/plain" });
  if (upload.error) throw upload.error;
  const doc = await olivier.client
    .from("documents")
    .insert({ space_id: clientASpace, filename: "contrat.txt", mime_type: "text/plain", size_bytes: 42, storage_path: path })
    .select("id")
    .single();
  if (doc.error) throw doc.error;
  documentA = doc.data.id;
  const chunk = await olivier.client.from("document_chunks").insert({
    document_id: documentA,
    space_id: clientASpace,
    chunk_index: 0,
    content: "Contrat Client A : pénalités de retard 3 %.",
    char_start: 0,
    char_end: 42,
  });
  if (chunk.error) throw chunk.error;
  await olivier.client.from("documents").update({ status: "ready", extracted_text: "Contrat Client A : pénalités de retard 3 %.", chunk_count: 1 }).eq("id", documentA);
});

const rights = async (user: TestUser) => {
  const { data, error } = await user.client.rpc("my_memory_spaces", { p_company: company });
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.space_id, s.can_write]));
};

describe("default rights", () => {
  it("creates one company memory and one memory per client, with the two automatic groups", async () => {
    const spaces = await sql<{ kind: string }>("select kind from public.memory_spaces where company_id = $1 order by kind", [company]);
    expect(spaces.map((s) => s.kind)).toEqual(["company", "client", "client"]);
    const groups = await sql<{ system_key: string }>("select system_key from public.permission_categories where company_id = $1 order by system_key", [company]);
    expect(groups.map((g) => g.system_key)).toEqual(["everyone", "management"]);
  });

  it("company memory: everyone reads, the Owner and Admins write", async () => {
    expect((await rights(nathalie)).get(companySpace)).toBe(false);
    expect((await rights(paul)).get(companySpace)).toBe(true);
    expect((await rights(owner)).get(companySpace)).toBe(true);
  });

  it("client memory: only people with access to the client (the Owner always)", async () => {
    expect((await rights(olivier)).get(clientASpace)).toBe(true);
    expect((await rights(owner)).get(clientASpace)).toBe(true);
    expect((await rights(nathalie)).has(clientASpace)).toBe(false);
    expect((await rights(paul)).has(clientASpace)).toBe(false);
    expect((await rights(nathalie)).get(clientOpenSpace)).toBe(true);
  });
});

describe("no access to a memory one cannot read, by any route", () => {
  it("hides entries, documents, passages and spaces of Client A from Nathalie and from another company", async () => {
    for (const other of [nathalie, paul, ownerB]) {
      expect((await other.client.from("memory_entries").select("id").eq("space_id", clientASpace)).data).toEqual([]);
      expect((await other.client.from("documents").select("id").eq("id", documentA)).data).toEqual([]);
      expect((await other.client.from("document_chunks").select("id").eq("document_id", documentA)).data).toEqual([]);
    }
    expect((await nathalie.client.from("memory_spaces").select("id").eq("id", clientASpace)).data).toEqual([]);
    expect((await ownerB.client.from("memory_spaces").select("id").eq("id", clientASpace)).data).toEqual([]);
    // The permissions scope sees that the memory exists (to manage access), never what it contains.
    expect((await paul.client.from("memory_spaces").select("id").eq("id", clientASpace)).data).toHaveLength(1);
  });

  it("returns nothing from the search, even when the forbidden memory is passed explicitly", async () => {
    const asOlivier = await olivier.client.rpc("match_memory", { p_space_ids: [clientASpace], p_keywords: "paiement or penalites" });
    expect((asOlivier.data ?? []).length).toBe(2);
    for (const other of [nathalie, paul, ownerB]) {
      const { data } = await other.client.rpc("match_memory", { p_space_ids: [clientASpace, companySpace], p_keywords: "paiement or penalites or client" });
      expect((data ?? []).filter((r) => r.space_id === clientASpace)).toEqual([]);
    }
  });

  it("refuses the original file in storage", async () => {
    expect((await olivier.client.storage.from("memory-documents").download(`${clientASpace}/contrat.txt`)).error).toBeNull();
    for (const other of [nathalie, ownerB, platform]) {
      expect((await other.client.storage.from("memory-documents").download(`${clientASpace}/contrat.txt`)).data).toBeNull();
    }
  });

  it("refuses writing, editing or deleting in a memory one cannot write", async () => {
    expect((await nathalie.client.from("memory_entries").insert({ space_id: clientASpace, title: "x", content: "y" })).error).not.toBeNull();
    expect((await nathalie.client.from("memory_entries").insert({ space_id: companySpace, title: "x", content: "y" })).error).not.toBeNull();
    await nathalie.client.from("memory_entries").update({ content: "hacked" }).eq("id", entryA);
    await nathalie.client.from("memory_entries").delete().eq("id", entryA);
    const [row] = await sql<{ content: string }>("select content from public.memory_entries where id = $1", [entryA]);
    expect(row.content).toContain("45 jours");
    expect((await nathalie.client.storage.from("memory-documents").upload(`${clientASpace}/intrus.txt`, new Blob(["x"]))).error).not.toBeNull();
  });

  it("does not let a user claim an entry was written by someone else or approved from an AI suggestion", async () => {
    const forgedAuthor = await olivier.client.from("memory_entries").insert({ space_id: clientASpace, title: "x", content: "y", author_id: owner.id } as never);
    expect(forgedAuthor.error).not.toBeNull();
    const forgedSource = await olivier.client.from("memory_entries").insert({ space_id: clientASpace, title: "x", content: "y", source_type: "promotion" });
    expect(forgedSource.error).not.toBeNull();
  });

  it("removes access when the person loses access to the client", async () => {
    await owner.client.from("client_assignments").delete().eq("client_id", clientA).eq("user_id", olivier.id);
    expect((await olivier.client.from("memory_entries").select("id").eq("id", entryA)).data).toEqual([]);
    expect((await olivier.client.rpc("match_memory", { p_space_ids: [clientASpace], p_keywords: "paiement" })).data).toEqual([]);
    await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
    expect((await olivier.client.from("memory_entries").select("id").eq("id", entryA)).data).toHaveLength(1);
  });
});

describe("Source Proof", () => {
  let conversation: string, message: string;

  beforeAll(async () => {
    const conv = await olivier.client.from("conversations").insert({ company_id: company }).select("id").single();
    conversation = conv.data!.id;
    await olivier.client.from("messages").insert({ conversation_id: conversation, content: "Délai de paiement du Client A ?" });
    const answer = await serviceClient()
      .from("messages")
      .insert({ conversation_id: conversation, author_type: "assistant", content: "45 jours [S1].", provider: "openai", model_id: "gpt-6-luna" })
      .select("id")
      .single();
    message = answer.data!.id;
    const source = await serviceClient().from("message_sources").insert({
      message_id: message,
      conversation_id: conversation,
      position: 1,
      source_type: "memory_entry",
      space_id: clientASpace,
      entry_id: entryA,
      title: "Délai de paiement",
      excerpt: "Le Client A paie ses factures à 45 jours fin de mois.",
    });
    if (source.error) throw source.error;
  });

  it("cannot be forged by users", async () => {
    const forged = await olivier.client.from("message_sources").insert({
      message_id: message,
      conversation_id: conversation,
      position: 2,
      source_type: "memory_entry",
      title: "Faux",
      excerpt: "Inventé",
    } as never);
    expect(forged.error).not.toBeNull();
  });

  it("is shown only to participants who can still read the source's memory", async () => {
    expect((await olivier.client.from("message_sources").select("excerpt").eq("message_id", message)).data).toHaveLength(1);
    expect((await nathalie.client.from("message_sources").select("excerpt").eq("message_id", message)).data).toEqual([]);
    await owner.client.from("client_assignments").delete().eq("client_id", clientA).eq("user_id", olivier.id);
    // The conversation is not linked to the client, so it stays visible, but the source passage disappears.
    expect((await olivier.client.from("conversations").select("id").eq("id", conversation)).data).toHaveLength(1);
    expect((await olivier.client.from("message_sources").select("excerpt").eq("message_id", message)).data).toEqual([]);
    await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
  });
});

describe("suggestions and promotion to company memory", () => {
  let promotion: string;

  it("lets someone who reads a client memory propose a general learning for the company memory", async () => {
    const { data, error } = await olivier.client
      .from("memory_suggestions")
      .insert({ space_id: companySpace, kind: "promotion", title: "Rapports courts", content: "Les clients préfèrent des rapports courts.", source_space_id: clientASpace, source_ref: { entry_id: entryA } })
      .select("id, proposed_by, status")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ proposed_by: olivier.id, status: "pending" });
    promotion = data!.id;
  });

  it("refuses proposals from a memory one cannot read, and entry suggestions into a memory one cannot write", async () => {
    const promote = await nathalie.client
      .from("memory_suggestions")
      .insert({ space_id: companySpace, kind: "promotion", title: "x", content: "y", source_space_id: clientASpace });
    expect(promote.error).not.toBeNull();
    const suggest = await nathalie.client.from("memory_suggestions").insert({ space_id: companySpace, kind: "new_entry", title: "x", content: "y" });
    expect(suggest.error).not.toBeNull();
  });

  it("is decided only by someone who can write the company memory", async () => {
    expect((await nathalie.client.rpc("decide_memory_suggestion", { p_suggestion: promotion, p_approve: true })).error?.message).toBe("forbidden");
    expect((await olivier.client.rpc("decide_memory_suggestion", { p_suggestion: promotion, p_approve: true })).error?.message).toBe("forbidden");
    const approved = await owner.client.rpc("decide_memory_suggestion", { p_suggestion: promotion, p_approve: true, p_content: "Les clients de ce secteur préfèrent des rapports courts." });
    expect(approved.error).toBeNull();
    const [entry] = await sql<{ source_type: string; author_id: string; content: string; space_id: string }>(
      "select source_type, author_id, content, space_id from public.memory_entries where id = $1",
      [approved.data],
    );
    expect(entry).toMatchObject({ source_type: "promotion", author_id: owner.id, space_id: companySpace });
    expect(entry.content).toContain("rapports courts");
    expect((await owner.client.rpc("decide_memory_suggestion", { p_suggestion: promotion, p_approve: false })).error?.message).toBe("already_decided");
  });

  it("hides pending suggestions from people who neither wrote them nor can decide", async () => {
    const pending = await olivier.client
      .from("memory_suggestions")
      .insert({ space_id: companySpace, kind: "promotion", title: "Autre", content: "Autre enseignement.", source_space_id: clientASpace })
      .select("id")
      .single();
    expect((await nathalie.client.from("memory_suggestions").select("id").eq("id", pending.data!.id)).data).toEqual([]);
    expect((await owner.client.from("memory_suggestions").select("id").eq("id", pending.data!.id)).data).toHaveLength(1);
  });
});

describe("permission categories", () => {
  let finance: string;

  it("can be managed only with the permissions scope", async () => {
    const refused = await nathalie.client.rpc("admin_save_category", { p_company: company, p_category: null as never, p_name: "Hackers", p_description: "", p_members: [nathalie.id] });
    expect(refused.error?.message).toBe("forbidden");
    expect((await ownerB.client.rpc("admin_save_category", { p_company: company, p_category: null as never, p_name: "B", p_description: "", p_members: [] })).error?.message).toBe("forbidden");
    const { data, error } = await paul.client.rpc("admin_save_category", { p_company: company, p_category: null as never, p_name: "Finance", p_description: "Comptabilité", p_members: [fanny.id] });
    expect(error).toBeNull();
    finance = data!;
  });

  it("grants write access to a group", async () => {
    const everyone = (await sql<{ id: string }>("select id from public.permission_categories where company_id = $1 and system_key = 'everyone'", [company]))[0].id;
    const management = (await sql<{ id: string }>("select id from public.permission_categories where company_id = $1 and system_key = 'management'", [company]))[0].id;
    expect((await fanny.client.from("memory_entries").insert({ space_id: companySpace, title: "Note", content: "Clôture le 5." })).error).not.toBeNull();
    const set = await paul.client.rpc("admin_set_space_grants", { p_space: companySpace, p_read: [everyone], p_write: [management, finance] });
    expect(set.error).toBeNull();
    expect((await fanny.client.from("memory_entries").insert({ space_id: companySpace, title: "Note", content: "Clôture le 5." })).error).toBeNull();
    expect((await nathalie.client.from("memory_entries").insert({ space_id: companySpace, title: "Note", content: "x" })).error).not.toBeNull();
  });

  it("restricts reading a client memory to a group, on top of client access", async () => {
    expect((await rights(nathalie)).has(clientOpenSpace)).toBe(true);
    expect((await paul.client.rpc("admin_set_space_grants", { p_space: clientOpenSpace, p_read: [finance], p_write: [finance] })).error).toBeNull();
    expect((await rights(nathalie)).has(clientOpenSpace)).toBe(false);
    expect((await rights(fanny)).get(clientOpenSpace)).toBe(true);
    // The Owner keeps full control.
    expect((await rights(owner)).get(clientOpenSpace)).toBe(true);
  });

  it("keeps the automatic groups", async () => {
    const everyone = (await sql<{ id: string }>("select id from public.permission_categories where company_id = $1 and system_key = 'everyone'", [company]))[0].id;
    expect((await paul.client.rpc("admin_delete_category", { p_company: company, p_category: everyone })).error?.message).toBe("system_category");
    expect((await paul.client.rpc("admin_save_category", { p_company: company, p_category: everyone, p_name: "Moi", p_description: "", p_members: [] })).error?.message).toBe("system_category");
  });

  it("refuses grants on another company's memory", async () => {
    const otherSpace = await spaceOf(null, companyB);
    expect((await paul.client.rpc("admin_set_space_grants", { p_space: otherSpace, p_read: [finance], p_write: [] })).error?.message).toBe("forbidden");
  });
});

describe("through the AI: the passages given to the model", () => {
  beforeAll(() => {
    // Simulated embeddings (no real AI call); usage rows are written like in production.
    process.env.AI_FAKE_PROVIDER = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TEST_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = process.env.TEST_SUPABASE_SECRET_KEY;
  });
  const asMember = (user: TestUser) => ({ user: { id: user.id, email: user.email }, active: { companyId: company } }) as unknown as MemberContext;
  const question = "Quel est le délai de paiement et les pénalités du Client A ?";

  it("gives Olivier the Client A passages, numbered for citation", async () => {
    const passages = await retrievePassages(olivier.client as unknown as UserClient, asMember(olivier), { clientId: clientA, query: question });
    expect(passages.filter((p) => p.spaceId === clientASpace).length).toBeGreaterThan(0);
    expect(passages.map((p) => p.position)).toEqual(passages.map((_, i) => i + 1));
    expect(passages.find((p) => p.spaceId === clientASpace)?.clientName).toBe("Client A");
  });

  it("compares meanings only with vectors from the embeddings model in use", async () => {
    const vector = `[${Array.from({ length: 1536 }, () => "0.1").join(",")}]`;
    const entry = await owner.client.from("memory_entries").insert({ space_id: companySpace, title: "Vecteur", content: "Texte sans mot commun" }).select("id").single();
    if (entry.error) throw entry.error;
    await owner.client.from("memory_entries").update({ embedding: vector, embedding_model: "model-a" }).eq("id", entry.data.id);
    const search = (model: string) =>
      owner.client.rpc("match_memory", { p_space_ids: [companySpace], p_keywords: "introuvable", p_embedding: vector, p_embedding_model: model });
    expect((await search("model-a")).data?.map((r) => r.id)).toContain(entry.data.id);
    expect((await search("model-b")).data?.map((r) => r.id)).not.toContain(entry.data.id);
    await owner.client.from("memory_entries").delete().eq("id", entry.data.id);
  });

  it("gives Nathalie nothing from Client A, even if her request names the client", async () => {
    for (const clientId of [null, clientA]) {
      const passages = await retrievePassages(nathalie.client as unknown as UserClient, asMember(nathalie), { clientId, query: question });
      expect(passages.filter((p) => p.spaceId === clientASpace)).toEqual([]);
      expect(JSON.stringify(passages)).not.toContain("45 jours");
      expect(JSON.stringify(passages)).not.toContain("3 %");
    }
  });
});

describe("platform admin: no memory content", () => {
  const TABLES = [
    "memory_spaces",
    "permission_categories",
    "permission_category_members",
    "memory_space_grants",
    "memory_entries",
    "documents",
    "document_chunks",
    "memory_suggestions",
    "message_sources",
  ] as const;

  it.each(TABLES)("reads zero rows from %s", async (table) => {
    const { data } = await platform.client.from(table).select("*").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("cannot search memories nor list them", async () => {
    expect((await platform.client.rpc("match_memory", { p_space_ids: [clientASpace, companySpace], p_keywords: "paiement" })).data ?? []).toEqual([]);
    expect((await platform.client.rpc("my_memory_spaces", { p_company: company })).data ?? []).toEqual([]);
  });
});
