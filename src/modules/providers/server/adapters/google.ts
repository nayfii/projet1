import "server-only";
import { createGoogle } from "@ai-sdk/google";
import { aiProviderKey } from "@/lib/env";
import { createAiSdkProvider } from "../ai-sdk-adapter";

/**
 * Google (Gemini models) through the Gemini API. The key must belong to a billing-enabled project:
 * on the free tier Google may use the data to improve its products (docs/STATUS.md, question 7).
 */
export const googleProvider = createAiSdkProvider({
  id: "google",
  apiKey: () => aiProviderKey("google"),
  model: (apiModelId, apiKey) =>
    createGoogle({ apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta" })(apiModelId),
});
