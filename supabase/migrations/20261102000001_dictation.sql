-- Step 12: voice dictation (CLAUDE.md §11). Speech is transcribed by OpenAI's transcription model; the
-- company switch is company_ai_settings.dictation_enabled. Credits per minute of speech and the
-- estimated provider cost are set by our team (Platform → Modèles et tarifs). Starting values only.
alter table public.platform_settings
  add column dictation_credits_per_minute numeric(10, 2) not null default 2 check (dictation_credits_per_minute >= 0),
  add column dictation_cost_usd_per_minute numeric(10, 4) not null default 0.006 check (dictation_cost_usd_per_minute >= 0);

create function public.platform_set_dictation_rate(p_credits numeric, p_cost_usd numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits < 0 or p_credits > 100000 or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 100 then
    perform private.fail('validation');
  end if;
  update public.platform_settings
    set dictation_credits_per_minute = p_credits, dictation_cost_usd_per_minute = p_cost_usd,
        updated_by = (select auth.uid()), updated_at = now()
    where id;
  perform private.log_event('platform', null, 'settings.dictation_rate', 'platform_settings', 'dictation',
    jsonb_build_object('credits', p_credits, 'cost_usd', p_cost_usd));
end;
$$;
revoke execute on function public.platform_set_dictation_rate(numeric, numeric) from public, anon;
grant execute on function public.platform_set_dictation_rate(numeric, numeric) to authenticated;
