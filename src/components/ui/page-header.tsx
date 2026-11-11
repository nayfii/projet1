import * as React from "react";
import { cn } from "@/lib/utils";

function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A page's frame. Every page of a space starts at the same left edge, so the title does not jump from
 * one page to the next; `className` narrows the content (a form, a short list) without moving that edge.
 * The frame is 64rem wide, or what the space sets in `--page-frame` (our console: 72rem).
 */
function PageContainer({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className="mx-auto w-full max-w-[var(--page-frame,64rem)] px-4 py-8 sm:px-8 sm:py-10" {...props}>
      <div className={cn("w-full max-w-5xl", className)}>{children}</div>
    </div>
  );
}

export { PageHeader, PageContainer };
