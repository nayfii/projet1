-- Our team, managed from our console (Plateforme → Équipe) instead of a hosting setting: a member of
-- our team adds an address; that person gets the console at their first sign-in with it (verified
-- e-mail), or at once if they already have an account. PLATFORM_ADMIN_EMAILS stays as a fallback.

create table public.platform_admin_invites (
  email text primary key check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.platform_admin_invites enable row level security;
revoke all on public.platform_admin_invites from anon, authenticated;
grant select on public.platform_admin_invites to authenticated;
create policy platform_admin_invites_select on public.platform_admin_invites
  for select to authenticated using ((select private.is_platform_admin()));

-- Our team, for the console: who, since when, and whether they also belong to a company (a separate
-- account is advised: in a company they see what its members see).
create function public.platform_team() returns table (user_id uuid, email text, full_name text, added_at timestamptz, in_company boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  return query
  select a.user_id, u.email::text, p.full_name, a.created_at,
         exists (select 1 from public.company_members m where m.user_id = a.user_id and m.status = 'active')
  from public.platform_admins a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  order by a.created_at;
end;
$$;

-- Adds an address: an existing account (verified e-mail) gets the console at once; otherwise the
-- invitation waits for the first sign-in. Returns 'added' or 'invited'.
create function public.platform_add_admin(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.fail('invalid_email'); end if;
  select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
  if v_user is not null then
    insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
    perform private.log_event('platform', null, 'platform_admin.granted', 'user', v_user::text);
    return 'added';
  end if;
  insert into public.platform_admin_invites (email, invited_by) values (v_email, (select auth.uid()))
  on conflict (email) do nothing;
  perform private.log_event('platform', null, 'platform_admin.invited', 'invitation', v_email);
  return 'invited';
end;
$$;

-- Removes someone from our team (never oneself, never the last one), or cancels an invitation.
create function public.platform_remove_admin(p_user uuid default null, p_email text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_user is not null then
    if p_user = (select auth.uid()) then perform private.fail('forbidden'); end if;
    if (select count(*) from public.platform_admins) <= 1 then perform private.fail('forbidden'); end if;
    delete from public.platform_admins where user_id = p_user;
    if not found then perform private.fail('not_found'); end if;
    perform private.log_event('platform', null, 'platform_admin.removed', 'user', p_user::text);
  elsif p_email is not null then
    delete from public.platform_admin_invites where email = lower(trim(p_email));
    if not found then perform private.fail('not_found'); end if;
    perform private.log_event('platform', null, 'platform_admin.invite_cancelled', 'invitation', lower(trim(p_email)));
  else
    perform private.fail('validation');
  end if;
end;
$$;

revoke execute on function public.platform_team(), public.platform_add_admin(text), public.platform_remove_admin(uuid, text) from public, anon;
grant execute on function public.platform_team(), public.platform_add_admin(text), public.platform_remove_admin(uuid, text) to authenticated;
