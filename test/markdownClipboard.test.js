// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createMarkdownExtension } from '../src/lib/markdown'
import { allowSuggestionCommand } from '../src/components/SlashCommand'
import { pasteLiteralText } from '../src/lib/editorClipboard'
import { createPortableEditorExtensions } from '../src/lib/editorExtensions'
import { MarkdownInputRules } from '../src/components/MarkdownInputRules'

let editor

afterEach(() => {
  editor?.destroy()
  editor = null
})

function createEditor(initialText = '') {
  editor = new Editor({
    extensions: [
      ...createPortableEditorExtensions(),
      MarkdownInputRules,
      createMarkdownExtension({ transformPastedText: true, transformCopiedText: true }),
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: initialText ? [{ type: 'text', text: initialText }] : undefined }],
    },
  })
  return editor
}

function applyFinalTypedCharacter(ed, character) {
  ed.commands.setTextSelection(ed.state.doc.content.size)
  let handled = false
  ed.view.someProp('handleTextInput', (handler) => {
    const { from, to } = ed.state.selection
    if (handler(ed.view, from, to, character)) {
      handled = true
      return true
    }
  })
  return handled
}

function typeCharacters(ed, text) {
  for (const character of text) {
    const { from, to } = ed.state.selection
    let handled = false
    ed.view.someProp('handleTextInput', (handler) => {
      if (handler(ed.view, from, to, character)) {
        handled = true
        return true
      }
    })
    if (!handled) {
      ed.view.dispatch(ed.state.tr.insertText(character, from, to))
    }
  }
}

describe('Markdown editor input path', () => {
  it('parses pasted Markdown into semantic nodes instead of literal markers', () => {
    const ed = createEditor()
    const $context = ed.state.doc.resolve(1)
    let parsed

    ed.view.someProp('clipboardTextParser', (parser) => {
      parsed = parser('## Heading\n\n- [ ] task', $context, false, ed.view)
      return parsed
    })

    expect(parsed).toBeTruthy()
    expect(parsed.content.firstChild.type.name).toBe('heading')
    expect(parsed.content.firstChild.attrs.level).toBe(2)
    expect(parsed.content.lastChild.type.name).toBe('taskList')
  })

  it('serializes copied rich content as Markdown when the clipboard option is enabled', () => {
    const ed = createEditor()
    ed.commands.setContent('## Heading\n\n**bold**')
    let markdown

    ed.view.someProp('clipboardTextSerializer', (serializer) => {
      markdown = serializer(ed.state.doc.content)
      return markdown
    })

    expect(markdown).toContain('## Heading')
    expect(markdown).toContain('**bold**')
  })

  it('leaves explicit plain-text paste unformatted', () => {
    const ed = createEditor()
    const originalClipboardEvent = globalThis.ClipboardEvent
    globalThis.ClipboardEvent = window.Event
    try {
      pasteLiteralText(ed.view, '## keep these markers')
    } finally {
      globalThis.ClipboardEvent = originalClipboardEvent
    }

    const paragraph = ed.getJSON().content[0]
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.content).toEqual([{ type: 'text', text: '## keep these markers' }])
  })

  it('keeps Slash and mention suggestions disabled while an IME composition is active', () => {
    expect(allowSuggestionCommand({ editor: { view: { composing: true } } })).toBe(false)
    expect(allowSuggestionCommand({ editor: { view: { composing: false } } })).toBe(true)
  })

  it('turns task Markdown typed at line start into a semantic task list', () => {
    const ed = createEditor('- [ ]')

    expect(applyFinalTypedCharacter(ed, ' ')).toBe(true)
    expect(ed.getJSON().content[0].type).toBe('taskList')
    expect(ed.getJSON().content[0].content[0].type).toBe('taskItem')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toBe('- [ ]')
  })

  it('preserves the checked state when completed task Markdown is typed', () => {
    const ed = createEditor('- [x]')

    expect(applyFinalTypedCharacter(ed, ' ')).toBe(true)
    const taskItem = ed.getJSON().content[0].content[0]
    expect(taskItem.type).toBe('taskItem')
    expect(taskItem.attrs.checked).toBe(true)
  })

  it.each([
    { marker: '- [ ] ', checked: false },
    { marker: '- [x] ', checked: true },
  ])('converts $marker when the marker is entered one real character at a time', ({ marker, checked }) => {
    const ed = createEditor()

    typeCharacters(ed, marker)
    const taskItem = ed.getJSON().content[0].content[0]
    expect(ed.getJSON().content[0].type).toBe('taskList')
    expect(taskItem.type).toBe('taskItem')
    expect(taskItem.attrs.checked).toBe(checked)
    expect(ed.commands.undoInputRule()).toBe(true)
    const restoredList = ed.getJSON().content[0]
    expect(restoredList.type).toBe('bulletList')
    expect(restoredList.content[0].content[0].content[0].text).toBe(marker.slice(2))
  })

  it('turns callout Markdown typed at line start into a semantic callout', () => {
    const ed = createEditor('> [!NOTE]')

    expect(applyFinalTypedCharacter(ed, ' ')).toBe(true)
    expect(ed.getJSON().content[0].type).toBe('callout')
    expect(ed.getJSON().content[0].attrs.kind).toBe('note')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toBe('> [!NOTE]')
  })

  it('converts a typed GFM callout one real character at a time and restores its marker', () => {
    const ed = createEditor()

    typeCharacters(ed, '> [!WARNING] ')
    expect(ed.getJSON().content[0].type).toBe('callout')
    expect(ed.getJSON().content[0].attrs.kind).toBe('warning')
    expect(ed.commands.undoInputRule()).toBe(true)
    const restoredQuote = ed.getJSON().content[0]
    expect(restoredQuote.type).toBe('blockquote')
    expect(restoredQuote.content[0].content[0].text).toBe('[!WARNING] ')
  })

  it('turns highlight Markdown into a highlight mark', () => {
    const ed = createEditor('==重点=')

    expect(applyFinalTypedCharacter(ed, '=')).toBe(true)
    const text = ed.getJSON().content[0].content[0]
    expect(text.text).toBe('重点')
    expect(text.marks?.[0]?.type).toBe('highlight')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toBe('==重点=')
  })

  it.each([
    { marker: '#', final: ' ', type: 'heading', attrs: { level: 1 } },
    { marker: '-', final: ' ', type: 'bulletList' },
    { marker: '1.', final: ' ', type: 'orderedList', attrs: { start: 1 } },
    { marker: '>', final: ' ', type: 'blockquote' },
    { marker: '```js', final: ' ', type: 'codeBlock', attrs: { language: 'js' } },
    { marker: '--', final: '-', type: 'horizontalRule' },
  ])('turns $marker into a semantic $type node and keeps one-step undo', ({ marker, final, type, attrs }) => {
    const ed = createEditor(marker)

    expect(applyFinalTypedCharacter(ed, final)).toBe(true)
    expect(ed.getJSON().content[0].type).toBe(type)
    if (attrs) expect(ed.getJSON().content[0].attrs).toMatchObject(attrs)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toBe(marker)
  })

  it.each([
    { marker: '- [ ]', final: ' ' },
    { marker: '> [!TIP]', final: ' ' },
    { marker: '==重点=', final: '=' },
  ])('does not transform $marker while composition is active', ({ marker, final }) => {
    const ed = createEditor(marker)
    Object.defineProperty(ed.view, 'composing', { configurable: true, value: true })

    expect(applyFinalTypedCharacter(ed, final)).toBe(false)
    expect(ed.getJSON().content[0].type).toBe('paragraph')
    expect(ed.getText()).toBe(marker)
  })
})
