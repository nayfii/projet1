/** Sections of a Smart Handover file (CLAUDE.md §4.4), in display order. */
export const HANDOVER_SECTIONS = ["summary", "decisions", "documents", "tasks", "next_actions"] as const;
export type HandoverSections = Record<(typeof HANDOVER_SECTIONS)[number], string>;
