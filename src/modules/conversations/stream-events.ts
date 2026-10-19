import type { QuotaState } from "@/modules/usage/quota";
import type { ProviderErrorCode, ProviderId } from "@/modules/providers/types";
import type { RoutingBasis, TaskType } from "@/modules/providers/router";
import type { SourceProof } from "@/modules/memory/types";

/**
 * Wire format of POST /api/chat: one JSON object per line (NDJSON).
 * Errors found before the AI is called come back as a plain JSON body instead (ChatRequestError).
 */

export type RoutingInfo = { mode: "auto"; task: TaskType; basis: RoutingBasis };

export type StreamModel = { id: string; provider: ProviderId; label: string };

export type ChatStreamEvent =
  | {
      type: "meta";
      conversationId: string;
      userMessage: { id: string; seq: number } | null;
      assistantMessage: { id: string; seq: number };
      model: StreamModel;
      routing: RoutingInfo | null;
      /** Answer being replaced (Regenerate). */
      replaces: string | null;
      omittedMessages: number;
    }
  | { type: "delta"; text: string }
  | { type: "done"; credits: number; quota: QuotaState | null; sources: SourceProof[] }
  | { type: "error"; code: ProviderErrorCode | "server_error"; retryable: boolean };

export const CHAT_REQUEST_ERRORS = [
  "validation",
  "not_found",
  "forbidden",
  "quota_exceeded_user",
  "quota_exceeded_company",
  "model_not_allowed",
  "auto_disabled",
  "no_model_available",
  "missing_key",
  "attachment_invalid",
  "nothing_to_regenerate",
  "server_error",
] as const;
export type ChatRequestError = (typeof CHAT_REQUEST_ERRORS)[number];
