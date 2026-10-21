# Status

Last update: Step 7 (the launch agents, exports and charts), 2026-10-20.
Legend: **done** · **partial** · **not started** · **known issue**

---

## 4.1 Multi-model chat
| Feature | Status |
|---|---|
| Provider interface (one adapter per provider) | **done** (Step 2): `src/modules/providers/types.ts`, adapters wrap the Vercel AI SDK v7; stateless (OpenAI `store: false`), fixed provider URLs |
| OpenAI adapter | **done and tested with the real API** (GPT-6 Luna). GPT-6.1 Sol is refused by OpenAI on the current account ("no credits remaining", see Known issues) |
| Anthropic adapter | **done, not tested with the real API**: no Anthropic key in this environment (unit-tested through the shared adapter code) |
| Google (Gemini) adapter | **done, not tested with the real API**: no Gemini key in this environment |
| Streaming | **done**: NDJSON stream from `POST /api/chat`; the answer keeps being written and saved if the browser reloads or closes; the Stop button stops it on the server, even when clicked before the first word (fixed in Step 3) |
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
| Company memory | **done** (Step 3): one per company, created automatically; `/memory` → "Mémoire de l'entreprise" |
| Client memory (one per client) | **done**: created with each client; reached from `/memory` or from the client page |
| Client visibility Open / Restricted | **done** (Step 1) |
| Client assignments | **done** (Step 1) |
| Permission categories (read / write per memory) | **done** (`/admin/permissions`, "permissions" scope): automatic groups "Tout le monde" and "Direction", custom groups (e.g. "Finance") with members, read / write per memory. Enforced in SQL (`private.user_space_right`); a restricted client's memory also requires access to the client |
| Deliberate memory entries (from chat, document, approved AI suggestion) | **done**: "Nouvelle entrée"; "Enregistrer en mémoire" on any message (reread and edit before saving); "Proposer des entrées de mémoire" in a conversation (the AI proposes, the person approves, edits or rejects each one); documents uploaded to a memory. Nothing is captured silently |
| Entries editable / deletable, with source, author, date | **done**: source shown on each entry (manual, from a conversation, approved AI suggestion, general learning), author, date, "edited by"; edit and delete for people who can write; activity log entries (no content) |
| Promotion of general learnings to company memory (AI proposes, human approves) | **done**: "Proposer pour la mémoire de l'entreprise" on a client entry; the AI rewrites it without client details, or proposes nothing; the proposal waits in the company memory's Suggestions tab, visible only to people who can write there, who approve (after editing if needed) or reject |
| Document upload: PDF, DOCX, TXT, MD, CSV, XLSX | **done**: up to 20 MB; read on our server; status shown (reading, ready with number of passages, partly read, no readable text, failed); original downloadable; also available at the onboarding "first document" step. No OCR: scanned PDFs have no text |
| Chunking + embeddings (pgvector) | **done**: passages of about 1,100 characters with overlap, exact position and page kept; embeddings `vector(1536)` with an HNSW index; embeddings provider configurable (OpenAI `text-embedding-3-small` by default, or Google). **Tested with simulated embeddings only**: the current OpenAI account refuses embeddings (see Known issues) |
| Permission-filtered retrieval | **done**: hybrid search (meaning + exact words, `match_memory`) only inside the memories the user may read, computed on the server, then re-checked row by row by RLS. If embeddings are unavailable, search falls back to exact words and the document shows "Recherche par mots uniquement" |
| Source Proof (document / entry, exact passage, date, clickable) | **done**: numbered citations in the answer, "Sources" cards under it (title, origin, page, date); a click opens the exact passage, then the document with the passage highlighted, or the entry in its memory. Stored per answer; hidden from anyone who later loses access to that memory |
| "I don't know" when memory does not support an internal rule | **done** (system prompt rule, `KNOWLEDGE_RULES`); not yet observed with a real model (simulated provider only for memory questions) |

## 4.3 Hide
| Feature | Status |
|---|---|
| Mode control above the input (Automatic, Documents, Manual, combinable) | **done, redesigned with the founder** (clickable mock-up validated): one "Masquage auto" switch in the input's toolbar (on by default); what looks sensitive is **red** (the AI would see it), a click strikes it through in **green** (protected) and back; a bar above the input says what is protected or still visible, with "Tout protéger". Documents follow the same rule; Manual is no longer a separate mode (the click always works) |
| Automatic mode (typed message) | **done**: detected items arrive green (protected); a click leaves one visible (red) and stays in automatic mode. Detection on our server while typing and again at send time (the server decides, never the browser); only the company's categories are highlighted |
| Documents mode (attachments) | **done**: the file chip says "3 protégés" or "2 à vérifier"; a click opens a preview of the file's text with the same red / green click. Memory passages are masked when auto-protect is on. **Images cannot be masked** ("image non masquable" on the chip) |
| Manual mode (red highlights, click to blur, free selection) | **done**: with auto-protect off everything detected arrives red, a click protects it, "Protéger « … »" protects any selected passage, and red items are confirmed before sending ("Protéger et envoyer" / "Envoyer tel quel"); the check waits for detection of the exact text being sent. The sent message shows protected values struck in green |
| Pattern detection with checksums (IBAN, cards, emails, phones, amounts) | **done**: IBAN with country length + mod 97, cards with Luhn and card prefixes, emails, phones with libphonenumber (French, British, American formats + any international number), amounts in French and English formats |
| Company lists (client names, employee names, custom terms) | **done**: ignoring accents and case (a term with a very short word, like "Client A", must match its capitals so "le client a payé" is not masked); a restricted client is masked for people without access as a plain "sensitive term", so its existence is not revealed |
| Local NER for person names | **done, as a local library plus rules** (not a machine-learning model): compromise (English names, MIT licence) + French rules (titles M./Mme/Maître…, a list of about 600 common French and English first names, capitalised surnames, particles, surnames in capitals) + employees' names. Nothing leaves our servers for detection. Recall is imperfect: uncommon names without a title can be missed |
| Reversible pseudonymisation, server-side mapping per conversation | **done**: stable placeholders per conversation ([IBAN_1], [CLIENT_1]…), values encrypted with AES-256-GCM in `hide_mappings` (no user can read the table), real values put back while the answer streams. The person can open "Voir ce que l'IA a reçu" under each message. Verified with the real GPT-6 Luna: it keeps placeholders exactly |
| Admin settings: default mode, custom sensitive terms | **done** (`/admin/hide`, "hide" scope): "Masquage automatique par défaut" (on by default), categories it protects (amounts off by default), custom terms (client, project, file, other), visible to Hide admins only |
| Metadata-only masking event logging | **done**: one activity-log entry per message with masking (counts per category, modes); custom terms are logged by category, never by value |

## 4.4 Collaboration
| Feature | Status |
|---|---|
| Group conversation ("Add" button) | **done** (Step 5): "Ajouter" in the conversation header invites active colleagues (only those with access to the conversation's client). Any participant can invite and leave; the person responsible transfers instead of leaving. A group conversation cannot be linked to a client one of its participants cannot access |
| Real-time updates, presence, authorship | **done**: messages and answers appear live for everyone (Supabase Realtime, RLS applies to each person); avatars with a green dot for who is here; "Nathalie écrit…"; colleagues' messages on the left with their name; a conversation appears in the sidebar as soon as someone adds you |
| AI answers only when mentioned (@Claude, @ChatGPT, @Gemini, @AI) | **done**: "@" opens a menu (@IA = the selected model or Auto, @Claude, @ChatGPT, @Gemini, only allowed providers; keyboard or click); without a mention the message is simply posted, at no cost. The mention is decided on the server. Hide never masks the mention itself |
| History on join (from arrival by default) + "Share history" selector | **done**: by default "À partir de maintenant"; or "Toute la conversation"; or a chosen message on a timeline. Nobody can share more than they see. Enforced in SQL for messages, files, cited sources, stored files and search. **The conversation's title is visible to everyone who joins** (the dialog shows it, with a hint to rename) |
| AI context = history visible to all + intersection of permissions, with indicator | **done**: the AI gets only the messages every current participant can see and only the memories all of them may read (`conversation_shared_spaces`); "Contexte limité à ce que tout le monde ici peut voir" under the answer when that removed something. Placeholders are restored only if the model was shown them |
| Conversation transfer (ownership change, sender loses access, logged) | **done**: "Transférer…" (person responsible only), confirmation dialog saying it is final; the recipient sees the whole history; the sender loses access; other participants stay; logged |
| Smart Handover (conversation, restricted client, project) | **done for conversations and restricted clients** (no "project" object, open question 2): the AI drafts summary, decisions, useful documents, remaining tasks and next actions (through Hide, real values restored for the recipient); the recipient finds it at the top of the conversation or client page and can edit it; only the recipient can read it. If the AI fails, the transfer still happens and the recipient writes the file. **Before sharing history or transferring, the app warns when the shared messages cite a memory the recipient cannot read** ("Ajouter quand même" / "Transférer quand même") |
| Client transfer (restricted client) | **done**: "Transférer ce client" on the client page for an assigned employee; the assignment and the sender's conversations about that client move to the recipient (open question 3), the sender loses all access; logged |
| Who Can Help (expertise, suggestions, invite button, opt-out) | **done**: colleagues with declared expertise who did not opt out are listed to the AI (names masked by Hide); when the answer names one, an "Inviter Nathalie Durand" button opens the Add dialog with her preselected. Never based on private conversations; people already in the conversation are not suggested. With a real model the suggestion depends on the model following the rule (tested with the simulated provider only) |

## 4.5 Confronter
| Feature | Status |
|---|---|
| Parallel answers from allowed models | **done** (Step 6): a "Confronter" button on every question and answer; one model per allowed and configured provider (ChatGPT, Claude, Gemini, balanced tier first), at least two needed; all answer in parallel with the same context. **Tested with the simulated provider only**: the current OpenAI account refuses GPT-6.1 Sol and there are no Claude or Gemini keys, so a real confrontation is not possible yet |
| Cross-critique | **done**: each model critiques the others' answers (errors, weak reasoning, claims to check) |
| Synthesis (agreements, divergences, errors, claims to verify, recommended answer) | **done**: written by the model of the company default's provider; shown as four short lists and the recommended answer, with tabs for the answers and the critiques; live progress while it runs; saved with the conversation, visible live to the other participants of a group conversation. The recommended answer becomes the conversation's answer (copy, save to memory, Source Proof) |
| Hide + permission rules applied | **done**: same path as a normal answer (Hide masking and restoring, permission-filtered memory, group rules); the critiques and the synthesis only see what the models wrote |
| Credit cost shown before running, counted against quota | **done**: the confirmation shows the models, the judge, the estimated credits, "about N times a normal question" and the credits left; refused before any call if the quota is blocked or too low; every call is charged as "confronter" with real token counts |

## 4.6 Turn into a tool
| Feature | Status |
|---|---|
| Extraction of a tool from a conversation | **done** (Step 6): conversation menu "…" → "Transformer en outil"; the AI drafts name, description, department, form fields, instructions, output format and memory scope from the conversation as the models saw it (Hide placeholders kept); a warning if the draft still contains something specific to the conversation |
| Review and edit by the creator | **done**: full editor (fields with type and "required", instructions, model, memory used, result format, attached files allowed); the creator can edit or delete it later from its page |
| Visibility: me / team / company | **done**: "Moi seul(e)", "Mon équipe" (needs a team: Administration → Employees now has a Team field), "Toute l'entreprise". Personal tools stay invisible to everyone else, Owner included |
| Company-wide publication with Admin approval | **done**: waits in Administration → Agents et outils until an Owner or an Admin with the "agents" scope approves or rejects it; published directly when its creator may approve; editing an approved tool asks for approval again |
| Tools run as a simple form from the library | **done**: the form starts a conversation whose first message is the filled form; the tool's instructions (masked by Hide when auto-protect is on), models, memory scope, output format and attachment rule apply; it then continues as a normal conversation. A "client" field offers only the person's clients and links the conversation to it |

## 4.7 Agent library by department
| Feature | Status |
|---|---|
| Shared agent/tool framework | **done** (Step 6): one `agents` table for tools and built-in agents (instructions, form, allowed models, capabilities, memory scope, output format, visibility, roles); every write goes through checked SQL functions; the database refuses a conversation started from a tool the person may not use |
| Library organised by department | **done**: Marketing, Ventes, Comptabilité, Finance, RH, Juridique, Service client, Direction (and Général); 14 launch agents are live (Step 7), the two video agents are listed as "Bientôt" until Step 8 |
| Company customisation (instructions, tone, defaults, memory) and enable per role | **done** (Step 7): Administration → Agents et outils → "Adapter" on each built-in agent (company instructions, tone, model, memory), an on/off switch and the roles allowed; company tools are enabled per role since Step 6 |
| Launch agents defined in code | **done** (Step 7): `src/modules/agents/builtins.ts` (instructions in English, labels and options in French and English); the server keeps the database rows identical to the code; companies cannot change them, only adapt them |
| Forms with files | **done** (Step 7): "files" fields (PDF, Word, Excel, CSV, text, images; 5 files, 10 MB each) go with the first message as attachments, read on our servers and protected by Hide like any attachment |
| Exports | **done** (Step 7): every finished AI answer can be downloaded as Word (.docx) or PDF; answers with a table (or a chart) also as Excel (.xlsx, numbers as numbers, one sheet per table) and CSV (";" and UTF-8 for French Excel). Built on our server from the answer; nothing is sent elsewhere |
| Charts in answers | **done** (Step 7): the finance and dashboard agents write a small chart description; the conversation draws it (line or bar, up to 3 series), with values on hover, a legend and "Voir les données" (the same numbers as a table). Exported as its table |
| Marketing — Motion Design (HyperFrames → MP4) | not started (Step 8) |
| Marketing — Video Editor (clips + brief → MP4, 16:9 / 9:16 / 1:1) | not started (Step 8) |
| Sales — Proposal Writer | **done**: client + needs (+ offer, budget, timing) → proposal draft with [à compléter] where facts are missing; uses company and client memory; Word/PDF export |
| Sales — Meeting Prep | **done**: client + goal → brief from client memory (with Source Proof), history, talking points, questions |
| Accounting — Invoice Intake (CSV / XLSX export) | **done**: invoices (PDF, images, text) → one table (supplier, number, dates, amounts, VAT, currency, category), "?" when unreadable, totals, list of values to check; CSV/Excel export; "draft" notice. Scanned PDFs are not read (no OCR); photos of invoices go to the model as images |
| Accounting — Payment Reminders | **done**: unpaid invoices (typed or a file) + stage (first, second, final) → one e-mail draft per client, escalating tone; never sent; "draft" notice |
| Finance — Cash-Flow Forecast (table + chart) | **done**: bank exports + balance + recurring items + horizon (3, 6, 12 months) → monthly table, line chart, assumptions, low months; "draft" notice |
| Finance — Margin Analysis | **done**: data files or pasted figures + dimension (product, client, project) → margin table with total, bar chart, commentary, recommendations; "draft" notice |
| HR — Job Posting Writer | **done**: role + context (+ contract, place, salary) → posting draft, inclusive wording, no discriminatory criteria |
| HR — Application Review Assistant (no scoring / ranking / rejection, notice) | **done**: criteria written by the employer + applications → one structured summary per application (evidence per criterion, interview questions). Never a score, ranking, shortlist or verdict, no comparison between candidates, personal characteristics ignored; ends with "a person decides"; uses no memory; notice on the form and in the conversation (EU AI Act high-risk) |
| Legal — Contract Review ("not legal advice" notice) | **done**: contract + our side + points of attention → summary, key clauses table, risks with quotes, missing clauses, questions for a lawyer; notice + closing reminder |
| Legal — Template Drafter ("not legal advice" notice) | **done**: document type (CGV, NDA, CGU, services agreement, other) + parties and specifics → draft with [à compléter]; notice + closing reminder |
| Customer Service — Email Responder | **done**: e-mail received (+ client, what to answer) → reply draft in the company's tone, using memory; never sent; "draft" notice |
| Customer Service — Feedback Synthesis | **done**: reviews or e-mails (files or pasted) → themes table (mentions, sentiment, quote), recommended actions |
| Management — Meeting Minutes (incl. audio file) | **partial**: notes or transcript (typed or a file) → minutes, decisions, actions table (owner, due date), open questions. **Audio files are not accepted yet** (open question 8: needs a speech-to-text provider) |
| Management — Weekly Dashboard | **done**: data files + indicators → indicators table, chart, highlights, risks, priorities; "?" when a figure is missing |
| Render worker container (Chromium, FFmpeg, HyperFrames) + DB job queue | not started |
| Dedicated video / motion credit quota | not started |

## 4.8 Company admin console
| Feature | Status |
|---|---|
| Employees: invite, deactivate, roles, expertise | **done** (Step 1) |
| Permissions: memory categories, client visibility and assignments | **done**: client visibility and assignments (Step 1), memory groups and rights (Step 3, `/admin/permissions`) |
| Models: enable / disable, default, Auto mode | **done** (Step 2) |
| Agents and tools: enable per role, approve company-wide tools | **done** (Steps 6–7): pending tools with their full content to review, approve / reject, roles per shared tool, delete; built-in agents switched on/off, roles, and "Adapter" (instructions, tone, model, memory) |
| Hide policies | **done** (Step 4, `/admin/hide`) |
| Usage dashboards (real provider data; costs labelled as estimates) | **done** (Step 2, `/admin/usage`): requests, tokens, credits, estimated cost by person, by model and per day, month picker. A richer dashboard comes in Step 9 |
| Quotas | **done** (Step 2, `/admin/quotas`): company credits this month, default limit per person, personal limits per member |
| Activity log | partial: sign-ins, invitations, member changes, client creation / visibility / access, model settings, quota changes, blocked AI requests (Step 2), memory entries and documents added / edited / deleted, memory groups and rights (Step 3), masking events (counts per category), Hide settings and sensitive terms (Step 4), people added to or leaving a conversation, history shared, conversation and client transfers (Step 5) |

## 4.9 Platform admin console
| Feature | Status |
|---|---|
| Company list, create / suspend | **done** (Step 1) |
| Plans and seats | **done** (Step 1): seat limit enforced on invitations |
| Quotas and credits per company | **done** (Step 2): credits used / limit this month per company, "Add credits" for the month (extra credits). Video credits: Step 8 |
| Usage and estimated AI cost per company (margin view) | partial: requests and estimated AI cost this month per company on the companies list; full margin view in Step 9 |
| Provider health | not started |
| Platform audit log | **done** (Step 1) |
| No access to customer content (DB policies + server + tests) | **done** for Step 1–4 tables (conversations, messages, attachments, usage rows, quotas, memory entries, documents, passages, suggestions, sources, Hide mappings, sensitive terms, Hide settings: zero rows, tested); every new content table must be added to the test list |
| Model catalogue, price estimates, credit rates | **done** (Step 2, `/platform/models`): editable, nothing hardcoded; default prices are placeholders to verify |

## 4.10 Onboarding
| Feature | Status |
|---|---|
| Create account → company → profile → invite → first client → first document → first conversation, skippable steps | **done**: the "first document" step adds a document to the company memory (Step 3); every step can be skipped |

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
| Isolation tests (companies, clients, group intersection, platform admin) | partial: 111 integration tests (Steps 1–4: private conversations, restricted clients, unforgeable AI answers, usage and sources, storage, quotas, model settings, memory rights by every route including AI retrieval and search, Hide mappings and terms, platform admin); group intersection in Step 5 |
| Model-independent knowledge: single context builder, stateless providers, identical context across models (test) | **done** for chat history, attachments and memory passages (retrieved once per message, before the model is chosen, so every model receives the same passages); context budget = smallest window among the company's models, capped at 60,000 estimated tokens |
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

## Tests (Step 7)

| Suite | Command | Result |
|---|---|---|
| Unit (router, prompts, context builder, credits, quotas, provider errors, file reading, memory, Hide, collaboration, Confronter, **the 14 agents: forms valid in French and English, constraints (hiring and legal notices, no score, drafts only, charts); the form turned into the first message; chart descriptions; Word, PDF, Excel and CSV exports, formulas never run from a CSV**) | `pnpm test` | 186 passed |
| Integration: isolation with real users and JWTs (Steps 1–7) | `pnpm test:integration` | 156 passed (1 new: the launch agents come from the code, are kept in sync by the server and cannot be changed by a company) |
| End to end in Chromium (test provider: `AI_FAKE_PROVIDER=true`) | `npx playwright test` | 58 passed: agents 7 (library with the 14 agents, Proposal Writer with Word and PDF downloads, Invoice Intake with files and Excel/CSV downloads, Cash-flow chart with hover and data table, notices, adapt / disable an agent), Confronter 1, tools 5, tour 4, collaboration 7, Hide 5, memory 8, chat 16, foundation 5 |
| **The 14 agents with a real model**, a realistic French and English example each | `pnpm test:smoke` (`tests/smoke/agents.test.ts`, answers saved in `smoke-results/agent-runs/`) | **21 of 28 run** with GPT-6 Luna and checked (structure, table, valid chart, [S1] citation, legal reminder, no score or preference for applications). **7 not run**: the OpenAI account ran out of credit during the run (Feedback Synthesis FR and EN, Meeting Minutes FR and EN, Email Responder FR, Template Drafter EN, Weekly Dashboard FR). To rerun once the account has credit. The saved answers of this run were erased by the next browser test run (they were in Playwright's folder; fixed); two were read in full (Cash-flow FR, Application Review FR) and looked right |
| Real provider smoke test | `pnpm test:smoke` | GPT-6 Luna worked at the start of the run, then "no credits remaining"; Anthropic and Google skipped (no key) |
| Database | no new migration in Step 7 | — |
| Type check, lint, production build | `pnpm typecheck`, `pnpm lint`, `pnpm build` | OK |

Screenshots for the founder: `docs/screenshots/step-7/` (automated run, simulated answers marked "[TEST]").

## Known issues

- **Code location:** the code is on GitHub (`nayfii/projet1`, branch `claude/amazing-davinci-5th459`), not merged into the main branch yet.
- **The founder cannot click-test yet:** the app runs only inside this container. A preview deployment (Supabase EU project + EU hosting) is needed for hands-on testing.
- Google sign-in is untested (needs a Google OAuth client). The button stays hidden until `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
- Emails go to the local test inbox (Mailpit). Production needs an SMTP provider; Supabase's default limit of 2 emails/hour must then be raised.
- No ownership transfer (Owner → someone else) and no company switcher for people in several companies (the database supports several memberships, the UI uses the first active one).
- A platform admin who is also a member of a company sees that company's content as a member. Our team should use separate accounts.
- Product name ("Workspace") and accent colour are placeholders until the branding is chosen.
- **Hide is a safety net, not a guarantee.** Detection relies on rules, checksums and the company's lists: uncommon names without a title, client names not entered in the app, data inside images and anything a person turns off are sent as typed. Never present it as 100 % detection.
- **Hide needs `HIDE_ENCRYPTION_KEY` on the server.** Without it, messages with protection on are refused with a clear message (nothing is sent unmasked). Losing or changing the key makes earlier placeholders impossible to restore in old conversations.
- With Hide on, some answers are less precise: the AI does not know who [PERSON_1] or [CLIENT_1] is (by design), and amounts become [AMOUNT_1] if the company turns amounts on.
- Someone can test whether a word is a sensitive term by typing it and seeing it masked. This is inherent to any masking tool; the list itself stays hidden.
- **Embeddings refused by the current OpenAI account** (HTTP 429 "no credits remaining"). Memory still works: entries and documents are saved and found by their exact words ("Recherche par mots uniquement" on documents), but search by meaning only starts once the account has credit, or once embeddings are switched to Google (`EMBEDDINGS_PROVIDER=google` with a Gemini key). Documents read while embeddings were unavailable (or before a change of embeddings provider) are not re-indexed automatically yet: they are found by their words only until they are deleted and added again.
- **Memory is sent in clear to the embeddings provider** (documents, entries, and each question to search them). Hide will not apply there (see open question 5).
- Promotion relies on a person: the AI is asked to remove client details, but the approver must reread the proposal before approving it.
- Memory answers (citations, "I don't know") are tested with the simulated provider only; to check with a real model once the OpenAI account has credit or Claude/Gemini keys exist.
- Scanned PDFs and images inside documents are not read (no OCR). DOCX reading is still not covered by an automated test.
- **OpenAI account:** GPT-6.1 Sol answers "no credits remaining" (HTTP 429 `insufficient_quota`) while GPT-6 Luna works. Until the billing of that OpenAI account is fixed (or a Claude/Gemini key is added), Auto sends writing and analysis questions to GPT-6.1 Sol and the user sees "the provider account is out of credit". Workaround: disallow GPT-6.1 Sol in Administration → Models.
- **Claude and Gemini are untested with the real APIs** (no keys here). The code path is shared with OpenAI, but a first real call should be checked as soon as keys exist (`pnpm test:smoke`).
- **Model prices are placeholders** taken from third-party price lists (October 2026); they drive cost *estimates* only. The platform admin must check them against the official pricing pages (Platform console → Models and pricing). Gemini models use Google's `-latest` aliases, whose price can change silently.
- Quotas are checked before each request: several requests sent at the same moment can go slightly over a limit.
- Context budget uses an estimate of 3.5 characters per token; providers bill with their own counts.
- DOCX text extraction (mammoth) is not covered by an automated test yet (PDF, XLSX and text are).
- The Owner cannot read employees' private conversations (see decisions below), unless someone adds them to a conversation.
- **Collaboration (Step 5):**
  - real time and presence were tested on the local Supabase only; they need Realtime enabled on the hosted project (the migration adds the tables to the publication and the channel policies);
  - sharing history or transferring a conversation shows earlier AI answers as they were written: an answer that used a memory the recipient cannot read can carry its content. The app warns when such an answer **cites** that memory, but cannot detect an answer that used it without citing it, nor what people typed themselves;
  - the conversation's title (by default the start of the first message) is visible to everyone who joins;
  - transferring a client moves only the sender's own conversations about it; conversations about that client where the sender was only a participant lose the sender;
  - a participant who is not responsible for the conversation cannot rename it, link it to a client or delete it; their model choice is used for their own "@IA" but not saved for the conversation;
  - the Smart Handover is drafted from at most the last 24,000 characters of the conversation (or, for a client, its memory entries, document names and the last messages of the sender's conversations about it).
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
- Ad-hoc decisions taken in Step 4, to confirm:
  - **decided by the founder**: auto-protect on by default; red = visible to the AI, green struck = protected; a click switches an item, also in automatic mode;
  - amounts not masked by default (open question 4), and categories the company turned off are not highlighted at all;
  - employees can turn auto-protect off for a conversation (no locked policy yet); a choice made on a value (protect / leave visible) is remembered while the page is open;
  - with Automatic on, the person's own name and the linked client's name are also masked in the instructions sent to the AI;
  - memory passages are masked in Documents mode; the question used for the search by meaning is sent in its masked form; memory documents themselves are indexed unmasked (open question 5);
  - the person who typed a message, and anyone who can see it, sees the real values (open question 6, relevant for group conversations in Step 5);
  - a click protects or leaves visible every occurrence of the same value, in the message and in its files;
  - a general learning proposed by the AI is dropped if it still contains a placeholder (it points at something specific).
- **Confronter and tools (Step 6):**
  - Confronter has only been run with the simulated provider; with the current keys (OpenAI only, GPT-6.1 Sol refused) the button explains that two different AIs are needed;
  - the credit estimate is rough (expected answer lengths, about 3.5 characters per token); the real cost is what the providers report;
  - stopping a confrontation takes effect between its stages (answers, critiques, synthesis), not in the middle of one;
  - a tool's draft is only as good as the AI's extraction: the creator must reread it, and the approver must read it before publishing it to everyone;
  - a tool run sends its first message automatically only when auto-protect is on; otherwise the filled form waits in the input so the person can protect what they want;
- **Agents, exports and charts (Step 7):**
  - **the OpenAI account is out of credit** (HTTP 429 "insufficient_quota" since the Step 7 agent tests): until it is topped up, every real AI answer fails with "the provider account is out of credit". 7 of the 28 real agent examples could not run;
  - agents were tested for real with GPT-6 Luna only; Claude and Gemini answers to the agents are untested (no keys);
  - the agents' answers are only as good as the files they read: scanned PDFs are not read (no OCR), photos are sent to the model as images (Hide cannot mask text inside images), long files are cut (the AI is told it only has the first part, and the file is marked as such);
  - charts are drawn only when the AI writes a valid chart description; otherwise the answer shows the table and the description as text. The AI could put numbers in a chart that differ from its table: the instructions forbid it, a person must check;
  - the PDF export uses standard fonts: characters outside Western European languages (e.g. emoji, Asian scripts) are dropped from the PDF (Word keeps them);
  - exports contain the real values the person sees (not the placeholders sent to the AI);
  - the Application Review Assistant's rules are instructions to the model: tested for real on one French and one English example (two applications each): no score, ranking or preference, but a model can still fail; the notice tells the employer a person decides;
  - Motion Design and Video Editor come with the render worker in Step 8.
- Ad-hoc decisions taken in Step 7, to confirm:
  - the launch agents are the same for every company, written by our team; a company adapts them (adds instructions, tone, model, memory, roles, on/off) but cannot rewrite their base instructions, so the legal and hiring safeguards always stay;
  - the agents use the company memory (and the client's memory when a client is chosen), except the Application Review Assistant, which uses no memory;
  - a run's files count as the attachments of its first message (5 files, 10 MB each);
  - exports are offered on every finished AI answer (not only the agents'); spreadsheets only when the answer has a table or a chart;
  - CSV uses ";" for French and "," for English; a cell starting with "=", "+", "-" or "@" that is not a number gets a leading apostrophe so a spreadsheet never runs it as a formula.
- Ad-hoc decisions taken in Step 6, to confirm:
  - Confronter uses one model per provider (balanced tier first) and lets the company default's provider write the synthesis; it is refused if the estimate exceeds the credits left this month;
  - the confrontation is placed at the end of the conversation (with the question it confronts shown above it) and its recommended answer becomes the AI's answer for what follows;
  - any participant can confront a question in a group conversation, if everyone there can see that question;
  - "Model" in a tool means: the person's choice, Auto, or one fixed model; "Mon équipe" uses the team set by an Admin on the employee;
  - an Owner or an Admin with the "agents" scope publishes company-wide directly; any approved tool is enabled for every role until an Admin unticks one;
  - Admins with the "agents" scope see team and company tools (to approve them and set roles), never personal ones.
- Ad-hoc decisions taken in Step 5, to confirm:
  - any participant can add colleagues and share up to the history they see themselves; only the person responsible transfers, renames, links to a client or deletes;
  - in a group, people can talk without credits; only messages that mention the AI count against the quota;
  - "@IA" answers with the model selected by the person who wrote it (or Auto); "@Claude" uses the company's balanced Claude model when allowed;
  - the AI context in a group starts at the most recent "joined from" point among current participants, so adding someone with no history also narrows what the AI sees for everyone;
  - Who Can Help suggests only colleagues who are not in the conversation yet and, for a client conversation, who can access that client;
  - an employee assigned to a restricted client can hand it over to any active colleague (the Owner and client admins keep their access anyway);
  - the handover file stays attached to the conversation or client; a later transfer creates a new file for the new recipient.
- Ad-hoc decisions taken in Step 3, to confirm:
  - default rights: everyone reads the company memory, the Owner and Admins write in it; everyone who has access to a client reads and writes that client's memory; the Owner can always read and write every memory;
  - a conversation linked to a client searches the company memory and that client's memory only (no mixing of clients); a conversation without a client searches the company memory and every client memory the person can read;
  - "Proposer des entrées de mémoire" saves approved entries into the linked client's memory, otherwise into the company memory;
  - anyone who can read a client memory can ask for a promotion; only people who can write in the company memory see and approve it;
  - deleting an entry or a document does not change past answers: their Source Proof keeps the passage that was cited, still only for people who can read that memory;
  - an Admin without access to a restricted client sees it as "Client restreint (nom masqué)" on the rights page, and can still set its rights;
  - documents up to 20 MB, the first 400,000 characters are read and indexed; up to 6 passages of 1,600 characters are given to the AI per question;
  - search by meaning (embeddings) consumes credits like any AI call.

## Founder decisions (Step 7 report, 2026-10-20)

- **Application Review Assistant — legal review on hold.** The agent stays as built (no scores, rankings or decisions; notice shown). The legal review it needs before being sold for recruitment (EU AI Act, high risk) is parked until the founder reopens it.
- **Real-model tests deferred to the end.** The OpenAI account will be topped up once the platform is finished; the 7 agent examples not run yet (and Claude/Gemini once keys exist) are rerun then with `pnpm test:smoke`.
- **Hands-on access in Step 10.** The founder gets a working online platform once Step 10's deployment is done and the accounts listed there are created.

## Open questions for the founder

The founder asked to proceed ("je suis prêt à construire le tout") without answering these yet: the proposals below are applied as **defaults** and can be changed.


1. **Permission categories** — *applied in Step 3 as proposed below.* Proposed meaning: named groups of people (e.g. "All employees", "Management", "Finance") that are granted read and/or write on each memory. Defaults: everyone reads company memory, Owner + Admins write it; anyone with access to a client reads and writes its memory. To confirm.
2. **"Project"** — *applied in Step 5 as proposed below.* It appears in Smart Handover ("a conversation, a restricted client or a project is transferred") but no project object exists elsewhere in the spec. Proposal: no "project" object at launch; handover for conversations and clients only. To confirm.
3. **Client transfer** — *applied in Step 5 as proposed below.* When Client A moves from Olivier to Nathalie, what happens to Olivier's conversations linked to Client A? Proposal: they move to Nathalie together with the client (Olivier loses them too), and the Smart Handover summarises them. To confirm.
4. **Hide and amounts** — *applied in Step 4 as proposed below (switch in Administration → Protection).* masking every amount breaks finance questions (the model cannot compute on `[AMOUNT_1]`). Proposal: amounts are a category the company can switch off, off by default in Automatic mode. To confirm.
5. **Embeddings and sensitive data** — *now concrete (Step 3 is built this way; since Step 4 the question is masked, the documents are not).* documents saved to memory are sent in clear to the embeddings provider (OpenAI or Google) to build the search index; Hide does not apply there (masking would break search). Alternative: a local embeddings model (data stays on our servers, lower search quality, more server cost). Decision needed before real customer data.
6. **Who sees real values in a group chat** — *applied in Step 5 as proposed below.* Proposal: every participant who can see a message sees the real values typed in it (they were shared by a colleague); the AI only ever sees placeholders. To confirm.
7. **Gemini terms** — the free tier of the Gemini API allows Google to use data to improve its products. The production key must be on a paid (billing-enabled) Google project, or on Vertex AI in an EU region.
8. **Meeting Minutes with audio** — *not built yet (Step 7 accepts notes and transcripts only).* Needs a speech-to-text model (e.g. OpenAI or Gemini audio input), which is another data flow to document, and costs credits per minute of audio. To confirm before building it.
9. **Knowledge export** — a company could export its whole memory (entries + documents) in open formats, which proves it is not locked in. Not in the launch spec; to confirm whether to add it.
10. **AI provider keys (Step 2)** — to test Claude and Gemini for real, the platform needs an Anthropic API key and a Gemini API key from a billing-enabled Google project (`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). The current OpenAI account needs credit: GPT-6.1 Sol is refused with "no credits remaining".
11. **Value of a credit** — proposal: 1 credit ≈ 0.001 USD of estimated AI cost (so 100,000 credits ≈ 100 USD of AI per month). The number of credits per plan and per seat should be decided together with the price (€30–40 per user per month).
12. **Showing the estimated AI cost to customers** — CLAUDE.md §4.8 asks for it on the company usage page, so it is shown (labelled as an estimate). It reveals our approximate cost; confirm, or show credits only.
