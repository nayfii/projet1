-- Launch choice (CLAUDE.md §11): customers see their usage in credits only; estimated provider costs stay
-- in our console. Enforced in the database, not only on the screen.

-- The company usage summary no longer carries estimated costs.
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
        'credits', coalesce(sum(credits), 0),
        'estimated_tokens_requests', count(*) filter (where tokens_estimated),
        'active_users', count(distinct user_id)) from std),
    'by_user', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select user_id, count(*) as requests, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
               sum(credits) as credits
        from std group by user_id) r), '[]'),
    'by_model', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select model_id, provider, count(*) as requests, sum(input_tokens) as input_tokens,
               sum(output_tokens) as output_tokens, sum(credits) as credits,
               count(*) filter (where auto_routed) as auto_requests
        from std group by model_id, provider) r), '[]'),
    'by_feature', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select feature, count(*) as requests, sum(credits) as credits
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

-- Nobody reads the estimated cost of a usage row directly (our console uses its own functions).
revoke select on public.usage_events from authenticated;
grant select (id, company_id, user_id, feature, conversation_id, message_id, provider, model_id, api_model_id, auto_routed,
  input_tokens, output_tokens, cached_input_tokens, tokens_estimated, credits, credit_pool, status, error_code, latency_ms,
  created_at) on public.usage_events to authenticated;
