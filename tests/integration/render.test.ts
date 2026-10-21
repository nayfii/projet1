import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompany, createUser, makePlatformAdmin, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 8 (CLAUDE.md §4.7, docs/ARCHITECTURE.md §10): the render queue. Who can ask for a video, see
 * it and download it; the dedicated video credits; files that must belong to the conversation; what
 * only the worker (service role) may do. Real users and JWTs, through the public API.
 */
let owner: TestUser, olivier: TestUser, nathalie: TestUser, ownerB: TestUser, platform: TestUser;
let company: string, motionAgent: string, otherAgent: string;
let conversation: string, answer: string, plainConversation: string, plainAnswer: string, otherConversation: string;
let image: string, foreignImage: string, smallPlan: string;
let rates: { kind: string; credits_per_second: string }[];

const input = (assets: { attachment_id: string; name: string }[] = []) => ({ composition: "<p>test</p>", assets });
const enqueue = (user: TestUser, message = answer, p: { kind?: string; formats?: string[]; duration?: number; assets?: { attachment_id: string; name: string }[] } = {}) =>
  user.client.rpc("enqueue_render_job", {
    p_message: message,
    p_kind: p.kind ?? "motion",
    p_formats: p.formats ?? ["16:9"],
    p_duration: p.duration ?? 10,
    p_input: input(p.assets ?? []),
  });

async function answerIn(conversationId: string) {
  const { data, error } = await serviceClient()
    .from("messages")
    .insert({ conversation_id: conversationId, author_type: "assistant", content: "```hyperframes\n<p>test</p>\n```", provider: "openai", model_id: "gpt-6-luna", status: "complete" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("answer");
  return data.id;
}

async function attachment(conversationId: string, user: TestUser) {
  const [row] = await sql<{ id: string }>(
    `insert into public.conversation_attachments (conversation_id, uploaded_by, filename, mime_type, size_bytes, storage_path, kind)
     values ($1::uuid, $2, 'logo.png', 'image/png', 10, $1::text || '/' || gen_random_uuid() || '.png', 'image') returning id`,
    [conversationId, user.id],
  );
  return row.id;
}

beforeAll(async () => {
  [owner, olivier, nathalie, ownerB, platform] = await Promise.all([
    createUser("render-owner", "Owner"),
    createUser("render-olivier", "Olivier"),
    createUser("render-nathalie", "Nathalie"),
    createUser("render-owner-b", "Owner B"),
    createUser("render-platform", "Platform"),
  ]);
  await makePlatformAdmin(platform);
  company = await createCompany(owner, "Render Co");
  await createCompany(ownerB, "Render Co B");
  await addMember(owner, company, olivier);
  await addMember(owner, company, nathalie);
  const { ensureBuiltinAgents } = await import("@/modules/agents/server/builtin-sync");
  await ensureBuiltinAgents();
  [{ id: motionAgent }] = await sql<{ id: string }>("select id from public.agents where builtin_key = 'motion_design'");
  [{ id: otherAgent }] = await sql<{ id: string }>("select id from public.agents where builtin_key = 'proposal_writer'");

  const start = async (user: TestUser, agentId: string | null, companyId = company) => {
    const { data, error } = await user.client.from("conversations").insert({ company_id: companyId, agent_id: agentId }).select("id").single();
    if (error || !data) throw error ?? new Error("conversation");
    return data.id;
  };
  conversation = await start(olivier, motionAgent);
  answer = await answerIn(conversation);
  plainConversation = await start(olivier, otherAgent);
  plainAnswer = await answerIn(plainConversation);
  otherConversation = await start(nathalie, motionAgent);
  image = await attachment(conversation, olivier);
  await sql("update public.conversation_attachments set message_id = $1 where id = $2", [answer, image]);
  foreignImage = await attachment(otherConversation, nathalie);
  rates = await sql("select kind, credits_per_second from public.render_rates");
  [{ id: smallPlan }] = await sql<{ id: string }>("insert into public.plans (name, monthly_credits, video_credits) values ('Render small', 1000, 150) returning id");
});

afterAll(async () => {
  // The rates are shared by every company: put them back.
  for (const r of rates) await sql("update public.render_rates set credits_per_second = $1 where kind = $2", [r.credits_per_second, r.kind]);
  await sql("update public.companies set plan_id = (select id from public.plans where is_default) where plan_id = $1", [smallPlan]);
  await sql("delete from public.plans where id = $1", [smallPlan]);
});

describe("asking for a video", () => {
  it("queues a render of a video agent's answer and reserves video credits at the platform's rate", async () => {
    const { data: id, error } = await enqueue(olivier, answer, { duration: 12, assets: [{ attachment_id: image, name: "logo.png" }] });
    expect(error).toBeNull();
    const [{ credits_per_second }] = await sql<{ credits_per_second: string }>("select credits_per_second from public.render_rates where kind = 'motion'");
    const { data } = await olivier.client.from("render_jobs").select("status, credits_reserved, formats").eq("id", id!).single();
    expect(data).toEqual({ status: "queued", credits_reserved: Math.ceil(Number(credits_per_second) * 12), formats: ["16:9"] });
    // The same render cannot be queued twice while it waits.
    expect((await enqueue(olivier, answer, { duration: 12 })).error?.message).toBe("render_in_progress");
    expect((await olivier.client.rpc("cancel_render_job", { p_job: id! })).error).toBeNull();
    expect((await olivier.client.from("render_jobs").select("status").eq("id", id!).single()).data?.status).toBe("cancelled");
  });

  it("refuses people outside the conversation, another company and the platform admin", async () => {
    for (const user of [nathalie, ownerB, platform]) expect((await enqueue(user)).error?.message).toBe("not_found");
    for (const user of [nathalie, ownerB, platform]) expect((await user.client.from("render_jobs").select("id").eq("message_id", answer)).data).toEqual([]);
  });

  it("only renders answers of the video agents, and only files of the same conversation", async () => {
    expect((await enqueue(olivier, plainAnswer)).error?.message).toBe("forbidden");
    expect((await enqueue(olivier, answer, { assets: [{ attachment_id: foreignImage, name: "logo.png" }] })).error?.message).toBe("validation");
    expect((await enqueue(olivier, answer, { assets: [{ attachment_id: "not-a-uuid", name: "x" }] })).error?.message).toBe("validation");
    expect((await enqueue(olivier, answer, { formats: ["16:9", "1:1"] })).error?.message).toBe("validation");
    expect((await enqueue(olivier, answer, { duration: 61 })).error?.message).toBe("validation");
  });

  it("stops at the company's video credits, apart from its AI credits", async () => {
    await sql("update public.companies set plan_id = $1 where id = $2", [smallPlan, company]);
    // 150 video credits: 16 seconds of motion at 10 credits per second is too much.
    await sql("update public.render_rates set credits_per_second = 10 where kind = 'motion'");
    expect((await enqueue(olivier, answer, { duration: 16 })).error?.message).toBe("video_quota_exceeded");
    const { data: credits } = await olivier.client.rpc("my_video_credits", { p_company: company });
    expect(Number(credits?.[0].video_limit)).toBe(150);
    // An extra video grant from our team raises the limit for this month only.
    expect((await platform.client.rpc("platform_grant_credits", { p_company: company, p_credits: 100, p_pool: "video" })).error).toBeNull();
    expect(Number((await olivier.client.rpc("my_video_credits", { p_company: company })).data?.[0].video_limit)).toBe(250);
    const { data: quota } = await owner.client.rpc("my_quota_status", { p_company: company });
    expect(Number((quota as { company_limit: number }[] | null)?.[0]?.company_limit ?? 1000)).toBe(1000);
  });

  it("allows no direct write and keeps the queue functions for the worker", async () => {
    await olivier.client.from("render_jobs").update({ status: "succeeded" } as never).eq("message_id", answer);
    expect((await sql("select 1 from public.render_jobs where message_id = $1 and status = 'succeeded'", [answer])).length).toBe(0);
    const insert = await olivier.client.from("render_jobs").insert({ company_id: company, conversation_id: conversation, message_id: answer, kind: "motion", formats: ["16:9"], duration_seconds: 1, input: {}, credits_reserved: 0 } as never);
    expect(insert.error).not.toBeNull();
    for (const call of [
      olivier.client.rpc("render_claim_job", { p_worker: "me" }),
      olivier.client.rpc("render_job_progress", { p_job: answer, p_worker: "me", p_progress: 1, p_stage: "x" }),
      olivier.client.rpc("render_job_failed", { p_job: answer, p_worker: "me", p_error: "x", p_retry: false }),
    ]) {
      expect((await call).error?.code).toBe("42501");
    }
    expect((await olivier.client.rpc("platform_set_render_rate", { p_kind: "motion", p_credits_per_second: 0 })).error?.message).toBe("forbidden");
  });
});

describe("the worker", () => {
  it("claims, reports progress, saves the videos and charges the video credits actually produced", async () => {
    await sql("update public.render_rates set credits_per_second = 2 where kind = 'motion'");
    const { data: id } = await enqueue(olivier, answer, { duration: 10, assets: [{ attachment_id: image, name: "logo.png" }] });
    const worker = serviceClient();
    type Claimed = { id: string; assets: { storage_path: string; bucket: string }[] };
    let claimed = null as Claimed | null;
    // Other test files may queue jobs too: claim until ours comes.
    for (let i = 0; i < 20 && claimed?.id !== id; i++) {
      claimed = (await worker.rpc("render_claim_job", { p_worker: "test-worker" })).data as Claimed | null;
      if (claimed && claimed.id !== id) await worker.rpc("render_job_failed", { p_job: claimed.id, p_worker: "test-worker", p_error: "test", p_retry: false });
    }
    expect(claimed?.id).toBe(id);
    // The worker gets the file's place from the database, never from the input.
    expect(claimed!.assets).toEqual([expect.objectContaining({ bucket: "chat-attachments", storage_path: expect.stringContaining(`${conversation}/`) })]);
    expect((await worker.rpc("render_job_progress", { p_job: id!, p_worker: "test-worker", p_progress: 40, p_stage: "capturing" })).data).toBe(true);
    expect((await worker.rpc("render_job_progress", { p_job: id!, p_worker: "someone-else", p_progress: 40, p_stage: "capturing" })).data).toBe(false);
    const { data: seen } = await olivier.client.from("render_jobs").select("status, progress, stage").eq("id", id!).single();
    expect(seen).toEqual({ status: "running", progress: 40, stage: "capturing" });

    const outside = [{ format: "16:9", path: `${otherConversation}/${id}/16x9.mp4`, bytes: 1, width: 1920, height: 1080, seconds: 8 }];
    expect((await worker.rpc("render_job_succeeded", { p_job: id!, p_worker: "test-worker", p_outputs: outside, p_seconds: 8 })).error?.message).toBe("validation");
    const path = `${conversation}/${id}/16x9.mp4`;
    await worker.storage.from("render-outputs").upload(path, new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), { contentType: "video/mp4", upsert: true });
    const outputs = [{ format: "16:9", path, bytes: 8, width: 1920, height: 1080, seconds: 8 }];
    expect((await worker.rpc("render_job_succeeded", { p_job: id!, p_worker: "test-worker", p_outputs: outputs, p_seconds: 8 })).error).toBeNull();
    const [usage] = await sql<{ credits: string; credit_pool: string; feature: string }>(
      "select credits, credit_pool, feature from public.usage_events where company_id = $1 and feature = 'render'",
      [company],
    );
    expect({ ...usage, credits: Number(usage.credits) }).toEqual({ credits: 16, credit_pool: "video", feature: "render" });

    // The video: its participant may open it; another company and the platform admin may not.
    expect((await olivier.client.storage.from("render-outputs").createSignedUrl(path, 60)).data?.signedUrl).toBeTruthy();
    for (const user of [ownerB, platform, nathalie]) expect((await user.client.storage.from("render-outputs").createSignedUrl(path, 60)).data).toBeNull();
  });

  it("puts a job back in the queue when its worker goes silent, and stops after three attempts", async () => {
    await sql("update public.render_rates set credits_per_second = 1 where kind = 'motion'");
    const { data: id } = await enqueue(olivier, answer, { duration: 5 });
    await sql("update public.render_jobs set status = 'running', locked_by = 'lost', attempts = 1, heartbeat_at = now() - interval '10 minutes' where id = $1", [id]);
    await serviceClient().rpc("render_claim_job", { p_worker: "test-worker-2" });
    const [job] = await sql<{ status: string; attempts: number }>("select status, attempts from public.render_jobs where id = $1", [id]);
    expect(job.attempts).toBe(2);
    expect(["queued", "running"]).toContain(job.status);
    await sql("update public.render_jobs set status = 'running', locked_by = 'lost', attempts = 3, heartbeat_at = now() - interval '10 minutes' where id = $1", [id]);
    await serviceClient().rpc("render_claim_job", { p_worker: "test-worker-2" });
    expect((await sql<{ status: string; error_code: string }>("select status, error_code from public.render_jobs where id = $1", [id]))[0]).toEqual({
      status: "failed",
      error_code: "worker_lost",
    });
  });
});
