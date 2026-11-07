"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon, FileTextIcon, MailIcon, MessageCircleIcon, Share2Icon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { linkCitations } from "@/modules/memory/citations";
import { parseChartSpec } from "../chart-spec";
import { Chart } from "./chart";
import { editPlanSchema } from "@/modules/render/edit-plan";
import { EditPlanView } from "@/modules/render/ui/edit-plan-view";

/**
 * AI answers rendered as Markdown. Raw HTML in the text is never rendered (react-markdown's default),
 * so a model cannot inject markup or scripts into the page.
 */
function MarkdownView({ children, className, onCite }: { children: string; className?: string; onCite?: (position: number) => void }) {
  // "[S1]" citations become small badges that open the Source Proof.
  const content = onCite ? linkCitations(children) : children;
  const withCitations = React.useMemo<Components>(
    () => ({
      ...components,
      a: ({ href, title, children: label }) => {
        const cite = href?.match(/^#source-(\d+)$/);
        if (cite && onCite) {
          return (
            <button
              type="button"
              onClick={() => onCite(Number(cite[1]))}
              className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded bg-brand-soft px-1 align-middle text-[10px] font-semibold leading-none text-brand hover:bg-brand hover:text-brand-foreground"
            >
              {cite[1]}
            </button>
          );
        }
        return components.a ? (components.a as (p: { href?: string; title?: string; children?: React.ReactNode }) => React.ReactNode)({ href, title, children: label }) : null;
      },
    }),
    [onCite],
  );
  return (
    <div className={cn("markdown text-[15px] leading-7", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={withCitations}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoised: an answer is parsed again only when its text changes (not when the person types, or when
 * another answer streams). Parsing Markdown is the costliest part of drawing a conversation.
 */
export const Markdown = React.memo(MarkdownView);

const components: Components = {
  // Images in an answer are never loaded: a planted instruction could otherwise make the AI write an
  // image whose address carries restored values to an outside server. Its description is shown instead.
  img: ({ alt }) => (alt ? <span className="italic text-muted-foreground">{alt}</span> : null),
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  pre: ({ children, node }) => {
    // A ```chart block holding a valid spec is drawn; anything else stays a code block.
    const code = node?.children[0];
    const lang = code?.type === "element" && code.tagName === "code" ? String(code.properties.className ?? "") : "";
    const text = code?.type === "element" ? code.children.map((c) => (c.type === "text" ? c.value : "")).join("") : "";
    if (lang.includes("language-chart")) {
      const spec = parseChartSpec(text);
      if (spec) return <Chart spec={spec} />;
    }
    // Ready-to-send content (email, message, post, prompt…): a card to edit and copy.
    const copyKind = /language-copy-(email|message|linkedin|prompt|text)\b/.exec(lang)?.[1];
    if (copyKind) return <CopyBlock kind={copyKind as CopyKind} text={text.replace(/\n$/, "")} />;
    // Motion Design: the animation is previewed under the answer; its code stays available, folded.
    if (lang.includes("language-hyperframes")) return <FoldedCode>{children}</FoldedCode>;
    // Video Editor: the edit plan shown as cuts and texts.
    if (lang.includes("language-editplan")) {
      const plan = parseEditPlan(text);
      if (plan) return <EditPlanView plan={plan} />;
    }
    return <CodeBlock>{children}</CodeBlock>;
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table>{children}</table>
    </div>
  ),
};

function FoldedCode({ children }: { children: React.ReactNode }) {
  const t = useTranslations("render");
  return (
    <details className="my-3 rounded-lg border px-3 py-2 text-[13px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("code")}</summary>
      <CodeBlock>{children}</CodeBlock>
    </details>
  );
}

function parseEditPlan(text: string) {
  try {
    const parsed = editPlanSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type CopyKind = "email" | "message" | "linkedin" | "prompt" | "text";
const COPY_ICONS: Record<CopyKind, typeof MailIcon> = { email: MailIcon, message: MessageCircleIcon, linkedin: Share2Icon, prompt: SparklesIcon, text: FileTextIcon };

/**
 * Content meant to leave the conversation (an email, a WhatsApp message, a LinkedIn post, a prompt):
 * a clean card, editable in place, copied in one click. What is copied is what the person sees,
 * edits included. The answer itself is not changed.
 */
function CopyBlock({ kind, text }: { kind: CopyKind; text: string }) {
  const t = useTranslations("chat.copyBlock");
  const [value, setValue] = React.useState(text);
  const [copied, setCopied] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  // The model is still writing: follow its text until the person edits it.
  const [edited, setEdited] = React.useState(false);
  if (!edited && value !== text) setValue(text);
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const Icon = COPY_ICONS[kind];
  return (
    <div className="my-4 overflow-hidden rounded-xl border bg-card" data-testid="copy-block">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {t(`kind.${kind}`)}
          {edited ? <span className="font-normal">· {t("edited")}</span> : null}
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            copied ? "bg-success/15 text-success" : "bg-muted text-foreground hover:bg-accent",
          )}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <textarea
        ref={area}
        value={value}
        onChange={(e) => {
          setEdited(true);
          setValue(e.target.value);
        }}
        aria-label={t(`kind.${kind}`)}
        spellCheck
        className="block w-full resize-none bg-transparent px-3.5 py-3 text-[14.5px] leading-relaxed outline-none"
      />
    </div>
  );
}

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
