import type { ProviderId } from "@/modules/providers/types";

/**
 * The AI assistants' characters. One per provider, plus "auto" (the Smart Router).
 * Images are rendered by scripts/avatars/render-assistants.mjs with a blank glass visor;
 * `face` is that visor's box on the image (fractions), where the live face is drawn.
 */
export type AssistantId = ProviderId | "auto";

export type AssistantPersona = {
  id: AssistantId;
  image: string;
  /** Pastel token behind the character (globals.css). */
  tint: string;
  /** Colour of the eyes' glow. */
  glow: string;
  face: { x: number; y: number; w: number; h: number };
};

export const ASSISTANTS: Record<AssistantId, AssistantPersona> = {
  openai: { id: "openai", image: "/avatars/assistants/openai.webp", tint: "var(--pastel-mint)", glow: "#dcfff0", face: { x: 0.278, y: 0.297, w: 0.411, h: 0.251 } },
  anthropic: { id: "anthropic", image: "/avatars/assistants/anthropic.webp", tint: "var(--pastel-peach)", glow: "#fff0e6", face: { x: 0.272, y: 0.299, w: 0.423, h: 0.247 } },
  google: { id: "google", image: "/avatars/assistants/google.webp", tint: "var(--pastel-sky)", glow: "#e6efff", face: { x: 0.277, y: 0.291, w: 0.413, h: 0.264 } },
  auto: { id: "auto", image: "/avatars/assistants/auto.webp", tint: "var(--pastel-lavender)", glow: "#efecff", face: { x: 0.278, y: 0.297, w: 0.411, h: 0.251 } },
};

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
