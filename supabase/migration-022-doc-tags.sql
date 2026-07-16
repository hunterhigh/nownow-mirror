-- Phase 1 document tags.
-- tag_id = null is the built-in default tag. User-created tags live in doc_tags.
-- "All" is a UI aggregate, not a persisted tag.

create table if not exists doc_tags (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references profiles(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint doc_tags_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists doc_tags_owner_sort_idx on doc_tags (owner, archived_at, sort_order, created_at);
create unique index if not exists doc_tags_owner_active_name_key
  on doc_tags (owner, lower(trim(name)))
  where archived_at is null;

alter table doc_tags enable row level security;
grant select, insert, update, delete on doc_tags to authenticated;

drop policy if exists doc_tags_select on doc_tags;
create policy doc_tags_select on doc_tags for select to authenticated
using (
  owner = auth.uid()
  or exists (select 1 from profiles me where me.id = auth.uid() and me.status = 'active')
);

drop policy if exists doc_tags_insert on doc_tags;
create policy doc_tags_insert on doc_tags for insert to authenticated
with check (owner = auth.uid());

drop policy if exists doc_tags_update on doc_tags;
create policy doc_tags_update on doc_tags for update to authenticated
using (owner = auth.uid())
with check (owner = auth.uid());

drop policy if exists doc_tags_delete on doc_tags;
create policy doc_tags_delete on doc_tags for delete to authenticated
using (owner = auth.uid());

alter table docs add column if not exists tag_id uuid references doc_tags(id) on delete set null;
comment on column docs.tag_id is 'null = built-in default tag; non-null = user-created doc_tags.id';

-- Replace the old one-doc-per-period constraint with one-doc-per-period-per-tag.
alter table docs drop constraint if exists docs_owner_section_period_key_key;
alter table docs drop constraint if exists docs_owner_section_period_key_tag_id_key;
alter table docs add constraint docs_owner_section_period_key_tag_id_key
  unique nulls not distinct (owner, section, period_key, tag_id);

create index if not exists docs_owner_tag_idx on docs (owner, tag_id, section, period_key);

alter table doc_revisions add column if not exists tag_id uuid;

create or replace function snapshot_doc_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.doc_json is distinct from new.doc_json then
    insert into doc_revisions (doc_id, owner, section, period_key, tag_id, doc_json, doc_text, saved_at)
    values (old.id, old.owner, old.section, old.period_key, old.tag_id, old.doc_json, old.doc_text, old.updated_at);

    delete from doc_revisions
    where doc_id = old.id
      and id not in (
        select id from doc_revisions where doc_id = old.id order by saved_at desc limit 50
      );
  end if;
  return new;
end $$;

create or replace view public.docs_visible
with (security_invoker = false) as
select
  d.id, d.owner, d.section, d.period_key, d.created_at, d.updated_at,
  case when d.owner = auth.uid() then d.doc_json
       else coalesce(d.doc_json_public, '{"type":"doc","content":[]}'::jsonb) end as doc_json,
  case when d.owner = auth.uid() then d.doc_text
       else coalesce(d.doc_text_public, '') end as doc_text,
  d.tag_id
from public.docs d
where d.owner = auth.uid()
   or exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active');

grant select on public.docs_visible to authenticated, anon;
