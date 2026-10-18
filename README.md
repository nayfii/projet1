# AI Workspace for SMEs (working name)

One minimalist workspace where a small company's employees use ChatGPT, Claude and Gemini with a shared company memory and per-client memories. Product spec: [`CLAUDE.md`](CLAUDE.md). Progress: [`docs/STATUS.md`](docs/STATUS.md). Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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
pnpm build && pnpm start &       # then:
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npx playwright test   # end-to-end
```

`pnpm db:reset` re-applies the migrations and the DEMO seed. `pnpm db:types` regenerates database types.
