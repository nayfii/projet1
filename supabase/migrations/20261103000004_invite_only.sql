-- Launch choice (CLAUDE.md §11): sign-up by invitation from our team only. Our team creates the company
-- with an Owner invitation (platform_create_company); creating one's own company stays closed unless our
-- team opens sign-up (Platform → Entreprises).

alter table public.platform_settings add column open_signup boolean not null default false;

-- Whether anyone signed in may create their own company (one boolean, nothing else).
create function public.signup_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.open_signup from public.platform_settings s limit 1), false);
$$;

create function public.platform_set_open_signup(p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  update public.platform_settings set open_signup = coalesce(p_open, false), updated_by = (select auth.uid()), updated_at = now() where id;
  perform private.log_event('platform', null, 'settings.signup', 'platform_settings', 'open_signup', jsonb_build_object('open', coalesce(p_open, false)));
end;
$$;

create or replace function public.create_company(
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
  if not public.signup_open() then perform private.fail('invite_only'); end if;
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

revoke execute on function public.signup_open(), public.platform_set_open_signup(boolean) from public, anon;
grant execute on function public.signup_open(), public.platform_set_open_signup(boolean) to authenticated;
