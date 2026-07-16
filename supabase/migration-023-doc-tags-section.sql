-- Scope document tags to one top-level section.
-- A tag created under today/week/month/stash should not appear under the other sections.

alter table doc_tags add column if not exists section text;

-- Staging already has a few tags from the first iteration. If a tag has docs, keep it with the
-- most recently edited linked doc's section; otherwise park it under today.
with tag_sections as (
  select tag_id, (array_agg(section order by updated_at desc))[1] as section
  from docs
  where tag_id is not null
  group by tag_id
)
update doc_tags t
set section = coalesce(ts.section, t.section, 'today')
from tag_sections ts
where t.id = ts.tag_id
  and t.section is null;

update doc_tags set section = 'today' where section is null;

alter table doc_tags alter column section set default 'today';
alter table doc_tags alter column section set not null;

alter table doc_tags drop constraint if exists doc_tags_section_check;
alter table doc_tags add constraint doc_tags_section_check
  check (section in ('today', 'week', 'month', 'stash'));

drop index if exists doc_tags_owner_sort_idx;
create index if not exists doc_tags_owner_section_sort_idx
  on doc_tags (owner, section, archived_at, sort_order, created_at);

drop index if exists doc_tags_owner_active_name_key;
create unique index if not exists doc_tags_owner_section_active_name_key
  on doc_tags (owner, section, lower(trim(name)))
  where archived_at is null;

comment on column doc_tags.section is 'Top-level document section this tag belongs to: today/week/month/stash.';
