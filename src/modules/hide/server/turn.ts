import "server-only";
import type { KnowledgePassage } from "@/modules/memory/types";
import { addCounts, type AutoCategory, type HideCounts, type HideMode, type Span } from "../categories";
import { autoSpans, spansToMask, type HideChoices } from "../mask";
import type { Masker, MaskItem } from "./masker";

type Facts = {
  userName: string | null;
  companyDescription: string | null;
  client: { name: string; sector: string | null; description: string | null } | null;
  /** Colleagues' names given to the model (message authors in a group, Who Can Help), in order. */
  people: string[];
  /** A tool's or agent's instructions (and the company's adaptations), when the conversation runs one. */
  toolInstructions?: string | null;
};

export type MaskedTurn = {
  /** The new message as the model receives it (null: unchanged), and what was masked in it and its files. */
  message: string | null;
  /** Where the protected values are in the typed message (positions only, shown struck through in green). */
  messageSpans: Span[];
  counts: HideCounts;
  attachments: { id: string; maskedText: string }[];
  facts: Facts;
};

const whole = (text: string, category: Span["category"]): Span[] => (text ? [{ start: 0, end: text.length, category }] : []);

/**
 * Masks what a new turn sends to the model, in one batch (so new values get their placeholders
 * in a single round trip):
 * - the typed message and attached documents: Automatic (company categories) and the person's
 *   choices (protect or leave visible), the same rule for both;
 * - facts in the instructions (person's name, linked client, descriptions) whenever Automatic is on,
 *   so the model cannot read in the instructions what is masked in the message.
 */
export async function maskTurn(
  masker: Masker,
  input: {
    modes: HideMode[];
    autoCategories: ReadonlySet<AutoCategory>;
    choices: Pick<HideChoices, "blur" | "unblur">;
    text: string | null;
    attachments: { id: string; kind: string; extracted_text: string | null }[];
    facts: Facts;
  },
): Promise<MaskedTurn> {
  const automatic = input.modes.includes("automatic");
  const manual = input.modes.includes("manual");
  const documents = input.modes.includes("documents");
  const auto = input.autoCategories;
  const items: MaskItem[] = [];
  const add = (text: string, spans: Span[]) => {
    items.push({ text, spans });
    return items.length - 1;
  };

  const choices = { modes: input.modes, ...input.choices };
  const messageIndex = input.text && (automatic || manual) ? add(input.text, spansToMask(input.text, masker.detect(input.text), auto, choices)) : -1;
  // Files follow the message's rule; "documents" alone (older clients) masks the company categories.
  const fileSpans = (text: string) => (automatic || manual ? spansToMask(text, masker.detect(text), auto, choices) : autoSpans(masker.detect(text), auto));
  const attachmentIndexes =
    automatic || manual || documents
      ? input.attachments.filter((a) => a.kind !== "image" && a.extracted_text).map((a) => ({ id: a.id, index: add(a.extracted_text!, fileSpans(a.extracted_text!)) }))
      : [];

  const facts = input.facts;
  const factIndex = automatic
    ? {
        userName: facts.userName && auto.has("person") ? add(facts.userName, whole(facts.userName, "person")) : -1,
        companyDescription: facts.companyDescription ? add(facts.companyDescription, autoSpans(masker.detect(facts.companyDescription), auto)) : -1,
        clientName: facts.client && auto.has("client") ? add(facts.client.name, whole(facts.client.name, "client")) : -1,
        clientSector: facts.client?.sector ? add(facts.client.sector, autoSpans(masker.detect(facts.client.sector), auto)) : -1,
        clientDescription: facts.client?.description ? add(facts.client.description, autoSpans(masker.detect(facts.client.description), auto)) : -1,
        people: facts.people.map((name) => (name && auto.has("person") ? add(name, whole(name, "person")) : -1)),
        toolInstructions: facts.toolInstructions ? add(facts.toolInstructions, autoSpans(masker.detect(facts.toolInstructions), auto)) : -1,
      }
    : null;

  const results = await masker.mask(items);
  const at = (index: number, original: string) => (index >= 0 ? results[index].masked : original);

  let counts: HideCounts = messageIndex >= 0 ? results[messageIndex].counts : {};
  const attachments: MaskedTurn["attachments"] = [];
  for (const a of attachmentIndexes) {
    if (results[a.index].masked === items[a.index].text) continue;
    attachments.push({ id: a.id, maskedText: results[a.index].masked });
    counts = addCounts(counts, results[a.index].counts);
  }
  const message = messageIndex >= 0 && results[messageIndex].masked !== input.text ? results[messageIndex].masked : null;

  return {
    message,
    messageSpans: messageIndex >= 0 && message !== null ? items[messageIndex].spans : [],
    counts,
    attachments,
    facts: factIndex
      ? {
          userName: facts.userName ? at(factIndex.userName, facts.userName) : null,
          companyDescription: facts.companyDescription ? at(factIndex.companyDescription, facts.companyDescription) : null,
          client: facts.client
            ? {
                name: at(factIndex.clientName, facts.client.name),
                sector: facts.client.sector ? at(factIndex.clientSector, facts.client.sector) : null,
                description: facts.client.description ? at(factIndex.clientDescription, facts.client.description) : null,
              }
            : null,
          people: facts.people.map((name, i) => at(factIndex.people[i], name)),
          toolInstructions: facts.toolInstructions ? at(factIndex.toolInstructions, facts.toolInstructions) : null,
        }
      : facts,
  };
}

/**
 * Memory passages given to the model: their text and titles are masked when Automatic is on (or
 * Documents, for older clients); the client's name in their origin too.
 * Source Proof keeps the real passages (shown only to people allowed to read them).
 */
export async function maskPassages(
  masker: Masker,
  passages: KnowledgePassage[],
  modes: HideMode[],
  autoCategories: ReadonlySet<AutoCategory>,
): Promise<KnowledgePassage[]> {
  const documents = modes.includes("documents") || modes.includes("automatic");
  const maskClient = documents && autoCategories.has("client");
  if (passages.length === 0 || (!documents && !maskClient)) return passages;
  const items: MaskItem[] = [];
  const slots = passages.map((p) => {
    const content = documents ? items.push({ text: p.content, spans: autoSpans(masker.detect(p.content), autoCategories) }) - 1 : -1;
    const title = documents ? items.push({ text: p.title, spans: autoSpans(masker.detect(p.title), autoCategories) }) - 1 : -1;
    const client = maskClient && p.clientName ? items.push({ text: p.clientName, spans: whole(p.clientName, "client") }) - 1 : -1;
    return { content, title, client };
  });
  const results = await masker.mask(items);
  return passages.map((p, i) => ({
    ...p,
    content: slots[i].content >= 0 ? results[slots[i].content].masked : p.content,
    title: slots[i].title >= 0 ? results[slots[i].title].masked : p.title,
    clientName: slots[i].client >= 0 ? results[slots[i].client].masked : p.clientName,
  }));
}
