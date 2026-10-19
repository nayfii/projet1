import "server-only";
import { fakeProviderEnabled } from "@/lib/env";
import type { ChatProvider, ProviderId } from "../types";
import { anthropicProvider } from "./adapters/anthropic";
import { createFakeProvider } from "./adapters/fake";
import { googleProvider } from "./adapters/google";
import { openaiProvider } from "./adapters/openai";

const REAL: Record<ProviderId, ChatProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
};

export function getProvider(id: ProviderId): ChatProvider {
  return fakeProviderEnabled() ? createFakeProvider(id) : REAL[id];
}

export function configuredProviders(): Set<ProviderId> {
  return new Set((Object.keys(REAL) as ProviderId[]).filter((id) => getProvider(id).isConfigured()));
}
