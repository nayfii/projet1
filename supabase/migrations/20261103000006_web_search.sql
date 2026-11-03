-- Web search in the chat (founder's request, 2026-11-03): ChatGPT, Claude and Gemini may search the web
-- (news, prices, recent facts) with their provider's own search tool, and cite the pages. Each search
-- costs credits set by our team; a company can switch it off (Administration → Modèles).

alter table public.company_ai_settings add column web_search_enabled boolean not null default true;

alter table public.platform_settings
  add column web_search_credits numeric(10, 2) not null default 10 check (web_search_credits >= 0),
  add column web_search_cost_usd numeric(10, 4) not null default 0.01 check (web_search_cost_usd >= 0);

-- How many searches an answer made (counts only), next to its tokens and credits.
alter table public.usage_events add column web_searches integer not null default 0 check (web_searches >= 0);
grant select (web_searches) on public.usage_events to authenticated;

drop function public.admin_set_ai_features(uuid, boolean, boolean);
create function public.admin_set_ai_features(
  p_company uuid,
  p_auto_client_memory boolean default null,
  p_dictation_enabled boolean default null,
  p_web_search boolean default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'models') then perform private.fail('forbidden'); end if;
  insert into public.company_ai_settings (company_id, auto_client_memory, dictation_enabled, web_search_enabled, updated_by)
  values (p_company, coalesce(p_auto_client_memory, true), coalesce(p_dictation_enabled, true), coalesce(p_web_search, true), (select auth.uid()))
  on conflict (company_id) do update set
    auto_client_memory = coalesce(p_auto_client_memory, public.company_ai_settings.auto_client_memory),
    dictation_enabled = coalesce(p_dictation_enabled, public.company_ai_settings.dictation_enabled),
    web_search_enabled = coalesce(p_web_search, public.company_ai_settings.web_search_enabled),
    updated_by = excluded.updated_by;
  perform private.log_event('company', p_company, 'ai.features_updated', 'company', p_company::text,
    jsonb_strip_nulls(jsonb_build_object('auto_client_memory', p_auto_client_memory, 'dictation', p_dictation_enabled, 'web_search', p_web_search)));
end;
$$;

create function public.platform_set_web_search_rate(p_credits numeric, p_cost_usd numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits < 0 or p_cost_usd is null or p_cost_usd < 0 then perform private.fail('validation'); end if;
  update public.platform_settings set web_search_credits = p_credits, web_search_cost_usd = p_cost_usd, updated_by = (select auth.uid()), updated_at = now() where id;
  perform private.log_event('platform', null, 'settings.web_search_rate', 'platform_settings', 'web_search',
    jsonb_build_object('credits', p_credits, 'cost_usd', p_cost_usd));
end;
$$;

revoke execute on function public.admin_set_ai_features(uuid, boolean, boolean, boolean), public.platform_set_web_search_rate(numeric, numeric) from public, anon;
grant execute on function public.admin_set_ai_features(uuid, boolean, boolean, boolean), public.platform_set_web_search_rate(numeric, numeric) to authenticated;
