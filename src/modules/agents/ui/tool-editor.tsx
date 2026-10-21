"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MODEL_CHOICE_AUTO, modelDisplay } from "@/modules/providers/catalog";
import type { PickerModel } from "@/modules/conversations/ui/model-picker";
import { DEPARTMENTS, TOOL_FIELD_TYPES, MEMORY_SCOPES, OUTPUT_FORMATS, VISIBILITIES, fieldKey, type ToolInput, type Visibility } from "../definitions";

const ANY_MODEL = "__any";

/**
 * Reviewing a tool before saving it: name, form fields, instructions, model, memory, output format
 * and who can use it. Used by "Turn into a tool" and to edit a tool.
 */
export function ToolEditor({
  value,
  onChange,
  visibility,
  onVisibilityChange,
  models,
  autoEnabled,
  hasTeam,
  canApprove,
}: {
  value: ToolInput;
  onChange: (next: ToolInput) => void;
  visibility: Visibility;
  onVisibilityChange: (next: Visibility) => void;
  models: PickerModel[];
  autoEnabled: boolean;
  hasTeam: boolean;
  /** The person can publish company-wide without waiting (Owner, "agents" Admin). */
  canApprove: boolean;
}) {
  const t = useTranslations("tools");
  const set = <K extends keyof ToolInput>(key: K, next: ToolInput[K]) => onChange({ ...value, [key]: next });
  // "Model": the person's choice (any allowed model), Auto, or one fixed model.
  const modelValue = value.allowed_models[0] ?? (value.default_model === MODEL_CHOICE_AUTO ? MODEL_CHOICE_AUTO : ANY_MODEL);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label={t("name")} htmlFor="tool-name">
          <Input id="tool-name" value={value.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("department")}>
          <Select value={value.department} onValueChange={(v) => set("department", v as ToolInput["department"])}>
            <SelectTrigger aria-label={t("department")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`departments.${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={t("description")} htmlFor="tool-description" hint={t("descriptionHint")}>
        <Input id="tool-description" value={value.description} maxLength={400} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("fields")}</legend>
        <p className="text-[13px] text-muted-foreground">{t("fieldsHint")}</p>
        {value.input_fields.map((f, i) => {
          const update = (patch: Partial<typeof f>) => set("input_fields", value.input_fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={f.key} className="space-y-2 rounded-lg border px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={t("fieldLabel")} value={f.label} maxLength={80} onChange={(e) => update({ label: e.target.value })} className="min-w-40 flex-1" />
                <Select value={f.type} onValueChange={(v) => update({ type: v as typeof f.type, options: v === "select" ? (f.options ?? []) : undefined })}>
                  <SelectTrigger className="w-40" aria-label={t("fieldType")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOL_FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`fieldTypes.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={f.required} onCheckedChange={(on) => update({ required: on === true })} />
                  {t("required")}
                </label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("removeField", { label: f.label })}
                  onClick={() => set("input_fields", value.input_fields.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              {f.type === "select" ? (
                <Input
                  aria-label={t("fieldOptions")}
                  placeholder={t("fieldOptionsPlaceholder")}
                  defaultValue={(f.options ?? []).join(", ")}
                  onBlur={(e) => update({ options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 20) })}
                />
              ) : null}
            </div>
          );
        })}
        {value.input_fields.length < 12 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const label = t("newFieldLabel");
              set("input_fields", [...value.input_fields, { key: fieldKey(label, new Set(value.input_fields.map((f) => f.key))), label, type: "text", required: false }]);
            }}
          >
            <PlusIcon />
            {t("addField")}
          </Button>
        ) : null}
      </fieldset>

      <Field label={t("instructions")} htmlFor="tool-instructions" hint={t("instructionsHint")}>
        <Textarea id="tool-instructions" rows={8} value={value.instructions} maxLength={8000} onChange={(e) => set("instructions", e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("model")}>
          <Select
            value={modelValue}
            onValueChange={(v) =>
              onChange({
                ...value,
                allowed_models: v === ANY_MODEL || v === MODEL_CHOICE_AUTO ? [] : [v],
                default_model: v === ANY_MODEL ? null : v,
              })
            }
          >
            <SelectTrigger aria-label={t("model")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_MODEL}>{t("modelAny")}</SelectItem>
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
          <Select value={value.memory_scope} onValueChange={(v) => set("memory_scope", v as ToolInput["memory_scope"])}>
            <SelectTrigger aria-label={t("memory")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMORY_SCOPES.map((scope) => (
                <SelectItem key={scope} value={scope}>
                  {t(`memoryScopes.${scope}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("format")}>
          <Select value={value.output_format} onValueChange={(v) => set("output_format", v as ToolInput["output_format"])}>
            <SelectTrigger aria-label={t("format")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {t(`formats.${format}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value.tools.includes("attachments")} onCheckedChange={(on) => set("tools", on === true ? ["attachments"] : [])} />
        {t("attachments")}
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("visibility")}</legend>
        {VISIBILITIES.map((v) => {
          const disabled = v === "team" && !hasTeam;
          return (
            <label
              key={v}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
                visibility === v && "border-brand/40 bg-brand-soft/40",
                disabled ? "opacity-60" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name="tool-visibility"
                className="mt-1 accent-[var(--brand)]"
                checked={visibility === v}
                disabled={disabled}
                onChange={() => onVisibilityChange(v)}
              />
              <span>
                <span className="block">{t(`visibilities.${v}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {v === "team" && !hasTeam ? t("noTeamHint") : v === "company" ? (canApprove ? t("companyDirectHint") : t("companyApprovalHint")) : t(`visibilityHints.${v}`)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
