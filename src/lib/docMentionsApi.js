// docs 世界的 @通知读取：doc_mentions = 别人在自己文档里 @ 了我（纯通知，无任务流）。
// 写入在 docsApi.saveDoc 后的 syncDocMentions；这里只读 + 标已读。
import { supabase } from './supabase'

// 我收到的 @：join docs 拿 (owner, section, period_key, tag_id) 用于跳转/上下文。降序。
export async function loadMyMentions() {
  // getSession（读本地缓存、无网络）取 user，别用 getUser（每次都打一次 auth 服务器网络往返）。
  // 通知页每次进入会多处调这俩(Board refreshNotif + NotificationsPage)，getUser 的网络往返叠起来
  // = 海涛报的「点通知半天才显示内容」。登录态已在 App 启动时校验过(auth-ready)，本地 session 够用。
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return []
  const { data, error } = await supabase
    .from('doc_mentions')
    .select('id, doc_id, author, created_at, read_at, completed_at, snippet, docs_visible!inner(owner, section, period_key, tag_id)')
    .eq('mentioned', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((m) => ({
    id: m.id,
    author: m.author,
    created_at: m.created_at,
    read_at: m.read_at,
    completed_at: m.completed_at, // 已完成的不再隐藏，UI 给它画横线（像勾掉的待办）
    snippet: m.snippet, // 被@那段的文本（通知 snippet）
    owner: m.docs_visible.owner,
    section: m.docs_visible.section,
    periodKey: m.docs_visible.period_key,
    tagId: m.docs_visible.tag_id ?? null,
  }))
}

export async function markMentionRead(id) {
  const { error } = await supabase
    .from('doc_mentions')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// 被@人勾「完成」（派活闭环）：写 completed_at，从我收件箱消失、发起人收到黄色完成通知。
export async function completeMention(id) {
  const { error } = await supabase.rpc('complete_mention', { p_id: id })
  if (error) throw error
}

// 我派出去、对方已完成的活（黄色「X 完成了你派的任务」），未点掉的。降序。
export async function loadMyCompletions() {
  // getSession（读本地缓存、无网络）取 user，别用 getUser（每次都打一次 auth 服务器网络往返）。
  // 通知页每次进入会多处调这俩(Board refreshNotif + NotificationsPage)，getUser 的网络往返叠起来
  // = 海涛报的「点通知半天才显示内容」。登录态已在 App 启动时校验过(auth-ready)，本地 session 够用。
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return []
  const { data, error } = await supabase
    .from('doc_mentions')
    .select('id, mentioned, completed_at, snippet, docs_visible!inner(owner, section, period_key, tag_id)')
    .eq('author', user.id)
    .not('completed_at', 'is', null)
    .is('completion_seen_at', null)
    .order('completed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((m) => ({
    id: m.id,
    mentioned: m.mentioned,
    completed_at: m.completed_at,
    snippet: m.snippet, // 被@那段的文本
    owner: m.docs_visible.owner,
    section: m.docs_visible.section,
    periodKey: m.docs_visible.period_key,
    tagId: m.docs_visible.tag_id ?? null,
  }))
}

// 作者点掉黄色完成通知（写 completion_seen_at）。
export async function ackCompletion(id) {
  const { error } = await supabase.rpc('ack_completion', { p_id: id })
  if (error) throw error
}

// 我派出去的每个 @ 实例的完成态 → {mid: true=已完成 / false=未完成}。
// 给编辑器里 @ 名字按完成态上色用（完成=黄、未完成=蓝）。按 author=我，故只覆盖自己页上自己派的 @。
export async function loadMyMentionStates() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return {}
  const { data, error } = await supabase
    .from('doc_mentions')
    .select('mention_id, completed_at')
    .eq('author', user.id)
  if (error) return {}
  const map = {}
  for (const r of data ?? []) map[r.mention_id] = r.completed_at != null
  return map
}

// 我最常 @ 谁：统计我发出的 @ 次数 → {personId: count}。给 @ 选择框「常用靠前」排序用。
// 加载一次缓存即可（量不大、按我 author 的历史）。读不到就返回 {} 不影响选择框正常显示。
export async function loadMentionFrequency() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return {}
  const { data, error } = await supabase
    .from('doc_mentions')
    .select('mentioned')
    .eq('author', user.id)
  if (error) return {}
  const freq = {}
  for (const r of data ?? []) freq[r.mentioned] = (freq[r.mentioned] || 0) + 1
  return freq
}
