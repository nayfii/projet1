"use client";

import * as React from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, SlidersHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ComingSoon } from "@/components/ui/coming-soon";
import { LAUNCH_AGENTS, MEMORY_SCOPES, type MemoryScope } from "../definitions";
import { agentText, type DynamicT } from "../labels";
import { decideToolAction, deleteToolAction, saveAgentSettingsAction, setToolRolesAction } from "../server/actions";
import type { AgentDetail, AgentSettings } from "../server/queries";
import { Switch } from "@/components/ui/switch";
import { Field, Spinner } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MODEL_CHOICE_AUTO, modelDisplay } from "@/modules/providers/catalog";
import type { PickerModel } from "@/modules/conversations/ui/model-picker";
import { AgentBadges } from "./agent-badges";

const ROLES = ["owner", "admin", "member"] as const;

/** Administration → Agents and tools (CLAUDE.md §4.8): approve company-wide tools, choose roles. */
export function AdminAgents({
  pending,
  shared,
  builtins,
  models,
  autoEnabled,
}: {
  pending: AgentDetail[];
  shared: AgentDetail[];
  builtins: AgentDetail[];
  models: PickerModel[];
  autoEnabled: boolean;
}) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tRoles = useTranslations("roles");
  const format = useFormatter();
  const [busy, startBusy] = React.useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startBusy(async () => {
      const result = await fn();
      if (!result.ok) toast.error(tErrors((result.error ?? "unknown") as "unknown"));
      else toast.success(done);
    });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminPending", { count: pending.length })}</h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("adminNoPending")}</p>
        ) : (
          pending.map((a) => (
            <Card key={a.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("requestedBy", { name: a.creatorName ?? "?", date: format.dateTime(new Date(a.createdAt), { dateStyle: "medium" }) })}
                    {" · "}
                    {t(`departments.${a.department}`)}
                  </p>
                </div>
                <AgentBadges agent={a} />
              </div>
              {a.description ? <p className="text-[13px] text-muted-foreground">{a.description}</p> : null}
              <details className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                <summary className="cursor-pointer font-medium">{t("reviewContent")}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{t("fieldsList", { fields: a.inputFields.map((f) => f.label).join(", ") || "—" })}</p>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{a.instructions}</p>
              </details>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => act(() => decideToolAction({ id: a.id, approve: true }), t("approved"))}>
                  <CheckIcon />
                  {t("approve")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => decideToolAction({ id: a.id, approve: false }), t("rejectedToast"))}>
                  <XIcon />
                  {t("reject")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminShared")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("adminSharedHint")}</p>
        {shared.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("adminNoShared")}</p>
        ) : (
          <Card className="divide-y">
            {shared.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Link href={`/library/${a.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.creatorName ? t("by", { name: a.creatorName }) : null}</span>
                </Link>
                <AgentBadges agent={a} />
                <fieldset className="flex items-center gap-3" aria-label={t("enabledFor", { name: a.name })}>
                  {ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-1.5 text-[13px]">
                      <Checkbox
                        checked={a.enabledRoles.includes(role)}
                        disabled={busy}
                        onCheckedChange={(on) =>
                          act(
                            () => setToolRolesAction({ id: a.id, roles: ROLES.filter((r) => (r === role ? on === true : a.enabledRoles.includes(r))) }),
                            t("rolesSaved"),
                          )
                        }
                      />
                      {tRoles(role)}
                    </label>
                  ))}
                </fieldset>
                <Button variant="ghost" size="icon-sm" aria-label={t("deleteNamed", { name: a.name })} disabled={busy} onClick={() => act(() => deleteToolAction({ id: a.id }), t("deleted"))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("adminBuiltins")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("adminBuiltinsHint")}</p>
        <Card className="divide-y">
          {builtins.map((a) => (
            <BuiltinRow key={a.id} agent={a} models={models} autoEnabled={autoEnabled} />
          ))}
          {LAUNCH_AGENTS.filter((l) => !builtins.some((b) => b.builtinKey === l.key)).map((a) => (
            <div key={a.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t(`launch.${a.key}.name`)}</span>
              <span className="text-xs text-muted-foreground">{t(`departments.${a.department}`)}</span>
              <ComingSoon />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

const DEFAULT_SETTINGS = (a: AgentDetail): AgentSettings => ({
  enabled: true,
  enabledRoles: a.enabledRoles,
  instructionsAddition: "",
  tone: "",
  defaultModel: null,
  memoryScope: null,
});

/** One built-in agent: on/off and roles in the row, the rest ("Adapter") in a dialog. */
function BuiltinRow({ agent, models, autoEnabled }: { agent: AgentDetail; models: PickerModel[]; autoEnabled: boolean }) {
  const t = useTranslations("tools");
  const tErrors = useTranslations("errors");
  const tRoles = useTranslations("roles");
  const [settings, setSettings] = React.useState<AgentSettings>(agent.settings ?? DEFAULT_SETTINGS(agent));
  const [editing, setEditing] = React.useState(false);
  const [busy, startBusy] = React.useTransition();
  const text = agentText(agent, t as unknown as DynamicT);
  const save = (next: AgentSettings, done: string) =>
    startBusy(async () => {
      const result = await saveAgentSettingsAction({ agentId: agent.id, settings: next });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setSettings(next);
      toast.success(done);
      setEditing(false);
    });
  const adapted = Boolean(settings.instructionsAddition || settings.tone || settings.defaultModel || settings.memoryScope);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{text.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t(`departments.${agent.department}`)}
          {adapted ? ` · ${t("adapted")}` : ""}
        </p>
      </div>
      <fieldset className="flex items-center gap-3" aria-label={t("enabledFor", { name: text.name })} disabled={busy || !settings.enabled}>
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1.5 text-[13px]">
            <Checkbox
              checked={settings.enabledRoles.includes(role)}
              onCheckedChange={(on) =>
                save({ ...settings, enabledRoles: ROLES.filter((r) => (r === role ? on === true : settings.enabledRoles.includes(r))) }, t("rolesSaved"))
              }
            />
            {tRoles(role)}
          </label>
        ))}
      </fieldset>
      <Switch
        checked={settings.enabled}
        disabled={busy}
        aria-label={t("enableAgent", { name: text.name })}
        onCheckedChange={(on) => save({ ...settings, enabled: on }, on ? t("agentEnabled") : t("agentDisabled"))}
      />
      <Button variant="outline" size="sm" onClick={() => setEditing(true)} aria-label={t("adaptNamed", { name: text.name })}>
        <SlidersHorizontalIcon />
        {t("adapt")}
      </Button>
      {editing ? (
        <AdaptDialog
          name={text.name}
          settings={settings}
          models={models}
          autoEnabled={autoEnabled}
          busy={busy}
          onClose={() => setEditing(false)}
          onSave={(next) => save(next, t("adaptSaved"))}
        />
      ) : null}
    </div>
  );
}

const SAME = "__same";

function AdaptDialog({
  name,
  settings,
  models,
  autoEnabled,
  busy,
  onClose,
  onSave,
}: {
  name: string;
  settings: AgentSettings;
  models: PickerModel[];
  autoEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (next: AgentSettings) => void;
}) {
  const t = useTranslations("tools");
  const tCommon = useTranslations("common");
  const [draft, setDraft] = React.useState(settings);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("adaptTitle", { name })}</DialogTitle>
          <DialogDescription>{t("adaptBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("adaptInstructions")} htmlFor="adapt-instructions" hint={t("adaptInstructionsHint")}>
            <Textarea
              id="adapt-instructions"
              rows={4}
              maxLength={4000}
              value={draft.instructionsAddition}
              onChange={(e) => setDraft({ ...draft, instructionsAddition: e.target.value })}
            />
          </Field>
          <Field label={t("adaptTone")} htmlFor="adapt-tone" hint={t("adaptToneHint")}>
            <Input id="adapt-tone" maxLength={200} value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("model")}>
              <Select value={draft.defaultModel ?? SAME} onValueChange={(v) => setDraft({ ...draft, defaultModel: v === SAME ? null : v })}>
                <SelectTrigger aria-label={t("model")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SAME}>{t("modelCompanyDefault")}</SelectItem>
                  {autoEnabled ? <SelectItem value={MODEL_CHOICE_AUTO}>{t("modelAuto")}</SelectItem> : null}
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {`${modelDisplay(m.provider, m.label).brand} · ${modelDisplay(m.provider, m.label).name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("memory")}>
              <Select value={draft.memoryScope ?? SAME} onValueChange={(v) => setDraft({ ...draft, memoryScope: v === SAME ? null : (v as MemoryScope) })}>
                <SelectTrigger aria-label={t("memory")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SAME}>{t("memoryAgentDefault")}</SelectItem>
                  {MEMORY_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {t(`memoryScopes.${scope}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button disabled={busy} onClick={() => onSave(draft)}>
            {busy ? <Spinner /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
