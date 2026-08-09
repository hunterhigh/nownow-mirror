import { useCallback, useMemo, useRef } from 'react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { offset as offsetMiddleware } from '@floating-ui/dom'
import { ArrowUp } from 'lucide-react'

// 过去块每块右侧的「⬆️ 搬到今天」入口（海涛要的：那条最右边出现 ⬆️、点了搬到今天）。
// 复用官方 DragHandle 做「hover 哪块」探测（独立 pluginKey 不和左侧拖拽手柄冲突、放右侧），
// 点 ⬆️ → 算出该块在顶层的 index → 回调 onCarry(blockIndex)，数据侧 moveBlockToToday 落库。
export default function CarryHandle({ editor, onCarry }) {
  const posRef = useRef(null)
  const onNodeChange = useCallback(({ pos }) => { posRef.current = pos }, [])
  // 稳定引用：computePositionConfig 进了官方 DragHandle 的注册 useEffect 依赖，
  // 内联对象每次渲染都新引用会反复重注册插件（同 slash 闪烁那个坑），memo 死。
  // offset 负 mainAxis：把 ⬆️ 从「块右缘外」往左收进块内右侧，否则块是满宽、right-start 会把按钮甩到编辑框外。
  const positionConfig = useMemo(() => ({ placement: 'right-start', middleware: [offsetMiddleware({ mainAxis: -30 })] }), [])

  const carry = useCallback(() => {
    const pos = posRef.current
    if (pos == null || !editor) return
    // 算这一块在顶层 children 里的 index（pos 是块的起始位置）
    let blockIndex = -1
    editor.state.doc.forEach((node, offset, index) => {
      if (pos >= offset && pos < offset + node.nodeSize) blockIndex = index
    })
    if (blockIndex < 0) return
    onCarry?.(blockIndex)
  }, [editor, onCarry])

  return (
    <DragHandle
      editor={editor}
      pluginKey="carryHandle"
      onNodeChange={onNodeChange}
      computePositionConfig={positionConfig}
    >
      <button type="button" className="doc-carry-handle" title="搬到今天" aria-label="搬到今天" onClick={carry}>
        <ArrowUp size={14} strokeWidth={2.2} />
      </button>
    </DragHandle>
  )
}
