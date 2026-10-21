-- Claude models in the catalogue, checked against Anthropic's published table (2026-10-21):
-- Claude Sonnet 5.5 reads from the prompt cache at $0.20 per million tokens (not $0.10), and the
-- three Claude 5.5 models have a 1M-token context window (the platform still caps each request).
-- Estimates only; our team can change them in Platform → Modèles et tarifs.
update public.ai_models
set cached_input_usd_per_mtok = 0.20, cached_input_credits_per_mtok = 200
where id = 'claude-sonnet-5-5' and cached_input_usd_per_mtok = 0.10;

update public.ai_models
set context_window = 1000000
where id in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5') and context_window = 200000;
