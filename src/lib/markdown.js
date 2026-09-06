// Tiptap 文档 JSON ⇆ Markdown：用现成的 tiptap-markdown。
// 用一个无界面（headless）的 Editor 做转换器，扩展集对齐 DocEditor 的节点类型，保证导出保真。
// 给设置里的「导出我的数据（Markdown）」用。
// DocEditor 的 Markdown 文件导入和往返测试共用这里，避免 UI 自建解析规则。
import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import { Markdown } from 'tiptap-markdown'
import { ensureMentionIds } from './mentionIds'
import { createPortableEditorExtensions } from './editorExtensions'

// DocEditor 和 headless 转换器共享同一组 Markdown 选项，避免输入、粘贴、导出
// 各走一套规则。交互编辑器只需覆写 clipboard 开关。
export const MARKDOWN_OPTIONS = Object.freeze({
  html: true,
  tightLists: true,
  bulletListMarker: '-',
  linkify: false,
  breaks: false,
  transformPastedText: false,
  transformCopiedText: false,
})

export function createMarkdownExtension(overrides = {}) {
  return Markdown.configure({ ...MARKDOWN_OPTIONS, ...overrides })
}

let _editor = null
function converter() {
  if (!_editor) {
    _editor = new Editor({
      extensions: [
        ...createPortableEditorExtensions({ imageExtension: Image }),
        Mention,
        createMarkdownExtension(),
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
  return ensureMentionIds(ed.getJSON())
}

// Tiptap JSON → 纯文本（落库 text 列 / 空判定用）
export function docJsonToText(json) {
  if (!json) return ''
  const ed = converter()
  ed.commands.setContent(json)
  return ed.getText()
}
