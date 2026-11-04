"use client";

import { Toaster as Sonner } from "sonner";

function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          // Solid glass (sonner's own styles are unlayered, hence the !important utilities).
          toast:
            "!rounded-2xl !border !border-[var(--glass-border)] !bg-[var(--glass-solid)] !text-popover-foreground !text-sm ![backdrop-filter:blur(var(--glass-blur))_saturate(var(--glass-saturate))] !shadow-[inset_0_1px_0_0_var(--glass-highlight),0_0_0_1px_var(--glass-ring),0_18px_44px_-20px_var(--glass-shadow-color)]",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
