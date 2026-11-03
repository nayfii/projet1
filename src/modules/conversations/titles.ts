/** Automatic conversation titles: when to ask, what to ask, and how to clean the answer. */

export const TITLE_SYSTEM = [
  "Task: title a conversation.",
  "Write the title of this conversation for a list of conversations, like ChatGPT or Claude do: 2 to 6 words, in the language of the messages, naming the subject (not the greeting, not the assistant).",
  "If a current title is given and still describes the latest messages, return it unchanged; if the subject has clearly changed, return a new title.",
  "Placeholders such as [CLIENT_1] stand for protected values: keep them as they are.",
  "Return the title only: no quotes, no final period, no emoji.",
].join("\n");

/** After the first answer, then every third question (in case the subject changed). */
export function shouldRetitle(questionCount: number): boolean {
  return questionCount === 1 || (questionCount >= 3 && questionCount % 3 === 0);
}

/** The latest questions (as the models received them), most recent last. */
export function titleRequest(current: string | null, questions: string[]): string {
  const recent = questions.slice(-6).map((q, i) => `${i + 1}. ${q.replace(/\s+/g, " ").trim().slice(0, 500)}`);
  return [`Current title: ${current?.trim() || "(none)"}`, "", "Latest messages (most recent last):", ...recent].join("\n");
}

export function cleanTitle(raw: string): string {
  const firstLine = raw.split("\n").find((l) => l.trim()) ?? "";
  return firstLine
    .replace(/^\s*(?:title|titre)\s*:\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/[\s.。]+$/, "")
    .replace(/^["'«“\s]+|["'»”\s]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim()
    .slice(0, 80);
}
