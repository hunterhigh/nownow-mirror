export function markdownTitleFromFilename(fileName) {
  const leaf = String(fileName || '').split(/[\\/]/).pop() || ''
  const title = leaf.replace(/\.(?:md|markdown)$/i, '').trim()
  return title || '导入文档'
}

export function uniqueMarkdownTitle(fileName, existingNames = []) {
  const base = markdownTitleFromFilename(fileName)
  const taken = new Set(existingNames.map((name) => String(name || '').trim().toLocaleLowerCase()))
  if (!taken.has(base.toLocaleLowerCase())) return base

  let suffix = 2
  while (taken.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${base} ${suffix}`
}

// 现阶段沿用 NowNow 的 doc_tag 作为独立文档槽；创建与保存依赖由 Board 注入，
// 使编辑器协议不绑定当前数据实现，将来引入真正的 document entity 时可直接替换。
export async function createMarkdownDocument({
  owner,
  section,
  periodKey,
  fileName,
  json,
  text,
  existingNames,
  sortOrder,
  createTag,
  saveDocument,
}) {
  const title = uniqueMarkdownTitle(fileName, existingNames)
  const tag = await createTag(owner, section, title, sortOrder)
  let syncState = null

  await saveDocument(
    { owner, section, periodKey, tagId: tag.id, json, text },
    (state) => { syncState = state },
  )

  return { id: tag.id, title, tag, syncState }
}
