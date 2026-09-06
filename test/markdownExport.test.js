// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildMarkdownExport } from '../src/lib/markdownExport'
import { markdownToDocJson } from '../src/lib/markdown'

function paragraph(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function findNodes(node, type, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (node.type === type) acc.push(node)
  for (const child of node.content || []) findNodes(child, type, acc)
  return acc
}

describe('aggregate Markdown export', () => {
  it('groups non-empty documents in the fixed section order and keeps period headings', () => {
    const docs = [
      { section: 'month', period_key: '2026-09', doc_json: { type: 'doc', content: [paragraph('月度内容')] } },
      { section: 'today', period_key: '2026-09-06', doc_json: { type: 'doc', content: [paragraph('今日内容')] } },
      { section: 'week', period_key: '2026-W36', doc_json: { type: 'doc', content: [paragraph('每周内容')] } },
      { section: 'stash', period_key: 'stash', doc_json: { type: 'doc', content: [paragraph('收集内容')] } },
    ]

    const markdown = buildMarkdownExport({ displayName: '林舟', docs })

    expect(markdown.startsWith('# 林舟 的观复\n')).toBe(true)
    expect(markdown.indexOf('## 今日')).toBeLessThan(markdown.indexOf('## 本周'))
    expect(markdown.indexOf('## 本周')).toBeLessThan(markdown.indexOf('## 本月'))
    expect(markdown.indexOf('## 本月')).toBeLessThan(markdown.indexOf('## 收集箱'))
    expect(markdown).toContain('### 2026-09-06')
    expect(markdown).toContain('### 2026-W36')
    expect(markdown).toContain('### 2026-09')
    expect(markdown).not.toContain('### stash')
  })

  it('reimports task, callout, private, highlight, and plain text semantics from the aggregate file', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('已完成')] }],
        },
        {
          type: 'callout',
          attrs: { kind: 'tip', private: true },
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: '重点', marks: [{ type: 'highlight', attrs: { color: '#d5c99e' } }] }],
          }],
        },
        paragraph('普通正文'),
      ],
    }
    const markdown = buildMarkdownExport({
      displayName: '林舟',
      docs: [{ section: 'today', period_key: '2026-09-06', doc_json: source }],
    })
    const reparsed = markdownToDocJson(markdown)

    expect(findNodes(reparsed, 'taskItem')[0]?.attrs.checked).toBe(true)
    expect(findNodes(reparsed, 'callout')[0]?.attrs).toMatchObject({ kind: 'tip', private: true })
    const highlighted = findNodes(reparsed, 'text').find((node) => node.text === '重点')
    expect(highlighted?.marks?.some((mark) => mark.type === 'highlight')).toBe(true)
    expect(markdown).toContain('普通正文')
  })

  it('omits empty documents and does not mutate source JSON', () => {
    const doc = { section: 'today', period_key: '2026-09-06', doc_json: { type: 'doc', content: [paragraph('保留')] } }
    const empty = { section: 'month', period_key: '2026-09', doc_json: { type: 'doc', content: [{ type: 'paragraph' }] } }
    const snapshot = structuredClone([doc, empty])

    const markdown = buildMarkdownExport({ displayName: '林舟', docs: [doc, empty] })

    expect(markdown).toContain('## 今日')
    expect(markdown).not.toContain('## 本月')
    expect([doc, empty]).toEqual(snapshot)
  })
})
