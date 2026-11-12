import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Read lazily so a missing optional value (an AI key, SMTP…)
 * never breaks the whole app: each integration checks what it needs.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
});

let cached: z.infer<typeof schema> | null = null;

export function serverEnv() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${missing}. See .env.example.`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function platformAdminEmails(): Set<string> {
  return new Set(
    serverEnv()
      .PLATFORM_ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** AI provider keys (server only). A missing key disables that provider's models with a clear message. */
export function aiProviderKey(provider: "openai" | "anthropic" | "google"): string | undefined {
  const value = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  }[provider];
  return value?.trim() || undefined;
}

/** Automated tests only: replaces every provider with a simulated one (answers are visibly labelled). */
export function fakeProviderEnabled(): boolean {
  return process.env.AI_FAKE_PROVIDER === "true";
}

/** Image model that turns a photo into a personal 3D avatar (OpenAI; needs OPENAI_API_KEY). */
export function avatarImageModel(): string {
  return process.env.AVATAR_IMAGE_MODEL?.trim() || "gpt-image-1.5";
}

/** Images in the chat: ChatGPT's own image model at OpenAI (needs OPENAI_API_KEY). */
export function chatImageModel(): string {
  return process.env.CHAT_IMAGE_MODEL?.trim() || "chatgpt-image-latest";
}

/** Voice dictation: OpenAI's transcription model (CLAUDE.md §11). */
export function dictationModel(): string {
  return process.env.DICTATION_MODEL?.trim() || "gpt-4o-transcribe";
}

/** Embeddings (search index of memory and documents). The vector size must match the database (1536). */
export function embeddingsConfig(): { provider: "openai" | "google"; model: string; dimensions: number } {
  const provider = process.env.EMBEDDINGS_PROVIDER === "google" ? "google" : "openai";
  const model = process.env.EMBEDDINGS_MODEL?.trim() || (provider === "google" ? "gemini-embedding-001" : "text-embedding-3-small");
  return { provider, model, dimensions: 1536 };
}

/**
 * Secret used to encrypt the real values behind Hide placeholders (and to give them stable hashes).
 * At least 32 characters; losing or changing it makes stored mappings unreadable.
 */
export function hideSecret(): string | undefined {
  const value = process.env.HIDE_ENCRYPTION_KEY?.trim();
  return value && value.length >= 32 ? value : undefined;
}

/**
 * Releases from our console (CLAUDE.md §11): a GitHub token that may start the repository's workflows
 * and merge the changes Claude Code prepares. Server only; never sent to the browser.
 */
export function releaseConfig(): { token: string | undefined; repository: string; sourceBranch: string; releaseBranch: string } {
  return {
    token: process.env.GITHUB_RELEASE_TOKEN?.trim() || undefined,
    repository: process.env.GITHUB_REPOSITORY?.trim() || "nayfii/projet1",
    sourceBranch: process.env.RELEASE_SOURCE_BRANCH?.trim() || "claude/amazing-davinci-5th459",
    releaseBranch: process.env.RELEASE_BRANCH?.trim() || "production",
  };
}

/**
 * Tutorial video above the knowledge import (how to export from ChatGPT, Claude, Gemini, Perplexity):
 * a file of this site ("/videos/import.mp4", in public/), an https address of a video file, or a
 * YouTube / Vimeo link. The page's security policy lets in that host only (set before the build).
 * Unset: a clean placeholder is shown, and the import works the same.
 */
export function importTutorialVideoUrl(): string | null {
  const value = process.env.IMPORT_TUTORIAL_VIDEO_URL?.trim();
  if (!value) return null;
  if (/^\/[a-z0-9/_.-]+$/i.test(value) && !value.includes("..")) return value;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
