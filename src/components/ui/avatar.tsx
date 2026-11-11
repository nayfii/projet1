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
      className={cn("avatar-glass inline-flex size-8 shrink-0 overflow-hidden rounded-full", className)}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="relative z-[1] size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="relative z-[1] flex size-full items-center justify-center text-[11px] font-semibold text-[var(--avatar-foreground)]">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
