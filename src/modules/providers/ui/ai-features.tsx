"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BrainIcon, MicIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { saveAiFeaturesAction } from "../server/actions";

/** Two company switches: client memory fed automatically, and voice dictation. Each saves at once. */
export function AiFeatures({ initial }: { initial: { autoClientMemory: boolean; dictation: boolean } }) {
  const t = useTranslations("aiFeatures");
  const tErrors = useTranslations("errors");
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = (key: "autoClientMemory" | "dictation", value: boolean) => {
    const previous = state;
    setState((s) => ({ ...s, [key]: value }));
    startTransition(async () => {
      const result = await saveAiFeaturesAction({ [key]: value });
      if (result.ok) toast.success(t("saved"));
      else {
        setState(previous);
        toast.error(tErrors(result.error));
      }
    });
  };

  const rows = [
    { key: "autoClientMemory" as const, icon: BrainIcon, title: t("autoMemoryTitle"), body: t("autoMemoryBody") },
    { key: "dictation" as const, icon: MicIcon, title: t("dictationTitle"), body: t("dictationBody") },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-[13px] text-muted-foreground">{t("description")}</p>
      </div>
      <Card className="divide-y">
        {rows.map(({ key, icon: Icon, title, body }) => (
          <label key={key} className="flex items-start justify-between gap-4 p-4">
            <span className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-[13px] text-muted-foreground">{body}</span>
              </span>
            </span>
            <Switch checked={state[key]} disabled={pending} onCheckedChange={(v) => save(key, v)} aria-label={title} />
          </label>
        ))}
      </Card>
    </section>
  );
}
