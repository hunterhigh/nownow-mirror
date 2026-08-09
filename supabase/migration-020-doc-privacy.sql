-- 020：逐行私密（per-block privacy）。某块标记 private 后，别人彻底看不到、只自己能看。
-- 安全核心：私密内容必须服务端过滤——只前端隐藏会被别人浏览器收到(F12 可见)，那是假隐私。
--
-- 做法：docs 存「全文 doc_json」+「剥掉私密块的 public 投影 doc_json_public」（app 存时算）。
--   · 你自己：读全文。
--   · 别人：只能读 public 投影——通过安全视图 docs_visible；docs 原表 SELECT 锁成 owner-only，别人绕不过去。
--   · 版本历史 doc_revisions 含全文快照 → 也锁 owner-only，否则能从历史翻到私密内容。
--
-- ⚠️ 分两步跑，配合 app 部署，全程无「泄露窗口」也无「读不到」窗口：
--   STEP 1（现在跑）：加列 + 视图（不破坏，docs 仍可读、视图与原表等价）→ 告诉老铁 → 老铁部署 app（改读 docs_visible / 写 public 投影）
--   STEP 2（app 部署后跑）：把 docs / doc_revisions 的 SELECT 锁成 owner-only（此时 app 已走视图，不会读不到）
-- Supabase 控制台 → SQL Editor。STEP 1 和 STEP 2 分两次跑。

-- ========================= STEP 1（先跑这段）=========================

-- 1) 加 public 投影列
alter table docs add column if not exists doc_json_public jsonb;
alter table docs add column if not exists doc_text_public text;

-- 2) 回填：现有文档还没有私密块 → public = 全文
update docs set doc_json_public = doc_json, doc_text_public = doc_text
where doc_json_public is null;

-- 3) 安全视图：你自己读全文、别人读 public 投影；仅团队活跃成员可见。
--    security_invoker=false（定义者权限，绕过 docs 行级RLS）——这是有意的：
--    STEP 2 会把 docs 原表锁成 owner-only，团队读取只能走这个视图、且只拿到 public 投影。
--    auth.uid() 在定义者视图里仍读当前请求身份，过滤正确。
create or replace view public.docs_visible
with (security_invoker = false) as
select
  d.id, d.owner, d.section, d.period_key, d.created_at, d.updated_at,
  case when d.owner = auth.uid() then d.doc_json
       else coalesce(d.doc_json_public, '{"type":"doc","content":[]}'::jsonb) end as doc_json,
  case when d.owner = auth.uid() then d.doc_text
       else coalesce(d.doc_text_public, '') end as doc_text
from public.docs d
where d.owner = auth.uid()
   or exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active');

grant select on public.docs_visible to authenticated, anon;

-- ===== STEP 1 跑完，告诉老铁部署 app，再回来跑 STEP 2 =====


-- ========================= STEP 2（app 部署后再跑）=========================
-- 2026-08-09：这两条在生产上是手动跑过的（已用 pg_policies 核实：docs 与
-- doc_revisions 的 SELECT qual 都是 owner = auth.uid()）。但它们在本文件里一直是
-- 注释状态，等于「生产靠的是一次没有留痕的手工操作」——照 README 从头装一套新库，
-- 装出来的是隐私完全没生效的版本，而 DocEditor.jsx 里的 PRIVACY_ENABLED 是 true。
-- 现在改成可执行。两条都是 drop-then-create，对已经跑过的库重复执行也是安全的。
-- 把 docs 原表 SELECT 锁成 owner-only：别人无法直接读到全文 doc_json，只能走 docs_visible 拿 public 投影。
-- （写策略 insert/update/delete 不变，仍 owner-only。app 读已改走 docs_visible，所以这步不会让谁读不到。）

drop policy if exists docs_select on docs;
create policy docs_select on docs for select to authenticated using (owner = auth.uid());

-- 版本历史也锁 owner-only：全文快照只有本人能看，私密内容不从历史泄露。
drop policy if exists doc_revisions_read on doc_revisions;
create policy doc_revisions_read on doc_revisions for select to authenticated using (owner = auth.uid());
