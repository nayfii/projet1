import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, inWeek, isIsoDate, monthGrid, todayIso, weekStart } from "@/modules/scale/logic/dates";
import {
  cascadePlan,
  dateConflicts,
  itemsInCycles,
  nextOccurrence,
  objectiveAttainment,
  openBlockers,
  priorityScore,
  simulate,
  taskProgress,
  tasksOfWeek,
  weekLoad,
  wouldCreateCycle,
  type Edge,
} from "@/modules/scale/logic/planning";
import { blocksSchema, blocksToMarkdown, blocksText, type Block } from "@/modules/scale/logic/blocks";
import { toCsvRows } from "@/modules/scale/logic/export";
import { createSchema, patchSchema } from "@/modules/scale/schemas";
import { docTemplate, DOC_TEMPLATES, metricSuggestions, starterPlan, testTemplate, TEST_TEMPLATES } from "@/modules/scale/templates";
import type { Task } from "@/modules/scale/types";

const task = (over: Partial<Task>): Task =>
  ({
    id: Math.random().toString(36).slice(2),
    title: "t",
    status: "todo",
    priority: "none",
    kind: "task",
    commercial_urgency: "none",
    recurrence: null,
    parent_id: null,
    archived_at: null,
    estimate_hours: null,
    week_start: null,
    due_date: null,
    start_date: null,
    sort_order: 0,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  }) as Task;

describe("Scale dates (plain days, weeks from Monday)", () => {
  it("counts days and weeks without time zone drift", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // across the summer time change
    expect(diffDays("2026-10-24", "2026-10-27")).toBe(3);
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // its Sunday
    expect(inWeek("2026-11-15", "2026-11-09")).toBe(true);
    expect(inWeek("2026-11-16", "2026-11-09")).toBe(false);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(monthGrid(2026, 10)[0]).toBe("2026-10-26");
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(todayIso("Europe/Paris", new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
  });
});

describe("dependencies", () => {
  const edges: Edge[] = [
    { from: "b", to: "a" },
    { from: "c", to: "b" },
  ];
  it("refuses a loop, directly or through other items", () => {
    expect(wouldCreateCycle(edges, "a", "c")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "c", "a")).toBe(false);
    expect(itemsInCycles([...edges, { from: "a", to: "c" }]).size).toBe(3);
  });

  it("a task waits for its unfinished dependencies only", () => {
    const a = task({ id: "a", status: "in_progress" });
    const b = task({ id: "b" });
    const map = new Map([a, b].map((t) => [t.id, t]));
    expect(openBlockers("b", [{ from: "b", to: "a" }], map).map((t) => t.id)).toEqual(["a"]);
    map.set("a", { ...a, status: "done" });
    expect(openBlockers("b", [{ from: "b", to: "a" }], map)).toEqual([]);
  });

  it("finds dates that contradict a dependency", () => {
    const spans = [
      { id: "a", start: "2026-11-01", end: "2026-11-20" },
      { id: "b", start: "2026-11-10", end: "2026-11-30" },
    ];
    expect(dateConflicts(spans, [{ from: "b", to: "a" }])).toEqual([{ id: "b", dependsOn: "a", days: 10 }]);
  });

  it("shows the cascade of a move before applying it, without moving what is not concerned", () => {
    const spans = [
      { id: "a", start: "2026-11-01", end: "2026-11-10" },
      { id: "b", start: "2026-11-11", end: "2026-11-20" },
      { id: "c", start: "2026-11-21", end: "2026-11-25" },
      { id: "d", start: "2026-12-15", end: "2026-12-20" },
    ];
    const plan = cascadePlan(spans, [{ from: "b", to: "a" }, { from: "c", to: "b" }, { from: "d", to: "c" }], "a", { start: "2026-11-05", end: "2026-11-15" });
    expect(plan.map((c) => [c.id, c.to.start, c.to.end])).toEqual([
      ["a", "2026-11-05", "2026-11-15"],
      ["b", "2026-11-15", "2026-11-24"],
      ["c", "2026-11-24", "2026-11-28"],
    ]);
    expect(plan.find((c) => c.id === "d")).toBeUndefined();
  });
});

describe("progress, result and health are three different things", () => {
  it("task progress leaves cancelled tasks and sub-tasks out", () => {
    const list = [task({ status: "done" }), task({ status: "todo" }), task({ status: "cancelled" }), task({ status: "done", parent_id: "x" })];
    expect(taskProgress(list)).toEqual({ done: 1, total: 2, ratio: 0.5 });
  });

  it("an objective's result never comes from tasks", () => {
    expect(objectiveAttainment({ kind: "validation", validation_state: "pending", baseline: null, current_value: null, target: null })).toBeNull();
    expect(objectiveAttainment({ kind: "validation", validation_state: "validated", baseline: null, current_value: null, target: null })).toBe(1);
    expect(objectiveAttainment({ kind: "numeric", validation_state: "pending", baseline: 0, current_value: 3, target: 12 })).toBe(0.25);
    expect(objectiveAttainment({ kind: "numeric", validation_state: "pending", baseline: 0, current_value: null, target: 12 })).toBeNull();
  });
});

describe("the week: capacity against estimates", () => {
  it("adds up estimates, counts unestimated tasks and the overload", () => {
    const monday = "2026-11-09";
    const list = [
      task({ week_start: monday, estimate_hours: 6 }),
      task({ week_start: monday, estimate_hours: 5, status: "done" }),
      task({ due_date: "2026-11-12" }),
      task({ week_start: "2026-11-16", estimate_hours: 40 }),
      task({ week_start: monday, estimate_hours: 9, status: "cancelled" }),
    ];
    expect(tasksOfWeek(list, monday)).toHaveLength(3);
    expect(weekLoad(list, monday, 8)).toEqual({ planned: 11, estimated: 2, unestimated: 1, doneHours: 5, capacity: 8, over: 3 });
    expect(weekLoad(list, monday, null).over).toBeNull();
  });

  it("repeats routines on the next date", () => {
    expect(nextOccurrence("2026-11-13", "weekly")).toBe("2026-11-20");
    expect(nextOccurrence("2026-11-13", "biweekly")).toBe("2026-11-27");
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
  });
});

describe("product score and simulations stay transparent", () => {
  it("scores only when the three values are there", () => {
    expect(priorityScore({ impact: 4, confidence: 3, effort: 2 })).toBe(6);
    expect(priorityScore({ impact: 4, confidence: null, effort: 2 })).toBeNull();
  });

  it("computes what the inputs allow, and nothing more", () => {
    const r = simulate({ pricePerUser: 35, usersPerCustomer: 15, customers: 10, variableCostPerUser: 8, fixedCosts: 3000 });
    expect(r).toMatchObject({ users: 150, revenue: 5250, variableCosts: 1200, contribution: 4050, margin: 1050, breakEvenCustomers: 8 });
    expect(simulate({ pricePerUser: 35, usersPerCustomer: null, customers: 10, variableCostPerUser: 8, fixedCosts: 3000 }).revenue).toBeNull();
  });
});

describe("documents", () => {
  const blocks: Block[] = [
    { id: "1", type: "h2", text: "Client" },
    { id: "2", type: "hypothesis", text: "Les agences perdent du temps" },
    { id: "3", type: "fact", text: "8 entretiens sur 10" },
    { id: "4", type: "check", text: "Valider le prix", checked: true },
    { id: "5", type: "table", text: "", rows: [["A", "B"], ["1", "2|3"]] },
  ];
  it("exports to Markdown with hypotheses, facts and decisions labelled", () => {
    const md = blocksToMarkdown("Plan", blocks, { hypothesis: "Hypothèse", fact: "Fait", decision: "Décision" });
    expect(md).toContain("> **Hypothèse** — Les agences perdent du temps");
    expect(md).toContain("> **Fait** — 8 entretiens sur 10");
    expect(md).toContain("- [x] Valider le prix");
    expect(md).toContain("| 1 | 2\\|3 |");
    expect(blocksText(blocks)).toContain("2|3");
  });

  it("refuses unsafe links and unknown blocks", () => {
    expect(blocksSchema.safeParse([{ id: "1", type: "link", text: "x", url: "javascript:alert(1)" }]).success).toBe(false);
    expect(blocksSchema.safeParse([{ id: "1", type: "script", text: "x" }]).success).toBe(false);
    expect(blocksSchema.safeParse(blocks).success).toBe(true);
  });

  it("keeps spreadsheet formulas inert in CSV exports", () => {
    expect(toCsvRows([{ a: "=1+1", b: 'say "hi"' }], ";")).toBe('﻿"a";"b"\r\n"\'=1+1";"say ""hi"""\r\n');
  });
});

describe("validation of what Scale writes", () => {
  it("needs only a title to capture a task, and checks every other value", () => {
    expect(createSchema("task").safeParse({ title: "Relancer" }).success).toBe(true);
    expect(createSchema("task").safeParse({}).success).toBe(false);
    expect(createSchema("task").safeParse({ title: "x", status: "whatever" }).success).toBe(false);
    expect(createSchema("task").safeParse({ title: "x", week_start: "2026-11-10" }).success).toBe(false); // not a Monday
    expect(createSchema("task").safeParse({ title: "x", unknown_field: 1 }).success).toBe(false);
    expect(patchSchema("test").safeParse({ conclusion: "supported" }).success).toBe(true);
    expect(patchSchema("test").safeParse({ template_key: "x" }).success).toBe(false); // set at creation only
    expect(patchSchema("task").safeParse({}).success).toBe(false);
  });
});

describe("starting points hold no invented data", () => {
  it("the Cendr structure has the eight projects, no dates, no results", () => {
    const plan = starterPlan("fr");
    expect(plan.projects.map((p) => p.title)).toEqual([
      "Définir et valider l'ICP",
      "Mesurer la valeur de Consciousness",
      "Construire l'offre et tester le prix",
      "Préparer une version utilisable par des pilotes",
      "Construire le business plan et le modèle de coûts",
      "Recruter et accompagner les premiers pilotes",
      "Tester l'acquisition",
      "Préparer les opérations nécessaires au lancement",
    ]);
    expect(JSON.stringify(plan)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("every template exists in both languages", () => {
    for (const k of DOC_TEMPLATES) {
      if (k !== "blank" && k !== "decision_log") expect(JSON.stringify(docTemplate(k, "fr").content.map((b) => [b.text, b.hint]))).not.toBe(JSON.stringify(docTemplate(k, "en").content.map((b) => [b.text, b.hint])));
      expect(blocksSchema.safeParse(docTemplate(k, "en").content).success).toBe(true);
    }
    for (const k of TEST_TEMPLATES) expect(testTemplate(k, "en").protocol.length).toBeGreaterThan(20);
    // Suggested indicators are definitions only: no value anywhere.
    expect(metricSuggestions("fr").every((m) => !("value" in m))).toBe(true);
  });
});
