# Architecture

Status: **Steps 1–2 implemented** (identity, companies, roles, invitations, clients, audit, the three spaces; multi-model chat, Smart Router, usage, credits and quotas). Later sections describe the plan for Steps 3–10. Updated at the end of every step; §12–13 record what was actually built.
Source of truth for product decisions: `CLAUDE.md`. Open questions live in `docs/STATUS.md`.

---

## 1. Overview

A **modular monolith**: one Next.js application (UI + server) on top of one Supabase project (Postgres, Auth, Storage, Realtime), plus one separate **render worker** container for video. No microservices.

```
 Browser ──HTTPS──► Next.js app (EU)  ──► Supabase (EU): Postgres + pgvector, Auth, Storage, Realtime
                       │    │
                       │    └──► AI providers (OpenAI, Anthropic, Google) — only masked / authorised content
                       │
                       └──► render_jobs table ◄── Render worker container (EU): Chromium + FFmpeg + HyperFrames
```

Guiding rules:
- The **platform owns** conversations, memory, permissions and context. Providers are stateless adapters.
- **Two barriers** for every access: server-side authorisation in code, then Row Level Security (RLS) in Postgres.
- The browser never holds a provider key or the Supabase service key.
- Logs and analytics hold **metadata only** (counts, categories, ids), never prompt content or masked values.

### 1.1 Model-independent knowledge (core differentiator)

The company's and clients' knowledge lives **outside every LLM**, in our database. Models are interchangeable readers that receive the same authorised information at each request and keep nothing.

1. **Single source of truth in our database:** company memory, client memories, documents (original file + extracted text), conversations, company tone and instructions, agents and tools.
2. **Stateless providers:** no provider-side memory, threads, assistants, projects, uploaded files or vector stores. Every request is self-contained; `store: false` (or equivalent) wherever the API offers it. Short-lived prompt caching is allowed (performance only, not a knowledge store).
3. **One context builder for all models:** the same retrieval, the same selection of passages, the same system prompt, whichever model answers. Only the wire format differs per adapter. The context budget fits the smallest context window among the company's allowed models, so no model gets more or less knowledge. A test asserts that the context built for a given question is identical across providers.
4. **The search index is derived and rebuildable:** embeddings are computed from the text we keep; the embedding model is stored on each row, so the index can be regenerated with another provider or a local model without losing anything.
5. **Switching or losing a provider loses nothing:** removing an adapter removes a reader, never knowledge.

---

## 2. Repository layout

```
/
├─ CLAUDE.md                     product spec (source of truth)
├─ docs/                         ARCHITECTURE, STATUS, SECURITY, ROADMAP, BUILD_STEPS
├─ messages/                     i18n strings: fr.json, en.json
├─ src/
│  ├─ app/                       Next.js App Router
│  │  ├─ (auth)/                 sign-in, magic link, OAuth callback, invitation acceptance
│  │  ├─ onboarding/             company creation wizard
│  │  ├─ (app)/                  member app: chat, clients, memory, library, tools, settings
│  │  ├─ admin/                  company admin console (Owner / Admin)
│  │  ├─ platform/               platform admin console (our team)
│  │  └─ api/                    route handlers: chat stream, uploads, hide/detect, jobs
│  ├─ components/ui/             design system (tokens, typography, shadcn/ui-based primitives)
│  ├─ lib/                       shared helpers: supabase clients, auth guards, i18n, errors
│  └─ modules/                   one folder per domain module (see §3)
│     └─ <module>/
│        ├─ server/              services and data access ("server-only")
│        ├─ ui/                  module-specific components
│        ├─ schema.ts            zod schemas and types
│        └─ index.ts             public API of the module (other modules import only this)
├─ supabase/
│  ├─ migrations/                SQL migrations (tables, RLS, functions)
│  ├─ seed.sql                   local dev seed (clearly marked DEMO)
│  └─ tests/                     pgTAP tests for RLS
├─ worker/                       render worker (own Dockerfile, own package.json)
├─ tests/                        Vitest unit + integration (against local Supabase)
└─ e2e/                          Playwright end-to-end (launch scenario)
```

---

## 3. Modules

| Module | Responsibility |
|---|---|
| `identity` | Auth (email + magic link, Google), sessions, profiles, locale, platform-admin flag |
| `organizations` | Companies, memberships, roles (Owner / Admin / Member), admin delegation scopes, teams, invitations, onboarding |
| `clients` | Clients, Open / Restricted visibility, assignments, client transfer |
| `conversations` | Conversations, participants, messages, group chat, history sharing, mentions, conversation transfer |
| `documents` | Upload, parsing (PDF, DOCX, TXT, MD, CSV, XLSX), chunking, embeddings, retrieval |
| `memory` | Memory spaces (company / client), entries, permission categories, suggestions, promotion, Source Proof |
| `providers` | Provider interface, OpenAI / Anthropic / Google adapters, model catalogue, Smart Router, embeddings provider |
| `hide` | Sensitive data detection, pseudonymisation, mapping vault, restore, masking events |
| `agents` | Shared agent/tool framework, built-in agents, "Turn into a tool", library, Confronter orchestration, exports |
| `collaboration` | Smart Handover, Who Can Help |
| `usage` | Usage events, credits, quotas (80 % warning / 100 % stop), pricing tables, estimates |
| `render` | Render job queue API (enqueue, status); the worker itself lives in `/worker` |
| `audit` | Activity log (company) and platform audit log |

Rule: a module imports another module only through its `index.ts`. Cross-module data access goes through the owning module's services.

---

## 4. Data model

Conventions: UUID primary keys, `created_at` / `updated_at` timestamps, soft delete (`deleted_at`) only where useful.
**Every tenant table carries `company_id`** (denormalised even when derivable) so every RLS policy can filter on it directly.
Tables that hold client-specific content also carry **`client_id`** (nullable when the row is not client-specific).

### 4.1 Identity, companies, roles

| Table | Key columns | company_id | client_id |
|---|---|---|---|
| `profiles` | `id` (= auth user id), `full_name`, `avatar_url`, `locale` | – | – |
| `platform_admins` | `user_id` | – | – |
| `plans` | `name`, `monthly_credits`, `video_credits`, `max_seats`, `features` (json), `price_label` (display only, no hardcoded price) | – | – |
| `companies` | `name`, `plan_id`, `status` (active / suspended), `settings` (json: default model, allowed models, Auto mode, Hide defaults) | (is the tenant) | – |
| `company_members` | `user_id`, `role` (owner / admin / member), `admin_scopes` (text[]), `status` (active / deactivated), `job_title`, `team_id`, `expertise` (text[]), `who_can_help_opt_out` | ✓ | – |
| `teams` | `name` (used for "my team" visibility and as department grouping) | ✓ | – |
| `invitations` | `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at` | ✓ | – |

Admin delegation: an Admin's powers are the `admin_scopes` granted by the Owner, e.g. `members`, `clients`, `permissions`, `models`, `agents`, `hide`, `usage`, `quotas`, `activity`. The Owner implicitly has all scopes.

### 4.2 Clients and memory

| Table | Key columns | company_id | client_id |
|---|---|---|---|
| `clients` | `name`, `visibility` (open / restricted), `sector`, `archived_at` | ✓ | (is the client) |
| `client_assignments` | `user_id`, `assigned_by` | ✓ | ✓ |
| `memory_spaces` | `kind` (company / client) — exactly one company space per company, one space per client | ✓ | ✓ (null for company space) |
| `permission_categories` | `name`, `description` (e.g. "All employees", "Management", "Finance") | ✓ | – |
| `permission_category_members` | `category_id`, `user_id` | ✓ | – |
| `memory_space_grants` | `space_id`, `category_id`, `can_read`, `can_write` | ✓ | ✓ |
| `memory_entries` | `space_id`, `title`, `content`, `source_type` (chat / document / ai_suggestion / promotion / manual), `source_ref` (json), `author_id`, `embedding vector` | ✓ | ✓ |
| `memory_suggestions` | `kind` (new_entry / promotion), `proposed_content`, `source_ref`, `status` (pending / approved / rejected), `decided_by` | ✓ | ✓ |
| `documents` | `scope` (memory / conversation_attachment / agent_input), `space_id` or `conversation_id`, `filename`, `mime_type`, `storage_path`, `status` (uploaded / processing / ready / failed), `uploaded_by` | ✓ | ✓ |
| `document_chunks` | `document_id`, `chunk_index`, `content`, `page`, `char_start`, `char_end`, `embedding vector` | ✓ | ✓ |

Embeddings: one fixed dimension per deployment (planned **1536**: OpenAI `text-embedding-3-small` natively, Google Gemini embeddings with `output_dimensionality = 1536`). The model used is stored on each row so a re-embedding job can migrate later. HNSW index on `embedding`.

### 4.3 Conversations and collaboration

| Table | Key columns | company_id | client_id |
|---|---|---|---|
| `conversations` | `owner_id`, `title` (first message by default), `model_choice` ('auto' or a model id), `is_group`, `last_seq`, `last_message_at` (*Step 4 adds Hide modes*) | ✓ | ✓ (optional link to a client) |
| `conversation_participants` | `user_id`, `role` (owner / participant), `visible_from_seq`, `added_by`, `joined_at`, `left_at` | ✓ | – |
| `messages` | `seq` (per conversation, set by trigger), `author_type` (user / assistant), `author_id`, `content` (as typed, real values), `model_content` (masked version, Step 4), `provider`, `model_id`, `api_model_id`, `model_label` (snapshot), `routing` (Auto reason as codes), `status` (streaming / complete / error / stopped), `error_code`, `superseded_at` (Regenerate), `stop_requested_at` (Stop button), `context_meta`, token counts. *Planned for Step 5: `mentions`, `context_limited`. `client_id` is read from the conversation, not copied.* | ✓ | – |
| `message_sources` | `message_id`, `source_type` (document_chunk / memory_entry), `source_id`, `excerpt`, `source_date` — Source Proof | ✓ | ✓ |
| `conversation_attachments` | `conversation_id`, `message_id` (null until sent), `uploaded_by`, `filename`, `mime_type`, `size_bytes`, `storage_path`, `kind` (image / document), `extracted_text`, `text_truncated` — *built in Step 2 instead of `message_attachments` → `documents`: chat files are not memory documents; Step 3 can copy one into memory* | ✓ | – |
| `transfers` | `subject_type` (conversation / client), `subject_id`, `from_user`, `to_user`, `handover_id` | ✓ | ✓ |
| `handovers` | `subject_type`, `subject_id`, `content` (editable Markdown), `status` (draft / final), `edited_by` | ✓ | ✓ |

### 4.4 Hide

| Table | Key columns | company_id |
|---|---|---|
| `hide_mappings` | `conversation_id`, `placeholder` (e.g. `[IBAN_1]`), `category`, `value_hash` (HMAC, for stable reuse), `value_ciphertext` (AES-GCM, app-level key) | ✓ |
| `sensitive_terms` | `term`, `category` (client / project / file / custom), `created_by` | ✓ |
| `hide_events` | `conversation_id`, `user_id`, `mode`, `counts` (json: category → count). **No values.** | ✓ |

`hide_mappings` has RLS enabled with **no policy for authenticated users**: only the server (service role, inside the `hide` module) can read it.

### 4.5 Agents, tools, Confronter

| Table | Key columns | company_id |
|---|---|---|
| `agent_settings` | per company customisation of a **built-in** agent: `agent_key`, `enabled`, `enabled_roles`, `custom_instructions`, `tone`, `defaults`, `memory_scope` | ✓ |
| `tools` | user-created tools: `name`, `description`, `department`, `instructions`, `input_schema` (form fields), `allowed_models`, `memory_scope`, `output_format`, `visibility` (me / team / company), `owner_id`, `team_id`, `status` (draft / pending_approval / published / disabled), `source_conversation_id` | ✓ |
| `tool_approvals` | `tool_id`, `requested_by`, `decided_by`, `decision`, `comment` | ✓ |
| `agent_runs` | `agent_key` or `tool_id`, `user_id`, `inputs` (json), `output` (json / Markdown), `files`, `status`, `credits` | ✓ (+ `client_id`) |
| `confronter_runs` | `message_id`, `answers` (json per model), `critiques`, `synthesis`, `credits_estimated`, `credits_charged` | ✓ (+ `client_id`) |

Built-in agents (the 16 of the launch set) are **defined in code** (versioned, tested); companies customise them through `agent_settings`. User tools live in `tools`. Both run through the same `AgentRunner`.

### 4.6 Usage, quotas, pricing, audit, render

| Table | Key columns | company_id |
|---|---|---|
| `ai_models` | catalogue (built in Step 2): `id`, `provider`, `api_model_id`, `label`, `tier`, `context_window`, `max_output_tokens`, `supports_images`, `strengths` (router), USD price **estimates** and credit rates per million input / output / cached tokens, `is_enabled`, `default_allowed`. *Replaces the planned `model_pricing` + `credit_rules`: each usage row stores the credits and estimated cost computed at that moment, so history never changes. Video and Confronter rules come in Steps 6 and 8.* | – |
| `company_ai_settings` | `auto_enabled`, `default_model_id` (null = Auto), `default_user_monthly_credits` | ✓ |
| `company_allowed_models` | `model_id` (rows created from `default_allowed` models when the company is created) | ✓ |
| `usage_events` | `user_id`, `feature` (chat / confronter / agent / embedding / handover / router / render), `conversation_id`, `message_id`, `provider`, `model_id`, `api_model_id`, `auto_routed`, `input_tokens`, `output_tokens`, `cached_input_tokens` (from the provider response), `tokens_estimated`, `credits`, `estimated_cost_usd`, `credit_pool` (standard / video), `status`, `error_code`, `latency_ms`. **No content.** | ✓ |
| `member_quotas` | personal monthly credit limit overriding the company default (*replaces the planned `quotas` table: the company limit is the plan's monthly credits + grants*) | ✓ |
| `credit_grants` | extra credits for one month, granted by the platform admin | ✓ |
| `audit_log` | `actor_id`, `action`, `target_type`, `target_id`, `metadata` (no content), `scope` (company / platform) | ✓ (null for platform events) |
| `render_jobs` | `kind` (motion / video_edit), `status` (queued / running / succeeded / failed / cancelled), `progress`, `input` (composition or edit plan), `output_paths`, `error`, `attempts`, `locked_by`, `heartbeat_at`, `credits_reserved`, `credits_charged` | ✓ |

---

## 5. RLS strategy

1. **RLS is enabled on every table** in `public`. A CI check fails if a table has RLS disabled.
2. Policies call a small set of `SECURITY DEFINER`, `STABLE` helper functions (fixed `search_path`):
   - `is_company_member(company_id)`, `has_company_role(company_id, roles[])`, `has_admin_scope(company_id, scope)`
   - `has_client_access(client_id)` — Owner, or Open client, or assigned on a Restricted client
   - `can_read_space(space_id)`, `can_write_space(space_id)` — see §7
   - `is_conversation_participant(conversation_id)` and `visible_from_seq(conversation_id)`
   - `is_platform_admin()`
3. Typical policies:
   - Company metadata (`companies`, `company_members`, `teams`): members read, Owner / scoped Admin write.
   - `clients`: read if `has_client_access`, write if Owner / Admin with `clients` scope.
   - `memory_entries`, `document_chunks`, `documents` (memory scope): read if `can_read_space`, write if `can_write_space`; conversation attachments: participants only.
   - `messages`: participant **and** `seq >= visible_from_seq` for that participant.
   - `hide_mappings`: no policy → invisible to every user role.
   - `usage_events`, `audit_log`: company admins with the right scope; members see their own usage.
4. **Platform admin isolation:** platform admins are not members of any company, and **no content-table policy mentions `is_platform_admin()`**. The platform console reads only plan, company, seat, usage-aggregate and audit data, through dedicated views / `SECURITY DEFINER` functions that return non-content columns only. pgTAP tests assert that a platform admin reads zero rows from every content table (`clients`, `conversations`, `messages`, `documents`, `document_chunks`, `memory_entries`, `memory_suggestions`, `handovers`, `agent_runs`, `confronter_runs`, `tools` content).
   Honest limit: anyone with direct database credentials (service role, our infrastructure) can technically read data. The guarantee is enforced in application code and policies, not cryptographically. This will be stated in `docs/SECURITY.md`.
5. **Service role** (bypasses RLS) is used only in a few audited server modules: Hide vault, usage logging (`usage/server/record.ts`, built), AI answers (`conversations/server/assistant-writer.ts`, built), audit writes, invitation emails, platform aggregates, and the render worker. It is wrapped in one helper marked `server-only`; a lint rule forbids importing it elsewhere.
6. Server code uses the **user's JWT** client by default, so RLS applies even to server reads.

---

## 6. Provider interface

As built in Step 2 (`src/modules/providers/types.ts`; `complete()` and embeddings come when a feature needs them):

```ts
type ProviderId = 'openai' | 'anthropic' | 'google'

interface ChatProvider {
  id: ProviderId
  isConfigured(): boolean                       // key present?
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>   // never throws
}

interface ChatRequest {
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; content: ContentPart[] }[]   // already masked + permission-filtered
  maxOutputTokens?: number
  temperature?: number
}

type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number }  // real provider counts
  | { type: 'done'; finishReason: string }
  | { type: 'error'; error: ProviderError }

type ProviderError = {
  code: 'missing_key' | 'auth_failed' | 'rate_limited' | 'provider_quota' | 'unavailable' | 'model_not_found'
      | 'context_too_long' | 'content_filtered' | 'invalid_request' | 'unknown'
  retryable: boolean
  status?: number        // HTTP status only: provider error bodies can contain the prompt and are never kept
}

interface EmbeddingProvider {
  model: string; dimensions: number
  embed(texts: string[]): Promise<{ vectors: number[][]; usage: { tokens: number } }>
}
```

- Adapters wrap the **Vercel AI SDK** (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`). Adding a provider = one adapter file + catalogue rows.
- The **conversation is rebuilt by the platform on every request** (system prompt + authorised history + retrieved context + masked user message). This is what makes "Continue with Claude" trivial: the new model receives the same platform-built context.
- **Smart Router (v1, rule-based):** classifies the request (short question, writing, analysis / reasoning, long document, code, image input) and chooses among the company's allowed models by tier, cost and speed. It returns `{ model, reason }`; the reason is shown in one line under the answer.
- **AI Clarification** is a section of the platform system prompt: ask one short question only when indispensable information is missing.
- Every call writes a `usage_events` row from the provider's real token counts. Quotas are checked **before** the call (hard stop at 100 %, warning at 80 %).

---

## 7. Memory and permission model

**Spaces.** One company memory space per company, one client memory space per client.

**Who can read / write a space** (`can_read_space`, `can_write_space`):

| | Read | Write |
|---|---|---|
| Owner | always | always |
| Company space | members of a permission category granted `can_read` (default: "All employees") | categories granted `can_write` (default: "Management" = Owner + Admins) |
| Client space | requires client access (Open → every member; Restricted → assigned members), **and**, if the space has read grants, membership of one of those categories | requires client access **and** a category granted `can_write` (default: everyone with client access) |

Permission categories are plain named groups, so new rules (e.g. "Finance can read every client's financial notes") are new grants, not new code.

**Entries are deliberate:** created from a chat ("Save to memory"), from an uploaded document, or from an AI suggestion the user approves. Each entry keeps source, author and date; editable and deletable by writers.

**Promotion:** the AI may propose turning a client-memory learning into a company-memory entry. The proposal is stored in `memory_suggestions`, rewritten to remove client-identifying data, and only a user who can write the company space approves it.

**Retrieval (hard rule):**
1. Server computes the **allowed space ids** for the request (single user: their readable spaces; group: intersection, §9).
2. Vector + keyword search runs **with those ids as a mandatory filter**, through the user's JWT (RLS = second barrier).
3. Only the filtered chunks / entries reach the prompt. Each one used becomes a `message_sources` row → **Source Proof** (document or entry, exact passage, date, link that opens the passage).
4. If no source supports a claim about an internal rule, the system prompt instructs the model to say it does not know.

---

## 8. Hide pipeline

Runs **entirely on our server**. No unmasked text is ever sent to an external AI for detection.

```
typed message / attachments / retrieved excerpts
        │
        ▼
 1. Detectors (server)
    • patterns + checksums: IBAN (mod-97), card numbers (Luhn), emails, phone numbers (libphonenumber),
      amounts (FR and EN formats), optionally SIREN/SIRET (Luhn)
    • company lists: client names, employee names, custom sensitive terms (accent- and case-insensitive)
    • local NER model for person names (ONNX model run in-process, French + English)
        │
        ▼
 2. Merge overlapping spans, apply the active modes (Automatic / Documents / Manual choices)
        │
        ▼
 3. Pseudonymise: value → stable placeholder per conversation ([CLIENT_1], [IBAN_1], [PERSON_2]…)
    mapping stored in hide_mappings (encrypted value + HMAC for reuse), server-only
        │
        ▼
 4. Provider receives masked text only (+ instruction to keep placeholders verbatim)
        │
        ▼
 5. Answer streamed back: placeholders restored on the fly for users allowed to see the conversation;
    stored message keeps placeholders; history re-sent to models in masked form
        │
        ▼
 6. hide_events: counts per category only
```

- **Manual mode:** the input calls `POST /api/hide/detect` (our server) to get spans; the UI underlines them in red; the user clicks to blur / unblur and can select any passage to blur. The final choice is sent with the message.
- **Documents mode:** attachments are scanned at upload; excerpts are masked before inclusion in any prompt.
- Applies to every AI path: chat, Confronter, agents, tools, handovers, memory suggestions.
- Recall is imperfect; the UI never claims 100 % detection.

---

## 9. Group conversations

- **Add** button → invite company members. Each participant row has `visible_from_seq` (default: the next message after joining). "Share history" lets the inviter pick a message on the timeline; `visible_from_seq` is set to it.
- Realtime: Supabase Realtime **Postgres Changes** on `messages` (RLS applies, so each user only receives messages they may see) and a **Presence** channel per conversation (private channel, authorised through `realtime.messages` policies).
- The AI answers **only when mentioned** (`@Claude`, `@ChatGPT`, `@Gemini`, `@AI`). Mention parsing is server-side.
- **AI context rule:**
  - history = messages with `seq >= max(visible_from_seq of all current participants)`;
  - memory / documents = **intersection** of the readable spaces of all current participants;
  - if the context is narrower than what the person who mentioned the AI could see, the answer carries `context_limited = true` → subtle indicator ("Context limited to what everyone here can see").
- **Transfer:** confirmation dialog → owner changes, sender's participant row removed, `transfers` + `audit_log` rows written, Smart Handover drafted for the recipient (editable).
- **Who Can Help:** candidates come only from declared `expertise` and from authorship of entries in memory spaces the asker can read; never from private conversations. Opted-out members are excluded. The suggestion carries an "Invite" button.

---

## 10. Render worker

- Separate Docker image in `/worker`: Node 22, Chromium, FFmpeg, HyperFrames (`hyperframes` npm package, Apache-2.0 — to be re-checked at Step 8).
- **Queue in Postgres:** the app inserts a `render_jobs` row (credits reserved). The worker claims jobs with `SELECT … FOR UPDATE SKIP LOCKED` (via a `claim_render_job()` function), sends heartbeats, updates `progress`, uploads the MP4 to Storage, then marks `succeeded` (credits charged) or `failed` (credits released, error shown). Stuck jobs (no heartbeat) are re-queued up to a retry limit.
- **Motion Design:** the model writes an HTML/CSS/GSAP composition → preview in the browser (sandboxed iframe) → render to MP4.
- **Video Editor:** the model writes an edit plan (JSON: cuts, order, captions, formats) → validated against a schema → FFmpeg commands built by our code (never by the model) → 16:9, 9:16, 1:1 outputs.
- Safety: AI-generated HTML runs in headless Chromium with network access disabled (assets copied locally first); the worker uses a dedicated, narrowly-scoped database role and Storage bucket.

---

## 11. Cross-cutting

- **i18n:** `next-intl`, `messages/fr.json` + `messages/en.json`, no hardcoded UI strings (lint check). Locale: user preference → cookie → browser `Accept-Language`. AI answers in the user's language.
- **Design system:** CSS variables for tokens (neutral palette + one accent), typography scale, spacing, radius, motion; shadcn/ui primitives restyled; Motion for subtle animation; polished empty / loading / error states.
- **Errors:** typed domain errors mapped to friendly translated messages; provider errors normalised (§6).
- **Testing:** Vitest (unit: Hide detectors, router, permissions logic), integration tests against local Supabase with several real users' JWTs, pgTAP for RLS, Playwright for the launch scenario. A clearly-labelled **fake provider** exists for automated tests only; real-key smoke tests run when keys are configured.
- **Hosting:** EU regions only (app, database, storage, worker). Exact hosts chosen at Step 10.

---

## 12. Implementation notes (Step 1)

- **Rendering model.** Next.js 16 ships "Cache Components" switched on in new projects. It is **off** here: nearly every screen is per-user and permission-filtered, so pages render at request time (the previous model). To revisit when Next.js makes it mandatory.
- **`src/proxy.ts`** (Next.js 16's new name for middleware) only refreshes the Supabase session and sends signed-out visitors to `/login` (401 JSON for `/api/*`). It is **not** the authorisation layer.
- **Authorisation layers.** (1) `src/lib/auth/guards.ts` in every page and server action (`requireMember`, `requireCompanyAdmin`, `requireScope`, `requirePlatformAdmin`); (2) `SECURITY DEFINER` RPCs that re-check roles (`create_company`, `create_invitation`, `accept_invitation`, `admin_update_member`, `update_my_member_card`, `platform_*`); (3) RLS on every table. Direct writes to members, invitations, companies' platform fields and the audit log are revoked from API roles, and so is `TRUNCATE`.
- **Database errors** are raised as stable codes (`private.fail('seat_limit_reached')`) and translated in `messages/*.json` → `errors`. Unknown database messages are never shown to users.
- **Sign-in emails** link to `/auth/confirm?token_hash=…` (works even when the link is opened in another browser). Templates are bilingual: `supabase/templates/`.
- **Invitations**: only a SHA-256 hash of the token is stored. The email is sent by Supabase Auth (an "invite" email for new addresses, a sign-in link for existing accounts), and the inviter can copy the link if sending fails. Acceptance requires the signed-in email to match the invitation. Seat limits are enforced at invitation time.
- **Activity log**: written by database triggers (clients, assignments, plans) and by the RPCs, so a change is logged whatever path made it. Only ids and settings are stored; names are resolved at display time from what the viewer may already see.
- **Service-role client** (`src/lib/supabase/admin.ts`): a lint rule restricts its import to the audited files (sign-in bootstrap of platform admins, invitation emails).
- **i18n**: `next-intl` without locale in the URL; `react/jsx-no-literals` blocks hardcoded text in JSX; a unit test checks that `fr.json` and `en.json` have identical keys.
- **UI kit**: shadcn/ui-style components written by hand on `radix-ui` (the shadcn registry is unreachable from the development container).

---

## 13. Implementation notes (Step 2)

- **Module map.** `providers` (types, catalogue, router, error mapping, AI SDK adapters, registry, company model settings), `conversations` (system prompt, context builder, chat service, queries, actions, UI), `usage` (credits, quotas, usage recording, dashboards), `documents/file-types` + `documents/server/extract` (attachment text extraction, reused in Step 3).
- **Chat request flow** (`POST /api/chat` → `prepareChatTurn` → `runTurn`): (1) active member; (2) conversation read with the user's JWT (RLS = participant + client access); (3) model resolved (`resolveModel`: allowed + enabled + key present; Auto → `routeRequest`); (4) quota checked with `my_quota_status` (blocked → 402 + activity log entry); (5) user message inserted with the user's JWT; (6) history + attachments loaded, system prompt and context built **once, independently of the model**; (7) assistant message created by the server, provider stream forwarded as NDJSON; (8) answer saved, usage row written, quota re-read. Errors before step 5 return JSON and save nothing.
- **Answers survive the browser.** The provider call is not tied to the HTTP request: reloading or closing the tab does not stop it (`after()` keeps the work alive on serverless hosts, `maxDuration = 300`). The Stop button calls `POST /api/chat/stop`, which sets `messages.stop_requested_at`; the running turn checks it every second. A page opened while an answer is still being written refreshes every 3 seconds until it is done; answers stuck in "streaming" for more than 5 minutes are shown as stopped.
- **Who writes what.** Users insert only `messages(conversation_id, content)` and attachments (column grants + RLS). AI answers, `superseded_at`, `stop_requested_at` and usage rows are written by two audited service-role modules: `conversations/server/assistant-writer.ts` and `usage/server/record.ts` (lint allowlist). So a user can neither fake an answer from "Claude" nor fake or erase usage.
- **Context builder** (`conversations/context.ts`): newest message always included (documents shortened if needed), then older messages until the budget is reached; consecutive same-role turns merged; images re-sent only for the last 6 messages; budget = smallest (context window − max output) among the company's allowed models, capped at 60,000 estimated tokens.
- **Smart Router v1** (`providers/router.ts`): deterministic rules on French and English cues → task (quick, writing, analysis, code, long content, image) → preferred tier and strength → score = tier fit + strength − relative cost. Returns codes (`task`, `basis`) stored on the message and translated in the UI.
- **Credits** (`usage/credits.ts`): `(input − cached) × input rate + cached × cached rate + output × output rate`, per million tokens, from the catalogue at request time; same formula in USD for the estimate. Stopped answers without provider counts are estimated from text length (`tokens_estimated = true`).
- **Quotas** (`private.quota_status`): company limit = plan monthly credits + credit grants of the month; personal limit = member override, else company default; month in UTC. Warning ≥ 80 %, stop ≥ 100 % (`usage/quota.ts`).
- **Search** (`search_conversations`, security invoker so RLS applies): GIN index on `to_tsvector('simple', unaccent(content))`, title match, highlights marked with U+0002/U+0003 and rendered as `<mark>` without HTML injection.
- **Attachments**: `POST /api/conversations/[id]/attachments` checks extension, size (10 MB) and magic bytes, extracts text on our server (unpdf, mammoth, exceljs, UTF-8/Windows-1252), stores the file with the user's JWT in the private `chat-attachments` bucket (path `<conversation_id>/<uuid>.<ext>`, Storage RLS = participants). Downloads go through `GET /api/attachments/[id]` (RLS check, 60-second signed link).
- **Test provider**: `AI_FAKE_PROVIDER=true` replaces every provider with a simulated one whose answers start with "[TEST]" and the UI shows a test-mode notice; `[[fail:<code>@<provider>]]` and `[[slow]]` in a message simulate failures and slow answers. Real providers: `pnpm test:smoke`.
- **AI SDK v7** notes: `instructions` (not `system`), `result.stream` (not `fullStream`), images as `file` parts, usage in `inputTokenDetails` / `outputTokenDetails`. The SDK's default `onError` logs the full error (which can include the prompt): it is replaced by a no-op. Provider base URLs are set explicitly so a `*_BASE_URL` variable on the host can never redirect customer data.

