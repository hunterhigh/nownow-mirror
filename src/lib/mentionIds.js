export function newMentionId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'm-' + Math.random().toString(36).slice(2) + Date.now()
}

// Markdown/HTML 只能携带可读的 @标签，不能安全复用另一个工作区的通知 ID。
// 导入时为缺失 mid 的 mention 生成本工作区的新 ID；已有 ID 原样保留。
export function ensureMentionIds(value, createId = newMentionId) {
  if (Array.isArray(value)) return value.map((item) => ensureMentionIds(item, createId))
  if (!value || typeof value !== 'object') return value

  const next = { ...value }
  if (value.type === 'mention' && !value.attrs?.mid) {
    next.attrs = { ...(value.attrs || {}), mid: createId() }
  }
  if (Array.isArray(value.content)) {
    next.content = value.content.map((item) => ensureMentionIds(item, createId))
  }
  return next
}
