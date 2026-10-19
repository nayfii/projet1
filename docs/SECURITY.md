# Security and data flows

Status: **Step 3** (2026-10-19). Updated at every step. This document describes what is actually implemented and tested; it is not a compliance statement. We do not claim GDPR compliance, end-to-end encryption, zero data retention or any certification.

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
| Memory rights | Two barriers: the server computes the memories a person may read before any search (`myMemorySpaces`, `conversationScope`), and RLS re-checks every entry, document, passage and suggestion (`private.can_read_space` / `can_write_space`). A restricted client's memory also requires access to the client | `tests/integration/memory.test.ts` (every route: tables, storage, search with a forced memory id, AI retrieval) |
| Passages given to the AI | Only passages from memories the person may read reach the prompt; the search runs with the user's JWT, so a forged memory id returns nothing | `memory/server/retrieval.ts`, integration tests |
| Source Proof | Cited sources are written by the audited server module only (users cannot insert or edit them); a source stays visible only to participants who can still read its memory | `assistant-writer.ts` (`saveMessageSources`), `message_sources` RLS, integration tests |
| Memory documents | Same checks as attachments (extension, 20 MB, magic bytes, text read on our server); private bucket `memory-documents`, Storage RLS = people who can read that memory; downloads through `GET /api/documents/[id]/file` (RLS check, short signed link) | `api/memory/[spaceId]/documents`, integration tests |
| AI suggestions | Nothing is saved without a person's approval; pending suggestions are visible only to their author and to people who can write in the target memory; approval re-checks write rights in SQL | `decide_memory_suggestion`, integration tests |

## 2. Data sent to AI providers

Every AI call is built by our server. Providers receive one self-contained request and are not asked to keep anything (no assistants, threads, files or vector stores on their side).

| Flow | Content sent | Recipient | When |
|---|---|---|---|
| Chat answer | System prompt: company name, industry and description; name, sector and description of the client linked to the conversation (if any); the user's full name; today's date; behaviour rules; **up to 6 memory passages** the user may read (1,600 characters each, with their title or file name, origin — company memory or the client's name — page and date). Conversation history the user can see (oldest messages dropped beyond about 60,000 estimated tokens). Text extracted from attached documents (up to 40,000 characters each). Attached images from the last 6 messages, as images. | The provider of the chosen model: **OpenAI** (Responses API, `store: false`), **Anthropic** (Messages API) or **Google** (Gemini API) | Each message, each "Regenerate" |
| Auto mode (Smart Router) | Nothing: rules run on our server | – | – |
| Attachment reading | Nothing: PDF, Word, Excel and text files are read on our server | – | – |
| Embeddings: memory | Text of every passage of a document added to a memory; title and content of every memory entry | The embeddings provider: **OpenAI** (`text-embedding-3-small`) by default, or **Google** (`gemini-embedding-001`) if configured — whichever chat model the person uses | When a document is added, an entry is saved or edited |
| Embeddings: question | The person's message (first 8,000 characters), to search the memory by meaning | Same embeddings provider | Each message, when the memories it may search are not empty |
| Memory suggestions | The conversation (last 24,000 characters) | The conversation's model (or the one Auto picks) | When someone clicks "Proposer des entrées de mémoire" |
| Promotion | Title and content of the client memory entry | The company's default model (or the one Auto picks) | When someone clicks "Proposer pour la mémoire de l'entreprise" |
| Document reading | Nothing: memory documents are read on our server | – | – |

**Important limits today**

- **No masking yet.** Until Hide (Step 4) is built, messages, document text and memory passages are sent **as typed**, including names, amounts, IBANs or anything else they contain. Images can never be masked by Hide's text detection.
- **Embeddings are not masked, even after Step 4**: masking would break search by meaning. Memory content is therefore sent in clear to the embeddings provider (open question 5 in `docs/STATUS.md`: a local embeddings model would avoid it).
- **No EU data residency is configured** with any provider. Data sent to OpenAI, Anthropic or Google may be processed outside the EU.
- **Provider retention** follows each provider's API terms. `store: false` (OpenAI) stops responses being stored for later retrieval; it does not mean zero retention (providers may keep API data for a limited time, e.g. for abuse monitoring, as described in their own terms).
- **Gemini**: the API key must belong to a billing-enabled Google project; on the free tier Google may use the data to improve its products.

## 3. Data we store

| Data | Where | Notes |
|---|---|---|
| Messages (as typed) and AI answers | Postgres (`messages`) | Readable by participants only (RLS). Not encrypted at application level |
| Attached files and their extracted text | Storage bucket `chat-attachments` (private), `conversation_attachments` | Deleted with the conversation |
| Memory entries | Postgres (`memory_entries`) | Title, content, source, author, dates, and the vector used for search |
| Memory documents | Storage bucket `memory-documents` (private), `documents` (extracted text), `document_chunks` (passages with exact positions and vectors) | Deleted with the document |
| AI suggestions | `memory_suggestions` | Proposed title and content, status, who decided |
| Source Proof | `message_sources` | A **copy** of each cited passage, with its date, kept with the answer. Deleting a document or entry does not delete the copies cited in past answers |
| Usage | `usage_events` | Token counts, credits, estimated cost, model, status (chat, embeddings, memory tasks). No content |
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
9. Memory content goes to the embeddings provider in clear (see section 2). Decide between a cloud provider and a local embeddings model before real customer data.
10. Source Proof keeps copies of cited passages after the original is deleted. A request to erase a person's data will also have to remove these copies (no tool for that yet).
11. Prompt injection through memory: a document added to a memory can contain instructions that the AI reads every time the passage is retrieved. Same limited impact as point 4 today, but more persistent.
