-- Step 4: Hide, sensitive data protection (CLAUDE.md §4.3).
-- Detection and masking run on our server. The model receives placeholders such as [IBAN_1]; the
-- mapping placeholder ↔ real value is stored per conversation in hide_mappings, readable only by the
-- server (service role), with the value encrypted by the application. Masking events are logged as
-- counts per category, never values.

-- ─── Company settings ────────────────────────────────────────────────────────
-- Default modes for new conversations and the categories Automatic mode masks. Amounts are off by
-- default (masking them breaks finance questions; open question 4 in docs/STATUS.md).
create table public.company_hide_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  default_modes text[] not null default '{automatic,documents}'
    check (default_modes <@ array['automatic', 'documents', 'manual']::text[]),
  auto_categories text[] not null default '{iban,card,email,phone,person,client,project,file,term}'
    check (auto_categories <@ array['iban', 'card', 'email', 'phone', 'amount', 'person', 'client', 'project', 'file', 'term']::text[]),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger company_hide_settings_updated_at before update on public.company_hide_settings
  for each row execute function private.touch_updated_at();

create function private.init_company_hide() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_hide_settings (company_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger companies_init_hide after insert on public.companies
  for each row execute function private.init_company_hide();
insert into public.company_hide_settings (company_id) select id from public.companies on conflict do nothing;

-- ─── Custom sensitive terms ──────────────────────────────────────────────────
-- Client nicknames, project and file names, other terms. The terms themselves are sensitive:
-- only the Owner and Admins with the "hide" scope can list them; detection reads them on the server.
create table public.sensitive_terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  term text not null check (length(trim(term)) between 2 and 200),
  category text not null check (category in ('client', 'project', 'file', 'term')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index sensitive_terms_unique on public.sensitive_terms (company_id, lower(trim(term)));

create function private.audit_sensitive_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The term is never logged, only its category.
  if tg_op = 'INSERT' then
    perform private.log_event('company', new.company_id, 'hide.term_added', 'sensitive_term', new.id::text,
      jsonb_build_object('category', new.category));
    return new;
  end if;
  perform private.log_event('company', old.company_id, 'hide.term_removed', 'sensitive_term', old.id::text,
    jsonb_build_object('category', old.category));
  return old;
end;
$$;
create trigger sensitive_terms_audit after insert or delete on public.sensitive_terms
  for each row execute function private.audit_sensitive_terms();

-- ─── Placeholder mappings (server only) ──────────────────────────────────────
create table public.hide_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  category text not null
    check (category in ('iban', 'card', 'email', 'phone', 'amount', 'person', 'client', 'project', 'file', 'term', 'redacted')),
  placeholder text not null check (placeholder ~ '^\[[A-Z]+_[0-9]+\]$'),
  -- HMAC of the normalised value (stable placeholder for the same value), and the value encrypted
  -- with AES-256-GCM by the application (key in HIDE_ENCRYPTION_KEY, never in the database).
  value_hash text not null,
  value_ciphertext text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, value_hash),
  unique (conversation_id, placeholder)
);

-- Gives each new value the next placeholder of its category in the conversation, atomically
-- (advisory lock: two answers in the same conversation cannot take the same number).
-- Returns every mapping of the conversation. Service role only.
create function public.hide_assign_placeholders(p_conversation uuid, p_items jsonb default '[]')
returns table (value_hash text, placeholder text, category text, value_ciphertext text)
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid;
  v_item jsonb;
  v_next integer;
begin
  select c.company_id into v_company from public.conversations c where c.id = p_conversation;
  if v_company is null then perform private.fail('not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation::text, 0));
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (select 1 from public.hide_mappings m where m.conversation_id = p_conversation and m.value_hash = v_item->>'hash') then
      select coalesce(max(substring(m.placeholder from '_([0-9]+)\]$')::integer), 0) + 1 into v_next
      from public.hide_mappings m where m.conversation_id = p_conversation and m.category = v_item->>'category';
      insert into public.hide_mappings (company_id, conversation_id, category, placeholder, value_hash, value_ciphertext)
      values (v_company, p_conversation, v_item->>'category', '[' || upper(v_item->>'category') || '_' || v_next || ']',
        v_item->>'hash', v_item->>'ciphertext');
    end if;
  end loop;
  return query
    select m.value_hash, m.placeholder, m.category, m.value_ciphertext
    from public.hide_mappings m where m.conversation_id = p_conversation;
end;
$$;

-- ─── What the AI received ────────────────────────────────────────────────────
-- messages.content keeps what people typed and the answer with real values restored (shown to
-- participants); masked_content is exactly what the model received or wrote. Written by the server only.
alter table public.messages
  add column masked_content text,
  add column hide_modes text[] not null default '{}'
    check (hide_modes <@ array['automatic', 'documents', 'manual']::text[]),
  add column hide_counts jsonb;
alter table public.conversation_attachments add column masked_text text;

-- ─── Admin settings RPC ──────────────────────────────────────────────────────
create function public.admin_update_hide_settings(p_company uuid, p_modes text[], p_categories text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_admin_scope(p_company, 'hide') then perform private.fail('forbidden'); end if;
  if not (coalesce(p_modes, '{}') <@ array['automatic', 'documents', 'manual']::text[])
     or not (coalesce(p_categories, '{}') <@ array['iban', 'card', 'email', 'phone', 'amount', 'person', 'client', 'project', 'file', 'term']::text[]) then
    perform private.fail('validation');
  end if;
  insert into public.company_hide_settings (company_id, default_modes, auto_categories, updated_by)
  values (p_company, array(select distinct unnest(coalesce(p_modes, '{}'))), array(select distinct unnest(coalesce(p_categories, '{}'))), (select auth.uid()))
  on conflict (company_id) do update
    set default_modes = excluded.default_modes, auto_categories = excluded.auto_categories, updated_by = excluded.updated_by;
  perform private.log_event('company', p_company, 'hide.settings_updated', 'company', p_company::text,
    jsonb_build_object('modes', coalesce(p_modes, '{}'), 'categories', coalesce(p_categories, '{}')));
end;
$$;

-- ─── RLS and grants ──────────────────────────────────────────────────────────
alter table public.company_hide_settings enable row level security;
alter table public.sensitive_terms enable row level security;
alter table public.hide_mappings enable row level security;

revoke all on public.company_hide_settings, public.sensitive_terms, public.hide_mappings from anon;
revoke all on public.hide_mappings from authenticated;
revoke truncate, trigger, references on public.company_hide_settings, public.sensitive_terms from authenticated;

-- Settings: members read the defaults (the mode control starts from them); changes through the RPC.
revoke insert, update, delete on public.company_hide_settings from authenticated;
create policy company_hide_settings_select on public.company_hide_settings
  for select to authenticated using ((select private.is_company_member(company_id)));

-- Terms: "hide" scope only, for reading as well as writing.
revoke insert, update, delete on public.sensitive_terms from authenticated;
grant insert (company_id, term, category) on public.sensitive_terms to authenticated;
grant delete on public.sensitive_terms to authenticated;
create policy sensitive_terms_select on public.sensitive_terms
  for select to authenticated using ((select private.has_admin_scope(company_id, 'hide')));
create policy sensitive_terms_insert on public.sensitive_terms
  for insert to authenticated
  with check ((select private.has_admin_scope(company_id, 'hide')) and created_by = (select auth.uid()));
create policy sensitive_terms_delete on public.sensitive_terms
  for delete to authenticated using ((select private.has_admin_scope(company_id, 'hide')));

-- hide_mappings: RLS on and no policy at all. Only the server's service role reads or writes it.

revoke execute on function public.hide_assign_placeholders(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hide_assign_placeholders(uuid, jsonb) to service_role;
revoke execute on function public.admin_update_hide_settings(uuid, text[], text[]) from public, anon;
grant execute on function public.admin_update_hide_settings(uuid, text[], text[]) to authenticated;
