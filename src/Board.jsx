import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bell, ChevronLeft, ChevronRight, CircleCheck, Menu, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Search, Settings } from 'lucide-react'
import { loadRecentActivity } from './lib/docsApi'
import { report } from './lib/report'
import AvatarPicker, { avatarSrc } from './components/AvatarPicker'
import { supabase } from './lib/supabase'
import { friendlyDbError } from './lib/errors'
import { inPeriod, offsetOf, periodHeader, periodRange } from './lib/period'
import { loadMyMentions, loadMyCompletions, loadMentionFrequency } from './lib/docMentionsApi'
import { forgetDocCacheForTags, warmCache } from './lib/resilientDocs'
import { periodKey } from './lib/periodKey'
import { archiveTag, createTag as createDocTag, loadDocTags, peekDocTags, rememberDocTags, renameTag as renameDocTag, updateTagOrder } from './lib/tagsApi'
import NotificationsPage from './components/NotificationsPage'
import DocTimeline from './components/DocTimeline'
import DocSearch from './components/DocSearch'
import DocTagBar from './components/DocTagBar'
import SettingsModal from './components/SettingsModal'

const SECTIONS = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'stash', label: '收集箱' },
]

const LAST_VIEWED_KEY = 'nownow_last_viewed'
const loadLastViewed = () => {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

// 首次进入：凭邀请链接起名进入（没有邀请 = 进不来）
// 侧栏成员行：直接按住名字拖动排序（顺序存本地，纯个人视图偏好，不进数据库）
// 拖动中的那一行用选中同款底色高亮
function SortableMemberRow({ p, isMe, active, news, pinned, onClick, onTogglePin }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        'group/mem flex w-full items-center rounded-md px-2.5 py-1.5 text-[14px] max-md:py-2 ' +
        (isDragging ? 'z-10 ' : '') +
        (active || isDragging ? 'bg-[var(--nav-soft)] font-medium text-stone-900' : 'text-stone-600 hover:bg-[var(--nav-soft)]')
      }
    >
      {/* 按住名字拖动排序；点击进主页 */}
      <button {...attributes} {...listeners} onClick={onClick} className="flex min-w-0 flex-1 cursor-pointer items-center text-left">
        <span className="truncate">
          {p.display_name}
          {isMe ? '（我）' : ''}
        </span>
      </button>
      {news && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="有新动态" aria-label="有新动态" />}
      {/* 置顶/取消置顶：纯图标、只在 hover 出现（置顶态本身靠分组「置顶成员」体现，按钮不常驻）。
          未置顶=📌(Pin)、已置顶=斜线📌(PinOff)。个人偏好、存本地。 */}
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(p.id) }}
        title={pinned ? '取消置顶' : '置顶'}
        className="ml-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-400 opacity-0 transition hover:text-stone-600 group-hover/mem:opacity-100 max-md:opacity-60"
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
    </div>
  )
}

const MEMBER_ORDER_KEY = 'nownow_member_order'
const PINNED_KEY = 'nownow_pinned_members'

function SetupCard({ user, onDone }) {
  // 邀请页已经填过名字的话直接自动认领进入，不再问一遍
  const pendingName = localStorage.getItem('nownow_pending_name') || ''
  const [handle, setHandle] = useState(pendingName || user.email.split('@')[0].replace(/\W/g, ''))
  const [err, setErr] = useState('')
  const [auto, setAuto] = useState(!!pendingName)
  const autoFired = useRef(false)
  const invite = localStorage.getItem('nownow_invite')

  async function claim(raw) {
    setErr('')
    const clean = raw.trim().replace(/^@/, '')
    if (!clean || /\s/.test(clean)) { setAuto(false); setErr('名字不能为空或带空格'); return }
    // 固定邀请码大门：登录页存进 nownow_invite_code，后端 redeem_code 校验码 + 建 profile
    const code = (localStorage.getItem('nownow_invite_code') || localStorage.getItem('nownow_invite') || '').trim()
    const { error } = await supabase.rpc('redeem_code', { p_code: code, p_name: clean })
    if (error) {
      setAuto(false)
      setErr(friendlyDbError(error.message))
      return
    }
    localStorage.removeItem('nownow_invite')
    localStorage.removeItem('nownow_invite_code')
    localStorage.removeItem('nownow_pending_name')
    onDone()
  }

  useEffect(() => {
    if (auto && !autoFired.current) {
      autoFired.current = true
      claim(pendingName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(e) {
    e.preventDefault()
    claim(handle)
  }

  if (auto)
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-stone-400">正在进入…</p>
      </div>
    )

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={save} className="w-full max-w-xs rounded-lg border border-stone-200 bg-white p-7">
        <h2 className="text-lg font-semibold">第一次来，起个名字</h2>
        <label className="mt-4 block text-xs text-stone-500">
          名字（显示用它，@你 也用它；中英文都行，如 海涛）
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-[15px] text-stone-900 outline-none focus:border-stone-400"
          />
        </label>
        <button type="submit" className="mt-5 w-full rounded-md bg-[var(--btn-bg)] py-2.5 text-[15px] text-[var(--btn-fg)] hover:bg-[var(--btn-bg-hover)]">
          进入
        </button>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </form>
    </div>
  )
}

export default function Board({ session }) {
  const user = session.user
  const [profiles, setProfiles] = useState([])
  const [mentionFreq, setMentionFreq] = useState({}) // 我 @ 各人的次数 {id:count}，@选框「常用靠前」用
  const [needSetup, setNeedSetup] = useState(false)
  const [pageUserId, setPageUserId] = useState(null)
  const [allEntries, setAllEntries] = useState([])
  const [mentions, setMentions] = useState([])
  const [allMentions, setAllMentions] = useState([])
  const [docMentions, setDocMentions] = useState([]) // doc 世界的 @我（未忽略的，含已读/未读）
  const [docDone, setDocDone] = useState([]) // 别人 ✓ 了我 @ 的事（黄色知会），未点掉的
  const [lastViewed, setLastViewed] = useState(loadLastViewed)

  const me = profiles.find((p) => p.id === user.id) || null
  const activeProfiles = useMemo(
    () => profiles.filter((p) => p.status !== 'pending'),
    [profiles],
  )
  const pageUser = profiles.find((p) => p.id === pageUserId) || me
  const isMyPage = !!pageUser && !!me && pageUser.id === me.id
  const [myInviteTokens, setMyInviteTokens] = useState([])

  const [query, setQuery] = useState('') // 顶部搜索：直接输入、就地过滤 todolist
  const [baseDate, setBaseDate] = useState(null) // null = 真实今天；设了 = 整张纸拨回那天
  const [dateOpen, setDateOpen] = useState(false)
  const [flashId, setFlashId] = useState(null) // 搜索跳转后高亮定位的条目
  const [flashDoc, setFlashDoc] = useState(null) // @通知跳转后落地高亮的文档块 {section, periodKey}
  const [editRequest, setEditRequest] = useState(null) // 跨区接力：让某个区的第一条进入编辑
  const [channel, setChannel] = useState('today') // 当前频道：today/week/month/stash（一次只看一个）
  const [docTags, setDocTags] = useState([])
  const [docTagsReady, setDocTagsReady] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState(null)
  const [docTagsScope, setDocTagsScope] = useState('')
  const [docRefreshNonce, setDocRefreshNonce] = useState(0)
  const requestedTagRef = useRef(null)
  const currentDocTagsScope = pageUserId ? `${pageUserId}:${channel}` : ''
  const currentDocTagsScopeRef = useRef(currentDocTagsScope)
  currentDocTagsScopeRef.current = currentDocTagsScope
  const docTagsScopeMatches = docTagsScope === currentDocTagsScope
  const cachedDocTagsInScope = pageUserId ? peekDocTags(pageUserId, channel) : undefined
  const docTagsInScope = docTagsScopeMatches ? docTags : (cachedDocTagsInScope || [])
  const docTagsReadyInScope = docTagsScopeMatches ? docTagsReady : cachedDocTagsInScope !== undefined
  const selectedTagIdInScope = docTagsScopeMatches ? selectedTagId : null
  const selectedTag = useMemo(
    () => docTagsInScope.find((tag) => tag.id === selectedTagIdInScope) || null,
    [docTagsInScope, selectedTagIdInScope],
  )
  const selectedDocTagId = selectedTag?.tagId || null
  // 每个频道各自的时间回看偏移（负=往前看）。‹ › 挪到了顶部频道标签旁，offset 上提到这里统一管
  const [offsets, setOffsets] = useState({})
  const channelOffset = offsets[channel] || 0
  const goChannel = useCallback((key) => {
    requestedTagRef.current = null
    setSelectedTagId(null)
    setChannel(key)
    setOffsets((o) => ({ ...o, [key]: 0 })) // 点标签名字 = 切到该频道并回到当前
  }, [])
  const stepChannel = useCallback((key, dir) => {
    setChannel(key)
    setOffsets((o) => ({ ...o, [key]: Math.min(0, (o[key] || 0) + dir) })) // 不能看未来，封顶 0
  }, [])
  const isLive = !baseDate

  // 时间线各块不做跨块/跨频道的焦点接力（焦点都在块内，避免回车/↓ 乱跳或切走视图）
  const noEditRelay = useCallback(() => {}, [])

  // 当前周期块占满首屏：用 JS 量滚动区可视高度（CSS min-h-full 会被容器 pb-24 内边距吃掉而短一截）。
  // 用 callback ref 而非 useRef+effect：组件初次渲染常在 loading 态，滚动区还没挂载，普通 effect 会量到 null 且不再重跑。
  const [viewportH, setViewportH] = useState(0)
  const roRef = useRef(null)
  const scrollRef = useCallback((node) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (node && typeof ResizeObserver !== 'undefined') {
      const measure = () => setViewportH(node.clientHeight)
      measure()
      roRef.current = new ResizeObserver(measure)
      roRef.current.observe(node)
    }
  }, [])

  // 跨频道接力：键盘流转到别的频道（如 today→week）时自动切过去，让目标 Section 挂载并接住 editRequest
  useEffect(() => {
    if (!editRequest) return
    const target = editRequest.split(':')[0]
    if (SECTIONS.some((s) => s.key === target) && target !== channel) setChannel(target)
  }, [editRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘Z 撤销栈：完成/关闭/删除 这类非文字操作（文字编辑用 textarea 原生撤销）
  const undoStack = useRef([])
  const pushUndo = useCallback((item) => {
    undoStack.current.push(item)
    if (undoStack.current.length > 50) undoStack.current.shift()
  }, [])

  const loadProfiles = useCallback(async () => {
    const [{ data, error }, { data: inv }] = await Promise.all([
      supabase.from('profiles').select('*').order('handle'),
      supabase.from('invites').select('token').eq('created_by', user.id),
    ])
    // 关键：profiles 查询失败时绝不静默清空 / 误判「没 profile」。
    // 之前吞了 error → 查询一旦报错或被 RLS 挡空，就 profiles=[] + needSetup=true，
    // 表现成「数据全空 + 弹起名字卡片」，用户以为数据丢了、再起名还可能造重复行。
    // 失败就保留上次状态、记日志、等下次重试，绝不据此改 needSetup。
    if (error) {
      console.error('[loadProfiles] profiles 查询失败，保留现状不清空：', error)
      return
    }
    setProfiles(data || [])
    setMyInviteTokens((inv || []).map((i) => i.token))
    setNeedSetup(!(data || []).some((p) => p.id === user.id))
  }, [user.id])

  const [loaded, setLoaded] = useState(false)

  // 旧 entries/mentions 表已下线（全文档化）：不再查旧表，留空让所有旧派生值自然为空。
  // 文档内容走 docsApi（DocBlock/DocTimeline 各自加载），不经这里。
  const fetchAll = useCallback(async () => ({ es: [], ms: [], am: [] }), [])

  const applyLoad = useCallback(
    ({ es, ms, am }) => {
      // 旧 entries/mentions 表已下线：es/ms/am 恒为空，这里只把派生态置空、不再碰旧表。
      setAllEntries(es)
      setMentions(ms)
      setAllMentions(am)
      setLoaded(true)
    },
    [],
  )

  const doLoad = useCallback(async () => applyLoad(await fetchAll()), [fetchAll, applyLoad])

  // 本地优先：还有写操作在路上时绝不刷新（刷早了会把刚删/刚改的内容"复活"）
  // mutEpoch：请求发出后若又有新写操作，这次拉回的快照就是旧的，整个丢弃重拉
  const pendingOps = useRef(0)
  const mutEpoch = useRef(0)
  const [syncing, setSyncing] = useState(false)
  const loadTimer = useRef(null)
  const loadData = useCallback(() => {
    clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(async () => {
      if (pendingOps.current > 0) {
        loadData() // 写操作没落完，再等一拍
        return
      }
      const epoch = mutEpoch.current
      const fresh = await fetchAll()
      if (mutEpoch.current !== epoch || pendingOps.current > 0) {
        loadData() // 拉的过程中又有新操作，这份快照作废
        return
      }
      applyLoad(fresh)
    }, 400)
  }, [fetchAll, applyLoad])

  // 失败的写操作进重试队列：断网期间的改动恢复网络后自动补存
  const retryQueue = useRef([])

  // 乐观更新（flomo 式先本地后同步）：UI 立即生效，服务端后台跑，全部落完才与库对齐
  const mutateEntries = useCallback(
    (transform, op) => {
      mutEpoch.current++
      setAllEntries(transform)
      pendingOps.current++
      setSyncing(true)
      Promise.resolve()
        .then(op)
        .catch(() => {
          retryQueue.current.push({ op, tries: 0 })
        })
        .finally(() => {
          pendingOps.current--
          if (pendingOps.current === 0) setSyncing(false)
          loadData()
        })
    },
    [loadData],
  )

  // 恢复网络后按顺序重放失败的操作（最多重试 3 次，防非网络性错误死循环）
  const replayFailed = useCallback(async () => {
    const q = retryQueue.current
    if (!q.length) return
    retryQueue.current = []
    mutEpoch.current++
    pendingOps.current++
    setSyncing(true)
    for (const it of q) {
      try {
        await it.op()
      } catch {
        if (++it.tries < 3) retryQueue.current.push(it)
      }
    }
    pendingOps.current--
    if (pendingOps.current === 0) setSyncing(false)
    loadData()
  }, [loadData])

  // 只在"有问题"时提示：离线 / 同步卡了超过 2.5 秒（顺畅时完全安静）
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => { setOffline(false); replayFailed() }
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [replayFailed])
  const [syncSlow, setSyncSlow] = useState(false)
  useEffect(() => {
    if (!syncing) { setSyncSlow(false); return }
    const t = setTimeout(() => setSyncSlow(true), 2500)
    return () => clearTimeout(t)
  }, [syncing])

  // 同步没落完时阻止关页/刷新（flomo 的"未同步会丢"防护）
  useEffect(() => {
    const h = (e) => {
      if (pendingOps.current > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  // 快捷键：/ 聚焦捕捉框；⌘K 搜索；⌘Z 撤销完成/删除（mac/win 通吃）
  useEffect(() => {
    const h = (e) => {
      const inText = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
        return
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])
  useEffect(() => { doLoad() }, [doLoad])
  useEffect(() => { if (me && !pageUserId) setPageUserId(me.id) }, [me, pageUserId])

  // 预热缓存：成员列表/当前频道/日期变化后，后台把每个成员「当前频道的当前周期」文档拉进缓存，
  // 让第一次点开没看过的成员也即时（不再首屏空白）。已缓存/有草稿的自动跳过、并发 4、失败静默（warmCache 内部处理）。
  useEffect(() => {
    if (!activeProfiles.length) return
    const key = periodKey(channel, 0, baseDate)
    // 只预热"看得见的那些人"。原来是对全部 80 位成员各发一次文档查询 ——
      // 在国内经 /sb 代理，这一波会和用户自己那篇文档抢带宽，正是"点开慢"的一大来源。
      warmCache(activeProfiles.slice(0, 12).map((p) => ({ owner: p.id, section: channel, periodKey: key, tagId: selectedDocTagId })))
  }, [activeProfiles, channel, baseDate, selectedDocTagId])

  useEffect(() => {
    if (!pageUserId || !docTagsReadyInScope) return
    const key = periodKey(channel, 0, baseDate)
    warmCache([
      { owner: pageUserId, section: channel, periodKey: key, tagId: null },
      ...docTagsInScope.map((tag) => ({ owner: pageUserId, section: channel, periodKey: key, tagId: tag.tagId })),
    ])
  }, [pageUserId, channel, baseDate, docTagsInScope, docTagsReadyInScope])

  useEffect(() => {
    if (!pageUserId) {
      setDocTagsScope('')
      setDocTags([])
      setDocTagsReady(false)
      setSelectedTagId(null)
      return
    }
    let alive = true
    const scope = currentDocTagsScope
    const requested = requestedTagRef.current
    const requestedMatches = requested?.owner === pageUserId && requested?.section === channel
    const requestedTagId = requestedMatches ? requested.tagId : null
    if (requestedMatches) requestedTagRef.current = null
    const cachedTags = peekDocTags(pageUserId, channel)
    setDocTagsScope(scope)
    setDocTags(cachedTags || [])
    setDocTagsReady(cachedTags !== undefined)
    setSelectedTagId(requestedTagId)
    loadDocTags(pageUserId, channel)
      .then(({ tags, ready }) => {
        if (!alive) return
        setDocTagsScope(scope)
        setDocTags(tags)
        setDocTagsReady(ready)
        if (requestedTagId && !tags.some((tag) => tag.id === requestedTagId)) {
          setSelectedTagId(null)
        }
      })
      .catch(() => {
        if (!alive) return
        setDocTags([])
        setDocTagsReady(false)
        setSelectedTagId(null)
      })
    return () => {
      alive = false
    }
  }, [pageUserId, channel, currentDocTagsScope])

  const selectDocTag = useCallback(
    (tagId) => {
      requestedTagRef.current = null
      setSelectedTagId(tagId)
    },
    [],
  )

  const createTag = useCallback(async (name) => {
    if (!isMyPage) return
    if (!docTagsReadyInScope) {
      alert('标签数据层还没准备好，稍后再试。')
      return
    }
    if (!name?.trim()) return
    try {
      const tag = await createDocTag(me.id, channel, name, docTagsInScope.length)
      const next = [...docTagsInScope, tag]
      rememberDocTags(me.id, channel, next)
      setDocTags(next)
      selectDocTag(tag.id)
    } catch (e) {
      throw new Error(friendlyDbError(e))
    }
  }, [channel, docTagsInScope, docTagsReadyInScope, isMyPage, me?.id, selectDocTag])

  const deleteTag = useCallback(
    async (tagId) => {
      if (!isMyPage || !tagId) return
      const tag = docTagsInScope.find((item) => item.id === tagId)
      if (!tag) return
      const ok = window.confirm(`删除标签「${tag.name}」后，里面的内容会回到未选标签，不会丢。`)
      if (!ok) return
      try {
        await archiveTag(tagId)
        forgetDocCacheForTags(me.id, channel, [null, tag.tagId])
        const next = docTagsInScope.filter((item) => item.id !== tagId)
        rememberDocTags(me.id, channel, next)
        setDocTags(next)
        selectDocTag(null)
        setDocRefreshNonce((n) => n + 1)
      } catch (e) {
        alert(friendlyDbError(e) || '删除标签失败')
      }
    },
    [channel, docTagsInScope, isMyPage, me?.id, selectDocTag],
  )

  const reorderTags = useCallback(
    async (activeId, overId) => {
      if (!isMyPage || !docTagsReadyInScope || activeId === overId) return
      const from = docTagsInScope.findIndex((item) => item.id === activeId)
      const to = docTagsInScope.findIndex((item) => item.id === overId)
      if (from < 0 || to < 0) return

      const scope = currentDocTagsScope
      const previous = docTagsInScope
      const next = arrayMove(previous, from, to).map((item, index) => ({ ...item, sort_order: index }))
      rememberDocTags(me.id, channel, next)
      setDocTags(next)

      try {
        await updateTagOrder(channel, next)
      } catch (e) {
        if (currentDocTagsScopeRef.current === scope) {
          rememberDocTags(me.id, channel, previous)
          setDocTags(previous)
        }
        throw new Error(friendlyDbError(e))
      }
    },
    [channel, currentDocTagsScope, docTagsInScope, docTagsReadyInScope, isMyPage, me?.id],
  )

  const renameTag = useCallback(
    async (tagId, name) => {
      if (!isMyPage || !tagId || !name?.trim()) return
      const tag = docTagsInScope.find((item) => item.id === tagId)
      if (!tag || tag.name === name.trim()) return
      try {
        const renamed = await renameDocTag(tagId, name)
        const next = docTagsInScope.map((item) => (item.id === tagId ? renamed : item))
        rememberDocTags(me.id, channel, next)
        setDocTags(next)
        selectDocTag(tagId)
      } catch (e) {
        throw new Error(friendlyDbError(e))
      }
    },
    [channel, docTagsInScope, isMyPage, me?.id, selectDocTag],
  )

  // Realtime 增量应用：别人的改动按行打补丁，不整表重拉（30 人规模的流量关键）
  // 自己有写操作在路上时不动本地（防旧事件盖新状态），靠落定后的对账兜底
  const applyEntryEvent = useCallback((payload) => {
    if (pendingOps.current > 0) return
    const { eventType, new: n, old: o } = payload
    setAllEntries((list) => {
      if (eventType === 'INSERT') return list.some((e) => e.id === n.id) ? list : [...list, n]
      if (eventType === 'UPDATE') return list.map((e) => (e.id === n.id ? n : e))
      if (eventType === 'DELETE') return list.filter((e) => e.id !== (o?.id ?? n?.id))
      return list
    })
  }, [])

  useEffect(() => {
    const ch = supabase
      .channel('nownow')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadProfiles)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadProfiles])

  // 切到某人页面 = 记录"看过的时间"，红点据此熄灭
  const viewPage = useCallback((pid) => {
    setView('paper')
    setPageUserId(pid)
    const next = { ...loadLastViewed(), [pid]: new Date().toISOString() }
    localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(next))
    setLastViewed(next)
  }, [])

  // @通知跳转入口（给 Inbox/通知页用）：点一条 → 切到那人那频道、滚到那篇文档块
  // block id = `doc-${section}-${periodKey}`（见 DocTimeline）
  const jumpToDoc = useCallback((owner, section, periodKey, tagId = null) => {
    requestedTagRef.current = { owner, section, tagId: tagId || null }
    viewPage(owner)
    setSelectedTagId(tagId || null)
    setChannel(section)
    setQuery('')
    // 定位到「@我」那个 mention 节点本身、滚过去并高亮它（而不是整块变蓝）。
    // doc 是异步渲染的，找不到就重试；先滚到块让用户看到移动，再精确到那个 @。
    let tries = 0
    const locate = () => {
      const block = document.getElementById(`doc-${section}-${periodKey}`)
      const mention = block?.querySelector(`.doc-mention[data-id="${user.id}"]`)
      if (mention) {
        mention.scrollIntoView({ block: 'center', behavior: 'smooth' })
        mention.classList.add('mention-flash')
        setTimeout(() => mention.classList.remove('mention-flash'), 2600)
        return
      }
      if (block && tries === 0) block.scrollIntoView({ block: 'start', behavior: 'smooth' })
      if (tries++ < 10) setTimeout(locate, 150)
    }
    setTimeout(locate, 160)
  }, [viewPage, user.id])

  // 谁最近写过东西 —— 红点的数据源。
  // 原来读的是 allEntries，而 entries 模型下线后它恒为空数组，
  // 所以这个红点已经**永远不会亮**了很久，界面上却看不出来。
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [recentActivity, setRecentActivity] = useState({})
  useEffect(() => {
    let alive = true
    loadRecentActivity().then((m) => alive && setRecentActivity(m)).catch(() => {})
    return () => { alive = false }
  }, [pageUserId, channel])

  // 网站图标跟着自己选的头像走 —— 海涛要的"网页里的 logo 也同步"。
  // index.html 里那个 <link rel="icon"> 初始指向默认头像，这里改的是同一个节点。
  useEffect(() => {
    const href = avatarSrc(me?.avatar)
    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = href
  }, [me?.avatar])

  const hasNews = useCallback(
    (p) => {
      if (!me || p.id === me.id || p.id === pageUserId) return false
      const seen = lastViewed[p.id] || '1970-01-01'
      const latest = recentActivity[p.id]
      return Boolean(latest && latest > seen)
    },
    [me, pageUserId, lastViewed, recentActivity],
  )

  const pageEntries = useMemo(
    () => allEntries.filter((e) => e.owner === pageUserId),
    [allEntries, pageUserId],
  )

  // 时间线：当前频道里「有内容的过去周期」offset 列表（降序 -1,-2,…）。当前周期(0)总是渲染。
  // 今日=按天回溯，本周=按周，本月=按月。stash 无时间线。
  const pastOffsets = useMemo(() => {
    if (channel === 'stash') return []
    const set = new Set()
    for (const e of pageEntries) {
      if (e.section !== channel || !e.anchor) continue
      const off = offsetOf(channel, e.anchor, baseDate)
      if (off != null && off < 0) set.add(off)
    }
    return [...set].sort((a, b) => b - a)
  }, [pageEntries, channel, baseDate])

  useEffect(() => {
    if (me) {
      document.title = `${me.display_name} | NowNow`
      // 记住名字给登录页打招呼用；已是成员就清掉邀请页暂存的名字，防止串号
      localStorage.setItem('nownow_last_name', me.display_name)
      localStorage.removeItem('nownow_pending_name')
    }
  }, [me])

  // 桌面端打开即可打字（手机不自动弹键盘）
  useEffect(() => {
    if (loaded && me && window.innerWidth >= 768) {
      document.getElementById('quick-capture')?.focus()
    }
  }, [loaded, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false) // 手机端左侧抽屉（flomo 式）
  const [mobileSearch, setMobileSearch] = useState(false) // 手机端搜索页模式
  const [view, setView] = useState('paper') // paper | notifications | all

  // 切视图时重拉；通知页里点掉/清空也回调这个，让红点数字当场变（不用跳页）。
  const refreshNotif = useCallback(() => {
    loadMyMentions().then(setDocMentions).catch(() => {})
    loadMyCompletions().then(setDocDone).catch(() => {})
    loadMentionFrequency().then(setMentionFreq).catch(() => {}) // @选框排序用，顺带刷（量小）
  }, [])
  useEffect(() => { refreshNotif() }, [view, refreshNotif])
  // 被 @ / 对方改动时实时刷通知（红点数字跟着变，不用手刷）。
  useEffect(() => {
    const ch = supabase
      .channel('nownow_doc_mentions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_mentions' }, refreshNotif)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [refreshNotif])

  // 侧栏（桌面）：宽度可拖拽 + 可折叠，存本地个人偏好。中间那条分隔线就是拖拽手柄。
  const asideRef = useRef(null)
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('nownow_sidebar_w'))
    return v >= 180 && v <= 360 ? v : 240
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nownow_sidebar_collapsed') === '1')
  const [resizingSidebar, setResizingSidebar] = useState(false)
  useEffect(() => { try { localStorage.setItem('nownow_sidebar_w', String(sidebarW)) } catch {} }, [sidebarW])
  useEffect(() => { try { localStorage.setItem('nownow_sidebar_collapsed', sidebarCollapsed ? '1' : '0') } catch {} }, [sidebarCollapsed])
  const startSidebarResize = useCallback((e) => {
    e.preventDefault()
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    setResizingSidebar(true)
    const onMove = (ev) => setSidebarW(Math.min(360, Math.max(180, Math.round(ev.clientX - left))))
    const onUp = () => {
      setResizingSidebar(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])
  useEffect(() => {
    // 去了别的页面就退出搜索模式并清空关键词（必须放在 view 声明之后：deps 数组在渲染时求值）
    setMobileSearch(false)
    setQuery('')
     
  }, [view, pageUserId])
  const searchBoxRef = useRef(null)
  useEffect(() => {
    // 搜索框：点它以外的任何地方立即收起并清空（用户拍板的交互）
    if (!mobileSearch) return
    const h = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setMobileSearch(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
     
  }, [mobileSearch])

  // 成员显示顺序：本人默认第一位，拖拽可调，存本地
  const [memberOrder, setMemberOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MEMBER_ORDER_KEY) || '[]') } catch { return [] }
  })
  const orderedProfiles = useMemo(() => {
    const rank = (p) => {
      const i = memberOrder.indexOf(p.id)
      if (i !== -1) return i
      return p.id === user.id ? -1 : memberOrder.length + activeProfiles.indexOf(p)
    }
    return [...activeProfiles].sort((a, b) => rank(a) - rank(b))
  }, [activeProfiles, memberOrder, user.id])
  // 团队成员列表 = 排除本人（本人入口走「我的目标」）；团队目标也用它，沿用同一排序
  const teamMembers = useMemo(() => orderedProfiles.filter((p) => p.id !== user.id), [orderedProfiles, user.id])

  // 置顶成员：个人偏好，存 localStorage，不进库、不影响别人。点 📌 切换某人是否置顶
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(PINNED_KEY) || '[]')) } catch { return new Set() }
  })
  const togglePin = useCallback((id) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem(PINNED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])
  const pinnedMembers = useMemo(() => teamMembers.filter((p) => pinnedIds.has(p.id)), [teamMembers, pinnedIds])
  const restMembers = useMemo(() => teamMembers.filter((p) => !pinnedIds.has(p.id)), [teamMembers, pinnedIds])
  const memberSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  function onMemberDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const ids = orderedProfiles.map((p) => p.id)
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id))
    setMemberOrder(next)
    localStorage.setItem(MEMBER_ORDER_KEY, JSON.stringify(next))
  }

  // 通知内容 = 待认领的@ + 我派出去已解决等我关闭的
  const resolvedMine = useMemo(
    () => (me ? allEntries.filter((e) => e.creator === me.id && e.status === 'resolved') : []),
    [me, allEntries],
  )
  // 「到期/过期提醒」已按 Haitao 移除——只保留 @谁就通知谁，不再据日期生成通知
  const pendingMembers = useMemo(
    () => profiles.filter((p) => p.status === 'pending' && myInviteTokens.includes(p.invited_with)),
    [profiles, myInviteTokens],
  )

  // 首页的 @ 窄条已按 Haitao 移除（2026-08-09），组件收进 archive/Inbox.jsx；
  // 通知的唯一入口是铃铛。旧 entries/mentions 那套的 inboxCount 恒为 0，一并清掉。
  // 红点数「还没让你知道的」：未读的 @ + 未点掉的黄色知会 + 待确认成员。
  // 读过没忽略的 @ 还留在通知页里，但不再吊着红数字 —— 通知的职责是让你知道，
  // 你知道了它就完成了使命。
  const unreadAt = docMentions.filter((m) => !m.read_at).length
  const notifCount = unreadAt + docDone.length + pendingMembers.length

  // 三格：今日未完成 / 本周未完成（今天还要干啥）+ 累计已完成（成就感，flomo 的"863 笔记"对应物）
  // 搜索跳转：纸拨回那条所在的日期 + 高亮闪烁定位
  const jumpToEntry = useCallback(
    (e) => {
      viewPage(e.owner)
      if (e.section) setChannel(e.section) // 切到目标所在频道，否则单频道视图下看不到
      if (e.anchor) {
        const t = new Date(); t.setHours(0, 0, 0, 0)
        const d = new Date(e.anchor + 'T00:00:00')
        setBaseDate(d.getTime() === t.getTime() ? null : d)
      }
      setFlashId(e.id)
      setTimeout(() => setFlashId(null), 2200)
    },
    [viewPage],
  )

  // 加载超过 8 秒还没好 = 网络/服务问题，给出口别让人对着骨架干等
  const [loadTimeout, setLoadTimeout] = useState(false)
  useEffect(() => {
    if (loaded) return
    const t = setTimeout(() => setLoadTimeout(true), 8000)
    return () => clearTimeout(t)
  }, [loaded])

  if (needSetup) return <SetupCard user={user} onDone={loadProfiles} />
  if (me && me.status === 'pending')
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <img src={avatarSrc(me?.avatar)} alt="" className="w-14 rounded-[9px]" />
        <p className="text-stone-700">你好 {me.display_name}，已收到你的加入申请</p>
        <p className="text-sm text-stone-400">等待邀请人确认后自动进入，这个页面不用刷新</p>
        <button onClick={() => supabase.auth.signOut()} className="mt-2 text-xs text-stone-300 hover:text-stone-500">
          退出登录
        </button>
      </div>
    )
  // 首屏骨架：别让用户对着白屏等两个网络往返
  if (!me || !loaded)
    return loadTimeout ? (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">加载有点慢，可能是网络问题</p>
        <button onClick={() => window.location.reload()} className="rounded-md bg-[var(--btn-bg)] px-4 py-2 text-sm text-[var(--btn-fg)]">
          刷新重试
        </button>
      </div>
    ) : (
      <div className="mx-auto flex h-screen max-w-[970px] animate-pulse">
        <div className="hidden w-52 shrink-0 px-4 py-6 md:block">
          <div className="h-5 w-24 rounded-md bg-stone-100" />
          <div className="mt-6 h-10 rounded-md bg-stone-100" />
          <div className="mt-6 space-y-2">
            <div className="h-6 rounded-md bg-stone-100" />
            <div className="h-6 rounded-md bg-stone-100" />
          </div>
        </div>
        <div className="flex-1 px-6 py-6">
          <div className="h-20 rounded-lg bg-stone-100" />
          <div className="mt-8 space-y-3">
            <div className="h-4 w-12 rounded-md bg-stone-100" />
            <div className="h-5 w-3/4 rounded-md bg-stone-100" />
            <div className="h-5 w-2/3 rounded-md bg-stone-100" />
            <div className="h-5 w-1/2 rounded-md bg-stone-100" />
          </div>
        </div>
      </div>
    )

  // 侧栏内容：桌面常驻左栏 + 手机左侧抽屉（flomo 式）共用一份
  const sidebarContent = (
    <>
        {/* 顶部：logo + 用户名（桌面）／日期（手机抽屉头） */}
        {/* gap 用 2.5（10px）而不是 2（8px）：名字是 17px，10px ≈ 0.6em ——
            图标与其文字标签之间的常用区间是 0.5–0.75em，8px 落在下沿所以显挤。
            相对头像（24px）也约是 0.4 倍，是紧凑并列里比较稳的一档。 */}
        <div className="mb-4 flex items-center gap-2.5 px-2.5 py-1.5 text-[17px] font-bold max-md:text-[21px]">
          {/* 头像即入口：点一下换头像。同一张图也是网站的 favicon（见下面的 effect）。 */}
          <span className="relative max-md:hidden">
            <button
              onClick={() => setAvatarOpen((v) => !v)}
              title="换个头像"
              aria-label="换个头像"
              className="block cursor-pointer rounded-md"
            >
              <img src={avatarSrc(me.avatar)} alt="" className="block h-6 w-6 rounded-[4px]" />
            </button>
            {avatarOpen && (
              <AvatarPicker
                current={me.avatar}
                onClose={() => setAvatarOpen(false)}
                onPick={async (id) => {
                  // 先本地生效（换头像应当是立刻的），落库失败再退回去。
                  const prev = me.avatar ?? null
                  setProfiles((xs) => xs.map((p) => (p.id === me.id ? { ...p, avatar: id } : p)))
                  const { error } = await supabase.from('profiles').update({ avatar: id }).eq('id', me.id)
                  if (error) {
                    // 静默回退等于"点了没反应" —— 用户无从判断是没点中还是存失败了。
                    setProfiles((xs) => xs.map((p) => (p.id === me.id ? { ...p, avatar: prev } : p)))
                    report('avatar', error)
                    alert('头像没保存上，稍后再试。')
                  }
                }}
              />
            )}
          </span>
          <span className="truncate max-md:hidden">{me.display_name}</span>
          <span className="truncate md:hidden">
            {(baseDate || new Date()).getMonth() + 1}月{(baseDate || new Date()).getDate()}日
          </span>
          {/* 桌面：折叠侧栏按钮（在用户名右侧） */}
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="ml-auto hidden shrink-0 rounded p-1 text-stone-400 hover:bg-[var(--nav-soft)] hover:text-stone-600 md:block"
            title="收起侧栏" aria-label="收起侧栏"
          >
            <PanelLeftClose size={18} />
          </button>
          {/* 手机：通知/设置收进右侧（flomo 式抽屉头），点击进对应整页 */}
          <span className="-mr-2.5 ml-auto flex items-center gap-0.5 md:hidden">
            <button onClick={() => setView('notifications')} className="relative p-1.5 text-stone-500" title="通知" aria-label="通知">
              <Bell size={22} />
              {notifCount > 0 && (
                <span className="absolute right-0.5 top-0.5 rounded-full bg-red-500 px-1 text-[10px] font-medium leading-[14px] text-white">{notifCount}</span>
              )}
            </button>
            <button onClick={() => setView('settings')} className="p-1.5 text-stone-500" title="设置" aria-label="设置">
              <Settings size={22} />
            </button>
          </span>
        </div>
        {/* 段1 · 看什么：我的目标 + 团队目标（待我处理/我派出去的 已按 Haitao 移除） */}
        <button
          onClick={() => viewPage(me.id)}
          className={
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] max-md:py-2 ' +
            (view === 'paper' && isMyPage ? 'bg-[var(--nav-soft)] font-medium text-stone-900' : 'text-stone-600 hover:bg-[var(--nav-soft)]')
          }
        >
          <CircleCheck size={16} /> 我的目标
        </button>

        {/* 段2 · 置顶成员 + 团队成员（都不含本人；📌 切换置顶，存本地个人偏好）。置顶成员上方不再画分隔线 */}
        <div className="mt-3" />
        {/* 成员多到放不下时这一段自己滚动（细灰滚动条），通知/设置钉在底部不动 */}
        <div className="paper-scroll min-h-0 flex-1 overflow-y-auto">
          <DndContext sensors={memberSensors} collisionDetection={closestCenter} onDragEnd={onMemberDragEnd}>
            {pinnedMembers.length > 0 && (
              <>
                <div className="mb-1 px-2.5 text-[12px] font-normal uppercase tracking-wide text-stone-400">
                  置顶成员
                </div>
                <SortableContext items={pinnedMembers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  {pinnedMembers.map((p) => (
                    <SortableMemberRow
                      key={p.id}
                      p={p}
                      isMe={p.id === me.id}
                      active={p.id === pageUserId && view === 'paper'}
                      news={hasNews(p)}
                      pinned
                      onClick={() => viewPage(p.id)}
                      onTogglePin={togglePin}
                    />
                  ))}
                </SortableContext>
                <div className="mt-3" />
              </>
            )}
            <div className="mb-1 px-2.5 text-[12px] font-normal uppercase tracking-wide text-stone-400">
              团队成员
            </div>
            <SortableContext items={restMembers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {restMembers.map((p) => (
                <SortableMemberRow
                  key={p.id}
                  p={p}
                  isMe={p.id === me.id}
                  active={p.id === pageUserId && view === 'paper'}
                  news={hasNews(p)}
                  pinned={false}
                  onClick={() => viewPage(p.id)}
                  onTogglePin={togglePin}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        {/* 底部：通知（完整页面）+ 设置（桌面；手机入口在抽屉头名字右侧） */}
        <div className="mt-auto max-md:hidden">
          <button
            onClick={() => setView(view === 'notifications' ? 'paper' : 'notifications')}
            className={
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-[var(--nav-soft)] ' +
              (view === 'notifications' ? 'bg-[var(--nav-soft)] font-medium text-stone-900' : 'text-stone-500')
            }
          >
            <Bell size={16} /> 通知
            {notifCount > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-medium text-white">
                {notifCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] text-stone-500 hover:bg-[var(--nav-soft)]"
          >
            <Settings size={16} /> 设置
          </button>
        </div>
    </>
  )

  return (
    // 桌面：app 不画左右外边框（按 Haitao 去掉两边的线）；侧栏右边框仍做内部分界
    <div className="mx-auto flex h-dvh max-w-[970px] overflow-hidden">
      {/* 左栏：人员列表（固定不随内容滚动）。宽度可拖拽、可折叠（桌面） */}
      <aside
        ref={asideRef}
        style={{ width: sidebarCollapsed ? 44 : sidebarW }}
        className={
          // min-w-0：flex item 默认 min-width:auto 会把 width 顶到内容最小宽，必须清掉
          'hidden h-full min-w-0 shrink-0 flex-col overflow-hidden pb-5 pt-3 md:flex ' +
          (sidebarCollapsed ? 'items-center px-0 ' : 'px-2 ') +
          (resizingSidebar ? '' : 'transition-[width] duration-200')
        }
      >
        {sidebarCollapsed ? (
          // 折叠 = 一条 44px 窄轨（隐藏条），展开 icon 顶在最上最左，点它复原
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="mt-1.5 rounded p-1.5 text-stone-400 hover:bg-[var(--nav-soft)] hover:text-stone-600"
            title="展开侧栏" aria-label="展开侧栏"
          >
            <PanelLeftOpen size={18} />
          </button>
        ) : (
          sidebarContent
        )}
      </aside>
      {/* 中间那条分隔线 = 拖拽手柄：拖动改侧栏宽度（折叠时收起）。1px 实线 + 左右各 4px 透明热区 */}
      {!sidebarCollapsed && (
        <div
          onMouseDown={startSidebarResize}
          className="relative hidden w-px shrink-0 cursor-col-resize bg-stone-100 md:block"
          title="拖动调整侧栏宽度" aria-label="拖动调整侧栏宽度"
        >
          {/* 透明热区（左右各 4px）只为好抓住那条 1px 线，悬停不再显示灰条——Haitao：选中条太粗 */}
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* 手机端：flomo 式左侧抽屉，滑入滑出带过渡（常驻挂载，开关只切 transform/opacity） */}
      <div className={'fixed inset-0 z-50 md:hidden ' + (drawerOpen ? '' : 'pointer-events-none')}>
        <div
          className={'absolute inset-0 bg-black/30 transition-opacity duration-200 ' + (drawerOpen ? 'opacity-100' : 'opacity-0')}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={
            'absolute inset-y-0 left-0 flex w-60 flex-col overflow-hidden bg-[#fffefb] px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.375rem,env(safe-area-inset-top))] shadow-2xl transition-transform duration-200 ease-out ' +
            (drawerOpen ? 'translate-x-0' : '-translate-x-full')
          }
          onClick={() => setDrawerOpen(false)}
        >
          {sidebarContent}
        </div>
      </div>

      {/* 主区：输入框固定，纸内部滚动 */}
      <main className="flex h-full min-w-0 flex-1 flex-col">
        {/* 移动端顶栏（flomo 式）：☰ 抽屉 + 中间日期锚 + 搜索页入口；搜索模式下整条变搜索框 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-100 px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] md:hidden">
          {mobileSearch ? (
            <span ref={searchBoxRef} className="min-w-0 flex-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索内容或人名"
                className="w-full rounded-lg bg-stone-100 px-4 py-2 text-[17px] outline-none placeholder:text-stone-400"
              />
            </span>
          ) : (
            <>
              <button onClick={() => setDrawerOpen(true)} className="relative p-1.5 text-stone-600" title="菜单" aria-label="菜单">
                <Menu size={20} />
                {notifCount > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" />}
              </button>
              <button
                onClick={() => viewPage(me.id)}
                className={'min-w-0 flex-1 truncate text-center text-[17.5px] font-semibold ' + (view === 'paper' && !isMyPage ? 'text-stone-400' : '')}
              >
                {view === 'notifications'
                  ? '通知'
                  : view === 'settings'
                    ? '设置'
                    : pageUser.display_name}
              </button>
              <button onClick={() => setMobileSearch(true)} className="p-1.5 text-stone-400">
                <Search size={20} />
              </button>
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col pl-5 pr-3 md:px-6">
        <div className="shrink-0 pb-2 pt-2 max-md:pb-1.5 max-md:pt-1">
          {/* 顶部 今日/本周/本月/收集箱 = 切换视图（一次看一个，高亮当前）。每个频道在下方渲染成往下回溯的时间线。右侧=搜索（桌面） */}
          {view === 'paper' && (
          <>
            <div className="flex items-center gap-1.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => goChannel(s.key)}
                  className={
                    'flex h-7 items-center rounded-full px-3 text-[14px] leading-none transition-colors ' +
                    (channel === s.key
                      ? 'bg-[var(--nav-soft)] text-stone-900'
                      : 'text-stone-500 hover:bg-[var(--nav-soft)] hover:text-stone-900')
                  }
                >
                  {s.label}
                </button>
              ))}
              <span className="relative ml-auto hidden items-center md:flex">
                <Search size={16} strokeWidth={2.5} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  id="search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('')
                      e.target.blur()
                    }
                  }}
                  className="h-8 w-[230px] rounded-md bg-stone-200/80 pl-9 pr-2 text-[14px] outline-none focus:bg-stone-200"
                />
                {!query && (
                  <kbd className="pointer-events-none absolute left-9 top-1/2 flex -translate-y-1/2 items-center font-medium text-stone-400">
                    {/* ⌘ 字形天生比字母小（字体度量问题），单独放大让它和 K 视觉等大 */}
                    <span className="text-[20px] leading-none">⌘</span>
                    <span className="text-[15px]">+K</span>
                  </kbd>
                )}
              </span>
            </div>
            <DocTagBar
              tags={docTagsInScope}
              selectedId={selectedTagIdInScope}
              editable={isMyPage}
              ready={docTagsReadyInScope}
              onSelect={selectDocTag}
              onCreate={createTag}
              onRename={renameTag}
              onDelete={deleteTag}
              onReorder={reorderTags}
            />
          </>
          )}
          {/* 看别人主页时不再显示「X的主页（只读）/回到我的主页」横条——那块留给时间戳，和自己主页一样（回到自己页走侧栏点自己名字）*/}
          {/* 独立输入框已删除 → 改为纸即输入：频道底部常驻幽灵行（见 Section） */}
          {(offline || syncSlow) && (
            <div className="mt-2 rounded-md bg-stone-100 px-3 py-2 text-center text-[13px] text-stone-500">
              {offline ? '离线状态，内容已暂存本页，恢复网络后自动保存，' : '正在同步，网络有点慢，'}
              <button
                onClick={() => { replayFailed(); loadData() }}
                className="text-blue-600 hover:underline"
              >
                点此重试
              </button>
            </div>
          )}
        </div>
        {/* -ml-6 pl-6：把左侧 24px（拖把手的悬浮区）包进容器内，配合 overflow-x-hidden 不被裁掉 */}
        <div ref={scrollRef} className="paper-scroll -ml-6 flex-1 overflow-y-auto overflow-x-hidden pb-2 pl-6 pr-3">
          {/* 所有视图统一收进 720px 主列（--doc-width）：通知/设置/正文同一阅读宽，
             左对齐和上方 tab/日期头同边界，折叠侧栏时跟着撑到左边 */}
          <div className="w-full max-w-[var(--doc-width)]">
            {view === 'settings' ? (
              <SettingsModal
                variant="page"
                me={me}
                email={user.email}
                allEntries={allEntries}
                profiles={profiles}
                onProfileSaved={loadProfiles}
              />
            ) : view === 'notifications' ? (
              <NotificationsPage
                me={me}
                pendingMembers={pendingMembers}
                profiles={profiles}
                onMembersChanged={loadProfiles}
                onJumpDoc={jumpToDoc}
                onChanged={refreshNotif}
              />
            ) : (
              <>
                {query.trim() ? (
                  <DocSearch
                    query={query}
                    profiles={profiles}
                    onJump={(h) => {
                      requestedTagRef.current = { owner: h.owner, section: h.section, tagId: h.tag_id || null }
                      viewPage(h.owner)
                      setSelectedTagId(h.tag_id || null)
                      setChannel(h.section)
                      setOffsets((o) => ({ ...o, [h.section]: 0 }))
                      setQuery('')
                    }}
                  />
                ) : (
                  <DocTimeline
                    key={`${pageUserId}-${channel}`}
                    owner={pageUserId}
                    section={channel}
                    tagId={selectedDocTagId}
                    isMyPage={isMyPage}
                    baseDate={baseDate}
                    viewportH={viewportH}
                    profiles={profiles}
                    mentionFreq={mentionFreq}
                    flashKey={flashDoc && flashDoc.section === channel ? flashDoc.periodKey : null}
                    refreshNonce={docRefreshNonce}
                  />
                )}
              </>
            )}
          </div>
        </div>
        </div>

      </main>
      {/* 手机端创建改为：点频道底部幽灵行就地开写（纸即输入），不再有浮动 ➕ 和底部记录抽屉 */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          me={me}
          email={user.email}
          allEntries={allEntries}
          profiles={profiles}
          onProfileSaved={loadProfiles}
        />
      )}
    </div>
  )
}
