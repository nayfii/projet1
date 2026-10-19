-- Step 2: multi-model chat, model catalogue, company AI settings, usage, credits and quotas.
-- Conversations and messages hold customer content: no policy mentions the platform admin.
-- AI answers and usage rows are written by the server only (service role, audited modules).

create extension if not exists unaccent with schema extensions;

-- ─── Types ───────────────────────────────────────────────────────────────────
create type public.ai_provider as enum ('openai', 'anthropic', 'google');
create type public.model_tier as enum ('fast', 'balanced', 'advanced');

-- Month boundaries (UTC) for monthly credits.
create function private.period_start(p_at timestamptz default now()) returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';
$$;

-- Accent-insensitive search ("reunion" finds "réunion"). Immutable wrapper so it can be indexed.
create function private.unaccent_immutable(p_text text) returns text
language sql immutable parallel safe strict set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

create function private.try_uuid(p_text text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- ─── Model catalogue (platform-managed, no customer data) ────────────────────
create table public.ai_models (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  provider public.ai_provider not null,
  -- Model name sent to the provider API. Can be updated (new snapshot) without changing the id.
  api_model_id text not null check (length(trim(api_model_id)) between 1 and 120),
  label text not null check (length(trim(label)) between 1 and 80),
  tier public.model_tier not null,
  context_window integer not null check (context_window >= 8000),
  max_output_tokens integer not null check (max_output_tokens between 256 and 200000),
  supports_images boolean not null default true,
  -- Used by the Smart Router (Auto mode).
  strengths text[] not null default '{}'
    check (strengths <@ array['writing', 'reasoning', 'code', 'long_context', 'speed', 'vision']::text[]),
  -- ESTIMATES, in US dollars per million tokens, copied from the providers' public price lists.
  input_usd_per_mtok numeric(12, 4) not null default 0 check (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(12, 4) not null default 0 check (output_usd_per_mtok >= 0),
  cached_input_usd_per_mtok numeric(12, 4) not null default 0 check (cached_input_usd_per_mtok >= 0),
  -- Business rule: credits charged per million tokens. Configurable, never hardcoded in the app.
  input_credits_per_mtok numeric(14, 4) not null default 0 check (input_credits_per_mtok >= 0),
  output_credits_per_mtok numeric(14, 4) not null default 0 check (output_credits_per_mtok >= 0),
  cached_input_credits_per_mtok numeric(14, 4) not null default 0 check (cached_input_credits_per_mtok >= 0),
  is_enabled boolean not null default true,
  -- Allowed by default in newly created companies.
  default_allowed boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, api_model_id)
);
create trigger ai_models_updated_at before update on public.ai_models
  for each row execute function private.touch_updated_at();

-- Default catalogue. Prices are PLACEHOLDER ESTIMATES taken from third-party price lists in
-- October 2026 and must be checked against each provider's official pricing page by the platform
-- admin (Platform console → Models). Default credit rate: 1 credit ≈ 0.001 USD of estimated cost.
insert into public.ai_models
  (id, provider, api_model_id, label, tier, context_window, max_output_tokens, strengths,
   input_usd_per_mtok, output_usd_per_mtok, cached_input_usd_per_mtok,
   input_credits_per_mtok, output_credits_per_mtok, cached_input_credits_per_mtok, sort_order)
values
  ('gpt-6-luna', 'openai', 'gpt-6-luna', 'GPT-6 Luna', 'fast', 400000, 16000, '{speed}', 0.10, 0.50, 0.01, 100, 500, 10, 10),
  ('gpt-6.1-sol', 'openai', 'gpt-6.1-sol', 'GPT-6.1 Sol', 'balanced', 400000, 32000, '{reasoning,code}', 2.00, 10.00, 0.20, 2000, 10000, 200, 11),
  ('gpt-6-astra', 'openai', 'gpt-6-astra', 'GPT-6 Astra', 'advanced', 400000, 32000, '{reasoning,code,long_context}', 10.00, 50.00, 1.00, 10000, 50000, 1000, 12),
  ('claude-haiku-5-5', 'anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', 'fast', 200000, 16000, '{speed,writing}', 0.10, 0.50, 0.01, 100, 500, 10, 20),
  ('claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 'balanced', 200000, 32000, '{writing,code,reasoning}', 2.00, 10.00, 0.10, 2000, 10000, 100, 21),
  ('claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', 'advanced', 200000, 32000, '{reasoning,writing,code}', 4.00, 20.00, 0.20, 4000, 20000, 200, 22),
  ('gemini-flash-lite', 'google', 'gemini-flash-lite-latest', 'Gemini Flash-Lite', 'fast', 1000000, 16000, '{speed,long_context}', 0.25, 1.50, 0.025, 250, 1500, 25, 30),
  ('gemini-flash', 'google', 'gemini-flash-latest', 'Gemini Flash', 'balanced', 1000000, 32000, '{long_context,vision,speed}', 0.75, 3.75, 0.075, 750, 3750, 75, 31),
  ('gemini-pro', 'google', 'gemini-pro-latest', 'Gemini Pro', 'advanced', 1000000, 32000, '{reasoning,long_context,code}', 2.00, 12.00, 0.20, 2000, 12000, 200, 32);

-- ─── Company AI settings ─────────────────────────────────────────────────────
create table public.company_ai_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  auto_enabled boolean not null default true,
  -- Model preselected in new conversations. Null = Auto.
  default_model_id text references public.ai_models (id) on delete set null,
  -- Monthly credit limit per person (null = no personal limit, only the company limit applies).
  default_user_monthly_credits numeric(14, 2) check (default_user_monthly_credits >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger company_ai_settings_updated_at before update on public.company_ai_settings
  for each row execute function private.touch_updated_at();

create table public.company_allowed_models (
  company_id uuid not null references public.companies (id) on delete cascade,
  model_id text not null references public.ai_models (id) on delete cascade,
  primary key (company_id, model_id)
);

create function private.init_company_ai() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_ai_settings (company_id) values (new.id) on conflict do nothing;
  insert into public.company_allowed_models (company_id, model_id)
  select new.id, m.id from public.ai_models m where m.is_enabled and m.default_allowed
  on conflict do nothing;
  return new;
end;
$$;
create trigger companies_init_ai after insert on public.companies
  for each row execute function private.init_company_ai();

-- Existing companies (created in Step 1) get the defaults too.
insert into public.company_ai_settings (company_id) select id from public.companies on conflict do nothing;
insert into public.company_allowed_models (company_id, model_id)
select c.id, m.id from public.companies c cross join public.ai_models m where m.is_enabled and m.default_allowed
on conflict do nothing;

-- ─── Quotas and credits ──────────────────────────────────────────────────────
-- Personal limit that overrides the company default for one member.
create table public.member_quotas (
  company_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  monthly_credits numeric(14, 2) not null check (monthly_credits >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);

-- Extra credits granted by the platform admin for one month ("raise the limit").
create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  credits numeric(14, 2) not null check (credits > 0),
  period_start timestamptz not null,
  note text check (length(note) <= 200),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_grants_company on public.credit_grants (company_id, period_start);

-- ─── Conversations ───────────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid,
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text check (length(title) <= 200),
  -- 'auto' or an ai_models id. Validated by the server at every request.
  model_choice text not null default 'auto' check (model_choice ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  is_group boolean not null default false,
  last_seq integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id)
);
create index conversations_owner on public.conversations (company_id, owner_id, last_message_at desc nulls last);
create index conversations_client on public.conversations (client_id) where client_id is not null;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.touch_updated_at();

create table public.conversation_participants (
  conversation_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'participant' check (role in ('owner', 'participant')),
  -- A participant sees messages from this sequence number on (group history sharing, Step 5).
  visible_from_seq integer not null default 1 check (visible_from_seq >= 1),
  added_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  foreign key (conversation_id, company_id) references public.conversations (id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);
create index conversation_participants_user on public.conversation_participants (user_id);

create function private.add_conversation_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.conversation_participants (conversation_id, company_id, user_id, role, added_by)
  values (new.id, new.company_id, new.owner_id, 'owner', new.owner_id);
  return new;
end;
$$;
create trigger conversations_add_owner after insert on public.conversations
  for each row execute function private.add_conversation_owner();

-- Participant of the conversation, active member of its company, and allowed to see its client.
create function private.can_access_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversations cv
    join public.conversation_participants p on p.conversation_id = cv.id and p.user_id = (select auth.uid())
    where cv.id = p_conversation
      and private.is_company_member(cv.company_id)
      and (cv.client_id is null or private.has_client_access(cv.client_id))
  );
$$;

create function private.visible_from_seq(p_conversation uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select visible_from_seq from public.conversation_participants
      where conversation_id = p_conversation and user_id = (select auth.uid())),
    2147483647);
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  -- company_id and seq are always set by the messages_before_insert trigger; the defaults only
  -- let callers omit them.
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  seq integer not null default 0,
  author_type text not null default 'user' check (author_type in ('user', 'assistant')),
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  -- As typed by the user / as shown to users.
  content text not null default '' check (length(content) <= 100000),
  -- Masked version sent to providers (Hide, Step 4). Null = same as content.
  model_content text,
  provider public.ai_provider,
  model_id text,
  api_model_id text,
  -- Label at the time of the answer, so history stays readable if the catalogue changes.
  model_label text,
  -- Auto mode explanation as codes (translated in the UI), e.g. {"mode":"auto","task":"writing","basis":"quality"}.
  routing jsonb,
  status text not null default 'complete' check (status in ('streaming', 'complete', 'error', 'stopped')),
  error_code text,
  -- Set when "Regenerate" replaced this answer: hidden from the timeline and from the AI context.
  superseded_at timestamptz,
  -- The user pressed Stop. The server checks it while writing the answer (closing the tab does not stop it).
  stop_requested_at timestamptz,
  context_meta jsonb,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  unique (id, conversation_id),
  foreign key (conversation_id, company_id) references public.conversations (id, company_id) on delete cascade,
  check (author_type = 'assistant' or (provider is null and model_id is null and routing is null))
);
create index messages_conversation on public.messages (conversation_id, seq);
create index messages_search on public.messages
  using gin (to_tsvector('simple', private.unaccent_immutable(content)));

-- Assigns the next sequence number and copies the company from the conversation (callers cannot choose it).
create function private.messages_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_seq integer;
  v_company uuid;
begin
  update public.conversations
     set last_seq = last_seq + 1,
         last_message_at = now(),
         title = case when title is null and new.author_type = 'user'
                      then nullif(left(regexp_replace(trim(new.content), '\s+', ' ', 'g'), 80), '') else title end
   where id = new.conversation_id
  returning last_seq, company_id into v_seq, v_company;
  if v_seq is null then perform private.fail('not_found'); end if;
  new.seq := v_seq;
  new.company_id := v_company;
  return new;
end;
$$;
create trigger messages_before_insert before insert on public.messages
  for each row execute function private.messages_before_insert();

create table public.conversation_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  -- Always set by the attachments_before_insert trigger from the conversation.
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  -- Null until the message it belongs to is sent.
  message_id uuid,
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null check (length(mime_type) between 1 and 120),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'document')),
  -- Text extracted on our server (documents). Images are sent to the model as images.
  extracted_text text,
  text_truncated boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, company_id) references public.conversations (id, company_id) on delete cascade,
  foreign key (message_id, conversation_id) references public.messages (id, conversation_id) on delete cascade
);
create index conversation_attachments_conversation on public.conversation_attachments (conversation_id);
create index conversation_attachments_message on public.conversation_attachments (message_id);

create function private.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select company_id into new.company_id from public.conversations where id = new.conversation_id;
  if new.company_id is null then perform private.fail('not_found'); end if;
  return new;
end;
$$;
create trigger attachments_before_insert before insert on public.conversation_attachments
  for each row execute function private.attachments_before_insert();

-- ─── Usage (metadata only: never prompt or answer content) ───────────────────
create table public.usage_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  feature text not null check (feature in ('chat', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render')),
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  provider public.ai_provider,
  -- Catalogue id at the time (no foreign key: history survives catalogue changes).
  model_id text,
  api_model_id text,
  auto_routed boolean not null default false,
  -- Token counts returned by the provider. tokens_estimated = true only when the provider
  -- returned none (e.g. the user stopped the answer): then they are estimated from text length.
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  tokens_estimated boolean not null default false,
  credits numeric(14, 4) not null default 0 check (credits >= 0),
  -- ESTIMATE from the pricing table at the time of the request (US dollars).
  estimated_cost_usd numeric(14, 6) not null default 0 check (estimated_cost_usd >= 0),
  credit_pool text not null default 'standard' check (credit_pool in ('standard', 'video')),
  status text not null check (status in ('ok', 'error', 'aborted')),
  error_code text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index usage_events_company on public.usage_events (company_id, created_at desc);
create index usage_events_user on public.usage_events (company_id, user_id, created_at desc);

-- Credits for the current month: company limit (plan + grants) and personal limit.
create function private.quota_status(p_company uuid, p_user uuid)
returns table (period_start timestamptz, company_limit numeric, company_used numeric, user_limit numeric, user_used numeric)
language sql stable security definer set search_path = '' as $$
  with b as (select private.period_start() as start, private.period_start() + interval '1 month' as finish)
  select
    b.start,
    coalesce((select pl.monthly_credits from public.companies c join public.plans pl on pl.id = c.plan_id where c.id = p_company), 0)
      + coalesce((select sum(g.credits) from public.credit_grants g where g.company_id = p_company and g.period_start = b.start), 0),
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

grant execute on all functions in schema private to authenticated, service_role;

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.ai_models enable row level security;
alter table public.company_ai_settings enable row level security;
alter table public.company_allowed_models enable row level security;
alter table public.member_quotas enable row level security;
alter table public.credit_grants enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_attachments enable row level security;
alter table public.usage_events enable row level security;

revoke all on public.ai_models, public.company_ai_settings, public.company_allowed_models, public.member_quotas,
  public.credit_grants, public.conversations, public.conversation_participants, public.messages,
  public.conversation_attachments, public.usage_events from anon;
revoke truncate, trigger, references on public.ai_models, public.company_ai_settings, public.company_allowed_models,
  public.member_quotas, public.credit_grants, public.conversations, public.conversation_participants, public.messages,
  public.conversation_attachments, public.usage_events from authenticated;

-- ai_models: the catalogue (names, tiers, price estimates, credit rates) is visible to signed-in users;
-- only platform admins change it.
create policy ai_models_select on public.ai_models
  for select to authenticated using (true);
create policy ai_models_platform_write on public.ai_models
  for all to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- Company AI settings: members read (model picker); changes go through RPCs.
revoke insert, update, delete on public.company_ai_settings, public.company_allowed_models from authenticated;
create policy company_ai_settings_select on public.company_ai_settings
  for select to authenticated using ((select private.is_company_member(company_id)));
create policy company_allowed_models_select on public.company_allowed_models
  for select to authenticated using ((select private.is_company_member(company_id)));

revoke insert, update, delete on public.member_quotas, public.credit_grants from authenticated;
create policy member_quotas_select on public.member_quotas
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_company_member(company_id))
    or private.has_admin_scope(company_id, 'quotas')
    or private.has_admin_scope(company_id, 'usage')
  );
create policy credit_grants_select on public.credit_grants
  for select to authenticated
  using (private.has_admin_scope(company_id, 'quotas') or private.has_admin_scope(company_id, 'usage'));

-- conversations: only participants (with access to the linked client) see them.
revoke insert, update on public.conversations from authenticated;
grant insert (company_id, client_id, title, model_choice) on public.conversations to authenticated;
grant update (title, client_id, model_choice) on public.conversations to authenticated;
-- The owner clause also covers INSERT … RETURNING, which runs before the owner's participant row exists.
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_company_member(company_id)
      and (client_id is null or private.has_client_access(client_id)))
    or private.can_access_conversation(id)
  );
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.is_company_member(company_id)
    and (client_id is null or private.has_client_access(client_id))
  );
create policy conversations_update on public.conversations
  for update to authenticated
  using (owner_id = (select auth.uid()) and private.can_access_conversation(id))
  with check (owner_id = (select auth.uid()) and (client_id is null or private.has_client_access(client_id)));
create policy conversations_delete on public.conversations
  for delete to authenticated
  using (owner_id = (select auth.uid()) and private.can_access_conversation(id));

-- participants: visible to the conversation's participants; managed by triggers and RPCs (Step 5).
revoke insert, update, delete on public.conversation_participants from authenticated;
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated using (private.can_access_conversation(conversation_id));

-- messages: participants see messages from their visible_from_seq on. Users can only add their own
-- messages (two columns); AI answers are written by the server.
revoke insert, update, delete on public.messages from authenticated;
grant insert (conversation_id, content) on public.messages to authenticated;
create policy messages_select on public.messages
  for select to authenticated
  using (private.can_access_conversation(conversation_id) and seq >= private.visible_from_seq(conversation_id));
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_type = 'user'
    and author_id = (select auth.uid())
    and private.can_access_conversation(conversation_id)
  );

-- attachments: participants see them; the uploader adds them and links them to their own message.
revoke insert, update, delete on public.conversation_attachments from authenticated;
grant insert (conversation_id, filename, mime_type, size_bytes, storage_path, kind, extracted_text, text_truncated)
  on public.conversation_attachments to authenticated;
grant update (message_id) on public.conversation_attachments to authenticated;
grant delete on public.conversation_attachments to authenticated;
create policy attachments_select on public.conversation_attachments
  for select to authenticated using (private.can_access_conversation(conversation_id));
create policy attachments_insert on public.conversation_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_access_conversation(conversation_id)
    and storage_path like conversation_id::text || '/%'
  );
create policy attachments_update on public.conversation_attachments
  for update to authenticated
  using (uploaded_by = (select auth.uid()) and message_id is null and private.can_access_conversation(conversation_id))
  with check (
    uploaded_by = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id and m.author_id = (select auth.uid()))
  );
create policy attachments_delete on public.conversation_attachments
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) and message_id is null and private.can_access_conversation(conversation_id));

-- usage_events: written by the server only. Members see their own usage; the "usage" scope sees all.
revoke insert, update, delete on public.usage_events from authenticated;
create policy usage_events_select on public.usage_events
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_company_member(company_id))
    or private.has_admin_scope(company_id, 'usage')
  );

-- ─── Storage: chat attachments (private bucket, path = <conversation_id>/<file>) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 20971520)
on conflict (id) do nothing;

create policy chat_attachments_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments' and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1])));
create policy chat_attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments' and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1])));
create policy chat_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id = private.try_uuid((storage.foldername(name))[1]) and c.owner_id = (select auth.uid())
    )
    and private.can_access_conversation(private.try_uuid((storage.foldername(name))[1]))
  );

-- ─── Audit of platform catalogue changes ─────────────────────────────────────
create function private.audit_ai_models() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event('platform', null,
    case tg_op when 'INSERT' then 'model.created' when 'UPDATE' then 'model.updated' else 'model.deleted' end,
    'model', coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;
create trigger ai_models_audit after insert or update or delete on public.ai_models
  for each row execute function private.audit_ai_models();

-- ─── Member RPCs ─────────────────────────────────────────────────────────────
create function public.my_quota_status(p_company uuid)
returns table (period_start timestamptz, company_limit numeric, company_used numeric, user_limit numeric, user_used numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_company_member(p_company) then perform private.fail('forbidden'); end if;
  return query select * from private.quota_status(p_company, (select auth.uid()));
end;
$$;

-- Full-text search across the conversations the caller can see (RLS applies: security invoker).
-- Matches are wrapped in control characters U+0002 / U+0003 that the UI turns into highlights.
create function public.search_conversations(p_company uuid, p_query text, p_limit integer default 20)
returns table (conversation_id uuid, title text, client_id uuid, snippet text, matched_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('simple', private.unaccent_immutable(trim(p_query))) as tsq,
           -- Highlighting: any term, typed with or without accents.
           replace((websearch_to_tsquery('simple', trim(p_query))
                    || websearch_to_tsquery('simple', private.unaccent_immutable(trim(p_query))))::text,
                   ' & ', ' | ')::tsquery as highlight,
           '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  hits as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      ts_headline('simple', m.content, q.highlight,
        'MaxWords=18, MinWords=6, StartSel=' || chr(2) || ', StopSel=' || chr(3)) as snippet,
      m.created_at
    from public.messages m, q
    where m.company_id = p_company
      and m.superseded_at is null
      and to_tsvector('simple', private.unaccent_immutable(m.content)) @@ q.tsq
    order by m.conversation_id, m.created_at desc
  )
  select c.id, c.title, c.client_id, h.snippet, coalesce(h.created_at, c.last_message_at, c.created_at)
  from public.conversations c
  cross join q
  left join hits h on h.conversation_id = c.id
  where c.company_id = p_company
    and length(trim(p_query)) > 0
    and (h.conversation_id is not null or c.title ilike q.pattern)
  order by 5 desc nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ─── Company admin RPCs ──────────────────────────────────────────────────────
create function public.admin_update_model_settings(
  p_company uuid, p_allowed text[], p_default text, p_auto boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[];
begin
  if not private.has_admin_scope(p_company, 'models') then perform private.fail('forbidden'); end if;
  select coalesce(array_agg(m.id), '{}') into v_allowed
  from public.ai_models m where m.id = any (coalesce(p_allowed, '{}')) and m.is_enabled;
  if cardinality(v_allowed) = 0 or cardinality(v_allowed) <> cardinality(array(select distinct unnest(p_allowed))) then
    perform private.fail('invalid_models');
  end if;
  if p_default is not null and not (p_default = any (v_allowed)) then perform private.fail('invalid_models'); end if;
  if p_default is null and not coalesce(p_auto, false) then perform private.fail('invalid_models'); end if;

  insert into public.company_ai_settings (company_id, auto_enabled, default_model_id, updated_by)
  values (p_company, coalesce(p_auto, false), p_default, (select auth.uid()))
  on conflict (company_id) do update
    set auto_enabled = excluded.auto_enabled, default_model_id = excluded.default_model_id, updated_by = excluded.updated_by;
  delete from public.company_allowed_models where company_id = p_company and not (model_id = any (v_allowed));
  insert into public.company_allowed_models (company_id, model_id)
  select p_company, unnest(v_allowed) on conflict do nothing;

  perform private.log_event('company', p_company, 'models.updated', 'company', p_company::text,
    jsonb_build_object('allowed', to_jsonb(v_allowed), 'default', p_default, 'auto', coalesce(p_auto, false)));
end;
$$;

create function public.admin_set_default_user_quota(p_company uuid, p_credits numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'quotas') then perform private.fail('forbidden'); end if;
  if p_credits is not null and p_credits < 0 then perform private.fail('validation'); end if;
  insert into public.company_ai_settings (company_id, default_user_monthly_credits, updated_by)
  values (p_company, p_credits, (select auth.uid()))
  on conflict (company_id) do update
    set default_user_monthly_credits = excluded.default_user_monthly_credits, updated_by = excluded.updated_by;
  perform private.log_event('company', p_company, 'quota.default_updated', 'company', p_company::text,
    jsonb_build_object('credits', p_credits));
end;
$$;

-- p_credits null removes the personal limit (the company default applies again).
create function public.admin_set_member_quota(p_company uuid, p_user uuid, p_credits numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'quotas') then perform private.fail('forbidden'); end if;
  if not exists (select 1 from public.company_members where company_id = p_company and user_id = p_user) then
    perform private.fail('not_found');
  end if;
  if p_credits is null then
    delete from public.member_quotas where company_id = p_company and user_id = p_user;
  else
    if p_credits < 0 then perform private.fail('validation'); end if;
    insert into public.member_quotas (company_id, user_id, monthly_credits, updated_by)
    values (p_company, p_user, p_credits, (select auth.uid()))
    on conflict (company_id, user_id) do update
      set monthly_credits = excluded.monthly_credits, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform private.log_event('company', p_company, 'quota.member_updated', 'member', p_user::text,
    jsonb_build_object('user_id', p_user, 'credits', p_credits));
end;
$$;

-- Per-member credits this month with their effective limit (quotas or usage scope).
create function public.admin_member_credits(p_company uuid)
returns table (user_id uuid, credits_used numeric, personal_limit numeric, has_override boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_admin_scope(p_company, 'quotas') or private.has_admin_scope(p_company, 'usage')) then
    perform private.fail('forbidden');
  end if;
  return query
  select m.user_id,
    coalesce((select sum(u.credits) from public.usage_events u
              where u.company_id = p_company and u.user_id = m.user_id and u.credit_pool = 'standard'
                and u.created_at >= private.period_start()), 0),
    coalesce(q.monthly_credits, s.default_user_monthly_credits),
    q.user_id is not null
  from public.company_members m
  left join public.member_quotas q on q.company_id = m.company_id and q.user_id = m.user_id
  left join public.company_ai_settings s on s.company_id = m.company_id
  where m.company_id = p_company;
end;
$$;

-- Usage dashboard: totals, per person, per model, per day, for a period. Metadata only.
create function public.company_usage_summary(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not private.has_admin_scope(p_company, 'usage') then perform private.fail('forbidden'); end if;
  with ev as (
    select * from public.usage_events
    where company_id = p_company and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'requests', count(*), 'errors', count(*) filter (where status = 'error'),
        'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
        'credits', coalesce(sum(credits), 0), 'estimated_cost_usd', coalesce(sum(estimated_cost_usd), 0),
        'estimated_tokens_requests', count(*) filter (where tokens_estimated)) from ev),
    'by_user', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select user_id, count(*) as requests, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
               sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd
        from ev group by user_id) r), '[]'),
    'by_model', coalesce((select jsonb_agg(r order by r.credits desc) from (
        select model_id, provider, count(*) as requests, sum(input_tokens) as input_tokens,
               sum(output_tokens) as output_tokens, sum(credits) as credits, sum(estimated_cost_usd) as estimated_cost_usd,
               count(*) filter (where auto_routed) as auto_requests
        from ev group by model_id, provider) r), '[]'),
    'by_day', coalesce((select jsonb_agg(r order by r.day) from (
        select (created_at at time zone 'UTC')::date as day, count(*) as requests, sum(credits) as credits
        from ev group by 1) r), '[]')
  ) into v_result;
  return v_result;
end;
$$;

-- ─── Platform RPCs (metadata only) ───────────────────────────────────────────
create function public.platform_company_credits()
returns table (company_id uuid, credit_limit numeric, credits_used numeric, granted numeric, requests bigint, estimated_cost_usd numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select c.id, q.company_limit, q.company_used,
    coalesce((select sum(g.credits) from public.credit_grants g where g.company_id = c.id and g.period_start = private.period_start()), 0),
    (select count(*) from public.usage_events u where u.company_id = c.id and u.created_at >= private.period_start()),
    coalesce((select sum(u.estimated_cost_usd) from public.usage_events u where u.company_id = c.id and u.created_at >= private.period_start()), 0)
  from public.companies c
  cross join lateral private.quota_status(c.id, null) q;
end;
$$;

create function public.platform_grant_credits(p_company uuid, p_credits numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits <= 0 then perform private.fail('validation'); end if;
  if not exists (select 1 from public.companies where id = p_company) then perform private.fail('not_found'); end if;
  insert into public.credit_grants (company_id, credits, period_start, note, granted_by)
  values (p_company, p_credits, private.period_start(), nullif(trim(p_note), ''), (select auth.uid()));
  perform private.log_event('platform', null, 'credits.granted', 'company', p_company::text,
    jsonb_build_object('credits', p_credits));
end;
$$;

-- RPC exposure: authenticated users only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
