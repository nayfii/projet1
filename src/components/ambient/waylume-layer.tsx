"use client";

import * as React from "react";
import dynamic from "next/dynamic";

/** The Waylume scenes' code (about 75 kB each) loads only for people who choose one. */
const WaylumeBackground = dynamic(() => import("./WaylumeBackground"), { ssr: false });
const WaylumeNightBackground = dynamic(() => import("./WaylumeNightBackground"), { ssr: false });

const SCENES = { waylume: WaylumeBackground, waylumeNight: WaylumeNightBackground } as const;
type Variant = keyof typeof SCENES;

/** "off", or "<variant>:<on|paused|light>". */
type Snapshot = "off" | `${Variant}:${"on" | "paused" | "light"}`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-ambient", "data-motion", "data-perf", "data-glass"] });
  return () => observer.disconnect();
}

function snapshot(): Snapshot {
  const root = document.documentElement;
  const variant = root.dataset.ambient as Variant | undefined;
  if (root.dataset.theme !== "atmosphere" || !variant || !(variant in SCENES)) return "off";
  if (root.dataset.motion === "off" || root.dataset.perf === "low") return `${variant}:paused`;
  // A graphics chip that struggles (frame-rate check): the scene is drawn at half resolution.
  return root.dataset.glass === "flat" ? `${variant}:light` : `${variant}:on`;
}

/**
 * The Waylume backgrounds of the Atmosphère interface, when one is chosen. Same rules as our own
 * backgrounds: still when motion is off or the device has no graphics chip; drawn at half resolution
 * (a quarter of the pixels) when the device struggles. Waylume itself pauses offscreen and in hidden
 * tabs and shows a still frame for reduced motion. Nothing runs otherwise.
 */
export function WaylumeLayer() {
  const state = React.useSyncExternalStore(subscribe, snapshot, () => "off" as Snapshot);
  if (state === "off") return null;
  const [variant, mode] = state.split(":") as [Variant, "on" | "paused" | "light"];
  const Scene = SCENES[variant];
  if (mode === "light") {
    return (
      <div aria-hidden className="absolute left-0 top-0 h-1/2 w-1/2 origin-top-left scale-[2]">
        <Scene />
      </div>
    );
  }
  return <Scene paused={mode === "paused"} />;
}

/** A still frame of a Waylume scene, for the palette tile in Settings → Appearance. */
export function WaylumePreview({ variant = "waylume" }: { variant?: string }) {
  const Scene = SCENES[(variant in SCENES ? variant : "waylume") as Variant];
  return <Scene paused />;
}
