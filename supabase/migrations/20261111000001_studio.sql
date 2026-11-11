-- Studio (founder's request, 2026-11-11): Scale becomes "Studio", four sections only — Overview,
-- Tasks, Roadmap, Knowledge. The tables keep their names; nothing is deleted. What the old Scale
-- held is carried into the new structure: projects and objectives become roadmap milestones (with
-- their tasks), tests, decisions, weekly reviews, indicators and simulations become Knowledge
-- documents. The old tables and columns stay as they are (no data removed without validation).

create extension if not exists pg_trgm with schema extensions;

-- ─── Categories: one list shared by documents, tasks and milestones ────────
create table public.scale_categories (
  id uuid primary key default gen_random_uuid(),
  -- The categories we start with have a key (their name follows the reader's language until renamed).
  key text unique check (key in ('strategy', 'product', 'marketing', 'growth', 'sales', 'finance', 'operations', 'legal')),
  name text check (length(trim(name)) between 1 and 60),
  icon text not null default 'folder' check (icon ~ '^[a-z-]{1,30}$'),
  sort_order double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key is not null or name is not null)
);

insert into public.scale_categories (key, icon, sort_order) values
  ('strategy', 'compass', 1),
  ('product', 'box', 2),
  ('marketing', 'megaphone', 3),
  ('growth', 'trending-up', 4),
  ('sales', 'handshake', 5),
  ('finance', 'wallet', 6),
  ('operations', 'settings', 7),
  ('legal', 'shield', 8);

create function private.studio_category(p_key text) returns uuid
language sql stable set search_path = '' as $$
  select id from public.scale_categories where key = p_key
$$;

-- ─── Tasks: three statuses, three priorities, a category ───────────────────
alter table public.scale_tasks add column category_id uuid references public.scale_categories (id) on delete set null;
create index scale_tasks_category on public.scale_tasks (category_id);

-- "Triage" is to do, "blocked" is in progress (its reason is kept), cancelled tasks go to the history.
update public.scale_tasks set status = 'todo' where status = 'triage';
update public.scale_tasks set status = 'in_progress' where status = 'blocked';
update public.scale_tasks set archived_at = coalesce(archived_at, updated_at) where status = 'cancelled';
update public.scale_tasks set priority = 'high' where priority = 'urgent';
update public.scale_tasks set priority = 'medium' where priority = 'none';
alter table public.scale_tasks drop constraint if exists scale_tasks_status_check;
alter table public.scale_tasks add constraint scale_tasks_status_check check (status in ('todo', 'in_progress', 'done', 'cancelled'));
alter table public.scale_tasks alter column status set default 'todo';
alter table public.scale_tasks drop constraint if exists scale_tasks_priority_check;
alter table public.scale_tasks add constraint scale_tasks_priority_check check (priority in ('high', 'medium', 'low'));
alter table public.scale_tasks alter column priority set default 'medium';

-- ─── Milestones: the roadmap's steps, on their own (no project needed) ─────
alter table public.scale_milestones alter column project_id drop not null;
alter table public.scale_milestones drop constraint if exists scale_milestones_project_id_fkey;
alter table public.scale_milestones add constraint scale_milestones_project_id_fkey foreign key (project_id) references public.scale_projects (id) on delete set null;
alter table public.scale_milestones
  add column category_id uuid references public.scale_categories (id) on delete set null,
  add column status text not null default 'planned' check (status in ('planned', 'in_progress', 'done')),
  add column legacy_project_id uuid unique,
  add column legacy_objective_id uuid unique;
create index scale_milestones_category on public.scale_milestones (category_id);

-- ─── Documents: category, tags, pinned, searchable text ────────────────────
create function private.studio_tags_ok(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(length(btrim(t)) between 1 and 40), true) and cardinality(p_tags) <= 20 from unnest(p_tags) t
$$;

-- Plain text of a document's blocks (internal links and formatting marks left out), for search.
create function private.studio_blocks_text(p_content jsonb) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(coalesce(string_agg(concat_ws(' ', b ->> 'text', b ->> 'body', b ->> 'url',
      (select string_agg(c, ' ') from jsonb_array_elements(case when jsonb_typeof(b -> 'rows') = 'array' then b -> 'rows' else '[]'::jsonb end) r,
        jsonb_array_elements_text(case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end) c)), E'\n'), ''),
    '\[\[doc:[0-9a-f-]{36}\]\]|\*\*|__', ' ', 'g'), 200000)
  from jsonb_array_elements(case when jsonb_typeof(p_content) = 'array' then p_content else '[]'::jsonb end) b
$$;

alter table public.scale_documents
  add column category_id uuid references public.scale_categories (id) on delete set null,
  add column tags text[] not null default '{}' check (private.studio_tags_ok(tags)),
  add column is_pinned boolean not null default false,
  add column body_text text not null default '',
  add column legacy_ref text unique check (length(legacy_ref) <= 80);
create index scale_documents_category on public.scale_documents (category_id);

create function private.studio_document_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.body_text := private.studio_blocks_text(new.content);
  return new;
end $$;
create trigger scale_documents_text before insert or update of content on public.scale_documents
  for each row execute function private.studio_document_text();
update public.scale_documents set body_text = private.studio_blocks_text(content);

-- ─── Links: a task or a milestone and the documents that go with it ────────
create table public.scale_task_documents (
  task_id uuid not null references public.scale_tasks (id) on delete cascade,
  document_id uuid not null references public.scale_documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, document_id)
);
create index scale_task_documents_document on public.scale_task_documents (document_id);

create table public.scale_milestone_documents (
  milestone_id uuid not null references public.scale_milestones (id) on delete cascade,
  document_id uuid not null references public.scale_documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (milestone_id, document_id)
);
create index scale_milestone_documents_document on public.scale_milestone_documents (document_id);

-- Documents each person opened lately ("Recently opened"): their own list only.
create table public.scale_document_visits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.scale_documents (id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

do $$
declare t text;
begin
  foreach t in array array['scale_categories', 'scale_task_documents', 'scale_milestone_documents']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()))', t || '_team', t);
  end loop;
end $$;
create trigger scale_categories_updated_at before update on public.scale_categories for each row execute function private.touch_updated_at();

alter table public.scale_document_visits enable row level security;
revoke all on public.scale_document_visits from anon, authenticated;
grant select, insert, update, delete on public.scale_document_visits to authenticated;
create policy scale_document_visits_own on public.scale_document_visits for all to authenticated
  using ((select private.is_platform_admin()) and user_id = (select auth.uid()))
  with check ((select private.is_platform_admin()) and user_id = (select auth.uid()));

-- ─── Search in documents, tolerant of small typos (titles, text, tags) ─────
create function public.studio_search_documents(p_query text, p_limit integer default 12)
returns table (id uuid, title text, category_id uuid, score real, body text)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select lower(unaccent(btrim(coalesce(p_query, '')))) as q)
  select d.id, d.title, d.category_id,
    greatest(
      word_similarity(q.q, lower(unaccent(d.title))) * 1.2 + case when strpos(lower(unaccent(d.title)), q.q) > 0 then 1 else 0 end,
      word_similarity(q.q, lower(unaccent(array_to_string(d.tags, ' ')))) * 1.1,
      word_similarity(q.q, lower(unaccent(d.body_text))) + case when strpos(lower(unaccent(d.body_text)), q.q) > 0 then 0.5 else 0 end
    )::real as score,
    left(d.body_text, 6000) as body
  from public.scale_documents d, q
  where d.archived_at is null
    and length(q.q) >= 2
    and (strpos(lower(unaccent(d.title || ' ' || array_to_string(d.tags, ' ') || ' ' || d.body_text)), q.q) > 0
      or word_similarity(q.q, lower(unaccent(d.title))) >= 0.45
      or word_similarity(q.q, lower(unaccent(array_to_string(d.tags, ' ')))) >= 0.5
      or word_similarity(q.q, lower(unaccent(d.body_text))) >= 0.55)
  order by score desc, d.updated_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 30)
$$;
revoke all on function public.studio_search_documents(text, integer) from public, anon;
grant execute on function public.studio_search_documents(text, integer) to authenticated;

-- Documents that link to a document ([[doc:<id>]] in their text).
create function public.studio_document_mentions(p_document uuid)
returns table (id uuid, title text)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.title from public.scale_documents d
  where d.id <> p_document and d.archived_at is null and strpos(d.content::text, '[[doc:' || p_document::text || ']]') > 0
  order by d.updated_at desc
  limit 30
$$;
revoke all on function public.studio_document_mentions(uuid) from public, anon;
grant execute on function public.studio_document_mentions(uuid) to authenticated;

-- ─── Carry the old Scale into the new structure (once; nothing removed) ────
create function private.studio_block(p_type text, p_text text, p_extra jsonb default '{}') returns jsonb
language sql volatile set search_path = '' as $$
  select case when p_text is null or btrim(p_text) = '' then null
    else jsonb_build_object('id', substr(md5(random()::text || clock_timestamp()::text), 1, 12), 'type', p_type, 'text', left(p_text, 20000)) || p_extra end
$$;
create function private.studio_section(p_title text, p_body text, p_type text default 'p') returns jsonb[]
language sql volatile set search_path = '' as $$
  select case when p_body is null or btrim(p_body) = '' then array[]::jsonb[]
    else array[private.studio_block('h3', p_title), private.studio_block(p_type, p_body)] end
$$;
create function private.studio_blocks(p_blocks jsonb[]) returns jsonb
language sql volatile set search_path = '' as $$
  select coalesce(jsonb_agg(x.b order by x.n), '[]'::jsonb) from unnest(p_blocks) with ordinality as x(b, n) where x.b is not null
$$;
create function private.studio_axis_category(p_axis text) returns uuid
language sql stable set search_path = '' as $$
  select private.studio_category(case p_axis when 'market' then 'strategy' when 'product' then 'product' when 'business' then 'finance'
    when 'acquisition' then 'growth' when 'operations' then 'operations' end)
$$;

-- Projects → milestones (their outcome and criterion in the description), their tasks follow.
insert into public.scale_milestones (title, description, target_date, achieved_date, status, category_id, sort_order, created_by, created_at, archived_at, legacy_project_id)
select p.title,
  nullif(left(concat_ws(E'\n\n', p.outcome, case when p.success_criterion is not null then 'Critère : ' || p.success_criterion end, p.description), 5000), ''),
  p.target_date, p.achieved_date,
  case p.status when 'done' then 'done' when 'active' then 'in_progress' else 'planned' end,
  private.studio_axis_category(p.axis), p.sort_order, p.created_by, p.created_at,
  case when p.status = 'cancelled' then coalesce(p.archived_at, p.updated_at) else p.archived_at end,
  p.id
from public.scale_projects p
on conflict (legacy_project_id) do nothing;

update public.scale_tasks t set milestone_id = m.id
from public.scale_milestones m
where m.legacy_project_id = t.project_id and t.milestone_id is null;

-- The projects' own milestones stay milestones, in their project's category.
update public.scale_milestones m set
  category_id = coalesce(m.category_id, private.studio_axis_category(p.axis)),
  status = case when m.achieved_date is not null then 'done' else m.status end
from public.scale_projects p
where p.id = m.project_id and m.legacy_project_id is null;

-- Objectives → milestones.
insert into public.scale_milestones (title, description, target_date, achieved_date, status, category_id, sort_order, created_by, created_at, archived_at, legacy_objective_id)
select o.title,
  nullif(left(concat_ws(E'\n\n', o.description,
    case when o.kind = 'numeric' and o.target is not null then concat_ws(' ', 'Cible :', o.target::text, o.unit, case when o.current_value is not null then '· actuel : ' || o.current_value::text end) end), 5000), ''),
  o.due_date,
  case when o.status = 'achieved' then o.updated_at::date end,
  case when o.status = 'achieved' or o.validation_state = 'validated' then 'done' else 'planned' end,
  private.studio_category('strategy'), o.sort_order, o.created_by, o.created_at,
  case when o.status in ('missed', 'dropped') then coalesce(o.archived_at, o.updated_at) else o.archived_at end,
  o.id
from public.scale_objectives o
on conflict (legacy_objective_id) do nothing;

update public.scale_tasks t set milestone_id = m.id
from public.scale_milestones m
where m.legacy_objective_id = t.objective_id and t.milestone_id is null;

-- Tasks take their milestone's category.
update public.scale_tasks t set category_id = m.category_id
from public.scale_milestones m
where m.id = t.milestone_id and t.category_id is null;

-- Documents: a category from their template or their project.
update public.scale_documents d set category_id = private.studio_category(case d.template_key
    when 'vision' then 'strategy' when 'icp' then 'strategy' when 'value_prop' then 'strategy' when 'competition' then 'strategy'
    when 'decision_log' then 'strategy' when 'offer_pricing' then 'finance' when 'business_plan' then 'finance'
    when 'acquisition' then 'growth' when 'launch' then 'growth' when 'meeting_notes' then 'operations' end)
where d.category_id is null;
update public.scale_documents d set category_id = private.studio_axis_category(p.axis)
from public.scale_projects p
where p.id = d.project_id and d.category_id is null;

-- Tests of hypotheses → documents.
insert into public.scale_documents (title, content, category_id, created_by, updated_by, created_at, archived_at, legacy_ref)
select t.title,
  private.studio_blocks(
    array[private.studio_block('p', concat_ws(' · ', 'Test de l''ancien Scale',
      'statut : ' || case t.status when 'to_prepare' then 'à préparer' when 'ready' then 'prêt' when 'running' then 'en cours'
        when 'to_analyze' then 'à analyser' when 'done' then 'terminé' else 'abandonné' end,
      case when t.start_date is not null then 'du ' || to_char(t.start_date, 'DD/MM/YYYY') end,
      case when t.end_date is not null then 'au ' || to_char(t.end_date, 'DD/MM/YYYY') end)),
      private.studio_block('hypothesis', t.hypothesis)]
    || private.studio_section('Pourquoi c''est important', t.importance)
    || private.studio_section('Protocole', t.protocol)
    || private.studio_section('Segment', t.segment)
    || private.studio_section('Mesures', t.metrics)
    || private.studio_section('Point de départ', t.baseline)
    || private.studio_section('Critère de réussite', t.success_criterion)
    || private.studio_section('Canal', t.channel)
    || private.studio_section('Public', t.audience)
    || private.studio_section('Budget', case when t.budget_planned is not null or t.budget_actual is not null then
         concat_ws(' · ', 'Prévu : ' || t.budget_planned::text, 'Réel : ' || t.budget_actual::text) end)
    || private.studio_section('Résultats', t.results)
    || private.studio_section('Limites', t.limits)
    || array[private.studio_block('decision', concat_ws(' — ', case t.conclusion when 'supported' then 'Hypothèse confirmée'
         when 'not_supported' then 'Hypothèse non confirmée' when 'inconclusive' then 'Résultat non concluant' end, t.conclusion_note))]
    || private.studio_section('Suite', concat_ws(E'\n', case t.continuation when 'continue' then 'Continuer' when 'adjust' then 'Ajuster' when 'stop' then 'Arrêter' end, t.next_actions))
    || coalesce((select array[private.studio_block('h3', 'Observations')] || array_agg(private.studio_block('bullet',
         concat_ws(' — ', to_char(o.observed_on, 'DD/MM/YYYY'), o.body || coalesce(' (' || o.value::text || coalesce(' ' || o.unit, '') || ')', '')))
         order by o.observed_on, o.created_at)
       from public.scale_observations o where o.test_id = t.id), array[]::jsonb[])
    || coalesce((select array[private.studio_block('h3', 'Avec et sans Cendr'),
         jsonb_build_object('id', substr(md5(random()::text || clock_timestamp()::text), 1, 12), 'type', 'table', 'text', '',
           'rows', jsonb_build_array(jsonb_build_array('Cas', 'Sans (min)', 'Avec (min)', 'Sans (coût)', 'Avec (coût)', 'Sans (qualité)', 'Avec (qualité)', 'Notes'))
             || jsonb_agg(jsonb_build_array(c.label, coalesce(c.without_minutes::text, ''), coalesce(c.with_minutes::text, ''),
                  coalesce(c.without_cost::text, ''), coalesce(c.with_cost::text, ''), coalesce(c.without_quality::text, ''),
                  coalesce(c.with_quality::text, ''), coalesce(c.notes, '')) order by c.sort_order, c.created_at))]
       from public.scale_test_comparisons c where c.test_id = t.id having count(*) > 0), array[]::jsonb[])
  ),
  private.studio_category(case t.category when 'product' then 'product' when 'price' then 'finance' when 'cost' then 'finance'
    when 'acquisition' then 'growth' else 'strategy' end),
  t.created_by, t.created_by, t.created_at,
  case when t.status = 'abandoned' then coalesce(t.archived_at, t.updated_at) else t.archived_at end,
  'test:' || t.id
from public.scale_tests t
on conflict (legacy_ref) do nothing;

-- Decisions → documents.
insert into public.scale_documents (title, content, category_id, created_by, updated_by, created_at, archived_at, legacy_ref)
select left(d.subject, 200),
  private.studio_blocks(
    array[private.studio_block('p', concat_ws(' · ', 'Décision de l''ancien Scale',
        case d.status when 'pending' then 'à prendre' when 'decided' then 'prise' else 'revue' end,
        case when d.decided_on is not null then 'le ' || to_char(d.decided_on, 'DD/MM/YYYY') end)),
      private.studio_block('decision', d.choice)]
    || private.studio_section('Options', d.options)
    || private.studio_section('Raisons', d.reasons)
    || private.studio_section('Éléments', d.evidence)
    || private.studio_section('À revoir', concat_ws(' — ', case when d.review_on is not null then 'le ' || to_char(d.review_on, 'DD/MM/YYYY') end, d.review_condition))
  ),
  private.studio_category('strategy'), d.created_by, d.created_by, d.created_at, d.archived_at, 'decision:' || d.id
from public.scale_decisions d
on conflict (legacy_ref) do nothing;

-- Weekly reviews → documents.
insert into public.scale_documents (title, content, category_id, created_by, updated_by, created_at, legacy_ref)
select 'Revue de la semaine du ' || to_char(r.week_start, 'DD/MM/YYYY'),
  private.studio_blocks(
    private.studio_section('Ce qui est fait', r.done_summary)
    || private.studio_section('Ce qu''on a appris', r.learned)
    || private.studio_section('Ce qui bloque', r.blocked)
    || private.studio_section('Décisions à prendre', r.decisions)
    || private.studio_section('Prochaines priorités', r.next_priorities)
  ),
  private.studio_category('operations'), r.created_by, r.created_by, r.updated_at, 'review:' || r.week_start
from public.scale_weekly_reviews r
where concat(r.done_summary, r.learned, r.blocked, r.decisions, r.next_priorities) <> ''
on conflict (legacy_ref) do nothing;

-- Indicators and simulations → one document each (only when there are some).
insert into public.scale_documents (title, content, category_id, legacy_ref)
select 'Indicateurs (ancien Scale)',
  jsonb_build_array(
    jsonb_build_object('id', substr(md5(random()::text), 1, 12), 'type', 'p', 'text', 'Définitions et dernières valeurs saisies dans l''ancien Scale.'),
    jsonb_build_object('id', substr(md5(random()::text || '1'), 1, 12), 'type', 'table', 'text', '',
      'rows', jsonb_build_array(jsonb_build_array('Indicateur', 'Définition', 'Unité', 'Période', 'Dernière valeur', 'Date'))
        || jsonb_agg(jsonb_build_array(m.name, coalesce(m.definition, ''), coalesce(m.unit, ''), m.period,
             coalesce((select v.value::text from public.scale_measurements v where v.metric_id = m.id and v.kind = 'actual' order by v.period_start desc limit 1), ''),
             coalesce((select to_char(v.period_start, 'DD/MM/YYYY') from public.scale_measurements v where v.metric_id = m.id and v.kind = 'actual' order by v.period_start desc limit 1), ''))
           order by m.sort_order, m.created_at))),
  private.studio_category('finance'), 'metrics'
from public.scale_metrics m
where m.archived_at is null
having count(*) > 0
on conflict (legacy_ref) do nothing;

insert into public.scale_documents (title, content, category_id, legacy_ref)
select 'Simulations (ancien Scale)',
  private.studio_blocks(array_agg(b order by n)),
  private.studio_category('finance'), 'simulations'
from (
  select x.b, row_number() over (order by s.created_at, s.id, x.k) as n
  from public.scale_simulations s,
    lateral unnest(array[private.studio_block('h3', s.name), private.studio_block('p', s.note),
      private.studio_block('p', (select string_agg(k || ' : ' || v, ' · ') from jsonb_each_text(s.inputs) as e(k, v)))]) with ordinality as x(b, k)
  where s.archived_at is null
) blocks
having count(*) > 0
on conflict (legacy_ref) do nothing;

drop function private.studio_block(text, text, jsonb);
drop function private.studio_section(text, text, text);
drop function private.studio_blocks(jsonb[]);
drop function private.studio_axis_category(text);
