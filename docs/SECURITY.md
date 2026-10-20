# Security and data flows

Status: **Step 7** (2026-10-20). Updated at every step. This document describes what is actually implemented and tested; it is not a compliance statement. We do not claim GDPR compliance, end-to-end encryption, zero data retention or any certification.

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
| Hide (sensitive data) | Detection on our server only (patterns with checksums, company lists, a local name library and rules; nothing is sent to an external AI to detect). Placeholders to the model, real values restored for people who can see the conversation. Mappings encrypted with AES-256-GCM (key outside the database), in a table no user can read; what the model received is written by the server only. Masking events logged as counts per category | `hide/server/*`, `tests/integration/hide.test.ts`, `tests/unit/hide.test.ts`, `e2e/hide.spec.ts` |
| Group conversations | Only active colleagues can be added (and for a client conversation, only those with access to the client); each sees messages, files, cited sources, stored files and search results from their own starting point only; the AI gets only the history every participant sees and the memories all of them may read; a group conversation cannot be linked to a client one participant cannot access; real-time events and presence channels follow the same rules (RLS, `realtime.messages` policies) | `collaboration` migration, `tests/integration/collaboration.test.ts`, `e2e/collab.spec.ts` |
| Transfers and Smart Handover | Only the person responsible transfers a conversation; only an employee assigned to a restricted client transfers it; the sender loses access in the same transaction; the handover file is readable and editable by the recipient only and cannot be created by users; transfers and additions are logged with ids only. Before sharing history or transferring, the app warns when the shared answers cite a memory a recipient cannot read | `transfer_conversation`, `transfer_client`, `handovers` RLS, `history_unreadable_sources`, integration tests |
| Tools and agents | Personal tools are visible to their creator only (Owner included); team tools to the team and "agents" Admins; company-wide tools only after approval by an Owner or "agents" Admin, and again after each edit. Every write goes through checked SQL functions; the database refuses a run of a tool the person may not use (role, approval). Built-in agents can be adapted per company only by its "agents" Admins | `agents` migration, `tests/integration/agents.test.ts`, `e2e/tools.spec.ts` |
| Launch agents | Defined in code and written to the database by an audited server module only; companies cannot rewrite their instructions (only add to them through Admins), so the safeguards stay: drafts only, never send, pay or sign; legal agents remind that it is not legal advice; the Application Review Assistant never scores, ranks, shortlists or decides, ignores personal characteristics and uses no memory. These are instructions to a model, checked on real examples, not a guarantee | `builtins.ts`, `builtin-sync.ts`, `tests/unit/step7.test.ts`, `tests/integration/agents.test.ts`, `tests/smoke/agents.test.ts` |
| Exports | Word, PDF, Excel and CSV files are built on our server from an AI answer the person can read (RLS with their session, from their starting point in a group); AI answers only; `Cache-Control: no-store`; CSV cells that a spreadsheet would run as a formula are neutralised; Excel cells are written as values, never formulas | `api/messages/[id]/export`, `exports/server/render.ts`, unit and e2e tests |
| Charts | Drawn in the browser from a JSON description validated against a strict schema (types, lengths, numbers); nothing is executed; an invalid description stays shown as text | `chart-spec.ts`, `chart.tsx` |
| Confronter | Same checks as an answer (access, Hide, permission-filtered memory, group rules), the quota and the estimate checked before any call; results written by the server only | `prepareChatTurn`, `confronter/server/*`, integration and e2e tests |
| AI suggestions | Nothing is saved without a person's approval; pending suggestions are visible only to their author and to people who can write in the target memory; approval re-checks write rights in SQL | `decide_memory_suggestion`, integration tests |

## 2. Data sent to AI providers

Every AI call is built by our server. Providers receive one self-contained request and are not asked to keep anything (no assistants, threads, files or vector stores on their side).

| Flow | Content sent | Recipient | When |
|---|---|---|---|
| Chat answer | **With Hide on (default: Automatic + Documents), the values of the masked categories are replaced by placeholders in everything below** (message, attached files, memory passages, the person's and client's names and descriptions); what is not detected is sent as written. System prompt: company name, industry and description; name, sector and description of the client linked to the conversation (if any); the user's full name; today's date; behaviour rules; **up to 6 memory passages** the user may read (1,600 characters each, with their title or file name, origin — company memory or the client's name — page and date). Conversation history the user can see (oldest messages dropped beyond about 60,000 estimated tokens). Text extracted from attached documents (up to 40,000 characters each). Attached images from the last 6 messages, as images. | The provider of the chosen model: **OpenAI** (Responses API, `store: false`), **Anthropic** (Messages API) or **Google** (Gemini API) | Each message, each "Regenerate" |
| Auto mode (Smart Router) | Nothing: rules run on our server | – | – |
| Attachment reading | Nothing: PDF, Word, Excel and text files are read on our server | – | – |
| Embeddings: memory | Text of every passage of a document added to a memory; title and content of every memory entry | The embeddings provider: **OpenAI** (`text-embedding-3-small`) by default, or **Google** (`gemini-embedding-001`) if configured — whichever chat model the person uses | When a document is added, an entry is saved or edited |
| Embeddings: question | The person's message (first 8,000 characters), **masked when Hide masked it**, to search the memory by meaning | Same embeddings provider | Each message, when the memories it may search are not empty |
| Memory suggestions | The conversation (last 24,000 characters) as the chat models received it (masked when Hide was on) | The conversation's model (or the one Auto picks) | When someone clicks "Proposer des entrées de mémoire" |
| Promotion | Title and content of the client memory entry, masked when Automatic is on by default | The company's default model (or the one Auto picks) | When someone clicks "Proposer pour la mémoire de l'entreprise" |
| Group conversation answer | Same as a chat answer, limited to the history every participant can see and the memories all of them may read; each person's message is prefixed with their name (masked by Hide when Automatic is on) | The mentioned provider (or the model chosen by the person who wrote "@IA") | Only when a message mentions the AI |
| Who Can Help | Names (masked when Automatic is on) and declared areas of expertise of colleagues who did not opt out, in the system prompt | The chat model | Each chat answer |
| Confronter | The same content as a chat answer, sent to **each** participating provider (OpenAI, Anthropic and Google when allowed); then each provider receives the question and the other models' answers (as written, with placeholders) to critique them; the judge's provider receives the question, all answers and all critiques | OpenAI, Anthropic, Google | When someone confirms a confrontation |
| Tool or agent run | Same as a chat answer, plus the tool's instructions and the company's adaptations (masked by Hide when auto-protect is on). The filled form is the first message; the files of the form are attachments (text read on our server, masked by Hide; images sent as images). Per agent: invoices, bank exports, sales and cost figures, applications (CVs), contracts, client e-mails, reviews, meeting notes, KPI files — whatever the person puts in the form. The Application Review Assistant gets no memory; the other agents get the memory passages the person may read | The agent's model (or the person's choice) | Each message of a run |
| Exports and charts | Nothing: built and drawn on our server and in the browser | – | – |
| "Turn into a tool" | The conversation (last 24,000 characters) as the models received it (masked when Hide was on) | The conversation's model (or the one Auto picks) | When someone clicks "Transformer en outil" |
| Smart Handover: conversation | The conversation (last 24,000 characters) as the models received it (masked when Hide was on), people numbered rather than named, the number of attached files | The conversation's model (or the one Auto picks) | When a conversation is transferred |
| Smart Handover: client | Client name, sector and description, its memory entries (titles and content, up to 30), its document names, the last messages of the sender's conversations about it — masked when Automatic is on by default | The company's default model (or the one Auto picks) | When a restricted client is transferred |
| Document reading | Nothing: memory documents are read on our server | – | – |
| Hide detection | Nothing: detection runs on our server | – | – |

**Important limits today**

- **Hide reduces what providers receive, it does not guarantee it.** Detection is imperfect (uncommon names, client names not entered in the app, unusual formats), a person can turn modes off for a message, amounts are not masked by default, and **images are never masked**.
- **Memory documents and entries are embedded unmasked** (masking would break search by meaning; the question itself is masked since Step 4). Memory content is therefore sent in clear to the embeddings provider (open question 5 in `docs/STATUS.md`: a local embeddings model would avoid it).
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
| Hide mappings | `hide_mappings` | Real values behind placeholders, encrypted (AES-256-GCM, key `HIDE_ENCRYPTION_KEY` outside the database), per conversation, deleted with it. No user can read the table |
| What the AI received | `messages.masked_content`, `conversation_attachments.masked_text` | Masked versions, readable by the conversation's participants |
| Sensitive terms | `sensitive_terms` | Visible to the Owner and Hide admins only |
| Participants | `conversation_participants` | Who takes part, their role and the first message they may see |
| Tools and agents | `agents`, `company_agent_settings` | Instructions and forms written by employees (or drafted by the AI from a conversation and reviewed); deleted with the company. Built-in agents hold no company data |
| Agent runs | `messages`, `conversation_attachments`, `chat-attachments` bucket | A run is a conversation: the form, its files and the answers are stored like any conversation. Exported files are not stored (built on each download) |
| Confrontations | `messages.confrontation` | Each model's answer and critique and the synthesis, with real values restored; readable like the conversation's messages |
| Handover files | `handovers` | Text drafted by the AI (real values restored) and edited by the recipient; readable by the recipient only; deleted with the conversation or client |
| Usage | `usage_events` | Token counts, credits, estimated cost, model, status (chat, embeddings, memory tasks). No content |
| Activity | `audit_log` | Ids and settings only (e.g. "request blocked: personal limit"). No content |

## 4. Remaining risks before accepting real customer data

1. Hide is imperfect by nature (see section 2). Real values remain in our database (messages as typed): Hide protects what goes to AI providers, not our own storage.
2. No production hosting yet: the EU hosting of the app, database and storage is still to be set up (Step 10).
3. No per-user rate limiting on the API routes beyond monthly credit quotas.
4. Prompt injection: a document or message can try to steer the model. Impact is limited today (the model has no tools and cannot act, and agents only produce drafts), but answers can be misleading — for example an invoice or a contract written to change the extracted figures or hide a clause. Agents' outputs must be reviewed by a person; the notices say so.
5. **Hiring (EU AI Act).** The Application Review Assistant is designed to stay out of automated filtering (no scores, rankings, shortlists or decisions; a person decides; notice shown). Whether a company's use of it falls under the high-risk obligations depends on how it is used; this needs a legal review before the agent is sold for recruitment.
6. File parsing libraries (pdf.js through unpdf, mammoth, exceljs) process untrusted files on our server; no antivirus scan; an isolated parsing worker would reduce the risk.
7. Quotas are checked before each request: simultaneous requests can exceed a limit slightly.
8. Anyone with direct database or service-role credentials (our infrastructure) can technically read content: the platform-admin guarantee is enforced by code and policies, not by cryptography.
9. Claude and Gemini adapters have not yet been exercised against the real APIs.
10. Memory content goes to the embeddings provider in clear (see section 2). Decide between a cloud provider and a local embeddings model before real customer data.
11. Source Proof keeps copies of cited passages after the original is deleted. A request to erase a person's data will also have to remove these copies (no tool for that yet).
12. Prompt injection through memory: a document added to a memory can contain instructions that the AI reads every time the passage is retrieved. Same limited impact as point 4 today, but more persistent.
13. Losing `HIDE_ENCRYPTION_KEY` makes earlier placeholders impossible to restore; leaking it, together with database access, reveals the mapped values (which are also in the messages).
14. Typing a word and seeing it masked tells a member it is on the company's sensitive list (inherent to masking; the list itself is not readable).
15. Sharing history or transferring a conversation shows earlier answers as written: an answer that used a memory the recipient cannot read can carry its content. The app warns only when that answer cited the memory; what people typed themselves is their own decision.
16. The conversation's title (by default the start of its first message) is visible to everyone added to it.
17. A tool's instructions are written by employees and can steer the AI (like any prompt); company-wide tools are reviewed by an Admin before publication, but team tools are not.
18. Confronter sends the same question and context to up to three providers at once: the data flow is three times wider than a normal question.

