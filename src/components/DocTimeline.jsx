import { useCallback, useEffect, useRef, useState } from 'react'
import { periodHeader } from '../lib/period'
import { periodHeaderFromKey, periodKey } from '../lib/periodKey'
import { listPeriods, moveBlockToToday } from '../lib/docsApi'
import DocBlock from './DocBlock'

const PERIOD_CACHE_PREFIX = 'nownow_periodcache:'
const periodCache = new Map()
const periodCacheKey = (owner, section, tagId = null) => `${owner || ''}/${section}/${tagId || 'default'}`

function getCachedPeriodKeys(owner, section, tagId = null) {
  const key = periodCacheKey(owner, section, tagId)
  if (periodCache.has(key)) return periodCache.get(key)
  try {
    const raw = localStorage.getItem(PERIOD_CACHE_PREFIX + key)
    if (!raw) return undefined
    const keys = JSON.parse(raw)
    if (!Array.isArray(keys)) return undefined
    periodCache.set(key, keys)
    return keys
  } catch {
    return undefined
  }
}

function setCachedPeriodKeys(owner, section, tagId = null, keys) {
  const key = periodCacheKey(owner, section, tagId)
  periodCache.set(key, keys)
  try {
    localStorage.setItem(PERIOD_CACHE_PREFIX + key, JSON.stringify(keys))
  } catch {}
}

// 一个频道的文档时间线：当前周期可写（占首屏）、过去有内容的周期只读、往下回溯。
// owner=正在看谁的页；section=今日/本周/本月/收集箱；isMyPage=能不能写。
export default function DocTimeline({ owner, section, tagId = null, isMyPage, baseDate, viewportH, profiles, mentionFreq, mentionStates, flashKey, refreshNonce = 0 }) {
  const curKey = periodKey(section, 0, baseDate)
  const tagKey = tagId || 'default'
  const [pastKeys, setPastKeys] = useState([])
  const [pastKeysScope, setPastKeysScope] = useState('')
  const currentPastKeysScope = `${owner || ''}:${section}:${curKey}:${tagKey}`
  const pastKeysInScope = pastKeysScope === currentPastKeysScope ? pastKeys : []
  const [reloadNonce, setReloadNonce] = useState(0) // 搬块后 bump → 当前块+过去块重挂、读已更新缓存
  const refreshRef = useRef(refreshNonce)

  // 搬块后刷新：重拉 pastKeys（源块搬空了会消失）+ 重挂块显示新内容（moveBlockToToday 已更新缓存）
  const refresh = useCallback(() => {
    const scope = currentPastKeysScope
    listPeriods(owner, section, tagId)
      .then((rows) => {
        const keys = rows.map((r) => r.period_key)
        setCachedPeriodKeys(owner, section, tagId, keys)
        setPastKeysScope(scope)
        setPastKeys(keys.filter((k) => k !== curKey))
      })
      .catch(() => {})
    setReloadNonce((n) => n + 1)
  }, [owner, section, curKey, tagId, currentPastKeysScope])

  // 点过去块的 ⬆️：把该块搬到当前周期（今天），落库走老铁的 moveBlockToToday，成功后刷新
  const carry = useCallback(
    (fromPeriod, blockIndex) => {
      moveBlockToToday({ owner, fromSection: section, fromPeriod, fromTagId: tagId, blockIndex, toSection: section, toPeriod: curKey, toTagId: tagId })
        .then(() => refresh())
        .catch((e) => {
          console.error('搬到今天失败', e)
          alert('搬动失败了，可能内容刚被改过——刷新一下再试。')
        })
    },
    [owner, section, curKey, tagId, refresh],
  )

  useEffect(() => {
    const scope = currentPastKeysScope
    const forceRefresh = refreshRef.current !== refreshNonce
    refreshRef.current = refreshNonce
    if (forceRefresh) setReloadNonce((n) => n + 1)
    if (section === 'stash') {
      setPastKeysScope(scope)
      setPastKeys([])
      return
    }
    let alive = true
    const cachedKeys = forceRefresh ? undefined : getCachedPeriodKeys(owner, section, tagId)
    setPastKeysScope(scope)
    setPastKeys((cachedKeys || []).filter((k) => k !== curKey))
    listPeriods(owner, section, tagId)
      .then((rows) => {
        if (!alive) return
        const keys = rows.map((r) => r.period_key)
        setCachedPeriodKeys(owner, section, tagId, keys)
        setPastKeysScope(scope)
        setPastKeys(keys.filter((k) => k !== curKey))
      })
      .catch(() => {
        if (!alive) return
        setPastKeysScope(scope)
        setPastKeys([])
      })
    return () => {
      alive = false
    }
  }, [owner, section, curKey, tagId, currentPastKeysScope, refreshNonce])

  // 收集箱：无时间线、单块
  if (section === 'stash') {
    return (
      <div id="doc-stash-stash" className={'pt-1' + (flashKey === 'stash' ? ' doc-flash' : '')}>
        <DocBlock key={`stash-${owner}-${tagKey}`} owner={owner} section="stash" periodKey="stash" tagId={tagId} editable={isMyPage} placeholder="写点什么…" profiles={profiles} mentionFreq={mentionFreq} mentionStates={mentionStates} fill />
      </div>
    )
  }

  return (
    <>
      {/* 当前周期：占满首屏、可写。块带 id（doc-section-periodKey）供 @通知跳转滚动定位 */}
      <div id={`doc-${section}-${curKey}`} className={'mb-3' + (flashKey === curKey ? ' doc-flash' : '')}>
        <div className="flex items-center gap-1.5 pb-0.5 pt-2 text-[13px] font-normal text-stone-500">
          {/* 主题蓝小圆点标记「当前周期」——往下回溯的过去块不带点、颜色更淡 */}
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
          {periodHeader(section, 0, baseDate)}
        </div>
        <DocBlock key={`${owner}-${section}-${curKey}-${tagKey}-${reloadNonce}`} owner={owner} section={section} periodKey={curKey} tagId={tagId} editable={isMyPage} placeholder="写点什么…" profiles={profiles} mentionFreq={mentionFreq} mentionStates={mentionStates} fill />
      </div>
      {/* 过去：只读，往下回溯 */}
      {pastKeysInScope.map((k) => (
        <div key={`${owner}-${section}-${k}-${tagKey}-${reloadNonce}`} id={`doc-${section}-${k}`} className={'mb-3' + (flashKey === k ? ' doc-flash' : '')}>
          <div className="flex items-center gap-1.5 pb-0.5 pt-2.5 text-[13px] font-normal text-stone-400">
            {/* 每个时间点旁都带主题蓝小圆点（时间线一致感）*/}
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
            {periodHeaderFromKey(section, k)}
          </div>
          {/* 过去块（仅今日时间线、我的页）：每块右侧 ⬆️ 搬到今天 */}
          <DocBlock
            owner={owner}
            section={section}
            periodKey={k}
            tagId={tagId}
            editable={isMyPage}
            placeholder="写点什么…"
            profiles={profiles}
            mentionFreq={mentionFreq}
            mentionStates={mentionStates}
            onCarry={isMyPage && section === 'today' ? (blockIndex) => carry(k, blockIndex) : undefined}
          />
        </div>
      ))}
    </>
  )
}
