import { beforeEach, describe, expect, it, vi } from 'vitest'

// 这些测试守的是同一件事：**不能悄悄弄丢别人写的字。**
// 每一条都对应一个今天真实发现过的 bug —— 有它们的话，那些 bug 早该被拦下。
//
// docsApi 整个 mock 掉：这里要验的是"什么情况下允许写、写的时候带没带前置条件"，
// 不是 Supabase 会不会返回数据。

const saveDoc = vi.fn()
const loadDocWithMeta = vi.fn()

class DocConflictError extends Error {
  constructor(serverUpdatedAt) {
    super('conflict')
    this.name = 'DocConflictError'
    this.serverUpdatedAt = serverUpdatedAt
  }
}

vi.mock('../src/lib/docsApi', () => ({
  saveDoc: (...a) => saveDoc(...a),
  loadDoc: () => Promise.resolve(null),
  loadDocWithMeta: (...a) => loadDocWithMeta(...a),
  DocConflictError,
}))
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: () => {} }, from: () => ({ insert: () => ({ then: () => {} }) }) },
}))
vi.mock('../src/lib/report', () => ({ report: () => {}, installGlobalReporting: () => {} }))

const DOC = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

let mod
beforeEach(async () => {
  localStorage.clear()
  saveDoc.mockReset()
  loadDocWithMeta.mockReset()
  vi.resetModules()
  mod = await import('../src/lib/resilientDocs.js')
})

describe('保存必须带版本前置条件', () => {
  it('正常保存会把加载时的版本号交给 saveDoc', async () => {
    loadDocWithMeta.mockResolvedValue({ json: DOC('原文'), updatedAt: 'V1' })
    saveDoc.mockResolvedValue({ id: 'x', updatedAt: 'V2' })

    await mod.loadDocResilient('u', 'today', '2026-08-09', null)
    await mod.saveDocResilient({ owner: 'u', section: 'today', periodKey: '2026-08-09', tagId: null, json: DOC('改过'), text: '改过' })

    expect(saveDoc.mock.calls[0][0].expectedUpdatedAt).toBe('V1')
  })

  it('连续两次保存：第二次基于第一次的新版本，不会误报冲突', async () => {
    loadDocWithMeta.mockResolvedValue({ json: DOC('原文'), updatedAt: 'V1' })
    saveDoc.mockResolvedValueOnce({ id: 'x', updatedAt: 'V2' }).mockResolvedValueOnce({ id: 'x', updatedAt: 'V3' })

    await mod.loadDocResilient('u', 'today', '2026-08-09', null)
    const args = { owner: 'u', section: 'today', periodKey: '2026-08-09', tagId: null }
    await mod.saveDocResilient({ ...args, json: DOC('一'), text: '一' })
    await mod.saveDocResilient({ ...args, json: DOC('二'), text: '二' })

    expect(saveDoc.mock.calls[1][0].expectedUpdatedAt).toBe('V2')
  })
})

describe('冲突：静默自动处理，绝不丢内容', () => {
  it('冲突时自动以服务器当前版本为基准重存一次，不向用户报 conflict', async () => {
    loadDocWithMeta.mockResolvedValue({ json: DOC('原文'), updatedAt: 'V_SERVER' })
    // 第一次撞冲突，重新取基准后第二次成功
    saveDoc
      .mockRejectedValueOnce(new DocConflictError('V_SERVER'))
      .mockResolvedValueOnce({ id: 'x', updatedAt: 'V_NEW' })
    const states = []

    await mod.loadDocResilient('u', 'today', '2026-08-09', null)
    await mod.saveDocResilient(
      { owner: 'u', section: 'today', periodKey: '2026-08-09', tagId: null, json: DOC('我的修改'), text: '我的修改' },
      (s) => states.push(s),
    )

    // 用户看不到冲突，只看到正常的保存流程
    expect(states).not.toContain('conflict')
    expect(states).not.toContain('error')
    expect(states.at(-1)).toBe('saved')

    // 第二次重存必须带着**服务器的**当前版本作为前置条件，
    // 否则就退化成无条件覆盖，等于把这层保护整个废掉。
    expect(saveDoc.mock.calls.length).toBe(2)
    expect(saveDoc.mock.calls[1][0].expectedUpdatedAt).toBe('V_SERVER')
    expect(saveDoc.mock.calls[1][0].text).toBe('我的修改')

    // 存成功了，草稿要清掉
    expect(localStorage.getItem('nownow_draft:u/today/2026-08-09')).toBe(null)
  })

  it('持续冲突时只自动重试一次就停，草稿留在本地', async () => {
    loadDocWithMeta.mockResolvedValue({ json: DOC('原文'), updatedAt: 'V_SERVER' })
    saveDoc.mockRejectedValue(new DocConflictError('V_SERVER')) // 一直冲突
    const states = []

    await mod.loadDocResilient('u', 'today', '2026-08-09', null)
    await mod.saveDocResilient(
      { owner: 'u', section: 'today', periodKey: '2026-08-09', tagId: null, json: DOC('我的修改'), text: '我的修改' },
      (s) => states.push(s),
    )

    // 一次原始 + 一次自动重试 = 2，绝不能无限循环
    expect(saveDoc.mock.calls.length).toBe(2)
    expect(states.at(-1)).toBe('error')

    // 内容还在本地 —— 这是"不丢字"的底线
    const draft = JSON.parse(localStorage.getItem('nownow_draft:u/today/2026-08-09'))
    expect(draft.text).toBe('我的修改')

    // 而且不能再拿这份过期内容去砸服务器
    const before = saveDoc.mock.calls.length
    await mod.flushPending()
    expect(saveDoc.mock.calls.length).toBe(before)
  })
})

describe('启动重放：带着自己的基准，不是当前基准', () => {
  it('遗留草稿用它自己记录的 baseUpdatedAt，而不是 null', async () => {
    // 模拟上次会话留下的草稿（周五断网那种）
    localStorage.setItem(
      'nownow_draft:u/stash/stash',
      JSON.stringify({ owner: 'u', section: 'stash', periodKey: 'stash', tagId: null, json: DOC('周五'), text: '周五', baseUpdatedAt: 'V_FRIDAY' }),
    )
    vi.resetModules()
    saveDoc.mockResolvedValue({ id: 'x', updatedAt: 'V_NEW' })
    const m2 = await import('../src/lib/resilientDocs.js')
    await m2.flushPending()

    // 如果这里是 null，就等于"无条件覆盖" —— 周末在手机上写的会被抹掉
    expect(saveDoc.mock.calls[0][0].expectedUpdatedAt).toBe('V_FRIDAY')
  })
})

describe('本地写不进去时必须说出来', () => {
  it('配额满 + 网络失败时不能报 saved', async () => {
    loadDocWithMeta.mockResolvedValue({ json: null, updatedAt: null })
    saveDoc.mockRejectedValue(new Error('network'))
    const states = []
    const realSet = localStorage.setItem.bind(localStorage)
    localStorage.setItem = () => { throw new Error('QuotaExceededError') }

    await mod.saveDocResilient(
      { owner: 'u', section: 'today', periodKey: '2026-08-09', tagId: null, json: DOC('写不进去'), text: '写不进去' },
      (s) => states.push(s),
    )
    localStorage.setItem = realSet

    // 此刻"永不丢字"其实不成立了 —— 至少不能骗用户说存好了
    expect(states).not.toContain('saved')
    expect(states).toContain('error')
  })
})

describe('空内容覆盖前先备份', () => {
  it('用空文档覆盖非空时，旧内容进 backup', async () => {
    loadDocWithMeta.mockResolvedValue({ json: null, updatedAt: null })
    saveDoc.mockResolvedValue({ id: 'x', updatedAt: 'V2' })
    const args = { owner: 'u', section: 'stash', periodKey: 'stash', tagId: null }

    await mod.saveDocResilient({ ...args, json: DOC('重要内容'), text: '重要内容' })
    // 第一次成功保存会清掉草稿，所以手动放回去模拟"本地有非空内容"
    localStorage.setItem('nownow_draft:u/stash/stash', JSON.stringify({ ...args, json: DOC('重要内容'), text: '重要内容' }))
    await mod.saveDocResilient({ ...args, json: { type: 'doc', content: [] }, text: '' })

    const backup = localStorage.getItem('nownow_backup:u/stash/stash')
    expect(backup).toBeTruthy()
    expect(JSON.parse(backup).text).toBe('重要内容')
  })
})

describe('peekDocCache 的契约：直接能当编辑器初值', () => {
  it('返回的是 PM JSON 本身，不是内部的缓存包装对象', async () => {
    loadDocWithMeta.mockResolvedValue({ json: DOC('缓存里的内容'), updatedAt: 'V1' })
    await mod.loadDocResilient('u', 'today', '2026-08-09', null)

    const peeked = mod.peekDocCache('u', 'today', '2026-08-09', null)
    // 这里如果拿到 { json, updatedAt, at }，编辑器会渲染出一片空白 ——
    // 表现就是"写完切走再回来，内容不见了"。2026-08-09 真实发生过一次。
    expect(peeked?.type).toBe('doc')
    expect(JSON.stringify(peeked)).toContain('缓存里的内容')
    expect(peeked).not.toHaveProperty('updatedAt')
    expect(peeked).not.toHaveProperty('at')
  })

  it('未命中是 undefined（加载占位），空文档是 null —— 两者不能混', async () => {
    expect(mod.peekDocCache('u', 'today', '不存在的周期', null)).toBeUndefined()
  })
})
