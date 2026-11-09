"use client";

import * as React from "react";
import { addDays, todayIso, weekStart } from "../logic/dates";
import { isClosedTask, openBlockers, type Edge } from "../logic/planning";
import type { CompanyLink, Milestone, Project, Task, Test } from "../types";
import { useScale } from "./store";

/** Lookups every view needs, computed once per change of the shared records. */
export function useIndex() {
  const data = useScale();
  return React.useMemo(() => {
    const today = todayIso();
    const monday = weekStart(today);
    const live = <T extends { archived_at: string | null }>(list: T[]) => list.filter((x) => !x.archived_at);
    const tasks = live(data.tasks);
    const projects = live(data.projects);
    const milestones = live(data.milestones);
    const tests = live(data.tests);
    const objectives = live(data.objectives);

    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const projectById = new Map(data.projects.map((p) => [p.id, p]));
    const milestoneById = new Map(data.milestones.map((m) => [m.id, m]));
    const objectiveById = new Map(data.objectives.map((o) => [o.id, o]));
    const testById = new Map(data.tests.map((t) => [t.id, t]));
    const companyById = new Map(data.companies.map((c) => [c.id, c]));
    const personById = new Map(data.team.map((m) => [m.id, m]));

    const group = <T, K extends string>(list: T[], key: (x: T) => K | null) => {
      const map = new Map<K, T[]>();
      for (const x of list) {
        const k = key(x);
        if (k) map.set(k, [...(map.get(k) ?? []), x]);
      }
      return map;
    };
    const tasksByProject = group<Task, string>(tasks, (t) => t.project_id);
    const subtasksByParent = group<Task, string>(tasks, (t) => t.parent_id);
    const milestonesByProject = group<Milestone, string>(milestones, (m) => m.project_id);
    const projectsByObjective = group<Project, string>(projects, (p) => p.objective_id);
    const testsByProject = group<Test, string>(tests, (t) => t.project_id);
    const linksByEntity = group<CompanyLink, string>(data.links, (l) => `${l.entity_type}:${l.entity_id}`);
    const linksByCompany = group<CompanyLink, string>(data.links, (l) => l.company_id);

    const taskEdges: Edge[] = data.taskDeps.map((d) => ({ from: d.task_id, to: d.depends_on_id }));
    const projectEdges: Edge[] = data.projectDeps.map((d) => ({ from: d.project_id, to: d.depends_on_id }));
    const blockersOf = (taskId: string) => openBlockers(taskId, taskEdges, taskById);

    const week = data.weeks.find((w) => w.week_start === monday) ?? null;
    const capacityFor = (m: string) => {
      const w = data.weeks.find((x) => x.week_start === m);
      return w?.capacity_hours ?? data.settings?.weekly_capacity_hours ?? null;
    };

    const focus = objectives.find((o) => o.is_focus) ?? null;
    const openTasks = tasks.filter((t) => !isClosedTask(t));

    return {
      today,
      monday,
      nextMonday: addDays(monday, 7),
      tasks,
      openTasks,
      projects,
      milestones,
      tests,
      objectives,
      taskById,
      projectById,
      milestoneById,
      objectiveById,
      testById,
      companyById,
      personById,
      tasksByProject,
      subtasksByParent,
      milestonesByProject,
      projectsByObjective,
      testsByProject,
      linksByEntity,
      linksByCompany,
      taskEdges,
      projectEdges,
      blockersOf,
      week,
      capacityFor,
      focus,
    };
  }, [data]);
}

export type ScaleIndex = ReturnType<typeof useIndex>;

/** Due-date tone: overdue in red, within two days in amber (with the date written next to it). */
export function dueTone(date: string | null, today: string, closed = false): "overdue" | "soon" | null {
  if (!date || closed) return null;
  if (date < today) return "overdue";
  if (date <= addDays(today, 2)) return "soon";
  return null;
}
