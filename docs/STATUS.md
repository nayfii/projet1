# Status

Last update: Step 2 (multi-model chat, usage, credits, quotas), 2026-10-19.
Legend: **done** · **partial** · **not started** · **known issue**

---

## 4.1 Multi-model chat
| Feature | Status |
|---|---|
| Provider interface (one adapter per provider) | **done** (Step 2): `src/modules/providers/types.ts`, adapters wrap the Vercel AI SDK v7; stateless (OpenAI `store: false`), fixed provider URLs |
| OpenAI adapter | **done and tested with the real API** (GPT-6 Luna). GPT-6.1 Sol is refused by OpenAI on the current account ("no credits remaining", see Known issues) |
| Anthropic adapter | **done, not tested with the real API**: no Anthropic key in this environment (unit-tested through the shared adapter code) |
| Google (Gemini) adapter | **done, not tested with the real API**: no Gemini key in this environment |
| Streaming | **done**: NDJSON stream from `POST /api/chat`; the answer keeps being written and saved if the browser reloads or closes; the Stop button stops it on the server |
| Clean errors (missing key, invalid key, rate limit, provider out of credit, provider down, unknown model, too long, content filter) | **done**: translated, model-specific messages with "Try with another model"; provider error bodies are never logged or shown |
| Markdown rendering | **done** (raw HTML never rendered; code blocks with copy) |
| Persistent history | **done** |
| Search across conversations | **done**: full text, accent-insensitive (`search_conversations`), highlighted excerpts, Ctrl K; only conversations the user takes part in |
| Organisation by client | **done**: link a conversation to a client (header), client name in the sidebar, conversations listed on the client page, "New conversation" from a client |
| Copy / regenerate | **done**: copy (Markdown), regenerate, regenerate with another model; the replaced answer is hidden from the timeline and from the AI context |
| File attachments | **done**: PDF, DOCX, XLSX, CSV, TXT, MD (text extracted on our server, 40,000 characters max per file, "partly read" shown) and PNG/JPEG/WEBP/GIF images (sent to the model as images). 10 MB and 5 files per message. Private storage bucket. No OCR: scanned PDFs have no text (the user is warned) |
| Clear model labels | **done**: "Claude · Sonnet 5.5" on every answer, with a muted per-provider colour; tiers (Fast / Balanced / Most capable) in the picker |
| Switch model mid-conversation ("Continue with Claude") | **done**: the platform rebuilds the same context for any model (single context builder, unit test); a "Continued with…" divider marks the switch |
| Auto mode (Smart Router) with one-line reason | **done** (rule-based v1): classifies quick / writing / analysis / code / long content / image (French and English cues), picks among allowed and configured models by tier, strengths and cost; shows e.g. "Auto: writing, quality first" |
| Company admin: allowed models and default model | **done** (`/admin/models`, "models" scope): allowed models, default model, Auto on/off; enforced by the server and in SQL |
| AI Clarification (system prompt behaviour) | **done**: rules in `src/modules/conversations/system-prompt.ts`; observed with the real GPT-6 Luna (asked "Which client and which service…?" before drafting a proposal) |

## 4.2 Two memories and Source Proof
| Feature | Status |
|---|---|
| Company memory | not started |
| Client memory (one per client) | not started |
| Client visibility Open / Restricted | **done** (Step 1) |
| Client assignments | **done** (Step 1) |
| Permission categories (read / write per memory) | not started |
| Deliberate memory entries (from chat, document, approved AI suggestion) | not started |
| Entries editable / deletable, with source, author, date | not started |
| Promotion of general learnings to company memory (AI proposes, human approves) | not started |
| Document upload: PDF, DOCX, TXT, MD, CSV, XLSX | not started |
| Chunking + embeddings (pgvector) | not started |
| Permission-filtered retrieval | not started |
| Source Proof (document / entry, exact passage, date, clickable) | not started |
| "I don't know" when memory does not support an internal rule | not started |

## 4.3 Hide
| Feature | Status |
|---|---|
| Automatic mode (typed message) | not started |
| Documents mode (attachments) | not started |
| Manual mode (red highlights, click to blur, free selection) | not started |
| Pattern detection with checksums (IBAN, cards, emails, phones, amounts) | not started |
| Company lists (client names, employee names, custom terms) | not started |
| Local NER for person names | not started |
| Reversible pseudonymisation, server-side mapping per conversation | not started |
| Admin settings: default mode, custom sensitive terms | not started |
| Metadata-only masking event logging | not started |

## 4.4 Collaboration
| Feature | Status |
|---|---|
| Group conversation ("Add" button) | not started |
| Real-time updates, presence, authorship | not started |
| AI answers only when mentioned (@Claude, @ChatGPT, @Gemini, @AI) | not started |
| History on join (from arrival by default) + "Share history" selector | not started |
| AI context = history visible to all + intersection of permissions, with indicator | not started |
| Conversation transfer (ownership change, sender loses access, logged) | not started |
| Smart Handover (conversation, restricted client, project) | not started |
| Who Can Help (expertise, suggestions, invite button, opt-out) | partial: expertise and opt-out are captured in profiles (Step 1); suggestions come in Step 5 |

## 4.5 Confronter
| Feature | Status |
|---|---|
| Parallel answers from allowed models | not started |
| Cross-critique | not started |
| Synthesis (agreements, divergences, errors, claims to verify, recommended answer) | not started |
| Hide + permission rules applied | not started |
| Credit cost shown before running, counted against quota | not started |

## 4.6 Turn into a tool
| Feature | Status |
|---|---|
| Extraction of a tool from a conversation | not started |
| Review and edit by the creator | not started |
| Visibility: me / team / company | not started |
| Company-wide publication with Admin approval | not started |
| Tools run as a simple form from the library | not started |

## 4.7 Agent library by department
| Feature | Status |
|---|---|
| Shared agent/tool framework | not started |
| Library organised by department | not started |
| Company customisation (instructions, tone, defaults, memory) and enable per role | not started |
| Marketing — Motion Design (HyperFrames → MP4) | not started |
| Marketing — Video Editor (clips + brief → MP4, 16:9 / 9:16 / 1:1) | not started |
| Sales — Proposal Writer | not started |
| Sales — Meeting Prep | not started |
| Accounting — Invoice Intake (CSV / XLSX export) | not started |
| Accounting — Payment Reminders | not started |
| Finance — Cash-Flow Forecast (table + chart) | not started |
| Finance — Margin Analysis | not started |
| HR — Job Posting Writer | not started |
| HR — Application Review Assistant (no scoring / ranking / rejection, notice) | not started |
| Legal — Contract Review ("not legal advice" notice) | not started |
| Legal — Template Drafter ("not legal advice" notice) | not started |
| Customer Service — Email Responder | not started |
| Customer Service — Feedback Synthesis | not started |
| Management — Meeting Minutes (incl. audio file) | not started |
| Management — Weekly Dashboard | not started |
| Render worker container (Chromium, FFmpeg, HyperFrames) + DB job queue | not started |
| Dedicated video / motion credit quota | not started |

## 4.8 Company admin console
| Feature | Status |
|---|---|
| Employees: invite, deactivate, roles, expertise | **done** (Step 1) |
| Permissions: memory categories, client visibility and assignments | partial: client visibility and assignments done; memory categories in Step 3 |
| Models: enable / disable, default, Auto mode | **done** (Step 2) |
| Agents and tools: enable per role, approve company-wide tools | not started |
| Hide policies | not started |
| Usage dashboards (real provider data; costs labelled as estimates) | **done** (Step 2, `/admin/usage`): requests, tokens, credits, estimated cost by person, by model and per day, month picker. A richer dashboard comes in Step 9 |
| Quotas | **done** (Step 2, `/admin/quotas`): company credits this month, default limit per person, personal limits per member |
| Activity log | partial: sign-ins, invitations, member changes, client creation / visibility / access, model settings, quota changes, **blocked AI requests** (Step 2); transfers and masking events come with their features |

## 4.9 Platform admin console
| Feature | Status |
|---|---|
| Company list, create / suspend | **done** (Step 1) |
| Plans and seats | **done** (Step 1): seat limit enforced on invitations |
| Quotas and credits per company | **done** (Step 2): credits used / limit this month per company, "Add credits" for the month (extra credits). Video credits: Step 8 |
| Usage and estimated AI cost per company (margin view) | partial: requests and estimated AI cost this month per company on the companies list; full margin view in Step 9 |
| Provider health | not started |
| Platform audit log | **done** (Step 1) |
| No access to customer content (DB policies + server + tests) | **done** for Step 1 and Step 2 tables (conversations, messages, attachments, usage rows, quotas: zero rows, tested); every new content table must be added to the test list |
| Model catalogue, price estimates, credit rates | **done** (Step 2, `/platform/models`): editable, nothing hardcoded; default prices are placeholders to verify |

## 4.10 Onboarding
| Feature | Status |
|---|---|
| Create account → company → profile → invite → first client → first document → first conversation, skippable steps | partial: everything works except "first document" (Coming soon until Step 3); the last step opens the first conversation |

## Foundations (sections 2, 3, 5, 7, 8)
| Feature | Status |
|---|---|
| Next.js + TypeScript + Tailwind + shadcn/ui project | **done** (Next.js 16.4, React 19.3, Tailwind 4.3). shadcn/ui components written by hand in the same style: the shadcn registry is blocked from this cloud session |
| Design system and app shell | **done** (v1): tokens in `src/app/globals.css`, components in `src/components/ui`, shell in `src/components/shell`. Light and dark (system). Product name and accent colour are placeholders |
| i18n French / English, browser default, per-user switch | **done**: `messages/fr.json` + `en.json`, lint rule against hardcoded JSX text, test that both files have the same keys |
| Supabase local + migrations + RLS on every tenant table | **done** for Step 1 tables (`supabase/migrations/20261018000001_foundation.sql`); a test fails if any public table lacks RLS |
| Authentication: email + magic link, Google | partial: magic link **done and tested end to end**; Google sign-in implemented but **not tested** (needs a Google OAuth client) |
| Server-side authorisation helpers | **done** (`src/lib/auth/guards.ts`), plus RPC checks and RLS in the database |
| Three spaces (platform admin, company admin, member app) | **done**: `/platform`, `/admin`, member app at `/` |
| Quotas per company and per user (80 % warning, 100 % stop) | **done** (Step 2): checked on the server before every AI call (hard stop, logged), warning banner from 80 %, monthly reset (UTC) |
| Configurable plans, quotas, credit costs (no hardcoded prices) | **done**: plans, credit rates per model and price estimates are edited by the platform admin; usage rows keep the rates in force at the time |
| Isolation tests (companies, clients, group intersection, platform admin) | partial: 71 integration tests (Step 1 + Step 2: private conversations, restricted-client conversations, unforgeable AI answers and usage, storage, quotas, model settings, platform admin); group intersection in Step 5 |
| Model-independent knowledge: single context builder, stateless providers, identical context across models (test) | **done** for chat history and attachments (memory joins the same builder in Step 3); context budget = smallest window among the company's models, capped at 60,000 estimated tokens |
| Usage logging from real provider token counts | **done**: one metadata-only row per AI call (tokens, cached tokens, credits, estimated cost, model, status). Only a stopped answer (or one cut by an error) without provider counts is estimated, and flagged as such |

---

## Development environment (checked at Step 0)

This project is currently developed in a **Claude Code cloud session** (Linux container), not on the founder's Mac.

| Tool | Status |
|---|---|
| Node.js | 22.22.0 ✓ |
| Package manager | pnpm 10.28.0 ✓ (chosen); npm, yarn, bun also present |
| Docker | 29.8.2 ✓ (daemon started manually in the session) |
| Supabase CLI | 2.121.0 ✓ (installed at Step 0 via npm) |
| Supabase local images | ✓ pulled from Docker Hub (`pnpm db:start` sets `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`; GitHub's registry is blocked here) |
| git | 2.43.0 ✓ (repository initialised at Step 0, **no remote yet**) |
| FFmpeg / Chromium | present ✓ (useful for Step 8 tests) |

**Network policy of the cloud session** (affects development and tests here, not production):

| Host | Reachable |
|---|---|
| api.anthropic.com | yes |
| generativelanguage.googleapis.com (Gemini) | yes |
| api.openai.com | yes (allowed since Step 2; an OpenAI key is configured in this environment) |
| *.supabase.co (hosted Supabase) | **no — blocked** |
| huggingface.co (local NER model download) | **no — blocked** |
| cdn.jsdelivr.net (GSAP for HyperFrames previews) | **no — blocked** |
| github.com release downloads | **no — blocked** |
| registry.npmjs.org, Docker Hub, fonts.googleapis.com | yes |

---

## Tests (Step 2)

| Suite | Command | Result |
|---|---|---|
| Unit (router FR/EN, system prompt, context builder, credits, quotas, provider errors, file reading, translations, helpers) | `pnpm test` | 77 passed |
| Integration: isolation with real users and JWTs (Step 1 + Step 2) | `pnpm test:integration` | 71 passed |
| End to end in Chromium, chat (test provider: `AI_FAKE_PROVIDER=true`) | `npx playwright test e2e/chat.spec.ts` | 15 passed |
| End to end in Chromium, Step 1 foundation | `npx playwright test e2e/foundation.spec.ts` | 5 passed |
| Real provider smoke test | `pnpm test:smoke` | 3 passed, 4 skipped: OpenAI GPT-6 Luna answers with real token counts; GPT-6.1 Sol refused by the provider account (reported, not a code failure); unknown model correctly reported; Anthropic and Google skipped (no key) |
| Type check, lint, production build | `pnpm typecheck`, `pnpm lint`, `pnpm build` | OK |

Screenshots for the founder: `docs/screenshots/step-2/` (`real-*` files use the real ChatGPT; the others come from the automated test run with simulated answers marked "[TEST]").

## Known issues

- **Code location:** the code is on GitHub (`nayfii/projet1`, branch `claude/amazing-davinci-5th459`), not merged into the main branch yet.
- **The founder cannot click-test yet:** the app runs only inside this container. A preview deployment (Supabase EU project + EU hosting) is needed for hands-on testing.
- Google sign-in is untested (needs a Google OAuth client). The button stays hidden until `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
- Emails go to the local test inbox (Mailpit). Production needs an SMTP provider; Supabase's default limit of 2 emails/hour must then be raised.
- No ownership transfer (Owner → someone else) and no company switcher for people in several companies (the database supports several memberships, the UI uses the first active one).
- A platform admin who is also a member of a company sees that company's content as a member. Our team should use separate accounts.
- Product name ("Workspace") and accent colour are placeholders until the branding is chosen.
- **No sensitive-data protection yet (Hide comes in Step 4):** messages and the text of attached documents are sent to the AI provider as typed. Do not use real confidential data before Step 4.
- **OpenAI account:** GPT-6.1 Sol answers "no credits remaining" (HTTP 429 `insufficient_quota`) while GPT-6 Luna works. Until the billing of that OpenAI account is fixed (or a Claude/Gemini key is added), Auto sends writing and analysis questions to GPT-6.1 Sol and the user sees "the provider account is out of credit". Workaround: disallow GPT-6.1 Sol in Administration → Models.
- **Claude and Gemini are untested with the real APIs** (no keys here). The code path is shared with OpenAI, but a first real call should be checked as soon as keys exist (`pnpm test:smoke`).
- **Model prices are placeholders** taken from third-party price lists (October 2026); they drive cost *estimates* only. The platform admin must check them against the official pricing pages (Platform console → Models and pricing). Gemini models use Google's `-latest` aliases, whose price can change silently.
- Quotas are checked before each request: several requests sent at the same moment can go slightly over a limit.
- Context budget uses an estimate of 3.5 characters per token; providers bill with their own counts.
- DOCX text extraction (mammoth) is not covered by an automated test yet (PDF, XLSX and text are).
- The Owner cannot read employees' private conversations (see decisions below). Group conversations, transfer and Smart Handover arrive in Step 5.
- Ad-hoc decisions taken in Step 1, to confirm:
  - only the Owner and Admins with the "clients" scope create clients (members cannot);
  - an Admin with the "clients" scope sees the name of restricted clients in order to manage them (their memory will stay restricted);
  - the Owner always has access to every client, including restricted ones ("full control").
- Ad-hoc decisions taken in Step 2, to confirm:
  - conversations are private to their participants: the Owner and Admins see usage figures, never the content of employees' conversations;
  - a conversation linked to a restricted client disappears for a participant who loses access to that client (and comes back if access is restored);
  - only our team (platform admin) raises a company's monthly credit limit ("Add credits" for the month); company admins set limits per person;
  - default credit rate: 1 credit ≈ 0.001 USD of estimated provider cost; the DEMO plan has 100,000 credits per month;
  - closing the tab or reloading does not stop an answer (it is completed, saved and charged); the Stop button stops it and only what was written is charged (estimated);
  - Auto mode prefers Claude for writing, GPT for reasoning and code, Gemini for long documents and images, and the cheapest suitable model for quick questions;
  - company admins see the *estimated* AI cost in US dollars (CLAUDE.md §4.8), which reveals our approximate cost to customers: to confirm commercially;
  - the person who started a conversation can delete it permanently (with its files);
  - images are sent to the AI provider as images: Hide (Step 4) will not be able to mask text inside images.

## Open questions for the founder

The founder asked to proceed ("je suis prêt à construire le tout") without answering these yet: the proposals below are applied as **defaults** and can be changed.


1. **Permission categories** — proposed meaning: named groups of people (e.g. "All employees", "Management", "Finance") that are granted read and/or write on each memory. Defaults: everyone reads company memory, Owner + Admins write it; anyone with access to a client reads and writes its memory. To confirm.
2. **"Project"** appears in Smart Handover ("a conversation, a restricted client or a project is transferred") but no project object exists elsewhere in the spec. Proposal: no "project" object at launch; handover for conversations and clients only. To confirm.
3. **Client transfer** — when Client A moves from Olivier to Nathalie, what happens to Olivier's conversations linked to Client A? Proposal: they move to Nathalie together with the client (Olivier loses them too), and the Smart Handover summarises them. To confirm.
4. **Hide and amounts** — masking every amount breaks finance questions (the model cannot compute on `[AMOUNT_1]`). Proposal: amounts are a category the company can switch off, off by default in Automatic mode. To confirm.
5. **Embeddings and sensitive data** — documents saved to memory are sent in clear to the embeddings provider (OpenAI or Google) to build the search index; Hide does not apply there (masking would break search). Alternative: a local embeddings model (data stays on our servers, lower search quality, more server cost). Decision needed before real customer data.
6. **Who sees real values in a group chat** — proposal: every participant who can see a message sees the real values typed in it (they were shared by a colleague); the AI only ever sees placeholders. To confirm.
7. **Gemini terms** — the free tier of the Gemini API allows Google to use data to improve its products. The production key must be on a paid (billing-enabled) Google project, or on Vertex AI in an EU region.
8. **Meeting Minutes with audio** — needs a speech-to-text model (e.g. OpenAI or Gemini audio input). This is another data flow to document; to confirm it is acceptable.
9. **Knowledge export** — a company could export its whole memory (entries + documents) in open formats, which proves it is not locked in. Not in the launch spec; to confirm whether to add it.
10. **AI provider keys (Step 2)** — to test Claude and Gemini for real, the platform needs an Anthropic API key and a Gemini API key from a billing-enabled Google project (`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). The current OpenAI account needs credit: GPT-6.1 Sol is refused with "no credits remaining".
11. **Value of a credit** — proposal: 1 credit ≈ 0.001 USD of estimated AI cost (so 100,000 credits ≈ 100 USD of AI per month). The number of credits per plan and per seat should be decided together with the price (€30–40 per user per month).
12. **Showing the estimated AI cost to customers** — CLAUDE.md §4.8 asks for it on the company usage page, so it is shown (labelled as an estimate). It reveals our approximate cost; confirm, or show credits only.
