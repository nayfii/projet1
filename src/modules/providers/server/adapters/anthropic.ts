import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { aiProviderKey } from "@/lib/env";
import { createAiSdkProvider } from "../ai-sdk-adapter";

/** Anthropic (Claude models). The Messages API is stateless by design. */
export const anthropicProvider = createAiSdkProvider({
  id: "anthropic",
  apiKey: () => aiProviderKey("anthropic"),
  // Explicit base URL: an ANTHROPIC_BASE_URL variable on the host must never redirect customer data.
  model: (apiModelId, apiKey) => createAnthropic({ apiKey, baseURL: "https://api.anthropic.com/v1" })(apiModelId),
});
