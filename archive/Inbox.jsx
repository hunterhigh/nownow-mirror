import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Inbox as InboxIcon, Square, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ackCompletion, completeMention, dismissMention as dismissMentionRpc, loadMyCompletions, loadMyMentions } from '../lib/docMentionsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 模块级缓存：切回自己页时先用上次的列表**瞬间按最终高度渲染**，不再「空→异步拉回→撑出来」抖一下。
// 按账号隔离（cachedUserId），换号登录不串上个账号的通知。后台仍会刷新成最新。
let cachedItems = []
let cachedDone = []
let cachedUserId = null

// 首页（我的目标）顶部的通知窄条。和通知页同一套模型、同一套动作：
//   @我的：☐ 完成（对方收到黄色知会）· 点内容跳过去 · ✕ 忽略（对方无感）
//   已完成：别人 ✓ 了我 @ 的事，✕ 点掉即完
// 只列**未读**的 @（读过的去通知页看），且只列属于**当前正在看的周期**的
// （scope 过滤 —— 这个窄条是"这一页的相关通知"，不是完整收件箱）。
export default function Inbox({ me, profiles, onJumpDoc, scope = null }) {
  const [items, setItems] = useState(() => (cachedUserId === me?.id ? cachedItems : []))
  const [done, setDone] = useState(() => (cachedUserId === me?.id ? cachedDone : []))
  const [mentionsCollapsed, setMentionsCollapsed] = useState(true)
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const scopeKey = scope ? `${scope.section}:${scope.periodKey}` : 'all'
  const toggleMentions = () => setMentionsCollapsed((v) => !v)
  const toggleDone = () => setDoneCollapsed((v) => !v)

  useEffect(() => {
    let alive = true
    const refresh = () => {
      loadMyMentions()
        .then((rows) => {
          const active = rows.filter((r) => !r.read_at)
          cachedItems = active
          cachedUserId = me?.id
          if (alive) setItems(active)
        })
        .catch(() => {})
      loadMyCompletions()
        .then((rows) => {
          cachedDone = rows
          cachedUserId = me?.id
          if (alive) setDone(rows)
        })
        .catch(() => {})
    }
    refresh()
    // 被 @ / 对方 ✓ 时实时亮（doc_mentions 已加进 realtime publication）
    const ch = supabase
      .channel('doc_mentions_inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_mentions' }, refresh)
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [])

  useEffect(() => {
    setMentionsCollapsed(true)
    setDoneCollapsed(true)
  }, [scopeKey])

  const inScope = (item) => (
    !scope ||
    (item.section === scope.section && item.periodKey === scope.periodKey)
  )
  const visibleItems = items.filter(inScope)
  const visibleDone = done.filter(inScope)

  if (visibleItems.length === 0 && visibleDone.length === 0) return null

  function open(m) {
    onJumpDoc?.(m.owner, m.section, m.periodKey, m.tagId)
  }

  // 乐观更新：先消失、请求在后面追，失败弹提示（和通知页同手感）。
  function removeOptimistic(item, isMention, rpc, errMsg) {
    const prev = isMention ? items : done
    const setList = isMention ? setItems : setDone
    setList((xs) => xs.filter((x) => x.id !== item.id))
    if (isMention) cachedItems = cachedItems.filter((x) => x.id !== item.id)
    else cachedDone = cachedDone.filter((x) => x.id !== item.id)
    rpc(item.id).catch(() => {
      setList(prev)
      if (isMention) cachedItems = prev
      else cachedDone = prev
      alert(errMsg)
    })
  }
  const complete = (m) => removeOptimistic(m, true, completeMention, '操作失败，请重试。')
  const dismissMention = (m) => removeOptimistic(m, true, dismissMentionRpc, '删除通知失败，请重试。')
  const ackDone = (c) => removeOptimistic(c, false, ackCompletion, '关闭通知失败，请重试。')

  return (
    <>
      {visibleItems.length > 0 && (
        <div className="mt-2 rounded-md px-3.5 py-2" style={{ background: 'var(--accent-soft)' }}>
          <button onClick={toggleMentions} className={'flex w-full items-center gap-1 text-xs font-bold' + (mentionsCollapsed ? '' : ' mb-1.5')} style={{ color: 'var(--accent)' }}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><InboxIcon size={13} /></span>
            <span className="leading-none">@我的 · {visibleItems.length} 条</span>
            <ChevronDown size={13} className={'ml-auto transition-transform ' + (mentionsCollapsed ? '-rotate-90' : '')} />
          </button>
          {!mentionsCollapsed && visibleItems.map((m) => {
            const from = profiles?.find((p) => p.id === m.author)
            const ctx = m.section === 'stash' ? '收集箱' : periodHeaderFromKey(m.section, m.periodKey)
            const who = from?.display_name || '有人'
            return (
              <div key={m.id} className="flex items-start gap-2 py-1 max-md:text-[15.5px]">
                <button
                  onClick={() => complete(m)}
                  title="完成（对方会收到通知）"
                  aria-label="完成（对方会收到通知）"
                  className="mt-0.5 shrink-0 text-stone-400 transition-colors hover:text-[var(--accent)]"
                >
                  <Square size={16} />
                </button>
                <button onClick={() => open(m)} className="block min-w-0 flex-1 text-left hover:opacity-80">
                  {m.snippet ? (
                    <>
                      <div className="truncate text-[13.5px]" style={{ color: 'var(--ink)' }}>{m.snippet}</div>
                      <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        <b style={{ color: 'var(--ink-muted)' }}>{who}</b> @了你 · {ctx}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink-muted)' }}>
                      <span className="min-w-0 flex-1 truncate"><b style={{ color: 'var(--ink)' }}>{who}</b> 在「{SECTION_LABELS[m.section] || ''}」@了你</span>
                      <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{ctx}</span>
                    </div>
                  )}
                </button>
                <button onClick={() => dismissMention(m)} title="忽略（TA 不会收到任何提示）" aria-label="忽略这条通知" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {/* 已完成：别人 ✓ 了我 @ 的事。普通通知，✕ 即完；条目里不重复放图标（区头已经说明了）。 */}
      {visibleDone.length > 0 && (
        <div className="mt-2 rounded-md px-3.5 py-2" style={{ background: 'color-mix(in srgb, var(--warning) 16%, var(--surface-elevated))' }}>
          <button onClick={toggleDone} className={'flex w-full items-center gap-1 text-xs font-bold' + (doneCollapsed ? '' : ' mb-1.5')} style={{ color: 'var(--warning)' }}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><CheckCircle2 size={13} /></span>
            <span className="leading-none">已完成 · {visibleDone.length} 条</span>
            <ChevronDown size={13} className={'ml-auto transition-transform ' + (doneCollapsed ? '-rotate-90' : '')} />
          </button>
          {!doneCollapsed && visibleDone.map((c) => {
            const who = profiles?.find((p) => p.id === c.mentioned)?.display_name || '有人'
            const ctx = c.section === 'stash' ? '收集箱' : periodHeaderFromKey(c.section, c.periodKey)
            return (
              <div key={c.id} className="flex items-start gap-2 py-1 max-md:text-[15.5px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]" style={{ color: 'var(--ink)' }}>{c.snippet || '（无内容）'}</div>
                  <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                    <b style={{ color: 'var(--ink-muted)' }}>{who}</b> 完成了 · {ctx}
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
    </>
  )
}
