// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createPortableEditorExtensions } from '../src/lib/editorExtensions'
import { MarkdownInputRules } from '../src/components/MarkdownInputRules'
import { createSlashCommandItems, filterSlashCommandItems } from '../src/components/SlashCommandItems'

const TRIGGER = '/x'
const TRIGGER_RANGE = { from: 1, to: 3 }
const FIXED_DATE = new Date('2026-09-06T04:05:06.000Z')

let editor

if (!window.Range.prototype.getClientRects) {
  window.Range.prototype.getClientRects = () => []
}
if (!window.Range.prototype.getBoundingClientRect) {
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect()
}

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.replaceChildren()
})

function createEditor() {
  editor = new Editor({
    extensions: [
      ...createPortableEditorExtensions(),
      MarkdownInputRules,
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: TRIGGER }] }],
    },
  })
  document.body.appendChild(editor.view.dom)
  editor.commands.setTextSelection(TRIGGER_RANGE.to)
  return editor
}

function createItems(options = {}) {
  return createSlashCommandItems({ now: () => FIXED_DATE, ...options })
}

function runCommand(title, options) {
  const ed = createEditor()
  const item = createItems(options).find((candidate) => candidate.title === title)
  expect(item, `missing Slash command: ${title}`).toBeTruthy()
  item.command({ editor: ed, range: TRIGGER_RANGE })
  return ed
}

function waitForFocusFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve))
}

describe('Slash command registry', () => {
  it('keeps the approved command order and searchable metadata', () => {
    const items = createItems()

    expect(items.map((item) => item.title)).toEqual([
      '待办清单',
      '当前时间',
      '标题 1',
      '标题 2',
      '标题 3',
      '项目符号',
      '编号列表',
      '设为隐私',
      '引用',
      '代码块',
      '分割线',
      '表格',
      '提示块',
      '图片',
      '导入 Markdown',
    ])
    for (const item of items) {
      expect(item.icon).toBeTruthy()
      expect(item.kw.trim().length).toBeGreaterThan(0)
      expect(item.command).toBeTypeOf('function')
    }
  })

  it('can exclude the private command without changing the remaining order', () => {
    const full = createItems()
    const withoutPrivate = createItems({ privacyEnabled: false })

    expect(withoutPrivate.some((item) => item.title === '设为隐私')).toBe(false)
    expect(withoutPrivate.map((item) => item.title)).toEqual(
      full.filter((item) => item.title !== '设为隐私').map((item) => item.title),
    )
  })

  it.each([
    ['h2', ['标题 2']],
    ['TABLE', ['表格']],
    ['导入', ['导入 Markdown']],
    ['simi', ['设为隐私']],
    [' h2', []],
  ])('filters %s against both titles and keywords', (query, expected) => {
    expect(filterSlashCommandItems(createItems(), query).map((item) => item.title)).toEqual(expected)
  })

  it.each([
    ['待办清单', 'taskList', {}],
    ['标题 1', 'heading', { level: 1 }],
    ['标题 2', 'heading', { level: 2 }],
    ['标题 3', 'heading', { level: 3 }],
    ['项目符号', 'bulletList', {}],
    ['编号列表', 'orderedList', { start: 1 }],
    ['设为隐私', 'paragraph', { private: true }],
    ['引用', 'blockquote', {}],
    ['代码块', 'codeBlock', {}],
    ['分割线', 'horizontalRule', {}],
    ['表格', 'table', {}],
    ['提示块', 'callout', { kind: 'note' }],
  ])('%s creates a semantic %s node, focuses the editor, and restores the trigger with one undo', async (title, type, attrs) => {
    const ed = runCommand(title)
    const firstNode = ed.getJSON().content[0]

    expect(firstNode.type).toBe(type)
    expect(firstNode.attrs || {}).toMatchObject(attrs)
    await waitForFocusFrame()
    expect(ed.view.hasFocus()).toBe(true)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toContain(TRIGGER)
  })

  it('freezes the current date at command execution and restores the trigger with one undo', async () => {
    const ed = runCommand('当前时间')
    const stamp = ed.getJSON().content[0]

    expect(stamp.type).toBe('dateStamp')
    expect(stamp.attrs.at).toBe(FIXED_DATE.toISOString())
    expect(stamp.attrs.label).toBeTruthy()
    await waitForFocusFrame()
    expect(ed.view.hasFocus()).toBe(true)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toContain(TRIGGER)
  })

  it.each([
    ['图片', 'openImagePicker'],
    ['导入 Markdown', 'openMarkdownPicker'],
  ])('%s deletes the trigger, focuses the editor, opens its picker, and remains one-step undoable', async (title, callbackName) => {
    const callbacks = {
      openImagePicker: vi.fn(),
      openMarkdownPicker: vi.fn(),
    }
    const ed = runCommand(title, callbacks)

    expect(ed.getText()).not.toContain(TRIGGER)
    expect(callbacks[callbackName]).toHaveBeenCalledOnce()
    await waitForFocusFrame()
    expect(ed.view.hasFocus()).toBe(true)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toContain(TRIGGER)
  })
})
