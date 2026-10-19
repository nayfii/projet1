"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * AI answers rendered as Markdown. Raw HTML in the text is never rendered (react-markdown's default),
 * so a model cannot inject markup or scripts into the page.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown text-[15px] leading-7", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table>{children}</table>
    </div>
  ),
};

function CodeBlock({ children }: { children: React.ReactNode }) {
  const t = useTranslations("chat");
  const ref = React.useRef<HTMLPreElement>(null);
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="group relative my-4">
      <pre ref={ref} className="overflow-x-auto rounded-lg border bg-muted/60 p-4 font-mono text-[13px] leading-6">
        {children}
      </pre>
      <button
        type="button"
        aria-label={t("copyCode")}
        onClick={async () => {
          await navigator.clipboard.writeText(ref.current?.innerText ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}
