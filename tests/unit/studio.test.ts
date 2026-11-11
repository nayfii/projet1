import { describe, expect, it } from "vitest";
import { blocksText, blocksToMarkdown, linkedDocumentIds, type Block } from "@/modules/studio/logic/blocks";
import { docToken, hasMarks, parseInline, wrapSelection } from "@/modules/studio/logic/inline";
import { between, dueTone, focusTasks, indicators, matchesFilter, milestoneProgress, NO_FILTER, upcomingMilestones } from "@/modules/studio/logic/plan";
import { editDistance, matchScore, normalize, rank, snippet } from "@/modules/studio/logic/search";
import { dateAt, monthTicks, packRows, timelineRange, xOf } from "@/modules/studio/logic/timeline";
import type { Milestone, Task } from "@/modules/studio/types";

const today = "2026-11-11"; // a Wednesday

let n = 0;
function task(values: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `t${n}`,
    title: `Tâche ${n}`,
    description: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    category_id: null,
    milestone_id: null,
    sort_order: n,
    completed_at: null,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    archived_at: null,
    ...values,
  };
}
function milestone(values: Partial<Milestone> = {}): Milestone {
  n += 1;
  return { id: `m${n}`, title: `Jalon ${n}`, description: null, target_date: null, achieved_date: null, status: "planned", category_id: null, sort_order: n, created_at: "", updated_at: "", archived_at: null, ...values };
}

describe("search that forgives typos", () => {
  it("ignores accents and case, and finds a word with a typo or two", () => {
    expect(normalize("Stratégie — ICP")).toBe("strategie icp");
    expect(matchScore("strategie", "Stratégie")).toBeGreaterThan(2);
    expect(matchScore("stratgie", "Stratégie commerciale")).toBeGreaterThan(0);
    expect(matchScore("intervewer", "Interviewer cinq agences")).toBeGreaterThan(0);
    expect(matchScore("comunication", "agences de communication")).toBeGreaterThan(0);
    expect(matchScore("pricng", "Valider le pricing")).toBeGreaterThan(0);
  });

  it("does not match unrelated words, nor short words with a typo", () => {
    expect(matchScore("budget", "Interviewer cinq agences")).toBe(0);
    expect(matchScore("icq", "ICP")).toBe(0);
    expect(matchScore("", "ICP")).toBe(0);
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(editDistance("kitten", "sitting", 2)).toBe(3);
  });

  it("ranks the exact title first, and finds an item by its other texts (category, tags)", () => {
    const docs = [
      { title: "Go-to-Market Strategy", tags: ["ICP"] },
      { title: "ICP — Ideal Customer Profile", tags: [] },
      { title: "Budget 2027", tags: [] },
    ];
    const found = rank("icp", docs, (d) => [d.title, ...d.tags]).map((r) => r.item.title);
    expect(found).toEqual(["ICP — Ideal Customer Profile", "Go-to-Market Strategy"]);
  });

  it("shows a passage around the word found, without the document links' marks", () => {
    const text = `${"Introduction. ".repeat(20)}Notre cible : les agences de communication de 10 à 25 personnes. ${"Suite. ".repeat(20)}`;
    const s = snippet(text, "agences", 80);
    expect(s).toContain("agences de communication");
    expect(s.startsWith("…")).toBe(true);
    expect(snippet("Voir [[doc:11111111-1111-1111-1111-111111111111]] et **le budget**", "budget")).toBe("Voir et le budget");
  });
});

describe("today's focus, chosen from the tasks", () => {
  it("puts late and today's tasks first, then high priority and work in progress, at most five", () => {
    const tasks = [
      task({ title: "Basse", priority: "low" }),
      task({ title: "En retard", due_date: "2026-11-09" }),
      task({ title: "Haute", priority: "high" }),
      task({ title: "Aujourd'hui", due_date: today }),
      task({ title: "En cours", status: "in_progress" }),
      task({ title: "Bientôt", due_date: "2026-11-13" }),
      task({ title: "Faite", priority: "high", status: "done" }),
      task({ title: "Archivée", priority: "high", archived_at: "2026-11-01T00:00:00Z" }),
    ];
    const focus = focusTasks(tasks, today);
    expect(focus.map((f) => f.task.title)).toEqual(["En retard", "Aujourd'hui", "Haute", "En cours", "Bientôt"]);
    expect(focus.map((f) => f.reason)).toEqual(["overdue", "today", "high", "in_progress", "soon"]);
  });

  it("when nothing stands out, offers the next tasks by priority (three at most); nothing when there is nothing", () => {
    const focus = focusTasks([task({ title: "B", priority: "low" }), task({ title: "A" }), task({ title: "C" }), task({ title: "D" })], today);
    expect(focus.map((f) => f.task.title)).toEqual(["A", "C", "D"]);
    expect(focus.every((f) => f.reason === "next")).toBe(true);
    expect(focusTasks([], today)).toEqual([]);
  });

  it("tells late, today and soon apart", () => {
    expect(dueTone("2026-11-10", today)).toBe("overdue");
    expect(dueTone(today, today)).toBe("today");
    expect(dueTone("2026-11-14", today)).toBe("soon");
    expect(dueTone("2026-11-20", today)).toBeNull();
    expect(dueTone(null, today)).toBeNull();
  });
});

describe("a milestone's progress and the overview's numbers come from the tasks", () => {
  it("counts the milestone's done tasks (cancelled and archived ones do not count)", () => {
    const m = milestone();
    const tasks = [
      task({ milestone_id: m.id, status: "done" }),
      task({ milestone_id: m.id, status: "done" }),
      task({ milestone_id: m.id, status: "done" }),
      task({ milestone_id: m.id }),
      task({ milestone_id: m.id, status: "cancelled" }),
      task({ milestone_id: m.id, archived_at: "2026-11-01T00:00:00Z" }),
      task({ milestone_id: "other", status: "done" }),
    ];
    expect(milestoneProgress(m.id, tasks)).toEqual({ done: 3, total: 4, ratio: 0.75 });
    expect(milestoneProgress("empty", tasks)).toEqual({ done: 0, total: 0, ratio: null });
  });

  it("counts open high priorities, what was done since Monday, the next milestone and the roadmap", () => {
    const next = milestone({ title: "Prochain", target_date: "2026-11-20" });
    const later = milestone({ target_date: "2026-12-20" });
    const undated = milestone();
    const reached = milestone({ status: "done", target_date: "2026-11-01" });
    const tasks = [
      task({ priority: "high" }),
      task({ priority: "high", status: "in_progress" }),
      task({ priority: "high", status: "done", completed_at: "2026-11-10T09:00:00Z" }),
      task({ status: "done", completed_at: "2026-11-08T09:00:00Z" }), // the Sunday before: last week
    ];
    const numbers = indicators(tasks, [later, next, undated, reached, milestone({ archived_at: "2026-11-01T00:00:00Z" })], today);
    expect(numbers.highOpen).toBe(2);
    expect(numbers.doneThisWeek).toBe(1);
    expect(numbers.nextMilestone?.title).toBe("Prochain");
    expect(numbers.roadmap).toEqual({ done: 1, total: 4 });
    expect(upcomingMilestones([undated, later, next]).map((m) => m.id)).toEqual([next.id, later.id, undated.id]);
  });
});

describe("filters and order", () => {
  it("filters by priority, status, due date, category and words", () => {
    const t = task({ title: "Relire le pricing", priority: "high", status: "in_progress", due_date: "2026-11-12", category_id: "c1" });
    expect(matchesFilter(t, NO_FILTER, today)).toBe(true);
    expect(matchesFilter(t, { ...NO_FILTER, priorities: ["low"] }, today)).toBe(false);
    expect(matchesFilter(t, { ...NO_FILTER, statuses: ["in_progress"] }, today)).toBe(true);
    expect(matchesFilter(t, { ...NO_FILTER, due: "week" }, today)).toBe(true);
    expect(matchesFilter(t, { ...NO_FILTER, due: "overdue" }, today)).toBe(false);
    expect(matchesFilter(t, { ...NO_FILTER, due: "none" }, today)).toBe(false);
    expect(matchesFilter(t, { ...NO_FILTER, categories: ["none"] }, today)).toBe(false);
    expect(matchesFilter(t, { ...NO_FILTER, query: "pricng" }, today)).toBe(true);
  });

  it("places a dragged task between its neighbours", () => {
    expect(between(1, 2)).toBe(1.5);
    expect(between(undefined, 3)).toBe(2);
    expect(between(4, undefined)).toBe(5);
    expect(between(undefined, undefined)).toBe(0);
  });
});

describe("the roadmap's timeline", () => {
  it("covers whole months around today and the milestones, and turns dates into positions and back", () => {
    const range = timelineRange(["2027-03-10"], today, "month");
    expect(range.start).toBe("2026-10-01");
    expect(range.end).toBe("2027-04-30");
    expect(xOf("2026-10-11", range.start, "month")).toBe(100);
    expect(dateAt(100, range.start, "month")).toBe("2026-10-11");
    expect(dateAt(-50, range.start, "month")).toBe(range.start);
    const ticks = monthTicks(range.start, range.end, "month");
    expect(ticks[0]).toEqual({ iso: "2026-10-01", x: 0, width: 310 });
    expect(ticks.map((t) => t.iso).at(-1)).toBe("2027-04-01");
  });

  it("puts close milestones on separate lines so cards never overlap", () => {
    const { row, rows } = packRows(
      [
        { id: "a", x: 0 },
        { id: "b", x: 100 },
        { id: "c", x: 300 },
        { id: "d", x: 120 },
      ],
      236,
    );
    expect(rows).toBe(3);
    expect(row.get("a")).toBe(0);
    expect(row.get("b")).toBe(1);
    expect(row.get("d")).toBe(2);
    // Far enough from the first card: back on the first line.
    expect(row.get("c")).toBe(0);
  });
});

describe("documents: formatting, links between documents, export", () => {
  const icp = "11111111-1111-1111-1111-111111111111";

  it("reads bold, italic, links and links to documents", () => {
    expect(parseInline(`Voir **l'ICP** et *le pricing* sur [le site](https://cendr.fr) ou ${docToken(icp)}.`)).toEqual([
      { kind: "text", text: "Voir " },
      { kind: "bold", text: "l'ICP" },
      { kind: "text", text: " et " },
      { kind: "italic", text: "le pricing" },
      { kind: "text", text: " sur " },
      { kind: "link", text: "le site", url: "https://cendr.fr" },
      { kind: "text", text: " ou " },
      { kind: "doc", id: icp },
      { kind: "text", text: "." },
    ]);
    expect(hasMarks("Texte simple")).toBe(false);
    expect(hasMarks("un **mot**")).toBe(true);
  });

  it("wraps a selection in bold or italic, and takes the marks off again", () => {
    const bold = wrapSelection("le pricing", 3, 10, "bold");
    expect(bold).toEqual({ text: "le **pricing**", start: 5, end: 12 });
    expect(wrapSelection(bold.text, bold.start, bold.end, "bold")).toEqual({ text: "le pricing", start: 3, end: 10 });
    expect(wrapSelection("le pricing", 3, 10, "italic").text).toBe("le *pricing*");
    expect(wrapSelection("le pricing", 3, 10, "link", "https://x.fr").text).toBe("le [pricing](https://x.fr)");
  });

  it("lists the documents a document links to, and exports them with their titles", () => {
    const blocks: Block[] = [
      { id: "1", type: "p", text: `Base : ${docToken(icp)}` },
      { id: "2", type: "toggle", text: "Détails", body: "Le **budget** est validé." },
      { id: "3", type: "image", text: "Schéma", path: `doc/${icp}/${icp}.png` },
    ];
    expect(linkedDocumentIds(blocks)).toEqual([icp]);
    expect(blocksText(blocks)).toContain("Le **budget** est validé.");
    const md = blocksToMarkdown("Go-to-Market", blocks, { hypothesis: "Hypothèse", fact: "Fait", decision: "Décision", image: "Image" }, (id) => (id === icp ? "ICP" : null));
    expect(md).toContain("Base : ICP");
    expect(md).toContain("**Détails**");
    expect(md).toContain("*Image — Schéma*");
  });
});
