"use client";

import * as React from "react";
import { milestoneProgress, type Progress } from "../logic/plan";
import type { Category, DocumentMeta, Milestone } from "../types";
import { useCategoryName, useDates } from "./primitives";
import { useStudio } from "./store";

/** Lookups shared by every section (computed once per change of the data). */
export function useIndex() {
  const data = useStudio();
  return React.useMemo(() => {
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    const documents = new Map(data.documents.map((d) => [d.id, d]));
    const milestones = new Map(data.milestones.map((m) => [m.id, m]));
    const progress = new Map<string, Progress>(data.milestones.map((m) => [m.id, milestoneProgress(m.id, data.tasks)]));
    const docsOfTask = (taskId: string): DocumentMeta[] => data.taskDocuments.filter((l) => l.task_id === taskId).map((l) => documents.get(l.document_id)).filter((d): d is DocumentMeta => Boolean(d));
    const docsOfMilestone = (milestoneId: string): DocumentMeta[] => data.milestoneDocuments.filter((l) => l.milestone_id === milestoneId).map((l) => documents.get(l.document_id)).filter((d): d is DocumentMeta => Boolean(d));
    return { categories, documents, milestones, progress, docsOfTask, docsOfMilestone };
  }, [data]);
}

/** Milestones to pick from (still ahead first), with their date as a hint. */
export function useMilestoneItems(): { id: string; label: string; hint?: string }[] {
  const data = useStudio();
  const dates = useDates();
  return React.useMemo(
    () =>
      data.milestones
        .filter((m) => !m.archived_at)
        .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"))
        .map((m: Milestone) => ({ id: m.id, label: m.title, hint: m.target_date ? dates.short(m.target_date) : undefined })),
    [data.milestones, dates],
  );
}

export function useCategoryLabel() {
  const index = useIndex();
  const name = useCategoryName();
  return React.useCallback((id: string | null) => (id ? name(index.categories.get(id) as Category | undefined) : null), [index, name]);
}
