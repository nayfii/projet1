-- Our console's morning dashboard (founder's request, 2026-11-03): the few numbers to check every day.
-- Aggregates only: no customer content, no person. Demo companies (the version check's) are left out.
create function public.platform_dashboard(p_tz text default 'Europe/Paris') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  v_month timestamptz := date_trunc('month', now() at time zone p_tz) at time zone p_tz;
  v_result jsonb;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  with real_companies as (
    select c.* from public.companies c where not c.is_demo
  ), events as (
    select e.* from public.usage_events e join real_companies c on c.id = e.company_id
    where e.created_at >= least(v_month, v_today - interval '7 days')
  ), seats as (
    select c.id, count(m.*) filter (where m.status = 'active') as active_seats, pl.monthly_price_per_seat as price,
           coalesce(pl.price_currency, 'EUR') as currency
    from real_companies c
    left join public.company_members m on m.company_id = c.id
    left join public.plans pl on pl.id = c.plan_id
    where c.status = 'active'
    group by c.id, pl.monthly_price_per_seat, pl.price_currency
  )
  select jsonb_build_object(
    'companies', jsonb_build_object(
      'active', (select count(*) from real_companies where status = 'active'),
      'suspended', (select count(*) from real_companies where status <> 'active'),
      'new_this_month', (select count(*) from real_companies where created_at >= v_month)
    ),
    'people', jsonb_build_object(
      'seats', (select coalesce(sum(active_seats), 0) from seats),
      'active_today', (select count(distinct user_id) from events where created_at >= v_today),
      'active_7d', (select count(distinct user_id) from events where created_at >= v_today - interval '6 days')
    ),
    'today', (select jsonb_build_object(
      'requests', count(*) filter (where credit_pool = 'standard'),
      'errors', count(*) filter (where credit_pool = 'standard' and status = 'error'),
      'credits', coalesce(sum(credits), 0),
      'cost_usd', coalesce(sum(estimated_cost_usd), 0)
    ) from events where created_at >= v_today),
    'month', (select jsonb_build_object(
      'requests', count(*) filter (where credit_pool = 'standard'),
      'credits', coalesce(sum(credits), 0),
      'cost_usd', coalesce(sum(estimated_cost_usd), 0)
    ) from events where created_at >= v_month),
    -- What the active seats would bring in a month at the plans' prices (an estimate, per currency).
    'revenue_month', (select coalesce(jsonb_object_agg(currency, amount), '{}'::jsonb) from (
      select currency, sum(active_seats * price) as amount from seats where price is not null group by currency
    ) r),
    'near_quota', (select count(*) from public.platform_company_credits() q
                   join real_companies c on c.id = q.company_id
                   where q.credit_limit > 0 and q.credits_used >= 0.8 * q.credit_limit),
    'usd_to_eur', (select usd_to_eur from public.platform_settings limit 1)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.platform_dashboard(text) from public, anon;
grant execute on function public.platform_dashboard(text) to authenticated;
