"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PLATFORM_LAST_PATH, SCALE_LAST_PATH } from "./nav";

/**
 * Remembers the last page seen in a space (this browser only), so switching between our console and
 * Scale brings each one back where it was left. Renders nothing.
 */
export function RememberSpacePath({ space }: { space: "platform" | "scale" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  React.useEffect(() => {
    // Arriving through the console's link: the page to go back to is read first, not overwritten.
    if (params.get("resume")) return;
    const qs = new URLSearchParams(params.toString());
    qs.delete("resume");
    qs.delete("open");
    qs.delete("full");
    const path = qs.toString() ? `${pathname}?${qs}` : pathname;
    try {
      localStorage.setItem(space === "platform" ? PLATFORM_LAST_PATH : SCALE_LAST_PATH, path);
    } catch {
      // Not kept: each space opens on its home page.
    }
  }, [pathname, params, space]);
  return null;
}

export function lastPath(space: "platform" | "scale"): string | null {
  try {
    const value = localStorage.getItem(space === "platform" ? PLATFORM_LAST_PATH : SCALE_LAST_PATH);
    const prefix = space === "platform" ? "/platform" : "/scale";
    return value && (value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)) ? value : null;
  } catch {
    return null;
  }
}
