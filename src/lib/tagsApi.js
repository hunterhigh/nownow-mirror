import { supabase } from './supabase'

export const DEFAULT_TAG_ID = 'default'
export const ALL_TAG_ID = 'all'
const TAG_CACHE_PREFIX = 'nownow_tagcache:'
const tagCache = new Map()
const tagCacheKey = (owner, section) => `${owner || ''}/${section || ''}`

function readTagCache(owner, section) {
  const key = tagCacheKey(owner, section)
  if (tagCache.has(key)) return tagCache.get(key)
  try {
    const raw = localStorage.getItem(TAG_CACHE_PREFIX + key)
    if (!raw) return undefined
    const tags = JSON.parse(raw)
    if (!Array.isArray(tags)) return undefined
    tagCache.set(key, tags)
    return tags
  } catch {
    return undefined
  }
}

export function peekDocTags(owner, section) {
  return readTagCache(owner, section)
}

export function rememberDocTags(owner, section, tags) {
  const clean = Array.isArray(tags) ? tags : []
  const key = tagCacheKey(owner, section)
  tagCache.set(key, clean)
  try {
    localStorage.setItem(TAG_CACHE_PREFIX + key, JSON.stringify(clean))
  } catch {}
}

function normalizeTag(row) {
  return {
    id: row.id,
    tagId: row.id,
    owner: row.owner,
    section: row.section,
    name: row.name,
    sort_order: row.sort_order ?? 0,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function missingTagTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`
  return msg.includes('doc_tags') || msg.includes('schema cache') || msg.includes('relation') || error?.code === '42P01'
}

// 标签属于页面 owner + section。默认标签是虚拟标签，不落表；doc_tags 只存用户自建标签。
export async function loadDocTags(owner, section) {
  const { data, error } = await supabase
    .from('doc_tags')
    .select('id, owner, section, name, sort_order, archived_at, created_at, updated_at')
    .eq('owner', owner)
    .eq('section', section)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    if (missingTagTable(error)) return { tags: [], ready: false }
    throw error
  }
  const tags = (data ?? []).map(normalizeTag)
  rememberDocTags(owner, section, tags)
  return { tags, ready: true }
}

export async function listTags(owner, section) {
  const { tags } = await loadDocTags(owner, section)
  return tags
}

export async function createTag(owner, section, name, sortOrder = 0) {
  const clean = name.trim()
  if (!clean) throw new Error('标签名不能为空')
  const { data, error } = await supabase
    .from('doc_tags')
    .insert({ owner, section, name: clean, sort_order: sortOrder })
    .select('id, owner, section, name, sort_order, archived_at, created_at, updated_at')
    .single()
  if (error) throw error
  return normalizeTag(data)
}

export async function renameTag(id, name) {
  const clean = name.trim()
  if (!clean) throw new Error('标签名不能为空')
  const { data, error } = await supabase
    .from('doc_tags')
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, owner, section, name, sort_order, archived_at, created_at, updated_at')
    .single()
  if (error) throw error
  return normalizeTag(data)
}

export async function updateTagOrder(section, items) {
  if (!Array.isArray(items) || items.length === 0) return
  const tagIds = items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => item.id)
    .filter(Boolean)
  const { error } = await supabase.rpc('reorder_doc_tags', {
    p_section: section,
    p_tag_ids: tagIds,
  })
  if (error) throw error
}

// Phase 1 删除=归档标签，并把该标签下的内容移回默认标签，避免内容跟着隐藏。
export async function archiveTag(id) {
  const { error } = await supabase.rpc('archive_doc_tag', { p_tag_id: id })
  if (error) throw error
}
