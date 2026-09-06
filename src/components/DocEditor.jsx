import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { ResizableImage } from './ResizableImage'
import BlockHandle from './BlockHandle'
import CarryHandle from './CarryHandle'
import { allowSuggestionCommand, SlashCommand } from './SlashCommand'
import { createSlashCommandItems, filterSlashCommandItems } from './SlashCommandItems'
import { Bold, CheckSquare, ChevronDown, Highlighter, Italic, List, ListOrdered, Lock, Quote, Strikethrough, Underline as UnderlineIcon, Unlock } from 'lucide-react'
import { uploadImage } from '../lib/storage'
import { setUploadProgress, clearUploadProgress } from '../lib/uploadProgress'
import { PrivateBlockLock, toggleBlockPrivate, isBlockPrivate } from '../lib/privateBlock'
import { createMarkdownExtension, docJsonToText, markdownToDocJson } from '../lib/markdown'
import { pasteLiteralText } from '../lib/editorClipboard'
import { newMentionId } from '../lib/mentionIds'
import { createPortableEditorExtensions } from '../lib/editorExtensions'
import { MarkdownInputRules } from './MarkdownInputRules'

// 隐私 🔒 总开关：必须等数据侧把 docs/版本历史 SELECT 锁成 owner-only（migration-020 STEP 2）后再开。
// false 时悬浮条显示原来的「引用」按钮、没人能标私密（后端隔离可以先部署、纯打底、无泄露窗口）。
// true 时显示 🔒、可标私密——只在「表已锁」之后翻 true 再部署。
const PRIVACY_ENABLED = true
import './doc-editor.css'

const TEXT_COLORS = [
  { name: '墨', value: '#29332d' },
  { name: '朱砂', value: '#57251f' },
  { name: '黛蓝', value: '#1d3446' },
  { name: '竹青', value: '#263b2e' },
  { name: '茶褐', value: '#463127' },
  { name: '梅紫', value: '#4b2c39' },
]
const HL_COLORS = [
  { name: '月白', value: '#d8d5c7' },
  { name: '竹青', value: '#aec2aa' },
  { name: '薄柿', value: '#ead7ce' },
  { name: '枯草', value: '#d5c99e' },
  { name: '薄缥', value: '#c7d4dd' },
  { name: '梅鼠', value: '#d8c5cc' },
]

// 给 mention 节点加一个稳定唯一的 mid（插入时生成），让「每个 @ = 一条独立通知/任务」：
// syncDocMentions 按 mid 存 doc_mentions，同一人被 @ 多次也各算各的、各自有 snippet。
const MentionWithId = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-mid') || newMentionId(), // HTML 粘贴的老 mention 没有就现生成
        renderHTML: (attrs) => (attrs.mid ? { 'data-mid': attrs.mid } : {}),
      },
    }
  },
})
// 插图：先用本地预览秒显（不等上传），后台传 Storage，传完把 src 换成公网地址。
function insertImageFromFile(view, file, uploaderId) {
  const localUrl = URL.createObjectURL(file)
  const { schema } = view.state
  const node = schema.nodes.image.create({ src: localUrl })
  // 插入图片后把光标落到图片后面（图片在末尾就补个空段落），这样能直接接着打字，
  // 不会卡在图片的 NodeSelection 上（之前要点别处/刷新才能编辑就是这个）。
  let tr = view.state.tr.replaceSelectionWith(node)
  const after = tr.selection.to
  if (!tr.doc.resolve(after).nodeAfter) tr = tr.insert(after, schema.nodes.paragraph.create())
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  setUploadProgress(localUrl, 0) // 右上角上传圈起步（ResizableImage 按这个 blob src 订阅）
  uploadImage(file, uploaderId, (p) => setUploadProgress(localUrl, p))
    .then((url) => {
      let pos = null
      view.state.doc.descendants((n, p) => {
        if (n.type.name === 'image' && n.attrs.src === localUrl) { pos = p; return false }
      })
      if (pos != null) {
        const attrs = { ...view.state.doc.nodeAt(pos).attrs, src: url }
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs))
      }
      clearUploadProgress(localUrl)
      URL.revokeObjectURL(localUrl)
    })
    .catch((e) => {
      console.error('图片上传失败', e)
      // 之前上传失败是静默的：图片只剩本地预览，刷新后变坏图、用户却以为存上了。
      // 现在删掉这张没传上的预览图 + 明确告诉用户，免得悄悄丢图。
      let pos = null
      view.state.doc.descendants((n, p) => {
        if (n.type.name === 'image' && n.attrs.src === localUrl) { pos = p; return false }
      })
      if (pos != null) view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos).nodeSize))
      clearUploadProgress(localUrl)
      URL.revokeObjectURL(localUrl)
      alert('图片上传失败，这张图没存上，请重试。')
    })
}

// P0：Tiptap 单人版文档内核。替代「每行一个 entry + textarea」的旧模型——
// 整页就是一份 ProseMirror 文档。markdown 输入规则、行内格式、悬浮工具条都走原生扩展。
// content 进：ProseMirror JSON（或空）；out：onChange({ json, text }) —— json 落库、text 喂搜索/RLS。
// @提及、图片与导入已叠加；Yjs／同篇实时协作仍等明确团队需求出现后再做。
export default function DocEditor({ content, onChange, onCreateImportedDocument, placeholder = '写点什么…', editable = true, profiles = [], mentionFreq = {}, uploaderId, fill = false, onCarry }) {
  // @ 弹选：suggestion 的 items/onKeyDown 需读最新 profiles/选中态 → 用 ref 兜
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  // 我 @ 各人的次数 {id: count}，给选择框「常用靠前」排序用（ref 兜，items 闭包读最新）
  const freqRef = useRef(mentionFreq)
  freqRef.current = mentionFreq
  // 我派的 @ 完成态 {mid: 已完成bool}，给文档里 @ 人名上色（黄=已完成/蓝=未完成）。ref 兜，decoration 闭包读最新。
  const [sug, setSug] = useState(null) // { items, rect, command, index } | null
  const sugRef = useRef(null)
  sugRef.current = sug
  // Slash `/` 菜单
  const [slash, setSlash] = useState(null)
  const slashRef = useRef(null)
  slashRef.current = slash
  const fileInputRef = useRef(null)
  const markdownFileInputRef = useRef(null)
  const markdownCreateButtonRef = useRef(null)
  const [markdownNotice, setMarkdownNotice] = useState('')
  const [pendingMarkdownImport, setPendingMarkdownImport] = useState(null)
  const [markdownImporting, setMarkdownImporting] = useState(false)
  const [markdownImportError, setMarkdownImportError] = useState('')
  const [colorPanel, setColorPanel] = useState(false) // 选区工具条里「A」颜色面板展开态（飞书式整合）
  const [, forceTick] = useState(0) // 选区变化时强制重渲，让悬浮条按钮（如锁 🔒/🔓）跟住当前块状态

  const slashItems = createSlashCommandItems({
    privacyEnabled: PRIVACY_ENABLED,
    openImagePicker: () => fileInputRef.current?.click(),
    openMarkdownPicker: () => markdownFileInputRef.current?.click(),
  })

  const editor = useEditor({
    editable,
    extensions: [
      ...createPortableEditorExtensions({
        starterKitOptions: { dropcursor: { color: '#2563eb', width: 3, class: 'doc-dropcursor' } },
        // 链接末尾继续打字必须回到普通文字；可编辑时普通点击留给光标，Cmd/Ctrl+点才打开。
        linkExtension: Link.extend({ inclusive: () => false }).configure({ openOnClick: false }),
        imageExtension: ResizableImage,
      }),
      // Markdown 是编辑器的输入/剪贴板协议，doc_json 仍是真源。普通粘贴可解析
      // Markdown，Cmd/Ctrl+Shift+V 仍由下方快捷键强制走纯文本。
      createMarkdownExtension({ transformPastedText: true, transformCopiedText: true }),
      PrivateBlockLock, // 私密块右上角可点的解锁角标（widget）
      MarkdownInputRules,
      // 块拖拽抓手改用官方 @tiptap/extension-drag-handle-react（见下方 JSX 的 <BlockHandle/>），
      // 不再走自维护 fork——官方版和 PM 的文本选择/dropcursor/拖进列表配套，IME 安全。
      SlashCommand.configure({
        suggestion: {
          // 中文 IME composition 期间 `/` 可能只是候选输入的一部分，绝不能弹菜单抢焦点。
          allow: allowSuggestionCommand,
          items: ({ query }) => {
            return filterSlashCommandItems(slashItems, query)
          },
          render: () => ({
            onStart: (props) => setSlash({ items: props.items, rect: props.clientRect?.(), command: props.command, index: 0 }),
            onUpdate: (props) => setSlash((s) => (s ? { ...s, items: props.items, rect: props.clientRect?.(), command: props.command, index: 0 } : null)),
            onKeyDown: (props) => {
              if (props.event.isComposing) return false
              const s = slashRef.current
              if (!s || !s.items.length) return false
              if (props.event.key === 'ArrowDown') { setSlash((x) => ({ ...x, index: (x.index + 1) % x.items.length })); return true }
              if (props.event.key === 'ArrowUp') { setSlash((x) => ({ ...x, index: (x.index - 1 + x.items.length) % x.items.length })); return true }
              if (props.event.key === 'Enter') { const it = s.items[s.index]; if (it) s.command(it); return true }
              if (props.event.key === 'Escape') { setSlash(null); return true }
              return false
            },
            onExit: () => setSlash(null),
          }),
        },
      }),
      Placeholder.configure({ placeholder }),
      MentionWithId.configure({
        HTMLAttributes: { class: 'doc-mention' },
        suggestion: {
          char: '@',
          allow: allowSuggestionCommand,
          // 默认要求 @ 前面是空格/行首 → 「测试@名字」这种紧贴前字的就不触发。null = 任意位置都能 @
          allowedPrefixes: null,
          items: ({ query }) => {
            const q = query.toLowerCase()
            const freq = freqRef.current
            // filter 返回新数组，sort 不动 profiles。stable sort：次数降序，并列保持原顺序(按 handle)。
            return profilesRef.current
              .filter((p) => p.handle?.toLowerCase().includes(q) || p.display_name?.toLowerCase().includes(q))
              .sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0))
              .slice(0, 50)
          },
          render: () => ({
            onStart: (props) => setSug({ items: props.items, rect: props.clientRect?.(), command: props.command, index: 0 }),
            onUpdate: (props) =>
              setSug((s) => (s ? { ...s, items: props.items, rect: props.clientRect?.(), command: props.command, index: 0 } : null)),
            onKeyDown: (props) => {
              if (props.event.isComposing) return false
              const s = sugRef.current
              if (!s || !s.items.length) return false
              if (props.event.key === 'ArrowDown') { setSug((x) => ({ ...x, index: (x.index + 1) % x.items.length })); return true }
              if (props.event.key === 'ArrowUp') { setSug((x) => ({ ...x, index: (x.index - 1 + x.items.length) % x.items.length })); return true }
              if (props.event.key === 'Enter') { const it = s.items[s.index]; if (it) s.command({ id: it.id, label: it.display_name, mid: newMentionId() }); return true }
              if (props.event.key === 'Escape') { setSug(null); return true }
              return false
            },
            onExit: () => setSug(null),
          }),
        },
      }),
    ],
    content: content ?? '',
    editorProps: {
      attributes: { class: 'doc-prose outline-none' },
      // Cmd/Ctrl+Shift+V = 去格式粘贴（飞书式）：读剪贴板纯文本插入，丢掉所有格式
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyV') {
          event.preventDefault()
          navigator.clipboard?.readText?.().then((text) => { if (text) pasteLiteralText(view, text) }).catch(() => {})
          return true
        }
        return false
      },
      // 点击链接打开（和图片同一套）：只读页 普通点就开；可编辑页 Cmd/Ctrl+点开、普通点留给放光标编辑。
      handleClick: (view, pos, event) => {
        const a = event.target?.closest?.('a')
        if (!a?.href) return false
        if (!editable || event.metaKey || event.ctrlKey) {
          window.open(a.href, '_blank', 'noopener,noreferrer')
          return true
        }
        return false
      },
      // 粘贴/拖拽图片 → 传 Storage → 插入（只在可写 + 有 uploaderId 时）
      handlePaste: (view, event) => {
        if (!editable || !uploaderId) return false
        const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
        if (!file) return false
        event.preventDefault()
        insertImageFromFile(view, file, uploaderId)
        return true
      },
      handleDrop: (view, event) => {
        if (!editable || !uploaderId) return false
        const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'))
        if (!file) return false
        event.preventDefault()
        insertImageFromFile(view, file, uploaderId)
        return true
      },
    },
    // 老文档（本次部署前的 @）从 JSON 加载时 mention 没有 mid（parseHTML 不走 JSON）。
    // 加载后扫一遍，给缺 mid 的 mention 补上 → 自动保存持久化 → sync 全程不见 null、prune 不误删。
    onCreate: ({ editor }) => {
      if (!editor.isEditable) return
      let tr = editor.state.tr
      let changed = false
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && !node.attrs.mid) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, mid: newMentionId() })
          changed = true
        }
      })
      if (changed) editor.view.dispatch(tr.setMeta('addToHistory', false))
    },
    // P0-3 数据安全：只把「用户真编辑」的更新落库，过滤掉加载/程序性触发。
    // 今天数据丢失的触发类 = 加载成空/程序性变更触发了 autosave，把真内容覆盖。
    // 跳过：① 非文档变更（光标/重配置）② addToHistory:false 的程序性事务（如加载后的 mid 回填）。
    // 用户打字/粘贴/拖块/Slash/插图等都是 addToHistory 默认 true 的真编辑 → 照常存。
    onUpdate: ({ editor, transaction }) => {
      if (!transaction?.docChanged) return
      if (transaction.getMeta('addToHistory') === false) return
      onChange?.({ json: editor.getJSON(), text: editor.getText() })
    },
    // 选区移动时重渲 → 悬浮条的锁按钮 isBlockPrivate 跟住当前块（未锁=🔒、已锁=🔓），不再卡在某个状态
    onSelectionUpdate: () => forceTick((t) => t + 1),
  })

  // editable 是建编辑器时定的；prop 变了（如 isMyPage 在 profiles/页面状态稳定后才变 true）
  // 要同步给已存在的编辑器，否则会卡在只读、得刷新页面才能编辑。
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    if (!pendingMarkdownImport) return undefined
    const frame = window.requestAnimationFrame(() => markdownCreateButtonRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [pendingMarkdownImport])


  if (!editor) return null

  async function prepareMarkdownImport(file) {
    setMarkdownNotice('')
    setMarkdownImportError('')
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setMarkdownNotice('Markdown 文件不能超过 2 MB')
      return
    }
    try {
      const markdown = await file.text()
      const imported = markdownToDocJson(markdown)
      const content = imported?.content || []
      if (!content.length) {
        setMarkdownNotice('这个 Markdown 文件没有可导入的内容')
        return
      }
      // 只准备预览，用户确认前不触碰当前文档。
      setPendingMarkdownImport({
        fileName: file.name,
        json: imported,
        content,
        text: docJsonToText(imported),
        preview: docJsonToText(imported).trim().slice(0, 400),
      })
    } catch (error) {
      console.error('Markdown 导入失败', error)
      setMarkdownNotice('Markdown 导入失败，原文档没有被覆盖')
    }
  }

  function confirmMarkdownImport() {
    if (!pendingMarkdownImport) return
    // 明确选择“追加导入”后才写入；一次 transaction 可一次 Undo。
    editor.chain().focus().insertContent(pendingMarkdownImport.content).run()
    setMarkdownNotice(`已导入 ${pendingMarkdownImport.fileName}`)
    setPendingMarkdownImport(null)
    setTimeout(() => setMarkdownNotice(''), 2400)
  }

  async function createMarkdownImportDocument() {
    if (!pendingMarkdownImport || !onCreateImportedDocument || markdownImporting) return
    setMarkdownImporting(true)
    setMarkdownNotice('')
    setMarkdownImportError('')
    try {
      const created = await onCreateImportedDocument({
        fileName: pendingMarkdownImport.fileName,
        json: pendingMarkdownImport.json,
        text: pendingMarkdownImport.text,
      })
      setPendingMarkdownImport(null)
      const pendingSync = created?.syncState === 'offline' || created?.syncState === 'error'
      setMarkdownNotice(pendingSync
        ? `已新建「${created.title}」，内容保留在本地等待同步`
        : `已新建「${created?.title || pendingMarkdownImport.fileName}」`)
      setTimeout(() => setMarkdownNotice(''), 3200)
    } catch (error) {
      setMarkdownImportError(error?.message || '新建文档失败，原文档没有被修改')
    } finally {
      setMarkdownImporting(false)
    }
  }

  const tb = [
    { icon: Bold, run: () => editor.chain().focus().toggleBold().run(), on: editor.isActive('bold'), title: '加粗' },
    { icon: Italic, run: () => editor.chain().focus().toggleItalic().run(), on: editor.isActive('italic'), title: '斜体' },
    { icon: UnderlineIcon, run: () => editor.chain().focus().toggleUnderline().run(), on: editor.isActive('underline'), title: '下划线' },
    { icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run(), on: editor.isActive('strike'), title: '删除线' },
    { icon: Highlighter, run: () => editor.chain().focus().toggleHighlight().run(), on: editor.isActive('highlight'), title: '高亮' },
    { sep: true },
    { icon: CheckSquare, run: () => editor.chain().focus().toggleTaskList().run(), on: editor.isActive('taskList'), title: '待办' },
    { icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run(), on: editor.isActive('orderedList'), title: '有序列表' },
    { icon: List, run: () => editor.chain().focus().toggleBulletList().run(), on: editor.isActive('bulletList'), title: '无序列表' },
    PRIVACY_ENABLED
      // 锁定态切换：未私密=🔒(点击设私密)、已私密=🔓解锁(点击取消)，和内容块那个锁同一套
      ? { icon: isBlockPrivate(editor) ? Unlock : Lock, run: () => toggleBlockPrivate(editor), on: isBlockPrivate(editor), title: isBlockPrivate(editor) ? '取消私密' : '设为私密 · 只自己可见' }
      : { icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run(), on: editor.isActive('blockquote'), title: '引用' },
  ]

  return (
    <div
      className={'doc-editor' + (fill ? ' doc-editor-fill' : '')}
      onMouseDown={(e) => {
        // 点编辑器下方铺满的空白区 → 聚焦 + 光标落到末尾，点任意位置都能编辑。
        // 只接管「纯空白」：点正文、工具条按钮、菜单、链接都放过，免得抢了选区/按钮交互。
        if (!fill || !editor) return
        if (e.target.closest('.ProseMirror, button, a, input, [role="menu"], .doc-block-menu')) return
        e.preventDefault()
        editor.commands.focus('end')
      }}
    >
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state }) => {
          if (!editor.isEditable) return false
          // 选中图片(NodeSelection)时不弹文字气泡，交给图片自己的工具条
          if (editor.isActive('image')) return false
          // 时间戳（含"待删"选中态）也不弹：它不接受任何格式，
          // 弹一排全都不适用的按钮只会诱导误操作（真正挡格式的是 DateStamp 里的插件）
          if (editor.isActive('dateStamp')) return false
          return !state.selection.empty
        }}
        className="flex items-center gap-0.5 rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-1 text-stone-600 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
      >
        {tb.map((b, i) =>
          b.sep ? (
            <span key={i} className="mx-0.5 h-4 w-px bg-stone-200" />
          ) : (
            <button
              key={i}
              type="button"
              title={b.title}
              onClick={b.run}
              className={'flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-100 hover:text-stone-900 ' + (b.on ? 'bg-stone-200 text-stone-900' : '')}
            >
              <b.icon size={15} strokeWidth={2.2} />
            </button>
          ),
        )}
        <span className="mx-0.5 h-4 w-px bg-stone-200" />
        {/* 颜色：整合成一个「A」按钮 + 下拉面板（飞书式，不再平铺所有色块）*/}
        <span className="relative">
          <button
            type="button"
            title="字体 / 背景颜色" aria-label="字体 / 背景颜色"
            onMouseDown={(e) => { e.preventDefault(); setColorPanel((v) => !v) }}
            className={'flex h-7 items-center gap-0.5 rounded-md px-1 hover:bg-stone-100 hover:text-stone-900 ' + (colorPanel ? 'bg-stone-200 text-stone-900' : '')}
          >
            <span className="text-[13px] font-bold leading-none">A</span>
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
          {colorPanel && (
            <div
              className="absolute left-0 top-full z-50 mt-1.5 w-52 rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.1)]"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="mb-1.5 text-[11px] text-stone-400">字体颜色</div>
              <div className="flex flex-wrap gap-1">
                <button type="button" title="默认" aria-label="默认" onClick={() => editor.chain().focus().unsetColor().run()} className="flex h-6 w-6 items-center justify-center rounded-md border border-stone-200 hover:bg-stone-100">
                  <span className="text-[13px] font-bold leading-none text-[var(--ink)]">A</span>
                </button>
                {TEXT_COLORS.map((c) => (
                  <button key={'t' + c.value} type="button" title={c.name} aria-label={c.name} onClick={() => editor.chain().focus().setColor(c.value).run()} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-stone-100">
                    <span className="text-[13px] font-bold leading-none" style={{ color: c.value }}>A</span>
                  </button>
                ))}
              </div>
              <div className="mb-1.5 mt-2.5 text-[11px] text-stone-400">背景颜色</div>
              <div className="flex flex-wrap gap-1">
                <button type="button" title="无" aria-label="无" onClick={() => editor.chain().focus().unsetHighlight().run()} className="flex h-6 w-6 items-center justify-center rounded-md border border-stone-200 hover:bg-stone-100">
                  <span className="text-[12px] leading-none text-stone-300">/</span>
                </button>
                {HL_COLORS.map((c) => (
                  <button key={'h' + c.value} type="button" title={c.name} aria-label={c.name} onClick={() => editor.chain().focus().toggleHighlight({ color: c.value }).run()} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-stone-100">
                    <span className="h-4 w-4 rounded" style={{ background: c.value }} />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()} className="mt-2.5 w-full rounded-md border border-stone-200 py-1 text-[12px] text-stone-500 hover:bg-stone-100">
                恢复默认
              </button>
            </div>
          )}
        </span>
      </BubbleMenu>
      {editor && editable && <BlockHandle editor={editor} />}
      {editor && editable && onCarry && <CarryHandle editor={editor} onCarry={onCarry} />}
      <EditorContent editor={editor} />
      {sug && sug.items.length > 0 && sug.rect && (
        <div
          className="fixed z-50 max-h-64 w-36 overflow-y-auto rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
          style={{ left: sug.rect.left, top: sug.rect.bottom + 4 }}
        >
          {sug.items.map((p, i) => (
            <button
              key={p.id}
              type="button"
              // 键盘上下选中时把当前项滚进视野（人多时下方项不再被裁掉；可见则 no-op）
              ref={(el) => { if (i === sug.index && el) el.scrollIntoView({ block: 'nearest' }) }}
              onMouseEnter={() => setSug((s) => (s ? { ...s, index: i } : s))}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); sug.command({ id: p.id, label: p.display_name, mid: newMentionId() }) }}
              className={
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ' +
                (i === sug.index ? 'bg-blue-50 text-blue-700' : 'text-stone-700')
              }
            >
              <span className="font-medium">{p.display_name}</span>
            </button>
          ))}
        </div>
      )}
      {slash && slash.items.length > 0 && slash.rect && (
        <div
          className="fixed z-50 max-h-72 w-52 overflow-auto rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
          style={{ left: slash.rect.left, top: slash.rect.bottom + 4 }}
        >
          {slash.items.map((it, i) => (
            <button
              key={it.title}
              type="button"
              onMouseEnter={() => setSlash((s) => (s ? { ...s, index: i } : s))}
              onMouseDown={(e) => { e.preventDefault(); slash.command(it) }}
              className={
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ' +
                (i === slash.index ? 'bg-blue-50 text-blue-700' : 'text-stone-700')
              }
            >
              <it.icon size={15} strokeWidth={2} />
              <span>{it.title}</span>
            </button>
          ))}
        </div>
      )}
      {markdownNotice && (
        <div role="status" className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-stone-200 bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-stone-600 shadow-sm">
          {markdownNotice}
        </div>
      )}
      {pendingMarkdownImport && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="markdown-import-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !markdownImporting) setPendingMarkdownImport(null)
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-[var(--surface-elevated)] p-4 text-stone-700 shadow-xl">
            <h3 id="markdown-import-title" className="font-medium text-stone-900">导入 Markdown</h3>
            <p className="mt-2 text-sm">{pendingMarkdownImport.fileName} · {pendingMarkdownImport.content.length} 个顶层块</p>
            {pendingMarkdownImport.preview && (
              <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-2 text-xs leading-5 text-stone-600">{pendingMarkdownImport.preview}</pre>
            )}
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-stone-500">
              <li>默认以文件名新建独立工作文档，不修改当前内容</li>
              <li>也可明确选择追加到当前光标，并用一次撤销移除</li>
              <li>外部或相对图片链接按原地址保留，不自动上传</li>
            </ul>
            {markdownImportError && (
              <p role="alert" className="mt-3 rounded-md bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-700">
                {markdownImportError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={markdownImporting} onClick={() => setPendingMarkdownImport(null)} className="rounded-md px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 disabled:opacity-40">取消</button>
              <button type="button" disabled={markdownImporting} onClick={confirmMarkdownImport} className="rounded-md border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-40">追加到当前</button>
              <button
                ref={markdownCreateButtonRef}
                type="button"
                disabled={markdownImporting || !onCreateImportedDocument}
                onClick={createMarkdownImportDocument}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  createMarkdownImportDocument()
                }}
                className="rounded-md bg-[var(--btn-bg)] px-3 py-1.5 text-sm text-[var(--btn-fg)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-40"
              >
                {markdownImporting ? '正在新建…' : '新建文档'}
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && uploaderId) insertImageFromFile(editor.view, file, uploaderId)
          e.target.value = ''
        }}
      />
      <input
        ref={markdownFileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          prepareMarkdownImport(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
