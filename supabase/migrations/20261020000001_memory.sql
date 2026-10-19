-- Step 3: company memory, client memories, permission categories, documents, embeddings, Source Proof.
-- Hard rule (CLAUDE.md §4.2): permission filtering happens before retrieval results reach any model.
-- The server passes only readable spaces to match_memory(), and RLS re-checks every row (second barrier).

create extension if not exists vector with schema extensions;

-- ─── Embedding models in the catalogue ───────────────────────────────────────
alter table public.ai_models add column kind text not null default 'chat' check (kind in ('chat', 'embedding'));

-- PLACEHOLDER ESTIMATES (October 2026), to verify on the providers' pricing pages. Embedding models are
-- never offered in the model picker (kind = 'embedding', not allowed by default).
insert into public.ai_models
  (id, provider, api_model_id, label, tier, kind, context_window, max_output_tokens, supports_images, strengths,
   input_usd_per_mtok, output_usd_per_mtok, cached_input_usd_per_mtok,
   input_credits_per_mtok, output_credits_per_mtok, cached_input_credits_per_mtok, default_allowed, sort_order)
values
  ('text-embedding-3-small', 'openai', 'text-embedding-3-small', 'OpenAI Embedding 3 Small', 'fast', 'embedding', 8191, 256, false, '{}', 0.02, 0, 0, 20, 0, 0, false, 90),
  ('gemini-embedding-001', 'google', 'gemini-embedding-001', 'Gemini Embedding', 'fast', 'embedding', 8192, 256, false, '{}', 0.15, 0, 0, 150, 0, 0, false, 91);

-- Background AI tasks (memory suggestions, promotions) are counted as their own feature.
alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render'));

-- ─── Memory spaces ───────────────────────────────────────────────────────────
create type public.memory_kind as enum ('company', 'client');

create table public.memory_spaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.memory_kind not null,
  client_id uuid,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  check ((kind = 'company') = (client_id is null))
);
create unique index memory_spaces_one_company on public.memory_spaces (company_id) where kind = 'company';
create unique index memory_spaces_one_per_client on public.memory_spaces (client_id) where client_id is not null;

-- ─── Permission categories ───────────────────────────────────────────────────
-- Named groups granted read and/or write on memories. Two system categories have implicit members:
-- "everyone" (every active member) and "management" (Owner + Admins). Others list their members.
create table public.permission_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (length(description) <= 300),
  system_key text check (system_key in ('everyone', 'management')),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);
create unique index permission_categories_system on public.permission_categories (company_id, system_key)
  where system_key is not null;

create table public.permission_category_members (
  category_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (category_id, user_id),
  foreign key (category_id, company_id) references public.permission_categories (id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);

create table public.memory_space_grants (
  space_id uuid not null,
  company_id uuid not null,
  category_id uuid not null,
  can_read boolean not null default true,
  can_write boolean not null default false,
  primary key (space_id, category_id),
  foreign key (space_id, company_id) references public.memory_spaces (id, company_id) on delete cascade,
  foreign key (category_id, company_id) references public.permission_categories (id, company_id) on delete cascade,
  check (can_read or can_write)
);

-- ─── Permission functions ────────────────────────────────────────────────────
-- Variants taking a user id are used by the server for group conversations (intersection, Step 5);
-- they live in the private schema, which the API does not expose.
create function private.user_has_client_access(p_client uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.clients cl
    join public.company_members m on m.company_id = cl.company_id
    join public.companies c on c.id = cl.company_id
    where cl.id = p_client and m.user_id = p_user and m.status = 'active' and c.status = 'active'
      and (m.role = 'owner' or cl.visibility = 'open'
           or exists (select 1 from public.client_assignments a where a.client_id = cl.id and a.user_id = m.user_id))
  );
$$;

create function private.user_in_category(p_category uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.permission_categories pc
    join public.company_members m on m.company_id = pc.company_id and m.user_id = p_user and m.status = 'active'
    where pc.id = p_category
      and (pc.system_key = 'everyone'
           or (pc.system_key = 'management' and m.role in ('owner', 'admin'))
           or exists (select 1 from public.permission_category_members cm where cm.category_id = pc.id and cm.user_id = p_user))
  );
$$;

-- Owner: always. Otherwise: client access (client spaces) and a category granted the right.
create function private.user_space_right(p_space uuid, p_user uuid, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memory_spaces s
    join public.companies c on c.id = s.company_id and c.status = 'active'
    join public.company_members m on m.company_id = s.company_id and m.user_id = p_user and m.status = 'active'
    where s.id = p_space
      and (
        m.role = 'owner'
        or (
          (s.kind = 'company' or private.user_has_client_access(s.client_id, p_user))
          and exists (
            select 1 from public.memory_space_grants g
            where g.space_id = s.id
              and (case when p_write then g.can_write else g.can_read end)
              and private.user_in_category(g.category_id, p_user)
          )
        )
      )
  );
$$;

create function private.can_read_space(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_space_right(p_space, (select auth.uid()), false);
$$;

create function private.can_write_space(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_space_right(p_space, (select auth.uid()), true);
$$;

-- ─── Defaults: spaces, categories and grants for every company and client ────
create function private.init_company_memory(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_space uuid;
  v_everyone uuid;
  v_management uuid;
begin
  insert into public.permission_categories (company_id, name, system_key) values (p_company, 'Everyone', 'everyone')
  on conflict do nothing;
  insert into public.permission_categories (company_id, name, system_key) values (p_company, 'Management', 'management')
  on conflict do nothing;
  select id into v_everyone from public.permission_categories where company_id = p_company and system_key = 'everyone';
  select id into v_management from public.permission_categories where company_id = p_company and system_key = 'management';

  insert into public.memory_spaces (company_id, kind) values (p_company, 'company') on conflict do nothing;
  select id into v_space from public.memory_spaces where company_id = p_company and kind = 'company';
  -- Company memory: everyone reads, management writes.
  insert into public.memory_space_grants (space_id, company_id, category_id, can_read, can_write)
  values (v_space, p_company, v_everyone, true, false), (v_space, p_company, v_management, true, true)
  on conflict do nothing;
end;
$$;

create function private.init_client_memory(p_client uuid, p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_space uuid;
  v_everyone uuid;
begin
  insert into public.memory_spaces (company_id, kind, client_id) values (p_company, 'client', p_client) on conflict do nothing;
  select id into v_space from public.memory_spaces where client_id = p_client;
  select id into v_everyone from public.permission_categories where company_id = p_company and system_key = 'everyone';
  -- Client memory: everyone with access to the client reads and writes.
  insert into public.memory_space_grants (space_id, company_id, category_id, can_read, can_write)
  values (v_space, p_company, v_everyone, true, true)
  on conflict do nothing;
end;
$$;

create function private.on_company_created_memory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.init_company_memory(new.id);
  return new;
end;
$$;
create trigger companies_init_memory after insert on public.companies
  for each row execute function private.on_company_created_memory();

create function private.on_client_created_memory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.init_client_memory(new.id, new.company_id);
  return new;
end;
$$;
create trigger clients_init_memory after insert on public.clients
  for each row execute function private.on_client_created_memory();

select private.init_company_memory(id) from public.companies;
select private.init_client_memory(id, company_id) from public.clients;

-- ─── Memory entries ──────────────────────────────────────────────────────────
create table public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  -- Always set by trigger from the space.
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  title text not null check (length(trim(title)) between 1 and 200),
  content text not null check (length(trim(content)) between 1 and 20000),
  source_type text not null default 'manual' check (source_type in ('manual', 'chat', 'ai_suggestion', 'promotion')),
  -- Where it came from, e.g. {"conversation_id": "…", "message_id": "…"}. Ids only.
  source_ref jsonb not null default '{}',
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (space_id, company_id) references public.memory_spaces (id, company_id) on delete cascade
);
create index memory_entries_space on public.memory_entries (space_id, updated_at desc);
create index memory_entries_embedding on public.memory_entries using hnsw (embedding extensions.vector_cosine_ops);
create index memory_entries_search on public.memory_entries
  using gin (to_tsvector('simple', private.unaccent_immutable(title || ' ' || content)));

-- ─── Documents and chunks ────────────────────────────────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null check (length(mime_type) between 1 and 120),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  storage_path text not null unique,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error_code text,
  -- Text extracted on our server: shown when a Source Proof passage is opened.
  extracted_text text,
  text_truncated boolean not null default false,
  page_count integer,
  chunk_count integer,
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  foreign key (space_id, company_id) references public.memory_spaces (id, company_id) on delete cascade
);
create index documents_space on public.documents (space_id, created_at desc);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  space_id uuid not null,
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  page integer,
  char_start integer not null check (char_start >= 0),
  char_end integer not null,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, space_id) references public.documents (id, space_id) on delete cascade,
  check (char_end > char_start)
);
create index document_chunks_space on public.document_chunks (space_id);
create index document_chunks_embedding on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_search on public.document_chunks
  using gin (to_tsvector('simple', private.unaccent_immutable(content)));

-- ─── Suggestions (AI proposes, a human with write rights decides) ───────────
create table public.memory_suggestions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  kind text not null check (kind in ('new_entry', 'promotion')),
  title text not null check (length(trim(title)) between 1 and 200),
  content text not null check (length(trim(content)) between 1 and 20000),
  -- Promotion: the client memory the learning comes from (shown only to people who can read it).
  source_space_id uuid references public.memory_spaces (id) on delete set null,
  source_ref jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  entry_id uuid references public.memory_entries (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (space_id, company_id) references public.memory_spaces (id, company_id) on delete cascade
);
create index memory_suggestions_space on public.memory_suggestions (space_id, status);

-- ─── Source Proof ────────────────────────────────────────────────────────────
-- The passages an answer cited, as shown to users (exact excerpt and date at the time of the answer).
create table public.message_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null,
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  position smallint not null check (position between 1 and 50),
  source_type text not null check (source_type in ('document_chunk', 'memory_entry')),
  space_id uuid references public.memory_spaces (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  chunk_id uuid references public.document_chunks (id) on delete set null,
  entry_id uuid references public.memory_entries (id) on delete set null,
  title text not null,
  excerpt text not null,
  page integer,
  char_start integer,
  char_end integer,
  source_date timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, position),
  foreign key (message_id, conversation_id) references public.messages (id, conversation_id) on delete cascade
);
create index message_sources_message on public.message_sources (message_id);

-- company_id always comes from the parent row, never from the caller.
create function private.memory_company_from_space() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select company_id into new.company_id from public.memory_spaces where id = new.space_id;
  if new.company_id is null then perform private.fail('not_found'); end if;
  if tg_table_name = 'memory_entries' and tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := coalesce((select auth.uid()), new.updated_by);
  end if;
  return new;
end;
$$;
create trigger memory_entries_company before insert or update of space_id, title, content on public.memory_entries
  for each row execute function private.memory_company_from_space();
create trigger documents_company before insert on public.documents
  for each row execute function private.memory_company_from_space();
create trigger document_chunks_company before insert on public.document_chunks
  for each row execute function private.memory_company_from_space();
create trigger memory_suggestions_company before insert on public.memory_suggestions
  for each row execute function private.memory_company_from_space();
create trigger documents_updated_at before update on public.documents
  for each row execute function private.touch_updated_at();

create function private.message_sources_company() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select company_id into new.company_id from public.conversations where id = new.conversation_id;
  return new;
end;
$$;
create trigger message_sources_company before insert on public.message_sources
  for each row execute function private.message_sources_company();

grant execute on all functions in schema private to authenticated, service_role;

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.memory_spaces enable row level security;
alter table public.permission_categories enable row level security;
alter table public.permission_category_members enable row level security;
alter table public.memory_space_grants enable row level security;
alter table public.memory_entries enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.memory_suggestions enable row level security;
alter table public.message_sources enable row level security;

revoke all on public.memory_spaces, public.permission_categories, public.permission_category_members,
  public.memory_space_grants, public.memory_entries, public.documents, public.document_chunks,
  public.memory_suggestions, public.message_sources from anon;
revoke truncate, trigger, references on public.memory_spaces, public.permission_categories,
  public.permission_category_members, public.memory_space_grants, public.memory_entries, public.documents,
  public.document_chunks, public.memory_suggestions, public.message_sources from authenticated;

-- Spaces: visible to those who can read them, and to the permissions scope (to manage access).
revoke insert, update, delete on public.memory_spaces from authenticated;
create policy memory_spaces_select on public.memory_spaces
  for select to authenticated
  using (private.can_read_space(id) or private.has_admin_scope(company_id, 'permissions'));

-- Categories: members see the categories of their company (names only); changes go through RPCs.
revoke insert, update, delete on public.permission_categories, public.permission_category_members, public.memory_space_grants from authenticated;
create policy permission_categories_select on public.permission_categories
  for select to authenticated using ((select private.is_company_member(company_id)));
create policy permission_category_members_select on public.permission_category_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_admin_scope(company_id, 'permissions'));
create policy memory_space_grants_select on public.memory_space_grants
  for select to authenticated
  using (private.can_read_space(space_id) or private.has_admin_scope(company_id, 'permissions'));

-- Entries: read with read rights, write with write rights. Users write title and content (and the
-- search index computed by our server with their session); approved suggestions go through an RPC.
revoke insert, update on public.memory_entries from authenticated;
grant insert (space_id, title, content, source_type, source_ref) on public.memory_entries to authenticated;
grant update (title, content, embedding, embedding_model) on public.memory_entries to authenticated;
create policy memory_entries_select on public.memory_entries
  for select to authenticated using (private.can_read_space(space_id));
create policy memory_entries_insert on public.memory_entries
  for insert to authenticated
  with check (
    private.can_write_space(space_id)
    and author_id = (select auth.uid())
    and source_type in ('manual', 'chat')
  );
create policy memory_entries_update on public.memory_entries
  for update to authenticated
  using (private.can_write_space(space_id))
  with check (private.can_write_space(space_id));
create policy memory_entries_delete on public.memory_entries
  for delete to authenticated using (private.can_write_space(space_id));

-- Documents and chunks: same rights as the space. The server processes uploads with the uploader's session.
revoke insert, update on public.documents, public.document_chunks from authenticated;
grant insert (space_id, filename, mime_type, size_bytes, storage_path) on public.documents to authenticated;
grant update (status, error_code, extracted_text, text_truncated, page_count, chunk_count) on public.documents to authenticated;
grant insert (document_id, space_id, chunk_index, content, page, char_start, char_end, embedding, embedding_model)
  on public.document_chunks to authenticated;
create policy documents_select on public.documents
  for select to authenticated using (private.can_read_space(space_id));
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    private.can_write_space(space_id)
    and uploaded_by = (select auth.uid())
    and storage_path like space_id::text || '/%'
  );
create policy documents_update on public.documents
  for update to authenticated
  using (private.can_write_space(space_id))
  with check (private.can_write_space(space_id));
create policy documents_delete on public.documents
  for delete to authenticated using (private.can_write_space(space_id));
create policy document_chunks_select on public.document_chunks
  for select to authenticated using (private.can_read_space(space_id));
create policy document_chunks_insert on public.document_chunks
  for insert to authenticated with check (private.can_write_space(space_id));

-- Suggestions: deciders (write rights on the target) and the person who asked for them.
revoke insert, update, delete on public.memory_suggestions from authenticated;
grant insert (space_id, kind, title, content, source_space_id, source_ref) on public.memory_suggestions to authenticated;
create policy memory_suggestions_select on public.memory_suggestions
  for select to authenticated
  using (private.can_write_space(space_id) or (proposed_by = (select auth.uid()) and private.is_company_member(company_id)));
create policy memory_suggestions_insert on public.memory_suggestions
  for insert to authenticated
  with check (
    proposed_by = (select auth.uid())
    and status = 'pending'
    and (
      (kind = 'new_entry' and private.can_write_space(space_id) and source_space_id is null)
      or (kind = 'promotion' and source_space_id is not null and private.can_read_space(source_space_id)
          and exists (select 1 from public.memory_spaces s where s.id = space_id and s.kind = 'company'))
    )
  );
alter table public.memory_suggestions alter column proposed_by set default auth.uid();

-- Source Proof: participants of the conversation who can still read the source's memory.
revoke insert, update, delete on public.message_sources from authenticated;
create policy message_sources_select on public.message_sources
  for select to authenticated
  using (
    private.can_access_conversation(conversation_id)
    and (space_id is null or private.can_read_space(space_id))
  );

-- ─── Storage: memory documents (private bucket, path = <space_id>/<file>) ────
insert into storage.buckets (id, name, public, file_size_limit)
values ('memory-documents', 'memory-documents', false, 20971520)
on conflict (id) do nothing;

create policy memory_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'memory-documents' and private.can_read_space(private.try_uuid((storage.foldername(name))[1])));
create policy memory_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'memory-documents' and private.can_write_space(private.try_uuid((storage.foldername(name))[1])));
create policy memory_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'memory-documents' and private.can_write_space(private.try_uuid((storage.foldername(name))[1])));

-- ─── Activity log ────────────────────────────────────────────────────────────
create function private.audit_memory_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event('company', coalesce(new.company_id, old.company_id),
    case tg_op when 'INSERT' then 'memory.entry_created' when 'UPDATE' then 'memory.entry_updated' else 'memory.entry_deleted' end,
    'memory_space', coalesce(new.space_id, old.space_id)::text,
    jsonb_build_object('source_type', coalesce(new.source_type, old.source_type)));
  return coalesce(new, old);
end;
$$;
create trigger memory_entries_audit after insert or delete or update of title, content on public.memory_entries
  for each row execute function private.audit_memory_entries();

create function private.audit_documents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event('company', coalesce(new.company_id, old.company_id),
    case tg_op when 'INSERT' then 'memory.document_added' else 'memory.document_deleted' end,
    'memory_space', coalesce(new.space_id, old.space_id)::text);
  return coalesce(new, old);
end;
$$;
create trigger documents_audit after insert or delete on public.documents
  for each row execute function private.audit_documents();

-- ─── RPCs ────────────────────────────────────────────────────────────────────
-- Memory spaces the caller can read, with their rights (used by the server to scope retrieval).
create function public.my_memory_spaces(p_company uuid)
returns table (space_id uuid, kind public.memory_kind, client_id uuid, can_write boolean, entry_count bigint, document_count bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.kind, s.client_id, private.can_write_space(s.id),
    (select count(*) from public.memory_entries e where e.space_id = s.id),
    (select count(*) from public.documents d where d.space_id = s.id)
  from public.memory_spaces s
  where s.company_id = p_company and private.can_read_space(s.id);
$$;

-- Hybrid search inside the given spaces: meaning (embeddings) + exact words, merged by reciprocal rank.
-- p_keywords is a websearch query built by the server from the significant words of the question.
-- Security invoker: RLS applies, so a space the caller cannot read returns nothing even if passed.
create function public.match_memory(
  p_space_ids uuid[],
  p_keywords text,
  p_embedding extensions.vector(1536) default null,
  p_limit integer default 6,
  p_min_similarity double precision default 0.25
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
       order by distance limit (select pool from q))
      union all
      (select e.id, e.embedding operator(extensions.<=>) p_embedding
       from public.memory_entries e
       where p_embedding is not null and e.space_id = any (p_space_ids) and e.embedding is not null
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
           e.updated_at, f.score::double precision
    from fused f
    join public.memory_entries e on e.id = f.id
  ) results
  order by 11 desc
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

-- Approve (optionally edited) or reject a suggestion. Approving creates the entry; requires write rights.
create function public.decide_memory_suggestion(p_suggestion uuid, p_approve boolean, p_title text default null, p_content text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.memory_suggestions;
  v_entry uuid;
begin
  select * into v_s from public.memory_suggestions where id = p_suggestion;
  if v_s.id is null or not private.can_write_space(v_s.space_id) then perform private.fail('forbidden'); end if;
  if v_s.status <> 'pending' then perform private.fail('already_decided'); end if;
  if not p_approve then
    update public.memory_suggestions set status = 'rejected', decided_by = (select auth.uid()), decided_at = now() where id = v_s.id;
    perform private.log_event('company', v_s.company_id, 'memory.suggestion_rejected', 'memory_space', v_s.space_id::text,
      jsonb_build_object('kind', v_s.kind));
    return null;
  end if;
  insert into public.memory_entries (space_id, title, content, source_type, source_ref, author_id)
  values (
    v_s.space_id,
    coalesce(nullif(trim(p_title), ''), v_s.title),
    coalesce(nullif(trim(p_content), ''), v_s.content),
    case v_s.kind when 'promotion' then 'promotion' else 'ai_suggestion' end,
    v_s.source_ref || jsonb_build_object('suggestion_id', v_s.id, 'proposed_by', v_s.proposed_by),
    (select auth.uid())
  )
  returning id into v_entry;
  update public.memory_suggestions
     set status = 'approved', decided_by = (select auth.uid()), decided_at = now(), entry_id = v_entry
   where id = v_s.id;
  perform private.log_event('company', v_s.company_id, 'memory.suggestion_approved', 'memory_space', v_s.space_id::text,
    jsonb_build_object('kind', v_s.kind));
  return v_entry;
end;
$$;

-- Permissions admin ("permissions" scope): categories, members, grants.
create function public.admin_save_category(p_company uuid, p_category uuid, p_name text, p_description text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_category;
  v_system text;
begin
  if not private.has_admin_scope(p_company, 'permissions') then perform private.fail('forbidden'); end if;
  if v_id is null then
    insert into public.permission_categories (company_id, name, description)
    values (p_company, trim(p_name), nullif(trim(p_description), ''))
    returning id into v_id;
  else
    select system_key into v_system from public.permission_categories where id = v_id and company_id = p_company;
    if not found then perform private.fail('not_found'); end if;
    if v_system is not null then perform private.fail('system_category'); end if;
    update public.permission_categories set name = trim(p_name), description = nullif(trim(p_description), '') where id = v_id;
  end if;
  delete from public.permission_category_members where category_id = v_id and not (user_id = any (coalesce(p_members, '{}')));
  insert into public.permission_category_members (category_id, company_id, user_id)
  select v_id, p_company, u from unnest(coalesce(p_members, '{}')) u
  where exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u)
  on conflict do nothing;
  perform private.log_event('company', p_company, 'permissions.category_saved', 'permission_category', v_id::text,
    jsonb_build_object('members', cardinality(coalesce(p_members, '{}'))));
  return v_id;
end;
$$;

create function public.admin_delete_category(p_company uuid, p_category uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'permissions') then perform private.fail('forbidden'); end if;
  if exists (select 1 from public.permission_categories where id = p_category and system_key is not null) then
    perform private.fail('system_category');
  end if;
  delete from public.permission_categories where id = p_category and company_id = p_company;
  if not found then perform private.fail('not_found'); end if;
  perform private.log_event('company', p_company, 'permissions.category_deleted', 'permission_category', p_category::text);
end;
$$;

-- Replaces the grants of one memory: who reads, who writes (writers can always read).
create function public.admin_set_space_grants(p_space uuid, p_read uuid[], p_write uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.memory_spaces where id = p_space;
  if v_company is null or not private.has_admin_scope(v_company, 'permissions') then perform private.fail('forbidden'); end if;
  if exists (
    select 1 from unnest(coalesce(p_read, '{}') || coalesce(p_write, '{}')) c
    where not exists (select 1 from public.permission_categories pc where pc.id = c and pc.company_id = v_company)
  ) then
    perform private.fail('not_found');
  end if;
  delete from public.memory_space_grants where space_id = p_space;
  insert into public.memory_space_grants (space_id, company_id, category_id, can_read, can_write)
  select p_space, v_company, c, true, c = any (coalesce(p_write, '{}'))
  from (select distinct unnest(coalesce(p_read, '{}') || coalesce(p_write, '{}')) as c) cats;
  perform private.log_event('company', v_company, 'permissions.grants_updated', 'memory_space', p_space::text,
    jsonb_build_object('read', cardinality(coalesce(p_read, '{}')), 'write', cardinality(coalesce(p_write, '{}'))));
end;
$$;

-- Model settings must only list chat models.
create or replace function public.admin_update_model_settings(
  p_company uuid, p_allowed text[], p_default text, p_auto boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[];
begin
  if not private.has_admin_scope(p_company, 'models') then perform private.fail('forbidden'); end if;
  select coalesce(array_agg(m.id), '{}') into v_allowed
  from public.ai_models m where m.id = any (coalesce(p_allowed, '{}')) and m.is_enabled and m.kind = 'chat';
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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
