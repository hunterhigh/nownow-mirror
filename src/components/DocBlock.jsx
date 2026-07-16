import { useEffect, useRef, useState } from 'react'
import DocEditor from './DocEditor'
import SaveStatus from './SaveStatus'
import { loadDocResilient, saveDocResilient, flushPending, peekDocCache } from '../lib/resilientDocs'

// 上传中的本地预览图 src 是 blob:，刷新即失效——绝不能落库（存了 = 刷新/重挂后坏图，就是"图片消失"）。
// 存档前把所有 blob: 图片节点剔掉；等上传完 src 换成公网地址、那次 onChange 再把图正常存进去。
// 只剔 blob: 的（公网 https 图原样保留），其余正文照存、永不丢字。
function hasBlobImage(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src.startsWith('blob:')) return true
  return Array.isArray(node.content) && node.content.some(hasBlobImage)
}
function stripBlobImages(node) {
  if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return node
  return {
    ...node,
    content: node.content
      .filter((c) => !(c.type === 'image' && typeof c.attrs?.src === 'string' && c.attrs.src.startsWith('blob:')))
      .map(stripBlobImages),
  }
}

// 时间线里的一个文档块 = 一个 (owner, section, period_key)。
// 当前周期可写（防抖 600ms 自动落库；永不丢字 + 离线韧性，见 resilientDocs）；过去/别人的只读。
// fill=当前周期块铺满首屏（点空白也能落光标编辑）。
export default function DocBlock({ owner, section, periodKey, tagId = null, editable, placeholder, profiles, mentionFreq, mentionStates, fill, onCarry }) {
  // 初值同步读缓存：命中就直接拿来当初值、不经 undefined 占位 → 缓存命中零加载闪（暂存等再点秒显）。
  const [content, setContent] = useState(() => peekDocCache(owner, section, periodKey, tagId)) // undefined=加载中, null=空, obj=PM JSON
  const [saveState, setSaveState] = useState(null) // 'saving'|'saved'|'offline'|'error'|null
  const saveTimer = useRef(null)
  const savedClear = useRef(null)
  const pendingSave = useRef(null) // 还没落库的最新一次（防抖窗口里）——切页/卸载时补存，防丢最后改动

  // 成功路径全静默（保存中/已保存都不显示）——海涛嫌「已保存」打扰书写。
  // 只在离线/失败时提示（永不丢字仍兜底，真出问题才出声）。
  const onSaveState = (s) => {
    clearTimeout(savedClear.current)
    setSaveState(s === 'saving' || s === 'saved' ? null : s)
  }

  useEffect(() => {
    let alive = true
    // 切块时也先用缓存（命中=不闪），miss 才回到 undefined 占位
    setContent(peekDocCache(owner, section, periodKey, tagId))
    loadDocResilient(owner, section, periodKey, tagId)
      .then((j) => alive && setContent(j ?? null))
      .catch(() => alive && setContent(null))
    return () => {
      alive = false
      clearTimeout(saveTimer.current)
      clearTimeout(savedClear.current)
      // 切页/卸载时把防抖窗口里还没落库的最后一次编辑立刻补存（尤其图片上传完「换公网地址」那次），
      // 否则 600ms 内切页会丢这次存。payload 已剔 blob、存的是安全内容；不带 onState 避免卸载后 setState。
      if (pendingSave.current) { saveDocResilient(pendingSave.current); pendingSave.current = null }
    }
  }, [owner, section, periodKey, tagId])

  if (content === undefined) {
    // 加载中静默占位。当前周期块保持和编辑器相同高度，避免切标签 cache miss 时页面先塌再展开。
    return <div className={fill ? 'doc-editor doc-editor-fill' : 'min-h-[1.75rem]'} aria-hidden />
  }

  return (
    <div className="relative">
      {editable && (
        <div className="absolute right-1 top-1 z-10">
          <SaveStatus state={saveState} onRetry={() => { flushPending(); onSaveState('saving') }} />
        </div>
      )}
      <DocEditor
        key={`${owner}/${section}/${periodKey}/${tagId || 'default'}`}
        content={content || undefined}
        editable={editable}
        fill={fill && editable}
        onCarry={onCarry}
        placeholder={placeholder}
        profiles={profiles}
        mentionFreq={mentionFreq}
        mentionStates={mentionStates}
        uploaderId={owner}
        onChange={({ json, text }) => {
          if (!editable) return
          // blob: 预览图不入库（见文件顶部注释）；其余正文照存，永不丢字。上传完换公网地址那次会正常带图存。
          const safeJson = hasBlobImage(json) ? stripBlobImages(json) : json
          const payload = { owner, section, periodKey, tagId, json: safeJson, text }
          pendingSave.current = payload
          clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => {
            pendingSave.current = null
            saveDocResilient(payload, onSaveState)
          }, 600)
        }}
      />
    </div>
  )
}
