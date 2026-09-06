import { describe, expect, it } from 'vitest'
import { ensureMentionIds } from '../src/lib/mentionIds'

describe('ensureMentionIds', () => {
  it('adds ids only to imported mentions that do not have one', () => {
    let seq = 0
    const doc = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { id: 'member-a', label: '林舟' } },
        { type: 'mention', attrs: { id: 'member-b', label: '许宁', mid: 'kept-mid' } },
      ],
    }

    const normalized = ensureMentionIds(doc, () => `new-mid-${++seq}`)

    expect(normalized.content[0].attrs.mid).toBe('new-mid-1')
    expect(normalized.content[1].attrs.mid).toBe('kept-mid')
    expect(doc.content[0].attrs.mid).toBeUndefined()
  })
})
