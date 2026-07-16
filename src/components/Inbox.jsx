import { useEffect, useState } from 'react'
import { ChevronDown, Inbox as InboxIcon, CheckCircle2, Square, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadMyMentions, markMentionRead, completeMention, loadMyCompletions, ackCompletion } from '../lib/docMentionsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 模块级缓存：切回自己页时先用上次的未读列表**瞬间按最终高度渲染**，不再「空→异步拉回→撑出来」抖一下。
// 按账号隔离（cachedUserId），换号登录不串上个账号的通知。后台仍会刷新成最新。
let cachedItems = []
let cachedDone = [] // 我派的活、对方完成了（黄色），未点掉的
let cachedUserId = null

// docs 世界的「@我的」：别人在自己文档里 @ 了我 → 这里列未读、点一条跳到那篇并标已读。
// 纯通知，无认领/拒绝/任务流（那套随目标模型一起删了）。
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
          const active = rows.filter((r) => !r.completed_at && !r.read_at)
          cachedItems = active
          cachedUserId = me?.id
          if (alive) setItems(active)
        })
        .catch(() => {})
      // 我派的活被对方完成（黄色），和 @ 同一条 realtime 一起刷
      loadMyCompletions()
        .then((rows) => {
          cachedDone = rows
          cachedUserId = me?.id
          if (alive) setDone(rows)
        })
        .catch(() => {})
    }
    refresh()
    // 被 @ / 对方完成时实时亮（doc_mentions 已加进 realtime publication）
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

  async function complete(m) {
    try {
      await completeMention(m.id)
      setItems((xs) => xs.filter((x) => x.id !== m.id))
      cachedItems = cachedItems.filter((x) => x.id !== m.id)
    } catch {
      alert('标记完成失败，请重试。')
    }
  }

  async function dismissMention(m) {
    try {
      await markMentionRead(m.id)
      setItems((xs) => xs.filter((x) => x.id !== m.id))
      cachedItems = cachedItems.filter((x) => x.id !== m.id)
    } catch {
      alert('删除通知失败，请重试。')
    }
  }

  async function dismissDone(c) {
    try {
      await ackCompletion(c.id)
      setDone((xs) => xs.filter((x) => x.id !== c.id))
      cachedDone = cachedDone.filter((x) => x.id !== c.id)
    } catch {
      alert('关闭通知失败，请重试。')
    }
  }

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
                  type="button"
                  onClick={() => complete(m)}
                  title="标记完成"
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
                <button onClick={() => dismissMention(m)} title="删除这条通知" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {/* 黄色「已完成」：我派的活被对方完成了。snippet + who 完成了 · 日期；完成的不用跳，只留 × 点掉。 */}
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
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" style={{ color: 'var(--warning)' }}>
                  <CheckCircle2 size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]" style={{ color: 'var(--ink)' }}>{c.snippet || '（无内容）'}</div>
                  <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                    <b style={{ color: 'var(--ink-muted)' }}>{who}</b> 完成了你派的 · {ctx}
                  </div>
                </div>
                <button onClick={() => dismissDone(c)} title="知道了" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
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
