# Status

Last update: Step 0 (kickoff and plan), 2026-10-18.
Legend: **done** · **partial** · **not started** · **known issue**

---

## 4.1 Multi-model chat
| Feature | Status |
|---|---|
| Provider interface (one adapter per provider) | not started |
| OpenAI adapter | not started |
| Anthropic adapter | not started |
| Google (Gemini) adapter | not started |
| Streaming | not started |
| Markdown rendering | not started |
| Persistent history | not started |
| Search across conversations | not started |
| Organisation by client | not started |
| Copy / regenerate | not started |
| File attachments | not started |
| Clear model labels | not started |
| Switch model mid-conversation ("Continue with Claude") | not started |
| Auto mode (Smart Router) with one-line reason | not started |
| Company admin: allowed models and default model | not started |
| AI Clarification (system prompt behaviour) | not started |

## 4.2 Two memories and Source Proof
| Feature | Status |
|---|---|
| Company memory | not started |
| Client memory (one per client) | not started |
| Client visibility Open / Restricted | not started |
| Client assignments | not started |
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
| Who Can Help (expertise, suggestions, invite button, opt-out) | not started |

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
| Employees: invite, deactivate, roles, expertise | not started |
| Permissions: memory categories, client visibility and assignments | not started |
| Models: enable / disable, default, Auto mode | not started |
| Agents and tools: enable per role, approve company-wide tools | not started |
| Hide policies | not started |
| Usage dashboards (real provider data; costs labelled as estimates) | not started |
| Quotas | not started |
| Activity log | not started |

## 4.9 Platform admin console
| Feature | Status |
|---|---|
| Company list, create / suspend | not started |
| Plans and seats | not started |
| Quotas and credits per company | not started |
| Usage and estimated AI cost per company (margin view) | not started |
| Provider health | not started |
| Platform audit log | not started |
| No access to customer content (DB policies + server + tests) | not started |

## 4.10 Onboarding
| Feature | Status |
|---|---|
| Create account → company → profile → invite → first client → first document → first conversation, skippable steps | not started |

## Foundations (sections 2, 3, 5, 7, 8)
| Feature | Status |
|---|---|
| Next.js + TypeScript + Tailwind + shadcn/ui project | not started |
| Design system and app shell | not started |
| i18n French / English, browser default, per-user switch | not started |
| Supabase local + migrations + RLS on every tenant table | not started |
| Authentication: email + magic link, Google | not started |
| Server-side authorisation helpers | not started |
| Three spaces (platform admin, company admin, member app) | not started |
| Quotas per company and per user (80 % warning, 100 % stop) | not started |
| Configurable plans, quotas, credit costs (no hardcoded prices) | not started |
| Isolation tests (companies, clients, group intersection, platform admin) | not started |

---

## Development environment (checked at Step 0)

This project is currently developed in a **Claude Code cloud session** (Linux container), not on the founder's Mac.

| Tool | Status |
|---|---|
| Node.js | 22.22.0 ✓ |
| Package manager | pnpm 10.28.0 ✓ (chosen); npm, yarn, bun also present |
| Docker | 29.8.2 ✓ (daemon started manually in the session) |
| Supabase CLI | 2.121.0 ✓ (installed at Step 0 via npm) |
| Supabase local images | pull from Docker Hub works ✓ (AWS ECR public mirror refused: "data limit exceeded") |
| git | 2.43.0 ✓ (repository initialised at Step 0, **no remote yet**) |
| FFmpeg / Chromium | present ✓ (useful for Step 8 tests) |

**Network policy of the cloud session** (affects development and tests here, not production):

| Host | Reachable |
|---|---|
| api.anthropic.com | yes |
| generativelanguage.googleapis.com (Gemini) | yes |
| api.openai.com | **no — blocked** |
| *.supabase.co (hosted Supabase) | **no — blocked** |
| huggingface.co (local NER model download) | **no — blocked** |
| cdn.jsdelivr.net (GSAP for HyperFrames previews) | **no — blocked** |
| github.com release downloads | **no — blocked** |
| registry.npmjs.org, Docker Hub, fonts.googleapis.com | yes |

---

## Known issues

- **Code persistence:** the cloud container is temporary. Until a GitHub repository is connected and the code pushed, the work exists only in this container.
- OpenAI cannot be tested from this cloud session until `api.openai.com` is allowed in the environment's network settings.

---

## Open questions for the founder

1. **Permission categories** — proposed meaning: named groups of people (e.g. "All employees", "Management", "Finance") that are granted read and/or write on each memory. Defaults: everyone reads company memory, Owner + Admins write it; anyone with access to a client reads and writes its memory. To confirm.
2. **"Project"** appears in Smart Handover ("a conversation, a restricted client or a project is transferred") but no project object exists elsewhere in the spec. Proposal: no "project" object at launch; handover for conversations and clients only. To confirm.
3. **Client transfer** — when Client A moves from Olivier to Nathalie, what happens to Olivier's conversations linked to Client A? Proposal: they move to Nathalie together with the client (Olivier loses them too), and the Smart Handover summarises them. To confirm.
4. **Hide and amounts** — masking every amount breaks finance questions (the model cannot compute on `[AMOUNT_1]`). Proposal: amounts are a category the company can switch off, off by default in Automatic mode. To confirm.
5. **Embeddings and sensitive data** — documents saved to memory are sent in clear to the embeddings provider (OpenAI or Google) to build the search index; Hide does not apply there (masking would break search). Alternative: a local embeddings model (data stays on our servers, lower search quality, more server cost). Decision needed before real customer data.
6. **Who sees real values in a group chat** — proposal: every participant who can see a message sees the real values typed in it (they were shared by a colleague); the AI only ever sees placeholders. To confirm.
7. **Gemini terms** — the free tier of the Gemini API allows Google to use data to improve its products. The production key must be on a paid (billing-enabled) Google project, or on Vertex AI in an EU region.
8. **Meeting Minutes with audio** — needs a speech-to-text model (e.g. OpenAI or Gemini audio input). This is another data flow to document; to confirm it is acceptable.
