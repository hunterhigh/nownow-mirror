-- 030：把"剥掉私密块"从浏览器挪进数据库
--
-- 为什么这件事必须在服务端做：
-- 现在 doc_json_public / doc_text_public 是**前端算好之后一起 upsert 上来的**，
-- 数据库从不校验这两列和 doc_json 之间的关系。也就是说，"公开投影里一定没有私密块"
-- 这个承诺，取决于**每一个客户端在每一次保存时都算对了**。几个具体的破绽：
--
--   · 标了私密之后离线：doc_json_public 里那段还在，而别人一直在读它
--   · 老版本的标签页（升级前的 bundle）保存时不带这两列 —— PostgREST 的
--     ON CONFLICT DO UPDATE 只更新 payload 里出现的列，旧投影原样留着
--   · 任何人直接 PATCH /rest/v1/docs 都能自己指定 doc_json_public 的内容
--
-- 改成触发器之后，这个不变式就不再依赖客户端的善意与正确性：
-- 无论客户端送上来什么，两列都由数据库根据 doc_json 重新算。
--
-- 与前端的关系：前端可以继续送这两列（不用改代码、老客户端也不会坏），
-- 送上来的值会被直接丢弃、以服务端算的为准。
--
-- Supabase 控制台 → SQL Editor 整段运行（幂等）。

-- 递归剥掉任意层级上 attrs.private = true 的节点。
-- 与前端 stripPrivate 语义一致：只看 content 数组里的直接子节点，逐层往下。
create or replace function public.strip_private(node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  child jsonb;
  kept jsonb := '[]'::jsonb;
begin
  if node is null or jsonb_typeof(node) <> 'object' then
    return node;
  end if;
  if jsonb_typeof(node -> 'content') <> 'array' then
    return node;
  end if;

  for child in select * from jsonb_array_elements(node -> 'content')
  loop
    -- 私密节点整个丢掉（连同它的子树）
    if coalesce((child -> 'attrs' ->> 'private')::boolean, false) then
      continue;
    end if;
    kept := kept || jsonb_build_array(public.strip_private(child));
  end loop;

  return jsonb_set(node, '{content}', kept);
end;
$$;

-- 从 PM JSON 里抽纯文本（给搜索用的投影）。
-- 只取 text 节点，块之间用换行分隔 —— 与前端 docText 的产出足够一致。
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
             else ''
           end
           || case
                when jsonb_typeof(x) = 'object' and x ->> 'type' in ('paragraph','heading','listItem','taskItem','blockquote','codeBlock')
                then E'\n' else ''
              end as t
    from jsonb_path_query(node, 'strict $.**') as x
  ) s;
$$;

-- 每次写入前重算两列，忽略客户端送来的值。
create or replace function public.enforce_public_projection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.doc_json_public := public.strip_private(new.doc_json);
  new.doc_text_public := public.doc_plain_text(new.doc_json_public);
  return new;
end;
$$;

drop trigger if exists docs_enforce_public_projection on public.docs;
-- 注意是 `before insert or update`，**不带 `of doc_json`**。
-- 第一版写成了 `update of doc_json`，那样只在 doc_json 出现在 UPDATE 列表里时才触发 ——
-- 于是只 PATCH doc_json_public 一列就能绕过整个触发器，把任意内容写成"公开投影"，
-- 恰好是这条迁移要堵的那个洞。
create trigger docs_enforce_public_projection
  before insert or update on public.docs
  for each row execute function public.enforce_public_projection();

-- ⚠️ 这里**故意不做全表回填**。
--
-- 最初这一版写的是 `update docs set doc_json = doc_json`，想顺手把历史数据也重算一遍。
-- 但 docs 上挂着 snapshot_doc_revision 触发器：那条语句会给全部 1181 篇文档各生成
-- 一条新的历史版本，而每篇的历史上限是 50 条 —— 也就是会**把真实的编辑历史挤掉**，
-- 正好毁掉今晚一直在保护的东西。
--
-- 而且回填本来也不必要：上线前查过，
--   select count(*) from docs where jsonb_path_exists(doc_json_public, '...private == true')
-- 结果是 0 —— 前端的剥离一直算对了。这条迁移是把"靠客户端每次都算对"变成
-- "数据库保证"，不是在补一个正在漏的洞。
--
-- 以后每次正常保存都会经过触发器，历史数据会自然收敛。

revoke execute on function public.strip_private(jsonb) from public, anon;
revoke execute on function public.doc_plain_text(jsonb) from public, anon;
revoke execute on function public.enforce_public_projection() from public, anon;

-- 验证：应当返回 0（没有任何一行的公开投影里还留着私密节点）
--   select count(*) from public.docs
--   where jsonb_path_exists(doc_json_public, 'strict $.**.attrs.private ? (@ == true)');
