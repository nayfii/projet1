"use client";

import * as React from "react";
import dynamic from "next/dynamic";

/** The Waylume scene's code (about 75 kB) loads only for people who choose it. */
const WaylumeBackground = dynamic(() => import("./WaylumeBackground"), { ssr: false });

type Snapshot = "off" | "on" | "paused";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-ambient", "data-motion", "data-perf"] });
  return () => observer.disconnect();
}

function snapshot(): Snapshot {
  const root = document.documentElement;
  if (root.dataset.theme !== "atmosphere" || root.dataset.ambient !== "waylume") return "off";
  return root.dataset.motion === "off" || root.dataset.perf === "low" ? "paused" : "on";
}

/**
 * The Waylume background of the Atmosphère interface, when that palette is chosen. It follows the
 * same rules as our own backgrounds: still when motion is off or the device is low-power (Waylume
 * itself pauses in hidden tabs and shows a still frame for reduced motion). Nothing runs otherwise.
 */
export function WaylumeLayer() {
  const state = React.useSyncExternalStore(subscribe, snapshot, () => "off" as Snapshot);
  if (state === "off") return null;
  return <WaylumeBackground paused={state === "paused"} />;
}

/** A still Waylume frame, for the palette tile in Settings → Appearance. */
export function WaylumePreview() {
  return <WaylumeBackground paused />;
}
