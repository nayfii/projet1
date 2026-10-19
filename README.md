# AI Workspace for SMEs (working name)

One minimalist workspace where a small company's employees use ChatGPT, Claude and Gemini with a shared company memory and per-client memories. Product spec: [`CLAUDE.md`](CLAUDE.md). Progress: [`docs/STATUS.md`](docs/STATUS.md). Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Security and data flows to AI providers: [`docs/SECURITY.md`](docs/SECURITY.md).

## Run it locally

Requirements: Node 22, pnpm, Docker, Supabase CLI.

```bash
pnpm install
pnpm db:start            # local Supabase (Postgres, Auth, Storage, Realtime, test mailbox)
cp .env.example .env.local   # then paste the keys printed by `supabase status`
pnpm dev                 # http://localhost:3000
```

Sign-in links and invitations arrive in the local test mailbox: http://127.0.0.1:54324.
Emails listed in `PLATFORM_ADMIN_EMAILS` get the platform console (`/platform`) after their first sign-in.

## Checks

```bash
pnpm typecheck && pnpm lint      # types and lint
pnpm test                        # unit tests
pnpm test:integration            # isolation tests against local Supabase
pnpm build && AI_FAKE_PROVIDER=true pnpm start &       # simulated AI answers ("[TEST]"), then:
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npx playwright test   # end-to-end
pnpm test:smoke                  # one tiny real request per configured AI provider (uses the API keys)
```

AI keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) are optional: a provider without a key shows its models as "Not configured".
Memory search by meaning uses the embeddings provider set by `EMBEDDINGS_PROVIDER` (OpenAI by default, or Google); without a working key, memory is searched by exact words only.
Hide (sensitive data masking) needs `HIDE_ENCRYPTION_KEY` (at least 32 characters, e.g. `openssl rand -base64 32`); without it, messages with protection on are refused rather than sent unmasked.

Group conversations use Supabase Realtime (Postgres Changes and private Presence channels). The migrations add `messages` and `conversation_participants` to the `supabase_realtime` publication and authorise the channels; on a hosted project, Realtime must be enabled.

`pnpm db:reset` re-applies the migrations and the DEMO seed. `pnpm db:types` regenerates database types.
