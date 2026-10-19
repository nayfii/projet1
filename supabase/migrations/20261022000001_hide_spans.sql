-- Hide, experience v2: where the protected values are in what the person typed, so the sent message
-- can show them struck through in green. Positions and categories only (the values are in `content`).
-- Written by the server only, like masked_content.
alter table public.messages add column hide_spans jsonb;
