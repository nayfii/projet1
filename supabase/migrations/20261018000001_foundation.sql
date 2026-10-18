-- Foundation: identity, companies, roles, invitations, members, teams, clients, plans, audit.
-- Every tenant table carries company_id and has RLS enabled. Helper functions live in the
-- non-exposed "private" schema. Writes that need business rules go through SECURITY DEFINER RPCs.

-- ─── Schemas, privileges ─────────────────────────────────────────────────────
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- anon never needs direct table access in this product.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges in schema private revoke execute on functions from anon, public;

-- ─── Types ───────────────────────────────────────────────────────────────────
create type public.company_role as enum ('owner', 'admin', 'member');
create type public.member_status as enum ('active', 'deactivated');
create type public.company_status as enum ('active', 'suspended');
create type public.client_visibility as enum ('open', 'restricted');

-- Admin scopes an Owner can delegate to an Admin.
create function private.valid_admin_scopes(scopes text[]) returns boolean
language sql immutable set search_path = '' as $$
  select scopes <@ array['company','members','clients','permissions','models','agents','hide','usage','quotas','activity']::text[];
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Platform ────────────────────────────────────────────────────────────────
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  -- Display only. Prices are never hardcoded in the app; the platform admin writes this label.
  price_label text,
  seat_limit integer check (seat_limit is null or seat_limit > 0),
  monthly_credits bigint not null default 0 check (monthly_credits >= 0),
  video_credits bigint not null default 0 check (video_credits >= 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_single_default on public.plans (is_default) where is_default;
create trigger plans_updated_at before update on public.plans
  for each row execute function private.touch_updated_at();

-- ─── Identity ────────────────────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  plan_id uuid references public.plans (id) on delete set null,
  status public.company_status not null default 'active',
  industry text check (length(industry) <= 120),
  size_range text check (size_range in ('1-5', '6-10', '11-25', '26-50', '51-200', '200+')),
  description text check (length(description) <= 2000),
  website text check (length(website) <= 300),
  default_locale text not null default 'fr' check (default_locale in ('fr', 'en')),
  onboarding_completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger companies_updated_at before update on public.companies
  for each row execute function private.touch_updated_at();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (length(full_name) <= 120),
  avatar_url text,
  locale text check (locale in ('fr', 'en')),
  active_company_id uuid references public.companies (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- References profiles (which cascade from auth.users) so the API can embed names.
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.company_role not null default 'member',
  admin_scopes text[] not null default '{}' check (private.valid_admin_scopes(admin_scopes)),
  status public.member_status not null default 'active',
  job_title text check (length(job_title) <= 120),
  team_id uuid,
  expertise text[] not null default '{}' check (cardinality(expertise) <= 20),
  who_can_help_opt_out boolean not null default false,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (team_id, company_id) references public.teams (id, company_id) on delete set null (team_id),
  -- Scopes only make sense for Admins.
  check (role = 'admin' or admin_scopes = '{}')
);
create unique index company_members_single_owner on public.company_members (company_id) where role = 'owner';
create index company_members_user on public.company_members (user_id);
create trigger company_members_updated_at before update on public.company_members
  for each row execute function private.touch_updated_at();

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role public.company_role not null default 'member',
  admin_scopes text[] not null default '{}' check (private.valid_admin_scopes(admin_scopes)),
  job_title text check (length(job_title) <= 120),
  expertise text[] not null default '{}',
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create unique index invitations_one_pending on public.invitations (company_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_email on public.invitations (email);

-- ─── Clients ─────────────────────────────────────────────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  visibility public.client_visibility not null default 'open',
  sector text check (length(sector) <= 120),
  description text check (length(description) <= 4000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, company_id)
);
create index clients_company on public.clients (company_id);
create trigger clients_updated_at before update on public.clients
  for each row execute function private.touch_updated_at();

create table public.client_assignments (
  client_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  assigned_by uuid default auth.uid() references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade,
  -- Lets the API embed the assignee's name.
  constraint client_assignments_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index client_assignments_user on public.client_assignments (user_id);

-- ─── Audit ───────────────────────────────────────────────────────────────────
-- Metadata only: never prompt content, document content or masked values.
create table public.audit_log (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('company', 'platform')),
  company_id uuid references public.companies (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (scope = 'platform' or company_id is not null)
);
create index audit_log_company on public.audit_log (company_id, created_at desc);
create index audit_log_platform on public.audit_log (created_at desc) where scope = 'platform';

-- ─── Helper functions (used by policies and RPCs) ────────────────────────────
create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- Active member of an active company.
create function private.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and c.status = 'active'
  );
$$;

create function private.member_role(p_company uuid) returns public.company_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and c.status = 'active';
$$;

create function private.is_company_owner(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.member_role(p_company) = 'owner', false);
$$;

-- Owner always; Admin only for the scopes the Owner delegated.
create function private.has_admin_scope(p_company uuid, p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and c.status = 'active'
      and (m.role = 'owner' or (m.role = 'admin' and p_scope = any (m.admin_scopes)))
  );
$$;

-- Owner, or any member for an Open client, or an assigned member for a Restricted client.
create function private.has_client_access(p_client uuid) returns boolean
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
          where a.client_id = cl.id and a.user_id = m.user_id
        )
      )
  );
$$;

create function private.shares_company_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.company_members mine
    join public.company_members theirs on theirs.company_id = mine.company_id
    join public.companies c on c.id = mine.company_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and c.status = 'active'
      and theirs.user_id = p_user
  );
$$;

create function private.log_event(
  p_scope text, p_company uuid, p_action text, p_target_type text, p_target_id text, p_metadata jsonb default '{}'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (scope, company_id, actor_id, action, target_type, target_id, metadata)
  values (p_scope, p_company, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'));
$$;

-- Raises a stable, translatable error code (the app maps it to a message).
create function private.fail(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ─── New user → profile ──────────────────────────────────────────────────────
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, locale)
  values (
    new.id,
    lower(new.email),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    new.raw_user_meta_data ->> 'avatar_url',
    case when new.raw_user_meta_data ->> 'locale' in ('fr', 'en') then new.raw_user_meta_data ->> 'locale' end
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ─── Automatic audit of permission-relevant changes ──────────────────────────
-- Triggers log every change, whichever path made it (API, RPC, admin tools). Names and
-- descriptions are never copied into the log: only ids and the changed setting.
create function private.audit_clients() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_event('company', new.company_id, 'client.created', 'client', new.id::text,
      jsonb_build_object('visibility', new.visibility));
  elsif tg_op = 'UPDATE' then
    if new.visibility is distinct from old.visibility then
      perform private.log_event('company', new.company_id, 'client.visibility_changed', 'client', new.id::text,
        jsonb_build_object('from', old.visibility, 'to', new.visibility));
    end if;
    if new.archived_at is distinct from old.archived_at then
      perform private.log_event('company', new.company_id,
        case when new.archived_at is null then 'client.restored' else 'client.archived' end, 'client', new.id::text);
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_event('company', old.company_id, 'client.deleted', 'client', old.id::text);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function private.audit_clients();

create function private.audit_client_assignments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_event('company', new.company_id, 'client.assigned', 'client', new.client_id::text,
      jsonb_build_object('user_id', new.user_id));
  else
    perform private.log_event('company', old.company_id, 'client.unassigned', 'client', old.client_id::text,
      jsonb_build_object('user_id', old.user_id));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger client_assignments_audit after insert or delete on public.client_assignments
  for each row execute function private.audit_client_assignments();

create function private.audit_plans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_event('platform', null,
    case tg_op when 'INSERT' then 'plan.created' when 'UPDATE' then 'plan.updated' else 'plan.deleted' end,
    'plan', coalesce(new.id, old.id)::text);
  return coalesce(new, old);
end;
$$;
create trigger plans_audit after insert or update or delete on public.plans
  for each row execute function private.audit_plans();

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.platform_admins enable row level security;
alter table public.plans enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.company_members enable row level security;
alter table public.invitations enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
-- TRUNCATE bypasses RLS: never grant it (nor TRIGGER / REFERENCES) to API roles.
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- platform_admins: readable by platform admins only; managed outside the API.
revoke insert, update, delete on public.platform_admins from authenticated;
create policy platform_admins_select on public.platform_admins
  for select to authenticated using ((select private.is_platform_admin()));

-- plans: managed by platform admins; a company member can read the plan of their company.
create policy plans_platform_all on public.plans
  for all to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));
create policy plans_member_select on public.plans
  for select to authenticated
  using (exists (
    select 1 from public.companies c
    where c.plan_id = plans.id and private.is_company_member(c.id)
  ));

-- companies: members read; profile fields editable with the "company" scope.
-- Creation, plan and status changes go through RPCs (platform-controlled fields).
revoke insert, delete, update on public.companies from authenticated;
grant update (name, industry, size_range, description, website, default_locale, onboarding_completed_at)
  on public.companies to authenticated;
create policy companies_member_select on public.companies
  for select to authenticated using ((select private.is_company_member(id)));
create policy companies_admin_update on public.companies
  for update to authenticated
  using ((select private.has_admin_scope(id, 'company')))
  with check ((select private.has_admin_scope(id, 'company')));

-- profiles: own profile, and colleagues' profiles (name, avatar) inside a shared company.
revoke insert, delete, update on public.profiles from authenticated;
grant update (full_name, avatar_url, locale, active_company_id) on public.profiles to authenticated;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_company_with(id)));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (active_company_id is null or private.is_company_member(active_company_id))
  );

-- teams
create policy teams_member_select on public.teams
  for select to authenticated using ((select private.is_company_member(company_id)));
create policy teams_admin_write on public.teams
  for all to authenticated
  using ((select private.has_admin_scope(company_id, 'members')))
  with check ((select private.has_admin_scope(company_id, 'members')));

-- company_members: colleagues are visible to each other (name, role, expertise for Who Can Help).
-- All changes go through RPCs that enforce the role rules.
revoke insert, update, delete on public.company_members from authenticated;
create policy company_members_select on public.company_members
  for select to authenticated
  using ((select private.is_company_member(company_id)));

-- invitations: visible to people managing members; created / revoked through RPCs.
revoke insert, update, delete on public.invitations from authenticated;
create policy invitations_admin_select on public.invitations
  for select to authenticated
  using ((select private.has_admin_scope(company_id, 'members')));

-- clients
create policy clients_select on public.clients
  for select to authenticated
  using (private.has_client_access(id) or private.has_admin_scope(company_id, 'clients'));
create policy clients_insert on public.clients
  for insert to authenticated
  with check (private.has_admin_scope(company_id, 'clients') and created_by = (select auth.uid()));
create policy clients_update on public.clients
  for update to authenticated
  using (private.has_admin_scope(company_id, 'clients'))
  with check (private.has_admin_scope(company_id, 'clients'));
create policy clients_delete on public.clients
  for delete to authenticated
  using (private.is_company_owner(company_id));

-- client_assignments
create policy client_assignments_select on public.client_assignments
  for select to authenticated
  using (private.has_client_access(client_id) or private.has_admin_scope(company_id, 'clients'));
create policy client_assignments_insert on public.client_assignments
  for insert to authenticated
  with check (private.has_admin_scope(company_id, 'clients') and assigned_by = (select auth.uid()));
create policy client_assignments_delete on public.client_assignments
  for delete to authenticated
  using (private.has_admin_scope(company_id, 'clients'));
revoke update on public.client_assignments from authenticated;

-- audit_log: company activity for the "activity" scope; platform events for platform admins.
revoke insert, update, delete on public.audit_log from authenticated;
create policy audit_company_select on public.audit_log
  for select to authenticated
  using (scope = 'company' and private.has_admin_scope(company_id, 'activity'));
create policy audit_platform_select on public.audit_log
  for select to authenticated
  using (scope = 'platform' and (select private.is_platform_admin()));

-- ─── Company RPCs ────────────────────────────────────────────────────────────
create function public.create_company(
  p_name text,
  p_industry text default null,
  p_size_range text default null,
  p_description text default null,
  p_website text default null,
  p_default_locale text default 'fr'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if exists (select 1 from public.company_members where user_id = v_uid and status = 'active') then
    perform private.fail('already_in_company');
  end if;

  insert into public.companies (name, plan_id, industry, size_range, description, website, default_locale, created_by)
  values (
    trim(p_name),
    (select id from public.plans where is_default and is_active limit 1),
    nullif(trim(p_industry), ''), p_size_range, nullif(trim(p_description), ''), nullif(trim(p_website), ''),
    coalesce(p_default_locale, 'fr'), v_uid
  )
  returning id into v_company;

  insert into public.company_members (company_id, user_id, role) values (v_company, v_uid, 'owner');
  update public.profiles set active_company_id = v_company where id = v_uid;
  perform private.log_event('company', v_company, 'company.created', 'company', v_company::text);
  return v_company;
end;
$$;

-- Updates the caller's own member card (job title, expertise, Who Can Help opt-out).
create function public.update_my_member_card(
  p_company uuid, p_job_title text, p_expertise text[], p_opt_out boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_company_member(p_company) then perform private.fail('forbidden'); end if;
  update public.company_members
     set job_title = nullif(trim(p_job_title), ''),
         expertise = coalesce(
           (select array_agg(distinct trim(e)) from unnest(p_expertise) e where trim(e) <> ''),
           '{}'),
         who_can_help_opt_out = coalesce(p_opt_out, false)
   where company_id = p_company and user_id = (select auth.uid());
end;
$$;

create function public.create_invitation(
  p_company uuid,
  p_email text,
  p_role public.company_role default 'member',
  p_admin_scopes text[] default '{}',
  p_job_title text default null,
  p_expertise text[] default '{}'
) returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_seat_limit integer;
  v_used integer;
  v_id uuid;
begin
  if not private.has_admin_scope(p_company, 'members') then perform private.fail('forbidden'); end if;
  if p_role = 'owner' then perform private.fail('forbidden'); end if;
  -- Only the Owner creates Admins and decides their scopes.
  if (p_role = 'admin' or coalesce(cardinality(p_admin_scopes), 0) > 0) and not private.is_company_owner(p_company) then
    perform private.fail('owner_only');
  end if;
  if p_role <> 'admin' and coalesce(cardinality(p_admin_scopes), 0) > 0 then perform private.fail('invalid_scopes'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.fail('invalid_email'); end if;
  if exists (
    select 1 from public.company_members m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and p.email = v_email
  ) then
    perform private.fail('already_member');
  end if;

  select pl.seat_limit into v_seat_limit
  from public.companies c left join public.plans pl on pl.id = c.plan_id where c.id = p_company;
  if v_seat_limit is not null then
    select (select count(*) from public.company_members where company_id = p_company and status = 'active')
         + (select count(*) from public.invitations
            where company_id = p_company and accepted_at is null and revoked_at is null
              and expires_at > now() and email <> v_email)
      into v_used;
    if v_used >= v_seat_limit then perform private.fail('seat_limit_reached'); end if;
  end if;

  -- A new invitation replaces any pending one for the same address.
  update public.invitations set revoked_at = now()
   where company_id = p_company and email = v_email and accepted_at is null and revoked_at is null;

  insert into public.invitations (company_id, email, role, admin_scopes, job_title, expertise, token_hash, invited_by)
  values (
    p_company, v_email, p_role, coalesce(p_admin_scopes, '{}'), nullif(trim(p_job_title), ''),
    coalesce((select array_agg(distinct trim(e)) from unnest(p_expertise) e where trim(e) <> ''), '{}'),
    encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid())
  )
  returning id into v_id;

  perform private.log_event('company', p_company, 'invitation.created', 'invitation', v_id::text,
    jsonb_build_object('role', p_role));
  return query select v_id, v_token;
end;
$$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.invitations where id = p_invitation;
  if v_company is null or not private.has_admin_scope(v_company, 'members') then perform private.fail('forbidden'); end if;
  update public.invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  perform private.log_event('company', v_company, 'invitation.revoked', 'invitation', p_invitation::text);
end;
$$;

-- Pending invitations addressed to the signed-in user's email (no token exposed).
create function public.my_pending_invitations()
returns table (invitation_id uuid, company_id uuid, company_name text, role public.company_role, invited_by_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.company_id, c.name, i.role, p.full_name, i.expires_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  left join public.profiles p on p.id = i.invited_by
  where i.email = (select lower(email) from auth.users where id = (select auth.uid()))
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    and c.status = 'active';
$$;

-- Accepts an invitation by id (the signed-in email must match) or by token (from the email link).
create function public.accept_invitation(p_invitation uuid default null, p_token text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_inv public.invitations;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  select lower(email) into v_email from auth.users where id = v_uid;

  if p_token is not null then
    select * into v_inv from public.invitations
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  else
    select * into v_inv from public.invitations where id = p_invitation;
  end if;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    perform private.fail('invitation_invalid');
  end if;
  if v_inv.email <> v_email then perform private.fail('invitation_wrong_email'); end if;
  if not exists (select 1 from public.companies where id = v_inv.company_id and status = 'active') then
    perform private.fail('company_suspended');
  end if;
  if v_inv.role = 'owner' and exists (select 1 from public.company_members where company_id = v_inv.company_id and role = 'owner') then
    perform private.fail('invitation_invalid');
  end if;

  insert into public.company_members (company_id, user_id, role, admin_scopes, job_title, expertise)
  values (v_inv.company_id, v_uid, v_inv.role, v_inv.admin_scopes, v_inv.job_title, v_inv.expertise)
  on conflict (company_id, user_id) do update
    set status = 'active', deactivated_at = null, role = excluded.role, admin_scopes = excluded.admin_scopes;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  update public.profiles set active_company_id = v_inv.company_id where id = v_uid and active_company_id is null;
  perform private.log_event('company', v_inv.company_id, 'invitation.accepted', 'invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role));
  return v_inv.company_id;
end;
$$;

-- Admin changes to a colleague: role, scopes, status, job title, team, expertise.
create function public.admin_update_member(
  p_company uuid,
  p_user uuid,
  p_role public.company_role default null,
  p_admin_scopes text[] default null,
  p_status public.member_status default null,
  p_job_title text default null,
  p_team uuid default null,
  p_expertise text[] default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.company_members;
  v_is_owner boolean := private.is_company_owner(p_company);
  v_new_role public.company_role;
begin
  if not private.has_admin_scope(p_company, 'members') then perform private.fail('forbidden'); end if;
  select * into v_target from public.company_members where company_id = p_company and user_id = p_user;
  if v_target.user_id is null then perform private.fail('not_found'); end if;
  if v_target.role = 'owner' then perform private.fail('owner_protected'); end if;
  if p_user = (select auth.uid()) and p_status = 'deactivated' then perform private.fail('cannot_deactivate_self'); end if;
  if p_role = 'owner' then perform private.fail('forbidden'); end if;
  -- Promotions, demotions and scope changes are reserved to the Owner. Admins manage Members only.
  if not v_is_owner and (p_role is not null or p_admin_scopes is not null or v_target.role = 'admin') then
    perform private.fail('owner_only');
  end if;

  v_new_role := coalesce(p_role, v_target.role);
  update public.company_members set
    role = v_new_role,
    admin_scopes = case when v_new_role = 'admin' then coalesce(p_admin_scopes, admin_scopes) else '{}' end,
    status = coalesce(p_status, status),
    deactivated_at = case
      when p_status = 'deactivated' and status = 'active' then now()
      when p_status = 'active' then null
      else deactivated_at end,
    job_title = case when p_job_title is null then job_title else nullif(trim(p_job_title), '') end,
    team_id = coalesce(p_team, team_id),
    expertise = case when p_expertise is null then expertise
      else coalesce((select array_agg(distinct trim(e)) from unnest(p_expertise) e where trim(e) <> ''), '{}') end
  where company_id = p_company and user_id = p_user;

  perform private.log_event('company', p_company, 'member.updated', 'member', p_user::text,
    jsonb_strip_nulls(jsonb_build_object(
      'role', p_role, 'scopes_changed', p_admin_scopes is not null, 'status', p_status,
      'expertise_changed', p_expertise is not null)));
end;
$$;

-- Records a sign-in in the company activity log (called by the server after authentication).
create function public.record_sign_in() returns void
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  for v_company in
    select company_id from public.company_members where user_id = (select auth.uid()) and status = 'active'
  loop
    perform private.log_event('company', v_company, 'auth.sign_in', 'user', (select auth.uid())::text);
  end loop;
end;
$$;

-- ─── Platform RPCs (metadata only, never content) ────────────────────────────
create function public.platform_list_companies()
returns table (
  id uuid, name text, status public.company_status, plan_id uuid, plan_name text,
  seat_limit integer, active_seats bigint, pending_invitations bigint, owner_email text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select c.id, c.name, c.status, c.plan_id, pl.name, pl.seat_limit,
    (select count(*) from public.company_members m where m.company_id = c.id and m.status = 'active'),
    (select count(*) from public.invitations i where i.company_id = c.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    coalesce(
      (select p.email from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = c.id and m.role = 'owner'),
      (select i.email from public.invitations i where i.company_id = c.id and i.role = 'owner' and i.accepted_at is null and i.revoked_at is null order by i.created_at desc limit 1)
    ),
    c.created_at
  from public.companies c
  left join public.plans pl on pl.id = c.plan_id
  order by c.created_at desc;
end;
$$;

-- Creates a company with no members and an Owner invitation. Returns the invitation token for the email.
create function public.platform_create_company(p_name text, p_plan uuid, p_owner_email text)
returns table (company_id uuid, invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email text := lower(trim(p_owner_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_inv uuid;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.fail('invalid_email'); end if;
  insert into public.companies (name, plan_id, created_by) values (trim(p_name), p_plan, (select auth.uid()))
  returning id into v_company;
  insert into public.invitations (company_id, email, role, token_hash, invited_by, expires_at)
  values (v_company, v_email, 'owner', encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()), now() + interval '14 days')
  returning id into v_inv;
  perform private.log_event('platform', null, 'company.created', 'company', v_company::text, jsonb_build_object('plan_id', p_plan));
  return query select v_company, v_inv, v_token;
end;
$$;

create function public.platform_update_company(p_company uuid, p_plan uuid default null, p_status public.company_status default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  update public.companies
     set plan_id = coalesce(p_plan, plan_id), status = coalesce(p_status, status)
   where id = p_company;
  if not found then perform private.fail('not_found'); end if;
  perform private.log_event('platform', null, 'company.updated', 'company', p_company::text,
    jsonb_strip_nulls(jsonb_build_object('plan_id', p_plan, 'status', p_status)));
end;
$$;

-- The signed-in user's memberships, including suspended companies (so the app can explain why).
create function public.my_memberships()
returns table (company_id uuid, company_name text, company_status public.company_status, role public.company_role,
               admin_scopes text[], member_status public.member_status, onboarding_completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.status, m.role, m.admin_scopes, m.status, c.onboarding_completed_at
  from public.company_members m join public.companies c on c.id = m.company_id
  where m.user_id = (select auth.uid())
  order by m.joined_at;
$$;

-- RPC exposure: authenticated users only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
