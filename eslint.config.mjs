import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // No hardcoded UI text: every visible string comes from messages/*.json (CLAUDE.md §2).
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/modules/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: false, ignoreProps: true, allowedStrings: ["·", "—", "/", "+", "…", "@", "%", "(", ")", ":", "×", " "] },
      ],
    },
  },
  {
    // The service-role client bypasses RLS: only audited server modules may import it.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      "src/lib/supabase/admin.ts",
      "src/modules/identity/server/after-sign-in.ts",
      "src/modules/organizations/server/invitation-email.ts",
      "src/modules/usage/server/record.ts",
      "src/modules/conversations/server/assistant-writer.ts",
      "src/modules/hide/server/store.ts",
      "src/modules/agents/server/builtin-sync.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "@/lib/supabase/admin", message: "Service-role access is restricted to audited modules (docs/ARCHITECTURE.md §5)." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "worker/dist/**", "worker/node_modules/**", "next-env.d.ts", "src/lib/supabase/database.types.ts", "coverage/**", "playwright-report/**"]),
]);

export default eslintConfig;
