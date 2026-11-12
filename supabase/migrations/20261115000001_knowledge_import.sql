-- Knowledge import (CLAUDE.md §12, V1.1): a person brings what their former AI tools knew about their
-- work (ChatGPT, Claude, Gemini, Perplexity exports). The archive is read in the person's browser and
-- never stored; the server receives the text of the conversations kept, filters private content out,
-- and stores only PROPOSALS that the person reviews before anything reaches a memory.
--
-- Both tables belong to one person: nobody else reads them — no colleague, Admin, Owner or our team.

create table public.knowledge_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  source text not null check (source in ('chatgpt', 'claude', 'gemini', 'perplexity', 'files')),
  file_name text not null check (length(file_name) between 1 and 255),
  -- Recognises the same export dropped again (resume): name, size and the list of items, hashed.
  fingerprint text not null check (length(fingerprint) between 8 and 128),
  status text not null default 'analyzing' check (status in ('analyzing', 'review', 'done')),
  found integer not null default 0 check (found >= 0),
  selected integer not null default 0 check (selected >= 0),
  analyzed integer not null default 0 check (analyzed >= 0),
  excluded_private integer not null default 0 check (excluded_private >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  proposed integer not null default 0 check (proposed >= 0),
  saved integer not null default 0 check (saved >= 0),
  failed integer not null default 0 check (failed >= 0),
  -- Opaque references (hashes) of the items already analysed, so a resumed import skips them.
  processed_refs text[] not null default '{}' check (cardinality(processed_refs) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index knowledge_imports_owner on public.knowledge_imports (company_id, user_id, created_at desc);
create trigger knowledge_imports_updated_at before update on public.knowledge_imports
  for each row execute function private.touch_updated_at();

create table public.knowledge_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.knowledge_imports (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- Professional knowledge, or a professional preference of the person. Private content is never stored.
  category text not null check (category in ('professional', 'preference')),
  -- Where the AI proposes it (the person decides): their own memory, their team, the company, a client, a project.
  level text not null check (level in ('personal', 'team', 'company', 'client', 'project')),
  target_hint text check (length(target_hint) <= 120),
  title text not null check (length(trim(title)) between 1 and 200),
  content text not null check (length(trim(content)) between 1 and 2000),
  -- Might be personal: shown apart, unticked, for the person to decide.
  sensitive boolean not null default false,
  content_hash text not null check (length(content_hash) between 8 and 128),
  source_date timestamptz,
  status text not null default 'pending' check (status in ('pending', 'saved')),
  saved_space_id uuid references public.memory_spaces (id) on delete set null,
  saved_entry_id uuid references public.memory_entries (id) on delete set null,
  saved_personal_id uuid references public.personal_memory (id) on delete set null,
  created_at timestamptz not null default now()
);
create index knowledge_import_items_import on public.knowledge_import_items (import_id, status);
create index knowledge_import_items_hash on public.knowledge_import_items (user_id, content_hash);

alter table public.knowledge_imports enable row level security;
alter table public.knowledge_import_items enable row level security;
revoke all on public.knowledge_imports, public.knowledge_import_items from anon;

create policy knowledge_imports_own on public.knowledge_imports
  for all to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

create policy knowledge_import_items_own on public.knowledge_import_items
  for all to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (
    user_id = (select auth.uid())
    and private.is_company_member(company_id)
    and exists (select 1 from public.knowledge_imports i where i.id = import_id and i.user_id = (select auth.uid()) and i.company_id = company_id)
  );

-- Memory entries can now come from an import (written with the person's own session, like the rest).
alter table public.memory_entries drop constraint memory_entries_source_type_check;
alter table public.memory_entries add constraint memory_entries_source_type_check
  check (source_type in ('manual', 'chat', 'ai_suggestion', 'promotion', 'auto', 'correction', 'import'));
drop policy memory_entries_insert on public.memory_entries;
create policy memory_entries_insert on public.memory_entries
  for insert to authenticated
  with check (
    private.can_write_space(space_id) and author_id = (select auth.uid()) and source_type in ('manual', 'chat', 'auto', 'import')
  );
