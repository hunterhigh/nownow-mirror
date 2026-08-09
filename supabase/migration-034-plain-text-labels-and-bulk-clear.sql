-- 034：修 doc_plain_text 丢标签 + 一键清空的批量 RPC
--
-- 之一：doc_plain_text（030 引入）只抽取节点的 text 字段，而客户端的文本投影
-- 还会把 @提及 渲染成 "@人名"、把时间戳渲染成 "8月9日 周日"。030 的触发器
-- 又会丢弃客户端算好的 doc_text_public 重算 —— 结果是**别人搜人名/日期搜不到**
-- （自己的文档走 doc_text 不受影响）。这里重定义函数，把两类节点的 label 补上。
-- 为什么是新文件而不是改 030：迁移是只追加的账本，已经跑过 030 的库不会重跑改动。
--
-- 之二：一键清空原来是"每条通知一个 RPC"，200 条通知 = 200 个网络往返，
-- 还会触发 200 次 realtime 广播。补两个批量 RPC，一次往返清完，且原子。
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

create or replace function public.doc_plain_text(node jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(t, ''), '')
  from (
    select case
             when jsonb_typeof(x) = 'object' and x ? 'text' then x ->> 'text'
             -- @提及：文本在 attrs.label 里，前面补 @（和客户端 blockText 口径一致）
             when jsonb_typeof(x) = 'object' and x ->> 'type' = 'mention'
               then '@' || coalesce(x -> 'attrs' ->> 'label', '')
             -- 时间戳：同理，label 就是显示文本（"8月9日 周日"）
             when jsonb_typeof(x) = 'object' and x ->> 'type' = 'dateStamp'
               then coalesce(x -> 'attrs' ->> 'label', '')
             else ''
           end
           || case
                when jsonb_typeof(x) = 'object' and x ->> 'type' in ('paragraph','heading','listItem','taskItem','blockquote','codeBlock','dateStamp')
                then E'\n' else ''
              end as t
    from jsonb_path_query(node, 'strict $.**') as x
  ) s;
$$;

-- 触发器函数没变（还是 enforce_public_projection 调 doc_plain_text），
-- 函数体替换后自动生效，不用重建触发器。

-- ============ 一键清空 ============

-- 忽略我的全部 @ 通知（= 对每条做 dismiss_mention，但一次往返、原子）
create or replace function public.dismiss_all_mentions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  update public.doc_mentions
     set dismissed_at = coalesce(dismissed_at, now())
   where mentioned = auth.uid()
     and dismissed_at is null
     and completed_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 点掉我收到的全部黄色"已完成"知会
create or replace function public.ack_all_completions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  update public.doc_mentions
     set completion_seen_at = coalesce(completion_seen_at, now())
   where author = auth.uid()
     and completed_at is not null
     and completion_seen_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.dismiss_all_mentions() from public, anon;
revoke execute on function public.ack_all_completions() from public, anon;
grant execute on function public.dismiss_all_mentions() to authenticated;
grant execute on function public.ack_all_completions() to authenticated;

-- 已有文档的 doc_text_public 不回填：回填要 UPDATE 全表，会触发 revision 快照风暴
-- （每篇多一条无意义历史）。旧文档在下一次被编辑时自然重算；搜索缺口只覆盖
-- "从未再编辑过的旧文档里的 @ 和时间戳"，随时间自愈。
