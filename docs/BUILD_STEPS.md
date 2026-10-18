# Build Steps — paste into Claude Code, one step at a time

## Before you start
1. Create an empty folder for the project on your Mac and put `CLAUDE.md` inside it. Claude Code reads it automatically at every session.
2. Have these ready (Claude Code will tell you exactly where to paste them):
   - API keys: OpenAI, Anthropic, Google (Gemini).
   - A Supabase account. The project must be created in an EU region.
   - Docker Desktop installed (needed for the local database and the video render worker).
3. Open Claude Code in that folder and paste **Step 0**.
4. Wait for the French report at the end of each step, test what it tells you to test, then paste the next step. If something is wrong, say so before moving on.

---

## Step 0 — Kickoff and plan
```
Read CLAUDE.md in full. Then inspect the development environment (Node, package manager, Docker, Supabase CLI, git) and install what is missing.

Do not write application code yet. Instead:
1. Write docs/ARCHITECTURE.md: modules, data model (tables, relations, which tables carry company_id and client_id), the RLS strategy, the provider interface, the memory and permission model, the Hide pipeline, group conversation permissions, the render worker.
2. Create docs/STATUS.md with every feature from CLAUDE.md section 4 marked "not started".
3. Create .env.example listing every variable needed, with a one-line explanation each.
4. Initialise git.

Then report to me in French, in plain language: the plan in 10 lines, the list of accounts and keys you need from me, and any point in CLAUDE.md you find unclear or risky.
```

## Step 1 — Foundation: accounts, companies, roles, design system
```
Implement the foundation described in CLAUDE.md (sections 3, 4.10, 7, 8):
- Next.js + TypeScript + Tailwind + shadcn/ui project, a small design system (tokens, typography, core components) and the app shell (sidebar, navigation).
- i18n with French and English, no hardcoded strings.
- Supabase locally, migrations for identity, companies, roles (platform admin, Owner, Admin, Member), invitations, employee profiles with expertise, clients. RLS on every tenant table.
- Authentication (email + magic link, Google sign-in) and server-side authorisation helpers used by every route.
- The three spaces: platform admin area, company admin area, member app. Each reachable only by the right role.
- Onboarding flow: account, company, profile, invite employees, first client.
- Tests: no cross-company access, member restrictions, platform admin cannot read company content tables.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 2 — Multi-model chat
```
Implement CLAUDE.md section 4.1 and the usage/quota parts of sections 4.8 and 5:
- Provider interface with OpenAI, Anthropic and Google adapters, streaming, clean error handling (missing key, rate limit, provider down).
- Persistent conversations, Markdown, copy, regenerate, attachments, search, clear model labels.
- Switch model mid-conversation with context carried over by the platform.
- "Auto" option in the model picker (rule-based first version), showing which model answered and why.
- AI Clarification built into the system prompt.
- Usage logging from real provider token counts; credits; per-company and per-user quotas with 80% warning and 100% stop.
- Company admin: allowed models and default model.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 3 — Clients, documents, two memories, Source Proof
```
Implement CLAUDE.md section 4.2:
- Client spaces with Open / Restricted visibility and employee assignments.
- Document upload, parsing, chunking, embeddings with pgvector, permission-filtered retrieval.
- Company memory and client memories with permission categories (read / write), entries with source, author and date, editable and deletable, deliberate creation only.
- Promotion of general learnings from client memory to company memory, proposed by the AI and approved by an authorised human.
- Source Proof under answers: document or entry, exact passage, date, click to open.
- Tests proving a user can never retrieve, directly or through the AI, memory or documents they are not allowed to access.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 4 — Hide
```
Implement CLAUDE.md section 4.3:
- The three modes above the input: Automatic, Documents, Manual (red highlights, click to blur, free selection).
- Server-side detection only: patterns with checksums, company lists (clients, employees, custom terms), local NER for person names. Nothing unmasked is sent to an external AI for detection.
- Reversible pseudonymisation: placeholders to the model, real values restored for authorised users, mapping stored server-side per conversation.
- Company admin settings: default mode and custom sensitive terms.
- Metadata-only logging of masking events.
- Tests with realistic French and English examples (IBAN, phone numbers, names, amounts), including documents.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 5 — Collaboration
```
Implement CLAUDE.md section 4.4:
- Group conversations in real time (Supabase Realtime): "Add" button, presence, authorship.
- The AI answers only when mentioned (@Claude, @ChatGPT, @Gemini, @AI).
- History on join: from arrival by default, "Share history" with a selector on the timeline.
- AI context limited to history visible to all participants and to the intersection of their memory permissions, with a subtle indicator.
- Conversation transfer with ownership change and loss of access for the sender.
- Smart Handover file generated on transfer of a conversation, client or project.
- Who Can Help: expertise in profiles, natural suggestions in answers, invite button, opt-out, never based on private conversations.
- Tests for every permission rule above.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 6 — Confronter, tools and the agent framework
```
Implement CLAUDE.md sections 4.5 and 4.6, and the shared framework behind 4.7:
- Confronter: parallel answers from the allowed models, cross-critique, synthesis (agreements, divergences, errors, claims to verify, recommended answer), credit cost shown before running.
- Agent/tool framework: instructions, input form, models, tools, memory scope, output format, visibility (me / team / company), enable per role, company-specific customisation.
- "Turn into a tool" from a conversation, with review and company-wide approval by an Admin.
- The library UI organised by department.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 7 — The 14 text-based agents
```
Using the framework from Step 6, build the Sales, Accounting, Finance, HR, Legal, Customer Service and Management agents from the table in CLAUDE.md section 4.7, respecting every constraint listed there (Application Review Assistant never scores or rejects candidates; drafts only; legal notice).
Include exports where the table mentions them (CSV/XLSX, DOCX/PDF) and charts for the finance and dashboard agents.
Test each agent with a realistic French example and a realistic English example.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 8 — Video agents and the render worker
```
Implement the Marketing agents from CLAUDE.md section 4.7:
- A render worker in its own Docker container (Chromium, FFmpeg, HyperFrames) with a database-backed job queue, progress and failure states.
- Motion Design: brief and brand assets → HyperFrames composition → preview → MP4.
- Video Editor: uploaded clips + brief → edit plan → MP4 in 16:9, 9:16 and 1:1.
- Dedicated credit quota for video and motion jobs.
- Check HyperFrames' current documentation and licence before integrating, and record what you checked in docs/STATUS.md.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 9 — Admin consoles
```
Complete CLAUDE.md sections 4.8 and 4.9:
- Company admin console: employees, permissions, models, agents and tools, Hide policies, usage dashboards (real data; estimated costs labelled as estimates), quotas, activity log.
- Platform admin console: companies, plans and seats, quotas and credits, usage and estimated AI cost per company, provider health, audit log, with no access to customer content.
- Make every dashboard elegant and readable by a non-technical boss.

Finish with the end-of-step routine (CLAUDE.md section 9).
```

## Step 10 — Full test, security review, documentation
```
1. Run the complete launch scenario from CLAUDE.md section 10 end to end, automated where possible. Fix everything that fails.
2. Run a security review: cross-company and cross-client access through every route (UI, API, AI, search, realtime), group-chat permission intersection, platform admin content isolation, secrets, logs, file uploads.
3. Write README.md (install, configure, run, test), finalise docs/ARCHITECTURE.md, write docs/SECURITY.md (safeguards in place, every data flow to AI providers, remaining risks before accepting real customer data) and docs/ROADMAP.md (ready / partial / next).
4. Prepare deployment in EU regions and list exactly what I need to create or pay for.

Report to me in French: does the full scenario work, what remains before a first paying customer, and what an external security audit should check.
```
