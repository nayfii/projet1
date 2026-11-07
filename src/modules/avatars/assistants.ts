import type { ProviderId } from "@/modules/providers/types";

/**
 * Who can answer: a provider's model, or "auto" (the Smart Router). Since 2026-11-07 (founder's
 * request) each is shown by its provider's own logo (modules/avatars/ui/assistant-avatar.tsx), not by
 * the 3D robots of Step 11.
 */
export type AssistantId = ProviderId | "auto";

/** idle: at rest · thinking: preparing an answer · speaking: writing it · happy: just finished. */
export type AssistantState = "idle" | "thinking" | "speaking" | "happy";
