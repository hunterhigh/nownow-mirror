#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

const DEFAULT_PRODUCTION_URL = 'https://yklskyyirfboamhtzzhp.supabase.co'
const FETCH_TIMEOUT_MS = 10_000
const REQUIRED_MIGRATIONS = [
  'supabase/migration-022-doc-tags.sql',
  'supabase/migration-023-doc-tags-section.sql',
  'supabase/migration-024-archive-doc-tag.sql',
]

const targetUrl = normalizeUrl(process.env.VITE_SUPABASE_URL || DEFAULT_PRODUCTION_URL)
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!anonKey) {
  fail('Missing VITE_SUPABASE_ANON_KEY. Load .env.production or .env.local before running the preflight.')
}

// 自定义头像（migration-036）：前端一旦有 uploadAvatar，生产库就必须先有 avatars 桶，
// 否则上线后**每个人**点「+」都失败，而且前端只会说"上传失败，换张图试试"——
// 用户会以为是自己的图有问题，你要等有人来投诉才知道。顺序必须是先迁移、再部署。
//
// 这一组要在 doc-tags 的早退**之前**判断：那段 exit(0) 会让后面的探针一条都不跑。
const avatarProbes = sourceRequiresAvatarBucket()
  ? [storageBucketProbe('avatars 存桶（migration-036）', 'avatars')]
  : []

if (avatarProbes.length > 0) {
  const avatarResults = await Promise.all(avatarProbes.map((probe) => probe()))
  const avatarFailures = avatarResults.filter((r) => !r.ok)
  if (avatarFailures.length > 0) {
    console.error(`[schema-preflight] ${hostname(targetUrl)} 缺少当前前端需要的存储配置：`)
    for (const f of avatarFailures) console.error(`- ${f.name}: ${f.reason}`)
    console.error('')
    console.error('先跑 supabase/migration-036-custom-avatar.sql，再部署前端。')
    process.exit(1)
  }
  console.log('[schema-preflight] avatars 存桶就绪。')
}

if (!sourceRequiresDocTags()) {
  console.log('[schema-preflight] Current frontend does not require document tag schema; skipping tag probes.')
  process.exit(0)
}

const probes = [
  restProbe('doc_tags table with section column', '/rest/v1/doc_tags?select=id,section&limit=1'),
  restProbe('docs.tag_id column', '/rest/v1/docs?select=tag_id&limit=1'),
  restProbe('docs_visible.tag_id column', '/rest/v1/docs_visible?select=tag_id&limit=1'),
  restProbe('doc_revisions.tag_id column', '/rest/v1/doc_revisions?select=tag_id&limit=1'),
  // This specific RPC exits at its auth guard before any write when called with the anon token.
  rpcProbe('archive_doc_tag(uuid) RPC', '/rest/v1/rpc/archive_doc_tag', {
    p_tag_id: '00000000-0000-0000-0000-000000000000',
  }),
]

const results = await Promise.all(probes.map((probe) => probe()))
const failures = results.filter((result) => !result.ok)

if (failures.length > 0) {
  console.error(`[schema-preflight] ${hostname(targetUrl)} is missing schema required by the current frontend:`)
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.reason}`)
  }
  console.error('')
  console.error(
    `[schema-preflight] Run and verify these migrations on the target database before deploying this frontend: ${REQUIRED_MIGRATIONS.join(', ')}`,
  )
  process.exit(1)
}

console.log(`[schema-preflight] ${hostname(targetUrl)} has the document tag schema required by this frontend.`)

function normalizeUrl(value) {
  return value.replace(/\/+$/, '')
}

function hostname(value) {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function fail(message) {
  console.error(`[schema-preflight] ${message}`)
  process.exit(1)
}

/** 前端是否已经带上传头像的能力（带了就必须有桶）。 */
function sourceRequiresAvatarBucket() {
  const file = 'src/lib/storage.js'
  if (!existsSync(file)) return false
  return /uploadAvatar/.test(readFileSync(file, 'utf8'))
}

/**
 * 桶存在性探针：拿一个必然不存在的对象去问。
 *   桶不在 → NoSuchBucket（400）      这是我们要拦的
 *   桶在   → NoSuchKey / 404          说明桶已就绪
 * 用公开下载端点，不需要任何权限，也不会写入任何东西。
 */
function storageBucketProbe(name, bucket) {
  return async () => {
    try {
      const res = await fetch(`${targetUrl}/storage/v1/object/public/${bucket}/__preflight__/none.webp`, requestOptions({}))
      const body = await res.text()
      if (/NoSuchBucket|Bucket not found/i.test(body)) {
        return { name, ok: false, reason: '桶不存在 —— migration-036 还没在这个库上跑过' }
      }
      return { name, ok: true }
    } catch (error) {
      return { name, ok: false, reason: error.message || String(error) }
    }
  }
}

function sourceRequiresDocTags() {
  const files = [
    'src/Board.jsx',
    'src/lib/docsApi.js',
    'src/lib/docMentionsApi.js',
    'src/lib/tagsApi.js',
  ]

  return files.some((file) => {
    if (!existsSync(file)) return false
    const content = readFileSync(file, 'utf8')
    return /\b(doc_tags|tag_id|archive_doc_tag|tagsApi)\b/.test(content)
  })
}

function authHeaders(extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    ...extra,
  }
}

function requestOptions(options = {}) {
  const signal = typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    : undefined

  return {
    ...(signal ? { signal } : {}),
    ...options,
  }
}

function parseProblem(status, body) {
  if (!body) return `HTTP ${status}`

  try {
    const parsed = JSON.parse(body)
    const code = parsed.code ? `${parsed.code}: ` : ''
    const message = parsed.message || parsed.details || body
    return `HTTP ${status} ${code}${message}`
  } catch {
    return `HTTP ${status} ${body.slice(0, 180)}`
  }
}

function isPermissionOnly(status, body) {
  if (status === 401 || status === 403) return true

  try {
    const parsed = JSON.parse(body)
    return parsed.code === '42501'
  } catch {
    return false
  }
}

function restProbe(name, path) {
  return async () => {
    try {
      const res = await fetch(`${targetUrl}${path}`, requestOptions({ headers: authHeaders() }))
      const body = await res.text()

      if (res.ok || isPermissionOnly(res.status, body)) {
        return { name, ok: true }
      }

      return { name, ok: false, reason: parseProblem(res.status, body) }
    } catch (error) {
      return { name, ok: false, reason: error.message || String(error) }
    }
  }
}

function rpcProbe(name, path, payload) {
  return async () => {
    try {
      const res = await fetch(`${targetUrl}${path}`, requestOptions({
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }))
      const body = await res.text()

      if (res.ok || isPermissionOnly(res.status, body)) {
        return { name, ok: true }
      }

      return { name, ok: false, reason: parseProblem(res.status, body) }
    } catch (error) {
      return { name, ok: false, reason: error.message || String(error) }
    }
  }
}
