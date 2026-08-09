import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'

// 时间戳：`/当前时间` 插进来的「● 8月9日 周日」—— 独占一行的块级节点。
//
// 为什么是一个节点，而不是一段文字（「• 8月9日 周日」那样）：
//
// 它的用途是**记录我是什么时候写的**。作为记录，它必须满足两件事，而纯文字两件都不满足：
//
// 1）**不能被半删。** 文字状态下退格会一个字一个字地啃，留下「8月9日 周」这种
//    看起来还像日期、其实已经错了的东西 —— 记录一旦能被悄悄改坏，就不是记录了。
//    atom: true 让它整体存在、整体删除，光标进不去。
//
// 2）**不能事后变。** 值在插入那一刻就冻进 attrs，之后无论谁重新打开、
//    在哪个时区看，都是当时那个日期。（不是每次渲染现算「今天」——
//    那样的话，昨天写的东西明天看会变成明天，记录直接失效。）
//
// 另外那个圆点是 CSS 画的实心圆，和时间线抬头用的是同一个 var(--accent)，
// 不是「•」这个字符 —— 字符会跟着正文颜色走，也能被单独删掉。
//
// 3）**不接受任何格式**（海涛：不能加颜色这些）。注意 schema 的 marks: ''
//    管不了这件事 —— 它限制的是节点**内容里**的 mark，而能不能给节点本身
//    套 mark 由父节点（段落，全放行）决定。所以真正的挡法是下面的
//    appendTransaction 插件：任何事务落地后，发现 dateStamp 身上有 mark
//    就当场剥掉。选一段包含它的文字加粗/上色，正文会变，它纹丝不动 ——
//    数据层面就存不进去，不是 UI 上藏按钮。
// 4）**独立成块**（海涛：后面不能加文字，它是固定和单独的模块）。
//    group: 'block' + atom：它自己占一行，光标落不进这一行，
//    在它后面打字会落到下一段，而不是接在日期后面。
// 5）**删除要两下**（海涛的定义）：第一下退格，空行消失、光标消失、
//    时间戳整块进入"待删"高亮；第二下才真删。误删一份日期记录不该
//    只隔着一次手滑。实现见 addKeyboardShortcuts；"待删"态就是
//    NodeSelection，所以 selectable 必须是 true —— 但它选中的是整块
//    （淡色高亮），不是文字那种逐字蓝选，加粗/上色仍然套不上（见 3）。
// 6）**点它 = 在它下面给你一行接着写**（海涛的定义）。下一行已有内容时
//    新建一个空行插在中间（点日期的意图是"紧跟着日期写"，不是"接到
//    旧内容开头"）；下一行本来就是空行就直接落进去，连点不会堆空行。
//    在 mousedown 就拦（不是 click）：selectable 节点的默认 mousedown
//    会先产生整块选中的高亮，闪一下再跳走很怪 —— 而且选中态 = 待删态，
//    "点一下 + 退格"会绕过两步删除。现在"待删"只有键盘退格一个入口。
export const DateStamp = Node.create({
  name: 'dateStamp',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',

  addAttributes() {
    return {
      // 完整 ISO 时间戳：显示只到「日」，但真实写入时刻留着 ——
      // 以后想显示到分钟，是改渲染，不是重新去补数据。
      at: { default: null },
      // 插入当时算好的显示文本（periodHeader('today')）。
      label: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-date-stamp]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const at = node.attrs.at
    let title = node.attrs.label || ''
    if (at) {
      const d = new Date(at)
      if (!Number.isNaN(d.getTime())) {
        const p = (n) => String(n).padStart(2, '0')
        title = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
      }
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-date-stamp': '', class: 'date-stamp', title }),
      ['span', { class: 'date-stamp-dot' }],
      node.attrs.label || '',
    ]
  },

  // editor.getText() / Markdown 导出走这里，否则这一段在纯文本里会整个消失。
  renderText({ node }) {
    return node.attrs.label || ''
  },

  addKeyboardShortcuts() {
    // 把「光标停在时间戳旁边按删除」变成两步：先整块待删（NodeSelection），再真删。
    // 不拦别的情况 —— 返回 false 就交回默认行为，正文的删除手感不受影响。
    const twoStep = (dir) => () =>
      this.editor.commands.command(({ state, tr }) => {
        const sel = state.selection
        // 已处于"待删"：这一下真删
        if (sel instanceof NodeSelection && sel.node.type.name === this.name) {
          tr.deleteSelection()
          return true
        }
        const $c = sel.$cursor
        if (!$c || $c.depth === 0) return false
        const container = $c.node($c.depth - 1)
        const index = $c.index($c.depth - 1)
        if (dir === 'back') {
          if ($c.parentOffset !== 0 || index === 0) return false
          const before = container.child(index - 1)
          if (before.type.name !== this.name) return false
          const paraPos = $c.before($c.depth)
          const stampPos = paraPos - before.nodeSize
          // 空行：第一下把这一行收掉，光标消失，时间戳进入待删
          if ($c.parent.content.size === 0) tr.delete(paraPos, paraPos + $c.parent.nodeSize)
          tr.setSelection(NodeSelection.create(tr.doc, stampPos))
          return true
        }
        // dir === 'forward'（Fn+Delete）：对称处理，行尾朝下删也不许一下带走
        if ($c.parentOffset !== $c.parent.content.size) return false
        const after = container.maybeChild(index + 1)
        if (!after || after.type.name !== this.name) return false
        tr.setSelection(NodeSelection.create(tr.doc, $c.after($c.depth)))
        return true
      })
    return { Backspace: twoStep('back'), Delete: twoStep('forward') }
  },

  addProseMirrorPlugins() {
    const name = this.name
    // 点到时间戳 → 让光标在它正下方的一行落地（必要时新建那一行）
    const jumpBelow = (view, nodePos, node) => {
      const after = nodePos + node.nodeSize
      const tr = view.state.tr
      const next = tr.doc.resolve(after).nodeAfter
      if (!(next && next.isTextblock && next.content.size === 0)) {
        tr.insert(after, view.state.schema.nodes.paragraph.createAndFill())
      }
      tr.setSelection(TextSelection.create(tr.doc, after + 1))
      view.dispatch(tr.scrollIntoView())
      view.focus()
    }
    const findStamp = (doc, pos) => {
      let hit = null
      doc.descendants((n, p) => {
        if (hit) return false
        if (n.type.name === name && p <= pos && pos <= p + n.nodeSize) { hit = { node: n, pos: p }; return false }
      })
      return hit
    }
    return [
      new Plugin({
        props: {
          // 在 mousedown 拦截：晚到 click 的话，默认行为已经把整块选中、
          // 高亮闪过一下了（海涛：点击不要有高亮）。
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (!view.editable) return false // 只读页（看别人的文档）：点击不得改动视图
              const el = event.target instanceof Element ? event.target.closest('[data-date-stamp]') : null
              if (!el) return false
              event.preventDefault()
              const hit = findStamp(view.state.doc, view.posAtDOM(el, 0))
              if (hit) jumpBelow(view, hit.pos, hit.node)
              return true
            },
          },
          // 兜底（触屏等不走 mousedown 的路径）
          handleClickOn: (view, _pos, node, nodePos, _event, direct) => {
            if (!view.editable) return false
            if (!direct || node.type.name !== name) return false
            jumpBelow(view, nodePos, node)
            return true
          },
        },
      }),
      new Plugin({
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.docChanged)) return null
          let tr = null
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.marks.length) {
              tr = tr || state.tr
              tr.setNodeMarkup(pos, undefined, node.attrs, [])
            }
          })
          return tr
        },
      }),
    ]
  },
})
