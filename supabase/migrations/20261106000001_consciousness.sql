-- Cendr Consciousness: one living memory shared across models (docs/CONSCIOUSNESS.md).
--
-- * Memory entries become versioned facts: a kind, a subject key, a status (active or superseded), the
--   entry that replaced them, confidence, effective and expiry dates, structured attributes. Superseded
--   and expired facts are kept as history but never given to a model.
-- * Learning jobs: after an answer in a conversation linked to a client, our server extracts the
--   facts (one idempotent job per answer, retried, run with the asker's own session and rights). The
--   chat shows the job's real state; anyone can forget what a job learned.
-- * A message can be excluded from learning by its author.
-- * Temporary access to a restricted client (assignments that expire), and access requests decided by
--   someone who may grant that client (Owner, Admins with the clients scope, the requester's manager).
-- * Provider restrictions per memory: a memory can be kept away from some AI providers.
-- * client_permissions(): the granular rights of the caller on a client, for the interface.

-- ─── Versioned facts ─────────────────────────────────────────────────────────
alter table public.memory_entries
  add column kind text not null default 'note'
    check (kind in ('fact', 'decision', 'commitment', 'preference', 'contact', 'procedure', 'note')),
  -- What the fact is about, normalised by our server (e.g. "budget", "launch_date", "contact:jean_dupont").
  -- Two active facts with the same key in one memory are a conflict; a newer one supersedes the older.
  add column subject_key text check (length(subject_key) between 1 and 120),
  add column status text not null default 'active' check (status in ('active', 'superseded')),
  add column superseded_by uuid references public.memory_entries (id) on delete set null,
  add column superseded_at timestamptz,
  add column confidence real check (confidence between 0 and 1),
  -- When the fact became true (a decision's date) and when it stops being true (an offer's end).
  add column effective_at timestamptz,
  add column expires_at timestamptz,
  -- Last time the same fact was stated again (a duplicate confirms instead of adding a copy).
  add column confirmed_at timestamptz,
  -- Structured values: amount, currency, date, person, role, owner, due date…
  add column attributes jsonb not null default '{}'
    check (jsonb_typeof(attributes) = 'object' and length(attributes::text) <= 4000);

create index memory_entries_brief on public.memory_entries (space_id, status, kind, updated_at desc);
create index memory_entries_subject on public.memory_entries (space_id, subject_key) where status = 'active' and subject_key is not null;

alter table public.memory_entries drop constraint memory_entries_source_type_check;
alter table public.memory_entries add constraint memory_entries_source_type_check
  check (source_type in ('manual', 'chat', 'ai_suggestion', 'promotion', 'auto', 'correction'));

grant insert (kind, subject_key, confidence, effective_at, expires_at, attributes) on public.memory_entries to authenticated;
grant update (kind, effective_at, expires_at, attributes, confirmed_at) on public.memory_entries to authenticated;

-- Deleting a fact that replaced another (Undo, Forget) brings the previous version back.
create function private.memory_entries_restore_previous() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.memory_entries
     set status = 'active', superseded_by = null, superseded_at = null
   where superseded_by = old.id and status = 'superseded';
  return old;
end;
$$;
create trigger memory_entries_restore_previous before delete on public.memory_entries
  for each row execute function private.memory_entries_restore_previous();

-- A newer fact replaces an older one in the same memory. History is kept: the older one stays,
-- marked superseded, with a link to its replacement.
create function private.supersede_entry(p_old uuid, p_new uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.memory_entries;
  v_new public.memory_entries;
begin
  -- Locked: two learnings at the same moment cannot both replace the same fact.
  select * into v_old from public.memory_entries where id = p_old for update;
  select * into v_new from public.memory_entries where id = p_new;
  if v_old.id is null or v_new.id is null or v_old.id = v_new.id or v_old.space_id <> v_new.space_id
     or not private.can_write_space(v_old.space_id) then
    perform private.fail('not_found');
  end if;
  if v_old.status <> 'active' or v_new.status <> 'active' then perform private.fail('validation'); end if;
  update public.memory_entries set status = 'superseded', superseded_by = v_new.id, superseded_at = now() where id = v_old.id;
  perform private.log_event('company', v_old.company_id, 'memory.entry_superseded', 'memory_space', v_old.space_id::text,
    jsonb_build_object('source_type', v_new.source_type));
end;
$$;

create function public.supersede_memory_entry(p_old uuid, p_new uuid) returns void
language sql security definer set search_path = '' as $$
  select private.supersede_entry(p_old, p_new);
$$;

-- "Correct": a person who may write the memory writes the right version; the wrong one stays as history.
create function public.correct_memory_entry(p_entry uuid, p_title text, p_content text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.memory_entries;
  v_new uuid;
begin
  select * into v_old from public.memory_entries where id = p_entry;
  if v_old.id is null or not private.can_write_space(v_old.space_id) then perform private.fail('not_found'); end if;
  if v_old.status <> 'active' then perform private.fail('validation'); end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 200 or length(trim(coalesce(p_content, ''))) not between 1 and 20000 then
    perform private.fail('validation');
  end if;
  insert into public.memory_entries (space_id, title, content, source_type, source_ref, author_id, kind, subject_key, attributes, effective_at)
  values (v_old.space_id, trim(p_title), trim(p_content), 'correction', jsonb_build_object('corrects', v_old.id),
          (select auth.uid()), v_old.kind, v_old.subject_key, '{}', now())
  returning id into v_new;
  perform private.supersede_entry(v_old.id, v_new);
  return v_new;
end;
$$;

-- ─── Review queue: what the AI was not sure about ────────────────────────────
-- An assistant's own claim, or a fact that contradicts another, is proposed to the person instead of
-- being learned. Approving it creates the fact (and replaces the older one with the same subject).
alter table public.memory_suggestions
  add column fact_kind text check (fact_kind in ('fact', 'decision', 'commitment', 'preference', 'contact', 'procedure', 'note')),
  add column subject_key text check (length(subject_key) between 1 and 120),
  add column attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object' and length(attributes::text) <= 4000),
  add column reason text check (reason in ('assistant_claim', 'conflict', 'uncertain'));
grant insert (fact_kind, subject_key, attributes, reason) on public.memory_suggestions to authenticated;

create or replace function public.decide_memory_suggestion(p_suggestion uuid, p_approve boolean, p_title text default null, p_content text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.memory_suggestions;
  v_entry uuid;
  v_previous uuid;
begin
  select * into v_s from public.memory_suggestions where id = p_suggestion;
  if v_s.id is null or not private.can_write_space(v_s.space_id) then perform private.fail('forbidden'); end if;
  if v_s.status <> 'pending' then perform private.fail('already_decided'); end if;
  -- AI suggestions from a conversation are approved by the person who asked for them (never seen by others before).
  if v_s.kind = 'new_entry' and v_s.proposed_by is distinct from (select auth.uid()) then perform private.fail('forbidden'); end if;
  if not p_approve then
    update public.memory_suggestions set status = 'rejected', decided_by = (select auth.uid()), decided_at = now() where id = v_s.id;
    perform private.log_event('company', v_s.company_id, 'memory.suggestion_rejected', 'memory_space', v_s.space_id::text,
      jsonb_build_object('kind', v_s.kind));
    return null;
  end if;
  insert into public.memory_entries (space_id, title, content, source_type, source_ref, author_id, kind, subject_key, attributes)
  values (
    v_s.space_id,
    coalesce(nullif(trim(p_title), ''), v_s.title),
    coalesce(nullif(trim(p_content), ''), v_s.content),
    case v_s.kind when 'promotion' then 'promotion' else 'ai_suggestion' end,
    v_s.source_ref || jsonb_build_object('suggestion_id', v_s.id, 'proposed_by', v_s.proposed_by),
    (select auth.uid()),
    coalesce(v_s.fact_kind, 'note'),
    v_s.subject_key,
    v_s.attributes
  )
  returning id into v_entry;
  if v_s.subject_key is not null then
    select id into v_previous from public.memory_entries
     where space_id = v_s.space_id and subject_key = v_s.subject_key and status = 'active' and id <> v_entry
     order by coalesce(effective_at, created_at) desc limit 1;
    if v_previous is not null then perform private.supersede_entry(v_previous, v_entry); end if;
  end if;
  update public.memory_suggestions
     set status = 'approved', decided_by = (select auth.uid()), decided_at = now(), entry_id = v_entry
   where id = v_s.id;
  perform private.log_event('company', v_s.company_id, 'memory.suggestion_approved', 'memory_space', v_s.space_id::text,
    jsonb_build_object('kind', v_s.kind));
  return v_entry;
end;
$$;

-- ─── Retrieval: only current facts ───────────────────────────────────────────
create or replace function public.match_memory(
  p_space_ids uuid[],
  p_keywords text,
  p_embedding extensions.vector(1536) default null,
  p_limit integer default 6,
  p_min_similarity double precision default 0.25,
  p_embedding_model text default null
)
returns table (
  source_type text, id uuid, document_id uuid, space_id uuid, title text, content text,
  page integer, char_start integer, char_end integer, source_date timestamptz, score double precision
)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('simple', private.unaccent_immutable(coalesce(p_keywords, ''))) as tsq,
           greatest(coalesce(p_limit, 6), 1) * 4 as pool
  ),
  by_meaning as (
    select hit.id, row_number() over (order by hit.distance) as rank
    from (
      (select ch.id, ch.embedding operator(extensions.<=>) p_embedding as distance
       from public.document_chunks ch
       where p_embedding is not null and ch.space_id = any (p_space_ids) and ch.embedding is not null
         and (p_embedding_model is null or ch.embedding_model = p_embedding_model)
       order by distance limit (select pool from q))
      union all
      (select e.id, e.embedding operator(extensions.<=>) p_embedding
       from public.memory_entries e
       where p_embedding is not null and e.space_id = any (p_space_ids) and e.embedding is not null
         and e.status = 'active' and (e.expires_at is null or e.expires_at > now())
         and (p_embedding_model is null or e.embedding_model = p_embedding_model)
       order by 2 limit (select pool from q))
    ) hit
    where 1 - hit.distance >= p_min_similarity
  ),
  by_words as (
    select hit.id, row_number() over (order by hit.rank_value desc) as rank
    from (
      (select ch.id, ts_rank(to_tsvector('simple', private.unaccent_immutable(ch.content)), q.tsq) as rank_value
       from public.document_chunks ch, q
       where ch.space_id = any (p_space_ids)
         and to_tsvector('simple', private.unaccent_immutable(ch.content)) @@ q.tsq
       order by rank_value desc limit (select pool from q))
      union all
      (select e.id, ts_rank(to_tsvector('simple', private.unaccent_immutable(e.title || ' ' || e.content)), q.tsq)
       from public.memory_entries e, q
       where e.space_id = any (p_space_ids)
         and e.status = 'active' and (e.expires_at is null or e.expires_at > now())
         and to_tsvector('simple', private.unaccent_immutable(e.title || ' ' || e.content)) @@ q.tsq
       order by 2 desc limit (select pool from q))
    ) hit
  ),
  fused as (
    select r.id, sum(1.0 / (60 + r.rank)) as score
    from (select id, rank from by_meaning union all select id, rank from by_words) r
    group by r.id
  )
  select * from (
    select 'document_chunk'::text, ch.id, ch.document_id, ch.space_id, d.filename, ch.content, ch.page,
           ch.char_start, ch.char_end, d.created_at, f.score::double precision
    from fused f
    join public.document_chunks ch on ch.id = f.id
    join public.documents d on d.id = ch.document_id and d.status = 'ready'
    union all
    select 'memory_entry', e.id, null::uuid, e.space_id, e.title, e.content, null::integer, null::integer, null::integer,
           coalesce(e.effective_at, e.updated_at), f.score::double precision
    from fused f
    join public.memory_entries e on e.id = f.id
  ) results
  order by 11 desc
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

-- ─── Provider restrictions per memory ────────────────────────────────────────
-- A person may read a memory in Cendr and still be forbidden to send it to a given AI provider.
alter table public.memory_spaces add column blocked_providers public.ai_provider[] not null default '{}';

create function public.set_memory_provider_policy(p_space uuid, p_blocked public.ai_provider[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.memory_spaces where id = p_space;
  if v_company is null or not private.has_admin_scope(v_company, 'permissions') then perform private.fail('forbidden'); end if;
  update public.memory_spaces set blocked_providers = coalesce(p_blocked, '{}') where id = p_space;
  perform private.log_event('company', v_company, 'memory.provider_policy', 'memory_space', p_space::text,
    jsonb_build_object('blocked', coalesce(p_blocked, '{}')));
end;
$$;

drop function public.my_memory_spaces(uuid);
create function public.my_memory_spaces(p_company uuid)
returns table (space_id uuid, kind public.memory_kind, client_id uuid, can_write boolean, entry_count bigint, document_count bigint,
               blocked_providers public.ai_provider[])
language sql stable security definer set search_path = '' as $$
  select s.id, s.kind, s.client_id, private.can_write_space(s.id),
    (select count(*) from public.memory_entries e where e.space_id = s.id and e.status = 'active'),
    (select count(*) from public.documents d where d.space_id = s.id),
    s.blocked_providers
  from public.memory_spaces s
  where s.company_id = p_company and private.can_read_space(s.id);
$$;

-- ─── Excluding a message from learning ───────────────────────────────────────
alter table public.messages add column no_memory boolean not null default false;

create function public.set_message_learning(p_message uuid, p_learn boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set no_memory = not p_learn
   where id = p_message and author_type = 'user' and author_id = (select auth.uid())
     and private.can_access_conversation(conversation_id);
  if not found then perform private.fail('not_found'); end if;
end;
$$;

-- ─── Learning jobs ───────────────────────────────────────────────────────────
create table public.memory_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  -- The answer the exchange ends with: one job per answer, whatever retries or double clicks happen.
  message_id uuid not null unique,
  -- Whose session runs the job (their rights decide what may be written).
  user_id uuid not null references public.profiles (id) on delete cascade,
  space_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'skipped', 'failed')),
  attempts smallint not null default 0,
  locked_at timestamptz,
  -- Outcome (counts and ids only, never content).
  learned integer not null default 0,
  confirmed integer not null default 0,
  superseded integer not null default 0,
  proposed integer not null default 0,
  kept_private integer not null default 0,
  entry_ids uuid[] not null default '{}',
  error_code text check (length(error_code) <= 60),
  forgotten_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (message_id, conversation_id) references public.messages (id, conversation_id) on delete cascade,
  foreign key (space_id, company_id) references public.memory_spaces (id, company_id) on delete cascade
);
create index memory_jobs_pending on public.memory_jobs (space_id, created_at) where status in ('queued', 'running');
create index memory_jobs_user on public.memory_jobs (user_id, created_at desc);
create index memory_jobs_conversation on public.memory_jobs (conversation_id);

alter table public.memory_jobs enable row level security;
revoke all on public.memory_jobs from anon;
revoke insert, update, delete, truncate, trigger, references on public.memory_jobs from authenticated;
create policy memory_jobs_select on public.memory_jobs
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_access_conversation(conversation_id));

-- Queues the learning for an answer when everything allows it: a conversation linked to a client,
-- learning on for it and for the company, the caller may write the client's memory, the question
-- was not excluded. Returns the job (existing or new), or null when nothing is to be learned.
create function public.enqueue_memory_job(p_message uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_space uuid;
  v_excluded boolean;
  v_job uuid;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.id is null or not private.can_access_conversation(v_msg.conversation_id) then perform private.fail('not_found'); end if;
  if v_msg.author_type <> 'assistant' or v_msg.status <> 'complete' or v_msg.superseded_at is not null then return null; end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.client_id is null or not v_conv.feed_memory then return null; end if;
  if exists (select 1 from public.company_ai_settings s where s.company_id = v_conv.company_id and not s.auto_client_memory) then
    return null;
  end if;
  select id into v_space from public.memory_spaces where client_id = v_conv.client_id;
  if v_space is null or not private.can_write_space(v_space) then return null; end if;
  select m.no_memory into v_excluded from public.messages m
   where m.conversation_id = v_msg.conversation_id and m.author_type = 'user' and m.seq < v_msg.seq and m.superseded_at is null
   order by m.seq desc limit 1;
  if coalesce(v_excluded, true) then return null; end if;
  insert into public.memory_jobs (company_id, conversation_id, message_id, user_id, space_id)
  values (v_conv.company_id, v_conv.id, v_msg.id, (select auth.uid()), v_space)
  on conflict (message_id) do nothing
  returning id into v_job;
  if v_job is null then select id into v_job from public.memory_jobs where message_id = p_message; end if;
  return v_job;
end;
$$;

-- Takes a job to run it (its own owner only). A job that stopped mid-way (server restart) is taken
-- again after two minutes; three attempts at most.
create function public.claim_memory_job(p_job uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.memory_jobs
     set status = 'running', locked_at = now(), attempts = attempts + 1, error_code = null
   where id = p_job and user_id = (select auth.uid()) and attempts < 3
     and (status in ('queued', 'failed') or (status = 'running' and locked_at < now() - interval '2 minutes'));
  return found;
end;
$$;

create function public.finish_memory_job(
  p_job uuid, p_status text, p_learned integer default 0, p_confirmed integer default 0, p_superseded integer default 0,
  p_proposed integer default 0, p_private integer default 0, p_entries uuid[] default '{}', p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.memory_jobs;
begin
  if p_status not in ('done', 'skipped', 'failed') then perform private.fail('validation'); end if;
  update public.memory_jobs
     set status = p_status, learned = greatest(p_learned, 0), confirmed = greatest(p_confirmed, 0),
         superseded = greatest(p_superseded, 0), proposed = greatest(p_proposed, 0), kept_private = greatest(p_private, 0),
         -- Only entries of this job's memory are recorded.
         entry_ids = coalesce(array(select e.id from public.memory_entries e where e.id = any (coalesce(p_entries, '{}')) and e.space_id = memory_jobs.space_id), '{}'),
         error_code = left(p_error, 60), finished_at = now(), locked_at = null
   where id = p_job and user_id = (select auth.uid()) and status = 'running'
   returning * into v_job;
  if v_job.id is null then perform private.fail('not_found'); end if;
  if p_status = 'done' and (v_job.learned > 0 or v_job.superseded > 0) then
    perform private.log_event('company', v_job.company_id, 'memory.learned', 'memory_space', v_job.space_id::text,
      jsonb_build_object('learned', v_job.learned, 'superseded', v_job.superseded, 'proposed', v_job.proposed));
  end if;
end;
$$;

-- "Forget": the facts a job learned are deleted (previous versions come back). Anyone who may
-- write that memory and see the conversation can do it.
create function public.forget_memory_job(p_job uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.memory_jobs;
  v_count integer;
begin
  select * into v_job from public.memory_jobs where id = p_job;
  if v_job.id is null or not private.can_access_conversation(v_job.conversation_id) or not private.can_write_space(v_job.space_id) then
    perform private.fail('not_found');
  end if;
  delete from public.memory_entries where id = any (v_job.entry_ids) and space_id = v_job.space_id and source_type = 'auto';
  get diagnostics v_count = row_count;
  update public.memory_jobs set forgotten_at = now() where id = v_job.id;
  perform private.log_event('company', v_job.company_id, 'memory.forgotten', 'memory_space', v_job.space_id::text,
    jsonb_build_object('entries', v_count));
  return v_count;
end;
$$;

-- Learning still running in memories the caller can read (counts only): a new conversation waits a
-- moment for it, so a fact told to one model a few seconds ago reaches the next one.
-- The conversation being answered is left out: its own history already holds what was said.
create function public.pending_memory_jobs(p_spaces uuid[], p_except_conversation uuid default null) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.memory_jobs j
  where j.space_id = any (coalesce(p_spaces, '{}')) and j.status in ('queued', 'running')
    and j.created_at > now() - interval '3 minutes' and private.can_read_space(j.space_id)
    and (p_except_conversation is null or j.conversation_id <> p_except_conversation);
$$;

-- ─── Temporary access to a restricted client ─────────────────────────────────
alter table public.client_assignments
  add column expires_at timestamptz,
  add column reason text check (length(reason) <= 300);
grant insert (expires_at, reason) on public.client_assignments to authenticated;

create or replace function private.has_client_access(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.clients cl
    join public.company_members m on m.company_id = cl.company_id
    join public.companies c on c.id = cl.company_id
    where cl.id = p_client
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and c.status = 'active'
      and (
        m.role = 'owner'
        or cl.visibility = 'open'
        or exists (
          select 1 from public.client_assignments a
          where a.client_id = cl.id and a.user_id = m.user_id and (a.expires_at is null or a.expires_at > now())
        )
      )
  );
$$;

create or replace function private.user_has_client_access(p_client uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.clients cl
    join public.company_members m on m.company_id = cl.company_id
    join public.companies c on c.id = cl.company_id
    where cl.id = p_client and m.user_id = p_user and m.status = 'active' and c.status = 'active'
      and (m.role = 'owner' or cl.visibility = 'open'
           or exists (select 1 from public.client_assignments a
                      where a.client_id = cl.id and a.user_id = m.user_id and (a.expires_at is null or a.expires_at > now())))
  );
$$;

-- Who may give someone access to a client: the Owner, Admins with the clients scope, or the person's
-- manager when the manager can open that client.
create function private.can_grant_client(p_client uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients cl
    where cl.id = p_client
      and (private.has_admin_scope(cl.company_id, 'clients')
           or (private.manages_member(cl.company_id, p_user) and private.has_client_access(cl.id)))
  );
$$;

create table public.client_access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  client_id uuid not null,
  requester_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text check (length(reason) <= 300),
  -- Asked duration in days; null = no end date.
  duration_days integer check (duration_days between 1 and 365),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (company_id, requester_id) references public.company_members (company_id, user_id) on delete cascade
);
create unique index client_access_requests_one_pending on public.client_access_requests (client_id, requester_id) where status = 'pending';
create index client_access_requests_company on public.client_access_requests (company_id, status, created_at desc);

alter table public.client_access_requests enable row level security;
revoke all on public.client_access_requests from anon;
revoke insert, update, delete, truncate, trigger, references on public.client_access_requests from authenticated;
-- The requester sees their own requests (the client's name only once they may open it); deciders
-- see the requests they may decide.
create policy client_access_requests_select on public.client_access_requests
  for select to authenticated
  using (
    (requester_id = (select auth.uid()) and private.is_company_member(company_id))
    or private.can_grant_client(client_id, requester_id)
  );

-- One click from a link to a client someone cannot open. Reveals nothing about the client: an unknown
-- id and a client of another company give the same answer as a real one.
create function public.request_client_access(p_client uuid, p_reason text default null, p_days integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.clients where id = p_client and archived_at is null;
  if v_company is null or not private.is_company_member(v_company) then return; end if;
  if private.has_client_access(p_client) then return; end if;
  if p_days is not null and p_days not between 1 and 365 then perform private.fail('validation'); end if;
  insert into public.client_access_requests (company_id, client_id, requester_id, reason, duration_days)
  values (v_company, p_client, (select auth.uid()), nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_days)
  on conflict do nothing;
  perform private.log_event('company', v_company, 'client.access_requested', 'client', p_client::text);
end;
$$;

-- Approve (for the asked duration, or another one) or deny.
create function public.decide_client_access(p_request uuid, p_approve boolean, p_days integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.client_access_requests;
  v_days integer;
  v_expires timestamptz;
begin
  select * into v_r from public.client_access_requests where id = p_request;
  if v_r.id is null or not private.can_grant_client(v_r.client_id, v_r.requester_id) then perform private.fail('not_found'); end if;
  if v_r.status <> 'pending' then perform private.fail('already_decided'); end if;
  if not p_approve then
    update public.client_access_requests set status = 'denied', decided_by = (select auth.uid()), decided_at = now() where id = v_r.id;
    perform private.log_event('company', v_r.company_id, 'client.access_denied', 'client', v_r.client_id::text,
      jsonb_build_object('user_id', v_r.requester_id));
    return;
  end if;
  v_days := coalesce(p_days, v_r.duration_days);
  if v_days is not null and v_days not between 1 and 365 then perform private.fail('validation'); end if;
  v_expires := case when v_days is null then null else now() + make_interval(days => v_days) end;
  insert into public.client_assignments (client_id, company_id, user_id, assigned_by, expires_at, reason)
  values (v_r.client_id, v_r.company_id, v_r.requester_id, (select auth.uid()), v_expires, v_r.reason)
  on conflict (client_id, user_id) do update
    set expires_at = case when public.client_assignments.expires_at is null then null else excluded.expires_at end,
        assigned_by = excluded.assigned_by;
  update public.client_access_requests
     set status = 'approved', decided_by = (select auth.uid()), decided_at = now(), expires_at = v_expires
   where id = v_r.id;
  perform private.log_event('company', v_r.company_id, 'client.access_granted', 'client', v_r.client_id::text,
    jsonb_build_object('user_id', v_r.requester_id, 'days', v_days));
end;
$$;

create function public.cancel_client_access_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.client_access_requests set status = 'cancelled'
   where id = p_request and requester_id = (select auth.uid()) and status = 'pending';
  if not found then perform private.fail('not_found'); end if;
end;
$$;

-- ─── Rights on a client, for the interface ───────────────────────────────────
-- One place answers "what may I do with this client": the same predicates as the database policies.
-- Null when the caller cannot open the client (nothing about its existence is revealed).
create function public.client_permissions(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not private.has_client_access(cl.id) then null else jsonb_build_object(
    'view', true,
    'read_memory', private.can_read_space(s.id),
    'contribute', private.can_write_space(s.id),
    'manage', private.has_admin_scope(cl.company_id, 'clients') or (private.is_manager(cl.company_id)),
    'archive', private.has_admin_scope(cl.company_id, 'clients') or (private.is_manager(cl.company_id)),
    'delete', private.is_company_owner(cl.company_id),
    'grant', private.has_admin_scope(cl.company_id, 'clients') or private.is_manager(cl.company_id),
    'temporary_until', (select a.expires_at from public.client_assignments a
                        where a.client_id = cl.id and a.user_id = (select auth.uid()) and a.expires_at is not null)
  ) end
  from public.clients cl
  left join public.memory_spaces s on s.client_id = cl.id
  where cl.id = p_client;
$$;

-- ─── Function rights ─────────────────────────────────────────────────────────
revoke execute on function private.memory_entries_restore_previous(), private.supersede_entry(uuid, uuid),
  private.can_grant_client(uuid, uuid) from public, anon;
grant execute on function private.supersede_entry(uuid, uuid), private.can_grant_client(uuid, uuid) to authenticated, service_role;

revoke execute on function public.supersede_memory_entry(uuid, uuid), public.correct_memory_entry(uuid, text, text),
  public.set_memory_provider_policy(uuid, public.ai_provider[]), public.my_memory_spaces(uuid),
  public.set_message_learning(uuid, boolean), public.enqueue_memory_job(uuid), public.claim_memory_job(uuid),
  public.finish_memory_job(uuid, text, integer, integer, integer, integer, integer, uuid[], text),
  public.forget_memory_job(uuid), public.pending_memory_jobs(uuid[], uuid),
  public.request_client_access(uuid, text, integer), public.decide_client_access(uuid, boolean, integer),
  public.cancel_client_access_request(uuid), public.client_permissions(uuid) from public, anon;
grant execute on function public.supersede_memory_entry(uuid, uuid), public.correct_memory_entry(uuid, text, text),
  public.set_memory_provider_policy(uuid, public.ai_provider[]), public.my_memory_spaces(uuid),
  public.set_message_learning(uuid, boolean), public.enqueue_memory_job(uuid), public.claim_memory_job(uuid),
  public.finish_memory_job(uuid, text, integer, integer, integer, integer, integer, uuid[], text),
  public.forget_memory_job(uuid), public.pending_memory_jobs(uuid[], uuid),
  public.request_client_access(uuid, text, integer), public.decide_client_access(uuid, boolean, integer),
  public.cancel_client_access_request(uuid), public.client_permissions(uuid) to authenticated;
