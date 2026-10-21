-- Step 8: video and motion agents, the render worker and its queue (CLAUDE.md §4.7, docs/ARCHITECTURE.md §10).
-- The app reserves video credits and queues a job; the worker (its own container) claims it, renders,
-- uploads the MP4s and reports back. Credits come from a dedicated video quota. No content in logs.

-- ─── Video clips (Video Editor): their own bucket, never sent to an AI provider ──
alter table public.conversation_attachments drop constraint conversation_attachments_kind_check;
alter table public.conversation_attachments
  add constraint conversation_attachments_kind_check check (kind in ('image', 'document', 'video'));
alter table public.conversation_attachments
  add column bucket text not null default 'chat-attachments' check (bucket in ('chat-attachments', 'render-media')),
  -- Duration and size read by the browser before upload (indicative; the worker reads the file itself).
  add column media jsonb check (media is null or jsonb_typeof(media) = 'object');
alter table public.conversation_attachments drop constraint conversation_attachments_size_bytes_check;
alter table public.conversation_attachments
  add constraint conversation_attachments_size_bytes_check
    check (size_bytes >= 1 and size_bytes <= case when kind = 'video' then 209715200 else 20971520 end),
  add constraint conversation_attachments_video_bucket check ((kind = 'video') = (bucket = 'render-media'));
grant insert (bucket, media) on public.conversation_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('render-media', 'render-media', false, 209715200, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create policy render_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'render-media'
    and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))
    and (
      owner_id = (select auth.uid())::text
      or exists (select 1 from public.conversation_attachments a where a.bucket = 'render-media' and a.storage_path = objects.name)
    )
  );
create policy render_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'render-media' and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1])));
-- The uploader removes a clip not sent yet; the person responsible removes everything with the conversation.
create policy render_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'render-media'
    and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))
    and (
      exists (select 1 from public.conversations c where c.id = private.try_uuid((storage.foldername(name))[1]) and c.owner_id = (select auth.uid()))
      or (
        owner_id = (select auth.uid())::text
        and not exists (select 1 from public.conversation_attachments a where a.bucket = 'render-media' and a.storage_path = objects.name and a.message_id is not null)
      )
    )
  );

-- ─── Rates: video credits per second of video produced, set by our team ───────
create table public.render_rates (
  kind text primary key check (kind in ('motion', 'video_edit')),
  credits_per_second numeric(10, 2) not null check (credits_per_second >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- Starting values, changed by the platform admin (Platform → Modèles et tarifs). Not prices.
insert into public.render_rates (kind, credits_per_second) values ('motion', 10), ('video_edit', 4);

alter table public.render_rates enable row level security;
revoke all on public.render_rates from anon;
revoke insert, update, delete, truncate, trigger, references on public.render_rates from authenticated;
create policy render_rates_select on public.render_rates for select to authenticated using (true);

create function public.platform_set_render_rate(p_kind text, p_credits_per_second numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits_per_second is null or p_credits_per_second < 0 or p_credits_per_second > 100000 then perform private.fail('validation'); end if;
  update public.render_rates set credits_per_second = p_credits_per_second, updated_by = (select auth.uid()), updated_at = now()
  where kind = p_kind;
  if not found then perform private.fail('not_found'); end if;
  perform private.log_event('platform', null, 'render.rate_changed', 'render_rate', p_kind,
    jsonb_build_object('credits_per_second', p_credits_per_second));
end;
$$;

-- ─── Render jobs: the queue ───────────────────────────────────────────────────
create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  -- The AI answer holding the composition or the edit plan.
  message_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('motion', 'video_edit')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  -- A short code ("capturing", "encoding"…), never free text.
  stage text check (stage ~ '^[a-z_]{1,40}$'),
  formats text[] not null check (cardinality(formats) between 1 and 3 and formats <@ array['16:9', '9:16', '1:1']),
  duration_seconds numeric(8, 2) not null check (duration_seconds > 0 and duration_seconds <= 600),
  -- The composition or the edit plan, and the attachments it uses ({ "assets": [{ "attachment_id", "name" }] }).
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 400000),
  -- [{ "format", "path", "bytes", "width", "height", "seconds" }] in the render-outputs bucket.
  outputs jsonb not null default '[]' check (jsonb_typeof(outputs) = 'array'),
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  attempts integer not null default 0 check (attempts >= 0),
  locked_by text check (length(locked_by) <= 120),
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  credits_reserved numeric(12, 2) not null check (credits_reserved >= 0),
  credits_charged numeric(12, 2) check (credits_charged >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (conversation_id, company_id) references public.conversations (id, company_id) on delete cascade,
  foreign key (message_id, conversation_id) references public.messages (id, conversation_id) on delete cascade
);
create index render_jobs_queue on public.render_jobs (created_at) where status = 'queued';
create index render_jobs_running on public.render_jobs (heartbeat_at) where status = 'running';
create index render_jobs_message on public.render_jobs (message_id);
create index render_jobs_company on public.render_jobs (company_id, created_at desc);

alter table public.render_jobs enable row level security;
revoke all on public.render_jobs from anon;
revoke insert, update, delete, truncate, trigger, references on public.render_jobs from authenticated;
-- Participants who can see the answer see its renders (from their starting point in a group). Nobody else.
create policy render_jobs_select on public.render_jobs
  for select to authenticated
  using (
    private.can_access_conversation(conversation_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.seq >= private.visible_from_seq(conversation_id)
    )
  );

-- ─── Video credit pool: the plan's video credits plus video grants ─────────────
alter table public.credit_grants add column pool text not null default 'standard' check (pool in ('standard', 'video'));

create or replace function private.quota_status(p_company uuid, p_user uuid)
returns table (period_start timestamptz, company_limit numeric, company_used numeric, user_limit numeric, user_used numeric)
language sql stable security definer set search_path = '' as $$
  with b as (select private.period_start() as start, private.period_start() + interval '1 month' as finish)
  select
    b.start,
    coalesce((select pl.monthly_credits from public.companies c join public.plans pl on pl.id = c.plan_id where c.id = p_company), 0)
      + coalesce((select sum(g.credits) from public.credit_grants g
                  where g.company_id = p_company and g.period_start = b.start and g.pool = 'standard'), 0),
    coalesce((select sum(u.credits) from public.usage_events u
              where u.company_id = p_company and u.credit_pool = 'standard'
                and u.created_at >= b.start and u.created_at < b.finish), 0),
    coalesce(
      (select q.monthly_credits from public.member_quotas q where q.company_id = p_company and q.user_id = p_user),
      (select s.default_user_monthly_credits from public.company_ai_settings s where s.company_id = p_company)),
    coalesce((select sum(u.credits) from public.usage_events u
              where u.company_id = p_company and u.user_id = p_user and u.credit_pool = 'standard'
                and u.created_at >= b.start and u.created_at < b.finish), 0)
  from b;
$$;

-- Video credits this month: limit, used (finished renders) and reserved (renders waiting or running).
create function private.video_quota_status(p_company uuid)
returns table (period_start timestamptz, video_limit numeric, video_used numeric, video_reserved numeric)
language sql stable security definer set search_path = '' as $$
  with b as (select private.period_start() as start, private.period_start() + interval '1 month' as finish)
  select
    b.start,
    coalesce((select pl.video_credits from public.companies c join public.plans pl on pl.id = c.plan_id where c.id = p_company), 0)
      + coalesce((select sum(g.credits) from public.credit_grants g
                  where g.company_id = p_company and g.period_start = b.start and g.pool = 'video'), 0),
    coalesce((select sum(u.credits) from public.usage_events u
              where u.company_id = p_company and u.credit_pool = 'video'
                and u.created_at >= b.start and u.created_at < b.finish), 0),
    coalesce((select sum(j.credits_reserved) from public.render_jobs j
              where j.company_id = p_company and j.status in ('queued', 'running')), 0)
  from b;
$$;

-- Members see their company's video credits (the render button shows what is left).
create function public.my_video_credits(p_company uuid)
returns table (video_limit numeric, video_used numeric, video_reserved numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_company_member(p_company) then perform private.fail('forbidden'); end if;
  return query select q.video_limit, q.video_used, q.video_reserved from private.video_quota_status(p_company) q;
end;
$$;

create or replace function public.platform_grant_credits(p_company uuid, p_credits numeric, p_note text default null, p_pool text default 'standard') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits <= 0 or p_pool not in ('standard', 'video') then perform private.fail('validation'); end if;
  if not exists (select 1 from public.companies where id = p_company) then perform private.fail('not_found'); end if;
  insert into public.credit_grants (company_id, credits, period_start, note, granted_by, pool)
  values (p_company, p_credits, private.period_start(), nullif(trim(p_note), ''), (select auth.uid()), p_pool);
  perform private.log_event('platform', null, 'credits.granted', 'company', p_company::text,
    jsonb_build_object('credits', p_credits, 'pool', p_pool));
end;
$$;
drop function public.platform_grant_credits(uuid, numeric, text);

create or replace function public.platform_company_credits()
returns table (company_id uuid, credit_limit numeric, credits_used numeric, granted numeric, requests bigint, estimated_cost_usd numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select c.id, q.company_limit, q.company_used,
    coalesce((select sum(g.credits) from public.credit_grants g
              where g.company_id = c.id and g.period_start = private.period_start() and g.pool = 'standard'), 0),
    (select count(*) from public.usage_events u where u.company_id = c.id and u.created_at >= private.period_start()),
    coalesce((select sum(u.estimated_cost_usd) from public.usage_events u where u.company_id = c.id and u.created_at >= private.period_start()), 0)
  from public.companies c
  cross join lateral private.quota_status(c.id, null) q;
end;
$$;

create function public.platform_company_video_credits()
returns table (company_id uuid, video_limit numeric, video_used numeric, video_reserved numeric, renders bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select c.id, q.video_limit, q.video_used, q.video_reserved,
    (select count(*) from public.render_jobs j where j.company_id = c.id and j.created_at >= private.period_start())
  from public.companies c
  cross join lateral private.video_quota_status(c.id) q;
end;
$$;

-- Rendered videos: written by the worker only, read by people who can see the job.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('render-outputs', 'render-outputs', false, 524288000, array['video/mp4'])
on conflict (id) do nothing;
create policy render_outputs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'render-outputs'
    and exists (
      select 1 from public.render_jobs j
      where j.id = private.try_uuid((storage.foldername(name))[2])
        and j.conversation_id = private.try_uuid((storage.foldername(name))[1])
    )
  );

create policy render_outputs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'render-outputs'
    and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))
    and exists (select 1 from public.conversations c where c.id = private.try_uuid((storage.foldername(name))[1]) and c.owner_id = (select auth.uid()))
  );

-- Queues a render of an AI answer, reserving video credits. Called by the app with the person's session.
create function public.enqueue_render_job(
  p_message uuid, p_kind text, p_formats text[], p_duration numeric, p_input jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_msg record;
  v_rate numeric;
  v_credits numeric;
  v_quota record;
  v_assets jsonb;
  v_id uuid;
begin
  if v_uid is null then perform private.fail('forbidden'); end if;
  if p_kind not in ('motion', 'video_edit') or p_formats is null or cardinality(p_formats) = 0
     or not (p_formats <@ array['16:9', '9:16', '1:1']) or cardinality(array(select distinct unnest(p_formats))) <> cardinality(p_formats)
     or (p_kind = 'motion' and cardinality(p_formats) <> 1)
     or p_duration is null or p_duration <= 0 or p_duration > (case when p_kind = 'motion' then 60 else 300 end)
     or p_input is null or jsonb_typeof(p_input) <> 'object' or pg_column_size(p_input) > 400000 then
    perform private.fail('validation');
  end if;

  select m.id, m.conversation_id, m.seq, m.author_type, m.status, c.company_id, c.agent_id, a.builtin_key
    into v_msg
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.agents a on a.id = c.agent_id
  where m.id = p_message;
  if v_msg.id is null or not private.can_access_conversation(v_msg.conversation_id)
     or v_msg.seq < private.visible_from_seq(v_msg.conversation_id) then
    perform private.fail('not_found');
  end if;
  if v_msg.author_type <> 'assistant' or v_msg.status <> 'complete' then perform private.fail('validation'); end if;
  -- Only from the conversations of the video agents, while the person may still use them.
  if v_msg.builtin_key is distinct from (case when p_kind = 'motion' then 'motion_design' else 'video_editor' end)
     or not private.can_use_agent(v_msg.agent_id, v_msg.company_id) then
    perform private.fail('forbidden');
  end if;

  -- Every file the render uses must be an attachment of this conversation the person can see.
  v_assets := coalesce(p_input -> 'assets', '[]'::jsonb);
  if jsonb_typeof(v_assets) <> 'array' or jsonb_array_length(v_assets) > 10 then perform private.fail('validation'); end if;
  if exists (
    select 1 from jsonb_array_elements(v_assets) e
    where private.try_uuid(e ->> 'attachment_id') is null
       or not exists (
         select 1 from public.conversation_attachments at
         left join public.messages am on am.id = at.message_id
         where at.id = private.try_uuid(e ->> 'attachment_id')
           and at.conversation_id = v_msg.conversation_id
           and ((at.message_id is null and at.uploaded_by = v_uid)
                or am.seq >= private.visible_from_seq(v_msg.conversation_id))
       )
  ) then
    perform private.fail('validation');
  end if;

  select credits_per_second into v_rate from public.render_rates where kind = p_kind;
  v_credits := ceil(coalesce(v_rate, 0) * p_duration * cardinality(p_formats));

  -- One reservation at a time per company, so two renders cannot both use the last credits.
  perform 1 from public.companies where id = v_msg.company_id for update;
  if exists (
    select 1 from public.render_jobs
    where message_id = p_message and kind = p_kind and status in ('queued', 'running') and formats = p_formats
  ) then
    perform private.fail('render_in_progress');
  end if;
  select * into v_quota from private.video_quota_status(v_msg.company_id);
  -- The refusal is written to the activity log by the app (an error here would undo the entry).
  if v_quota.video_used + v_quota.video_reserved + v_credits > v_quota.video_limit then
    perform private.fail('video_quota_exceeded');
  end if;

  insert into public.render_jobs (company_id, conversation_id, message_id, created_by, kind, formats, duration_seconds, input, credits_reserved)
  values (v_msg.company_id, v_msg.conversation_id, p_message, v_uid, p_kind, p_formats, p_duration, p_input, v_credits)
  returning id into v_id;
  perform private.log_event('company', v_msg.company_id, 'render.requested', 'render_job', v_id::text,
    jsonb_build_object('kind', p_kind, 'formats', to_jsonb(p_formats), 'seconds', p_duration, 'credits', v_credits));
  return v_id;
end;
$$;

-- The person who asked for a render can cancel it; its reserved credits are released.
create function public.cancel_render_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
begin
  select * into v_job from public.render_jobs where id = p_job for update;
  if v_job.id is null or v_job.created_by is distinct from (select auth.uid())
     or not private.can_access_conversation(v_job.conversation_id) then
    perform private.fail('not_found');
  end if;
  if v_job.status = 'queued' then
    update public.render_jobs set status = 'cancelled', finished_at = now() where id = p_job;
  elsif v_job.status = 'running' then
    update public.render_jobs set cancel_requested_at = now() where id = p_job;
  end if;
end;
$$;

-- ─── Worker functions (service role only: the render worker) ─────────────────
-- Re-queues jobs whose worker went silent, then claims the oldest waiting job.
create function public.render_claim_job(p_worker text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs;
begin
  if p_worker is null or length(p_worker) not between 1 and 120 then perform private.fail('validation'); end if;
  update public.render_jobs
  set status = case when attempts >= 3 or cancel_requested_at is not null then (case when cancel_requested_at is not null then 'cancelled' else 'failed' end) else 'queued' end,
      error_code = case when attempts >= 3 and cancel_requested_at is null then 'worker_lost' else error_code end,
      finished_at = case when attempts >= 3 or cancel_requested_at is not null then now() else null end,
      locked_by = null
  where status = 'running' and heartbeat_at < now() - interval '3 minutes';

  select * into v_job from public.render_jobs
  where status = 'queued'
  order by created_at
  limit 1
  for update skip locked;
  if v_job.id is null then return null; end if;

  update public.render_jobs
  set status = 'running', attempts = attempts + 1, locked_by = p_worker, heartbeat_at = now(),
      started_at = coalesce(started_at, now()), progress = 0, stage = 'starting', error_code = null
  where id = v_job.id
  returning * into v_job;

  -- The files are resolved here, inside the job's own conversation: the worker never takes a path from the input.
  return jsonb_build_object(
    'id', v_job.id, 'company_id', v_job.company_id, 'conversation_id', v_job.conversation_id, 'kind', v_job.kind,
    'formats', to_jsonb(v_job.formats), 'duration_seconds', v_job.duration_seconds, 'input', v_job.input,
    'attempts', v_job.attempts,
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object('attachment_id', a.id, 'name', e ->> 'name', 'bucket', a.bucket,
                                          'storage_path', a.storage_path, 'kind', a.kind, 'mime_type', a.mime_type))
      from jsonb_array_elements(coalesce(v_job.input -> 'assets', '[]'::jsonb)) e
      join public.conversation_attachments a
        on a.id = private.try_uuid(e ->> 'attachment_id') and a.conversation_id = v_job.conversation_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Heartbeat and progress. Returns false when the worker must stop (cancelled, or the job is no longer its own).
create function public.render_job_progress(p_job uuid, p_worker text, p_progress numeric, p_stage text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_cancel timestamptz;
begin
  update public.render_jobs
  set heartbeat_at = now(), progress = least(greatest(coalesce(p_progress, 0), 0), 99),
      stage = case when p_stage ~ '^[a-z_]{1,40}$' then p_stage else stage end
  where id = p_job and status = 'running' and locked_by = p_worker
  returning cancel_requested_at into v_cancel;
  if not found then return false; end if;
  return v_cancel is null;
end;
$$;

-- A finished render: outputs saved, credits charged for the seconds produced (never more than reserved).
create function public.render_job_succeeded(p_job uuid, p_worker text, p_outputs jsonb, p_seconds numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs;
  v_rate numeric;
  v_credits numeric;
begin
  select * into v_job from public.render_jobs where id = p_job and status = 'running' and locked_by = p_worker for update;
  if v_job.id is null then perform private.fail('not_found'); end if;
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) = 0
     or p_seconds is null or p_seconds <= 0 then
    perform private.fail('validation');
  end if;
  -- Output paths stay inside the job's own folder.
  if exists (select 1 from jsonb_array_elements(p_outputs) o
             where (o ->> 'path') not like v_job.conversation_id::text || '/' || v_job.id::text || '/%') then
    perform private.fail('validation');
  end if;
  select credits_per_second into v_rate from public.render_rates where kind = v_job.kind;
  v_credits := least(v_job.credits_reserved, ceil(coalesce(v_rate, 0) * p_seconds * cardinality(v_job.formats)));
  update public.render_jobs
  set status = 'succeeded', progress = 100, stage = 'done', outputs = p_outputs, credits_charged = v_credits,
      finished_at = now(), heartbeat_at = now()
  where id = p_job;
  insert into public.usage_events (company_id, user_id, feature, conversation_id, message_id, credits, credit_pool, status, latency_ms)
  values (v_job.company_id, v_job.created_by, 'render', v_job.conversation_id, v_job.message_id, v_credits, 'video', 'ok',
          (extract(epoch from (now() - v_job.started_at)) * 1000)::integer);
  insert into public.audit_log (scope, company_id, actor_id, action, target_type, target_id, metadata)
  values ('company', v_job.company_id, null, 'render.completed', 'render_job', v_job.id::text,
          jsonb_build_object('kind', v_job.kind, 'seconds', p_seconds, 'credits', v_credits));
end;
$$;

-- A failed render: retried when the failure may be temporary, otherwise stopped; reserved credits are released.
create function public.render_job_failed(p_job uuid, p_worker text, p_error text, p_retry boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs;
  v_error text := case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'render_failed' end;
begin
  select * into v_job from public.render_jobs where id = p_job and status = 'running' and locked_by = p_worker for update;
  if v_job.id is null then return; end if;
  if v_job.cancel_requested_at is not null then
    update public.render_jobs set status = 'cancelled', finished_at = now(), locked_by = null where id = p_job;
  elsif coalesce(p_retry, false) and v_job.attempts < 3 then
    update public.render_jobs set status = 'queued', locked_by = null, error_code = v_error, progress = 0, stage = null where id = p_job;
  else
    update public.render_jobs set status = 'failed', error_code = v_error, finished_at = now(), locked_by = null where id = p_job;
    insert into public.audit_log (scope, company_id, actor_id, action, target_type, target_id, metadata)
    values ('company', v_job.company_id, null, 'render.failed', 'render_job', v_job.id::text,
            jsonb_build_object('kind', v_job.kind, 'error', v_error));
  end if;
end;
$$;

-- RPC exposure: the queue functions for the worker only; the rest for signed-in people (they check rights).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.render_claim_job(text), public.render_job_progress(uuid, text, numeric, text),
  public.render_job_succeeded(uuid, text, jsonb, numeric), public.render_job_failed(uuid, text, text, boolean)
  from authenticated;
grant execute on all functions in schema private to authenticated, service_role;
