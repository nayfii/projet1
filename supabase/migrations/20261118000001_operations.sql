-- V1.1 phase 10: operations at a glance for our team (CLAUDE.md §4.9, §12). Counts, codes and times
-- only: never a message, a document, a workflow's data or a name. Additive: one table, one function.

-- When our periodic jobs last ran (the workflows' clock). Written by our server only (service role).
create table public.platform_heartbeats (
  name text primary key check (name ~ '^[a-z][a-z0-9_.-]{0,40}$'),
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
alter table public.platform_heartbeats enable row level security;
-- No policy: nobody signed in reads or writes it directly; our console reads it through the function below.
revoke all on public.platform_heartbeats from anon, authenticated;

-- Workflows, knowledge imports, connected apps and request latencies over the last p_hours, for our
-- team's health page. Platform admins only.
create function public.platform_operations_health(p_hours integer default 24)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then perform private.fail('validation'); end if;
  v_since := now() - make_interval(hours => p_hours);
  return jsonb_build_object(
    'clock', (select jsonb_build_object('at', h.at, 'detail', h.detail) from public.platform_heartbeats h where h.name = 'workflows.tick'),
    'workflows', jsonb_build_object(
      'active', (select count(*) from public.workflows w where w.status = 'active'),
      'queued', (select count(*) from public.workflow_runs r where r.status = 'queued'),
      'waiting', (select count(*) from public.workflow_runs r where r.status = 'waiting'),
      'running', (select count(*) from public.workflow_runs r where r.status = 'running'),
      'stuck', (select count(*) from public.workflow_runs r where r.status = 'running' and r.lease_until < now() - interval '5 minutes'),
      'oldest_queued_at', (select min(r.created_at) from public.workflow_runs r where r.status = 'queued'),
      'succeeded', (select count(*) from public.workflow_runs r where r.status = 'succeeded' and r.created_at >= v_since),
      'failed', (select count(*) from public.workflow_runs r where r.status = 'failed' and r.created_at >= v_since),
      'top_error', (select r.error_code from public.workflow_runs r where r.status = 'failed' and r.created_at >= v_since and r.error_code is not null
                    group by r.error_code order by count(*) desc limit 1)
    ),
    'imports', jsonb_build_object(
      'analyzing', (select count(*) from public.knowledge_imports k where k.status = 'analyzing'),
      'started', (select count(*) from public.knowledge_imports k where k.created_at >= v_since),
      'done', (select count(*) from public.knowledge_imports k where k.status = 'done' and k.created_at >= v_since),
      'stalled', (select count(*) from public.knowledge_imports k where k.status = 'analyzing' and k.updated_at < now() - interval '1 hour')
    ),
    'integrations', coalesce((select jsonb_agg(x order by x.provider) from (
        select c.provider,
          count(*) filter (where c.status = 'active') as active,
          count(*) filter (where c.status in ('expired', 'error')) as needs_reconnect,
          count(*) filter (where c.status = 'revoked') as revoked
        from public.integration_connections c group by c.provider) x), '[]'::jsonb),
    'latency', coalesce((select jsonb_agg(l order by l.feature) from (
        select u.feature,
          count(*) as requests,
          count(*) filter (where u.status <> 'ok') as errors,
          round(percentile_cont(0.5) within group (order by u.latency_ms)::numeric) as p50_ms,
          round(percentile_cont(0.95) within group (order by u.latency_ms)::numeric) as p95_ms
        from public.usage_events u
        where u.created_at >= v_since and u.latency_ms is not null
        group by u.feature) l), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_operations_health(integer) from public, anon;
grant execute on function public.platform_operations_health(integer) to authenticated;

-- Phase 9: opening a conversation reads its sources (Source Proof) by conversation; without this index
-- the whole table was scanned each time.
create index if not exists message_sources_conversation on public.message_sources (conversation_id, position);
