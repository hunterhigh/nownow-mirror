// 错误上报 —— 目的只有一个：让"用户遇到了问题"这件事**能被你知道**。
//
// 在这之前，全应用有 25 处空 catch、5 处 console.error，没有任何东西会离开用户的浏览器。
// 也就是说：保存失败率是多少、国内那条 /sb 代理到底稳不稳、谁在白屏 ——
// 全是黑箱，只能等人来告诉你，而多数人不会说，他们只是不用了。
//
// 落库到 client_errors 表（见 migration-029）。刻意做得很克制：
// · 失败绝不影响用户（上报本身出错就静默丢掉）
// · 同一条错误 5 分钟内只报一次（防止一个循环里的错误刷爆表）
// · 只带诊断需要的字段，不带文档内容 —— 出错也不能把人家写的东西传走
import { supabase } from './supabase'

const seen = new Map() // 指纹 -> 上次上报时间
const DEDUP_MS = 5 * 60_000
const MAX_LEN = 500
// 全局限流：不管指纹怎么变，每分钟最多 10 条。防的是"每次报错文案都不一样"的场景
// （超时毫秒数、请求 id 之类），那会让指纹去重完全失效，一个重试循环每分钟灌几百行。
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10
let windowStart = 0
let windowCount = 0

function fingerprint(kind, message) {
  // 指纹前先把易变部分归一：数字（时长/端口/毫秒）、UUID、URL 查询串。
  // "timeout after 3021ms" 和 "timeout after 3187ms" 是同一个问题，不该各占一条。
  const normalized = String(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\?[^\s"']*/g, '')
    .replace(/\d+/g, '<n>')
  return `${kind}:${normalized.slice(0, 120)}`
}

export function report(kind, error, extra = {}) {
  try {
    const message = String(error?.message || error || '').slice(0, MAX_LEN)
    if (!message) return

    const now = Date.now()
    if (now - windowStart > RATE_WINDOW_MS) { windowStart = now; windowCount = 0 }
    if (++windowCount > RATE_MAX) return

    const fp = fingerprint(kind, message)
    if (now - (seen.get(fp) || 0) < DEDUP_MS) return
    seen.set(fp, now)
    // 顺手清掉过期指纹，别让这张表在长会话里无限长
    if (seen.size > 200) for (const [k, t] of seen) if (now - t > DEDUP_MS) seen.delete(k)

    // 不 await：上报永远不能挡住用户手上的事。
    supabase
      .from('client_errors')
      .insert({
        kind,
        message,
        stack: String(error?.stack || '').slice(0, 2000),
        path: typeof location !== 'undefined' ? location.pathname : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        extra,
      })
      .then(() => {}, () => {}) // 上报失败就算了，绝不冒泡
  } catch {
    // 上报本身不能成为新的故障源
  }
}

/** 全局兜底：渲染之外的错误（事件回调、未处理的 promise）也要能被看见。 */
export function installGlobalReporting() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => report('window.error', e?.error || e?.message))
  window.addEventListener('unhandledrejection', (e) => report('unhandledrejection', e?.reason))
}
