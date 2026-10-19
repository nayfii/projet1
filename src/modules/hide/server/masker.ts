import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import type { UserClient } from "@/lib/supabase/server";
import {
  AUTO_CATEGORIES,
  DEFAULT_AUTO_CATEGORIES,
  DEFAULT_MODES,
  HIDE_MODES,
  isAutoCategory,
  placeholderPrefix,
  type HideCategory,
  type HideCounts,
  type HideSettings,
  type Span,
} from "../categories";
import { detectSensitive, type DetectionLists } from "../detect";
import { applyPlaceholders, canonicalValue, restorePlaceholders, StreamRestorer } from "../mask";
import { decryptValue, encryptValue, valueHash } from "./crypto";
import { assignPlaceholders, loadCompanyLists } from "./store";

/** The company's defaults (members can read them: the mode control starts from them). */
export async function getHideSettings(supabase: UserClient, companyId: string): Promise<HideSettings> {
  const { data } = await supabase.from("company_hide_settings").select("default_modes, auto_categories").eq("company_id", companyId).maybeSingle();
  if (!data) return { defaultModes: DEFAULT_MODES, autoCategories: DEFAULT_AUTO_CATEGORIES };
  return {
    defaultModes: HIDE_MODES.filter((m) => data.default_modes.includes(m)),
    autoCategories: data.auto_categories.filter(isAutoCategory).sort((a, b) => AUTO_CATEGORIES.indexOf(a) - AUTO_CATEGORIES.indexOf(b)),
  };
}

/** Lists used for detection, for this person: clients they cannot access are masked as plain terms. */
export async function loadDetectionLists(supabase: UserClient, ctx: MemberContext): Promise<DetectionLists> {
  const { data: accessible } = await supabase.from("clients").select("id").eq("company_id", ctx.active.companyId);
  return loadCompanyLists(ctx.active.companyId, new Set((accessible ?? []).map((c) => c.id)));
}

export type MaskItem = { text: string; spans: Span[] };

export type Masker = {
  detect(text: string): Span[];
  /** Masks several texts at once; new values get the next placeholders of their category. */
  mask(items: MaskItem[]): Promise<{ masked: string; counts: HideCounts }[]>;
  restore(text: string): string;
  restorer(): StreamRestorer;
};

/**
 * Masker for a conversation: placeholders are stable for the whole conversation and stored
 * (encrypted) on the server, so later turns, other models and regenerated answers stay consistent.
 * Throws HideUnavailableError when HIDE_ENCRYPTION_KEY is missing.
 */
export async function createConversationMasker(conversationId: string, lists: DetectionLists): Promise<Masker> {
  const placeholders = new Map<string, string>(); // value hash → placeholder
  const values = new Map<string, string>(); // placeholder → real value
  const absorb = (rows: Awaited<ReturnType<typeof assignPlaceholders>>) => {
    for (const r of rows) {
      placeholders.set(r.valueHash, r.placeholder);
      if (!values.has(r.placeholder)) values.set(r.placeholder, decryptValue(r.ciphertext));
    }
  };
  absorb(await assignPlaceholders(conversationId, []));
  const hashOf = (category: HideCategory, value: string) => valueHash(conversationId, category, canonicalValue(category, value));

  return {
    detect: (text) => detectSensitive(text, lists),
    async mask(items) {
      const missing = new Map<string, { category: HideCategory; value: string }>();
      for (const item of items) {
        for (const s of item.spans) {
          const value = item.text.slice(s.start, s.end);
          const hash = hashOf(s.category, value);
          if (!placeholders.has(hash) && !missing.has(hash)) missing.set(hash, { category: s.category, value });
        }
      }
      if (missing.size > 0) {
        absorb(await assignPlaceholders(conversationId, [...missing].map(([hash, m]) => ({ category: m.category, hash, ciphertext: encryptValue(m.value) }))));
      }
      return items.map((item) => applyPlaceholders(item.text, item.spans, (category, value) => placeholders.get(hashOf(category, value)) ?? `[${placeholderPrefix(category)}_0]`));
    },
    restore: (text) => restorePlaceholders(text, values),
    restorer: () => new StreamRestorer(values),
  };
}

/** Masker for a one-off AI task outside any conversation (e.g. promotion): nothing is stored. */
export function createEphemeralMasker(lists: DetectionLists): Masker {
  const placeholders = new Map<string, string>();
  const values = new Map<string, string>();
  const counters = new Map<HideCategory, number>();
  return {
    detect: (text) => detectSensitive(text, lists),
    async mask(items) {
      return items.map((item) =>
        applyPlaceholders(item.text, item.spans, (category, value) => {
          const key = `${category}:${canonicalValue(category, value)}`;
          let placeholder = placeholders.get(key);
          if (!placeholder) {
            counters.set(category, (counters.get(category) ?? 0) + 1);
            placeholder = `[${placeholderPrefix(category)}_${counters.get(category)}]`;
            placeholders.set(key, placeholder);
            values.set(placeholder, value);
          }
          return placeholder;
        }),
      );
    },
    restore: (text) => restorePlaceholders(text, values),
    restorer: () => new StreamRestorer(values),
  };
}

/** Real values of a conversation's placeholders, to restore an AI task's output (e.g. memory suggestions). */
export async function conversationValues(conversationId: string): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const r of await assignPlaceholders(conversationId, [])) values.set(r.placeholder, decryptValue(r.ciphertext));
  return values;
}
