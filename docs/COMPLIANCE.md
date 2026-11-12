# Compliance readiness dossier (working file)

Status: **2026-11-13, Cendr V1.1 in progress.** This is a working file to prepare future ISO/IEC 27001:2022
and SOC 2 Type II audits and a GDPR (RGPD) analysis. **Cendr is not certified and does not claim to be
compliant.** Certification needs an accredited auditor (ISO 27001), an independent CPA firm over an
observation period (SOC 2 Type II), and legal and organisational work (GDPR) that code cannot replace.

Every control below carries one status:

| Mark | Meaning |
|---|---|
| **IMPL+TEST** | implemented and covered by an automated test (file named) |
| **IMPL** | present in the code or configuration, not verified by a test |
| **MISSING** | not in place |
| **HUMAN** | needs a written procedure carried out by people |
| **LEGAL/EXT** | needs a lawyer, a contract or an external auditor |

Technical details live in `docs/ARCHITECTURE.md` (architecture) and `docs/SECURITY.md` (safeguards, data
sent to providers, security reviews). This file links them to audit frameworks and lists what is missing.

---

## 1. Scope and architecture

- **Product**: Cendr, a multi-company (B2B) AI workspace: chat with ChatGPT, Claude and Gemini, company and
  client memory ("Consciousness"), sensitive-data masking ("Hide"), collaboration, apps (agents).
- **Code**: one Next.js 16 application (TypeScript), a render worker (Docker), database migrations
  (`supabase/migrations`), automated tests (`tests/`, `e2e/`). Source on GitHub (`nayfii/projet1`).
- **Runtime**: Vercel (`fra1`, Frankfurt) for the app; Supabase (Frankfurt) for the Postgres database,
  authentication, file storage and real time. See `docs/DEPLOY.md`.
- **Tenancy**: every company is a tenant; isolation is enforced by row-level security on every table plus
  server-side checks on every route and action (`docs/ARCHITECTURE.md` §5).

## 2. Technical asset inventory

| Asset | Where | Owner | Holds personal data |
|---|---|---|---|
| Application (web + server functions) | Vercel project, region `fra1` | Founder | processes it |
| Postgres database | Supabase project, Frankfurt | Founder | yes (accounts, conversations, memory, audit log) |
| File storage (attachments, documents, avatars, render outputs, check screenshots) | Supabase Storage, private buckets | Founder | yes |
| Authentication (accounts, sessions, second factors) | Supabase Auth | Founder | yes |
| Render worker image | GitHub Container Registry; host not yet chosen | Founder | processes uploaded media |
| Source code, CI workflows, secrets for CI | GitHub repository + Actions secrets | Founder | no (test data only) |
| AI provider accounts (OpenAI, Anthropic, Google) | provider consoles | Founder | processes prompts |
| Domain and e-mail | Hostinger (domain), Google Workspace (mailboxes) | Founder | e-mail |

Status: **IMPL** (inventory written here; to be reviewed at each release — HUMAN).

## 3. Sub-processors (inventory)

| Sub-processor | Purpose | Data | Processing location (as configured) | Contract to check |
|---|---|---|---|---|
| Vercel | hosting, server functions, logs | all request data in transit; request logs | functions in `fra1` (EU); edge network global | DPA, EU SCCs — LEGAL/EXT |
| Supabase | database, auth, storage, real time | all stored data | Frankfurt (EU) | DPA — LEGAL/EXT |
| OpenAI | ChatGPT answers, embeddings, transcription (dictation), images, avatars | prompts after Hide masking; **dictation audio and avatar photos unmasked** | not EU-resident (no EU residency configured) | API terms, DPA, SCCs — LEGAL/EXT |
| Anthropic | Claude answers | prompts after Hide masking | not EU-resident | API terms, DPA, SCCs — LEGAL/EXT |
| Google (Gemini API) | Gemini answers | prompts after Hide masking | not EU-resident unless configured | API terms, DPA — LEGAL/EXT |
| GitHub | source, CI, container registry | no customer data (test data only) | US | — |
| E-mail sender (Supabase mailer or own SMTP) | sign-in and invitation e-mails | e-mail address, links | depends on provider | LEGAL/EXT |
| Google Workspace, Microsoft 365, Slack, Notion, Canva (V1.1, only when a company connects them) | the company's own apps, reached on its behalf | what a person or a workflow reads or sends there (search text, documents read, e-mails or messages sent) | the customer's own tenant at that provider | the customer's own contract with that provider; our app registration terms with each — LEGAL/EXT |

We do not claim that AI providers process data in the EU. Exact data flows: `docs/SECURITY.md` §2.

## 4. Data flows

1. **Browser ↔ app** (HTTPS, HSTS) ↔ **database/storage** (TLS, Supabase in Frankfurt).
2. **App → AI providers**: the conversation's authorised context, after Hide replaced detected sensitive
   values by placeholders on our servers (`src/modules/hide`). Memory passages are filtered by permission
   **before** retrieval results reach any model (`docs/ARCHITECTURE.md` §7, tests in
   `tests/integration/memory.test.ts`, `consciousness.test.ts`).
3. **App → OpenAI (exceptions)**: dictation audio and avatar photos are sent unmasked (said in the UI).
3b. **Knowledge import (V1.1)**: the export archive is opened in the browser and never sent; our server
   receives only the person's own words, drops private topics and secrets without AI, masks identifiers,
   then the company's model proposes knowledge that the person reviews (`docs/SECURITY.md` §2,
   `src/modules/knowledge-import`, tests `knowledge-import.test.ts` unit and integration, e2e).
4. **App → e-mail sender**: address and sign-in link.
5. **Logs**: Vercel request logs and our structured logs carry error codes only, never prompt content or
   masked values (`docs/SECURITY.md` §1).

## 5. Technical risk register (initial)

| # | Risk | Likelihood | Impact | Current treatment | Status |
|---|---|---|---|---|---|
| R1 | Data of one company visible to another | low | critical | RLS on every table, server checks, isolation tests | IMPL+TEST (`tests/integration/isolation.test.ts`) |
| R2 | Restricted client data reached by an unauthorised member (UI, API, AI, search) | low | high | permission filtering before retrieval, group intersection | IMPL+TEST (`memory`, `collaboration`, `consciousness` tests) |
| R3 | Takeover of an admin account with a stolen password or link | medium | high | two-step sign-in, required for our team, enforced in the database | IMPL+TEST (`tests/integration/mfa.test.ts`, `e2e/two-step.spec.ts`) |
| R4 | Sensitive values sent to an AI provider | medium | high | Hide on our servers (recall imperfect, said so) | IMPL+TEST (`hide` tests) |
| R5 | Prompt injection exfiltrating data (images, links) | medium | high | images in answers never loaded; placeholders never restored in link addresses; CSP | IMPL+TEST (`tests/unit/security-review.test.ts`) |
| R6 | Secret leaked in code or browser | low | critical | secrets only in Vercel/GitHub/Supabase settings; service key server-only, lint rule | IMPL (lint rule); secret scanning HUMAN |
| R7 | Runaway AI spend | medium | medium | quotas per company and user, checked before every AI call | IMPL+TEST (`chat`, `step13` tests) |
| R8 | Data loss (database) | low | critical | provider backups depend on the Supabase plan | MISSING (plan, restore test) |
| R9 | Undetected incident | medium | high | audit log; no alerting yet | MISSING (alerting) |
| R10 | Vulnerable dependency | medium | medium | `pnpm audit` at each audit (2 moderate, not exploitable) | IMPL; automated scanning MISSING |
| R11 | Personal data kept longer than needed | medium | medium | no automatic expiry yet | MISSING (retention policy decisions) |
| R14 | A connected app's token stolen or misused | low | high | tokens sealed (AES-256-GCM, separate key), never readable by signed-in people, PKCE and one-time state bound to the person, least-privilege permissions per app, personal connections usable by their owner only, company switch, revocation, write actions logged without content | IMPL+TEST (`tests/unit/integrations.test.ts`, `tests/integration/integrations.test.ts`); provider-side app verification MISSING (HUMAN) |
| R15 | An automated workflow acts beyond what its author may do, or acts twice | low | high | runs with the author's rights re-checked at each run (membership, credits, memories, connections), Play warning for actions writing outside, test mode never acts, steps recorded before acting and never repeated after an interruption, idempotency keys, limits, write actions logged without content | IMPL+TEST (`tests/integration/workflows.test.ts`, `tests/unit/workflows.test.ts`) |
| R13 | Private life of an employee imported into company memory (former AI exports) | medium | high | archive read in the browser and never stored; private topics and secrets removed without AI; second check; nothing saved without the person's tick; imports visible to their author only | IMPL+TEST (`tests/unit/knowledge-import.test.ts`, `tests/integration/knowledge-import.test.ts`, `e2e/knowledge-import.spec.ts`); word lists cannot catch everything (said in the UI) |
| R12 | Hostile uploaded files (parsers) | medium | medium | size limits, type checked by content, parsing in server functions | IMPL+TEST (upload tests); isolation of parsing MISSING |

## 6. Security controls matrix

| Area | Control | Status | Evidence |
|---|---|---|---|
| Access | Row-level security on every table; no anonymous access | IMPL+TEST | migrations; `isolation.test.ts`; `security-review.test.ts` |
| Access | Server-side authorisation on every route and action | IMPL+TEST | `src/lib/auth/guards.ts`; e2e role tests |
| Access | Roles (Owner, Admin with delegated scopes, Manager, Member); content access separate from administration | IMPL+TEST | `organizations` tests, `step12.test.ts` |
| Access | Our team cannot read customer content | IMPL+TEST | `admin-consoles.test.ts`, `isolation.test.ts` |
| Authentication | E-mail confirmation; invitations need a confirmed address | IMPL+TEST | `security-review.test.ts` |
| Authentication | Two-step sign-in (TOTP): optional for everyone, required for our team; once set, every request of the person needs it (database pre-request check, restrictive policies on real time and files) | IMPL+TEST | migration `20261113000001_mfa.sql`; `mfa.test.ts`; `e2e/two-step.spec.ts` |
| Authentication | Password rules (10+ characters, letters and digits); one sign-in link per minute in production | IMPL | `supabase/config.toml`, `scripts/supabase-production-config.mjs` |
| Authentication | Sessions: Supabase cookies (HttpOnly not set by Supabase's defaults — readable by scripts), refresh rotation | IMPL | to review with an external audit (`docs/SECURITY.md` §6) |
| Data protection | Sensitive-data masking before AI (Hide), reversible placeholders stored encrypted server-side | IMPL+TEST | `hide` tests |
| Data protection | Private storage buckets, short-lived signed links (60 s) | IMPL+TEST | `security-review` tests |
| Data protection | Encryption in transit (HTTPS/TLS) and at rest (provider-managed) | IMPL (provider) | Vercel/Supabase documentation — LEGAL/EXT to obtain attestations |
| Application | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy | IMPL | `next.config.ts` |
| Application | Uploads checked by size and content | IMPL+TEST | upload tests |
| Application | Prompt-injection safeguards (no image loading, no restored values in links, untrusted content as data) | IMPL+TEST | `security-review.test.ts` |
| Logging | Audit log of sign-ins, permission changes, transfers, masking (metadata only), our team's actions | IMPL+TEST | `audit_log`; console tests |
| Logging | No prompt content or masked values in logs | IMPL | review of `console.*` calls (2026-11-11) |
| Monitoring | Error tracking and alerting | MISSING | — |
| Change | Every change through Git, CI checks (type check, lint, tests, build), versioned releases | IMPL | `.github/workflows`, `docs/STATUS.md` |
| Change | Database migrations reviewed and applied by CI on the production branch only | IMPL | `.github/workflows` deploy |
| Backup | Database backups and a tested restore | MISSING | depends on the Supabase plan — HUMAN to configure and test |
| Suppliers | Inventory of sub-processors (§3) | IMPL | this file |
| Suppliers | Signed DPAs, transfer mechanisms | LEGAL/EXT | — |
| People | Founder accounts (GitHub, Vercel, Supabase, providers, Google Workspace) with two-step sign-in | HUMAN | to confirm and record |
| Incidents | Written procedure (§9) | HUMAN | draft below |

## 7. Elements for a future ISO/IEC 27001:2022 Statement of Applicability

The SoA itself needs the risk assessment and management decisions (HUMAN). Annex A controls with technical
evidence today:

| Annex A | Control | Status |
|---|---|---|
| 5.9 | Inventory of information and assets | IMPL (§2) |
| 5.15 | Access control | IMPL+TEST |
| 5.17 | Authentication information | IMPL (passwords, TOTP) |
| 5.19–5.22 | Supplier relationships, cloud services (5.23) | IMPL (inventory); LEGAL/EXT (contracts) |
| 5.24–5.28 | Incident management | HUMAN (procedure draft §9) |
| 5.34 | Privacy and protection of PII | partial (Hide, permissions); LEGAL/EXT |
| 8.2 | Privileged access rights | IMPL+TEST (our team: two-step required, no content access) |
| 8.3 | Information access restriction | IMPL+TEST |
| 8.5 | Secure authentication | IMPL+TEST |
| 8.10 | Information deletion | partial (entries, clients, files deletable); retention MISSING |
| 8.11 | Data masking | IMPL+TEST (Hide) |
| 8.12 | Data leakage prevention | partial (Hide, CSP, link and image safeguards) |
| 8.13 | Information backup | MISSING |
| 8.15 | Logging | IMPL+TEST (audit log) |
| 8.16 | Monitoring activities | MISSING |
| 8.24 | Use of cryptography | IMPL (TLS; Hide values encrypted; provider encryption at rest) |
| 8.25–8.29 | Secure development, coding, testing | IMPL (reviews, tests, CI) |
| 8.32 | Change management | IMPL |

## 8. SOC 2 (Trust Services Criteria) correspondence

| Criteria | Topic | Status |
|---|---|---|
| CC1, CC2, CC3 | Governance, communication, risk assessment | HUMAN (policies, risk review cadence) |
| CC5 | Control activities | IMPL (this matrix) |
| CC6.1–CC6.3 | Logical access, user registration and removal, role-based access | IMPL+TEST |
| CC6.6, CC6.7 | Boundary protection, data in transit | IMPL |
| CC6.8 | Malicious software (uploads) | partial (type and size checks) |
| CC7.1–CC7.2 | Configuration and security monitoring | MISSING (monitoring, alerting, dependency scanning in CI) |
| CC7.3–CC7.5 | Incident evaluation, response, recovery | HUMAN (procedure draft §9) |
| CC8.1 | Change management | IMPL |
| CC9.2 | Vendor risk | IMPL (inventory); LEGAL/EXT |
| A1.2–A1.3 | Backups, recovery testing | MISSING |
| C1.1–C1.2 | Confidentiality, disposal | partial (retention MISSING) |
| P (Privacy) | Notice, choice, access, retention | partial; LEGAL/EXT |

A Type II report needs these controls to **operate over a period** (usually 3–12 months) with evidence
collected throughout: the observation window has not started.

## 9. Technical incident procedure (draft — HUMAN to adopt)

1. **Detect**: user report, provider alert, audit-log anomaly, failed check in our console (Aperçu).
2. **Triage** within 24 h: what data, which companies, ongoing or not; open an incident note (date, facts).
3. **Contain**: suspend the affected company or account from our console; revoke sessions (Supabase:
   sign out user); rotate exposed keys (Vercel, GitHub, Supabase, providers); pause AI features if needed.
4. **Eradicate and recover**: fix through the normal change process; restore data from backup if needed.
5. **Notify**: as a processor, inform the affected customers (controllers) without undue delay so they can
   meet GDPR Art. 33/34 timelines (72 h to the authority when required) — wording LEGAL/EXT.
6. **Review**: root cause, test added, this dossier updated.

## 10. Backups and restore

- **Database**: Supabase backups depend on the plan (to verify in the Supabase dashboard). **MISSING**:
  choose the plan, enable point-in-time recovery if needed, and run and record a restore test.
- **Files**: no separate backup. **MISSING**.
- **Code**: Git history on GitHub (complete). **IMPL**.
- **Rollback**: Vercel keeps previous deployments (instant rollback); database migrations are forward-only,
  so a backup is required before any release that changes the schema. **HUMAN** (release checklist in
  `docs/DEPLOY.md`).

## 11. Technical retention policy (current state and decisions needed)

| Data | Kept today | Needed decision |
|---|---|---|
| Conversations, messages, attachments | until deleted by their owner (or the company) | default duration per company? |
| Hide mappings (real values of placeholders) | with their conversation, encrypted | follow the conversation |
| Memory entries, documents, facts | until deleted; superseded facts kept as history | duration of superseded history |
| Audit log | no expiry | e.g. 1 year (decision) |
| Usage events (counts, credits) | no expiry | e.g. 2 years (accounting) |
| Dictation audio, avatar source photo | **not kept** (only the text or the avatar) | — |
| Workflow runs and their steps' outputs | no expiry | e.g. 90 days for step outputs (decision) |
| Imported archives (ChatGPT, Claude, Gemini, Perplexity) | **not kept** (read in the browser); proposals waiting for review: **30 days**, then deleted; refused ones at once | — |
| Our console's check screenshots | no expiry | e.g. 90 days |
| Deleted company | not implemented as an automatic purge | procedure + purge job |

Status: **MISSING** (durations to be decided by the founder with legal advice, then implemented as jobs).

## 12. GDPR obligations (technical view)

| Article | Obligation | Status |
|---|---|---|
| 5 | Minimisation, purpose limitation, storage limitation | partial (Hide, no audio kept); retention MISSING |
| 25 | Data protection by design and by default | partial (private by default, permission filtering, Hide default on) |
| 28 | Processor contract with each customer (DPA) | LEGAL/EXT |
| 30 | Records of processing activities | MISSING (template from §3–4) |
| 32 | Security of processing | partial (this matrix) |
| 33–34 | Breach notification | HUMAN (procedure §9) |
| 35 | Impact assessment (AI processing of employee data) | LEGAL/EXT (likely needed) |
| 15–22 | Rights of access, rectification, erasure, portability | partial (memory entries and personal notes editable and deletable; account export and deletion MISSING) |
| 44–49 | International transfers (US AI providers) | LEGAL/EXT (SCCs / adequacy, provider terms) |

## 13. Security test results (latest)

| Suite | Result | Date |
|---|---|---|
| Unit (Vitest) | 396 pass, incl. logs without content, every setting documented, V1.1 migrations destroy no data | V1.1 lot 8 |
| Integration (real local database, real users, RLS) | 302 pass (23 files), incl. isolation, MFA, imports, integrations, workflows, dictation endpoint, operations indicators | V1.1 lot 8 |
| End to end (browser, simulated AI) | full suite, see `docs/STATUS.md` (V1.1, lot 8) | V1.1 lot 8 |
| Security reviews | Step 10 (16 findings), 2026-11-11 audit (findings 17–21), V1.1: the front gate blocked the workflows' clock and webhooks (fixed) | `docs/SECURITY.md` §5, `docs/STATUS.md` |
| Dependency audit | 2 moderate (fflate: fixed version applied; uuid via exceljs: the affected functions are not called), 0 high, 0 critical; now checked on every push (`.github/workflows/ci.yml`, fails on high or critical) | V1.1 lot 8 |

## 14. Evidence available

Migrations (policies as code), test files and CI runs, `docs/SECURITY.md` reviews, the audit log table,
release history in our console (Versions), this dossier.

## 15. Missing evidence and steps (to plan)

1. Backups: plan, point-in-time recovery, restore test recorded (**MISSING**).
2. Monitoring and alerting: structured logs without content, `/api/health`, uptime alert every 10 minutes,
   operations panel in our console (**IMPL**, `docs/OBSERVABILITY.md`); an error-tracking service with an
   EU region and longer log retention (**MISSING**: paid services, founder's decision).
3. Dependency scanning in CI (**IMPL**, `.github/workflows/ci.yml`); secret scanning (**MISSING**: GitHub
   secret scanning on a private repository needs a paid plan, or a third-party scanner to choose).
4. Retention durations decided and purge jobs (**MISSING**).
5. Account export and deletion for individuals (**MISSING**).
6. Signed DPAs with all sub-processors; customer DPA template (**LEGAL/EXT**).
7. Records of processing (Art. 30) and an impact assessment (Art. 35) (**LEGAL/EXT**).
8. Written policies: information security, access review, incident, supplier, acceptable use (**HUMAN**).
9. Two-step sign-in on every founder account (GitHub, Vercel, Supabase, providers, Google) (**HUMAN**).
10. External penetration test before commercial launch (**LEGAL/EXT**).
11. Recovery of a lost second factor: today done by the founder in the Supabase dashboard (Authentication
    → Users → the user → remove factor), after checking the person's identity; record each reset
    (**HUMAN**).
