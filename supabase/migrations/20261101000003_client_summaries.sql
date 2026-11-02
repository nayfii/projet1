-- Step 12: the short automatic summary at the top of a client's page (CLAUDE.md §11). Built per person
-- from what they may open, so it is kept per person and only they read it.
create table public.client_summaries (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- What the summary was made from (counts and dates), to know when to make it again.
  fingerprint text not null check (length(fingerprint) <= 200),
  content text not null check (length(content) <= 3000),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
alter table public.client_summaries enable row level security;
revoke all on public.client_summaries from anon;
create policy client_summaries_own on public.client_summaries
  for all to authenticated
  using (user_id = (select auth.uid()) and private.has_client_access(client_id))
  with check (user_id = (select auth.uid()) and private.has_client_access(client_id) and private.is_company_member(company_id));
