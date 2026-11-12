import { beforeAll, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { addMember, createClientRecord, createCompany, createUser, makePlatformAdmin, sql, type TestUser } from "../helpers/supabase";
import { asFile, chatgptZip } from "../helpers/exports";

/**
 * Knowledge import (CLAUDE.md §12) against the real database, real users and RLS, with the simulated
 * AI provider (its "analysis" picks sentences; see fake.ts). The server actions run as the signed-in
 * person: their session and identity are given to them here instead of the request's cookies.
 *
 * Company "Lumen": Owner; Alice (member) and Bob (member). Clients: Atlas (open), Vega (restricted, Bob).
 * Another company: Eve. Our team: Pat.
 */

vi.stubEnv("AI_FAKE_PROVIDER", "true");
const state = vi.hoisted(() => ({ user: null as null | { id: string; email: string; client: unknown }, company: "", sent: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user!.client }));
vi.mock("@/lib/auth/guards", () => ({
  memberOrNull: async () => (state.user ? { user: { id: state.user.id, email: state.user.email }, active: { companyId: state.company, role: "member", adminScopes: [] }, profile: { fullName: null } } : null),
}));
vi.mock("@/modules/memory/server/ai-tasks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/memory/server/ai-tasks")>();
  return {
    ...real,
    runMemoryTask: async (...args: Parameters<typeof real.runMemoryTask>) => {
      state.sent.push(args[2].user);
      return real.runMemoryTask(...args);
    },
  };
});

const { readExport, exportFingerprint } = await import("@/modules/knowledge-import/archive");
const { startImportAction, analyzeImportBatchAction, finishAnalysisAction, applyImportAction, deleteImportAction } = await import("@/modules/knowledge-import/server/actions");
const { IMPORT_LIMITS } = await import("@/modules/knowledge-import/types");

let owner: TestUser, alice: TestUser, bob: TestUser, eve: TestUser, pat: TestUser;
let company: string, atlasSpace: string, vegaSpace: string, companySpace: string;

const as = (user: TestUser, companyId = company) => {
  state.user = user;
  state.company = companyId;
};

/** The whole import as the browser runs it: read, start, batches, finish. */
async function runImport(user: TestUser, files: File[]) {
  as(user);
  const parsed = await readExport(files, null);
  const start = await startImportAction({ source: parsed.source, fileName: files.map((f) => f.name).join(", "), fingerprint: exportFingerprint(parsed, files.map((f) => f.name)), found: parsed.items.length, selected: parsed.items.length });
  if (!start.ok) throw new Error(start.error);
  const queue = parsed.items.filter((i) => !start.data!.processed.includes(i.ref));
  for (let i = 0; i < queue.length; i += IMPORT_LIMITS.batch) {
    const result = await analyzeImportBatchAction({ importId: start.data!.importId, items: queue.slice(i, i + IMPORT_LIMITS.batch) });
    if (!result.ok) throw new Error(result.error);
  }
  await finishAnalysisAction({ importId: start.data!.importId });
  return start.data!.importId;
}

const items = (importId: string) =>
  sql<{ id: string; category: string; level: string; target_hint: string | null; title: string; content: string; sensitive: boolean; status: string }>(
    "select id, category, level, target_hint, title, content, sensitive, status from public.knowledge_import_items where import_id = $1 order by created_at",
    [importId],
  );

let firstImport: string;

beforeAll(async () => {
  [owner, alice, bob, eve, pat] = await Promise.all([createUser("ki-owner", "Owner"), createUser("ki-alice", "Alice Martin"), createUser("ki-bob", "Bob"), createUser("ki-eve", "Eve"), createUser("ki-pat", "Pat")]);
  company = await createCompany(owner, "Lumen");
  await createCompany(eve, "Ailleurs");
  for (const u of [alice, bob]) await addMember(owner, company, u);
  await makePlatformAdmin(pat);
  const atlas = await createClientRecord(owner, company, "Atlas", "restricted");
  const vega = await createClientRecord(owner, company, "Vega", "restricted");
  for (const [client, user] of [
    [atlas, alice],
    [vega, bob],
  ] as const) {
    const { error } = await owner.client.from("client_assignments").insert({ client_id: client, company_id: company, user_id: user.id });
    if (error) throw error;
  }
  const spaces = await sql<{ id: string; kind: string; client_id: string | null }>("select id, kind, client_id from public.memory_spaces where company_id = $1", [company]);
  atlasSpace = spaces.find((s) => s.client_id === atlas)!.id;
  vegaSpace = spaces.find((s) => s.client_id === vega)!.id;
  companySpace = spaces.find((s) => s.kind === "company")!.id;
  firstImport = await runImport(alice, [asFile(chatgptZip(), "chatgpt-export.zip")]);
});

describe("privacy, end to end", () => {
  it("never sends private conversations, private passages or secrets to the AI, and masks client names", () => {
    const sent = state.sent.join("\n");
    expect(sent).toContain("devis est relu par un associé");
    for (const secret of ["médecin", "anxiété", "grossesse", "copain", "relation amoureuse", "Sup3rS3cret", "salaire", "crédit immobilier"]) expect(sent).not.toContain(secret);
    expect(sent).not.toMatch(/\bAtlas\b/);
    expect(sent).toMatch(/\[CLIENT_1\]/);
  });

  it("stores only proposals, none of them private, with counts of what was left out", async () => {
    const proposals = await items(firstImport);
    const all = proposals.map((p) => `${p.title} ${p.content}`).join("\n");
    expect(all).toContain("chaque devis est relu par un associé");
    expect(all).not.toMatch(/médecin|anxiété|copain|Sup3rS3cret|salaire/);
    // The client's real name is back for the person's review.
    expect(proposals.find((p) => p.level === "client")).toMatchObject({ target_hint: "Atlas" });
    expect(proposals.find((p) => p.category === "preference")).toMatchObject({ level: "personal" });
    const [run] = await sql<{ status: string; excluded_private: number; analyzed: number; proposed: number }>("select status, excluded_private, analyzed, proposed from public.knowledge_imports where id = $1", [firstImport]);
    expect(run).toMatchObject({ status: "review", analyzed: 5, proposed: proposals.length });
    expect(run.excluded_private).toBeGreaterThanOrEqual(2);
  });

  it("keeps a doubtful proposal apart, unticked by default (sensitive)", async () => {
    const zip = zipSync({ "notes/equipe.md": strToU8("# Organisation\n\nL'équipe se réunit chaque lundi pour planifier la semaine. [[doubtful]]") });
    const id = await runImport(alice, [asFile(zip, "notes.zip")]);
    const proposals = await items(id);
    expect(proposals.some((p) => p.sensitive)).toBe(true);
    expect(proposals.filter((p) => !p.sensitive).map((p) => p.content).join()).toContain("réunit chaque lundi");
  });
});

describe("an import belongs to its person only", () => {
  it("is invisible to colleagues, the Owner, another company and our team", async () => {
    for (const user of [bob, owner, eve, pat]) {
      expect((await user.client.from("knowledge_imports").select("id").eq("id", firstImport)).data).toEqual([]);
      expect((await user.client.from("knowledge_import_items").select("id").eq("import_id", firstImport)).data).toEqual([]);
    }
    expect((await alice.client.from("knowledge_imports").select("id").eq("id", firstImport)).data).toHaveLength(1);
  });

  it("cannot be written into by someone else, nor through someone else's actions", async () => {
    const { error } = await bob.client.from("knowledge_import_items").insert({
      import_id: firstImport,
      company_id: company,
      category: "professional",
      level: "company",
      title: "x",
      content: "planted",
      content_hash: "0123456789abcdef",
    });
    expect(error).not.toBeNull();
    as(bob);
    expect(await analyzeImportBatchAction({ importId: firstImport, items: [{ ref: "abcdef12", kind: "conversation", title: "x", date: null, text: "Une règle de travail plantée dans l'import d'une collègue, à ignorer." }] })).toMatchObject({ ok: false, error: "not_found" });
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.knowledge_import_items where content like '%planted%' or content like '%plantée%'");
    expect(n).toBe(0);
  });
});

describe("review: saving where the person chose, within their rights", () => {
  it("saves a preference privately and facts in the client's memory; deletes what is refused", async () => {
    const proposals = await items(firstImport);
    const preference = proposals.find((p) => p.category === "preference")!;
    const rule = proposals.find((p) => p.content.includes("devis est relu"))!;
    const client = proposals.find((p) => p.level === "client")!;
    const refused = proposals.filter((p) => ![preference.id, rule.id, client.id].includes(p.id));
    as(alice);
    const result = await applyImportAction({
      importId: firstImport,
      decisions: [
        { itemId: preference.id, accept: true, destination: "personal", title: preference.title, content: preference.content },
        { itemId: rule.id, accept: true, destination: atlasSpace, title: "Relecture des devis", content: rule.content },
        { itemId: client.id, accept: true, destination: atlasSpace, title: client.title, content: client.content },
        ...refused.map((p) => ({ itemId: p.id, accept: false, destination: "personal", title: p.title, content: p.content })),
      ],
    });
    expect(result).toMatchObject({ ok: true, data: { saved: 3, failed: 0 } });

    const notes = (await alice.client.from("personal_memory").select("content")).data!.map((n) => n.content);
    expect(notes.some((n) => n.includes("Je préfère des réponses courtes"))).toBe(true);
    // The Owner sees the shared entry with its origin; Bob sees neither Alice's note nor the restricted client.
    const entry = (await owner.client.from("memory_entries").select("title, source_type, author_id").eq("space_id", atlasSpace).eq("title", "Relecture des devis")).data;
    expect(entry).toEqual([{ title: "Relecture des devis", source_type: "import", author_id: alice.id }]);
    expect((await bob.client.from("personal_memory").select("id").eq("user_id", alice.id)).data).toEqual([]);
    expect((await bob.client.from("memory_entries").select("id").eq("space_id", atlasSpace)).data).toEqual([]);
    expect((await alice.client.from("memory_entries").select("id").eq("space_id", atlasSpace).eq("source_type", "import")).data).toHaveLength(2);

    const left = await items(firstImport);
    expect(left.every((p) => p.status === "saved")).toBe(true);
    expect(left).toHaveLength(3);
    const [run] = await sql<{ status: string; saved: number }>("select status, saved from public.knowledge_imports where id = $1", [firstImport]);
    expect(run).toEqual({ status: "done", saved: 3 });
  });

  it("refuses to save into a memory the person cannot write in (a client they cannot open, the company memory without the right)", async () => {
    const zip = zipSync({ "n.md": strToU8("# Achats\n\nNotre process d'achat impose trois devis comparatifs au-delà de 5 000 euros. Les fournisseurs sont payés à 45 jours.") });
    const id = await runImport(alice, [asFile(zip, "achats.zip")]);
    const [p, q] = await items(id);
    as(alice);
    const result = await applyImportAction({
      importId: id,
      decisions: [
        { itemId: p.id, accept: true, destination: vegaSpace, title: p.title, content: p.content },
        { itemId: q.id, accept: true, destination: companySpace, title: q.title, content: q.content },
      ],
    });
    expect(result).toMatchObject({ ok: true, data: { saved: 0, failed: 2 } });
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.memory_entries where space_id = any($1) and source_type = 'import'", [[vegaSpace, companySpace]]);
    expect(n).toBe(0);
  });

  it("recognises what is already known: the same export again proposes nothing new", async () => {
    const again = await runImport(alice, [asFile(chatgptZip(), "chatgpt-export-2.zip")]);
    const [run] = await sql<{ proposed: number; duplicates: number; status: string }>("select proposed, duplicates, status from public.knowledge_imports where id = $1", [again]);
    expect(run.duplicates).toBeGreaterThan(0);
    const fresh = await items(again);
    expect(fresh.map((p) => p.content).join()).not.toContain("devis est relu");
  });

  it("resumes an unfinished import of the same export instead of starting over", async () => {
    as(alice);
    const zip = zipSync({ "a.md": strToU8("# Qualité\n\nChaque livrable est relu par une deuxième personne avant l'envoi au client."), "b.md": strToU8("# Ventes\n\nLes propositions commerciales sont envoyées sous 48 heures après le rendez-vous.") });
    const files = [asFile(zip, "notes-resume.zip")];
    const parsed = await readExport(files, "files");
    const fingerprint = exportFingerprint(parsed, ["notes-resume.zip"]);
    const first = await startImportAction({ source: parsed.source, fileName: "notes-resume.zip", fingerprint, found: 2, selected: 2 });
    if (!first.ok) throw new Error(first.error);
    await analyzeImportBatchAction({ importId: first.data!.importId, items: parsed.items.slice(0, 1) });
    const second = await startImportAction({ source: parsed.source, fileName: "notes-resume.zip", fingerprint, found: 2, selected: 2 });
    expect(second).toMatchObject({ ok: true, data: { importId: first.data!.importId, resumed: true, processed: [parsed.items[0].ref] } });
  });

  it("deletes an import and, if asked, what it added", async () => {
    as(alice);
    const result = await deleteImportAction({ importId: firstImport, removeSaved: true });
    expect(result).toMatchObject({ ok: true, data: { removed: 3 } });
    expect((await alice.client.from("memory_entries").select("id").eq("source_type", "import").eq("title", "Relecture des devis")).data).toEqual([]);
    expect((await alice.client.from("knowledge_imports").select("id").eq("id", firstImport)).data).toEqual([]);
  });
});
