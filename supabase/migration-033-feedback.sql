-- 033：产品反馈墙
--
-- 通知页顶部的「提交反馈」：任何 active 成员可以写一条使用感受 / bug / 改进建议，
-- 所有成员可见（公开的反馈墙 —— 反馈本来就该互相看得见，别人遇到的问题你可能也有）。
--
-- 权限：
--   写   只能以自己的名义（author = auth.uid()），且必须是 active 成员
--   读   active 成员
--   删   只能删自己的（v1 不做编辑：反馈是当时的记录，要改就删了重发）
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.feedback is '产品反馈墙：使用感受 / bug / 改进建议。全员可见，只能删自己的。';

alter table public.feedback enable row level security;

drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback
  for select to authenticated
  using (exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active'));

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (
    author = auth.uid()
    and exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active')
  );

drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback
  for delete to authenticated
  using (author = auth.uid());
