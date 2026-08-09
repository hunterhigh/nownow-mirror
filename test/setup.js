// 一个够用的 localStorage 假实现 —— 这些测试关心的是"内容有没有被保住"，
// 不需要浏览器，也不需要 jsdom。
class MemoryStorage {
  constructor() { this.map = new Map() }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
globalThis.localStorage = new MemoryStorage()
// navigator 在 Node 里是只读的 getter，不能直接赋值。
if (!('onLine' in (globalThis.navigator || {}))) {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
}

// resilientDocs 的"启动时收拢遗留草稿"那段是 `if (typeof window !== 'undefined')` 守着的。
// 不给 window，那段逻辑在测试里根本不会跑 —— 而它正是要验的东西。
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} }
