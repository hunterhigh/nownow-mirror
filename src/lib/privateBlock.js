import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 逐行私密：给块级节点加一个布尔 `private` 属性，渲染成 data-private="true"（CSS 给自己侧底色）。
// 真隐私由数据侧兜底（老铁）：存的时候按 attrs.private 递归剥离生成 doc_json_public，
// 别人读到的版本里这些块根本不存在（含其中的 @通知、搜索文字）。前端只负责打标记 + 自己侧提示。
const PRIVATE_TYPES = ['paragraph', 'heading', 'taskItem', 'listItem', 'blockquote', 'codeBlock', 'image','table','callout','horizontalRule']

// PrivateBlock：只加属性（DocEditor + markdown 转换器共用，转换器不需要下面的 UI 插件）。
export const PrivateBlock = Extension.create({
  name: 'privateBlock',
  addGlobalAttributes() {
    return [
      {
        types: PRIVATE_TYPES,
        attributes: {
          private: {
            default: false,
            keepOnSplit: false, // 回车另起一行不继承私密
            renderHTML: (attrs) => (attrs.private ? { 'data-private': 'true' } : {}),
            parseHTML: (el) => el.getAttribute('data-private') === 'true',
          },
        },
      },
    ]
  },
})

// 定位「当前这条」：最近的 taskItem/listItem（待办/列表里「这条」=那一项）；不在列表里就用顶层块。
function currentBlockDepth($from) {
  for (let d = $from.depth; d >= 1; d--) {
    const name = $from.node(d).type.name
    if (name === 'taskItem' || name === 'listItem') return d
  }
  return 1
}

// 当前选区所在块是否已私密：从光标处往上，任意祖先块带 private 就算（覆盖嵌套：
// private 可能标在 listItem/taskItem 或里面的段落上，和后端递归剥离一个口径，也和右侧角标一致）。
export function isBlockPrivate(editor) {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d)?.attrs?.private) return true
  }
  return false
}

// 切换「当前这条」的私密：已私密 → 清掉所有祖先块的 private（不管之前标在哪层，确保真解锁）；
// 未私密 → 打在「这条」（最近的 taskItem/listItem，否则顶层块）。
export function toggleBlockPrivate(editor) {
  const { state } = editor
  const { $from } = state.selection
  if (isBlockPrivate(editor)) {
    let tr = state.tr
    for (let d = $from.depth; d >= 1; d--) {
      const node = $from.node(d)
      if (node?.attrs?.private) tr = tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, private: false })
    }
    editor.view.dispatch(tr)
  } else {
    const depth = currentBlockDepth($from)
    const node = $from.node(depth)
    editor.view.dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, private: true }))
  }
  editor.commands.focus()
}

// lucide「Lock」闭锁描边图标——私密块右侧常驻一个闭锁角标（状态=已私密），点它取消私密。
const LOCK_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'

// 一个节点算不算「视觉行」：顶层段落/标题/引用/代码块，或任意层级的 listItem/taskItem。
// （listItem 里的段落不算独立行，靠 parent=doc 排除。）
function isRowNode(node, parent) {
  const name = node.type.name
  if (name === 'taskItem' || name === 'listItem') return true
  if (parent?.type?.name !== 'doc') return false
  return name === 'paragraph' || name === 'heading' || name === 'blockquote' || name === 'codeBlock'
}

// PrivateBlockLock（只在 DocEditor 用，转换器不加）：
// ① 把「连续私密行」标成一组——相邻私密行（即使跨容器：待办/列表/段落）衔接处去圆角 + 向对方外扩盖住块间缝，
//    整段连成一片无缝灰；单独一块仍是独立圆角。靠 pv-join-top/bottom 类 + CSS 实现。
// ② 私密行右上角挂纯状态 🔒 角标（不可点、解锁走悬浮条）。
export const PrivateBlockLock = Extension.create({
  name: 'privateBlockLock',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            // 按文档顺序收集所有「行」
            const rows = []
            state.doc.descendants((node, pos, parent) => {
              if (isRowNode(node, parent)) rows.push({ pos, node })
            })
            const decos = []
            rows.forEach((row, i) => {
              if (!row.node.attrs?.private) return
              const prevP = i > 0 && rows[i - 1].node.attrs?.private
              const nextP = i + 1 < rows.length && rows[i + 1].node.attrs?.private
              const cls = ['pv-row']
              if (prevP) cls.push('pv-join-top') // 上一行也私密 → 顶部去圆角、向上盖缝
              if (nextP) cls.push('pv-join-bottom') // 下一行也私密 → 底部去圆角、向下盖缝
              decos.push(Decoration.node(row.pos, row.pos + row.node.nodeSize, { class: cls.join(' ') }))
              // 整段只在「这段私密的第一行」右上角放一个锁标识（不再每行一个、降噪）。
              if (!prevP) {
                decos.push(
                  Decoration.widget(
                    row.pos + 1,
                    () => {
                      const el = document.createElement('span')
                      el.className = 'doc-private-lock'
                      el.title = '这段私密 · 只自己可见'
                      el.setAttribute('contenteditable', 'false')
                      el.innerHTML = LOCK_SVG
                      return el
                    },
                    { side: 1 },
                  ),
                )
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
