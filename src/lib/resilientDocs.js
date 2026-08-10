// 永不丢字 + 保存状态：在 docsApi 外包一层。
// 核心保证：用户打的字先落 localStorage（秒级、不等网），再尝试落库；断网/失败入队、联网自动重试。
// 刷新/崩溃/断网都不丢——本地草稿在，下次加载优先用它。
// 对外状态机：'saving' | 'saved' | 'offline' | 'error'，给 UI 低干扰指示用（视觉由 @UI 规范）。
import { DocConflictError, loadDoc as _loadDoc, loadDocWithMeta as _loadDocWithMeta, saveDoc as _saveDoc } from './docsApi'
import { supabase } from './supabase'
import { report } from './report'

const LS_PREFIX = 'nownow_draft:' // 未确认落库的本地草稿
const LS_BACKUP_PREFIX = 'nownow_backup:' // 空覆盖前留的旧内容（客户端兜底，配合服务端 doc_revisions）
const docKey = (owner, section, periodKey, tagId = null) =>
  tagId ? `${owner}/${section}/${periodKey}/${tagId}` : `${owner}/${section}/${periodKey}`
const k = (owner, section, periodKey, tagId = null) => `${LS_PREFIX}${docKey(owner, section, periodKey, tagId)}`
const bk = (owner, section, periodKey, tagId = null) => `${LS_BACKUP_PREFIX}${docKey(owner, section, periodKey, tagId)}`

const pending = new Map() // key -> 最新 payload（断网/失败待重试）

// 返回是否真的写进去了。以前这里 catch 掉一切并且不吭声 ——
// 于是配额满的时候，"先落本地、永不丢字"这句话就成了空话：
// 本地没写成、网络又失败，草稿只在内存里，刷新即消失，而用户被告知"已保存"。
function lsSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true } catch { return false }
}
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null } catch { return null } }
function lsDel(key) { try { localStorage.removeItem(key) } catch {} }

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// 文档读缓存：加载过的文档存内存 + localStorage，再访问/跳转秒显，后台再刷新（stale-while-revalidate）。
// 解决「点通知跳文档 / 翻页每次都拉服务器、半天才出」。草稿(未同步)优先级高于缓存，见 loadDocResilient。
const LS_CACHE_PREFIX = 'nownow_doccache:'
const ck = (owner, section, periodKey, tagId = null) => `${LS_CACHE_PREFIX}${docKey(owner, section, periodKey, tagId)}`
const docCache = new Map() // docKey(owner, section, periodKey, tagId) -> json（内存层，最快）

// 缓存里除了内容，还要记住"这份是库里的哪一版(updatedAt)"和"什么时候取的(at)"。
// 少了这两样，就没法判断手上这份是不是已经过期 —— 而拿过期的整篇去存，
// 会把别的设备刚写的内容整段抹掉（且界面上毫无提示）。
function cacheGet(owner, section, periodKey, tagId = null) {
  const mem = docKey(owner, section, periodKey, tagId)
  if (docCache.has(mem)) return docCache.get(mem)
  const ls = lsGet(ck(owner, section, periodKey, tagId)) // 跨刷新：从 localStorage 回填内存
  if (ls && ls.json !== undefined) {
    const entry = { json: ls.json ?? null, updatedAt: ls.updatedAt ?? null, at: ls.at ?? 0 }
    docCache.set(mem, entry)
    return entry
  }
  return undefined // 未命中（undefined 区别于 null=空文档）
}
function cacheSet(owner, section, periodKey, tagId = null, json, updatedAt = null) {
  const entry = { json: json ?? null, updatedAt: updatedAt ?? null, at: Date.now() }
  docCache.set(docKey(owner, section, periodKey, tagId), entry)
  lsSet(ck(owner, section, periodKey, tagId), entry)
  pruneDocCache()
}

// 手上这份"基于的版本"。saveDocResilient 用它做保存的前置条件。
//
// 三种取值，**语义不同、绝不能混**（混了就是这次审查抓到的静默覆盖漏洞）：
//   ISO 字符串    已知版本 → 带前置条件写
//   null          已知服务器**没有**这篇 → 允许创建（upsert）
//   UNKNOWN_BASE  不知道（离线/读失败时加载的）→ **绝不能直接写**，
//                 写之前必须先向服务器要一次当前版本；要不到就入队等重试。
//                 之前这种情况被记成 null，保存就走了无条件 upsert ——
//                 一台断网机器上的旧稿会把别的设备后写的内容整篇静默抹掉。
export const UNKNOWN_BASE = '__unknown__'
const baseVersion = new Map() // docKey -> updatedAt | null | UNKNOWN_BASE
const rememberBase = (owner, section, periodKey, tagId, updatedAt) => {
  baseVersion.set(docKey(owner, section, periodKey, tagId), updatedAt ?? null)
}

// 缓存超过这个时长就不再直接拿来用，先等服务器 —— 否则一个开了一夜的标签页
// 会拿昨天的内容当"当前版本"，用户随手敲一个字就整篇盖回去。
const CACHE_MAX_AGE_MS = 30_000
/**
 * 清理那些从来没人清过的键族。
 *
 * 只有 doccache 有上限；backup / periodcache / tagcache 全是只增不减，
 * 而 backup 每次"空覆盖"或"放弃我这份"都会写进一整篇文档。堆到配额上限，
 * 倒霉的是草稿写入 —— 也就是防丢字的最后一道防线。
 */
export function pruneAll() {
  pruneDocCache()
  pruneByAge(LS_BACKUP_PREFIX, 30 * 24 * 60 * 60_000) // 备份留 30 天
  pruneByCount('nownow_periodcache:', 40)
  pruneByCount('nownow_tagcache:', 40)
}

function pruneByAge(prefix, maxAgeMs) {
  try {
    const now = Date.now()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const v = lsGet(key)
      const at = v?.backedUpAt || v?.discardedAt || v?.at
      const ts = typeof at === 'string' ? Date.parse(at) : at
      if (ts && now - ts > maxAgeMs) localStorage.removeItem(key)
    }
  } catch {}
}

function pruneByCount(prefix, max) {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) keys.push(key)
    }
    if (keys.length <= max) return
    keys.map((key) => ({ key, at: lsGet(key)?.at || 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(max)
      .forEach(({ key }) => lsDel(key))
  } catch {}
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
        // 必须用带 meta 的读：预热进缓存的条目要携带 updatedAt，
        // 否则命中它的加载会把基准记成"没有版本"，随后的保存就绕过了冲突前置条件。
        const server = await _loadDocWithMeta(t.owner, t.section, t.periodKey, t.tagId)
        // 期间用户可能已编辑/已缓存：再确认一次没东西才写，避免盖掉新缓存
        if (cacheGet(t.owner, t.section, t.periodKey, t.tagId) === undefined) cacheSet(t.owner, t.section, t.periodKey, t.tagId, server.json, server.updatedAt)
      } catch { /* 预取失败无所谓，点开时正常加载兜底 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
}

// 同步读缓存（不发网络）——给 DocBlock 同步初始化内容用：缓存命中就直接拿来当初值，
// 不经过 content=undefined 的占位空白，消除「即使缓存命中也闪一下加载」的 1 帧空白。
// 返回：undefined=未命中（按原流程异步加载）、null=空文档、obj=PM JSON。
export function peekDocCache(owner, section, periodKey, tagId = null) {
  // 只回内容本身。cacheGet 现在返回 { json, updatedAt, at }（为了做版本前置条件），
  // 但这个函数的契约一直是"直接可以当编辑器初值用的 PM JSON"——
  // 一度把整个包装对象透传出去，编辑器拿到的就不是文档了，表现为**内容凭空消失**。
  // undefined = 未命中（要显示加载占位），null = 空文档，两者不能混。
  const entry = cacheGet(owner, section, periodKey, tagId)
  return entry === undefined ? undefined : entry.json ?? null
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
    if (!isEffectivelyEmpty(local.json, local.text)) {
      // 草稿是"还没落库的我自己的修改"，它基于的版本记在草稿里。
      rememberBase(owner, section, periodKey, tagId, local.baseUpdatedAt ?? null)
      return local.json ?? null
    }
    try {
      const server = await _loadDocWithMeta(owner, section, periodKey, tagId)
      if (!isEffectivelyEmpty(server.json, null)) {
        lsDel(k(owner, section, periodKey, tagId))
        cacheSet(owner, section, periodKey, tagId, server.json, server.updatedAt)
        rememberBase(owner, section, periodKey, tagId, server.updatedAt)
        return server.json
      }
    } catch { /* 服务器读不到：退回本地，保持"永不丢字"语义 */ }
    rememberBase(owner, section, periodKey, tagId, local.baseUpdatedAt ?? null)
    return local.json ?? null
  }
  // 无草稿 → 缓存优先，但只在"足够新"时才直接用。
  // 旧缓存照样先渲染（秒显），只是不把它当成可以据以覆盖的版本 —— 保存时
  // 前置条件会不匹配，从而走冲突路径而不是静默抹掉别人写的东西。
  const cached = cacheGet(owner, section, periodKey, tagId)
  if (cached !== undefined && Date.now() - (cached.at || 0) < CACHE_MAX_AGE_MS) {
    rememberBase(owner, section, periodKey, tagId, cached.updatedAt)
    _loadDocWithMeta(owner, section, periodKey, tagId)
      .then((fresh) => {
        cacheSet(owner, section, periodKey, tagId, fresh.json, fresh.updatedAt)
        rememberBase(owner, section, periodKey, tagId, fresh.updatedAt)
      })
      .catch(() => {})
    return cached.json
  }
  try {
    const server = await _loadDocWithMeta(owner, section, periodKey, tagId)
    cacheSet(owner, section, periodKey, tagId, server.json, server.updatedAt)
    rememberBase(owner, section, periodKey, tagId, server.updatedAt)
    return server.json
  } catch (err) {
    // 服务器拿不到时，宁可显示旧缓存也不要空白页。基准记 UNKNOWN（不是 null！）：
    // null 的含义是"确认服务器没有这篇、可以创建"，会放行无条件 upsert；
    // 这里只是"不知道"，保存前必须先问到服务器的当前版本。
    if (cached !== undefined) {
      rememberBase(owner, section, periodKey, tagId, UNKNOWN_BASE)
      return cached.json
    }
    throw err
  }
}

// 存：先落本地（永不丢），再尝试落库；失败/断网入队等重试。onState 给 UI 显示。
// 守卫(P0-2)：把"空"存进来、而上一份非空时，先把旧的备份到 backup key——客户端兜底；
// 服务端还有 doc_revisions 触发器在覆盖前快照旧版，双保险，空存也丢不掉。
export async function saveDocResilient({ owner, section, periodKey, tagId = null, json, text }, onState, _afterConflict = false) {
  const key = k(owner, section, periodKey, tagId)
  if (isEffectivelyEmpty(json, text)) {
    const prev = lsGet(key)
    if (prev && !isEffectivelyEmpty(prev.json, prev.text)) {
      lsSet(bk(owner, section, periodKey, tagId), { ...prev, backedUpAt: new Date().toISOString() })
    }
  }
  const bkey = docKey(owner, section, periodKey, tagId)
  // 从没加载过（或读失败）就保存 → 基准未知，走 UNKNOWN 路径，绝不默认成"可创建"
  const base = baseVersion.has(bkey) ? baseVersion.get(bkey) : UNKNOWN_BASE
  const payload = { owner, section, periodKey, tagId, json, text, baseUpdatedAt: base }
  const localOk = lsSet(key, payload) // ← 永不丢字：先写本地
  if (!localOk) {
    // 本地这层已经失守。配额满通常是缓存/备份堆积造成的，先清一轮再试一次。
    pruneAll()
    if (!lsSet(key, payload)) onState?.('error') // 说出来：此刻"不丢字"这个承诺是不成立的
  }
  cacheSet(owner, section, periodKey, tagId, json, base) // 读缓存跟着自己的编辑走，绝不被旧缓存遮住
  if (isOffline()) { pending.set(key, payload); onState?.('offline'); return }
  onState?.('saving')
  // 基准未知：先向服务器要当前版本，要到了才带着前置条件写。
  // 要不到（网断/服务器挂）就把草稿留在队列里等重试 —— 宁可晚同步，不盲写。
  let effectiveBase = base
  if (effectiveBase === UNKNOWN_BASE) {
    try {
      const current = await _loadDocWithMeta(owner, section, periodKey, tagId)
      effectiveBase = current.updatedAt // 字符串=已知版本；null=确认不存在，可创建
      rememberBase(owner, section, periodKey, tagId, effectiveBase)
    } catch {
      pending.set(key, payload)
      onState?.(isOffline() ? 'offline' : 'error')
      return
    }
  }
  try {
    const res = await _saveDoc({ ...payload, expectedUpdatedAt: effectiveBase })
    lsDel(key); pending.delete(key)
    // 记住新版本号，下一次编辑就是基于它 —— 否则连续两次保存的第二次会误报冲突。
    rememberBase(owner, section, periodKey, tagId, res?.updatedAt ?? null)
    cacheSet(owner, section, periodKey, tagId, json, res?.updatedAt ?? null)
    onState?.('saved')
  } catch (err) {
    // 冲突：别的设备/标签页在我加载之后写过同一篇。
    //
    // 按海涛的决定，这里**不问用户**，静默地以「我正在打字的这份为准」自动处理：
    // 重新读一次服务器的当前版本作为基准，再把手上这份写上去。
    //
    // 之所以敢自动覆盖：docs 上的 trg_snapshot_doc_revision 会在更新前把被覆盖的
    // 那一版快照进 doc_revisions —— 内容不会真正消失，只是用户没有自助入口。
    //
    // 只自动处理一次（_afterConflict）。第二次还冲突说明有别的东西在持续写，
    // 这时候必须停下来报错：无限重试等于两边互相覆盖。
    if (err instanceof DocConflictError) {
      pending.delete(key)
      if (_afterConflict) { report('save-conflict', err, { section, periodKey }); onState?.('error'); return }
      try {
        const current = await _loadDocWithMeta(owner, section, periodKey, tagId)
        rememberBase(owner, section, periodKey, tagId, current.updatedAt)
        await saveDocResilient({ owner, section, periodKey, tagId, json, text }, onState, true)
      } catch {
        // 解析基准时网又断了：草稿必须回到重试队列 —— 否则「重试」按钮
        // （它只重放队列）对这份草稿永远无效，成了一个空按钮。
        pending.set(key, payload)
        onState?.('error')
      }
      return
    }
    pending.set(key, payload)
    const offline = isOffline()
    // 保存失败率是这个产品最该被盯住的一个数字 —— 尤其国内走 /sb 那条代理。
    // 离线不算故障（那是预期内的，队列会补），只报真的失败。
    if (!offline) report('save', err, { section, periodKey })
    onState?.(offline ? 'offline' : 'error')
  }
}

// 重试队列里所有待存的（联网恢复 / 启动时调）。
//
// 关键：**不盲目重放**。一份周五断网留下的草稿，如果直接 upsert 上去，
// 会把周末在手机上写的东西整篇盖掉。所以每条都带着"我基于哪一版"的前置条件，
// 库里那一版变了就不写，把草稿留在本地等人来决定。
export async function flushPending() {
  if (isOffline() || pending.size === 0) return
  for (const [key, payload] of [...pending]) {
    try {
      // 基准未知的遗留草稿：先问服务器当前版本，问不到就留到下次，绝不盲写。
      // ⚠️ 部署前的老草稿 payload 里**没有** baseUpdatedAt 这个字段 —— 那是"未知"，
      // 不是"确认不存在"（null）。用 in 判断，缺字段一律按未知处理。
      let base = 'baseUpdatedAt' in payload ? (payload.baseUpdatedAt ?? null) : UNKNOWN_BASE
      if (base === UNKNOWN_BASE) {
        try {
          base = (await _loadDocWithMeta(payload.owner, payload.section, payload.periodKey, payload.tagId)).updatedAt
        } catch { continue }
      }
      const res = await _saveDoc({ ...payload, expectedUpdatedAt: base })
      lsDel(key)
      pending.delete(key)
      rememberBase(payload.owner, payload.section, payload.periodKey, payload.tagId, res?.updatedAt ?? null)
    } catch (err) {
      if (err instanceof DocConflictError) {
        // 服务器上有更新的内容。旧稿**收进备份、从草稿位挪走**：
        // 内容不丢（backup 键 + 服务端 doc_revisions 双保险），但绝不再遮住
        // 服务器上更新的那份 —— 之前只退出队列不清草稿，结果是打开这篇永远
        // 显示旧稿、看不见别的设备后写的内容，第一次敲键还会把旧稿写回去。
        lsSet(bk(payload.owner, payload.section, payload.periodKey, payload.tagId), { ...payload, conflictedAt: new Date().toISOString() })
        lsDel(key)
        forgetDocCacheFor(payload.owner, payload.section, payload.periodKey, payload.tagId)
        pending.delete(key)
        continue
      }
      /* 其它错误：留到下次 */
    }
  }
}

/**
 * 忘掉某篇的读缓存 —— 服务端在本客户端之外被改过时用（例如"搬到今天"、冲突让位）。
 *
 * 不做这一步的话：改完之后还显示旧缓存（看起来像没生效），
 * 而用户如果去编辑那个"还在原地"的块，就会把它整篇写回去 —— 结果是块被复制成两份。
 */
export function forgetDocCacheFor(owner, section, periodKey, tagId = null) {
  const key = docKey(owner, section, periodKey, tagId)
  docCache.delete(key)
  baseVersion.delete(key)
  lsDel(ck(owner, section, periodKey, tagId))
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
    // favicon 缓存也清掉：换账号登录时，标签页图标不该还挂着上一个人的头像
    try { localStorage.removeItem('nownow_favicon'); localStorage.removeItem('nownow_favicon_for') } catch { /* 无所谓 */ }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key && key.startsWith(LS_CACHE_PREFIX)) localStorage.removeItem(key)
      }
    } catch {}
  })
}
