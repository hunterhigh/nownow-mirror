// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { docJsonToMarkdown, docJsonToText, markdownToDocJson } from '../src/lib/markdown'

const TOP_LEVEL_BLOCKS = 200
const MIN_CHINESE_CHARACTERS = 50000
const MAX_ROUND_TRIP_MS = 15000

function buildChinesePayload(index) {
  const unit = `第${String(index + 1).padStart(3, '0')}段观复长文性能回归文本天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏`
  return unit.repeat(9)
}

function buildLargeDoc() {
  const content = Array.from({ length: TOP_LEVEL_BLOCKS }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: buildChinesePayload(index) }],
  }))

  return { type: 'doc', content }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function blockCount(doc) {
  return Array.isArray(doc?.content) ? doc.content.length : 0
}

describe('Markdown converter performance regression', () => {
  it('keeps 200 top-level blocks and the full Chinese text payload through a large json-markdown-json round trip within a local-CI-safe budget', () => {
    const sourceDoc = buildLargeDoc()
    const sourceSnapshot = deepClone(sourceDoc)
    const sourceText = docJsonToText(sourceDoc)

    expect(blockCount(sourceDoc)).toBe(TOP_LEVEL_BLOCKS)
    expect([...sourceText].length).toBeGreaterThanOrEqual(MIN_CHINESE_CHARACTERS)

    const startedAt = performance.now()
    const markdown = docJsonToMarkdown(sourceDoc)
    const reparsed = markdownToDocJson(markdown)
    const durationMs = performance.now() - startedAt

    expect(blockCount(reparsed)).toBe(TOP_LEVEL_BLOCKS)
    expect(docJsonToText(reparsed)).toBe(sourceText)
    expect(sourceDoc).toEqual(sourceSnapshot)
    // 15s is intentionally generous for jsdom + a shared headless Tiptap editor on local CI.
    // It should catch order-of-magnitude regressions without failing on normal machine variance.
    expect(durationMs).toBeLessThan(MAX_ROUND_TRIP_MS)
  })

  it('does not mutate the source json while exporting markdown or plain text', () => {
    const sourceDoc = buildLargeDoc()
    const sourceSnapshot = deepClone(sourceDoc)

    const markdown = docJsonToMarkdown(sourceDoc)
    const plainText = docJsonToText(sourceDoc)

    expect(markdown.length).toBeGreaterThan(0)
    expect([...plainText].length).toBeGreaterThanOrEqual(MIN_CHINESE_CHARACTERS)
    expect(sourceDoc).toEqual(sourceSnapshot)
  })
})
