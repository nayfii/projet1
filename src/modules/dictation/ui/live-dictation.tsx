import { cn } from "@/lib/utils";

/**
 * What has been transcribed so far, while the person is still talking: the latest words stay in
 * view (older lines slide out at the top). It is a preview only; the text lands in the field, made
 * ready to read, when they stop.
 */
export function LiveDictation({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} data-testid="dictation-live" className={cn("flex max-h-[4.25rem] flex-col justify-end overflow-hidden", className)}>
      <p className="whitespace-pre-wrap break-words text-sm leading-[1.4rem] text-muted-foreground animate-message-in">{text}</p>
    </div>
  );
}
