"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { assistantFor, blinkDelay, ROBOT_FACE, type AssistantState } from "../assistants";
import type { ProviderId } from "@/modules/providers/types";

/**
 * An AI assistant's 3D robot with a live face on its visor: it blinks at rest, glances around while
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
      style={{ width: size, height: size, "--tint": persona.tint, "--blink-delay": `${blinkDelay(seed + persona.id)}s` } as React.CSSProperties}
    >
      {active ? <span className="assistant-halo absolute -inset-[18%] rounded-full" /> : null}
      <span className="relative size-full rounded-full bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklch,var(--tint)_38%,transparent),color-mix(in_oklch,var(--tint)_10%,transparent)_72%)] ring-1 ring-white/[0.06]">
        <span className="assistant-figure absolute inset-[6%]">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static asset, no optimisation needed */}
          <img src={persona.image} alt="" draggable={false} className="size-full select-none" />
          <svg viewBox="0 0 256 256" className="assistant-face absolute inset-0 size-full overflow-visible">
            <g className="assistant-eyes">
              {ROBOT_FACE.eyes.map((e) => (
                <g key={e.x} className="assistant-eye">
                  <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.w / 2} />
                  <rect className="assistant-shine" x={e.x + 4} y={e.y + 4} width={e.w * 0.32} height={e.h * 0.3} rx={3} />
                </g>
              ))}
            </g>
            <g className="assistant-smile">
              {ROBOT_FACE.eyes.map((e) => (
                <path key={e.x} d={`M${e.x - 2} ${e.y + e.h * 0.62} Q${e.x + e.w / 2} ${e.y + 4} ${e.x + e.w + 2} ${e.y + e.h * 0.62}`} />
              ))}
            </g>
            <rect className="assistant-mouth" x={ROBOT_FACE.mouth.x} y={ROBOT_FACE.mouth.y} width={ROBOT_FACE.mouth.w} height={ROBOT_FACE.mouth.h} rx={ROBOT_FACE.mouth.h / 2} />
          </svg>
        </span>
      </span>
    </span>
  );
}
