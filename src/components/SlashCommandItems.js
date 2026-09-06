import {
  CalendarDays,
  CheckSquare,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Info,
  List,
  ListOrdered,
  Lock,
  Minus,
  Quote,
  Table as TableIcon,
} from 'lucide-react'
import { periodHeader } from '../lib/period'
import { toggleBlockPrivate } from '../lib/privateBlock'

export function createSlashCommandItems({
  privacyEnabled = true,
  openImagePicker,
  openMarkdownPicker,
  now = () => new Date(),
} = {}) {
  const items = [
    { title: '待办清单', icon: CheckSquare, kw: 'todo task daiban 待办 清单', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
    {
      title: '当前时间',
      icon: CalendarDays,
      kw: 'date time 时间 日期 今天 today shijian riqi',
      command: ({ editor, range }) => {
        const at = now()
        return editor.chain().focus().deleteRange(range).insertContent([
          { type: 'dateStamp', attrs: { at: at.toISOString(), label: periodHeader('today', 0, at) } },
          { type: 'paragraph' },
        ]).run()
      },
    },
    { title: '标题 1', icon: Heading1, kw: 'h1 标题 title', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
    { title: '标题 2', icon: Heading2, kw: 'h2 标题', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
    { title: '标题 3', icon: Heading3, kw: 'h3 标题', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
    { title: '项目符号', icon: List, kw: 'bullet list 列表 符号', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { title: '编号列表', icon: ListOrdered, kw: 'number ordered 编号', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  ]

  if (privacyEnabled) {
    items.push({
      title: '设为隐私',
      icon: Lock,
      kw: 'private 隐私 simi lock 锁',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        toggleBlockPrivate(editor)
      },
    })
  }

  return [
    ...items,
    { title: '引用', icon: Quote, kw: 'quote 引用', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
    { title: '代码块', icon: Code, kw: 'code 代码', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
    { title: '分割线', icon: Minus, kw: 'divider hr 分割 线', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
    { title: '表格', icon: TableIcon, kw: 'table 表格', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: '提示块', icon: Info, kw: 'callout 提示 info 块', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCallout().run() },
    {
      title: '图片',
      icon: ImageIcon,
      kw: 'image 图片 picture',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        openImagePicker?.()
      },
    },
    {
      title: '导入 Markdown',
      icon: FileText,
      kw: 'markdown md import 导入 文件',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        openMarkdownPicker?.()
      },
    },
  ]
}

export function filterSlashCommandItems(items, query) {
  const normalized = String(query || '').toLowerCase()
  if (!normalized) return items
  return items.filter((item) =>
    item.title.toLowerCase().includes(normalized) || item.kw.toLowerCase().includes(normalized))
}
