-- Search by meaning compares only vectors built by the embeddings model in use: after a change of
-- embeddings provider, older vectors are not comparable (they are still found by their words).
drop function public.match_memory(uuid[], text, extensions.vector, integer, double precision);

create function public.match_memory(
  p_space_ids uuid[],
  p_keywords text,
  p_embedding extensions.vector(1536) default null,
  p_limit integer default 6,
  p_min_similarity double precision default 0.25,
  p_embedding_model text default null
)
returns table (
  source_type text, id uuid, document_id uuid, space_id uuid, title text, content text,
  page integer, char_start integer, char_end integer, source_date timestamptz, score double precision
)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('simple', private.unaccent_immutable(coalesce(p_keywords, ''))) as tsq,
           greatest(coalesce(p_limit, 6), 1) * 4 as pool
  ),
  by_meaning as (
    select hit.id, row_number() over (order by hit.distance) as rank
    from (
      (select ch.id, ch.embedding operator(extensions.<=>) p_embedding as distance
       from public.document_chunks ch
       where p_embedding is not null and ch.space_id = any (p_space_ids) and ch.embedding is not null
         and (p_embedding_model is null or ch.embedding_model = p_embedding_model)
       order by distance limit (select pool from q))
      union all
      (select e.id, e.embedding operator(extensions.<=>) p_embedding
       from public.memory_entries e
       where p_embedding is not null and e.space_id = any (p_space_ids) and e.embedding is not null
         and (p_embedding_model is null or e.embedding_model = p_embedding_model)
       order by 2 limit (select pool from q))
    ) hit
    where 1 - hit.distance >= p_min_similarity
  ),
  by_words as (
    select hit.id, row_number() over (order by hit.rank_value desc) as rank
    from (
      (select ch.id, ts_rank(to_tsvector('simple', private.unaccent_immutable(ch.content)), q.tsq) as rank_value
       from public.document_chunks ch, q
       where ch.space_id = any (p_space_ids)
         and to_tsvector('simple', private.unaccent_immutable(ch.content)) @@ q.tsq
       order by rank_value desc limit (select pool from q))
      union all
      (select e.id, ts_rank(to_tsvector('simple', private.unaccent_immutable(e.title || ' ' || e.content)), q.tsq)
       from public.memory_entries e, q
       where e.space_id = any (p_space_ids)
         and to_tsvector('simple', private.unaccent_immutable(e.title || ' ' || e.content)) @@ q.tsq
       order by 2 desc limit (select pool from q))
    ) hit
  ),
  fused as (
    select r.id, sum(1.0 / (60 + r.rank)) as score
    from (select id, rank from by_meaning union all select id, rank from by_words) r
    group by r.id
  )
  select * from (
    select 'document_chunk'::text, ch.id, ch.document_id, ch.space_id, d.filename, ch.content, ch.page,
           ch.char_start, ch.char_end, d.created_at, f.score::double precision
    from fused f
    join public.document_chunks ch on ch.id = f.id
    join public.documents d on d.id = ch.document_id and d.status = 'ready'
    union all
    select 'memory_entry', e.id, null::uuid, e.space_id, e.title, e.content, null::integer, null::integer, null::integer,
           e.updated_at, f.score::double precision
    from fused f
    join public.memory_entries e on e.id = f.id
  ) results
  order by 11 desc
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

revoke execute on function public.match_memory(uuid[], text, extensions.vector, integer, double precision, text) from public, anon;
grant execute on function public.match_memory(uuid[], text, extensions.vector, integer, double precision, text) to authenticated;
