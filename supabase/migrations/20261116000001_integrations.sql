-- Integrations (CLAUDE.md §12, V1.1): one central layer for the business apps a company uses (Google
-- Workspace, Microsoft 365, Slack, Notion, Canva; extensible to CRMs). A connection serves the chat,
-- Consciousness and workflows, within the company's permissions.
--
-- - A PERSONAL connection (my Gmail) is used by its owner only. A COMPANY connection (the team's Slack)
--   is made by the Owner or an Admin with the "models" scope (AI and tools settings) and used by members.
-- - Tokens live in their own table that no signed-in person can read or write: only our server (service
--   role), encrypted (AES-256-GCM, key INTEGRATIONS_ENCRYPTION_KEY outside the database).
-- - Owners and those Admins see every connection's metadata and can revoke it; they never use a
--   personal connection. Our team (platform admins) sees nothing here.

create table public.company_integration_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- Providers the company has switched off (none by default).
  disabled_providers text[] not null default '{}',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.company_integration_settings enable row level security;
revoke all on public.company_integration_settings from anon, authenticated;
grant select on public.company_integration_settings to authenticated;
create policy company_integration_settings_read on public.company_integration_settings
  for select to authenticated using (private.is_company_member(company_id));

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  scope text not null check (scope in ('personal', 'company')),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- The connected account as the provider names it (an e-mail, a workspace name). No secret.
  account_label text check (length(account_label) <= 200),
  account_id text check (length(account_id) <= 200),
  -- The apps chosen at connection (e.g. gmail, calendar) and the permissions actually granted.
  apps text[] not null default '{}',
  granted_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  last_error text check (length(last_error) <= 200),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index integration_connections_company on public.integration_connections (company_id, provider);
create unique index integration_connections_one_live on public.integration_connections (company_id, provider, scope, owner_id) where status <> 'revoked';
create trigger integration_connections_updated_at before update on public.integration_connections
  for each row execute function private.touch_updated_at();
alter table public.integration_connections enable row level security;
revoke all on public.integration_connections from anon, authenticated;
grant select on public.integration_connections to authenticated;

-- Who may see a connection: its owner; for a company connection, every member; the Owner and Admins
-- with the "models" scope see them all (to govern and revoke). Writes go through our server only.
create policy integration_connections_read on public.integration_connections
  for select to authenticated using (
    private.is_company_member(company_id)
    and (owner_id = (select auth.uid()) or scope = 'company' or private.has_admin_scope(company_id, 'models'))
  );

create table public.integration_tokens (
  connection_id uuid primary key references public.integration_connections (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;

-- OAuth in progress: the state sent to the provider, the PKCE verifier, who started it. Ten minutes.
create table public.integration_oauth_states (
  state text primary key check (length(state) between 32 and 128),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  scope text not null check (scope in ('personal', 'company')),
  apps text[] not null default '{}',
  code_verifier text not null,
  created_at timestamptz not null default now()
);
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from anon, authenticated;
