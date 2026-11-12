import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/modules/integrations/providers";

/**
 * Deployment readiness (V1.1 phase 12): every setting the code reads is documented in .env.example, so
 * nothing is forgotten when a new environment is set up. Variables set by the platform itself are left out.
 */
const PLATFORM = new Set(["NODE_ENV", "NEXT_RUNTIME", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_ENV", "VERCEL_URL"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

describe(".env.example", () => {
  const documented = new Set([...readFileSync(".env.example", "utf8").matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

  it("documents every variable the app reads", () => {
    const used = new Set<string>();
    for (const file of sourceFiles("src")) for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
    for (const provider of Object.values(PROVIDERS)) if (provider.env) Object.values(provider.env).forEach((name) => used.add(name));
    const missing = [...used].filter((name) => !PLATFORM.has(name) && !documented.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("holds no value for a secret", () => {
    const lines = readFileSync(".env.example", "utf8").split("\n").filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
    const secrets = lines.filter((l) => /(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*=/.test(l) && !/^NEXT_PUBLIC_/.test(l));
    const filled = secrets.filter((l) => {
      const value = l.split("=").slice(1).join("=").trim();
      // Local development values of the local Supabase stack are public by design; everything else is empty.
      return value !== "" && !/^(sb_publishable_|sb_secret_)?[A-Za-z0-9_-]*local/i.test(value);
    });
    expect(filled).toEqual([]);
  });
});
