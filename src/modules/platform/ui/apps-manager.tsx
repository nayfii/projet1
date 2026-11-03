"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toolSchema, type Department, type ToolInput } from "@/modules/agents/definitions";
import { ToolEditor } from "@/modules/agents/ui/tool-editor";
import { DepartmentIcon } from "@/modules/agents/ui/department-icon";
import { deletePlatformAppAction, savePlatformAppAction, setAppSwitchesAction } from "../server/app-actions";

export type PlatformApp = { id: string; enabled: boolean; app: ToolInput };

const EMPTY: ToolInput = {
  name: "",
  description: "",
  department: "general",
  instructions: "",
  input_fields: [],
  allowed_models: [],
  default_model: null,
  tools: [],
  memory_scope: "company_and_client",
  output_format: "text",
};

/** Platform → Applis: the launch switches, and the apps our team adds for every customer. */
export function AppsManager({ switches, apps }: { switches: { video: boolean; appReview: boolean }; apps: PlatformApp[] }) {
  const t = useTranslations("platformApps");
  const tTools = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ id: string | null; enabled: boolean; app: ToolInput } | null>(null);
  const [deleting, setDeleting] = React.useState<PlatformApp | null>(null);
  const [pending, start] = React.useTransition();

  const toggle = (key: "video" | "appReview", on: boolean) =>
    start(async () => {
      const result = await setAppSwitchesAction({ [key]: on });
      if (!result.ok) toast.error(tErrors(result.error));
      else router.refresh();
    });

  const save = () =>
    start(async () => {
      if (!editing) return;
      const result = await savePlatformAppAction({ id: editing.id, app: editing.app, enabled: editing.enabled });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("saved"));
      setEditing(null);
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!deleting) return;
      const result = await deletePlatformAppAction(deleting.id);
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("deleted"));
      setDeleting(null);
      router.refresh();
    });

  return (
    <div className="space-y-10">
      <section aria-labelledby="launch">
        <h2 id="launch" className="mb-3 text-[13px] font-medium text-muted-foreground">
          {t("launch")}
        </h2>
        <Card className="divide-y p-0">
          {(
            [
              { key: "video", on: switches.video, label: t("video"), hint: switches.video ? t("videoHintOn") : t("videoHint") },
              { key: "appReview", on: switches.appReview, label: t("review"), hint: switches.appReview ? t("reviewHintOn") : t("reviewHint") },
            ] as const
          ).map((row) => (
            <label key={row.key} className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5">
              <span>
                <span className="block text-sm font-medium">{row.label}</span>
                <span className="block text-[13px] text-muted-foreground">{row.hint}</span>
              </span>
              <Switch checked={row.on} disabled={pending} onCheckedChange={(on) => toggle(row.key, on)} aria-label={row.label} />
            </label>
          ))}
        </Card>
      </section>

      <section aria-labelledby="ours">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="ours" className="text-[13px] font-medium text-muted-foreground">
              {t("ours")}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t("oursHint")}</p>
          </div>
          <Button size="sm" onClick={() => setEditing({ id: null, enabled: true, app: EMPTY })}>
            <PlusIcon />
            {t("new")}
          </Button>
        </div>
        {apps.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">{t("empty")}</p>
        ) : (
          <Card className="divide-y p-0">
            {apps.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3" data-testid="platform-app">
                <DepartmentIcon department={a.app.department as Department} className="size-9 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.app.name}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {tTools(`departments.${a.app.department}`)}
                    {a.app.description ? ` · ${a.app.description}` : ""}
                  </p>
                </div>
                <Badge variant={a.enabled ? "success" : "outline"}>{a.enabled ? t("enabled") : t("disabled")}</Badge>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit", { name: a.app.name })} onClick={() => setEditing({ ...a })}>
                  <PencilIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("delete", { name: a.app.name })} onClick={() => setDeleting(a)}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("editTitle") : t("createTitle")}</DialogTitle>
            <DialogDescription>{t("editorHint")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <>
              <ToolEditor
                value={editing.app}
                onChange={(app) => setEditing({ ...editing, app })}
                visibility="company"
                onVisibilityChange={() => undefined}
                models={[]}
                autoEnabled={false}
                hasTeam={false}
                canApprove
                forEveryCompany
              />
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                <span className="text-sm">{t("enabledLabel")}</span>
                <Switch checked={editing.enabled} onCheckedChange={(on) => setEditing({ ...editing, enabled: on })} aria-label={t("enabledLabel")} />
              </label>
            </>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={!editing || !toolSchema.safeParse(editing.app).success || pending}>
              {pending ? <Spinner /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <DialogContent className="max-w-md" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { name: deleting?.app.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
