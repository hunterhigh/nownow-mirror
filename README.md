# NowNow 🐰

> 本工作副本用于个人／小团队效率工具定制。先看 [定制项目工作台](docs/README.md) 与 [环境基线](docs/baseline.md)；以下保留原项目介绍，安装／部署配置不能直接作为定制版环境使用。

**A shared notebook for your whole team.** Every member gets their own set of Apple Notes-style rich-text pages, naturally organized into Today / This Week / This Month / Stash; everyone can read each other's pages (unless a block is marked private). A note first, a system second.

No kanban boards, no ticket workflows — write your thoughts down, @ a teammate, and things start moving.

## Core concepts

- **One page per member per period**: documents are organized by member × section × time slice. A new Today page every day, weekly pages by ISO week, monthly pages by month, and a timeless Stash. Dial the date back to revisit any past page.
- **Tags**: open multiple tabs within a section (e.g. "Work", "Reading"), drag to reorder, archive when done.
- **@someone to collaborate**: type `@name` in a document and their inbox gets a notification; when they mark it complete, you get a yellow "done" receipt to acknowledge — a minimal loop, with no claiming and no state machine.
- **Block-level privacy**: mark any block private. Private content is stripped server-side (at the database view layer) — other people never receive those bytes. Not front-end pretend-privacy.
- **Version history**: every real edit snapshots automatically; the latest 50 versions per document are kept and browsable.
- **Search**: full-text search across everything visible to you.
- **Invite-gated registration**: new members need an invite code or invite link; an email allowlist is also supported.

## Editor

Built on Tiptap 3: slash commands, task lists, tables, code blocks with syntax highlighting, images (upload progress + drag-resize), highlights, callouts, drag handles, Markdown import/export. Saves retry automatically when offline, with live save-status indicators. Dark mode and PWA install supported.

## Tech stack

Vite + React 18 (plain JS) · Tiptap 3 · Tailwind CSS 4 · Supabase (Postgres + Auth + Realtime + Storage) · Cloudflare Pages

One engineering detail worth noting: in deployed environments, all Supabase traffic is reverse-proxied through a same-origin `/sb/*` Pages Function (`public/_worker.js`) to work around unstable connectivity to `*.supabase.co` from some networks.

## Run locally

1. Create a [Supabase](https://supabase.com) project and run in the SQL Editor:
   - `supabase/schema.sql`
   - `supabase/migration-001` … `migration-027`, **strictly in numeric order**. Two caveats (detailed in each file's header comments): `migration-010` is a destructive cutover (it drops the old goal model), and `migration-020` is a two-step migration — STEP 1 before deploying the frontend, STEP 2 after. Fresh installs can run everything consecutively.
2. In Storage, confirm the `doc-images` bucket exists (migration-012 creates it).
3. Configure environment variables:

```bash
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

4. Start:

```bash
npm install && npm run dev
```

The first account needs an invite code: set `app_settings.invite_code` in SQL first (see migration-013 / 026), or use the email allowlist (migration-004).

## Deploy

Cloudflare Pages: `npm run build`, then `npx wrangler pages deploy dist`. The repo ships with staging/production dual-environment scripts (`scripts/deploy-*.sh`), a pre-deploy schema preflight (deploys are blocked if the target database is missing required migrations), and a pg_dump scheduled-backup script.

## Status

In production use (450+ commits). Reserved but not yet enabled: real-time collaborative editing (`docs.ystate` is a column reserved for Yjs; concurrent edits to the same document are currently last-write-wins). The UI is in Chinese.
