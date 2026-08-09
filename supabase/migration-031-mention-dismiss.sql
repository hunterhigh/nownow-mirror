-- 031：给 @我的 加一个"忽略"状态，让「Clear」能真正清空而不撒谎
--
-- 背景：@我的 不是通知，是别人派给我的活。原来只有两种结局：没做完（一直在），
-- 或者标记完成（对方会收到"已完成"）。于是"一键清空"只有两条路：
--   · 清不掉 —— 那按钮就是个摆设
--   · 标成完成 —— 等于替用户告诉派活的人"我做完了"，而对方无从察觉这是假的
--
-- dismissed_at 是第三条路，语义干净：**我看到了，我不做，也不假装做了。**
-- 派活的人那边不会收到任何完成通知，只是这条不再占用我的通知列表。
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

alter table public.doc_mentions
  add column if not exists dismissed_at timestamptz;

comment on column public.doc_mentions.dismissed_at is
  '被@的人主动忽略这条派活的时间。不代表完成，不通知派活人，只是从我的通知列表里移走。';

-- 只有被 @ 的人自己能忽略自己的那条。
-- （沿用已有的 doc_mentions_update 策略：using/with check 都是 mentioned = auth.uid()，
--  所以这里不需要新增策略；写成函数是为了把"只能改这一列"限制死。）
create or replace function public.dismiss_mention(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '未登录';
  end if;
  update public.doc_mentions
     set dismissed_at = coalesce(dismissed_at, now())
   where id = p_id
     and mentioned = auth.uid();   -- 只能忽略"派给我的"，不能动别人的
end;
$$;

revoke execute on function public.dismiss_mention(uuid) from public, anon;
grant execute on function public.dismiss_mention(uuid) to authenticated;

-- 查已忽略的（万一以后要做"找回"）：
--   select id, snippet, dismissed_at from doc_mentions
--   where mentioned = auth.uid() and dismissed_at is not null order by dismissed_at desc;
