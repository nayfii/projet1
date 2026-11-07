"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn, initials } from "@/lib/utils";

function Avatar({
  name,
  src,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative inline-flex size-8 shrink-0 overflow-hidden rounded-full bg-[var(--avatar-surface)] ring-1 ring-[var(--avatar-ring)]", className)}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-[11px] font-semibold text-[var(--avatar-foreground)]">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
