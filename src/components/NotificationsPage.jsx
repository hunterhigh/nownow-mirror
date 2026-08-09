import { useEffect, useState } from 'react'
import { AtSign, Bell, CheckCircle2, CheckSquare, Square, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadMyMentions, markMentionRead, completeMention, loadMyCompletions, ackCompletion, dismissMention } from '../lib/docMentionsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 模块级缓存：再次进通知页时先用上次的数据秒显（不再空白等网络），后台再刷新。
// 直接回答海涛「为什么每次都拉」：现在进页面先显缓存、感知是即时的，拉取在后台静默更新。
// 按账号隔离（cachedUserId）：缓存只在属于当前登录账号时才拿来 seed——同浏览器换号登录不串上个账号的通知。
let cachedUserId = null
let cachedMentions = []
let cachedCompletions = []

// docs 世界的通知中心：① @我的（别人在文档里 @ 我 = 派活）→ 勾选完成 ② 我派的活被完成（黄色）③ 待确认成员。
export default function NotificationsPage({ me, pendingMembers = [], profiles, onMembersChanged, onJumpDoc, onChanged }) {
  const mine = cachedUserId === me?.id // 缓存归当前账号才用，换号则从空开始（防串号）
  const [mentions, setMentions] = useState(mine ? cachedMentions : []) // 别人 @ 我的（未完成）
  const [completions, setCompletions] = useState(mine ? cachedCompletions : []) // 我派的活、对方完成了（黄色）
  const [operationError, setOperationError] = useState('')

  useEffect(() => {
    let alive = true
    loadMyMentions().then((r) => { cachedMentions = r; cachedUserId = me?.id; if (alive) setMentions(r) }).catch(() => {})
    loadMyCompletions().then((r) => { cachedCompletions = r; cachedUserId = me?.id; if (alive) setCompletions(r) }).catch(() => {})
    return () => { alive = false }
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

  // 勾选完成：被@人标记完成 → 原地划横线（不消失，像待办勾掉），派活人那边冒黄色「已完成」。
  // 已完成的下次刷新会被 loadMyMentions 自动清掉，不长期堆积。
  async function complete(m) {
    if (m.completed_at) return
    setOperationError('')
    try {
      await completeMention(m.id)
      setMentions((xs) => xs.map((x) => (x.id === m.id ? { ...x, completed_at: new Date().toISOString() } : x)))
    } catch {
      setOperationError('标记完成失败，请重试。')
      return
    }
    onChanged?.() // 落库后刷新侧栏未完成计数（本地划横线不动，靠这个让红点数字当场减）
  }

  // 点掉黄色完成通知
  async function dismiss(c) {
    setOperationError('')
    try {
      await ackCompletion(c.id)
      setCompletions((xs) => xs.filter((x) => x.id !== c.id))
    } catch {
      setOperationError('关闭通知失败，请重试。')
      return
    }
    onChanged?.()
  }

  // 一键清空。
  //
  // 刻意**不**碰两类东西，因为它们不是"通知"而是"待办"：
  // · @我的：那是别人派给我的活。你自己定的规则是「读没读都算，做完才消」
  //   （见 Board.jsx 的 pendingAt）。一键把它们标成完成，等于替你告诉派活的人
  //   "我做完了" —— 那是撒谎，而且对方无从察觉。这里只标已读。
  // · 待确认成员：通过/拒绝是一个真实决定，不能被"清空"顺手做掉。
  //
  // 真正能被清掉的是黄色的"已完成"通知：它们纯粹是知会，点掉就是"我看到了"。
  const [clearing, setClearing] = useState(false)
  const clearable = completions.length + mentions.length

  async function clearAll() {
    if (clearing || clearable === 0) return
    // 「Clear」会把别人派给我的活一次性全部忽略，而且**对方收不到任何提示**、
    // 界面上也没有找回入口。批量 + 不可逆 + 影响到别人对我的预期 —— 这三样凑齐，
    // 就值得先问一句。只在真的会忽略派活时才问；纯粹点掉黄色通知不打扰。
    const assigned = mentions.length
    if (assigned > 0) {
      const ok = window.confirm(
        `忽略 ${assigned} 条别人派给你的活？\n\n它们会从这里消失，但不代表完成 —— 派活的人不会收到任何通知。`,
      )
      if (!ok) return
    }
    setClearing(true)
    setOperationError('')
    try {
      await Promise.all([
        // 黄色"已完成"：纯知会，点掉即可
        ...completions.map((c) => ackCompletion(c.id)),
        // @我的：用"忽略"而不是"标记完成"——从我的列表里移走，
        // 但绝不替我告诉派活的人"我做完了"。活本身还在，只是不再占用我的通知。
        ...mentions.map((m) => dismissMention(m.id)),
      ])
      setCompletions([])
      setMentions([])
      cachedCompletions = []
      cachedMentions = []
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
          disabled={clearing || clearable === 0}
          title="清空通知"
          aria-label="清空通知"
          // 和顶部「今日/本周/本月/收集箱」「main/产品灵感…」是同一套：
          // h-7 + rounded-full + px-3 + 14px，默认灰字、hover 才出灰底。
          // 直接复用同一组类名，而不是另写一套近似的 —— 否则设计一改就会两处不一致。
          className={
            'ml-auto flex h-7 items-center rounded-full px-3 text-[14px] font-normal leading-none transition-colors ' +
            (clearing || clearable === 0
              ? 'text-stone-300'
              : 'text-stone-500 hover:bg-[var(--nav-soft)] hover:text-stone-900')
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

      {/* @我的 = 别人派给我的活，勾选方框 = 完成 */}
      {mentions.length > 0 && (
        <div className="mt-5 rounded-lg px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
          <div className="mb-1.5 flex items-center gap-1 text-xs font-bold max-md:text-[13px]" style={{ color: 'var(--accent)' }}>
            <AtSign size={13} /> 我的 · {mentions.length}
          </div>
          {mentions.map((m) => {
            const from = profiles?.find((p) => p.id === m.author)
            const ctx = m.section === 'stash' ? '收集箱' : periodHeaderFromKey(m.section, m.periodKey)
            const done = !!m.completed_at
            const dim = done || m.read_at
            const who = from?.display_name || '有人'
            return (
              <div key={m.id} className="flex items-start gap-2 py-1 text-[13.5px] max-md:py-1.5 max-md:text-[15.5px]">
                <button
                  onClick={() => complete(m)}
                  title={done ? '已完成' : '标记完成'}
                  className={'mt-0.5 shrink-0 transition-colors ' + (done ? 'text-[var(--accent)]' : 'text-stone-400 hover:text-[var(--accent)]')}
                >
                  {done ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
                <button
                  onClick={() => openMention(m)}
                  className="block min-w-0 flex-1 text-left hover:opacity-80"
                  style={{ textDecoration: done ? 'line-through' : 'none' }}
                >
                  {m.snippet ? (
                    <>
                      <div className="truncate" style={{ color: 'var(--ink)' }}>{m.snippet}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        <span className="min-w-0 flex-1 truncate"><b style={{ color: 'var(--ink-muted)' }}>{who}</b> @了你 · {ctx}</span>
                        <span className="shrink-0" style={{ color: done ? 'var(--ink-faint)' : 'var(--accent)' }}>去看看</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2" style={{ color: dim ? 'var(--ink-faint)' : 'var(--ink-muted)' }}>
                      <span className="min-w-0 flex-1 truncate"><b style={{ color: dim ? 'var(--ink-faint)' : 'var(--ink)' }}>{who}</b> 在「{SECTION_LABELS[m.section]}」@了你</span>
                      <span className="shrink-0 text-[11.5px]" style={{ color: done ? 'var(--ink-faint)' : m.read_at ? 'var(--ink-faint)' : 'var(--accent)' }}>{ctx} · 去看看</span>
                    </div>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 黄色：我派的活被对方完成了 */}
      {completions.length > 0 && (
        <div className="mt-3 rounded-lg px-4 py-3" style={{ background: 'color-mix(in srgb, var(--warning) 16%, var(--surface-elevated))' }}>
          <div className="mb-1.5 flex items-center gap-1 text-xs font-bold max-md:text-[13px]" style={{ color: 'var(--warning)' }}>
            <CheckCircle2 size={13} /> 已完成 · {completions.length}
          </div>
          {/* snippet + who 完成了 · 日期；完成的不用跳，只留 × 点掉。 */}
          {completions.map((c) => {
            const who = profiles?.find((p) => p.id === c.mentioned)?.display_name || '有人'
            const ctx = c.section === 'stash' ? '收集箱' : periodHeaderFromKey(c.section, c.periodKey)
            return (
              <div key={c.id} className="flex items-start gap-2 py-1 text-[13.5px] max-md:py-1.5 max-md:text-[15.5px]">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ color: 'var(--ink)' }}>{c.snippet || '（无内容）'}</div>
                  <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                    <b style={{ color: 'var(--ink-muted)' }}>{who}</b> 完成了你派的 · {ctx}
                  </div>
                </div>
                <button onClick={() => dismiss(c)} title="知道了" aria-label="知道了" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
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
