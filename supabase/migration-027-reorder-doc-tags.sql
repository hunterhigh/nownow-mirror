-- Persist one section's complete tag order in a single transaction.
-- The complete-set validation prevents stale clients from silently dropping or duplicating tags.

create or replace function public.reorder_doc_tags(p_section text, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_count integer;
  supplied_count integer;
  distinct_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_section not in ('today', 'week', 'month', 'stash') then
    raise exception 'invalid document tag section';
  end if;

  supplied_count := coalesce(cardinality(p_tag_ids), 0);
  select count(*) into distinct_count
  from (select distinct requested.id from unnest(p_tag_ids) as requested(id)) unique_ids;
  select count(*) into active_count
  from public.doc_tags
  where owner = auth.uid()
    and section = p_section
    and archived_at is null;

  if supplied_count <> distinct_count or supplied_count <> active_count then
    raise exception 'document tag order is stale';
  end if;

  if exists (
    select 1
    from unnest(p_tag_ids) as requested(id)
    left join public.doc_tags tag
      on tag.id = requested.id
     and tag.owner = auth.uid()
     and tag.section = p_section
     and tag.archived_at is null
    where tag.id is null
  ) then
    raise exception 'document tag order contains an invalid tag';
  end if;

  update public.doc_tags tag
  set sort_order = requested.ordinality - 1,
      updated_at = now()
  from unnest(p_tag_ids) with ordinality as requested(id, ordinality)
  where tag.id = requested.id
    and tag.owner = auth.uid()
    and tag.section = p_section
    and tag.archived_at is null;
end;
$$;

revoke all on function public.reorder_doc_tags(text, uuid[]) from public;
revoke all on function public.reorder_doc_tags(text, uuid[]) from anon;
grant execute on function public.reorder_doc_tags(text, uuid[]) to authenticated;
