import { useEffect, useState } from 'react'
import { ChevronDown, Inbox as InboxIcon, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dismissMention as dismissMentionRpc, loadMyMentions } from '../lib/docMentionsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 模块级缓存：切回自己页时先用上次的未读列表**瞬间按最终高度渲染**，不再「空→异步拉回→撑出来」抖一下。
// 按账号隔离（cachedUserId），换号登录不串上个账号的通知。后台仍会刷新成最新。
let cachedItems = []
let cachedUserId = null

// docs 世界的「@我的」窄条：别人在文档里 @ 了我 → 只列**未读**的，点一条跳过去、✕ 忽略。
// 纯通知模型（海涛 2026-08-09 拍板）：没有勾选完成、没有黄色回执区 —— @ 只是知会，
// 不是派活，所以不存在"做没做完"。旧任务流见 git 历史。
export default function Inbox({ me, profiles, onJumpDoc, scope = null }) {
  const [items, setItems] = useState(() => (cachedUserId === me?.id ? cachedItems : []))
  const [mentionsCollapsed, setMentionsCollapsed] = useState(true)
  const scopeKey = scope ? `${scope.section}:${scope.periodKey}` : 'all'
  const toggleMentions = () => setMentionsCollapsed((v) => !v)

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
    }
    refresh()
    // 被 @ 时实时亮（doc_mentions 已加进 realtime publication）
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
  }, [scopeKey])

  const inScope = (item) => (
    !scope ||
    (item.section === scope.section && item.periodKey === scope.periodKey)
  )
  const visibleItems = items.filter(inScope)

  if (visibleItems.length === 0) return null

  function open(m) {
    onJumpDoc?.(m.owner, m.section, m.periodKey, m.tagId)
  }

  async function dismissMention(m) {
    try {
      await dismissMentionRpc(m.id)
      setItems((xs) => xs.filter((x) => x.id !== m.id))
      cachedItems = cachedItems.filter((x) => x.id !== m.id)
    } catch {
      alert('删除通知失败，请重试。')
    }
  }

  return (
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
            <button onClick={() => dismissMention(m)} title="忽略这条通知" aria-label="忽略这条通知" className="mt-0.5 shrink-0 text-stone-400 hover:text-stone-600">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
