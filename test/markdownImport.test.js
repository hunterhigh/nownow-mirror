import { describe, expect, it, vi } from 'vitest'
import { createMarkdownDocument, markdownTitleFromFilename, uniqueMarkdownTitle } from '../src/lib/markdownImport'

describe('Markdown document import', () => {
  it.each([
    ['周报.md', '周报'],
    ['资料.MARKDOWN', '资料'],
    ['/tmp/ 计划 .md', '计划'],
    ['.md', '导入文档'],
  ])('derives a readable document title from %s', (fileName, title) => {
    expect(markdownTitleFromFilename(fileName)).toBe(title)
  })

  it('adds the first available numeric suffix without changing the source filename', () => {
    expect(uniqueMarkdownTitle('周报.md', ['周报', '周报 2', '其他'])).toBe('周报 3')
    expect(uniqueMarkdownTitle('周报.md', ['周报 2'])).toBe('周报')
  })

  it('creates a named document slot before saving through the resilient document path', async () => {
    const order = []
    const createTag = vi.fn(async (...args) => {
      order.push('create')
      expect(args).toEqual(['owner-1', 'today', '周报 2', 3])
      return { id: 'tag-2', name: '周报 2' }
    })
    const saveDocument = vi.fn(async (payload, onState) => {
      order.push('save')
      onState('saving')
      onState('saved')
      expect(payload).toMatchObject({
        owner: 'owner-1',
        section: 'today',
        periodKey: '2026-09-05',
        tagId: 'tag-2',
        text: '正文',
      })
    })
    const json = { type: 'doc', content: [{ type: 'paragraph' }] }

    const created = await createMarkdownDocument({
      owner: 'owner-1',
      section: 'today',
      periodKey: '2026-09-05',
      fileName: '周报.md',
      json,
      text: '正文',
      existingNames: ['周报'],
      sortOrder: 3,
      createTag,
      saveDocument,
    })

    expect(order).toEqual(['create', 'save'])
    expect(created).toMatchObject({ id: 'tag-2', title: '周报 2', syncState: 'saved' })
    expect(saveDocument.mock.calls[0][0].json).toBe(json)
  })

  it('does not attempt to save when the document slot cannot be created', async () => {
    const saveDocument = vi.fn()

    await expect(createMarkdownDocument({
      owner: 'owner-1',
      section: 'today',
      periodKey: '2026-09-05',
      fileName: '周报.md',
      json: { type: 'doc', content: [] },
      text: '',
      existingNames: [],
      sortOrder: 0,
      createTag: vi.fn(async () => { throw new Error('create failed') }),
      saveDocument,
    })).rejects.toThrow('create failed')
    expect(saveDocument).not.toHaveBeenCalled()
  })
})
