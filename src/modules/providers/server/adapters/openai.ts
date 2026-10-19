import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { aiProviderKey } from "@/lib/env";
import { createAiSdkProvider } from "../ai-sdk-adapter";

/** OpenAI (ChatGPT models) through the Responses API, stateless: store = false. */
export const openaiProvider = createAiSdkProvider({
  id: "openai",
  apiKey: () => aiProviderKey("openai"),
  // Explicit base URL: an OPENAI_BASE_URL variable on the host must never redirect customer data.
  model: (apiModelId, apiKey) => createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" })(apiModelId),
  providerOptions: { openai: { store: false } },
});
