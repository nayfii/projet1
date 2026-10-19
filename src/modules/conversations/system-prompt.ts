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
  /** Who Can Help: colleagues with declared expertise (never from private conversations). */
  colleagues?: { name: string; expertise: string[] }[];
  /** Group conversation: several people talk; the AI was mentioned by one of them. */
  group?: boolean;
  /** A tool or agent of the company: its instructions (masked by Hide like other facts) and output format. */
  tool?: { name: string; instructions: string; format: string | null } | null;
};

export const WHO_CAN_HELP_RULES = [
  "- If the user's need clearly matches the declared expertise of a colleague listed below, you may suggest asking them, in one short sentence, writing their name exactly as listed. At most two colleagues.",
  "- Do not suggest anyone for simple questions, and never invent or extend someone's expertise.",
].join("\n");

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
  if (input.tool) {
    sections.push(
      [
        `## Tool: ${input.tool.name}`,
        "The person is using a tool set up by their company. Its first message is the filled form. Follow the tool's instructions below, within the rules above; ask one short question only if something indispensable is missing.",
        "",
        input.tool.instructions,
        ...(input.tool.format ? ["", input.tool.format] : []),
      ].join("\n"),
    );
  }
  if (input.group) {
    sections.push(
      "## Group conversation\nSeveral colleagues take part in this conversation; their messages are labelled with their names. You were mentioned by the author of the latest message: answer them, and stay brief.",
    );
  }

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
  if (input.colleagues?.length) {
    const list = input.colleagues.map((c) => `- ${c.name}: ${c.expertise.join(", ")}`);
    sections.push(`## Colleagues who can help\n${WHO_CAN_HELP_RULES}\n\n${list.join("\n")}`);
  }
  return sections.join("\n\n");
}
