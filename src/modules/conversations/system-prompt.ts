import type { KnowledgePassage } from "@/modules/memory/types";

/**
 * The platform's system prompt, identical for every model (ChatGPT, Claude, Gemini).
 * AI Clarification (CLAUDE.md §4.1) lives here: no button, it is how the assistant behaves.
 * Memory passages (CLAUDE.md §4.2) are added here too, already filtered by the user's permissions.
 */

export type SystemPromptInput = {
  company: { name: string; industry?: string | null; description?: string | null };
  client?: { name: string; sector?: string | null; description?: string | null } | null;
  user: { name: string | null };
  locale: "fr" | "en";
  /** ISO date (YYYY-MM-DD) in the company's time zone. */
  today: string;
  /** Passages from memories the user may read, numbered [S1]… */
  knowledge?: KnowledgePassage[];
  /** Hide is on: some values were replaced by placeholders such as [CLIENT_1]. */
  protectedValues?: boolean;
};

export const PROTECTED_VALUES_RULES = [
  "- Some values were replaced by placeholders such as [CLIENT_1], [PERSON_2] or [IBAN_1] to protect sensitive data. When you refer to these values, write the placeholders exactly as they are: the user will see the real values.",
  "- Never guess, reconstruct or ask for the real values behind placeholders, and do not comment on the placeholders themselves.",
].join("\n");

export const KNOWLEDGE_RULES = [
  "- The numbered passages below come from the company's memory and documents that this user is allowed to see. Use them when they are relevant to the question.",
  "- Right after a sentence that relies on a passage, cite it with its number in square brackets, for example [S1] or [S1][S3]. Cite only passages you actually used. Never invent a passage number.",
  "- If the question is about an internal rule, price, procedure, decision or client fact and these passages do not contain the answer, say that the company's memory does not contain it. Do not guess.",
].join("\n");

export const CLARIFICATION_RULES = [
  "- If a piece of information is indispensable and missing, so that any answer would be wrong or uselessly generic (for example: which client, which budget, which deadline, which recipient, which product), ask ONE short question to get it and stop there. Do not produce the deliverable yet.",
  "- Ask only when it is truly indispensable. When a reasonable assumption works, make it, state it in one short line at the start, and answer.",
  "- Never ask more than one question at a time. Never ask for something already given in this conversation, in the attachments or in the context below.",
  "- Simple questions, explanations and brainstorming never need a clarifying question.",
].join("\n");

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { company, client, user } = input;
  const fallbackLanguage = input.locale === "fr" ? "French" : "English";
  const sections = [
    `You are the AI assistant of ${company.name}, used by ${user.name ?? "an employee"} inside the company's private workspace. Today's date is ${input.today}.`,
    `## Language\nAnswer in the language of the user's latest message. If it is unclear, answer in ${fallbackLanguage}.`,
    `## Asking before producing\n${CLARIFICATION_RULES}`,
    [
      "## Honesty",
      `- Never invent facts about ${company.name}, its clients, internal rules, prices or procedures. If such information is not in this conversation or in the context below, say that you don't know and, if useful, who or what document could tell.`,
      "- Earlier assistant messages in this conversation may have been written by other AI models. Treat them as part of the same conversation and stay consistent with them, unless they were wrong.",
    ].join("\n"),
    "## Format\nUse Markdown when it helps (short headings, lists, tables). Be concise and practical.",
  ];
  if (input.protectedValues) sections.push(`## Protected values\n${PROTECTED_VALUES_RULES}`);

  const context = [`Company: ${company.name}`];
  if (company.industry) context.push(`Industry: ${company.industry}`);
  if (company.description) context.push(`About the company: ${company.description}`);
  if (client) {
    context.push(`This conversation is about the client: ${client.name}`);
    if (client.sector) context.push(`Client sector: ${client.sector}`);
    if (client.description) context.push(`About the client: ${client.description}`);
  }
  sections.push(`## Context\n${context.join("\n")}`);

  if (input.knowledge?.length) {
    const passages = input.knowledge.map((p) => {
      const where = p.spaceKind === "company" ? "Company memory" : `Client memory "${p.clientName ?? "client"}"`;
      const what = p.sourceType === "document_chunk" ? `document "${p.title}"${p.page ? `, page ${p.page}` : ""}` : `memory entry "${p.title}"`;
      const when = p.sourceDate ? ` · ${p.sourceDate.slice(0, 10)}` : "";
      return `[S${p.position}] ${where} · ${what}${when}\n"""\n${p.content}\n"""`;
    });
    sections.push(`## Company knowledge\n${KNOWLEDGE_RULES}\n\n${passages.join("\n\n")}`);
  }
  return sections.join("\n\n");
}
