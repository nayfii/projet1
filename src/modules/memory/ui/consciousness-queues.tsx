"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { memoryLabel } from "../labels";
import type { MemoryKind } from "../types";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decideSuggestionAction } from "../server/actions";
import { cancelClientAccessAction, decideClientAccessAction } from "../server/consciousness-actions";

type Proposal = { id: string; title: string; content: string; reason: string | null; kind: string; where: { kind: string; clientName: string | null } };

/** What waits for this person's confirmation before entering memory (their own learnings, promotions). */
export function ProposalQueue({ proposals }: { proposals: Proposal[] }) {
  const t = useTranslations("consciousness");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const visible = proposals.filter((p) => !done.has(p.id));
  if (visible.length === 0) return <p className="text-[13px] text-muted-foreground">{t("hub.nothingToConfirm")}</p>;
  return (
    <ul className="divide-y rounded-xl border">
      {visible.map((p) => (
        <li key={p.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[13.5px]">{p.content}</p>
            <p className="text-xs text-muted-foreground">
              {memoryLabel(p.where.kind as MemoryKind, p.where.clientName, t)}
              {p.kind === "promotion" ? ` · ${t("hub.promotion")}` : p.reason ? ` · ${t(`proposalReason.${p.reason as "assistant_claim"}`)}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={async () => {
              const r = await decideSuggestionAction({ suggestionId: p.id, approve: true });
              if (!r.ok) return void toast.error(tErrors(r.error));
              toast.success(t("confirmed"));
              setDone((s) => new Set(s).add(p.id));
              router.refresh();
            }}
          >
            <CheckIcon className="size-3.5" />
            {t("confirm")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={async () => {
              const r = await decideSuggestionAction({ suggestionId: p.id, approve: false });
              if (!r.ok) return void toast.error(tErrors(r.error));
              setDone((s) => new Set(s).add(p.id));
            }}
          >
            {t("dismiss")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

type Request = {
  id: string;
  reason: string | null;
  duration_days: number | null;
  status: string;
  created_at: string;
  expires_at: string | null;
  client: { name: string } | null;
  requester: { full_name: string | null; email: string } | null;
};

/** Access requests this person may decide: approve for a duration (or without end), or refuse. */
export function AccessRequestQueue({ requests }: { requests: Request[] }) {
  const t = useTranslations("consciousness.access");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const visible = requests.filter((r) => !done.has(r.id));
  if (visible.length === 0) return null;
  const decide = async (r: Request, approve: boolean, days: number | null) => {
    const result = await decideClientAccessAction({ requestId: r.id, approve, days });
    if (!result.ok) return void toast.error(tErrors(result.error));
    toast.success(approve ? t("granted") : t("refused"));
    setDone((s) => new Set(s).add(r.id));
    router.refresh();
  };
  return (
    <ul className="divide-y rounded-xl border" data-testid="access-requests">
      {visible.map((r) => (
        <li key={r.id} className="space-y-2 px-4 py-3">
          <p className="text-[13.5px]">
            {t("asks", { person: r.requester?.full_name ?? r.requester?.email ?? "?", client: r.client?.name ?? "?" })}
            {r.duration_days ? <span className="text-muted-foreground"> · {t("days", { count: r.duration_days })}</span> : null}
          </p>
          {r.reason ? <p className="text-xs text-muted-foreground">{`« ${r.reason} »`}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void decide(r, true, r.duration_days ?? 30)}>
              <CheckIcon className="size-3.5" />
              {t("approveFor", { count: r.duration_days ?? 30 })}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void decide(r, true, null)}>
              {t("approveNoEnd")}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void decide(r, false, null)}>
              <XIcon className="size-3.5" />
              {t("refuse")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The person's own requests and their outcome. */
export function MyAccessRequests({ requests }: { requests: Request[] }) {
  const t = useTranslations("consciousness.access");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  if (requests.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{r.client?.name ?? t("restrictedClient")}</span>
          <span className="text-xs text-muted-foreground">{t(`status.${r.status as "pending"}`)}</span>
          {r.status === "pending" ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              onClick={async () => {
                const result = await cancelClientAccessAction({ requestId: r.id });
                if (!result.ok) return void toast.error(tErrors(result.error));
                router.refresh();
              }}
            >
              {t("cancel")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
