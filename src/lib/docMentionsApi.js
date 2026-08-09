// docs 世界的 @通知读取：doc_mentions = 别人在自己文档里 @ 了我。
// **纯通知模型**（海涛 2026-08-09 拍板）：@ 就是知会一声，没有完成/未完成的概念。
// 能做的只有三件事：看（跳过去）、标已读（进页面点开）、忽略（✕ / Clear）。
// 历史上有过"派活→完成→黄色回执"的任务流；complete_mention / ack_completion
// 两个 RPC 和 completed_at 列还留在数据库里（不破坏老数据），但前端不再调用。
// 写入在 docsApi.saveDoc 后的 syncDocMentions；这里只读 + 标已读/忽略。
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
    .select('id, doc_id, author, created_at, read_at, snippet, docs_visible!inner(owner, section, period_key, tag_id)')
    // 被我"忽略"的不再出现；老任务流里勾过"完成"的也不再翻出来（等同已读已忽略）。
    .is('dismissed_at', null)
    .is('completed_at', null)
    .eq('mentioned', user.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((m) => ({
    id: m.id,
    author: m.author,
    created_at: m.created_at,
    read_at: m.read_at,
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
    // 只是为了给 @ 选择框排个序，最近 500 条足够代表"我常 @ 谁"。
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return {}
  const freq = {}
  for (const r of data ?? []) freq[r.mentioned] = (freq[r.mentioned] || 0) + 1
  return freq
}

/** 忽略一条 @ 通知：从我的列表里移走。对方不会收到任何东西 —— 通知本来就不需要回执。 */
export async function dismissMention(id) {
  const { error } = await supabase.rpc('dismiss_mention', { p_id: id })
  if (error) throw error
}
