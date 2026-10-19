import type { ProviderId } from "@/modules/providers/types";
import type { RoutingInfo } from "./stream-events";

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
};
