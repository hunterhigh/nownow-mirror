// @vitest-environment jsdom
//
// 这一组守的是「时间戳是记录，不是文字」这句话在代码里真的成立。
//
// 只有这个文件用 jsdom：Tiptap 要 DOM。其余测试仍跑在 node 环境下
// （resilientDocs 那组自己桩了 localStorage/navigator，换成 jsdom 反而会打架）。
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DateStamp } from '../src/components/DateStamp'
import { docJsonToMarkdown, docJsonToText } from '../src/lib/markdown'

const AT = '2026-08-09T16:31:00.000Z'
const DOC = {
  type: 'doc',
  content: [
    { type: 'dateStamp', attrs: { at: AT, label: '8月9日 周日' } },
    { type: 'paragraph', content: [{ type: 'text', text: '写了点东西' }] },
  ],
}

function editor() {
  return new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), DateStamp], content: DOC })
}

// 模拟真实按键：走 keymap 的 handleKeyDown。
// ⚠️ 不要用 ed.commands.keyboardShortcut('Backspace') —— 那条命令会"捕获"内层事务、
// 只把 steps 搬到外层，**选区变化被静默丢掉**。用它测两步删除，第一步的
// "待删选中"永远看不到，测出来的是假失败（这次就是这么踩的）。
const press = (ed, key) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key })))

describe('时间戳：是记录，不是文字', () => {
  it('是块级 atom —— 独占一行、整体存在，光标进不去，不会被啃掉半截', () => {
    const ed = editor()
    const type = ed.schema.nodes.dateStamp
    expect(type).toBeTruthy()
    expect(type.isAtom).toBe(true)
    expect(type.isBlock).toBe(true) // 后面不能接文字：它不在任何段落里
    ed.destroy()
  })

  it('删除要两下：第一下整块待删（不丢任何内容），第二下才真删', () => {
    const ed = editor()
    const hasStamp = () => {
      let found = false
      ed.state.doc.descendants((n) => { if (n.type.name === 'dateStamp') found = true })
      return found
    }
    // 光标放到「写了点东西」最前面。dateStamp 是叶子块，nodeSize=1，
    // 所以段落在 pos 1 开始、文本起点是 pos 2。
    ed.commands.setTextSelection(2)
    // 第一下：什么都没删，时间戳进入"待删"（整块被 NodeSelection 选中，光标消失）
    press(ed, 'Backspace')
    expect(hasStamp()).toBe(true)
    expect(ed.state.selection.node?.type.name).toBe('dateStamp')
    expect(ed.getText()).toContain('写了点东西')
    // 第二下：真删。正文一个字不少。
    press(ed, 'Backspace')
    expect(hasStamp()).toBe(false)
    expect(ed.getText()).toContain('写了点东西')
    ed.destroy()
  })

  it('下一行是空行时：第一下收掉空行并进入待删，第二下才删时间戳', () => {
    const ed = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), DateStamp],
      content: { type: 'doc', content: [
        { type: 'dateStamp', attrs: { at: AT, label: '8月9日 周日' } },
        { type: 'paragraph' },
      ] },
    })
    ed.commands.setTextSelection(2)
    press(ed, 'Backspace')
    // 时间戳还在、处于待删。注意：文档末尾的空段会被 StarterKit 的
    // trailing-node 立刻补回来（文档必须以可写的一行结尾），所以这里
    // 不断言"空行消失"—— 只有时间戳在文档中间时空行才真的收掉。
    expect(ed.state.selection.node?.type.name).toBe('dateStamp')
    press(ed, 'Backspace')
    let found = false
    ed.state.doc.descendants((n) => { if (n.type.name === 'dateStamp') found = true })
    expect(found).toBe(false)
    ed.destroy()
  })

  it('不接受任何格式 —— 全选加粗/上色，正文变、它不变', () => {
    const ed = editor()
    // schema 层面：这个节点类型不允许任何 mark
    expect(ed.schema.nodes.dateStamp.spec.marks).toBe('')
    // 行为层面：全选 + 加粗，dateStamp 上不落 bold
    ed.commands.selectAll()
    ed.commands.setBold()
    let stamp = null
    ed.state.doc.descendants((n) => { if (n.type.name === 'dateStamp') stamp = n })
    expect(stamp.marks.length).toBe(0)
    ed.destroy()
  })

  it('点击时间戳：在它正下方创建一个空行、光标落进去（不选中、不高亮）', () => {
    const ed = editor()
    const click = () => ed.view.someProp('handleClickOn', (f) =>
      f(ed.view, 0, ed.state.doc.child(0), 0, new MouseEvent('mousedown'), true),
    )
    expect(click()).toBe(true)
    // 下一行本来有内容 → 中间插入新空行，光标在新行里；旧内容原样下移
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(1).textContent).toBe('')
    expect(ed.state.selection.node).toBe(undefined) // 没进"待删"选中态
    expect(ed.state.selection.$from.parent).toBe(ed.state.doc.child(1))
    expect(ed.getText()).toContain('写了点东西')
    // 连点不堆空行：下一行已是空行时直接落进去
    expect(click()).toBe(true)
    expect(ed.state.doc.childCount).toBe(3)
    ed.destroy()
  })

  it('值冻在 attrs 里，不是渲染时现算的「今天」', () => {
    const ed = editor()
    let found = null
    ed.state.doc.descendants((n) => { if (n.type.name === 'dateStamp') found = n })
    // 关键：读回来的还是当初写进去的那一天，和「现在几号」无关。
    expect(found.attrs.label).toBe('8月9日 周日')
    expect(found.attrs.at).toBe(AT)
    ed.destroy()
  })

  it('存进库的纯文本里有日期 —— 否则搜不到自己哪天写的', () => {
    // docJsonToText 走的是无界面转换器；转换器的扩展集必须和 DocEditor 对齐，
    // 漏注册 DateStamp 的话这一段会整个消失（这正是这条测试要拦的回归）。
    expect(docJsonToText(DOC)).toContain('8月9日 周日')
  })

  it('导出 Markdown 时不会凭空消失', () => {
    expect(docJsonToMarkdown(DOC)).toContain('8月9日 周日')
  })
})
