import { describe, expect, it } from "vitest";
import { compare, fill, fillText, nextRun, sensitivities, validateGraph, type WfGraph } from "@/modules/workflows/graph";
import { applyOps, compactGraph, opsAreSensitive } from "@/modules/workflows/ops";
import { TEMPLATES } from "@/modules/workflows/templates";

const g = (nodes: [string, string, Record<string, unknown>?][], edges: [string, string, string?][]): WfGraph => ({
  nodes: nodes.map(([id, type, config], i) => ({ id, type, position: { x: 0, y: i * 100 }, config: config ?? {} })),
  edges: edges.map(([source, target, handle], i) => ({ id: `e${i}`, source, target, handle: handle ?? "out" })),
});

describe("graph checks", () => {
  it("every template is one trigger, reached steps, no loop; only the person's choices are missing", () => {
    for (const tpl of TEMPLATES) {
      for (const lang of ["fr", "en"] as const) {
        const issues = validateGraph(tpl.graph(lang));
        const structural = issues.filter((i) => !(i.code === "missing_field" && ["connection", "to", "space", "parent", "channel"].includes(i.field ?? "")));
        expect(structural, `${tpl.key} ${lang}`).toEqual([]);
      }
    }
  });

  it("finds a missing trigger, two triggers, a cycle, an unreachable step, a wrong exit, a missing setting", () => {
    expect(validateGraph(g([["a", "ai.generate", { prompt: "x" }]], [])).map((i) => i.code)).toContain("no_trigger");
    expect(validateGraph(g([["t", "trigger.manual"], ["u", "trigger.webhook"]], [])).map((i) => i.code)).toContain("two_triggers");
    const loop = g([["t", "trigger.manual"], ["a", "logic.set", { name: "x" }], ["b", "logic.set", { name: "y" }]], [["t", "a"], ["a", "b"], ["b", "a"]]);
    expect(validateGraph(loop).map((i) => i.code)).toContain("cycle");
    expect(validateGraph(g([["t", "trigger.manual"], ["a", "logic.set", { name: "x" }]], [])).map((i) => i.code)).toContain("unreachable");
    expect(validateGraph(g([["t", "trigger.manual"], ["a", "logic.set", { name: "x" }]], [["t", "a", "true"]])).map((i) => i.code)).toContain("bad_handle");
    expect(validateGraph(g([["t", "trigger.manual"], ["a", "ai.generate"]], [["t", "a"]]))).toContainEqual({ node: "a", code: "missing_field", field: "prompt" });
  });

  it("refuses a connection the author cannot use", () => {
    const graph = g([["t", "trigger.manual"], ["a", "action.slack_post", { connection: "c1", channel: "x", text: "y" }]], [["t", "a"]]);
    expect(validateGraph(graph, () => false)).toContainEqual({ node: "a", code: "bad_connection", field: "connection" });
    expect(validateGraph(graph, () => true)).toEqual([]);
  });

  it("lists what turning it on may do, for the warning", () => {
    const graph = g([["t", "trigger.manual"], ["a", "action.email_send"], ["b", "action.memory_entry"], ["c", "action.email_draft"]], [["t", "a"], ["a", "b"], ["b", "c"]]);
    expect(sensitivities(graph).sort()).toEqual(["external_message", "modify"]);
  });
});

describe("variables and conditions", () => {
  const scope = { trigger: { text: "Bonjour", from: "a@b.test" }, steps: { n2: { items: [{ id: 1 }, { id: 2 }], label: "chaud", count: 3 } }, vars: { client: "Atlas" }, loop: { item: { name: "x" }, index: 0 } };
  it("fills {{variables}}, keeping a whole list as a list", () => {
    expect(fillText("De {{trigger.from}} pour {{vars.client}} : {{trigger.text}}", scope)).toBe("De a@b.test pour Atlas : Bonjour");
    expect(fill("{{steps.n2.items}}", scope)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fillText("{{steps.n2.items.1.id}} / {{loop.item.name}} / {{missing.path}}", scope)).toBe("2 / x / ");
  });
  it("compares as people expect (case, numbers, emptiness)", () => {
    expect(compare("Chaud", "equals", "chaud")).toBe(true);
    expect(compare("Le client est prioritaire", "contains", "PRIORITAIRE")).toBe(true);
    expect(compare("12,5", "greater", "9")).toBe(true);
    expect(compare("", "is_empty", "")).toBe(true);
    expect(compare("[]", "not_empty", "")).toBe(false);
  });
});

describe("schedule", () => {
  const at = new Date("2026-11-12T10:00:00Z"); // Thursday, 11:00 in Paris
  it("daily at 08:00 Paris time is tomorrow 07:00 UTC in winter", () => {
    expect(nextRun({ frequency: "daily", time: "08:00" }, at).toISOString()).toBe("2026-11-13T07:00:00.000Z");
  });
  it("weekdays skip the weekend; weekly picks the day; hourly the next full hour", () => {
    expect(nextRun({ frequency: "weekdays", time: "08:00" }, new Date("2026-11-13T10:00:00Z")).toISOString()).toBe("2026-11-16T07:00:00.000Z");
    expect(nextRun({ frequency: "weekly", weekday: "1", time: "09:00" }, at).toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(nextRun({ frequency: "hourly" }, new Date("2026-11-12T10:20:00Z")).toISOString()).toBe("2026-11-12T11:00:00.000Z");
  });
  it("follows summer time", () => {
    expect(nextRun({ frequency: "daily", time: "08:00" }, new Date("2027-06-01T12:00:00Z")).toISOString()).toBe("2027-06-02T06:00:00.000Z");
  });
});

describe("copilot changes", () => {
  const base = g([["n1", "trigger.manual"], ["n2", "ai.summarize", { input: "{{trigger.text}}" }], ["n3", "action.email_draft"]], [["n1", "n2"], ["n2", "n3"]]);
  it("inserts a step after another, between it and what followed", () => {
    const { graph, applied } = applyOps(base, [{ op: "add_node", type: "ai.classify", after: "n2", config: { input: "x", labels: ["a"] } }]);
    expect(applied).toBe(1);
    const added = graph.nodes.find((n) => n.type === "ai.classify")!;
    expect(graph.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual(["n1>n2", `n2>${added.id}`, `${added.id}>n3`].sort());
    expect(validateGraph(graph).filter((i) => i.code !== "missing_field")).toEqual([]);
  });
  it("removes a step and joins its neighbours; refuses the trigger, unknown types, a second trigger", () => {
    const removed = applyOps(base, [{ op: "remove_node", id: "n2" }]).graph;
    expect(removed.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["n1>n3"]);
    expect(applyOps(base, [{ op: "remove_node", id: "n1" }, { op: "add_node", type: "evil.exec", config: {} }, { op: "add_node", type: "trigger.webhook", config: {} }]).rejected).toBe(3);
  });
  it("changes settings and type within the same family only, dropping unknown settings", () => {
    const { graph } = applyOps(base, [{ op: "update_node", id: "n2", type: "ai.generate", config: { prompt: "p", secret: "x" } }]);
    expect(graph.nodes.find((n) => n.id === "n2")).toMatchObject({ type: "ai.generate", config: { prompt: "p" } });
    expect(graph.nodes.find((n) => n.id === "n2")!.config).not.toHaveProperty("secret");
    expect(applyOps(base, [{ op: "update_node", id: "n2", type: "action.email_send", config: {} }]).rejected).toBe(1);
  });
  it("flags changes that touch an action writing outside, and shows the model a short view", () => {
    expect(opsAreSensitive(base, [{ op: "add_node", type: "action.slack_post", config: {} }])).toBe(true);
    expect(opsAreSensitive(base, [{ op: "update_node", id: "n2", config: { length: "short" } }])).toBe(false);
    const long = g([["n1", "trigger.manual", { sample: "x".repeat(1000) }]], []);
    expect(String(compactGraph(long).nodes[0].config.sample).length).toBeLessThan(260);
  });
});
