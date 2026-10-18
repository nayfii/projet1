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
