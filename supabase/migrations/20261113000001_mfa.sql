-- Two-step sign-in (an authenticator app code, TOTP). Two rules, enforced here and not only in the app:
-- 1. Once a person has a verified second factor, every request of theirs needs a session that passed it
--    (Supabase's assurance level `aal2`): a stolen password or sign-in link alone opens nothing.
-- 2. Our team's powers (platform admin) always need `aal2`: our console is reachable only after the code.
-- The app asks for the code (or for setting one up) before anything else (src/lib/auth/guards.ts).

-- Whether this request's session satisfies rule 1.
create function private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      );
$$;

-- Rule 1 for every call through the API (tables and functions), checked once per request before it runs.
create function private.check_request() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.jwt() ->> 'role') = 'authenticated' and not private.mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request to 'private.check_request';
notify pgrst, 'reload config';

-- Rule 1 where requests do not go through the API: live updates (real time) and stored files.
create policy messages_mfa on public.messages as restrictive
  for select to authenticated using ((select private.mfa_satisfied()));
create policy conversation_participants_mfa on public.conversation_participants as restrictive
  for select to authenticated using ((select private.mfa_satisfied()));
create policy objects_mfa on storage.objects as restrictive
  for all to authenticated using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

-- Rule 2.
create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
     and exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- A member of our team can see that they are one before passing the code, so the app can ask for it
-- (or ask them to set it up). The row says nothing else.
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on function private.mfa_satisfied(), private.check_request() from public, anon;
grant execute on function private.mfa_satisfied(), private.check_request() to authenticated, service_role;
