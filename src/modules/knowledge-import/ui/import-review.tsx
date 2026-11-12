"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EyeIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { memoryLabel } from "@/modules/memory/labels";
import { defaultDestination, PERSONAL, type ImportDestination } from "../destinations";
import type { PendingProposal } from "../server/queries";
import { applyImportAction } from "../server/actions";

type Row = PendingProposal & { checked: boolean; destination: string; editing: boolean };

/**
 * The person decides, proposal by proposal: what is kept, where, and with which words. What stays in
 * their own memory is ticked; anything shared with colleagues, or that might be personal, waits for an
 * explicit tick (sharing more widely is never automatic).
 */
export function ImportReview({ importId, proposals, destinations }: { importId: string; proposals: PendingProposal[]; destinations: ImportDestination[] }) {
  const t = useTranslations("knowledgeImport");
  const tMemory = useTranslations("memory");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>(() =>
    proposals.map((p) => {
      const destination = defaultDestination(p.level, p.target, destinations);
      return { ...p, destination, checked: !p.sensitive && destination === PERSONAL, editing: false };
    }),
  );
  const [pending, startTransition] = React.useTransition();
  const update = (id: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const name = (d: ImportDestination) => (d.kind === "personal" ? t("destination.personal") : d.kind === "client" ? tMemory("clientMemoryNamed", { client: d.name ?? "" }) : memoryLabel(d.kind, d.name, tMemory));
  const audience = (id: string) => {
    const d = destinations.find((x) => x.id === id);
    if (!d || d.kind === "personal") return t("audience.personal");
    return t(`audience.${d.kind}`, { name: d.name ?? "" });
  };

  const groups: { key: "mine" | "shared" | "check"; rows: Row[] }[] = [
    { key: "mine", rows: rows.filter((r) => !r.sensitive && r.destination === PERSONAL) },
    { key: "shared", rows: rows.filter((r) => !r.sensitive && r.destination !== PERSONAL) },
    { key: "check", rows: rows.filter((r) => r.sensitive) },
  ];
  const chosen = rows.filter((r) => r.checked).length;

  const save = () =>
    startTransition(async () => {
      const result = await applyImportAction({
        importId,
        decisions: rows.map((r) => ({ itemId: r.id, accept: r.checked, destination: r.destination, title: r.title.trim() || "—", content: r.content.trim() || "—" })),
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("savedToast", { count: result.data!.saved }));
      if (result.data!.failed > 0) toast.error(t("savedFailed", { count: result.data!.failed }));
      router.refresh();
    });

  return (
    <section className="space-y-6" aria-labelledby="review-title" data-testid="import-review">
      <div className="space-y-1">
        <h2 id="review-title" className="text-base font-semibold tracking-tight">
          {t("reviewTitle", { count: rows.length })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("reviewBody")}</p>
      </div>

      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <div key={group.key} className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                {group.key === "check" ? <TriangleAlertIcon className="size-4 text-warning" /> : null}
                {t(`group.${group.key}`)}
              </h3>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  const all = group.rows.every((r) => r.checked);
                  setRows((list) => list.map((r) => (group.rows.some((g) => g.id === r.id) ? { ...r, checked: !all } : r)));
                }}
              >
                {group.rows.every((r) => r.checked) ? t("untickAll") : t("tickAll")}
              </button>
            </div>
            {group.key === "check" ? <p className="text-xs text-muted-foreground">{t("group.checkBody")}</p> : null}
            <ul className="space-y-2">
              {group.rows.map((r) => (
                <li key={r.id} className="rounded-xl border bg-card p-3.5" data-testid="import-proposal">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={r.checked} onCheckedChange={(v) => update(r.id, { checked: v === true })} aria-label={t("keep", { title: r.title })} className="mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-2">
                      {r.editing ? (
                        <div className="space-y-2">
                          <Input value={r.title} onChange={(e) => update(r.id, { title: e.target.value })} maxLength={200} aria-label={t("titleLabel")} />
                          <textarea
                            value={r.content}
                            onChange={(e) => update(r.id, { content: e.target.value })}
                            maxLength={2000}
                            rows={3}
                            aria-label={t("contentLabel")}
                            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-medium">{r.title}</p>
                          <p className="text-sm text-muted-foreground">{r.content}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={r.destination} onValueChange={(v) => update(r.id, { destination: v })}>
                          <SelectTrigger className="h-8 w-auto max-w-full text-xs" aria-label={t("destinationLabel")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {destinations.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {name(d)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <EyeIcon className="size-3.5" />
                          {audience(r.destination)}
                        </span>
                        <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => update(r.id, { editing: !r.editing })}>
                          <PencilIcon />
                          {r.editing ? t("doneEditing") : t("edit")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}

      <div className="sticky bottom-4 flex flex-col gap-2 rounded-2xl border bg-background/90 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted-foreground">{t("saveHint", { kept: chosen, dropped: rows.length - chosen })}</p>
        <Button onClick={save} disabled={pending}>
          {t("save", { count: chosen })}
        </Button>
      </div>
    </section>
  );
}
