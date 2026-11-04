import * as React from "react";
import { cn } from "@/lib/utils";
import { LiquidGlass } from "./liquid-glass";

/**
 * A pane of glass. `liquid` makes it Liquid Glass (its rim bends the background): only for panes of
 * bounded size, such as tiles and key figures, because the bend is computed for every pixel of the
 * pane. Content cards (tables, lists, forms) stay frosted glass, without that cost.
 */
function Card({ className, liquid = false, ...props }: React.ComponentProps<"div"> & { liquid?: boolean }) {
  if (liquid) {
    return <LiquidGlass material="card" reach={32} data-slot="card" className={cn("rounded-2xl border text-card-foreground", className)} {...props} />;
  }
  return <div data-slot="card" className={cn("glass-standard rounded-2xl border text-card-foreground has-[table]:bg-[var(--glass-solid)]", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-0", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[15px] font-semibold tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
