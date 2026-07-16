// 数据库/RPC 报错转人话（原始 Postgres 报错不能直接糊到用户脸上）
export function friendlyDbError(m) {
  const msg = typeof m === 'object' && m
    ? [m.message, m.details, m.hint, m.code].filter(Boolean).join(' ')
    : String(m || '')
  if (!msg) return '出错了，再试一次'
  if (msg.includes('profiles_handle_key')) return '这个名字已经有人用了，换一个吧（名字在团队内是唯一的，@你 全靠它）'
  if (msg.includes('doc_tags_owner_section_active_name_key')) return '这个标签已经存在了，换个名字吧'
  if (msg.includes('duplicate key')) return '已经存在了，不能重复添加'
  if (msg.includes('row-level security')) return '没有权限做这个操作'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '网络不通，稍后再试'
  return msg
}
