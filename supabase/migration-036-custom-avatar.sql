-- 036：自定义头像（用户自己上传图片）
--
-- 之前头像只能从 5 张预设里选（avatar = 'a1'…'a5'）。现在多一个「+」，可以传自己的图。
--
-- ## 存的是路径，不是完整 URL
--
-- `avatar` 现在有两种取值：
--   'a3'                                   预设图（前端静态资源）
--   'custom:<uid>/1754800000-ab12.png'     自己传的（storage 里的路径）
--
-- **刻意不存完整 URL**，因为完整 URL 会把"当时是从哪个域名传的"腌进数据里：
--   · 本地开发直连 supabase.co，线上走 /sb 同源代理（大陆直连不稳）——
--     本地传的图会带着 supabase.co 的地址发给所有人，正是代理要绕开的那条路
--   · 换域名就全废（昨天刚从 now-now.pages.dev 换到 nownow.cc）
-- 存路径 → 前端用当前环境的客户端现拼 URL，换域名、换环境都不用回填数据。
--
-- ## 路径必须在自己的文件夹里
--
-- 约束里把路径和本行的 id 绑死（custom:<自己的 uid>/...）：
-- 既防止把 avatar 写成任意字符串再被前端拼进 <img src>，
-- 也防止指向别人文件夹里的文件。
--
-- 幂等。Supabase 控制台 → SQL Editor 整段运行。

-- ============ 1) 存桶 ============
-- 和 doc-images 同样的形状：public 读（<img> 直接显示，不用带 token），
-- 只能传进自己的文件夹。
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 改/删只能动自己传的。换头像时前端会覆盖同名文件，所以 update 也要放行。
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());

-- ============ 2) 放开 avatar 列的取值 ============
alter table public.profiles
  drop constraint if exists profiles_avatar_known;
alter table public.profiles
  add constraint profiles_avatar_known
  check (
    avatar is null
    or avatar in ('a1','a2','a3','a4','a5')
    -- 自定义：必须是 custom:<本人 uid>/<文件名>，文件名只允许安全字符
    or avatar ~ ('^custom:' || id::text || '/[A-Za-z0-9._-]+$')
  );

comment on column public.profiles.avatar is
  '头像。预设 = a1…a5（前端静态资源）；自定义 = custom:<uid>/<file>（avatars 桶里的路径，'
  '前端按当前环境拼 URL）。null = 用默认头像。**不存完整 URL** —— 见 migration-036 注释。';
