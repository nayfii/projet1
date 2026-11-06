# Cendr Consciousness — memory and permissions

> The model can change. The knowledge stays.

"Consciousness" is our product name for the company's durable knowledge. It is not AI sentience.
This document describes what is built (November 2026), how it works and what remains.

## 1. Audit before this work (what existed)

| Area | State before | Gap |
|---|---|---|
| Chat persistence, model switch | Messages stored by Cendr; any model receives the same history. | — |
| Company and client memory | Spaces, entries, documents, pgvector, hybrid search (`match_memory`). | — |
| Injection into the model | Top 6 passages for the **question**, numbered [S1]… | No always-on client knowledge: a new chat that didn't ask the right words got nothing. |
| Automatic client memory | Triggered **by the browser** after the answer (`autoClientMemoryAction`). | Lost if the tab closed; no dedup; a changed value added a second "truth". |
| Hallucinations | The extraction prompt asked for facts only. | An assistant's own claim could become a "fact". |
| Permissions | Strong SQL predicates (`has_client_access`, `user_space_right`, categories, managers, owner-only delete), RLS everywhere. | No temporary access, no access requests, no provider restrictions, no single rights answer for the UI. |
| Truthful indicators | Source Proof (cited passages). | Nothing said what the model received, or what was learned. |

## 2. Architecture

```
 person ──► /api/chat ──► prepareChatTurn (auth, model, quota, Hide)
                              │
                              ▼
                    Context Gateway (memory/server/gateway.ts)
     1 authorised spaces (RLS + group intersection) − provider-restricted spaces
     2 wait ≤ 2.5 s for learning in progress in this client's memory (other conversations)
     3 client key facts (brief, always given, max 8)
     4 hybrid search on current facts and documents (max 6)
     5 hot memory: the person's own not-yet-learned words (to them only)
     6 conflicts flagged (two current facts, one subject)
                              │ passages masked by Hide, numbered [S1]…, marked KEY FACT / CONFLICT
                              ▼
                 provider adapter (Claude / ChatGPT / Gemini) ── stream ──► person
                              │ trace (ids only) saved on the answer: context_meta.memory
                              ▼
            enqueue_memory_job (one per answer) ──► after the stream: runLearningJob
     exchange → candidate facts (model) → rules (memory/learning.ts) → dedup / supersede
              → store (asker's own session: RLS) → index → finish job (counts only)
```

- **Canonical storage**: `memory_entries` (Cendr's Postgres, EU). Provider-side memory or caches are
  never relied on. Embeddings record their model (`embedding_model`): a provider change re-indexes.
- **No context cache**: every request rebuilds its context with the requester's session, so removed
  access, an expired grant, a correction or a deletion apply to the very next answer.

## 3. Write path (learning)

1. After a complete answer in a conversation linked to a client, `enqueue_memory_job` checks: learning
   on for the company and the conversation, the asker may write the client's memory, the question was
   not excluded ("don't learn from this message"). One job per answer (unique), idempotent.
2. The job runs right after the stream, in the same server request (`after()`), with the asker's own
   session. A job that stopped (restart) or failed is retried on the person's next turn (3 attempts),
   or with "Try again" under the answer.
3. The model that wrote the answer reads the exchange (masked by Hide, as it already received it) and
   proposes candidate facts: kind, stable subject key, who stated it, what it is about, confidence,
   attributes, effective date (`LEARN_FACTS_SYSTEM`).
4. Deterministic rules decide (`memory/learning.ts`), never the model alone:
   - about the person themself → kept private (not stored in client memory, counted);
   - not about the client → dropped;
   - stated by the assistant, low confidence, or **not grounded** in the person's message (a number or
     a person's name the person never wrote) → **proposed for confirmation** to that person only;
   - otherwise learned.
5. Against what is known: the same fact again only confirms it (`confirmed_at`); a new value for the
   same subject **supersedes** the older one, which stays as history (`status = superseded`,
   `superseded_by`). Forgetting or deleting the newer one brings the previous version back.
6. Real values are put back after Hide; a fact still holding a placeholder (a value this person was
   not shown) is never stored.

## 4. Read path (Context Gateway)

See the diagram. The trace saved on each answer lists exactly what was given (entry or document ids,
memory, reason) plus waits, pending learnings and restricted memories. The chat shows:

- **"N memories used"** = the trace's items (+ the person's own recent words), expandable ("why this
  context": key facts vs found for the question, source, date). Items the viewer cannot read (any
  more) are not shown.
- **"N facts learned"** only once the job finished and wrote them; "Learning…" while it runs;
  "To confirm" for proposals; nothing when nothing happened. Forget, Correct, Confirm act directly.

## 5. Permission model

Roles are the existing ones (Owner, Admin with delegated scopes, Manager of a team, Member). The
database decides; the interface asks `client_permissions(client)` (same predicates) to show buttons.

| Action | Owner | Admin (scope) | Manager | Member |
|---|---|---|---|---|
| client.create (open) | ✓ | ✓ | ✓ | ✓ |
| client.create (restricted) | ✓ | clients | ✓ | — |
| client.view | all | open + assigned (clients scope: manage access) | open + assigned | open + assigned (incl. temporary) |
| client.manage / archive | ✓ | clients | clients they can open | — |
| client.delete (archived, name retyped) | ✓ | — | — | — |
| grant.approve (access request) | ✓ | clients | their team, clients they can open | — |
| memory.read / contribute | categories × client access | same | same | same |
| memory.correct / forget | writers of that memory | same | same | same |
| memory.promote to company | proposal by any reader; approval by company-memory writers | | | |
| provider restriction per memory | ✓ | permissions | — | — |
| conversation content | never by role: only participants | | | |

Temporary access: `client_assignments.expires_at`; the access functions ignore expired rows, so expiry
needs no job. Access requests (`client_access_requests`) reveal nothing about the client to the
requester until approved; deciders are the Owner, client Admins, or the requester's manager when that
manager can open the client.

## 6. Threat model (what is enforced, and where)

| Threat | Defence |
|---|---|
| Cross-tenant read (rows, vectors, jobs, traces) | RLS on every table; spaces resolved per company; `match_memory` runs as the invoker (RLS). Tested. |
| Cross-client read | Only readable spaces are searched; RLS re-checks rows; group = intersection. Tested (AI, search, jobs, rights, API). |
| Privilege laundering through extraction | Learning runs with the asker's session (can only write where they may); facts from a private conversation go only to that client's memory, never to company memory (promotion needs a human). |
| Hallucination becoming fact | Assistant claims and ungrounded figures/names go to confirmation. Tested. |
| Prompt injection in memory or messages | Passages wrapped and labelled data, never instructions; authorisation is computed before any model call and never by a model. Tested (a planted instruction cannot reach another client's memory). |
| Side channels | No count, title or existence of inaccessible memories is shown; access request page identical for unknown ids. |
| Provider exfiltration | Per-memory provider restrictions applied before the model call (Confronter: if any provider is restricted, for all). The person is told and can choose another model. Tested. |
| Revocation | No context cache; expiry checked in SQL at read time. Tested (expired grant, removed assignment). |
| Raw messages leaking to colleagues | Hot memory gives a person only their own recent words; colleagues get facts once learned. Tested. |
| Logs | Jobs and audit store counts, ids and categories only; never message or fact text. |

## 7. Acceptance tests

`tests/integration/consciousness.test.ts` (real database, real users and RLS; the extraction model
is **mocked** with fixed JSON) covers: cross-model fact (Claude → colleague's new Gemini chat, with
source), extraction delay (wait + hot memory without leak), model switch, client isolation (AI,
search, jobs, rights, API, forged job), tenant isolation, private facts, add vs delete, manager scope,
temporary grant with expiry, revocation on next request, provider restriction (incl. Confronter),
prompt injection, contradictions (supersession, history, conflict flags), hallucinations,
correct/forget with previous version restored, trace = what was given, idempotency and concurrency,
performance. `tests/unit/learning.test.ts` covers the rules. `e2e/consciousness.spec.ts` runs the
product promise in a browser with the **simulated** provider (answers labelled "[TEST]").

Not yet validated with real providers: extraction quality and recall depend on the real model and
need a run with real keys (`tests/smoke` pattern) before claiming quality.

## 8. Performance (measured)

Local database, simulated embeddings, 20 runs of the Context Gateway for a client with ~10 facts:
**p50 89 ms, p95 111 ms** (target p95 < 300 ms). Not included: the embeddings provider call for the
question (network, typically 100–300 ms; it runs in parallel with the wait for learning), and the
model's own time to first token. Learning runs after the stream and never delays the answer.

## 9. Known limits and next steps

- Team memory (a space per team) is designed but not built: today knowledge is company-wide or per
  client. Personal notes stay the "What the AI knows about me" page.
- Sharing a single fact with someone outside a client is not built (temporary access to the whole
  client is).
- Provider restrictions are per memory; per-sensitivity rules are not built.
- Learning retries rely on the person's next turn or "Try again" (no background worker yet).
- An answer already delivered cannot be unsent: revocation applies to the next request.
