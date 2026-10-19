# Security and data flows

Status: **Step 2** (2026-10-19). Updated at every step. This document describes what is actually implemented and tested; it is not a compliance statement. We do not claim GDPR compliance, end-to-end encryption, zero data retention or any certification.

---

## 1. Safeguards in place

| Area | What is done | Where / how it is checked |
|---|---|---|
| Authentication | Email magic link (tested), Google sign-in (implemented, untested) | Supabase Auth; `src/proxy.ts` only refreshes sessions |
| Authorisation, layer 1 | Every page, server action and API route checks the user's role and scope on the server | `src/lib/auth/guards.ts`, `memberOrNull()` in every action and route |
| Authorisation, layer 2 | Row Level Security on every table; a test fails if one table lacks it | `supabase/migrations/*`, `tests/integration/isolation.test.ts` |
| Private conversations | Conversations, messages, participants and attachments are visible only to participants who still have access to the linked client | `private.can_access_conversation()`; `tests/integration/chat.test.ts` |
| Unforgeable AI answers and usage | Users can insert only the text of their own messages (column grants). AI answers, usage rows, stop flags and "blocked request" log entries are written by two audited server modules | `assistant-writer.ts`, `usage/server/record.ts` (lint allowlist); integration tests |
| Platform admin | No policy on content tables mentions the platform admin; the console reads metadata through dedicated functions (seats, credits, estimated cost) | Integration tests: zero rows from every content table |
| Quotas | Checked on the server before every AI call; refusals are logged (metadata only) | `prepareChatTurn`; e2e test calls the API directly |
| Secrets | API keys and the Supabase secret key are server-only (no `NEXT_PUBLIC_`); provider base URLs are hardcoded so a host variable cannot redirect data | `src/lib/env.ts`, `providers/server/adapters/*` |
| Logs | Metadata only. Provider errors are reduced to a code and HTTP status; the AI SDK's default error logging (which can include the prompt) is disabled | `providers/errors.ts`, `ai-sdk-adapter.ts` (`onError: () => {}`), unit test |
| AI output in the page | Markdown without raw HTML; links open with `rel="noopener noreferrer nofollow"` | `conversations/ui/markdown.tsx` |
| Attachments | Extension allow-list, 10 MB limit, content checked against the extension (magic bytes), text extracted on our server, private bucket, Storage RLS (participants only), 60-second signed download links | `api/conversations/[id]/attachments`, `api/attachments/[id]`, integration tests |
| Search | Runs with the user's rights (security invoker); highlights rendered without HTML | `search_conversations`, `chat-sidebar.tsx` |

## 2. Data sent to AI providers

Every AI call is built by our server. Providers receive one self-contained request and are not asked to keep anything (no assistants, threads, files or vector stores on their side).

| Flow | Content sent | Recipient | When |
|---|---|---|---|
| Chat answer | System prompt: company name, industry and description; name, sector and description of the client linked to the conversation (if any); the user's full name; today's date; behaviour rules. Conversation history the user can see (oldest messages dropped beyond about 60,000 estimated tokens). Text extracted from attached documents (up to 40,000 characters each). Attached images from the last 6 messages, as images. | The provider of the chosen model: **OpenAI** (Responses API, `store: false`), **Anthropic** (Messages API) or **Google** (Gemini API) | Each message, each "Regenerate" |
| Auto mode (Smart Router) | Nothing: rules run on our server | – | – |
| Attachment reading | Nothing: PDF, Word, Excel and text files are read on our server | – | – |
| Embeddings | Not built yet (Step 3) | – | – |

**Important limits today**

- **No masking yet.** Until Hide (Step 4) is built, messages and document text are sent **as typed**, including names, amounts, IBANs or anything else they contain. Images can never be masked by Hide's text detection.
- **No EU data residency is configured** with any provider. Data sent to OpenAI, Anthropic or Google may be processed outside the EU.
- **Provider retention** follows each provider's API terms. `store: false` (OpenAI) stops responses being stored for later retrieval; it does not mean zero retention (providers may keep API data for a limited time, e.g. for abuse monitoring, as described in their own terms).
- **Gemini**: the API key must belong to a billing-enabled Google project; on the free tier Google may use the data to improve its products.

## 3. Data we store

| Data | Where | Notes |
|---|---|---|
| Messages (as typed) and AI answers | Postgres (`messages`) | Readable by participants only (RLS). Not encrypted at application level |
| Attached files and their extracted text | Storage bucket `chat-attachments` (private), `conversation_attachments` | Deleted with the conversation |
| Usage | `usage_events` | Token counts, credits, estimated cost, model, status. No content |
| Activity | `audit_log` | Ids and settings only (e.g. "request blocked: personal limit"). No content |

## 4. Remaining risks before accepting real customer data

1. Hide (sensitive data masking) is not built: do not use real confidential data yet.
2. No production hosting yet: the EU hosting of the app, database and storage is still to be set up (Step 10).
3. No per-user rate limiting on the API routes beyond monthly credit quotas.
4. Prompt injection: a document or message can try to steer the model. Impact is limited today (the model has no tools and cannot act), but answers can be misleading.
5. File parsing libraries (pdf.js through unpdf, mammoth, exceljs) process untrusted files on our server; no antivirus scan; an isolated parsing worker would reduce the risk.
6. Quotas are checked before each request: simultaneous requests can exceed a limit slightly.
7. Anyone with direct database or service-role credentials (our infrastructure) can technically read content: the platform-admin guarantee is enforced by code and policies, not by cryptography.
8. Claude and Gemini adapters have not yet been exercised against the real APIs.
