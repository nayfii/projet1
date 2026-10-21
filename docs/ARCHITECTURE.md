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
| `agents` | Shared agent/tool framework, built-in agents, "Turn into a tool", library |
| `exports` | Word, PDF, Excel and CSV downloads of an AI answer (built from its Markdown on our server) |
| `collaboration` | Smart Handover, Who Can Help |
| `usage` | Usage events, credits, quotas (80 % warning / 100 % stop), pricing tables, estimates |
| `render` | Video agents' compositions and edit plans (checks, FFmpeg arguments), render requests and status, preview, downloads; the worker itself lives in `/worker` and shares the pure files of this module |
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
| `permission_categories` | `name`, `description`, `system_key` (everyone / management: automatic groups) | ✓ | – |
| `permission_category_members` | `category_id`, `user_id` | ✓ | – |
| `memory_space_grants` | `space_id`, `category_id`, `can_read`, `can_write` | ✓ | via space |
| `memory_entries` | `space_id`, `title`, `content`, `source_type` (manual / chat / ai_suggestion / promotion), `source_ref` (json), `author_id`, `updated_by`, `embedding vector`, `embedding_model` | ✓ | via space |
| `memory_suggestions` | `space_id` (target), `kind` (new_entry / promotion), `title`, `content`, `source_space_id`, `source_ref`, `status` (pending / approved / rejected), `proposed_by`, `decided_by`, `entry_id` | ✓ | via space |
| `documents` | `space_id`, `filename`, `mime_type`, `size_bytes`, `storage_path`, `status` (processing / ready / failed), `error_code`, `extracted_text`, `text_truncated`, `page_count`, `chunk_count`, `uploaded_by` | ✓ | via space |
| `document_chunks` | `document_id`, `space_id`, `chunk_index`, `content`, `page`, `char_start`, `char_end`, `embedding vector`, `embedding_model` | ✓ | via space |
| `message_sources` | `message_id`, `position` (the n of [Sn]), `source_type` (document_chunk / memory_entry), `space_id`, `document_id` / `chunk_id` / `entry_id`, `title`, `excerpt` (copy), `page`, `char_start`, `char_end`, `source_date` | ✓ | via space |

As built in Step 3: conversation attachments stay in `conversation_attachments` (Step 2); `documents` holds memory documents only. Entries do not use a "document" source type: a document stays a document and is cited as such.

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
| `company_hide_settings` | `default_modes` (automatic / documents / manual), `auto_categories` | ✓ (primary key) |
| `hide_mappings` | `conversation_id`, `category`, `placeholder` (e.g. `[IBAN_1]`), `value_hash` (HMAC, stable reuse), `value_ciphertext` (AES-256-GCM, app-level key) | ✓ |
| `sensitive_terms` | `term`, `category` (client / project / file / term), `created_by` | ✓ |
| `messages` (+ columns) | `masked_content` (what the model received or wrote), `hide_modes`, `hide_counts` (category → count) | ✓ |
| `conversation_attachments` (+ column) | `masked_text` | ✓ |

As built in Step 4: there is no separate `hide_events` table; masking events go to `audit_log` (`hide.masked`, counts per category only).

`hide_mappings` has RLS enabled with **no policy for authenticated users**: only the server (service role, inside the `hide` module) can read it.

### 4.5 Agents, tools, Confronter (as built in Step 6)

| Table | Key columns | company_id |
|---|---|---|
| `agents` | tools made by employees and built-in agents (`company_id` null, `builtin_key`): `kind` (agent / tool), `department`, `name`, `description`, `instructions`, `input_fields` (form), `allowed_models`, `default_model`, `tools` (capabilities, e.g. attachments), `memory_scope`, `output_format`, `visibility` (private / team / company), `team_id`, `publication` (none / pending / approved / rejected), `enabled_roles`, `created_by`, `source_conversation_id`, `decided_by` | ✓ (null for built-ins) |
| `company_agent_settings` | a company's adaptation of a **built-in** agent: `enabled`, `enabled_roles`, `instructions_addition`, `tone`, `default_model`, `memory_scope` | ✓ |
| `conversations.agent_id` | a conversation started from a tool or agent ("a run") | ✓ |
| `messages.confrontation` | a confrontation: models, judge, each model's answer and critique, the synthesis, credits | ✓ |

A run is a conversation: its first message is the filled form, so Hide, memory permissions, Source Proof, usage and quotas apply without a separate runner. Built-in agents (Step 7) are rows of `agents` defined in code and kept identical to it by the server (§18). Approval history lives in `audit_log` (`agent.created`, `agent.approved`, `agent.rejected`…).

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

- **Add** button → invite company members (any participant can; for a conversation about a client, only people with access to it). Each participant row has `visible_from_seq` (default: the next message after joining). The inviter picks "from now", "the whole conversation" or a message on the timeline; nobody can share more than they see (`add_conversation_participants`, `share_conversation_history`). History on join covers messages, attachments, cited sources, stored files and search (RLS).
- Realtime: Supabase Realtime **Postgres Changes** on `messages` and `conversation_participants` (RLS applies, so each user only receives what they may see; the browser then reloads those messages through a server action) and a **Presence** channel per conversation (`conversation:<id>`, private, authorised through `realtime.messages` policies) for "who is here" and "is typing". A second subscription adds a conversation to the sidebar when someone adds you.
- The AI answers **only when mentioned** (`@Claude`, `@ChatGPT`, `@Gemini`, `@AI`/`@IA`). Mention parsing is server-side (`collaboration/mentions.ts`); without a mention the message is posted (NDJSON `posted` event) and nothing is sent to a provider.
- **AI context rule:**
  - history = messages with `seq >= max(visible_from_seq of all current participants)`; people's messages are labelled with their (masked) names;
  - memory / documents = **intersection** of the readable spaces of all current participants (`conversation_shared_spaces`, passed to `retrievePassages` as `restrictTo`);
  - if that removed history or memories the person who mentioned the AI could see, the answer carries `context_meta.context_limited` → indicator "Contexte limité à ce que tout le monde ici peut voir";
  - Hide restores only placeholders present in the context the model received.
- **Transfer:** confirmation dialog → `transfer_conversation` (owner changes, recipient sees the whole history, sender's participant row removed, `handovers` + `audit_log` rows). A restricted client is transferred with `transfer_client` (assignment and the sender's own conversations about it move). The Smart Handover is drafted by the AI before the RPC (`collaboration/server/handover.ts`) and is readable and editable by the recipient only. Before sharing history or transferring, `history_unreadable_sources` lists memories cited in the shared messages that a recipient cannot read, and the dialog warns.
- **Who Can Help:** candidates come only from declared `expertise` (members who did not opt out, not already in the conversation); never from private conversations. Their names (masked by Hide) and expertise go into the system prompt; when the answer names one, `context_meta.suggested_colleagues` drives an "Inviter …" button. (Authorship of memory entries is not used yet.)

---

## 10. Render worker (as built in Step 8)

- **Queue in Postgres** (`render_jobs`, migration `20261025000001_render.sql`): the app asks for a render with `enqueue_render_job` (the person's session): access to the answer, the agent (Motion Design or Video Editor, still usable), every file named by the job must be an attachment of the same conversation, formats and duration checked, video credits reserved under a lock on the company (one reservation at a time). The worker (service role only) calls `render_claim_job` (stuck jobs re-queued after 3 minutes of silence, failed after 3 attempts; oldest queued job taken with `FOR UPDATE SKIP LOCKED`; file locations resolved in SQL from the job's own conversation), `render_job_progress` (heartbeat; returns false when cancelled), `render_job_succeeded` (outputs must be in the job's own folder; credits charged for the seconds produced, at most the reservation; usage row in the video pool) and `render_job_failed` (retry or stop; credits released).
- **Video credits**: `plans.video_credits` + `credit_grants` with `pool = 'video'`; `private.video_quota_status` = limit, used (usage rows of the video pool), reserved (jobs waiting or running). Rates per second of video in `render_rates`, set by the platform admin (`platform_set_render_rate`).
- **Storage**: `render-media` (video clips, 200 MB, uploaded by the browser with the person's session into the conversation's folder, then checked and registered by `POST /api/conversations/[id]/videos`) and `render-outputs` (MP4s, written by the worker; readable by the people who can see the job; signed links through `GET /api/render-jobs/[id]/video`).
- **Worker** (`/worker`, Node 22, its own `package.json` with HyperFrames pinned to 0.8.134 through npm overrides, bundled with esbuild together with `src/modules/render/{composition,edit-plan,formats}.ts`): `src/index.ts` claims a job, downloads its files, writes `job.json`, starts `src/render-child.ts` in a separate process with a minimal environment (no keys, no database address) and, in the container, as the unprivileged `render` user; reads progress lines; uploads `out/*.mp4`; reports. Logs are JSON lines with ids, codes and timings only. `Dockerfile`: Debian bookworm slim, FFmpeg, Inter font, Chromium headless shell (downloaded by Puppeteer at build time into `/opt/puppeteer`).
- **Motion Design**: the model writes a HyperFrames composition in a ```hyperframes block (rules in `agents/builtins.ts`). `inspectComposition` checks size (one of 1920×1080, 1080×1920, 1080×1080), declared duration (≤ 60 s), timeline registration, and lists the images used (`assets/<name>`). `prepareComposition` removes outside scripts, links, base URLs and refresh tags, then puts first in the page a Content-Security-Policy (preview: nothing from outside at all; worker: only the job folder), the Inter font and GSAP. **Preview**: `@hyperframes/player` with `sandbox-origin="opaque"` (the iframe has no access to the page) and a `srcdoc` with GSAP, the HyperFrames runtime, the font and the images inlined (served by `/api/render/vendor/[name]` and `/api/attachments/[id]`). **Render**: `@hyperframes/producer` (`createRenderJob` + `executeRenderJob`) in the child process; ffprobe measures the result.
- **Video Editor**: the model writes an edit plan in an ```editplan block (zod schema: segments, captions, formats, fit). The worker measures the clips with ffprobe, fits the plan to their real length (`fitPlanToClips`), wraps each caption for the format and writes it to a file, then runs FFmpeg with arguments built by `ffmpegArgs` (argument list, no shell; captions read with `textfile=` and `expansion=none`, so their text never enters the filter graph): trim, scale and crop (or pad), 30 fps, concatenation with sound (silence for clips without sound), captions, H.264 + AAC, faststart.
- **What the model knows of a clip**: `[Video "name": 12.4 s, 1920×1080. Its pictures and sound are not available to you.]` — the duration and size read by the browser (`<video>` metadata, or the MP4/MOV header with `mp4-info.ts` when the browser cannot decode the codec).

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

## 14. Implementation notes (Step 3)

- **Module map.** `memory` (chunking, keywords, citations, retrieval, indexer, actions, AI tasks, permissions, UI), `providers/server/embeddings.ts` (embeddings provider, batches of 96, simulated in test mode), `documents/server/extract.ts` (shared with attachments, now returns page offsets).
- **Spaces and rights.** Triggers create the company space with the groups "everyone" (read) and "management" (read + write), and one space per client with "everyone" (read + write). `private.user_space_right(space, user, write)`: the Owner always; otherwise company membership (company space) or client access (client space), **and** membership of a group granted that right. `my_memory_spaces` returns the readable spaces with `can_write` and counts. Admin RPCs (`admin_save_category`, `admin_delete_category`, `admin_set_space_grants`) require the "permissions" scope and are logged.
- **Ingestion.** `POST /api/memory/[spaceId]/documents` checks rights, quota, extension, size and magic bytes, stores the file with the user's JWT, inserts the `documents` row (status processing) and returns; `after()` then reads the text (400,000 characters max), splits it into passages (`chunkText`: about 1,100 characters, 150 overlap, cut at paragraph or sentence ends, exact `char_start` / `char_end` and page), embeds them and inserts the passages with the user's JWT. Without embeddings the document is still ready (`error_code = words_only:<code>`). Entries are embedded when saved or edited (title + content).
- **Retrieval** (`retrievePassages`, called once per message before the model is chosen): readable spaces → `conversationScope` (linked conversation: company + that client; otherwise company + every readable client) → nothing to search means no embeddings call → question embedded → `match_memory` (security invoker): vector search (cosine, similarity ≥ 0.25, only vectors from the current embeddings model) and full-text search (`simple` + unaccent), fused by reciprocal rank (k = 60), at most 6 results → passages truncated to 1,600 characters and numbered [S1]…[Sn] in the system prompt with origin and date.
- **Source Proof.** The model is asked to cite with [Sn]; after the answer, `citedPositions` keeps only the numbers really cited and present, and the service-role writer stores them in `message_sources` (excerpt copied). The UI turns [Sn] into badges; "Sources" cards open a side panel with the exact passage, then `/memory/documents/[id]?from=&to=` with the passage highlighted, or the entry in its memory.
- **AI tasks** (`runMemoryTask`: quota check, model resolution, usage row with feature "memory"): extract entries from a conversation (JSON, at most 5, saved as pending suggestions in the linked client's memory or the company memory) and generalise a client entry (JSON `{general, title, content}`; nothing proposed when `general` is false). Approval goes through `decide_memory_suggestion`, which re-checks write rights and creates the entry with source `ai_suggestion` or `promotion`.
- **Test mode.** With `AI_FAKE_PROVIDER=true`, embeddings are a deterministic hashed bag of words (`fake-embedding`), the simulated chat model cites [S1] when passages are present and answers the memory tasks in JSON.

## 15. Implementation notes (Step 4)

- **Module map** (`src/modules/hide`): `categories.ts` (modes, categories, placeholders), `normalize.ts` (accent- and case-folding with a map back to the original text), `detectors/` (patterns with checksums, phones, company lists, person names), `detect.ts`, `spans.ts` (overlaps: longest, then most specific), `mask.ts` (what to mask for given modes, placeholders, restoring, `StreamRestorer`), `server/` (crypto, the audited service-role `store.ts`, `masker.ts`, `turn.ts`, admin actions), `ui/` (mode control, Manual overlay, "what the AI received"). The browser imports only the pure parts.
- **Detection** runs only on our server: `POST /api/hide/detect` while typing (positions and categories only, for Manual highlights and the count), and again inside `prepareChatTurn` when the message is sent. The browser sends its choices (modes, values blurred or left visible), never a masked text.
- **Person names**: no ML model (the model hub is blocked here and a model would add a heavy runtime). compromise for English names, plus French rules (titles, ~600 first names, capitalised surnames, particles, surnames in capitals) and the employees' names. An ONNX NER model could be added behind the same function later.
- **Turn flow** (`prepareChatTurn`): settings and modes → `createConversationMasker` (loads lists through `store.ts`, decrypts the conversation's mappings) → `maskTurn` (message: Automatic + Manual; files: Documents; person and client names and descriptions in the instructions: Automatic) → one `hide_assign_placeholders` call gives new values their numbers under an advisory lock → user message inserted with the user's JWT, then `masked_content`, `hide_modes`, `hide_counts` and attachments' `masked_text` written by the service role → audit entry with counts → memory search (keywords on the real text, embeddings on the masked text) → `maskPassages` (Documents) → history built from `masked_content ?? content` → the answer streams through `StreamRestorer` (placeholders that arrive in pieces are held back), `content` stores the restored answer and `masked_content` what the model wrote.
- **System prompt**: a "Protected values" section asks the model to keep placeholders exactly and never guess the values (checked with the real GPT-6 Luna in `pnpm test:smoke`).
- **Memory tasks**: suggestions read `masked_content` and their output is restored with the conversation's values; promotion masks the client note with an in-memory masker and drops any proposal that still contains a placeholder.
- **Key**: `HIDE_ENCRYPTION_KEY` (≥ 32 characters); HKDF derives one key for AES-256-GCM and one for the HMAC. Without it, a message with protection on is refused (`hide_unavailable`) before anything is saved or sent.
- **Experience v2 (validated with the founder on a clickable mock-up).** One "Masquage auto" switch; red = visible to the AI, green struck = protected; a click switches an item (value-based: every occurrence, message and files). The browser sends `modes` = `["automatic","manual"]` (switch on) or `["manual"]` (off) plus the values protected / left visible; files follow the same `spansToMask` rule as the message; memory passages are masked when `automatic` is on. The attachment upload returns the file's text and detected spans for the preview. The server stores `messages.hide_spans` (positions of protected values in what was typed, service role only) so the sent message shows them struck in green. Without auto-protect, `needsConfirmation` awaits detection of the exact text before sending.

## 16. Implementation notes (Step 5)

- **Module map** (`src/modules/collaboration`): `mentions.ts` (mention parsing, the model for "@Claude", Who Can Help name matching), `handover-sections.ts`, `server/` (`handover.ts` drafts with Hide, `actions.ts`, `queries.ts`), `ui/` (participants bar, Add dialog with the history timeline and warnings, transfer dialog, handover card, mention menu, the two real-time hooks).
- **Migration** `20261023000001_collaboration.sql`: Realtime publication and channel policies; `handovers` (recipient-only RLS, update limited to `sections` and `edited_at`); RPCs for adding, sharing history, leaving, transferring a conversation or a client, the shared memories and the history warning; a trigger refusing to link a group conversation to a client one participant cannot access; history-on-join policies for attachments, sources and stored files.
- **Turn flow additions** (`prepareChatTurn`): participants → mention → if not mentioned in a group, the message is saved and the turn ends; otherwise the model (mentioned provider, else the person's choice), quota, Hide (colleagues' and authors' names masked), shared history and shared memories, then the answer as before. `context_meta` stores `context_limited` and `suggested_colleagues`. Sources are saved before the answer is marked finished, so colleagues reloading it in real time see them.
- **Browser merge rules** (`chat-view.tsx`): the stream's own messages win over real-time reloads; reloaded ids that come back empty are removed (an answer replaced by Regenerate); a group conversation keeps a stable page key so a server refresh never resets what is being typed.

## 17. Implementation notes (Step 6)

- **Confronter** (`src/modules/confronter`): `prompts.ts` (who takes part, who writes the synthesis, the credit estimate, the critique and synthesis prompts, reading the judge's JSON), `server/plan.ts` (models, estimate and credits left, checked again when it runs), `server/run.ts` (the three stages, usage per call as "confronter", Stop between stages), `ui/` (confirmation dialog, result card). It enters through `prepareChatTurn` with `confront: { messageId }`, so the context is built exactly as for a normal answer (history up to the question, Hide, permission-filtered memory, group rules); NDJSON events `confront` (progress) and `confrontation` (result) are added to the chat stream.
- **Tools and agents** (`src/modules/agents`): `definitions.ts` (departments, field types, formats, memory scopes, the form → first message, the launch list), `prompts.ts` ("Turn into a tool"), `server/queries.ts` (library, admin lists, `resolveRunAgent`), `server/actions.ts` (draft, save, approve, roles, delete, start a run), `ui/` (editor, "Turn into a tool" dialog, run form, admin page). SQL: `save_tool`, `decide_tool`, `set_tool_roles`, `delete_tool`, `admin_set_agent_settings`, `admin_set_member_team`; `private.can_see_agent` (RLS) and `private.can_use_agent` (checked by a trigger when a run's conversation is created).
- **A run in `prepareChatTurn`**: the conversation's agent is resolved with the person's session (null → refused); its instructions (plus the company's adaptations) are a prompt fact masked by Hide; models outside its list are replaced by its default; memory scope "none" skips retrieval and "company" narrows it to the company memory (intersected with the group rule); attachments are refused unless allowed.
- **Starting a run**: the library page calls `startRunAction`, which creates the conversation (linked to the client chosen in the form) and returns the first message; the conversation screen reads it from `sessionStorage` (`useSyncExternalStore`, so nothing differs between server and browser rendering) and sends it when auto-protect is on.
- **Guard**: a unit test checks that "use server" files export only functions (Next.js only refuses other exports at run time).

## 18. Implementation notes (Step 7)

- **Launch agents** (`src/modules/agents/builtins.ts`): the 14 text agents of CLAUDE.md §4.7 (the video agents come with the render worker, Step 8). Each has a form (with "files" fields when it reads documents), instructions written for the model in English (the model answers in the person's language), an output format, a memory scope, capabilities and a notice (`legal`, `hiring`, `draft`). Shared rule blocks: `DRAFT_RULES` (work only from what was given, write [to complete], never send, pay or sign), `LEGAL_RULES` (not legal advice, closing reminder), `CHART_INSTRUCTION`.
- **Sync** (`agents/server/builtin-sync.ts`, audited service-role module in the lint allowlist): `ensureBuiltinAgents()` upserts the rows by `builtin_key` once per server process (before the library, an agent page or the admin list is read). Users have no write grant on `agents`; companies adapt a built-in through `admin_set_agent_settings` only, which is appended after the base instructions ("Company adaptations").
- **Translations**: names, descriptions, field labels and options of built-ins come from `messages/*.json` (`tools.launch.<key>`), through `agents/labels.ts` (`agentText`); the English text in the database is a fallback. The first message of a run is composed on the server with the translated labels, as plain text ("Label : value").
- **Files in a run**: the run form starts the conversation, uploads each file to `/api/conversations/[id]/attachments` (same checks and Hide as the chat), and hands the message and the attachments to the conversation screen through `sessionStorage`.
- **Charts** (`conversations/chart-spec.ts`, `conversations/ui/chart.tsx`): the model writes a fenced block with the language `chart` holding a small JSON description (line or bar, ≤ 3 series, ≤ 24 labels), validated with zod; the Markdown renderer draws it as SVG (2 px lines, rounded bars, recessive grid, legend for several series, crosshair and tooltip, "Voir les données" table). Series colours `--chart-1..3` in `globals.css`, light and dark, checked for colour-blind separation with the dataviz validator. An invalid block stays shown as code.
- **Exports** (`src/modules/exports`): `blocks.ts` turns the answer's Markdown (remark + GFM) into simple blocks (headings, paragraphs, lists, tables, quotes, code; citation marks dropped; a chart becomes its table); `server/render.ts` writes Word (`docx`), PDF (`pdfkit`, standard fonts, listed in `serverExternalPackages`), CSV (BOM, ";" in French, formulas neutralised) and Excel (`exceljs`, numbers as numbers via `cellNumber`, which reads French and English formats). Route `GET /api/messages/[id]/export?format=docx|pdf|xlsx|csv`: the message is read with the person's session, so RLS decides (participants only, from their starting point in a group); AI answers only.
- **Test provider**: when the instructions ask for a Markdown table or a chart, the simulated answer adds a sample table and chart, so exports and charts are tested end to end. `tests/smoke/agents.test.ts` runs each agent with a realistic French and English example against a real model (same system prompt and first message as the app; files given as their extracted text) and saves the answers in `smoke-results/agent-runs/` (not `test-results/`, which Playwright empties).

## 19. Implementation notes (Step 8)

- **Module map** (`src/modules/render`): `formats.ts` (formats, limits, credits rule, video file checks), `composition.ts`, `edit-plan.ts`, `mp4-info.ts`, `vendor.ts`, `types.ts`, `server/actions.ts` (ask for a render, cancel), `server/admin-actions.ts` (rates), `ui/` (render panel, preview, edit plan view, rates form, video upload). Routes: `api/render-jobs` (jobs of an answer + rates + credits left), `api/render-jobs/[id]/video`, `api/conversations/[id]/videos`, `api/render/vendor/[name]`.
- **In the conversation**: the chat page passes the agent's render kind; `MessageItem` shows `RenderPanel` under a finished answer that holds a composition or a plan; the Markdown renderer folds the composition's code and shows the plan as a list. The panel polls every 2 s while a render waits or runs.
- **Run form**: a `videos` field type (Video Editor only; company tools cannot use it) sends clips to `render-media` before the first message; they are attachments of kind `video` (column `bucket`, `media`).
- **Test provider**: writes a small valid composition (format and duration from the form, the attached logo) or an edit plan over the attached clips, so the e2e tests make real videos.
- **Activity log**: `render.requested`, `render.completed`, `render.failed` (metadata only), refusals for lack of video credits as `ai.request_blocked` (`quota_video`), rate changes and video grants on the platform log.
