import type { ProviderId } from "@/modules/providers/types";
import type { RoutingInfo, SuggestedColleague } from "./stream-events";
import type { SourceProof } from "@/modules/memory/types";
import type { HideCounts, Span } from "@/modules/hide/categories";

/** A message as shown in the conversation timeline (server and browser). */
export type TimelineMessage = {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error" | "stopped";
  errorCode: string | null;
  createdAt: string;
  author: { id: string; name: string | null } | null;
  model: { id: string; provider: ProviderId; label: string } | null;
  routing: RoutingInfo | null;
  /** Oldest messages left out of the AI context because the conversation was too long. */
  omittedMessages: number;
  attachments: { id: string; filename: string; kind: "image" | "document"; truncated: boolean }[];
  /** Source Proof: memory passages the answer cited (only those the viewer may still read). */
  sources: SourceProof[];
  /** Hide: exactly what the AI received (user message) or wrote (answer), when it differs from `content`. */
  maskedContent: string | null;
  /** Hide: what was masked in a user message and its files, per category. */
  hideCounts: HideCounts | null;
  /** Hide: where the protected values are in a user message (shown struck through in green). */
  hideSpans: Span[];
  /** Group conversation: the answer used only what every participant can see, and that was less. */
  contextLimited: boolean;
  /** Who Can Help: colleagues the answer suggests asking. */
  suggestedColleagues: SuggestedColleague[];
};
