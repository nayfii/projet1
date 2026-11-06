-- Images in the chat (founder's request, 2026-11-07): create an image from a description, or change a
-- photo, with ChatGPT's image model. Each image costs credits set by our team; a company can switch it
-- off (Administration → Modèles). The image is stored like an attached file of the answer.

alter table public.company_ai_settings add column image_generation_enabled boolean not null default true;

-- PLACEHOLDER ESTIMATES, to check on OpenAI's pricing page; our team changes them in the console.
alter table public.platform_settings
  add column image_credits numeric(10, 2) not null default 60 check (image_credits >= 0),
  add column image_cost_usd numeric(10, 4) not null default 0.06 check (image_cost_usd >= 0);

alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render', 'avatar', 'client_summary', 'dictation', 'title', 'image'));

-- Files made by the AI (an image it created) are kept apart from what people uploaded.
alter table public.conversation_attachments add column generated boolean not null default false;

drop function public.admin_set_ai_features(uuid, boolean, boolean, boolean);
create function public.admin_set_ai_features(
  p_company uuid,
  p_auto_client_memory boolean default null,
  p_dictation_enabled boolean default null,
  p_web_search boolean default null,
  p_image_generation boolean default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'models') then perform private.fail('forbidden'); end if;
  insert into public.company_ai_settings (company_id, auto_client_memory, dictation_enabled, web_search_enabled, image_generation_enabled, updated_by)
  values (p_company, coalesce(p_auto_client_memory, true), coalesce(p_dictation_enabled, true), coalesce(p_web_search, true),
          coalesce(p_image_generation, true), (select auth.uid()))
  on conflict (company_id) do update set
    auto_client_memory = coalesce(p_auto_client_memory, public.company_ai_settings.auto_client_memory),
    dictation_enabled = coalesce(p_dictation_enabled, public.company_ai_settings.dictation_enabled),
    web_search_enabled = coalesce(p_web_search, public.company_ai_settings.web_search_enabled),
    image_generation_enabled = coalesce(p_image_generation, public.company_ai_settings.image_generation_enabled),
    updated_by = excluded.updated_by;
  perform private.log_event('company', p_company, 'ai.features_updated', 'company', p_company::text,
    jsonb_strip_nulls(jsonb_build_object('auto_client_memory', p_auto_client_memory, 'dictation', p_dictation_enabled,
      'web_search', p_web_search, 'image_generation', p_image_generation)));
end;
$$;

create function public.platform_set_image_rate(p_credits numeric, p_cost_usd numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits < 0 or p_cost_usd is null or p_cost_usd < 0 then perform private.fail('validation'); end if;
  update public.platform_settings set image_credits = p_credits, image_cost_usd = p_cost_usd, updated_by = (select auth.uid()), updated_at = now() where id;
  perform private.log_event('platform', null, 'settings.image_rate', 'platform_settings', 'image',
    jsonb_build_object('credits', p_credits, 'cost_usd', p_cost_usd));
end;
$$;

revoke execute on function public.admin_set_ai_features(uuid, boolean, boolean, boolean, boolean), public.platform_set_image_rate(numeric, numeric) from public, anon;
grant execute on function public.admin_set_ai_features(uuid, boolean, boolean, boolean, boolean), public.platform_set_image_rate(numeric, numeric) to authenticated;
