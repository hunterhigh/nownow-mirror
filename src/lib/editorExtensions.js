import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
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
import { DateStamp } from '../components/DateStamp'
import { PrivateBlock } from './privateBlock'

const lowlight = createLowlight(common)

// DocEditor 与 Markdown 转换器共享可携带的文档 schema。调用方只替换
// UI 相关的 Link/Image 实现，再追加 Suggestion、Placeholder 等交互扩展。
export function createPortableEditorExtensions({
  starterKitOptions = {},
  linkExtension = Link,
  imageExtension = Image,
} = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      link: false,
      ...starterKitOptions,
    }),
    linkExtension,
    CodeBlockLowlight.configure({ lowlight }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    imageExtension,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    DateStamp,
    PrivateBlock,
  ]
}
