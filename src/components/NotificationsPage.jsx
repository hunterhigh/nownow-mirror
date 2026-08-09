import { useEffect, useState } from 'react'
import { AtSign, Bell, CheckCircle2, Square, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadMyMentions, markMentionRead, dismissMention, completeMention, loadMyCompletions, ackCompletion } from '../lib/docMentionsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 模块级缓存：再次进通知页时先用上次的数据秒显（不再空白等网络），后台再刷新。
// 按账号隔离（cachedUserId）：缓存只在属于当前登录账号时才拿来 seed——同浏览器换号登录不串上个账号的通知。
let cachedUserId = null
let cachedMentions = []
let cachedCompletions = []

// 通知中心 —— **一切都是通知**（海涛 2026-08-09 拍板）：
// ① @我的：别人在文档里 @ 了我。✕ = 忽略（对方无感）、✓ = 处理好了（给对方发条黄色知会）。
//    两个动作做完条目都一样消失 —— 列表里**没有**"完成/未完成"的状态展示。
// ② 黄色知会：别人 ✓ 了我 @ 的事。就是普通通知，✕ 点掉即完。
// ③ 待确认成员：这不是通知，是要你做的决定（通过/拒绝），所以 Clear 永远不碰它。
export default function NotificationsPage({ me, pendingMembers = [], profiles, onMembersChanged, onJumpDoc, onChanged }) {
  const mine = cachedUserId === me?.id // 缓存归当前账号才用，换号则从空开始（防串号）
  const [mentions, setMentions] = useState(mine ? cachedMentions : [])
  const [completions, setCompletions] = useState(mine ? cachedCompletions : [])
  const [operationError, setOperationError] = useState('')

  useEffect(() => {
    let alive = true
    const refresh = () => {
      loadMyMentions().then((r) => { cachedMentions = r; cachedUserId = me?.id; if (alive) setMentions(r) }).catch(() => {})
      loadMyCompletions().then((r) => { cachedCompletions = r; cachedUserId = me?.id; if (alive) setCompletions(r) }).catch(() => {})
    }
    refresh()
    // 页面开着时也实时刷新 —— 修掉「红点说 3、页面显示 2」的错位（以前只有侧栏红点订阅了 realtime）
    const ch = supabase
      .channel('doc_mentions_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_mentions' }, refresh)
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [me?.id])

  async function approve(p, ok) {
    setOperationError('')
    const { error } = await supabase.rpc(ok ? 'approve_member' : 'reject_member', { p_id: p.id })
    if (error) {
      setOperationError(ok ? '成员通过失败，请重试。' : '成员拒绝失败，请重试。')
      return
    }
    onMembersChanged?.()
  }

  function openMention(m) {
    if (!m.read_at) markMentionRead(m.id).catch(() => {})
    setMentions((xs) => xs.map((x) => (x.id === m.id ? { ...x, read_at: x.read_at || new Date().toISOString() } : x)))
    onJumpDoc?.(m.owner, m.section, m.periodKey, m.tagId)
  }

  // 三个动作都是**乐观更新**：先让条目当场消失，网络请求在后面追。
  // 之前是等服务器返回才删 —— 国内走 /sb 代理一个往返几百毫秒，
  // 点完像没反应（海涛："得等一会内容才会消失"）。失败的话把条目放回来并提示，
  // 最坏情况是"闪了一下又回来了"，不会丢。
  function removeOptimistic(item, kind, rpc, errMsg) {
    setOperationError('')
    const isMention = kind === 'mention'
    const prev = isMention ? mentions : completions
    const setList = isMention ? setMentions : setCompletions
    setList((xs) => xs.filter((x) => x.id !== item.id))
    if (isMention) cachedMentions = cachedMentions.filter((x) => x.id !== item.id)
    else cachedCompletions = cachedCompletions.filter((x) => x.id !== item.id)
    rpc(item.id)
      .then(() => onChanged?.())
      .catch(() => {
        setList(prev)
        if (isMention) cachedMentions = prev
        else cachedCompletions = prev
        setOperationError(errMsg)
      })
  }

  // ✕ 一条：忽略。对方什么也收不到。
  const dismiss = (m) => removeOptimistic(m, 'mention', dismissMention, '删除通知失败，请重试。')
  // ☐ 完成：和 ✕ 一样从列表消失，唯一区别是对方会收到一条黄色知会。
  const complete = (m) => removeOptimistic(m, 'mention', completeMention, '操作失败，请重试。')
  // 点掉一条黄色知会
  const ackDone = (c) => removeOptimistic(c, 'completion', ackCompletion, '关闭通知失败，请重试。')

  // 一键清空 = 忽略所有 @ + 点掉所有黄色知会。
  // 不需要确认：Clear 走的是 ✕ 的语义（忽略，不发任何知会），清通知就像清邮箱。
  // 唯一不碰的是「待确认成员」—— 那不是通知，是等你做的决定。
  const [clearing, setClearing] = useState(false)
  const clearable = mentions.length + completions.length

  async function clearAll() {
    if (clearing || clearable === 0) return
    setClearing(true)
    setOperationError('')
    try {
      await Promise.all([
        ...mentions.map((m) => dismissMention(m.id)),
        ...completions.map((c) => ackCompletion(c.id)),
      ])
      setMentions([])
      setCompletions([])
      cachedMentions = []
      cachedCompletions = []
      onChanged?.()
    } catch {
      setOperationError('清空失败，请重试。')
    } finally {
      setClearing(false)
    }
  }

  const empty = mentions.length === 0 && pendingMembers.length === 0 && completions.length === 0

  return (
    <div className="pt-1">
      <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold max-md:text-[17px]">
        <Bell size={16} /> 通知
        <button
          onClick={clearAll}
          disabled={clearing}
          title="清空通知"
          aria-label="清空通知"
          // 和顶部「今日/本周/本月/收集箱」「main/产品灵感…」是同一套尺寸：
          // h-7 + rounded-full + px-3 + 14px。直接复用同一组类名，而不是另写一套近似的
          // —— 否则设计一改就会两处不一致。
          //
          // 外观是**恒定**的（海涛的决定）：灰底一直在，不随 hover 出现、也不随
          // 「有没有东西可清」变灰。代价是没东西可清时点了没反应 —— clearAll 里
          // 有 clearable === 0 直接 return，所以这是个安全的空操作，不会误清。
          className={
            'ml-auto flex h-7 items-center rounded-full bg-[var(--nav-soft)] px-3 text-[14px] font-normal leading-none text-stone-500 transition-colors hover:text-stone-900 ' +
            (clearing ? 'opacity-60' : '')
          }
        >
          {clearing ? '清空中…' : 'Clear'}
        </button>
      </div>

      {operationError && <p className="mb-3 text-sm text-red-600">{operationError}</p>}

      {empty && (
        <p className="mt-6 text-sm text-stone-300 max-md:text-[15px]">
          没有新通知。别人 @ 你派活、对方完成、申请加入的成员，都会出现在这里。
        </p>
      )}

      {pendingMembers.length > 0 && (
        <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-emerald-700 max-md:text-[13px]">
            <UserPlus size={13} /> 待确认成员 · {pendingMembers.length}
          </div>
          {pendingMembers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1 text-[13.5px] max-md:py-1.5 max-md:text-[15.5px] text-emerald-900">
              <span className="min-w-0 flex-1"><b>{p.display_name}</b> 通过你的邀请链接申请加入</span>
              <button onClick={() => approve(p, true)} className="shrink-0 rounded-md border border-emerald-600 bg-white px-2.5 py-0.5 text-xs text-emerald-700 max-md:py-1 max-md:text-[13px] hover:bg-emerald-600 hover:text-white">通过</button>
              <button onClick={() => approve(p, false)} className="shrink-0 rounded-md px-2 py-0.5 text-xs text-stone-400 hover:text-red-600">拒绝</button>
            </div>
          ))}
        </div>
      )}

      {/* @我的：纯通知。点条目跳过去（顺带标已读），✕ 忽略。未读蓝、已读灰。 */}
      {mentions.length > 0 && (
        <div className="mt-5 rounded-lg px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
          <div className="mb-1.5 flex items-center gap-1 text-xs font-bold max-md:text-[13px]" style={{ color: 'var(--accent)' }}>
            <AtSign size={15} /> 我的 · {mentions.length}
          </div>
          {mentions.map((m) => {
            const from = profiles?.find((p) => p.id === m.author)
            const ctx = m.section === 'stash' ? '收集箱' : periodHeaderFromKey(m.section, m.periodKey)
            const dim = !!m.read_at
            const who = from?.display_name || '有人'
            return (
              <div key={m.id} className="flex items-start gap-2 py-1 text-[13.5px] max-md:py-1.5 max-md:text-[15.5px]">
                {/* 待办式方框：点一下 = 完成，条目消失、对方收到黄色知会。
                    没有"勾上停留"的状态 —— 点即走，和 ✕ 一样，只是多发一条通知。 */}
                <button
                  onClick={() => complete(m)}
                  title="完成（对方会收到通知）"
                  aria-label="完成（对方会收到通知）"
                  className="mt-0.5 shrink-0 text-stone-400 transition-colors hover:text-[var(--accent)]"
                >
                  <Square size={16} />
                </button>
                <button
                  onClick={() => openMention(m)}
                  className="block min-w-0 flex-1 text-left hover:opacity-80"
                >
                  {m.snippet ? (
                    <>
                      <div className="truncate" style={{ color: dim ? 'var(--ink-muted)' : 'var(--ink)' }}>{m.snippet}</div>
                      {/* 区头已说明这是 @；每条只留 谁 · 什么时候，不再重复"@了你" */}
                      <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        <b style={{ color: 'var(--ink-muted)' }}>{who}</b> · {ctx}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2" style={{ color: dim ? 'var(--ink-faint)' : 'var(--ink-muted)' }}>
                      <span className="min-w-0 flex-1 truncate"><b style={{ color: dim ? 'var(--ink-faint)' : 'var(--ink)' }}>{who}</b> 在「{SECTION_LABELS[m.section]}」@了你</span>
                      <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{ctx}</span>
                    </div>
                  )}
                </button>
                <button onClick={() => dismiss(m)} title="忽略（TA 不会收到任何提示）" aria-label="忽略这条通知" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 黄色知会：别人 ✓ 了我 @ 的事。普通通知，✕ 即完，没有任何状态。 */}
      {completions.length > 0 && (
        <div className="mt-3 rounded-lg px-4 py-3" style={{ background: 'color-mix(in srgb, var(--warning) 16%, var(--surface-elevated))' }}>
          <div className="mb-1.5 flex items-center gap-1 text-xs font-bold max-md:text-[13px]" style={{ color: 'var(--warning)' }}>
            <CheckCircle2 size={15} /> 已完成 · {completions.length}
          </div>
          {completions.map((c) => {
            const who = profiles?.find((p) => p.id === c.mentioned)?.display_name || '有人'
            const ctx = c.section === 'stash' ? '收集箱' : periodHeaderFromKey(c.section, c.periodKey)
            // pl-6 = 蓝区方框(16px)+间距(8px)：两个区的文本列左缘对齐，扫起来是一条线
            return (
              <div key={c.id} className="flex items-start gap-2 py-1 pl-6 text-[13.5px] max-md:py-1.5 max-md:text-[15.5px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ color: 'var(--ink)' }}>{c.snippet || '（无内容）'}</div>
                  {/* 区头已说明这是"已完成"；每条只留 谁 · 什么时候 */}
                  <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                    <b style={{ color: 'var(--ink-muted)' }}>{who}</b> · {ctx}
                  </div>
                </div>
                <button onClick={() => ackDone(c)} title="知道了" aria-label="知道了" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
