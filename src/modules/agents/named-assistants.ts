/**
 * Named assistants: a few specialists called from the chat by name, each bringing the instructions of
 * existing apps (the same engine, history and outputs as the app's form). Only where a name stands for
 * a coherent group of useful capabilities; other needs keep plain names ("Finance", "Rédaction"…) in
 * the apps directory.
 *
 * Albert — meetings and their preparation: "@Albert prépare mon rendez-vous avec Atlas" uses Meeting
 * Prep; "@Albert fais le compte rendu de ces notes" uses Meeting Minutes.
 */

export type NamedAssistant = {
  id: "albert";
  name: string;
  /** The built-in apps it brings, the first being the default. */
  builtins: readonly [string, ...string[]];
};

export const NAMED_ASSISTANTS: readonly NamedAssistant[] = [{ id: "albert", name: "Albert", builtins: ["meeting_prep", "meeting_minutes"] }];

const MENTION = /(?:^|[\s(,;:"«])@albert(?![\p{L}\p{N}_])/iu;
/** Minutes, summaries, action items: after the meeting. Otherwise: preparing it. */
const AFTER_MEETING = /compte[\s-]?rendu|minutes|proc[eè]s[\s-]verbal|transcri|r[ée]sum|synth[eè]se|actions?\s+(?:à|a)\s+mener|d[ée]cisions?\s+prises|action items|recap|summar/iu;

/** "@Albert …": the named assistant and the app it uses for this message, or null. */
export function assistantMention(text: string): { assistant: NamedAssistant; builtinKey: string } | null {
  if (!MENTION.test(text)) return null;
  const albert = NAMED_ASSISTANTS[0];
  return { assistant: albert, builtinKey: AFTER_MEETING.test(text) ? "meeting_minutes" : "meeting_prep" };
}
