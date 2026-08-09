-- 029：客户端错误上报表
--
-- 为什么需要它：在这之前，全应用有 25 处空 catch、5 处 console.error，
-- 没有任何东西会离开用户的浏览器。保存失败率多少、国内那条 /sb 代理稳不稳、
-- 谁在白屏 —— 全靠用户主动来说，而多数人不会说，他们只是不用了。
--
-- 写入策略刻意宽松（登录用户都能插），因为**收不到错误比收到垃圾更糟**。
-- 读取则只留给你自己：任何人都不该看到别人的报错。
--
-- Supabase 控制台 → SQL Editor 整段运行（幂等）。

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter uuid references auth.users(id) on delete set null default auth.uid(),
  kind text not null,
  message text not null,
  stack text,
  path text,
  ua text,
  online boolean,
  extra jsonb
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_kind_idx on public.client_errors (kind, created_at desc);

alter table public.client_errors enable row level security;

-- 写：登录用户可以报自己的错。reporter 由默认值锁成 auth.uid()，不接受伪造。
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to authenticated
  with check (reporter = auth.uid());

-- 读：故意不建 select 策略 = 全拒绝。
-- 报错信息里可能带着路径、UA、异常文本，不该在成员之间互相可见。
-- 你自己在 Supabase 后台（service_role）看，那条路不走 RLS。

-- 保留 30 天就够了 —— 这是用来发现问题的，不是用来存档的。
-- 定期清理（可以挂在任何一次运维里，或者以后做成 cron）：
--   delete from public.client_errors where created_at < now() - interval '30 days';
