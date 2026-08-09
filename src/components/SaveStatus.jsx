// 保存状态指示（静默自动保存——永不丢字，正常打字时不打扰）：
// 'saving'/'saved' 不显示任何东西（Haitao：「已保存」在旁边很打扰）；
// 只在真正需要用户知道时才冒出来：离线=暖灰胶囊「离线编辑中」、失败=轻危险色+重试。
//
// 冲突不再有 UI：同一篇在两处被编辑时，saveDocResilient 会静默地以「正在打字的这份」
// 为准自动写上去（被覆盖的那版进 doc_revisions）。所以这里只剩离线和真失败。
//
// state: 'saving' | 'saved' | 'offline' | 'error' | null
export default function SaveStatus({ state, onRetry }) {
  if (!state || state === 'saving' || state === 'saved') return null

  if (state === 'offline')
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[12px]"
        style={{ background: 'var(--surface)', color: 'var(--ink-muted)' }}
      >
        离线编辑中
      </span>
    )

  if (state === 'error')
    return (
      <span className="text-[12px]" style={{ color: 'var(--error)' }}>
        保存失败{' '}
        <button onClick={onRetry} className="underline underline-offset-2">
          重试
        </button>
      </span>
    )


  return null
}
