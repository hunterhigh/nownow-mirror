-- 035：个人偏好上云（prefs jsonb）
--
-- 背景（2026-08-10 用户反馈）：置顶成员、成员排序一直存在浏览器 localStorage 里，
-- 换域名/换电脑/换浏览器/清缓存都会"丢"。换到 nownow.cc 后有用户置顶全没了 ——
-- 数据其实还在老域名的储物柜里，但用户感受就是丢了。
--
-- 偏好应该跟人走，不跟浏览器走。加一列 jsonb，现在装：
--   { "pinned": ["uuid", ...], "memberOrder": ["uuid", ...] }
-- 以后新的个人偏好也进这里，不用每个偏好加一列。
--
-- 权限沿用 profiles 已有策略：只能改自己的行（profiles_update: id = auth.uid()）。
-- 团队成员本来就能互相看 profiles，pinned 列表不算敏感；真正私密的偏好将来别放这。
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

alter table public.profiles
  add column if not exists prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.prefs is
  '个人偏好（置顶成员、成员排序等）。跟账号走，不跟浏览器走。结构见 migration-035。';
