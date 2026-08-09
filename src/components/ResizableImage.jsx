import { useEffect, useRef, useState } from 'react'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { AlignLeft, AlignCenter, AlignRight, Crop, Check, X, Lock, Unlock } from 'lucide-react'
import { getUploadProgress, subscribeUploadProgress } from '../lib/uploadProgress'

// 飞书云文档式图片：选中=蓝框+四角圆点手柄+对齐工具条，外加裁剪。
// 裁剪用「显示裁剪」实现：裁剪区 {x,y,w,h}(占自然尺寸的比例) 存进 attrs，
// 容器 overflow:hidden + 放大的 img 偏移，只露出裁剪区——不重传、原图不动、可还原。
function ResizableImageView({ node, updateAttributes, editor, selected }) {
  const imgRef = useRef(null)
  const stageRef = useRef(null)
  const editable = editor.isEditable
  const align = node.attrs.align || 'left'
  const crop = node.attrs.crop || null
  const W = node.attrs.width || null
  // 上传中（src 还是 blob: 临时地址）→ 右上角圆环进度。进度走旁路 store（不进 attrs，见 uploadProgress.js）。
  const src = node.attrs.src
  const uploading = typeof src === 'string' && src.startsWith('blob:')
  const [uploadPct, setUploadPct] = useState(() => (uploading ? getUploadProgress(src) ?? 0 : null))
  useEffect(() => {
    if (!uploading) { setUploadPct(null); return }
    setUploadPct(getUploadProgress(src) ?? 0)
    return subscribeUploadProgress(src, setUploadPct)
  }, [src, uploading])
  const [nat, setNat] = useState(null) // 自然尺寸 {w,h}
  const [loaded, setLoaded] = useState(false) // 字节是否加载完（控加载前占位底色；src 变了重置）
  const [cropping, setCropping] = useState(false)
  const [draft, setDraft] = useState(null) // 裁剪中草稿 {x,y,w,h}
  const [cropW, setCropW] = useState(0) // 进入裁剪时实测的显示宽（避免尺寸跳变）

  useEffect(() => { setLoaded(false) }, [src])
  // 自然高/宽：优先用存的 ratio（加载前就有 → 提前占住高度防 CLS），没有再用实测的。
  const ratio = node.attrs.ratio || (nat ? nat.h / nat.w : null)

  // 和文字气泡 / Slash 菜单同一套浮层 UI（定位由 .doc-img-toolbar 负责）
  const TB = 'doc-img-toolbar flex items-center gap-0.5 rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-1 text-stone-600 shadow-[0_8px_24px_rgba(0,0,0,0.06)]'
  const tbtn = (on) => 'flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-100 hover:text-stone-900 ' + (on ? 'bg-stone-200 text-stone-900' : '')

  const onImgLoad = (e) => {
    const w = e.target.naturalWidth
    const h = e.target.naturalHeight
    if (!nat) setNat({ w, h })
    setLoaded(true)
    // 首次加载实测后把 ratio（+缺省宽度）回填进 attrs → 持久化，以后刷新提前占位、不再抖。
    // 只有可编辑（=自己页）才写；别人页只读，靠 owner 存好的 attrs 享受占位。
    if (editable && w > 0) {
      const patch = {}
      if (!node.attrs.ratio) patch.ratio = Math.round((h / w) * 10000) / 10000
      if (!node.attrs.width) patch.width = w // 宽要确定，aspect-ratio 才能提前占高；max-width:100% 兜响应式
      if (Object.keys(patch).length) updateAttributes(patch)
    }
  }

  // 四角拖拽缩放（整图宽度）：左角往左拖变大（dir=-1），右角往右拖变大（dir=1）
  const startResize = (dir) => (e) => {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current?.offsetWidth || 300
    const onMove = (ev) => updateAttributes({ width: Math.max(60, Math.round(startW + dir * (ev.clientX - startX))) })
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const setAlign = (a) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    updateAttributes({ align: a })
  }

  // ===== 裁剪 =====
  // 工作区宽 = 进入裁剪时图片的真实显示宽（实测 offsetWidth），保证裁剪模式不跳大跳小。
  // 已裁剪时 imgRef 是放大后的整图(offsetWidth=整图宽)、未裁剪时就是显示宽——两种都对。
  const workW = cropW || W || 360
  const workH = ratio ? workW * ratio : workW

  const enterCrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setCropW(imgRef.current?.offsetWidth || W || 360)
    setDraft(crop || { x: 0, y: 0, w: 1, h: 1 })
    setCropping(true)
  }
  const cancelCrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setCropping(false)
    setDraft(null)
  }
  const applyCrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const d = draft
    const full = d.x <= 0.001 && d.y <= 0.001 && d.w >= 0.999 && d.h >= 0.999
    updateAttributes({ crop: full ? null : d, width: Math.round(workW * d.w) })
    setCropping(false)
    setDraft(null)
  }

  // 拖动裁剪框：corner='nw'|'ne'|'sw'|'se' 改尺寸，null=整体移动
  const dragRect = (corner) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const start = { ...draft }
    const startX = e.clientX
    const startY = e.clientY
    const MIN = 0.08
    const onMove = (ev) => {
      let dx = (ev.clientX - startX) / workW
      let dy = (ev.clientY - startY) / workH
      let { x, y, w, h } = start
      if (corner === null) {
        x = Math.min(Math.max(0, start.x + dx), 1 - start.w)
        y = Math.min(Math.max(0, start.y + dy), 1 - start.h)
      } else {
        const left = corner.includes('w')
        const top = corner.includes('n')
        if (left) {
          const nx = Math.min(Math.max(0, start.x + dx), start.x + start.w - MIN)
          w = start.x + start.w - nx
          x = nx
        } else {
          w = Math.min(Math.max(MIN, start.w + dx), 1 - start.x)
        }
        if (top) {
          const ny = Math.min(Math.max(0, start.y + dy), start.y + start.h - MIN)
          h = start.y + start.h - ny
          y = ny
        } else {
          h = Math.min(Math.max(MIN, start.h + dy), 1 - start.y)
        }
      }
      setDraft({ x, y, w, h })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ===== 裁剪模式渲染 =====
  if (cropping && draft) {
    const r = draft
    return (
      <NodeViewWrapper as="div" className="doc-img-block" style={{ textAlign: align }}>
        <span className="doc-img-wrap is-cropping" contentEditable={false}>
          <span className="doc-crop-stage" ref={stageRef} style={{ width: workW + 'px' }}>
            <img src={node.attrs.src} alt="" draggable={false} style={{ width: workW + 'px', display: 'block' }} onLoad={onImgLoad} />
            <span
              className="doc-crop-rect"
              style={{ left: r.x * workW + 'px', top: r.y * workH + 'px', width: r.w * workW + 'px', height: r.h * workH + 'px' }}
              onPointerDown={dragRect(null)}
            >
              <span className="doc-crop-h nw" onPointerDown={dragRect('nw')} />
              <span className="doc-crop-h ne" onPointerDown={dragRect('ne')} />
              <span className="doc-crop-h sw" onPointerDown={dragRect('sw')} />
              <span className="doc-crop-h se" onPointerDown={dragRect('se')} />
            </span>
          </span>
          <span className={TB} contentEditable={false}>
            <button type="button" className={tbtn(true)} onMouseDown={applyCrop} title="完成裁剪" aria-label="完成裁剪"><Check size={15} strokeWidth={2.2} /></button>
            <button type="button" className={tbtn(false)} onMouseDown={cancelCrop} title="取消" aria-label="取消"><X size={15} strokeWidth={2.2} /></button>
          </span>
        </span>
      </NodeViewWrapper>
    )
  }

  // ===== 普通渲染（含已裁剪显示） =====
  let stageStyle = null
  let imgStyle = { display: 'block', width: (W ? W : 'auto') }
  if (crop && ratio && W) {
    const fullW = W / crop.w
    const fullH = fullW * ratio
    stageStyle = { width: W + 'px', height: crop.h * fullH + 'px', overflow: 'hidden', position: 'relative' }
    imgStyle = { position: 'absolute', left: -crop.x * fullW + 'px', top: -crop.y * fullH + 'px', width: fullW + 'px', maxWidth: 'none', display: 'block' }
  } else if (ratio) {
    // 未裁剪 + 知道比例：aspect-ratio 提前占住高度（宽×ratio），加载前给浅灰占位、图来了盖上，不再顶动内容。
    imgStyle.aspectRatio = String(1 / ratio)
    if (!loaded) imgStyle.backgroundColor = '#f1f0ec'
  }

  return (
    <NodeViewWrapper as="div" className="doc-img-block" style={{ textAlign: align }}>
      <span className={'doc-img-wrap' + (selected ? ' is-selected' : '') + (node.attrs.private ? ' is-private' : '')}>
        <span className="doc-img-stage" style={stageStyle || undefined}>
          <img
            ref={imgRef}
            src={node.attrs.src}
            alt={node.attrs.alt || ''}
            draggable={false}
            style={imgStyle}
            onLoad={onImgLoad}
            onClick={(e) => {
              // 和链接同一套：只读页 普通点就开；可编辑页 Cmd/Ctrl+点开、普通点留给选中编辑。
              if (!editable || e.metaKey || e.ctrlKey) {
                e.preventDefault()
                e.stopPropagation()
                if (node.attrs.src) window.open(node.attrs.src, '_blank', 'noopener,noreferrer')
              }
            }}
          />
        </span>
        {uploading && (
          <span className="doc-img-uploading" contentEditable={false}>
            <svg width="15" height="15" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.2" />
              <circle
                cx="8" cy="8" r="6.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 6.5}
                strokeDashoffset={2 * Math.PI * 6.5 * (1 - (uploadPct ?? 0) / 100)}
                transform="rotate(-90 8 8)"
              />
            </svg>
            <span>{Math.round(uploadPct ?? 0)}%</span>
          </span>
        )}
        {node.attrs.private && (
          <span className="doc-img-private" contentEditable={false}>
            <Lock size={11} strokeWidth={2.5} /> 已私密
          </span>
        )}
        {editable && selected && (
          <>
            <span className={TB} contentEditable={false}>
              <button type="button" className={tbtn(align === 'left')} onMouseDown={setAlign('left')} title="左对齐" aria-label="左对齐"><AlignLeft size={15} strokeWidth={2.2} /></button>
              <button type="button" className={tbtn(align === 'center')} onMouseDown={setAlign('center')} title="居中" aria-label="居中"><AlignCenter size={15} strokeWidth={2.2} /></button>
              <button type="button" className={tbtn(align === 'right')} onMouseDown={setAlign('right')} title="右对齐" aria-label="右对齐"><AlignRight size={15} strokeWidth={2.2} /></button>
              <span className="mx-0.5 h-4 w-px bg-stone-200" />
              <button type="button" className={tbtn(!!crop)} onMouseDown={enterCrop} title="裁剪" aria-label="裁剪"><Crop size={15} strokeWidth={2.2} /></button>
              <span className="mx-0.5 h-4 w-px bg-stone-200" />
              {/* 图片私密：未锁=🔒(点设私密)、已锁=🔓(点取消)。后端按 attrs.private 剥离、别人彻底看不到 */}
              <button
                type="button"
                className={tbtn(!!node.attrs.private)}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); updateAttributes({ private: !node.attrs.private }) }}
                title={node.attrs.private ? '取消私密' : '设为私密 · 只自己可见'}
              >
                {node.attrs.private ? <Unlock size={15} strokeWidth={2.2} /> : <Lock size={15} strokeWidth={2.2} />}
              </button>
            </span>
            <span className="doc-img-handle tl" onPointerDown={startResize(-1)} title="拖拽缩放" aria-label="拖拽缩放" />
            <span className="doc-img-handle tr" onPointerDown={startResize(1)} title="拖拽缩放" aria-label="拖拽缩放" />
            <span className="doc-img-handle bl" onPointerDown={startResize(-1)} title="拖拽缩放" aria-label="拖拽缩放" />
            <span className="doc-img-handle br" onPointerDown={startResize(1)} title="拖拽缩放" aria-label="拖拽缩放" />
          </>
        )}
      </span>
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}px` } : {}),
        parseHTML: (el) => (el.style?.width ? parseInt(el.style.width, 10) || null : null),
      },
      align: {
        default: 'left',
        renderHTML: (attrs) => (attrs.align && attrs.align !== 'left' ? { 'data-align': attrs.align } : {}),
        parseHTML: (el) => el.getAttribute('data-align') || 'left',
      },
      crop: {
        default: null,
        renderHTML: (attrs) => (attrs.crop ? { 'data-crop': [attrs.crop.x, attrs.crop.y, attrs.crop.w, attrs.crop.h].join(',') } : {}),
        parseHTML: (el) => {
          const v = el.getAttribute('data-crop')
          if (!v) return null
          const [x, y, w, h] = v.split(',').map(Number)
          return Number.isFinite(x) ? { x, y, w, h } : null
        },
      },
      // 自然高/宽比，存进 doc_json。加载前就用它 + 宽度占住高度（aspect-ratio），图来了正好填满，
      // 不再「图没下完→内容收拢→图一到顶开撑大」(CLS)。首次加载时实测后回填，之后刷新就不抖。
      ratio: {
        default: null,
        renderHTML: (attrs) => (attrs.ratio ? { 'data-ratio': attrs.ratio } : {}),
        parseHTML: (el) => { const v = parseFloat(el.getAttribute('data-ratio')); return Number.isFinite(v) ? v : null },
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
