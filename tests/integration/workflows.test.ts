import { beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, createClientRecord, createCompany, createUser, sql, type TestUser } from "../helpers/supabase";

/**
 * Workflows (CLAUDE.md §12) against the real database and RLS, with the simulated AI provider. The
 * actions run as the signed-in person; the engine runs as our server for the workflow's author.
 *
 * Company "Lumen": Owner; Alice (author) and Bob (member). Client Atlas (open). Another company: Eve.
 */

vi.stubEnv("AI_FAKE_PROVIDER", "true");
const state = vi.hoisted(() => ({ member: null as null | Record<string, unknown>, client: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next-intl/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next-intl/server")>()), getLocale: async () => "fr" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/auth/guards", () => ({ memberOrNull: async () => state.member }));

const actions = await import("@/modules/workflows/server/actions");
const { copilotAction } = await import("@/modules/workflows/server/copilot");
const { executeRun, enqueueRun, tick } = await import("@/modules/workflows/server/engine");
const { POST: hook } = await import("@/app/api/workflows/hooks/[id]/route");

let owner: TestUser, alice: TestUser, bob: TestUser, eve: TestUser;
let company: string, atlasSpace: string;

function as(user: TestUser, role: "owner" | "member" = "member", companyId = company) {
  state.member = { user: { id: user.id, email: user.email }, active: { companyId, role, adminScopes: [] }, profile: { fullName: null } };
  state.client = user.client;
}

async function draftOf(id: string) {
  const [row] = await sql<{ draft: { nodes: { id: string; type: string; config: Record<string, unknown> }[]; edges: unknown[] }; draft_revision: number }>("select draft, draft_revision from public.workflows where id = $1", [id]);
  return row;
}

/** The run id of an action's answer (the test stops on a refusal). */
function runIdOf(result: { ok: true; data?: { runId: string } } | { ok: false; error: string }): string {
  if (!result.ok) throw new Error(result.error);
  return result.data!.runId;
}

async function runToEnd(runId: string) {
  await executeRun(runId);
  const [run] = await sql<{ status: string; error_code: string | null; error_node: string | null }>("select status, error_code, error_node from public.workflow_runs where id = $1", [runId]);
  const steps = await sql<{ node_id: string; status: string; output: Record<string, unknown> | null; error_code: string | null }>("select node_id, status, output, error_code from public.workflow_run_steps where run_id = $1 order by started_at", [runId]);
  return { run, steps };
}

let minutes: string;

beforeAll(async () => {
  [owner, alice, bob, eve] = await Promise.all([createUser("wf-owner", "Owner"), createUser("wf-alice", "Alice"), createUser("wf-bob", "Bob"), createUser("wf-eve", "Eve")]);
  company = await createCompany(owner, "Lumen");
  await createCompany(eve, "Ailleurs");
  for (const u of [alice, bob]) await addMember(owner, company, u);
  const atlas = await createClientRecord(owner, company, "Atlas", "open");
  [{ id: atlasSpace }] = await sql<{ id: string }>("select id from public.memory_spaces where client_id = $1", [atlas]);

  // Alice starts from the "meeting minutes" template and chooses where the minutes go.
  as(alice);
  const created = await actions.createWorkflowAction({ name: "Comptes rendus", template: "meeting_minutes" });
  if (!created.ok) throw new Error(`create: ${created.error}`);
  minutes = created.data!.id;
  const { draft, draft_revision } = await draftOf(minutes);
  const graph = { ...draft, nodes: draft.nodes.map((n) => (n.type === "action.memory_entry" ? { ...n, config: { ...n.config, space: atlasSpace } } : n)) };
  expect(await actions.saveDraftAction({ id: minutes, graph, revision: draft_revision })).toEqual({ ok: true, data: { revision: draft_revision + 1 } });
});

describe("editing", () => {
  it("never overwrites a newer draft silently", async () => {
    as(alice);
    const { draft } = await draftOf(minutes);
    expect(await actions.saveDraftAction({ id: minutes, graph: draft, revision: 0 })).toEqual({ ok: false, error: "conflict" });
  });

  it("a personal workflow and its runs are its author's; the Owner sees that it exists, never its runs", async () => {
    for (const user of [bob, eve]) expect((await user.client.from("workflows").select("id").eq("id", minutes)).data).toEqual([]);
    expect((await owner.client.from("workflows").select("id").eq("id", minutes)).data).toHaveLength(1);
    as(bob);
    expect(await actions.saveDraftAction({ id: minutes, graph: { nodes: [], edges: [] }, revision: 1 })).toEqual({ ok: false, error: "conflict" });
    expect(await actions.playWorkflowAction({ id: minutes })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("test mode", () => {
  it("runs reads and AI for real on the draft, and only shows the actions", async () => {
    as(alice);
    const started = await actions.runWorkflowAction({ id: minutes, mode: "test", data: "Réunion Atlas. décisions: budget validé. actions: envoyer le planning. responsables: Claire. échéances: vendredi." });
    const { run, steps } = await runToEnd(runIdOf(started));
    expect(run).toMatchObject({ status: "succeeded" });
    expect(steps.map((s) => [s.node_id, s.status])).toEqual([["n1", "succeeded"], ["n2", "succeeded"], ["n3", "succeeded"], ["n4", "simulated"]]);
    expect(String(steps[1].output?.text)).toContain("[TEST] Résumé");
    expect(steps[2].output).toMatchObject({ décisions: "budget validé", actions: "envoyer le planning" });
    expect(steps[3].output).toMatchObject({ not_sent: true });
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.memory_entries where space_id = $1 and source_type = 'workflow'", [atlasSpace]);
    expect(n).toBe(0);
    // Its author follows it; nobody else.
    expect((await alice.client.from("workflow_run_steps").select("id").eq("run_id", runIdOf(started))).data).toHaveLength(4);
    for (const user of [owner, bob]) expect((await user.client.from("workflow_runs").select("id").eq("id", runIdOf(started))).data).toEqual([]);
  });
});

describe("Play and Pause", () => {
  it("asks once before a workflow that changes data goes live, then runs for real with its author's rights", async () => {
    as(alice);
    expect(await actions.playWorkflowAction({ id: minutes })).toEqual({ ok: true, data: { status: "confirm", sensitivities: ["modify"] } });
    expect(await actions.playWorkflowAction({ id: minutes, confirmed: true })).toMatchObject({ ok: true, data: { status: "active" } });
    const [{ version }] = await sql<{ version: number }>("select v.version from public.workflows w join public.workflow_versions v on v.id = w.active_version_id where w.id = $1", [minutes]);
    expect(version).toBe(1);

    const live = await actions.runWorkflowAction({ id: minutes, mode: "live", data: "Point Atlas : lancement confirmé." });
    const { run } = await runToEnd(runIdOf(live));
    expect(run.status).toBe("succeeded");
    const entries = await sql<{ author_id: string; source_type: string; title: string }>("select author_id, source_type, title from public.memory_entries where space_id = $1 and source_type = 'workflow'", [atlasSpace]);
    expect(entries).toEqual([{ author_id: alice.id, source_type: "workflow", title: "Compte rendu de réunion" }]);
  });

  it("editing the draft does not change the active version", async () => {
    as(alice);
    const { draft, draft_revision } = await draftOf(minutes);
    await actions.saveDraftAction({ id: minutes, graph: { ...draft, nodes: draft.nodes.filter((n) => n.id !== "n3"), edges: [] }, revision: draft_revision });
    const [{ graph }] = await sql<{ graph: { nodes: unknown[] } }>("select v.graph from public.workflows w join public.workflow_versions v on v.id = w.active_version_id where w.id = $1", [minutes]);
    expect(graph.nodes).toHaveLength(4);
  });

  it("the same delivery runs once (idempotency)", async () => {
    const [{ active_version_id }] = await sql<{ active_version_id: string }>("select active_version_id from public.workflows where id = $1", [minutes]);
    const a = await enqueueRun({ workflowId: minutes, companyId: company, mode: "live", trigger: "webhook", triggeredBy: null, input: {}, idempotencyKey: "delivery-1", versionId: active_version_id });
    const b = await enqueueRun({ workflowId: minutes, companyId: company, mode: "live", trigger: "webhook", triggeredBy: null, input: {}, idempotencyKey: "delivery-1", versionId: active_version_id });
    expect(b).toEqual({ id: a.id, duplicate: true });
  });

  it("Pause cancels runs waiting in the queue", async () => {
    as(alice);
    expect(await actions.pauseWorkflowAction({ id: minutes })).toMatchObject({ ok: true });
    const [run] = await sql<{ status: string; error_code: string }>("select status, error_code from public.workflow_runs where workflow_id = $1 and idempotency_key = 'delivery-1'", [minutes]);
    expect(run).toEqual({ status: "cancelled", error_code: "paused" });
    expect(await actions.runWorkflowAction({ id: minutes, mode: "live" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("an action interrupted in an earlier attempt is never repeated", async () => {
    as(alice);
    await actions.playWorkflowAction({ id: minutes, confirmed: true });
    const [{ active_version_id }] = await sql<{ active_version_id: string }>("select active_version_id from public.workflows where id = $1", [minutes]);
    const queued = await enqueueRun({ workflowId: minutes, companyId: company, mode: "live", trigger: "manual", triggeredBy: alice.id, input: { text: "x" }, versionId: active_version_id });
    await sql("insert into public.workflow_run_steps (run_id, company_id, node_id, node_type, status) values ($1, $2, 'n4', 'action.memory_entry', 'running')", [queued.id, company]);
    const before = (await sql<{ n: number }>("select count(*)::int as n from public.memory_entries where space_id = $1", [atlasSpace]))[0].n;
    const { run } = await runToEnd(queued.id);
    expect(run).toMatchObject({ status: "failed", error_code: "interrupted", error_node: "n4" });
    expect((await sql<{ n: number }>("select count(*)::int as n from public.memory_entries where space_id = $1", [atlasSpace]))[0].n).toBe(before);
  });
});

describe("triggers", () => {
  it("a webhook needs its secret, and runs the active version", async () => {
    as(alice);
    const created = await actions.createWorkflowAction({ name: "Leads" });
    if (!created.ok) throw new Error(created.error);
    const id = created.data!.id;
    const { draft_revision } = await draftOf(id);
    const graph = {
      nodes: [
        { id: "n1", type: "trigger.webhook", position: { x: 0, y: 0 }, config: {} },
        { id: "n2", type: "logic.set", position: { x: 0, y: 140 }, config: { name: "lead", value: "{{trigger.name}}" } },
        { id: "n3", type: "action.memory_entry", position: { x: 0, y: 280 }, config: { space: atlasSpace, title: "Lead {{vars.lead}}", content: "{{trigger.message}}" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", handle: "out" },
        { id: "e2", source: "n2", target: "n3", handle: "out" },
      ],
    };
    await actions.saveDraftAction({ id, graph, revision: draft_revision });
    const played = await actions.playWorkflowAction({ id, confirmed: true });
    if (!played.ok) throw new Error(played.error);
    const secret = played.data && "webhookSecret" in played.data ? played.data.webhookSecret! : "";
    expect(secret).toMatch(/^whs_/);
    const call = (token: string, key?: string) =>
      hook(new Request(`https://app.test/api/workflows/hooks/${id}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify({ name: "Vega", message: "Besoin d'un devis" }) }), { params: Promise.resolve({ id }) } as never);
    expect((await call("wrong")).status).toBe(403);
    const ok = await call(secret, "k1");
    expect(ok.status).toBe(202);
    const { run: runId } = (await ok.json()) as { run: string };
    expect(((await (await call(secret, "k1")).json()) as { duplicate: boolean }).duplicate).toBe(true);
    const { run } = await runToEnd(runId);
    expect(run.status).toBe("succeeded");
    expect((await sql<{ title: string }>("select title from public.memory_entries where space_id = $1 and title = 'Lead Vega'", [atlasSpace]))).toHaveLength(1);
  });

  it("the clock starts scheduled workflows when they are due", async () => {
    as(alice);
    const created = await actions.createWorkflowAction({ name: "Chaque matin" });
    if (!created.ok) throw new Error(created.error);
    const id = created.data!.id;
    const { draft_revision } = await draftOf(id);
    await actions.saveDraftAction({
      id,
      revision: draft_revision,
      graph: { nodes: [{ id: "n1", type: "trigger.schedule", position: { x: 0, y: 0 }, config: { frequency: "daily", time: "08:00" } }, { id: "n2", type: "ai.generate", position: { x: 0, y: 140 }, config: { prompt: "Bonjour" } }], edges: [{ id: "e1", source: "n1", target: "n2", handle: "out" }] },
    });
    await actions.playWorkflowAction({ id });
    await sql("update public.workflows set next_run_at = now() - interval '1 minute' where id = $1", [id]);
    const result = await tick();
    expect(result.scheduled).toBeGreaterThanOrEqual(1);
    const [run] = await sql<{ trigger: string; status: string }>("select trigger, status from public.workflow_runs where workflow_id = $1", [id]);
    expect(run).toEqual({ trigger: "schedule", status: "succeeded" });
    const [{ next_run_at }] = await sql<{ next_run_at: string }>("select next_run_at from public.workflows where id = $1", [id]);
    expect(new Date(next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("stops and pauses when its author is no longer an active member", async () => {
    await sql("update public.company_members set status = 'deactivated' where company_id = $1 and user_id = $2", [company, alice.id]);
    const [{ active_version_id }] = await sql<{ active_version_id: string }>("select active_version_id from public.workflows where id = $1", [minutes]);
    const queued = await enqueueRun({ workflowId: minutes, companyId: company, mode: "live", trigger: "manual", triggeredBy: null, input: {}, versionId: active_version_id });
    const { run } = await runToEnd(queued.id);
    expect(run).toMatchObject({ status: "failed", error_code: "owner_inactive" });
    expect((await sql<{ status: string }>("select status from public.workflows where id = $1", [minutes]))[0].status).toBe("paused");
    await sql("update public.company_members set status = 'active' where company_id = $1 and user_id = $2", [company, alice.id]);
  });
});

describe("Cendr AI copilot", () => {
  it("really changes the workflow, asks first for an action that writes outside, and only explains when asked to", async () => {
    as(alice);
    const { draft } = await draftOf(minutes);
    const slack = await copilotAction({ workflowId: minutes, graph: draft, message: "Ajoute une notification Slack à la fin" });
    expect(slack).toMatchObject({ ok: true, data: { applied: 1, sensitive: true } });
    if (!slack.ok) return;
    expect(slack.data!.graph.nodes.some((n) => n.type === "action.slack_post")).toBe(true);
    const explain = await copilotAction({ workflowId: minutes, graph: draft, message: "Explique-moi ce workflow" });
    expect(explain).toMatchObject({ ok: true, data: { applied: 0, ops: [] } });
    as(bob);
    expect(await copilotAction({ workflowId: minutes, graph: draft, message: "x" })).toEqual({ ok: false, error: "not_found" });
  });
});
