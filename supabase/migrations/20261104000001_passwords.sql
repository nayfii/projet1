-- Sign-in with a password (founder's request, 2026-11-04), next to the e-mail link.
-- A password counts only when it was set in Cendr (profile, welcome screen or "forgot password" link),
-- which records `password_set_at`. Any other password on an account (for instance one set through the
-- Auth API by someone who created the account before its owner) is still cleared when the owner signs
-- in with a link, and refused at password sign-in.

alter table public.profiles add column password_set_at timestamptz;
-- Not in the profile's update grant: written only by mark_password_set().

create function public.mark_password_set() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  update public.profiles set password_set_at = now() where id = v_uid;
  -- In each company's activity log (metadata only, never the password).
  for v_company in select company_id from public.company_members where user_id = v_uid and status = 'active' loop
    perform private.log_event('company', v_company, 'auth.password_set', 'user', v_uid::text);
  end loop;
end;
$$;

revoke execute on function public.mark_password_set() from public, anon;
grant execute on function public.mark_password_set() to authenticated;
