"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { assistantFor, blinkDelay, type AssistantState } from "../assistants";
import type { ProviderId } from "@/modules/providers/types";

/**
 * An AI assistant's 3D character with a live face on its visor: it blinks at rest, looks up while
 * it thinks, talks while it writes and smiles when it is done. Decorative: the assistant's name is
 * always written next to it. Motion only plays when `animated` (the active assistant), so a long
 * thread stays calm, and never for people who ask for reduced motion (globals.css).
 */
export function AssistantAvatar({
  provider,
  size = 32,
  state = "idle",
  animated = false,
  seed = "",
  halo,
  className,
}: {
  provider: ProviderId | "auto" | null | undefined;
  size?: number;
  state?: AssistantState;
  animated?: boolean;
  seed?: string;
  /** A soft glow behind the character; by default while it works. */
  halo?: boolean;
  className?: string;
}) {
  const persona = assistantFor(provider === "auto" ? null : provider);
  const active = halo ?? (animated && state !== "idle");
  return (
    <span
      aria-hidden
      data-assistant={persona.id}
      data-state={state}
      data-animated={animated || undefined}
      className={cn("assistant-avatar relative inline-flex shrink-0", className)}
      style={{ width: size, height: size, "--tint": persona.tint, "--glow": persona.glow, "--blink-delay": `${blinkDelay(seed + persona.id)}s` } as React.CSSProperties}
    >
      {active ? <span className="assistant-halo absolute -inset-[18%] rounded-full" /> : null}
      <span className="relative size-full overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_32%,color-mix(in_oklch,var(--tint)_42%,transparent),color-mix(in_oklch,var(--tint)_12%,transparent)_72%)] ring-1 ring-white/[0.06]">
        <span className="assistant-figure absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static asset, no optimisation needed */}
          <img src={persona.image} alt="" draggable={false} className="size-full select-none" />
          <svg
            viewBox="0 0 100 61"
            className="assistant-face absolute overflow-visible"
            style={{ left: `${persona.face.x * 100}%`, top: `${persona.face.y * 100}%`, width: `${persona.face.w * 100}%`, height: `${persona.face.h * 100}%` }}
          >
            <g className="assistant-eyes">
              <rect className="assistant-eye" x="27" y="17" width="11" height="24" rx="5.5" />
              <rect className="assistant-eye" x="62" y="17" width="11" height="24" rx="5.5" />
            </g>
            <g className="assistant-smile">
              <path d="M26 33 Q32.5 22 39 33" />
              <path d="M61 33 Q67.5 22 74 33" />
            </g>
            <rect className="assistant-mouth" x="43" y="45" width="14" height="4" rx="2" />
          </svg>
        </span>
      </span>
    </span>
  );
}
