-- Step 11: personal 3D avatars, made from a photo by an image model (docs/DESIGN.md §3).
--
-- * The photo itself is never stored: the server sends it to the image model and keeps only the result.
-- * Images live in a private bucket, read through /api/avatars/<user> (colleagues only).
-- * profiles.avatar_url can only point at that route, and only the server sets it.

-- ─── Profile picture ─────────────────────────────────────────────────────────
-- Earlier values could come from sign-in providers (external URLs, blocked by our CSP anyway).
update public.profiles set avatar_url = null where avatar_url is not null;
alter table public.profiles
  add column avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'),
  -- Last generated image, shown for approval and not used until the person chooses it.
  add column avatar_pending_path text check (avatar_pending_path is null or avatar_pending_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'),
  add constraint profiles_avatar_url_ours check (avatar_url is null or avatar_url ~ '^/api/avatars/[0-9a-f-]{36}\?v=[0-9a-f-]{36}$');
revoke update (avatar_url) on public.profiles from authenticated;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- No avatar from the sign-in provider: people create theirs in the app.
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    lower(new.email),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    case when new.raw_user_meta_data ->> 'locale' in ('fr', 'en') then new.raw_user_meta_data ->> 'locale' end
  );
  return new;
end;
$$;

-- ─── Storage ─────────────────────────────────────────────────────────────────
-- Private; no policy for signed-in people: only the server (service role) reads and writes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 4 * 1024 * 1024, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ─── Usage and rate ──────────────────────────────────────────────────────────
alter table public.usage_events drop constraint usage_events_feature_check;
alter table public.usage_events add constraint usage_events_feature_check
  check (feature in ('chat', 'memory', 'confronter', 'agent', 'embedding', 'handover', 'router', 'render', 'avatar'));

-- Credits charged per avatar generation and its estimated provider cost. Starting values only:
-- our team changes them in Platform → Modèles et tarifs.
alter table public.platform_settings
  add column avatar_credits numeric(10, 2) not null default 50 check (avatar_credits >= 0),
  add column avatar_cost_usd numeric(10, 4) not null default 0.05 check (avatar_cost_usd >= 0);

create function public.platform_set_avatar_rate(p_credits numeric, p_cost_usd numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then perform private.fail('forbidden'); end if;
  if p_credits is null or p_credits < 0 or p_credits > 100000 or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 100 then
    perform private.fail('validation');
  end if;
  update public.platform_settings
    set avatar_credits = p_credits, avatar_cost_usd = p_cost_usd, updated_by = (select auth.uid()), updated_at = now()
    where id;
  perform private.log_event('platform', null, 'settings.avatar_rate', 'platform_settings', 'avatar',
    jsonb_build_object('credits', p_credits, 'cost_usd', p_cost_usd));
end;
$$;
revoke execute on function public.platform_set_avatar_rate(numeric, numeric) from public, anon;
grant execute on function public.platform_set_avatar_rate(numeric, numeric) to authenticated;
