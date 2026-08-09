# NowNow — 架构说明

一句话：**一份文档 = 一个 `(owner, section, period_key, tag_id)`**。理解了这一行，整个代码库就通了。

```
浏览器
 ├── src/components/   UI：编辑器、时间线、收件箱、搜索、设置
 ├── src/Board.jsx     主容器：谁的页面、哪个 section、哪个周期、哪个标签
 └── src/lib/          领域层：所有对数据的读写都从这里走
        │
        ▼
 public/_worker.js     同源代理 /sb/* → Supabase（绕开国内直连不稳）
        │
        ▼
 Supabase (Postgres)
        读 ──→ docs_visible（视图，别人的只给公开投影）
        写 ──→ docs（RLS: owner = auth.uid()）
```

---

## 先理解这一条：读和写走的不是同一个门

这是整个数据层最容易看错的地方。

**写**：直接写 `docs` 表，RLS 是 `owner = auth.uid()` —— 只能改自己的，没有例外。

**读**：一律走 `docs_visible` 视图，它做两件事：

```sql
-- 是我自己的 → 给完整的 doc_json
-- 是别人的   → 只给 doc_json_public（私密块已剥掉）
-- 而且：调用者必须是 profiles.status = 'active' 的成员
```

所以「看别人的页面」不是靠前端不渲染私密块，**是数据库根本不把私密内容发出来**。前端的 `privateBlock.js` 只负责标记和显示，真正的边界在这个视图里。

> 这也解答了一个常见疑问：`docs` 表的 select 策略是 `owner = auth.uid()`，看起来像"谁也看不到别人的"，但产品明明可以看同事的页面 —— 因为读根本不经过那条策略，经过的是视图。

---

## 目录职责

### `src/lib/` —— 领域层（**改数据只能从这里改**）

组件不直接碰 `supabase`，一律经过这一层。分两类：

**数据读写**

| 文件 | 职责 |
|---|---|
| `supabase.js` | 客户端单例 |
| `docsApi.js` | 文档读写。读走 `docs_visible`，写走 `docs`。`doc_json` 是真源（ProseMirror JSON），`doc_text` 是搜索用的纯文本投影，`doc_json_public` / `doc_text_public` 是**剥掉私密块后**的公开投影 |
| `resilientDocs.js` | **在 docsApi 外面包一层"不丢字"**：先写 localStorage，再尝试落库；失败入队、联网重试。缓存 + 草稿 + 重放 + 冲突自动处理都在这个文件 |
| `tagsApi.js` | 用户自建标签（`doc_tags`）的增删改排序 |
| `docMentionsApi.js` | `@` 通知：读取、已读、完成、忽略（`dismiss_mention`） |
| `storage.js` | 图片上传到 Supabase Storage，返回 URL（文档里只存 URL，不塞图片字节） |
| `report.js` | 前端异常上报到 `client_errors`。去重 5 分钟、**永不阻塞用户操作**、不带文档内容 |

**领域规则**

| 文件 | 职责 |
|---|---|
| `period.js` | 日历区间：今日 / 本周（周一起，ISO） / 本月 + 任意偏移 |
| `periodKey.js` | 把区间算成 `docs.period_key`：`2026-06-13` / `2026-W24` / `2026-06` / `stash`。**复用 `period.js` 的边界定义，不引第二套周定义** |
| `privateBlock.js` | 逐块私密：给块级节点加 `private` 属性 → 渲染成 `data-private` |
| `markdown.js` | Tiptap JSON ⇆ Markdown。**只有导出在用**；`markdownToDocJson` 没有调用方（导入功能已撤），留着是为了想恢复时不用重写解析器 |
| `mentionDone.js` | `@` 人名按完成态上色。**完成态是外部数据，用 decoration 动态渲染，不写进 `doc_json`** |
| `uploadProgress.js` | 上传进度的旁路 store。**进度不进节点 attrs**，否则自动保存会按百分点疯狂写库 |
| `theme.js` | 明暗主题（`<html data-theme>` + localStorage 记忆） |
| `errors.js` | Postgres 报错转人话 |

> `mentionDone` / `uploadProgress` / `privateBlock` 这三个体现了同一条设计纪律：
> **什么该进 `doc_json`（文档内容），什么不该（外部状态、临时状态）。**

### `src/components/` —— UI

| 文件 | 职责 |
|---|---|
| `DocEditor.jsx` | Tiptap 编辑器本体：扩展、斜杠命令、粘贴上传、mention |
| `DocBlock.jsx` | 一个周期的一块文档 = 加载 + 防抖保存 + 状态。**编辑器与持久化的接缝** |
| `DocTimeline.jsx` | 按周期往下铺的时间线（今天、昨天、更早……） |
| `DocTagBar.jsx` | 标签栏：切换 / 新建 / 改名 / 排序 / 归档 |
| `DocSearch.jsx` | 全文搜索（走 `doc_text` 投影，防抖后再发请求） |
| `Inbox.jsx` / `NotificationsPage.jsx` | `@` 我的通知；`NotificationsPage` 带一键 Clear |
| `SettingsModal.jsx` | 设置、成员邀请、**导出 Markdown**（导入已撤） |
| `AvatarPicker.jsx` | 头像选择 + `avatarSrc()`。默认头像是这里的一行常量，**不落库** |
| `ResizableImage.jsx` | 可缩放图片节点 |
| `CarryHandle.jsx` / `BlockHandle.jsx` | 块级操作：搬到今天、悬浮把手 |
| `SlashCommand.js` / `Callout.js` | Tiptap 自定义扩展 |
| `SaveStatus.jsx` | 保存状态指示。只剩「离线」和「失败+重试」—— 冲突已改成静默自动处理，没有 UI |
| `ThemeToggle.jsx` | 明暗切换 |
| `doc-editor.css` | 编辑器专属样式 |

### 顶层

| 文件 | 职责 |
|---|---|
| `App.jsx` | 应用外壳：ErrorBoundary（**任何渲染崩溃都不白屏**）+ 登录态分流。整个产品只有两个页面 |
| `Login.jsx` | 登录 / 凭邀请码注册（两态同一个组件） |
| `Board.jsx` | **主容器（1250+ 行，最大的文件）**：当前看谁的页面、哪个 section、哪个周期偏移、哪个标签，以及成员列表、通知订阅、标签操作、头像与 favicon 同步 |
| `styles.css` | 设计 token（`:root` 亮色 / `[data-theme="dark"]` 暗色两套）+ 全局 `cursor: pointer`（Tailwind v4 取消了按钮的默认值） |

### `test/` —— 回归测试

| 文件 | 职责 |
|---|---|
| `resilientDocs.test.js` | 9 条，全部对应**今天真实发现过的 bug**：缓存契约、冲突自动处理只重试一次、离线草稿带自己的基准重放 |
| `setup.js` | MemoryStorage / navigator / window 的桩 |

`vitest.config.js`、`eslint.config.js` 在顶层。跑：`npx vitest run`、`npx eslint src/ test/`。

### `supabase/` —— 数据库

| | |
|---|---|
| `schema.sql` | 基线：`profiles` + RLS |
| `migration-001 … 032` | 按编号顺序演进。**注意：这是自定义命名，不是 Supabase CLI 认的 `migrations/<时间戳>_name.sql`，所以线上没有 migration 账本** |
| `seed.sql` / `seed-sim.sql` | 种子数据 |

演进主线：
```
001-008  邀请体系、成员审批
009-010  entries 模型 → docs 模型（010 是破坏性切换，旧表存为 *_archived_0615）
011-019  @通知、图片存储、版本历史
020      块级隐私 + docs_visible 视图（文件里 STEP 2 是注释掉的，
         但线上早已手工执行过 —— 以库为准，别信文件）
021-027  邀请码校验、标签体系、标签归档、排序
028-032  存储桶不可枚举、前端错误表、服务端剥私密块、
         @忽略状态、头像字段
```

### `scripts/` —— 运维

| 文件 | 职责 |
|---|---|
| `deploy-staging.sh` / `deploy-production.sh` | 部署到 Cloudflare Pages |
| `preflight-production-schema.mjs` | 部署前检查线上 schema 是否够新（防止前端跑在旧库上） |
| `patch-worker-origin.mjs` | 把 worker 里的 Supabase origin 换成目标环境的 |
| `backup-db.sh` + `com.nownow.backup.plist` | pg_dump 定时备份 |

### `public/`

| 文件 | 职责 |
|---|---|
| `_worker.js` | **Cloudflare Pages Function**：把 `/sb/*` 反代到 Supabase。国内直连 `*.supabase.co` 不稳，而 `now-now.pages.dev` 可达 |
| `avatars/a1…a5.png` | 可选头像。**只在前端，数据库只存 `'a3'` 这样的标识** |
| `icon-192 / icon-512 / apple-touch-icon` | PWA 与 iOS 桌面图标 |
| `manifest.webmanifest`、字体 | PWA 与静态资源 |

---

## 数据库里那些代码看不见的东西

**这是这个项目反复吃亏的地方：库里有仓库不知道的状态。** 已经踩过的：邀请码从没轮换、存储策略是在控制台手建的、`docs` 上有个仓库里查不到的触发器。

`docs` 表上目前挂着三个触发器：

| 触发器 | 作用 | 踩过的坑 |
|---|---|---|
| `docs_touch` | `BEFORE UPDATE` → `new.updated_at = now()` | **无条件覆盖客户端传的值。** 保存后必须把 `updated_at` 读回来，不能拿自己生成的时间戳当版本号 —— 否则每篇文档从第二次保存起都误报冲突（真实发生过） |
| `trg_snapshot_doc_revision` | `BEFORE UPDATE` → 旧版本进 `doc_revisions` | 所以覆盖是可逆的。也因此**不要批量 `update docs set doc_json = doc_json`**，那会给每一篇刷一条无意义的历史 |
| `docs_enforce_public_projection` | `BEFORE INSERT OR UPDATE` → 服务端重算 `doc_json_public` | 故意**不带** `OF doc_json`：带了的话只 PATCH `doc_json_public` 就能绕过 |

> 结论：**动 `docs` 之前先去库里看一眼有什么触发器和策略，不要只读仓库。**

---

## 四条贯穿全局的设计决定

**1. `doc_json` 是真源，其余都是投影。**
`doc_text`（搜索）、`doc_json_public`（隐私）都是从它派生的。所以"什么该进 `doc_json`"是这个代码库反复出现的判断题 —— 上传进度、完成态、mention 的临时 id 都被刻意挡在外面。

**2. 用户打的字，先落本地再落网。**
`resilientDocs.js` 是这条纪律的实现：断网、刷新、崩溃都不该丢字。

**3. 隐私由数据侧兜底，不能只靠前端。**
`privateBlock.js` 只负责标记和渲染；真正的边界是 `docs_visible` 视图和 `enforce_public_projection` 触发器 —— 前端只是不显示，数据库才是不给。

**4. 冲突静默处理，但不放弃前置条件。**
同一篇在两处被编辑时，以"正在打字的这份"为准自动写上去，不打扰用户（旧版本进 `doc_revisions`，可恢复）。但自动重存**仍然带服务器版本号做前置条件**，且**只重试一次** —— 改成无条件覆盖或无限重试，这层保护就废了。
离线队列是例外：几天前的草稿不自动覆盖新内容，留在本地等人决定。

---

## 一份文档是怎么被定位的

```
owner       谁的页面        （看别人的页面 = 换 owner）
section     哪一栏          today / week / month / stash
period_key  哪个周期实例    2026-06-13 / 2026-W24 / 2026-06 / stash
tag_id      哪个标签        null = 系统默认标签
```

这四个字段唯一确定一份文档，也是 `docs` 表的唯一约束。时间线往回翻 = 同 `(owner, section, tag_id)` 下换 `period_key`。
