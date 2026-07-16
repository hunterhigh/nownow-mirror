-- Archive a user-created doc tag without losing content.
-- Tagged docs are moved back to the built-in default tag. If the default doc for the
-- same owner/section/period already exists, append the tagged doc's blocks into it.

create or replace function public.archive_doc_tag(p_tag_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_now timestamptz := now();
  src record;
  dst record;
  merged_doc_json jsonb;
  merged_public_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select owner
  into v_owner
  from public.doc_tags
  where id = p_tag_id;

  if not found then
    return;
  end if;

  if v_owner <> auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for src in
    select *
    from public.docs
    where owner = v_owner
      and tag_id = p_tag_id
    order by section, period_key, updated_at, id
    for update
  loop
    select *
    into dst
    from public.docs
    where owner = src.owner
      and section = src.section
      and period_key = src.period_key
      and tag_id is null
    for update;

    if not found then
      update public.docs
      set tag_id = null,
          updated_at = v_now
      where id = src.id;
    else
      merged_doc_json := jsonb_set(
        coalesce(dst.doc_json, '{"type":"doc","content":[]}'::jsonb),
        '{content}',
        coalesce(dst.doc_json -> 'content', '[]'::jsonb)
          || coalesce(src.doc_json -> 'content', '[]'::jsonb),
        true
      );

      merged_public_json := jsonb_set(
        coalesce(dst.doc_json_public, '{"type":"doc","content":[]}'::jsonb),
        '{content}',
        coalesce(dst.doc_json_public -> 'content', '[]'::jsonb)
          || coalesce(src.doc_json_public -> 'content', '[]'::jsonb),
        true
      );

      update public.docs
      set doc_json = merged_doc_json,
          doc_text = concat_ws(E'\n', nullif(dst.doc_text, ''), nullif(src.doc_text, '')),
          doc_json_public = merged_public_json,
          doc_text_public = concat_ws(E'\n', nullif(dst.doc_text_public, ''), nullif(src.doc_text_public, '')),
          updated_at = v_now
      where id = dst.id;

      update public.doc_mentions
      set doc_id = dst.id
      where doc_id = src.id;

      delete from public.docs
      where id = src.id;
    end if;
  end loop;

  update public.doc_tags
  set archived_at = coalesce(archived_at, v_now),
      updated_at = v_now
  where id = p_tag_id;
end;
$$;

grant execute on function public.archive_doc_tag(uuid) to authenticated;
