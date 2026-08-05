# NowNow 🐰

**一本全组共享的笔记本。** 每个成员有自己的一组 Apple Notes 式富文本页面，按 今日 / 本周 / 本月 / 收集箱 自然分区；全组互相可见（除非你标记为私密）。先是笔记，才是系统。

没有任务看板、没有工单流程——把想法写下来，@一下同事，事情就开始流动。

## 核心概念

- **每人每期一页**：文档按「成员 × 分区 × 时间片」组织。今日页每天一张，本周页按 ISO 周，本月页按月，收集箱不限期。可以回拨日期翻看任何过去的页面。
- **页签（Tag）**：同一分区内可以开多个页签（如「工作」「读书」），可拖拽排序、可归档。
- **@人即协作**：在文档里输入 `@某人`，对方的收件箱会收到通知；对方标记完成后，你会收到黄色「已完成」回执并确认——一个最小闭环，没有认领、没有状态机。
- **块级私密**：任意段落可标记为私密。私密内容在服务端就被剥离（数据库视图层面），其他人根本收不到那些字节——不是前端假隐藏。
- **版本历史**：每次真实修改自动快照，每篇文档保留最近 50 版，可随时回看。
- **搜索**：跨全组可见内容的全文检索。
- **邀请制注册**：新成员需要邀请码或邀请链接，支持邮箱白名单。

## 编辑器

基于 Tiptap 3：斜杠命令、任务列表、表格、代码块（语法高亮）、图片（上传进度 + 拖拽调整大小）、高亮、Callout、拖拽手柄、Markdown 导入导出。断网自动重试保存，保存状态实时可见。支持深色模式与 PWA 安装。

## 技术栈

Vite + React 18（纯 JS）· Tiptap 3 · Tailwind CSS 4 · Supabase（Postgres + Auth + Realtime + Storage）· Cloudflare Pages

一个值得一提的工程细节：部署环境下所有 Supabase 流量通过同源 `/sb/*` 的 Pages Function 反代（`public/_worker.js`），解决 `*.supabase.co` 在部分网络环境下不稳定的问题。

## 本地运行

1. 创建 [Supabase](https://supabase.com) 项目，SQL Editor 中按顺序执行：
   - `supabase/schema.sql`
   - `supabase/migration-001` … `migration-027`，**严格按编号顺序**。两个注意点（各文件头部注释有详细说明）：`migration-010` 是破坏性切换（删除旧目标模型）；`migration-020` 分两步，STEP 1 在前端部署前执行、STEP 2 在部署后执行——全新安装可连续执行。
2. Storage 中确认 `doc-images` 存储桶存在（migration-012 会创建）。
3. 配置环境变量：

```bash
cp .env.example .env.local
# 填 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY
```

4. 启动：

```bash
npm install && npm run dev
```

首个账号注册需要邀请码：先在 SQL 里设置 `app_settings.invite_code`（见 migration-013 / 026），或使用邮箱白名单（migration-004）。

## 部署

Cloudflare Pages：`npm run build` 后 `npx wrangler pages deploy dist`。仓库内置 staging / production 双环境脚本（`scripts/deploy-*.sh`）、部署前 schema 预检（缺 migration 会拒绝上线）、以及 pg_dump 定时备份脚本。

## 状态

生产环境使用中（450+ 提交）。已预留但未启用：多人实时协同编辑（`docs.ystate` 为 Yjs 预留列，当前同文档并发编辑为后写覆盖）。UI 为中文。
