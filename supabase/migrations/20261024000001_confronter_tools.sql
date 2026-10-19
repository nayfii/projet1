-- Step 6: Confronter (CLAUDE.md §4.5), and the framework shared by tools and agents (§4.6, §4.7).

-- ─── Confronter ──────────────────────────────────────────────────────────────
-- A confrontation is stored as an AI answer whose `content` is the recommended answer (so it is
-- copied, searched and used as context like any answer) and whose `confrontation` holds the models'
-- answers, their cross-critiques and the synthesis. Written by the server only, like every answer.
alter table public.messages add column confrontation jsonb;
