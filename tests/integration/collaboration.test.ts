import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createClientRecord, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import { retrievePassages } from "@/modules/memory/server/retrieval";

/**
 * Step 5 (CLAUDE.md §4.4): group conversations, history on join, the AI's shared context,
 * transfers and Smart Handover. Real users and JWTs, through the public API.
 * Company: Owner, Olivier (assigned to restricted Client A), Nathalie (finance, no Client A access),
 * Paul and Fanny (members). Another company's owner and a platform admin must see nothing.
 */
let owner: TestUser, olivier: TestUser, nathalie: TestUser, paul: TestUser, fanny: TestUser, ownerB: TestUser, platform: TestUser;
let company: string, clientA: string, clientOpen: string;
let companySpace: string, clientASpace: string;

const spaceOf = async (clientId: string | null) =>
  (await sql<{ id: string }>(
    clientId ? "select id from public.memory_spaces where client_id = $1" : "select id from public.memory_spaces where company_id = $1 and kind = 'company'",
    [clientId ?? company],
  ))[0].id;

const newConversation = async (user: TestUser, clientId: string | null = null) => {
  const { data, error } = await user.client.from("conversations").insert({ company_id: company, client_id: clientId }).select("id").single();
  if (error) throw error;
  return data.id;
};

const post = async (user: TestUser, conversationId: string, content: string) => {
  const { data, error } = await user.client.from("messages").insert({ conversation_id: conversationId, content }).select("id, seq").single();
  if (error) throw error;
  return data;
};

const visibleContents = async (user: TestUser, conversationId: string) =>
  ((await user.client.from("messages").select("content").eq("conversation_id", conversationId).order("seq")).data ?? []).map((m) => m.content);

beforeAll(async () => {
  [owner, olivier, nathalie, paul, fanny, ownerB, platform] = await Promise.all([
    createUser("collab-owner", "Owner"),
    createUser("collab-olivier", "Olivier Martin"),
    createUser("collab-nathalie", "Nathalie Durand"),
    createUser("collab-paul", "Paul"),
    createUser("collab-fanny", "Fanny"),
    createUser("collab-owner-b", "Owner B"),
    createUser("collab-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  company = await createCompany(owner, "Collab Co");
  await createCompany(ownerB, "Collab Co B");
  await addMember(owner, company, olivier);
  await addMember(owner, company, nathalie, "member", [], ["finance"]);
  await addMember(owner, company, paul);
  await addMember(owner, company, fanny);
  clientA = await createClientRecord(owner, company, "Client A", "restricted");
  clientOpen = await createClientRecord(owner, company, "Client Open", "open");
  await owner.client.from("client_assignments").insert({ client_id: clientA, company_id: company, user_id: olivier.id });
  companySpace = await spaceOf(null);
  clientASpace = await spaceOf(clientA);
  const entry = await olivier.client.from("memory_entries").insert({ space_id: clientASpace, title: "Budget Client A", content: "Le budget du Client A est de 80 000 euros." });
  if (entry.error) throw entry.error;
  const shared = await owner.client.from("memory_entries").insert({ space_id: companySpace, title: "Budget type", content: "Un budget de mission standard est de 20 000 euros." });
  if (shared.error) throw shared.error;
});

describe("group conversations: history on join", () => {
  let conversation: string, early: { id: string; seq: number }, answer: string, later: { id: string; seq: number };
  const path = () => `${conversation}/early-note.txt`;

  beforeAll(async () => {
    conversation = await newConversation(olivier);
    // Longer than a title (80 characters): the conversation's title never carries the confidential part.
    early = await post(olivier, conversation, "Avant l'arrivée de Nathalie, voici le contexte du dossier que nous suivons depuis janvier : marge cible confidentielle 38 %.");
    // An answer citing a memory, and a file sent with the early message.
    const service = serviceClient();
    const reply = await service
      .from("messages")
      .insert({ conversation_id: conversation, author_type: "assistant", content: "Noté [S1].", provider: "openai", model_id: "gpt-6-luna", status: "complete" })
      .select("id")
      .single();
    if (reply.error) throw reply.error;
    answer = reply.data.id;
    const source = await service.from("message_sources").insert({
      message_id: answer,
      conversation_id: conversation,
      position: 1,
      source_type: "memory_entry",
      space_id: companySpace,
      title: "Budget type",
      excerpt: "Un budget de mission standard est de 20 000 euros.",
    });
    if (source.error) throw source.error;
    const upload = await service.storage.from("chat-attachments").upload(path(), new Blob(["Note confidentielle"]), { contentType: "text/plain" });
    if (upload.error) throw upload.error;
    const file = await service.from("conversation_attachments").insert({
      conversation_id: conversation,
      message_id: early.id,
      uploaded_by: olivier.id,
      filename: "early-note.txt",
      mime_type: "text/plain",
      size_bytes: 19,
      storage_path: path(),
      kind: "document",
      extracted_text: "Note confidentielle",
    });
    if (file.error) throw file.error;
  });

  it("lets a participant add a colleague, who sees only messages from their arrival by default", async () => {
    const { error } = await olivier.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [nathalie.id] });
    expect(error).toBeNull();
    expect(await visibleContents(nathalie, conversation)).toEqual([]);
    later = await post(olivier, conversation, "Nathalie, peux-tu regarder le prévisionnel ?");
    expect(await visibleContents(nathalie, conversation)).toEqual(["Nathalie, peux-tu regarder le prévisionnel ?"]);
    expect(await visibleContents(olivier, conversation)).toHaveLength(3);
    // She can answer in the conversation.
    await post(nathalie, conversation, "Oui, je regarde.");
  });

  it("hides earlier files, cited sources and stored files from the newcomer", async () => {
    expect((await olivier.client.from("conversation_attachments").select("id").eq("conversation_id", conversation)).data).toHaveLength(1);
    expect((await olivier.client.from("message_sources").select("id").eq("conversation_id", conversation)).data).toHaveLength(1);
    expect((await nathalie.client.from("conversation_attachments").select("id, extracted_text").eq("conversation_id", conversation)).data).toEqual([]);
    expect((await nathalie.client.from("message_sources").select("id, excerpt").eq("conversation_id", conversation)).data).toEqual([]);
    expect((await nathalie.client.storage.from("chat-attachments").download(path())).data).toBeNull();
    expect((await nathalie.client.storage.from("chat-attachments").list(conversation)).data ?? []).toEqual([]);
    expect((await olivier.client.storage.from("chat-attachments").download(path())).error).toBeNull();
    // Search only finds what she may see. The title is shared (the "Ajouter" dialog says so).
    const search = await nathalie.client.rpc("search_conversations", { p_company: company, p_query: "confidentielle" });
    expect((search.data ?? []).filter((r) => r.conversation_id === conversation)).toEqual([]);
    expect((await nathalie.client.from("conversations").select("title").eq("id", conversation).single()).data?.title).not.toContain("confidentielle");
  });

  it("lets the inviter share history from a chosen message, never more than they see themselves", async () => {
    expect((await olivier.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [paul.id], p_from_seq: later.seq })).error).toBeNull();
    expect(await visibleContents(paul, conversation)).toEqual(["Nathalie, peux-tu regarder le prévisionnel ?", "Oui, je regarde."]);
    // Nathalie sees from `later` on: she cannot give Fanny anything older.
    const tooFar = await nathalie.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [fanny.id], p_from_seq: early.seq });
    expect(tooFar.error?.message).toBe("validation");
    expect(await visibleContents(fanny, conversation)).toEqual([]);
    // Olivier shares the whole history with Nathalie: the file and the source come with it.
    expect((await olivier.client.rpc("share_conversation_history", { p_conversation: conversation, p_user: nathalie.id, p_from_seq: early.seq })).error).toBeNull();
    expect(await visibleContents(nathalie, conversation)).toHaveLength(4);
    expect((await nathalie.client.from("conversation_attachments").select("id").eq("conversation_id", conversation)).data).toHaveLength(1);
    expect((await nathalie.client.from("message_sources").select("id").eq("conversation_id", conversation)).data).toHaveLength(1);
  });

  it("logs additions with ids only", async () => {
    const log = await sql<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from public.audit_log where target_id = $1 and action like 'conversation.%' order by created_at",
      [conversation],
    );
    expect(log.map((l) => l.action)).toEqual(["conversation.participant_added", "conversation.participant_added", "conversation.history_shared"]);
    expect(JSON.stringify(log)).not.toContain("confidentielle");
    expect(log[0].metadata).toMatchObject({ user_id: nathalie.id, history_shared: false });
  });

  it("refuses outsiders, self-invitations and posts from non-participants", async () => {
    expect((await olivier.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [ownerB.id] })).error?.message).toBe("not_found");
    expect((await fanny.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [fanny.id] })).error?.message).toBe("not_found");
    expect((await ownerB.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [ownerB.id] })).error?.message).toBe("not_found");
    expect((await fanny.client.from("messages").insert({ conversation_id: conversation, content: "intrusion" })).error).not.toBeNull();
    expect((await fanny.client.from("conversation_participants").select("user_id").eq("conversation_id", conversation)).data).toEqual([]);
  });

  it("lets a participant leave (losing access); the person responsible transfers instead", async () => {
    expect((await paul.client.rpc("leave_conversation", { p_conversation: conversation })).error).toBeNull();
    expect(await visibleContents(paul, conversation)).toEqual([]);
    expect((await olivier.client.rpc("leave_conversation", { p_conversation: conversation })).error?.message).toBe("owner_must_transfer");
  });

  it("never links a group conversation to a client one of its participants cannot access", async () => {
    const linked = await olivier.client.from("conversations").update({ client_id: clientA }).eq("id", conversation);
    expect(linked.error?.message).toBe("no_client_access");
    expect((await sql<{ client_id: string | null }>("select client_id from public.conversations where id = $1", [conversation]))[0].client_id).toBeNull();
    expect((await olivier.client.from("conversations").update({ client_id: clientOpen }).eq("id", conversation)).error).toBeNull();
  });

  it("only takes people with access to the conversation's client", async () => {
    const aboutA = await newConversation(olivier, clientA);
    const refused = await olivier.client.rpc("add_conversation_participants", { p_conversation: aboutA, p_users: [nathalie.id] });
    expect(refused.error?.message).toBe("no_client_access");
    expect((await olivier.client.rpc("add_conversation_participants", { p_conversation: aboutA, p_users: [owner.id] })).error).toBeNull();
  });
});

describe("the AI in a group: only what every participant may access", () => {
  const asMember = (user: TestUser) => ({ user: { id: user.id, email: user.email }, active: { companyId: company } }) as unknown as MemberContext;
  const question = "Quel est le budget du Client A ?";
  let conversation: string;

  beforeAll(async () => {
    process.env.AI_FAKE_PROVIDER = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TEST_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = process.env.TEST_SUPABASE_SECRET_KEY;
    conversation = await newConversation(olivier);
  });

  const shared = async (user: TestUser) => new Set(((await user.client.rpc("conversation_shared_spaces", { p_conversation: conversation })).data ?? []) as string[]);

  it("gives Olivier alone his Client A memory", async () => {
    const spaces = await shared(olivier);
    expect(spaces.has(clientASpace)).toBe(true);
    const passages = await retrievePassages(olivier.client as unknown as UserClient, asMember(olivier), { clientId: null, query: question, restrictTo: spaces });
    expect(JSON.stringify(passages)).toContain("80 000");
  });

  it("leaves Client A out once Nathalie (no access) joins: the intersection of their rights", async () => {
    await olivier.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [nathalie.id] });
    const spaces = await shared(olivier);
    expect(spaces.has(clientASpace)).toBe(false);
    expect(spaces.has(companySpace)).toBe(true);
    const passages = await retrievePassages(olivier.client as unknown as UserClient, asMember(olivier), { clientId: null, query: question, restrictTo: spaces });
    expect(passages.filter((p) => p.spaceId === clientASpace)).toEqual([]);
    expect(JSON.stringify(passages)).not.toContain("80 000");
    expect(JSON.stringify(passages)).toContain("20 000");
  });

  it("tells non-participants nothing", async () => {
    expect((await shared(fanny)).size).toBe(0);
    expect((await shared(ownerB)).size).toBe(0);
  });
});

describe("warning before sharing history that cites a memory", () => {
  let conversation: string, question: { id: string; seq: number }, later: { id: string; seq: number };

  beforeAll(async () => {
    conversation = await newConversation(olivier);
    question = await post(olivier, conversation, "Budget du Client A ?");
    const reply = await serviceClient()
      .from("messages")
      .insert({ conversation_id: conversation, author_type: "assistant", content: "80 000 euros [S1].", provider: "openai", model_id: "gpt-6-luna", status: "complete" })
      .select("id")
      .single();
    if (reply.error) throw reply.error;
    const source = await serviceClient().from("message_sources").insert({
      message_id: reply.data.id,
      conversation_id: conversation,
      position: 1,
      source_type: "memory_entry",
      space_id: clientASpace,
      title: "Budget Client A",
      excerpt: "Le budget du Client A est de 80 000 euros.",
    });
    if (source.error) throw source.error;
    later = await post(olivier, conversation, "Autre sujet.");
  });

  const check = (fromSeq: number, users: TestUser[], as: TestUser = olivier) =>
    as.client.rpc("history_unreadable_sources", { p_conversation: conversation, p_users: users.map((u) => u.id), p_from_seq: fromSeq });

  it("names the memory and the colleagues who cannot read it", async () => {
    const { data, error } = await check(question.seq, [nathalie, owner]);
    expect(error).toBeNull();
    expect(data).toEqual([{ space_id: clientASpace, client_name: "Client A", user_id: nathalie.id }]);
  });

  it("says nothing when the shared part cites no such memory, or to someone outside the conversation", async () => {
    expect((await check(later.seq, [nathalie])).data).toEqual([]);
    expect((await check(question.seq, [ownerB])).data).toEqual([]);
    expect((await check(question.seq, [nathalie], fanny)).data).toEqual([]);
  });
});

describe("transfer a conversation (Smart Handover)", () => {
  let conversation: string;
  const sections = { summary: "Prévisionnel en cours.", decisions: "- Marge cible validée", documents: "", tasks: "- Finir le tableau", next_actions: "- Envoyer au client" };

  beforeAll(async () => {
    conversation = await newConversation(olivier);
    await post(olivier, conversation, "Prévisionnel : hypothèses de croissance 12 %.");
    await olivier.client.rpc("add_conversation_participants", { p_conversation: conversation, p_users: [paul.id] });
  });

  it("is reserved to the person responsible", async () => {
    const byPaul = await paul.client.rpc("transfer_conversation", { p_conversation: conversation, p_to: paul.id, p_sections: {}, p_ai_generated: false });
    expect(byPaul.error?.message).toBe("owner_only");
    const toOutsider = await olivier.client.rpc("transfer_conversation", { p_conversation: conversation, p_to: ownerB.id, p_sections: {}, p_ai_generated: false });
    expect(toOutsider.error?.message).toBe("not_found");
  });

  it("gives the recipient the whole history and the sender loses access", async () => {
    const { data: handoverId, error } = await olivier.client.rpc("transfer_conversation", {
      p_conversation: conversation,
      p_to: nathalie.id,
      p_sections: sections,
      p_ai_generated: true,
    });
    expect(error).toBeNull();
    expect(handoverId).toBeTruthy();
    expect(await visibleContents(nathalie, conversation)).toEqual(["Prévisionnel : hypothèses de croissance 12 %."]);
    expect((await nathalie.client.from("conversations").select("owner_id").eq("id", conversation).single()).data?.owner_id).toBe(nathalie.id);
    expect((await olivier.client.from("conversations").select("id").eq("id", conversation)).data).toEqual([]);
    expect(await visibleContents(olivier, conversation)).toEqual([]);
    // Other participants stay, with the history they had (Paul joined after that message).
    expect((await paul.client.from("conversations").select("id").eq("id", conversation)).data).toHaveLength(1);
    expect(await visibleContents(paul, conversation)).toEqual([]);
  });

  it("shows the handover file to the recipient only", async () => {
    const mine = await nathalie.client.from("handovers").select("sections, ai_generated, from_user").eq("conversation_id", conversation);
    expect(mine.data).toHaveLength(1);
    expect(mine.data![0]).toMatchObject({ sections, ai_generated: true, from_user: olivier.id });
    for (const other of [olivier, paul, owner, ownerB, platform]) {
      expect((await other.client.from("handovers").select("id").eq("conversation_id", conversation)).data).toEqual([]);
    }
  });

  it("lets the recipient edit the file, and nobody forge or redirect one", async () => {
    const edited = await nathalie.client
      .from("handovers")
      .update({ sections: { ...sections, tasks: "- Finir le tableau\n- Appeler le client" }, edited_at: new Date().toISOString() })
      .eq("conversation_id", conversation)
      .select("id");
    expect(edited.data).toHaveLength(1);
    expect((await nathalie.client.from("handovers").update({ to_user: paul.id } as never).eq("conversation_id", conversation)).error).not.toBeNull();
    expect((await olivier.client.from("handovers").update({ sections: {} }).eq("conversation_id", conversation).select("id")).data ?? []).toEqual([]);
    const forged = await olivier.client.from("handovers").insert({ company_id: company, kind: "conversation", conversation_id: conversation, to_user: olivier.id } as never);
    expect(forged.error).not.toBeNull();
  });

  it("logs the transfer with ids only", async () => {
    const log = await sql<{ metadata: Record<string, unknown> }>("select metadata from public.audit_log where target_id = $1 and action = 'conversation.transferred'", [conversation]);
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toEqual({ user_id: nathalie.id });
  });

  it("refuses to transfer a client conversation to someone without access to the client", async () => {
    const aboutA = await newConversation(olivier, clientA);
    const refused = await olivier.client.rpc("transfer_conversation", { p_conversation: aboutA, p_to: paul.id, p_sections: {}, p_ai_generated: false });
    expect(refused.error?.message).toBe("no_client_access");
  });
});

describe("transfer a restricted client", () => {
  let aboutA: string;

  beforeAll(async () => {
    aboutA = await newConversation(olivier, clientA);
    await post(olivier, aboutA, "Client A : relance prévue lundi.");
  });

  it("is reserved to an employee assigned to the client, for restricted clients", async () => {
    expect((await paul.client.rpc("transfer_client", { p_client: clientA, p_to: paul.id, p_sections: {}, p_ai_generated: false })).error?.message).toBe("not_found");
    await owner.client.from("client_assignments").insert({ client_id: clientOpen, company_id: company, user_id: olivier.id });
    const open = await olivier.client.rpc("transfer_client", { p_client: clientOpen, p_to: nathalie.id, p_sections: {}, p_ai_generated: false });
    expect(open.error?.message).toBe("not_restricted");
  });

  it("moves the assignment and the sender's conversations; the sender loses all access", async () => {
    const { error } = await olivier.client.rpc("transfer_client", {
      p_client: clientA,
      p_to: nathalie.id,
      p_sections: { summary: "Client A : relance lundi.", decisions: "", documents: "", tasks: "", next_actions: "" },
      p_ai_generated: true,
    });
    expect(error).toBeNull();
    // Nathalie: the client, its memory, the conversation and the handover file.
    expect((await nathalie.client.from("clients").select("id").eq("id", clientA)).data).toHaveLength(1);
    expect((await nathalie.client.from("memory_entries").select("content").eq("space_id", clientASpace)).data?.map((e) => e.content)).toContain(
      "Le budget du Client A est de 80 000 euros.",
    );
    expect(await visibleContents(nathalie, aboutA)).toContain("Client A : relance prévue lundi.");
    expect((await nathalie.client.from("handovers").select("kind").eq("client_id", clientA)).data).toEqual([{ kind: "client" }]);
    // Olivier: nothing about Client A by any route.
    expect((await olivier.client.from("clients").select("id").eq("id", clientA)).data).toEqual([]);
    expect((await olivier.client.from("memory_entries").select("id").eq("space_id", clientASpace)).data).toEqual([]);
    expect(await visibleContents(olivier, aboutA)).toEqual([]);
    expect((await olivier.client.from("handovers").select("id").eq("client_id", clientA)).data).toEqual([]);
    const search = await olivier.client.rpc("match_memory", { p_space_ids: [clientASpace], p_keywords: "budget" });
    expect(search.data ?? []).toEqual([]);
  });

  it("logs the transfer with ids and a count only", async () => {
    const log = await sql<{ metadata: Record<string, unknown> }>("select metadata from public.audit_log where target_id = $1 and action = 'client.transferred'", [clientA]);
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toMatchObject({ user_id: nathalie.id });
    expect(Number(log[0].metadata.conversations)).toBeGreaterThanOrEqual(1);
  });
});

describe("platform admin and other companies: no collaboration content", () => {
  it.each(["handovers", "conversation_participants", "conversations", "messages", "conversation_attachments"] as const)("read zero rows from %s", async (table) => {
    for (const outsider of [platform, ownerB]) {
      const { data } = await outsider.client.from(table).select("*").limit(5);
      expect(data ?? []).toEqual([]);
    }
  });
});
