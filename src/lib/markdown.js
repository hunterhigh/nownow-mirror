// Tiptap 文档 JSON ⇆ Markdown：用现成的 tiptap-markdown。
// 用一个无界面（headless）的 Editor 做转换器，扩展集对齐 DocEditor 的节点类型，保证导出保真。
// 给设置里的「导出我的数据（Markdown）」用。
// markdownToDocJson 目前没有调用方 —— 导入功能已从设置里撤掉，函数留着，
// 想恢复导入时不用重写解析器（未被引用，不会打进产物）。
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Callout } from '../components/Callout'
import { PrivateBlock } from './privateBlock'
import { Markdown } from 'tiptap-markdown'

const lowlight = createLowlight(common)

let _editor = null
function converter() {
  if (!_editor) {
    _editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
        CodeBlockLowlight.configure({ lowlight }),
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Mention,
        Callout,
        PrivateBlock,
        Markdown,
      ],
    })
  }
  return _editor
}

// Tiptap JSON → Markdown 字符串
export function docJsonToMarkdown(json) {
  if (!json) return ''
  const ed = converter()
  ed.commands.setContent(json)
  return ed.storage.markdown.getMarkdown()
}

// Markdown 字符串 → Tiptap JSON
export function markdownToDocJson(md) {
  const ed = converter()
  ed.commands.setContent(md || '')
  return ed.getJSON()
}

// Tiptap JSON → 纯文本（落库 text 列 / 空判定用）
export function docJsonToText(json) {
  if (!json) return ''
  const ed = converter()
  ed.commands.setContent(json)
  return ed.getText()
}
