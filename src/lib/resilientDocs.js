// 永不丢字 + 保存状态：在 docsApi 外包一层。
// 核心保证：用户打的字先落 localStorage（秒级、不等网），再尝试落库；断网/失败入队、联网自动重试。
// 刷新/崩溃/断网都不丢——本地草稿在，下次加载优先用它。
// 对外状态机：'saving' | 'saved' | 'offline' | 'error'，给 UI 低干扰指示用（视觉由 @UI 规范）。
import { loadDoc as _loadDoc, saveDoc as _saveDoc } from './docsApi'
import { supabase } from './supabase'

const LS_PREFIX = 'nownow_draft:' // 未确认落库的本地草稿
const LS_BACKUP_PREFIX = 'nownow_backup:' // 空覆盖前留的旧内容（客户端兜底，配合服务端 doc_revisions）
const docKey = (owner, section, periodKey, tagId = null) =>
  tagId ? `${owner}/${section}/${periodKey}/${tagId}` : `${owner}/${section}/${periodKey}`
const k = (owner, section, periodKey, tagId = null) => `${LS_PREFIX}${docKey(owner, section, periodKey, tagId)}`
const bk = (owner, section, periodKey, tagId = null) => `${LS_BACKUP_PREFIX}${docKey(owner, section, periodKey, tagId)}`

const pending = new Map() // key -> 最新 payload（断网/失败待重试）

function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null } catch { return null } }
function lsDel(key) { try { localStorage.removeItem(key) } catch {} }

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// 文档读缓存：加载过的文档存内存 + localStorage，再访问/跳转秒显，后台再刷新（stale-while-revalidate）。
// 解决「点通知跳文档 / 翻页每次都拉服务器、半天才出」。草稿(未同步)优先级高于缓存，见 loadDocResilient。
const LS_CACHE_PREFIX = 'nownow_doccache:'
const ck = (owner, section, periodKey, tagId = null) => `${LS_CACHE_PREFIX}${docKey(owner, section, periodKey, tagId)}`
const docCache = new Map() // docKey(owner, section, periodKey, tagId) -> json（内存层，最快）

function cacheGet(owner, section, periodKey, tagId = null) {
  const mem = docKey(owner, section, periodKey, tagId)
  if (docCache.has(mem)) return docCache.get(mem)
  const ls = lsGet(ck(owner, section, periodKey, tagId)) // 跨刷新：从 localStorage 回填内存
  if (ls && ls.json !== undefined) { docCache.set(mem, ls.json ?? null); return ls.json ?? null }
  return undefined // 未命中（undefined 区别于 null=空文档）
}
function cacheSet(owner, section, periodKey, tagId = null, json) {
  docCache.set(docKey(owner, section, periodKey, tagId), json ?? null)
  lsSet(ck(owner, section, periodKey, tagId), { json: json ?? null, at: Date.now() })
  pruneDocCache()
}
// 限制 localStorage 里缓存的文档数（按最近访问，留最近 40 篇），防膨胀。
function pruneDocCache(max = 40) {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(LS_CACHE_PREFIX)) keys.push(key)
    }
    if (keys.length <= max) return
    keys.map((key) => ({ key, at: lsGet(key)?.at || 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(max)
      .forEach(({ key }) => lsDel(key))
  } catch {}
}

// 一份 PM JSON / 文本是否"实质为空"（空 doc、只剩空段落、无可见内容）。
// 防数据丢失的关键判定：空草稿不许遮服务器、空内容覆盖非空前先备份。
function isEffectivelyEmpty(json, text) {
  if (typeof text === 'string' && text.trim().length > 0) return false
  if (!json || !Array.isArray(json.content)) return true
  const hasContent = (node) => {
    if (!node) return false
    if (node.type === 'text' && (node.text || '').trim()) return true
    if (node.type === 'mention') return true
    if (['image', 'table', 'horizontalRule'].includes(node.type)) return true
    return Array.isArray(node.content) && node.content.some(hasContent)
  }
  return !json.content.some(hasContent)
}

// 预取（warm）：把一批 (owner, section, periodKey, tagId) 的文档悄悄拉进缓存，让「第一次点开」也秒出。
// 只热没缓存过的（已缓存/有草稿的跳过，绝不覆盖用户未同步内容）；失败静默；并发小批、不抢主加载。
// 典型用法：成员列表加载完，warmCache(activeProfiles.map(p=>({owner:p.id, section:'today', periodKey:todayKey})))。
export async function warmCache(targets, { concurrency = 4 } = {}) {
  if (typeof window === 'undefined' || !Array.isArray(targets)) return
  // 待热的：没读缓存、且没本地草稿（草稿优先级更高、别用服务器盖）
  const todo = targets.filter((t) => {
    if (!t || !t.owner) return false
    if (cacheGet(t.owner, t.section, t.periodKey, t.tagId) !== undefined) return false
    const draft = lsGet(k(t.owner, t.section, t.periodKey, t.tagId))
    return !(draft && draft.json !== undefined)
  })
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++]
      try {
        const server = await _loadDoc(t.owner, t.section, t.periodKey, t.tagId)
        // 期间用户可能已编辑/已缓存：再确认一次没东西才写，避免盖掉新缓存
        if (cacheGet(t.owner, t.section, t.periodKey, t.tagId) === undefined) cacheSet(t.owner, t.section, t.periodKey, t.tagId, server)
      } catch { /* 预取失败无所谓，点开时正常加载兜底 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
}

// 同步读缓存（不发网络）——给 DocBlock 同步初始化内容用：缓存命中就直接拿来当初值，
// 不经过 content=undefined 的占位空白，消除「即使缓存命中也闪一下加载」的 1 帧空白。
// 返回：undefined=未命中（按原流程异步加载）、null=空文档、obj=PM JSON。
export function peekDocCache(owner, section, periodKey, tagId = null) {
  return cacheGet(owner, section, periodKey, tagId)
}

export function forgetDocCacheForTags(owner, section, tagIds = [null]) {
  if (!owner || !section) return
  const tags = Array.isArray(tagIds) ? tagIds : [tagIds]
  const wantsTag = (rawKey) => {
    const prefix = `${owner}/${section}/`
    if (!rawKey.startsWith(prefix)) return false
    const rest = rawKey.slice(prefix.length)
    return tags.some((tagId) => {
      if (tagId) return rest.endsWith(`/${tagId}`)
      return !rest.includes('/')
    })
  }
  for (const key of [...docCache.keys()]) {
    if (wantsTag(key)) docCache.delete(key)
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key?.startsWith(LS_CACHE_PREFIX)) continue
      const rawKey = key.slice(LS_CACHE_PREFIX.length)
      if (wantsTag(rawKey)) localStorage.removeItem(key)
    }
  } catch {}
}

// 读：本地有未同步草稿就优先用（防"断网/刷新丢字"），否则读服务器。
// 守卫(P1-6)：本地草稿"实质为空"时绝不盲信——去服务器看一眼，服务器非空就以服务器为准、
// 并清掉这份坏空草稿。否则一份误存的空草稿会一直遮住库里的真内容（这次事故的显空根因之一）。
export async function loadDocResilient(owner, section, periodKey, tagId = null) {
  const local = lsGet(k(owner, section, periodKey, tagId))
  if (local && local.json !== undefined) {
    if (!isEffectivelyEmpty(local.json, local.text)) return local.json ?? null
    try {
      const server = await _loadDoc(owner, section, periodKey, tagId)
      if (!isEffectivelyEmpty(server, null)) { lsDel(k(owner, section, periodKey, tagId)); cacheSet(owner, section, periodKey, tagId, server); return server }
    } catch { /* 服务器读不到：退回本地，保持"永不丢字"语义 */ }
    return local.json ?? null
  }
  // 无草稿 → 缓存优先：命中就秒返 + 后台刷新缓存（跳转/翻页即时）；未命中拉服务器并缓存。
  const cached = cacheGet(owner, section, periodKey, tagId)
  if (cached !== undefined) {
    _loadDoc(owner, section, periodKey, tagId).then((fresh) => cacheSet(owner, section, periodKey, tagId, fresh)).catch(() => {})
    return cached
  }
  const server = await _loadDoc(owner, section, periodKey, tagId)
  cacheSet(owner, section, periodKey, tagId, server)
  return server
}

// 存：先落本地（永不丢），再尝试落库；失败/断网入队等重试。onState 给 UI 显示。
// 守卫(P0-2)：把"空"存进来、而上一份非空时，先把旧的备份到 backup key——客户端兜底；
// 服务端还有 doc_revisions 触发器在覆盖前快照旧版，双保险，空存也丢不掉。
export async function saveDocResilient({ owner, section, periodKey, tagId = null, json, text }, onState) {
  const key = k(owner, section, periodKey, tagId)
  if (isEffectivelyEmpty(json, text)) {
    const prev = lsGet(key)
    if (prev && !isEffectivelyEmpty(prev.json, prev.text)) {
      lsSet(bk(owner, section, periodKey, tagId), { ...prev, backedUpAt: new Date().toISOString() })
    }
  }
  const payload = { owner, section, periodKey, tagId, json, text }
  lsSet(key, payload) // ← 永不丢字：先写本地
  cacheSet(owner, section, periodKey, tagId, json) // 读缓存跟着自己的编辑走，绝不被旧缓存遮住
  if (isOffline()) { pending.set(key, payload); onState?.('offline'); return }
  onState?.('saving')
  try {
    await _saveDoc(payload)
    lsDel(key); pending.delete(key)
    onState?.('saved')
  } catch {
    pending.set(key, payload)
    onState?.(isOffline() ? 'offline' : 'error')
  }
}

// 重试队列里所有待存的（联网恢复 / 启动时调）。
export async function flushPending() {
  if (isOffline() || pending.size === 0) return
  for (const [key, payload] of [...pending]) {
    try { await _saveDoc(payload); lsDel(key); pending.delete(key) } catch { /* 留到下次 */ }
  }
}

// 启动时把上次会话遗留的本地草稿收进重试队列（关标签页/断网遗留也不丢）。
if (typeof window !== 'undefined') {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(LS_PREFIX)) {
        const p = lsGet(key)
        if (p) pending.set(key, p)
      }
    }
  } catch {}
  flushPending()
  window.addEventListener('online', flushPending)

  // 退出登录时清「读缓存」(doccache)：同浏览器换账号不残留上个账号的缓存内容（隐私）。
  // ⚠️ 草稿/备份不清——那是「永不丢字」+ 可恢复内容，留着等同账号重登能找回(flushPending)。
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return
    docCache.clear()
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key && key.startsWith(LS_CACHE_PREFIX)) localStorage.removeItem(key)
      }
    } catch {}
  })
}
