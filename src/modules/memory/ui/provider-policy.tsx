"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AssistantAvatar } from "@/modules/avatars/ui/assistant-avatar";
import { setProviderPolicyAction } from "../server/consciousness-actions";

const PROVIDERS = ["anthropic", "openai", "google"] as const;

/**
 * Which AI models may receive this memory (Admins with the permissions scope). A model left out
 * never receives it; people are told when an answer was made without it.
 */
export function ProviderPolicy({ spaceId, blocked }: { spaceId: string; blocked: string[] }) {
  const t = useTranslations("consciousness.providers");
  const tErrors = useTranslations("errors");
  const [value, setValue] = React.useState<string[]>(blocked);
  return (
    <section className="space-y-2 rounded-xl border px-4 py-3" data-testid="provider-policy">
      <div>
        <h2 className="text-[13px] font-medium">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("body")}</p>
      </div>
      <div className="flex flex-wrap gap-4">
        {PROVIDERS.map((p) => {
          const allowed = !value.includes(p);
          return (
            <label key={p} className="flex items-center gap-2 text-[13px]">
              <AssistantAvatar provider={p} size={22} />
              {t(`name.${p}`)}
              <Switch
                checked={allowed}
                aria-label={t(`name.${p}`)}
                onCheckedChange={async (on) => {
                  const next = on ? value.filter((x) => x !== p) : [...value, p];
                  setValue(next);
                  const result = await setProviderPolicyAction({ spaceId, blocked: next as ("openai" | "anthropic" | "google")[] });
                  if (!result.ok) {
                    setValue(value);
                    toast.error(tErrors(result.error));
                  }
                }}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
