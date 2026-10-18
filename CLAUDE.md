# Product Spec — AI Workspace for SMEs (working name: TBD)

Read this file at the start of every session. It is the single source of truth for product decisions.
Do not change a decision written here without the founder's explicit approval. Record open questions in `docs/STATUS.md`.

---

## 1. Context and your role

The founder is non-technical. He owns vision, branding, sales and customer acquisition.
You are the technical founding team: architect, full-stack engineer, AI infrastructure engineer, security engineer and product designer.

Your job is to build real, working software, step by step, and to be strictly honest about what works and what does not.

---

## 2. The product

**One sentence:** a single, ultra-minimalist workspace where an SME's employees use ChatGPT, Claude and Gemini, share a company memory and per-client memories, work together with AI inside the same conversation, and keep sensitive data under control.

**Principles**
- "Models change. Your company doesn't." The platform owns conversations, memory and permissions; AI providers are interchangeable.
- "Your data. Your rules."
- Ultra-minimalist and instantly understandable by a non-technical employee. Advanced features stay hidden behind simple, discoverable controls; the chat stays clean.
- Adaptable: each company can tune agents, permissions, models and protection rules.

**Target:** all SMEs with non-technical teams. Reference customer: a company of 7–10 employees.

**Languages:** French and English from day one. Full i18n, no hardcoded UI strings. Default to the browser language; switchable per user.

---

## 3. Roles and spaces

There are three distinct spaces.

**Platform admin (our team)**
- Manages all customer companies: accounts, plans, seats, quotas and credits, usage and estimated AI cost per company, provider health.
- Must never be able to read customer conversations, documents or memory content. Enforce this in the database policies and on the server, not only in the UI, and cover it with tests.

**Company space**
- **Owner** (the boss): full control over the company.
- **Admin**: delegated management, as configured by the Owner.
- **Member** (employee): their own conversations, the clients and memories they have been granted, the agents and tools they are allowed to use.

The permission model must be extensible: memory access is governed by permission categories (see 4.2).

---

## 4. Launch features (all in scope for the MVP)

### 4.1 Multi-model chat
- Providers at launch: **OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini)**. No Mistral or Grok at launch. Use a provider interface so that adding a provider means adding one adapter.
- Streaming, Markdown rendering, persistent history, search, organisation by client, copy, regenerate, file attachments, clear model labels.
- **Switch model mid-conversation** ("Continue with Claude"): the platform owns the conversation and passes the authorised context to the newly selected model.
- **Auto mode (Smart Router):** an "Auto" option in the model picker. When selected, the platform picks the model based on task type, cost and speed, and shows in one line which model answered and why. Otherwise the user chooses. Company admins choose allowed models and the default.
- **AI Clarification:** built into the assistant's behaviour, no button. When indispensable information is missing (which client? which budget?), the AI asks one short question before producing. It avoids unnecessary questions.

### 4.2 Two memories and Source Proof
- **Company memory:** knowledge about the company itself (procedures, offers, tone of voice, policies, templates).
- **Client memory:** one per client, holding everything known about that client (documents, notes, decisions, contacts, preferences).
- **Visibility per client**, set by Owner/Admin:
  - *Open*: every employee of the company can use it.
  - *Restricted*: only assigned employees. Access moves from one employee to another by **transfer** (see 4.4).
- **Permission categories** define who can read and who can write each memory.
- **Company memory is fed by client memories**, so knowledge stays in the company. Only general learnings may be promoted (example: "clients in this sector prefer short weekly reports"), never confidential client data. The AI proposes a promotion; a human with the right permission approves it.
- **Memory entries are created deliberately**: saved from a chat, uploaded as a document, or suggested by the AI and approved by the user. No silent automatic capture. Entries are editable and deletable, and each keeps its source, author and date.
- **Documents:** upload PDF, DOCX, TXT, MD, CSV/XLSX. Chunk, embed (pgvector), and retrieve only within the user's authorised scopes.
- **Source Proof:** whenever an answer uses memory or documents, show below the answer the source document or entry, the exact passage and its date, clickable to open the passage. If nothing in memory supports a claim about an internal rule, the AI says it does not know rather than inventing.
- **Hard rule:** permission filtering happens before retrieval results reach any model. A user must never obtain, directly or through the AI, content from a memory they cannot access.

### 4.3 Hide — sensitive data protection
A control above the message input with three modes, which can be combined:
1. **Automatic:** detects and masks sensitive data in the typed message before sending: IBANs, card numbers, emails, phone numbers, amounts, person names, client names, and project or file names that admins mark as sensitive.
2. **Documents:** scans attached documents and masks the same categories before any excerpt is sent.
3. **Manual:** highlights in red what looks sensitive; the user clicks each item to blur or unblur it, and can also select any passage to blur it.

Implementation requirements:
- Detection runs on our servers. Never send unmasked text to an external AI in order to detect sensitive data. Use deterministic patterns (with checksums where they exist, e.g. IBAN), the company's own lists (client names, employee names, custom terms) and a locally running NER library for person names. Recall will be imperfect; never claim 100% detection.
- **Reversible pseudonymisation:** the model receives stable placeholders such as `[CLIENT_1]` or `[IBAN_1]`; the answer shown to authorised users has the real values restored. The mapping is stored server-side only, scoped to the conversation.
- Admins set the company default (for example Automatic on by default) and can add custom sensitive terms.
- Masking events are logged as metadata only (counts and categories), never the raw values.

### 4.4 Collaboration
- **Group conversation ("3-way chat"):** any conversation can become a group conversation through an "Add" button that invites colleagues from the company. Humans talk to each other; the AI answers **only when mentioned** (`@Claude`, `@ChatGPT`, `@Gemini`, or `@AI` for the selected model or Auto). Real-time updates, presence, clear authorship.
- **History on join:** by default a new participant sees only messages from their arrival. The inviter can choose "Share history" with a selector on the timeline to decide how far back the new participant can see.
- **AI context rule in group conversations:** the AI uses only the history visible to all current participants, and only memories and documents that all current participants are allowed to access (the intersection of their permissions). Show a subtle indicator when context was limited for this reason.
- **Transfer a conversation:** send a conversation to a colleague; ownership moves to them and the sender loses access, after a confirmation dialog. Logged.
- **Smart Handover:** when a conversation, a restricted client or a project is transferred, the AI prepares a handover file: summary of the work done, decisions taken, useful documents, remaining tasks and next actions. The recipient can edit it.
- **Who Can Help:** employees fill in their areas of expertise in their profile. In its answers, the AI can naturally suggest a colleague ("Nathalie has worked on this, you can ask her") with a button to invite her into the conversation. Suggestions rely only on declared expertise and on content that is already shared (for example, authorship of company memory entries), never on private conversations. Employees can opt out.

### 4.5 Confronter
One button on any question or answer. It merges three ideas: Challenger, Best Answer and Decision Mode.
- ChatGPT, Claude and Gemini (those the company allows) each answer.
- Each model critiques the others' answers.
- A final synthesis shows: points of agreement, divergences, errors or weak reasoning detected, claims that need verification, and a recommended combined answer.
- It goes through Hide and the permission rules like any request.
- It is several times more expensive than a normal request: show the credit cost before running and count it against the quota.

### 4.6 Turn into a tool
On a successful conversation, "Turn into a tool" makes the AI extract a reusable tool: name, description, input form fields (e.g. client, meeting notes), instructions, model and memory scope. The creator reviews and edits it, then chooses the visibility: just me, my team, or the whole company (company-wide publication needs Admin approval). Tools appear in the library and run as a simple form. Tools and agents share the same underlying framework.

### 4.7 Agent library by department
- The library is organised by department. Each agent consists of instructions, an input form, allowed model(s), tools, memory scope and output format.
- Companies can adapt each agent (instructions, tone, defaults, which memory it uses) and enable or disable it per role.

**Launch set — 8 departments × 2 agents**

| Department | Agent | Input → Output |
|---|---|---|
| Marketing | Motion Design | Brief + brand assets → animated MP4, built with HyperFrames |
| Marketing | Video Editor | Uploaded clips + brief → edited MP4 (cuts, order, captions, 16:9 / 9:16 / 1:1 versions) |
| Sales | Proposal Writer | Client + needs → commercial proposal draft, exportable |
| Sales | Meeting Prep | Client → brief with context from client memory, history, talking points and questions |
| Accounting | Invoice Intake | Uploaded invoices (PDF or images) → extracted table (supplier, date, amounts, VAT, category), exportable as CSV/XLSX |
| Accounting | Payment Reminders | List of unpaid invoices → reminder email drafts with escalating tone |
| Finance | Cash-Flow Forecast | Uploaded bank exports + recurring items → 3–12 month forecast table and chart |
| Finance | Margin Analysis | Sales and cost data → margins by product, client or project, with commentary |
| HR | Job Posting Writer | Role + context → job posting draft |
| HR | Application Review Assistant | Applications + employer-written criteria → structured summaries |
| Legal | Contract Review | Uploaded contract → key clauses, risks, missing clauses, questions for a lawyer |
| Legal | Template Drafter | Type of document → draft of terms and conditions (CGV), NDA or other standard document |
| Customer Service | Email Responder | Incoming client email → reply draft in the company's tone, using memory |
| Customer Service | Feedback Synthesis | Uploaded reviews or emails → themes, sentiment, recommended actions |
| Management | Meeting Minutes | Notes, transcript or audio file → minutes with decisions and action items |
| Management | Weekly Dashboard | Uploaded data files + memory → one-page weekly summary of KPIs, highlights and risks |

**Constraints**
- **Application Review Assistant:** it summarises and structures applications against criteria written by the employer. It never rejects, scores or ranks candidates on its own; a human decides. Display a notice to that effect. AI used to filter job applications is classified as high-risk under the EU AI Act.
- Accounting, finance and legal agents produce drafts for human review. No agent executes payments or sends emails automatically at launch. The legal agents display a "not legal advice" notice.
- **Motion Design** uses HyperFrames (HeyGen, open source, Apache-2.0): the model writes an HTML/CSS/GSAP composition, the user previews it, and a render worker produces the MP4 with headless Chromium and FFmpeg.
- **Video Editor:** the AI produces an edit plan (cuts, order, captions, formats) and the same render worker executes it with FFmpeg. Start simple.
- Rendering runs in a separate worker container, not in serverless functions. Video and motion jobs consume credits from a dedicated quota.
- No third-party integrations at launch: data comes from uploads and memory.

### 4.8 Company admin console (Owner/Admin)
- **Employees:** invite, deactivate, roles, expertise.
- **Permissions:** memory access categories, client visibility and assignments.
- **Models:** enable or disable, default model, Auto mode.
- **Agents and tools:** enable per role; approve company-wide tools.
- **Hide policies:** default mode, custom sensitive terms.
- **Usage:** requests, tokens, credits, by user, model and period, using real data returned by the providers. Costs computed from pricing tables are labelled as estimates.
- **Quotas.**
- **Activity log:** sign-ins, permission changes, transfers, masking events (metadata only), blocked requests.

### 4.9 Platform admin console (our team)
Company list, create or suspend a company, plan and seats, quotas and credits per company, usage and estimated AI cost per company (margin view), provider health, platform audit log. No access to customer content.

### 4.10 Onboarding
Create account → create company → company profile → invite employees → first client → first document → first conversation. Fast, elegant, with skippable steps.

---

## 5. Business rules that affect the product
- **AI cost is included in the subscription.** Planned pricing: per seat, around €30–40 per user per month, with a credit quota; video and motion consume extra credits. Pricing is not validated yet, so plans, quotas and credit costs are configurable by the platform admin, with no hardcoded prices.
- **Quotas** apply per company and per user: soft warning at 80%, hard stop at 100%; an admin can raise the limit.
- Online payment (Stripe) comes later. In the MVP, the platform admin assigns plans manually.

---

## 6. Not at launch (backlog — do not build unless asked)
- Data Preview (rejected by the founder).
- Read-only "follow" mode and "copy" mode for shared conversations.
- AI that intervenes in group chats without being mentioned.
- Personal memory.
- Higgsfield and Canva integrations; Microsoft 365, SharePoint, Google Drive, Slack and other integrations.
- Additional providers (Mistral, Grok…), EU-hosted or private models.
- Autonomous agents that act on external systems (sending emails, payments).
- Stripe billing, SSO/SCIM, advanced enterprise administration.

---

## 7. Design
- Ultra-minimalist, premium, instantly understandable. Quality references: Linear × Notion × ChatGPT, used as references, not templates.
- Neutral palette with one carefully chosen accent colour, excellent typography, generous spacing, subtle motion, polished empty, loading and error states. Responsive.
- It must not look like cybersecurity software, a crowded enterprise dashboard, a developer tool or a generic AI template.
- Every screen feels part of the same product. Build a small design system first and reuse it everywhere.

---

## 8. Technical architecture
- **Frontend and server:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Motion for animation.
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime) in an **EU region**; pgvector for embeddings; Row Level Security on every tenant table.
- **AI:** our own provider interface (an SDK such as the Vercel AI SDK may be used underneath) with OpenAI, Anthropic and Google adapters. The embeddings provider is configurable.
- **Render worker:** a Docker container with Chromium, FFmpeg and HyperFrames, fed by a database-backed job queue.
- **Hosting:** EU regions only for the app, database, storage and workers. Do not claim that AI providers process data in the EU unless an EU data-residency option is actually configured. Document every flow of data to providers, including embeddings, in `docs/SECURITY.md`.
- **Modular monolith** with clear modules: identity, organisations and roles, clients, conversations and participants, documents and embeddings, memory, providers and routing, Hide, agents and tools, usage and quotas, audit. No microservices.

**Security**
- No secrets in code or in the browser. Server-side authorisation on every route; database policies as a second barrier.
- Tests for isolation between companies, between clients, for the permission intersection in group conversations, and for the platform admin's lack of content access.
- Logs never contain prompt content or masked values.
- Never claim GDPR compliance, end-to-end encryption, zero data retention or certifications that have not actually been implemented and verified.

---

## 9. Working rules
1. Build real features. No button that does nothing; anything unfinished is visibly marked "Coming soon".
2. Use a real database for persistence. Demo data, if any, is clearly identified as demo.
3. Ask the founder only for credentials, paid services or irreversible decisions. If credentials are missing, implement the integration anyway, document it in `.env.example` and continue.
4. Keep the code maintainable: reusable components, clear naming, short documentation.
5. **End-of-step routine (after every step):**
   - Run the type check, lint, tests and production build, and fix what fails.
   - Update `docs/STATUS.md`: done / partial / not started / known issues, honestly.
   - Report to the founder **in French, in plain non-technical language**: what now works, exactly what he should click to test it himself, and what is missing or risky.

---

## 10. Launch success scenario
1. The platform admin creates a plan; the Owner signs up and completes onboarding.
2. The Owner invites Olivier and Nathalie (expertise: finance).
3. The Owner creates Client A (restricted, assigned to Olivier) and Client B (open).
4. The Owner uploads Client A documents and saves a Client A memory entry.
5. Olivier asks ChatGPT a question about Client A; the answer shows Source Proof.
6. Olivier switches to Claude; the context is retained.
7. With Hide on Automatic, Olivier types an IBAN and a client name: the model receives placeholders, Olivier sees the real values.
8. Olivier asks a finance question; the AI suggests asking Nathalie.
9. Olivier adds Nathalie to the conversation and shares history from a chosen message. `@Claude` answers using only what both can access: Nathalie has no Client A access, so Client A memory is not used.
10. Olivier runs Confronter: three models, cross-critique, synthesis.
11. Olivier turns the conversation into a tool; the Owner publishes it company-wide.
12. Olivier runs the Proposal Writer agent and the Motion Design agent (an MP4 is rendered).
13. Olivier transfers Client A to Nathalie with a Smart Handover; Olivier loses access.
14. A member without access cannot obtain Client A data by any route: UI, API, AI or search.
15. The Owner sees real usage, credits and the activity log; the platform admin sees the company's usage but cannot open any conversation.
