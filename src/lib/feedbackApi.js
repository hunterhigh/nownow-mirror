// 产品反馈墙（migration-033）：使用感受 / bug / 改进建议。
// 全员可见、只能以自己名义发、只能删自己的。v1 不做编辑 —— 反馈是当时的记录。
import { supabase } from './supabase'

export async function listFeedback() {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, author, content, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

export async function submitFeedback(content) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('未登录')
  const { data, error } = await supabase
    .from('feedback')
    .insert({ author: user.id, content })
    .select('id, author, content, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}
