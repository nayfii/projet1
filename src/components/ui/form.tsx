"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2Icon } from "lucide-react";
import { Label } from "./label";
import { Button } from "./button";
import { cn } from "@/lib/utils";

function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[13px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return <Loader2Icon className={cn("size-4 animate-spin", className)} aria-hidden />;
}

/** Submit button that shows a spinner while its form's server action runs. */
function SubmitButton({ children, pending: pendingProp, ...props }: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Spinner /> : null}
      {children}
    </Button>
  );
}

function FormMessage({ tone = "error", children }: { tone?: "error" | "success"; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2 text-[13px]",
        tone === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success",
      )}
    >
      {children}
    </p>
  );
}

export { Field, Spinner, SubmitButton, FormMessage };
