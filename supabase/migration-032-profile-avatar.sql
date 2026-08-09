-- 032：每个人可以自己选一个头像
--
-- 之前所有人的头像都是同一张 /logo.png（也是网站的 favicon），profiles 表里
-- 根本没有这一列。这里只存一个短标识（比如 'a3'），不存 URL、也不存图片本身：
-- 图片是随前端一起发布的静态资源，换设计时改文件即可，不用迁移任何数据。
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

alter table public.profiles
  add column if not exists avatar text;

comment on column public.profiles.avatar is
  '头像标识（对应 public/avatars/<avatar>.png）。null = 用默认 logo。只存标识不存 URL。';

-- 只允许已知的几个值，防止有人把它写成任意字符串再被前端拼进 <img src>。
-- 以后加图就在这里加一个值。
alter table public.profiles
  drop constraint if exists profiles_avatar_known;
alter table public.profiles
  add constraint profiles_avatar_known
  check (avatar is null or avatar in ('a1','a2','a3','a4','a5'));

-- 写权限沿用已有的 profiles_update（id = auth.uid()）：只能改自己的。
-- 读权限沿用 profiles_select：同事之间本来就能看到彼此的名字，头像同理。
