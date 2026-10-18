"use client";

import { Toaster as Sonner } from "sonner";

function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-md !text-sm",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
