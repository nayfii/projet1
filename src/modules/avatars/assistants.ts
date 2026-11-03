import type { ProviderId } from "@/modules/providers/types";

/**
 * The AI assistants' characters (CLAUDE.md §11): one glossy 3D robot per provider, plus "auto" (the
 * Smart Router), after Microsoft's Fluent Emoji "Robot" (MIT licence, public/avatars/assistants/
 * LICENSE-fluent-emoji.txt). The images have no eyes or mouth (scripts/avatars/fluent-assistants.py):
 * the app draws them live (assistant-avatar.tsx) so the robot blinks, thinks, talks and smiles.
 */
export type AssistantId = ProviderId | "auto";

export type AssistantPersona = {
  id: AssistantId;
  image: string;
  /** Pastel token behind the character (globals.css). */
  tint: string;
};

export const ASSISTANTS: Record<AssistantId, AssistantPersona> = {
  openai: { id: "openai", image: "/avatars/assistants/openai.webp", tint: "var(--pastel-mint)" },
  anthropic: { id: "anthropic", image: "/avatars/assistants/anthropic.webp", tint: "var(--pastel-peach)" },
  google: { id: "google", image: "/avatars/assistants/google.webp", tint: "var(--pastel-sky)" },
  auto: { id: "auto", image: "/avatars/assistants/auto.webp", tint: "var(--pastel-lavender)" },
};

/** Where the face is drawn, in the 256 px image's own units. */
export const ROBOT_FACE = {
  eyes: [
    { x: 75, y: 95, w: 20, h: 37 },
    { x: 162, y: 95, w: 20, h: 37 },
  ],
  mouth: { x: 100, y: 187, w: 56, h: 17 },
} as const;

/** idle: at rest · thinking: preparing an answer · speaking: writing it · happy: just finished. */
export type AssistantState = "idle" | "thinking" | "speaking" | "happy";

export function assistantFor(provider: ProviderId | null | undefined): AssistantPersona {
  return ASSISTANTS[provider ?? "auto"] ?? ASSISTANTS.auto;
}

/** A stable small offset so several avatars on screen never blink in sync. */
export function blinkDelay(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return (Math.abs(h) % 4000) / 1000;
}
