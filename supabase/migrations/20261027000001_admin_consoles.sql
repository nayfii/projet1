-- Step 9: admin consoles (CLAUDE.md §4.8, §4.9). Usage by feature with AI and video credits apart,
-- plan prices for the platform's margin view, provider health. Metadata only: no content anywhere.

-- ─── Company usage dashboard: AI credits and video credits are separate pools ──
create or replace function public.company_usage_summary(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not private.has_admin_scope(p_company, 'usage') then perform private.fail('forbidden'); end if;
  with ev as (
    select * from public.usage_events
    where company_id = p_company and created_at >= p_from and created_at < p_to
  ),
  std as (select * from ev where credit_pool = 'standard')
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'requests', count(*), 'errors', count(*) filter (where status = 'error'),
        'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
        'credits', coalesce(sum(credits), 0), 'estimated_cost_usd', coalesce(sum(estimated_cost_usd), 0),
        'estimated_tokens_requests', count(*) filter (where tokens_estimated),
        'active_users', count(distinct user_id)) from std),
    'by_user', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select user_id, count(*) as requests, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
               sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd
        from std group by user_id) r), '[]'),
    'by_model', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select model_id, provider, count(*) as requests, sum(input_tokens) as input_tokens,
               sum(output_tokens) as output_tokens, sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd,
               count(*) filter (where auto_routed) as auto_requests
        from std group by model_id, provider) r), '[]'),
    'by_feature', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select feature, count(*) as requests, sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd
        from std group by feature) r), '[]'),
    'by_day', coalesce((select jsonb_agg(r order by r.day) from (
        select (created_at at time zone 'UTC')::date as day, count(*) as requests, sum(credits) as credits
        from std group by 1) r), '[]'),
    'video', jsonb_build_object(
        'credits', coalesce((select sum(credits) from ev where credit_pool = 'video'), 0),
        'renders', (select count(*) from public.render_jobs j where j.company_id = p_company and j.created_at >= p_from and j.created_at < p_to),
        'succeeded', (select count(*) from public.render_jobs j where j.company_id = p_company and j.status = 'succeeded' and j.created_at >= p_from and j.created_at < p_to),
        'failed', (select count(*) from public.render_jobs j where j.company_id = p_company and j.status = 'failed' and j.created_at >= p_from and j.created_at < p_to))
  ) into v_result;
  return v_result;
end;
$$;

-- ─── Plan prices (for our margin view only; nothing is billed from here) ───────
alter table public.plans
  add column monthly_price_per_seat numeric(10, 2) check (monthly_price_per_seat >= 0),
  add column price_currency text not null default 'EUR' check (price_currency in ('EUR', 'USD'));

-- ─── Platform settings: the exchange rate used to compare AI cost (USD) with prices ──
create table public.platform_settings (
  id boolean primary key default true check (id),
  -- How many euros one US dollar is worth, set by our team. Empty: margins are shown in their own currencies.
  usd_to_eur numeric(10, 4) check (usd_to_eur > 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon;
revoke insert, update, delete, truncate, trigger, references on public.platform_settings from authenticated;
create policy platform_settings_select on public.platform_settings
  for select to authenticated using ((select private.is_platform_admin()));

create function public.platform_set_exchange_rate(p_usd_to_eur numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_usd_to_eur is not null and (p_usd_to_eur <= 0 or p_usd_to_eur > 100) then perform private.fail('validation'); end if;
  update public.platform_settings set usd_to_eur = p_usd_to_eur, updated_by = (select auth.uid()), updated_at = now() where id;
  perform private.log_event('platform', null, 'settings.exchange_rate', 'platform_settings', 'usd_to_eur',
    jsonb_build_object('usd_to_eur', p_usd_to_eur));
end;
$$;

-- ─── Platform: usage and estimated AI cost per company (margin view) ──────────
create function public.platform_usage_overview(p_from timestamptz, p_to timestamptz)
returns table (
  company_id uuid, name text, status text, created_at timestamptz, plan_name text, price_per_seat numeric, price_currency text,
  seats_active bigint, requests bigint, errors bigint, credits numeric, estimated_cost_usd numeric,
  video_credits numeric, renders bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select c.id, c.name, c.status::text, c.created_at, pl.name, pl.monthly_price_per_seat, coalesce(pl.price_currency, 'EUR'),
    (select count(*) from public.company_members m where m.company_id = c.id and m.status = 'active'),
    coalesce(u.requests, 0), coalesce(u.errors, 0), coalesce(u.credits, 0), coalesce(u.cost, 0), coalesce(u.video_credits, 0),
    (select count(*) from public.render_jobs j where j.company_id = c.id and j.created_at >= p_from and j.created_at < p_to)
  from public.companies c
  left join public.plans pl on pl.id = c.plan_id
  left join lateral (
    select count(*) filter (where e.credit_pool = 'standard') as requests,
           count(*) filter (where e.credit_pool = 'standard' and e.status = 'error') as errors,
           sum(e.credits) filter (where e.credit_pool = 'standard') as credits,
           sum(e.estimated_cost_usd) as cost,
           sum(e.credits) filter (where e.credit_pool = 'video') as video_credits
    from public.usage_events e
    where e.company_id = c.id and e.created_at >= p_from and e.created_at < p_to
  ) u on true;
end;
$$;

-- One company's usage over a period, for our team: per day, model and feature. Never per person, never content.
create function public.platform_company_usage(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if not exists (select 1 from public.companies where id = p_company) then perform private.fail('not_found'); end if;
  with ev as (
    select * from public.usage_events
    where company_id = p_company and created_at >= p_from and created_at < p_to
  ),
  std as (select * from ev where credit_pool = 'standard')
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'requests', count(*), 'errors', count(*) filter (where status = 'error'),
        'credits', coalesce(sum(credits), 0), 'estimated_cost_usd', coalesce(sum(estimated_cost_usd), 0),
        'active_users', count(distinct user_id)) from std),
    'by_model', coalesce((select jsonb_agg(r order by r.estimated_cost_usd desc) from (
        select model_id, provider, count(*) as requests, sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd
        from std group by model_id, provider) r), '[]'),
    'by_feature', coalesce((select jsonb_agg(r order by r.estimated_cost_usd desc) from (
        select feature, count(*) as requests, sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd
        from std group by feature) r), '[]'),
    'by_day', coalesce((select jsonb_agg(r order by r.day) from (
        select (created_at at time zone 'UTC')::date as day, count(*) as requests, sum(credits) as credits,
               sum(estimated_cost_usd) as estimated_cost_usd
        from std group by 1) r), '[]'),
    'video', jsonb_build_object(
        'credits', coalesce((select sum(credits) from ev where credit_pool = 'video'), 0),
        'renders', (select count(*) from public.render_jobs j where j.company_id = p_company and j.created_at >= p_from and j.created_at < p_to))
  ) into v_result;
  return v_result;
end;
$$;

-- ─── Provider health: requests, errors and speed per provider, and the render queue ──
create function public.platform_provider_health(p_hours integer default 24)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then perform private.fail('validation'); end if;
  v_since := now() - make_interval(hours => p_hours);
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(r order by r.provider) from (
        select e.provider::text as provider,
               count(*) as requests,
               count(*) filter (where e.status = 'error') as errors,
               -- Errors that say something about the provider itself (a refused or too-long request does not).
               count(*) filter (where e.status = 'error' and coalesce(e.error_code, '') not in ('content_filtered', 'context_too_long')) as service_errors,
               (select e2.error_code from public.usage_events e2
                 where e2.provider = e.provider and e2.status = 'error' and e2.created_at >= v_since
                   and e2.error_code is not null and e2.error_code not in ('content_filtered', 'context_too_long')
                 group by e2.error_code order by count(*) desc limit 1) as top_error,
               round(avg(e.latency_ms) filter (where e.status = 'ok' and e.latency_ms is not null)) as avg_latency_ms,
               max(e.created_at) filter (where e.status = 'ok') as last_ok_at,
               max(e.created_at) filter (where e.status = 'error') as last_error_at,
               count(*) filter (where e.status = 'error' and coalesce(e.error_code, '') not in ('content_filtered', 'context_too_long')
                                  and e.created_at >= now() - interval '1 hour') as errors_last_hour,
               count(*) filter (where e.status = 'ok' and e.created_at >= now() - interval '1 hour') as ok_last_hour
        from public.usage_events e
        where e.created_at >= v_since and e.provider is not null
        group by e.provider) r), '[]'),
    'render', jsonb_build_object(
        'queued', (select count(*) from public.render_jobs where status = 'queued'),
        'running', (select count(*) from public.render_jobs where status = 'running'),
        'oldest_queued_at', (select min(created_at) from public.render_jobs where status = 'queued'),
        'last_heartbeat_at', (select max(heartbeat_at) from public.render_jobs),
        'succeeded', (select count(*) from public.render_jobs where status = 'succeeded' and finished_at >= v_since),
        'failed', (select count(*) from public.render_jobs where status = 'failed' and finished_at >= v_since),
        'last_succeeded_at', (select max(finished_at) from public.render_jobs where status = 'succeeded'))
  ) into v_result;
  return v_result;
end;
$$;

-- A live check of one provider from the platform console (a tiny request with no customer data).
create function public.platform_log_provider_test(p_provider text, p_ok boolean, p_code text, p_latency_ms integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_provider not in ('openai', 'anthropic', 'google') then perform private.fail('validation'); end if;
  perform private.log_event('platform', null, 'provider.tested', 'provider', p_provider,
    jsonb_build_object('ok', p_ok, 'code', case when p_code ~ '^[a-z_]{1,40}$' then p_code end, 'latency_ms', p_latency_ms));
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.render_claim_job(text), public.render_job_progress(uuid, text, numeric, text),
  public.render_job_succeeded(uuid, text, jsonb, numeric), public.render_job_failed(uuid, text, text, boolean)
  from authenticated;
