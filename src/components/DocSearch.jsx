import { useEffect, useState } from 'react'
import { searchDocs } from '../lib/docsApi'
import { periodHeaderFromKey } from '../lib/periodKey'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }

// 命中处前后截一段做片段
function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text.slice(0, 90)
  const start = Math.max(0, i - 30)
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60)
}

// docs 全文搜索结果：搜 doc_text，点一条跳到那个人那个频道
export default function DocSearch({ query, profiles, onJump }) {
  const [hits, setHits] = useState(null)
  // 防抖 + 至少两个字符再查。
  // 之前是每敲一个键就发一次请求，而每次请求都是对 docs_visible 做 ilike '%q%'
  // ——那一列是 CASE 表达式，索引用不上，必然全表扫。打「会议」= 2 次全表扫，
  // 打一个英文单词 = 5 次以上。单字符查询还几乎匹配所有文档。
  useEffect(() => {
    let alive = true
    const q = (query || '').trim()
    // 长度门槛只拦 ASCII：拉丁字母 1 个字符没有检索意义，但**一个汉字就是一个词**
    // （"茶"、人名单字都是完整查询）—— 一刀切 <2 会让中文单字搜索永远"无结果"。
    const isAsciiOnly = /^[\x00-\x7f]*$/.test(q)
    if (q.length < (isAsciiOnly ? 2 : 1)) { setHits([]); return () => { alive = false } }
    setHits(null)
    const timer = setTimeout(() => {
      searchDocs(q)
        .then((r) => alive && setHits(r))
        .catch(() => alive && setHits([]))
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  if (hits === null) return <div className="pt-3 text-[13px] text-stone-300">搜索中…</div>
  if (!hits.length) return <div className="pt-3 text-[13px] text-stone-300">没找到「{query}」</div>

  return (
    <div className="pt-1">
      {hits.map((h) => {
        const owner = profiles.find((p) => p.id === h.owner)
        return (
          <button
            key={h.id}
            onClick={() => onJump(h)}
            className="block w-full rounded-md px-2 py-2 text-left hover:bg-stone-50"
          >
            <div className="text-[12px] text-stone-400">
              {owner?.display_name || '某人'} · {SECTION_LABELS[h.section]}
              {h.section !== 'stash' && ` · ${periodHeaderFromKey(h.section, h.period_key)}`}
            </div>
            <div className="truncate text-[14px] text-stone-700">{snippet(h.doc_text || '', query) || '（空文档）'}</div>
          </button>
        )
      })}
    </div>
  )
}
