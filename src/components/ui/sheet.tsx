"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({
  className,
  children,
  title,
  side = "left",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { title: string; side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.02_var(--tint-h)/0.3)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "left"
            ? "glass-elevated left-0 w-72 max-w-[85vw] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
            : "glass-solid right-0 w-[30rem] max-w-[94vw] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };
