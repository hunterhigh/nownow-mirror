// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

// storage 依赖 supabase 客户端；这里只验路径解析规则，把客户端桩掉。
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: `/sb/storage/v1/object/public/avatars/${p}` } }),
      upload: () => Promise.resolve({ error: null }),
    }) },
  },
  supabaseBase: '/sb',
  supabaseAnonKey: 'anon',
}))

vi.mock('../src/lib/report', () => ({ report: () => {} }))

const { avatarSrc, isCustomAvatar, DEFAULT_AVATAR } = await import('../src/components/AvatarPicker')

describe('头像取值：预设 vs 自定义', () => {
  it('预设走静态资源，未知/空值落到默认', () => {
    expect(avatarSrc('a1')).toBe('/avatars/a1.png')
    expect(avatarSrc(null)).toBe(`/avatars/${DEFAULT_AVATAR}.png`)
    expect(avatarSrc('不存在的')).toBe(`/avatars/${DEFAULT_AVATAR}.png`)
  })

  it('自定义头像按**当前环境**拼 URL，不是把域名腌进数据里', () => {
    const stored = 'custom:0e4c1a2b-1111-2222-3333-444455556666/1754800000-ab12.webp'
    expect(isCustomAvatar(stored)).toBe(true)
    // 关键：库里存的是路径，出来的 URL 由当前客户端决定（线上=/sb 代理，本地=直连）。
    // 存完整 URL 的话，本地传的图会带着 supabase.co 地址发给所有人，换域名还会全废。
    expect(avatarSrc(stored)).toBe('/sb/storage/v1/object/public/avatars/0e4c1a2b-1111-2222-3333-444455556666/1754800000-ab12.webp')
  })

  it('预设名不会被误判成自定义', () => {
    expect(isCustomAvatar('a3')).toBe(false)
    expect(isCustomAvatar(null)).toBe(false)
  })
})

describe('缩略图：方向和扩展名', () => {
  it('必须显式要求按 EXIF 摆正 —— 否则竖拍的 iPhone 照片会被永久烤歪 90°', async () => {
    const calls = []
    globalThis.createImageBitmap = (file, opts) => {
      calls.push(opts)
      return Promise.resolve({ width: 100, height: 200, close() {} })
    }
    const canvas = {
      getContext: () => ({ drawImage() {}, imageSmoothingQuality: '' }),
      toBlob: (cb) => cb({ type: 'image/webp', size: 10 }),
    }
    const realCreate = document.createElement.bind(document)
    document.createElement = (tag) => (tag === 'canvas' ? canvas : realCreate(tag))
    try {
      const { uploadAvatar } = await import('../src/lib/storage')
      await uploadAvatar(new Blob(['x']), 'u1')
      expect(calls[0]).toEqual({ imageOrientation: 'from-image' })
    } finally {
      document.createElement = realCreate
    }
  })

  it('引擎不支持 webp 时会静默给 PNG —— 扩展名要跟着真实类型走，不能说谎', async () => {
    globalThis.createImageBitmap = () => Promise.resolve({ width: 100, height: 100, close() {} })
    const canvas = {
      getContext: () => ({ drawImage() {}, imageSmoothingQuality: '' }),
      // 请求 webp 却回 PNG（Safari 老版本的真实行为）
      toBlob: (cb) => cb({ type: 'image/png', size: 10 }),
    }
    const realCreate = document.createElement.bind(document)
    document.createElement = (tag) => (tag === 'canvas' ? canvas : realCreate(tag))
    try {
      const { uploadAvatar } = await import('../src/lib/storage')
      const value = await uploadAvatar(new Blob(['x']), 'u1')
      expect(value.endsWith('.png')).toBe(true)
      expect(value.includes('.webp')).toBe(false)
    } finally {
      document.createElement = realCreate
    }
  })
})
