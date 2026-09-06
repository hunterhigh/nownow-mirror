// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { docJsonToMarkdown, docJsonToText, markdownToDocJson } from '../src/lib/markdown'

function findNodes(node, type, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (node.type === type) acc.push(node)
  if (Array.isArray(node.content)) {
    for (const child of node.content) findNodes(child, type, acc)
  }
  return acc
}

function textContent(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text || ''
  return Array.isArray(node.content) ? node.content.map(textContent).join('') : ''
}

function marksOf(node) {
  return (node.marks || []).map((mark) => mark.type).sort()
}

function normalizedDoc(node) {
  if (!node || typeof node !== 'object') return node

  const base = { type: node.type }

  if (node.type === 'text') {
    base.text = node.text || ''
    if (node.marks?.length) {
      base.marks = node.marks
        .map((mark) => ({
          type: mark.type,
          attrs: mark.attrs ? Object.fromEntries(Object.entries(mark.attrs).sort()) : undefined,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    return base
  }

  if (node.attrs) {
    const kept = {}
    for (const key of ['level', 'checked', 'language', 'src', 'alt', 'title', 'href']) {
      if (node.attrs[key] !== undefined && node.attrs[key] !== null) kept[key] = node.attrs[key]
    }
    if (Object.keys(kept).length) base.attrs = kept
  }

  if (Array.isArray(node.content)) {
    base.content = node.content.map(normalizedDoc)
  }

  return base
}

describe('Markdown converter', () => {
  it('parses H1 to H3 headings and exports them back as heading markers', () => {
    const markdown = '# One\n\n## Two\n\n### Three'
    const json = markdownToDocJson(markdown)
    const headings = findNodes(json, 'heading')

    expect(headings.map((node) => node.attrs?.level)).toEqual([1, 2, 3])
    expect(headings.map(textContent)).toEqual(['One', 'Two', 'Three'])
    expect(docJsonToMarkdown(json)).toContain('# One')
    expect(docJsonToMarkdown(json)).toContain('## Two')
    expect(docJsonToMarkdown(json)).toContain('### Three')
  })

  it('parses common inline marks and preserves their markdown export', () => {
    const json = markdownToDocJson('**bold** *italic* ~~strike~~ `code` [link](https://example.com)')
    const texts = findNodes(json, 'text')
    const link = findNodes(json, 'text').find((node) => marksOf(node).includes('link'))
    const markdown = docJsonToMarkdown(json)

    expect(texts.find((node) => node.text === 'bold')).toBeTruthy()
    expect(marksOf(texts.find((node) => node.text === 'bold'))).toContain('bold')
    expect(marksOf(texts.find((node) => node.text === 'italic'))).toContain('italic')
    expect(marksOf(texts.find((node) => node.text === 'strike'))).toContain('strike')
    expect(marksOf(texts.find((node) => node.text === 'code'))).toContain('code')
    expect(link?.marks?.find((mark) => mark.type === 'link')?.attrs?.href).toBe('https://example.com')
    expect(markdown).toContain('**bold**')
    expect(markdown).toContain('*italic*')
    expect(markdown).toContain('~~strike~~')
    expect(markdown).toContain('`code`')
    expect(markdown).toContain('[link](https://example.com)')
  })

  it('parses blockquotes and exports them with quote markers', () => {
    const json = markdownToDocJson('> quoted line')
    const quotes = findNodes(json, 'blockquote')

    expect(quotes).toHaveLength(1)
    expect(textContent(quotes[0])).toBe('quoted line')
    expect(docJsonToMarkdown(json)).toContain('> quoted line')
  })

  it('parses horizontal rules as semantic divider nodes', () => {
    const json = markdownToDocJson('before\n\n---\n\nafter')
    const rules = findNodes(json, 'horizontalRule')
    const markdown = docJsonToMarkdown(json)

    expect(rules).toHaveLength(1)
    expect(markdown).toContain('---')
    expect(docJsonToText(json)).toContain('before')
    expect(docJsonToText(json)).toContain('after')
  })

  it('parses unordered, ordered, and nested lists without flattening them', () => {
    const markdown = '- top\n  - nested\n- tail\n\n1. first\n2. second'
    const json = markdownToDocJson(markdown)
    const bullets = findNodes(json, 'bulletList')
    const ordered = findNodes(json, 'orderedList')
    const items = findNodes(json, 'listItem')
    const topBullet = json.content.find((node) => node.type === 'bulletList')

    expect(json.content.filter((node) => node.type === 'bulletList')).toHaveLength(1)
    expect(ordered).toHaveLength(1)
    expect(items.map(textContent)).toEqual(['topnested', 'nested', 'tail', 'first', 'second'])
    expect(topBullet.content[0].content.some((node) => node.type === 'bulletList')).toBe(true)
    expect(docJsonToMarkdown(json)).toContain('- top')
    expect(docJsonToMarkdown(json)).toContain('  - nested')
    expect(docJsonToMarkdown(json)).toContain('1. first')
  })

  it('parses task list check states and keeps them in markdown export', () => {
    const json = markdownToDocJson('- [ ] todo\n- [x] done')
    const tasks = findNodes(json, 'taskItem')
    const markdown = docJsonToMarkdown(json)

    expect(tasks.map((node) => node.attrs?.checked)).toEqual([false, true])
    expect(tasks.map(textContent)).toEqual(['todo', 'done'])
    expect(markdown).toContain('- [ ] todo')
    expect(markdown).toContain('- [x] done')
  })

  it('round-trips nested task lists without flattening levels or checked states', () => {
    const source = '- [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [x] sibling'
    const parsed = markdownToDocJson(source)
    const tasks = findNodes(parsed, 'taskItem')
    const root = parsed.content[0]
    const nested = root.content[0].content.find((node) => node.type === 'taskList')
    const deepNested = nested.content[0].content.find((node) => node.type === 'taskList')
    const markdown = docJsonToMarkdown(parsed)
    const reparsed = markdownToDocJson(markdown)

    expect(tasks.map((node) => node.attrs.checked)).toEqual([false, true, false, true])
    expect(nested.type).toBe('taskList')
    expect(deepNested.type).toBe('taskList')
    expect(markdown).toContain('  - [x] child')
    expect(markdown).toContain('    - [ ] grandchild')
    expect(normalizedDoc(reparsed)).toEqual(normalizedDoc(parsed))
  })

  it('parses fenced code blocks with language metadata when a language is provided', () => {
    const json = markdownToDocJson('```js\nconst answer = 42\n```')
    const blocks = findNodes(json, 'codeBlock')
    const markdown = docJsonToMarkdown(json)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].attrs?.language).toBe('js')
    expect(textContent(blocks[0])).toContain('const answer = 42')
    expect(markdown).toContain('```js')
    expect(markdown).toContain('const answer = 42')
  })

  it('parses GFM tables as table nodes instead of plain paragraphs', () => {
    const markdown = '| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |'
    const json = markdownToDocJson(markdown)
    const tables = findNodes(json, 'table')
    const headers = findNodes(json, 'tableHeader')
    const cells = findNodes(json, 'tableCell')

    expect(tables).toHaveLength(1)
    expect(headers.map(textContent)).toEqual(['Name', 'Value'])
    expect(cells.map(textContent)).toEqual(['Alpha', '1', 'Beta', '2'])
    expect(docJsonToMarkdown(json)).toContain('| Name | Value |')
  })

  it('parses markdown images as image nodes and exports their source unchanged', () => {
    const json = markdownToDocJson('![Alt text](https://example.com/demo.png)')
    const images = findNodes(json, 'image')
    const markdown = docJsonToMarkdown(json)

    expect(images).toHaveLength(1)
    expect(images[0].attrs?.src).toBe('https://example.com/demo.png')
    expect(images[0].attrs?.alt).toBe('Alt text')
    expect(markdown).toContain('![Alt text](https://example.com/demo.png)')
  })

  it('keeps representative standard markdown semantically stable across markdown to json round trips', () => {
    const markdown = [
      '# Title',
      '',
      'Paragraph with **bold**, *italic*, and [link](https://example.com).',
      '',
      '> Quote',
      '',
      '- [ ] task',
      '- item',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '```js',
      'console.log(1)',
      '```',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| A1 | B1 |',
      '',
      '---',
    ].join('\n')

    const first = markdownToDocJson(markdown)
    const second = markdownToDocJson(docJsonToMarkdown(first))

    expect(normalizedDoc(second)).toEqual(normalizedDoc(first))
  })

  it('reimports exported date stamps as dateStamp nodes instead of degrading them to plain text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'dateStamp', attrs: { at: '2026-08-09T16:31:00.000Z', label: '8月9日 周日' } },
      ],
    }
    const markdown = docJsonToMarkdown(doc)
    const reparsed = markdownToDocJson(markdown)

    expect(docJsonToText(doc)).toContain('8月9日 周日')
    expect(markdown).toContain('8月9日 周日')
    expect(findNodes(reparsed, 'dateStamp')).toHaveLength(1)
  })

  it('round-trips GuanfU callout, private, highlight, and text-color extensions through readable HTML', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { private: true },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'colored', marks: [{ type: 'textStyle', attrs: { color: '#57251f' } }] },
                { type: 'text', text: ' highlighted', marks: [{ type: 'highlight', attrs: { color: '#fde68a' } }] },
              ],
            },
          ],
        },
      ],
    }

    const markdown = docJsonToMarkdown(doc)
    const reparsed = markdownToDocJson(markdown)
    const callout = findNodes(reparsed, 'callout')[0]
    const texts = findNodes(reparsed, 'text')

    expect(markdown).toContain('> [!NOTE]')
    expect(markdown).toContain('<!-- guanfu:private -->')
    expect(callout?.attrs?.private).toBe(true)
    expect(texts.find((node) => node.text === 'colored')?.marks?.[0]?.attrs?.color).toMatch(/^(#57251f|rgb\(87, 37, 31\))$/)
    expect(texts.find((node) => node.text === ' highlighted')?.marks?.[0]?.attrs?.color).toMatch(/^(#fde68a|rgb\(253, 230, 138\))$/)
  })

  it('preserves GFM callout types across parse and export', () => {
    const parsed = markdownToDocJson('> [!WARNING]\n>\n> 请先备份')
    const callout = findNodes(parsed, 'callout')[0]
    const markdown = docJsonToMarkdown(parsed)
    const reparsed = markdownToDocJson(markdown)

    expect(callout?.attrs?.kind).toBe('warning')
    expect(textContent(callout)).toContain('请先备份')
    expect(markdown).toContain('> [!WARNING]')
    expect(findNodes(reparsed, 'callout')[0]?.attrs?.kind).toBe('warning')
  })

  it('keeps underline and readable mention labels across export and reimport', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] },
            { type: 'text', text: ' ' },
            { type: 'mention', attrs: { id: 'member-1', label: '林舟' } },
          ],
        },
      ],
    }

    const markdown = docJsonToMarkdown(doc)
    const reparsed = markdownToDocJson(markdown)
    const underlined = findNodes(reparsed, 'text').find((node) => node.text === 'underlined')
    const mention = findNodes(reparsed, 'mention')[0]

    expect(markdown).toContain('<u>underlined</u>')
    expect(markdown).toContain('林舟')
    expect(marksOf(underlined)).toContain('underline')
    expect(mention?.attrs?.label).toBe('林舟')
    expect(mention?.attrs?.mid).toMatch(/^m-|^[0-9a-f-]{36}$/)
  })
})
