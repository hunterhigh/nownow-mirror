import { useEffect, useState } from 'react'
import { MessageSquarePlus, SendHorizontal, Trash2 } from 'lucide-react'
import { listFeedback, submitFeedback, deleteFeedback } from '../lib/feedbackApi'

// 反馈墙（独立页面，侧栏「反馈」入口，在通知上面）。
// 使用感受 / bug / 改进建议：全员可见、只能以自己名义发、只能删自己的。
// v1 不做编辑 —— 反馈是当时的记录，要改就删了重发。

// 时间样式参考飞书 memo：2026-06-11 10:21
function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 两级缓存（和通知页同一套）：模块变量管同会话往返，localStorage 管刷新后首屏。
// 进页面先显示上次的列表，网络在后台追 —— 不再"每次点进来都白一下"。
let cachedFeedback = null
let cachedUserId = null
const FB_LS_KEY = (uid) => `nownow_feedback_cache:${uid}`
function seedFeedback(uid) {
  if (cachedUserId === uid && cachedFeedback) return cachedFeedback
  try {
    const raw = localStorage.getItem(FB_LS_KEY(uid))
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v }
  } catch { /* 坏数据当没有 */ }
  return []
}

export default function FeedbackPage({ me, profiles }) {
  const [feedback, setFeedbackState] = useState(() => seedFeedback(me?.id))
  // 所有 setFeedback 都走这里：状态、模块缓存、localStorage 三处一起更新，永不脱节
  const setFeedback = (updater) => {
    setFeedbackState((xs) => {
      const next = typeof updater === 'function' ? updater(xs) : updater
      cachedFeedback = next
      cachedUserId = me?.id
      try { localStorage.setItem(FB_LS_KEY(me?.id), JSON.stringify(next.slice(0, 50))) } catch { /* 配额满不挡功能 */ }
      return next
    })
  }
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listFeedback().then((r) => { if (alive) setFeedback(r) }).catch(() => {})
    return () => { alive = false }
  }, [me?.id])

  // 提交是乐观的：卡片先出现（临时 id），服务器确认后换成真 id；
  // 失败则移除卡片、把内容放回输入框 —— 用户敲的字永远不丢。
  async function send() {
    const content = draft.trim()
    if (!content || submitting) return
    setSubmitting(true)
    setError('')
    const temp = { id: `temp-${Math.random()}`, author: me?.id, content, created_at: new Date().toISOString() }
    setFeedback((xs) => [temp, ...xs])
    setDraft('')
    try {
      const saved = await submitFeedback(content)
      setFeedback((xs) => xs.map((x) => (x.id === temp.id ? saved : x)))
    } catch {
      setFeedback((xs) => xs.filter((x) => x.id !== temp.id))
      setDraft(content)
      setError('反馈提交失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  function remove(f) {
    setError('')
    setFeedback((xs) => xs.filter((x) => x.id !== f.id))
    deleteFeedback(f.id).catch(() => {
      // 只塞回这一条，不整表回滚 —— 快照会复活并发中已成功删掉的其他条目
      setFeedback((xs) => (xs.some((x) => x.id === f.id) ? xs : [f, ...xs]))
      setError('删除反馈失败，请重试。')
    })
  }

  return (
    <div className="pt-1">
      <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold max-md:text-[17px]">
        <MessageSquarePlus size={16} /> 反馈
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* 输入框用纯白：页面背景是米色，同色系容器会"陷"进背景里（海涛："偏白一点"）。卡片仍用 surface-elevated 区分层级。 */}
      <div className="rounded-lg border border-stone-200/80 bg-white p-3 shadow-sm">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send() }}
          placeholder="使用感受、bug、想要的功能……都可以写在这里"
          rows={3}
          maxLength={2000}
          className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-stone-400 max-md:text-[15px]"
        />
        <div className="mt-1 flex items-center">
          {/* ⌘+Enter 仍然能提交，只是不再显示提示（海涛：不需要那行字）。 */}
          {/* 椭圆（h-8 + px-5 的胶囊形）；hover 高亮的是**底色加深**，不是图标变色（海涛的要求）。 */}
          <button
            onClick={send}
            disabled={submitting || !draft.trim()}
            title="提交反馈"
            aria-label="提交反馈"
            className="ml-auto flex h-8 items-center justify-center rounded-full bg-[var(--nav-soft)] px-5 text-stone-600 transition-colors hover:bg-stone-300/70 disabled:opacity-70 disabled:hover:bg-[var(--nav-soft)]"
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>

      {feedback.length === 0 && (
        <p className="mt-6 text-sm text-stone-400 max-md:text-[15px]">
          还没有反馈。用着不顺手的地方、想要的功能，写下来大家都能看到。
        </p>
      )}

      <div className="mt-3 space-y-2">
        {feedback.map((f) => {
          const who = profiles?.find((p) => p.id === f.author)?.display_name || '有人'
          const isMine = f.author === me?.id
          return (
            <div key={f.id} className="rounded-lg border border-stone-200/60 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                <span>{fmtTime(f.created_at)} · {who}</span>
                {/* 垃圾桶和左边的时间·人名同色（var(--ink-faint)）：同一行的辅助元素同一档灰，hover 才转红 */}
                {isMine && (
                  <button onClick={() => remove(f)} title="删除这条反馈" aria-label="删除这条反馈" className="ml-auto hover:!text-red-500" style={{ color: 'var(--ink-faint)' }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {/* whitespace-pre-wrap：反馈常有分点/换行，压成一行会没法读 */}
              <div className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed max-md:text-[15px]" style={{ color: 'var(--ink)' }}>
                {f.content}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
