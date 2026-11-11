-- Security audit (2026-11-11). Our cost estimates stay in our console (CLAUDE.md §11: customers see
-- usage in credits only): any signed-in customer could read our dollar price per model straight from
-- the API (the usage rows' estimated cost was already closed in 20261103000002). Customers keep every
-- other column of the catalogue; our server reads the prices with its own key (catalog-store.ts).
-- Writes are unchanged: only platform admins change the catalogue (policy ai_models_platform_write).

revoke select on public.ai_models from authenticated;
grant select (id, provider, api_model_id, label, tier, context_window, max_output_tokens, supports_images, strengths,
  input_credits_per_mtok, output_credits_per_mtok, cached_input_credits_per_mtok, is_enabled, default_allowed,
  sort_order, created_at, updated_at, kind) on public.ai_models to authenticated;
