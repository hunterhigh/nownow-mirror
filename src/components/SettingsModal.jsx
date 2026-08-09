import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Download, Link2, LogOut, Settings as SettingsIcon, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { friendlyDbError } from '../lib/errors'
import { docJsonToMarkdown } from '../lib/markdown'

const SECTION_LABELS = { today: '今日', week: '本周', month: '本月' }

export default function SettingsModal({ onClose, me, email, allEntries, profiles = [], onProfileSaved, variant }) {
  const [handle, setHandle] = useState(me.display_name || me.handle)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [allowed, setAllowed] = useState([])
  const [inviteMsg, setInviteMsg] = useState('')
  const [inviteErr, setInviteErr] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [membersOpen, setMembersOpen] = useState(false)
  const [copiedEmail, setCopiedEmail] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')

  // 修改密码（密码本身是加密存的，没人能"查看"，只能改成新的）
  async function changePassword() {
    setPwMsg('')
    if (newPw.length < 6) { setPwMsg('密码至少 6 位'); return }
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) setPwMsg(error.message)
    else { setPwMsg('密码已更新 ✓'); setNewPw(''); setTimeout(() => setPwMsg(''), 2000) }
  }
  const saveTimer = useRef(null)


  // 名字默认就存（和正文一个习惯，没有保存按钮）
  function handleNameChange(v) {
    setHandle(v)
    setErr('')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistName(v), 600)
  }

  async function persistName(v) {
    const clean = v.trim().replace(/^@/, '')
    if (!clean || /\s/.test(clean)) { setErr('名字不能为空或带空格'); return }
    if (clean === me.display_name) return
    const { error } = await supabase
      .from('profiles')
      .update({ handle: clean.toLowerCase(), display_name: clean })
      .eq('id', me.id)
    if (error) setErr(friendlyDbError(error.message))
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onProfileSaved()
    }
  }

  // 邀请名单：读取 + 添加邮箱 + 移除
  useEffect(() => {
    supabase.from('allowed_emails').select('*').order('created_at').then(({ data, error }) => {
      if (error) setInviteErr('邀请名单加载失败，请稍后重试。')
      else setAllowed(data || [])
    })
     
  }, [])

  async function addEmail() {
    const em = inviteEmail.trim().toLowerCase()
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setInviteErr('这不是一个有效邮箱，检查一下拼写'); return }
    const { error } = await supabase.from('allowed_emails').insert({ email: em, invited_by: me.id })
    if (error) {
      setInviteErr(error.message.includes('duplicate') ? '这个邮箱已经在名单里了' : '没加上：' + error.message)
      return
    }
    setInviteErr('')
    setAllowed((a) => [...a, { email: em, invited_by: me.id }])
    setInviteEmail('')
    const link = `${window.location.origin}/login?email=${encodeURIComponent(em)}`
    setInviteLink(link)
    try {
      await navigator.clipboard.writeText(link)
      setInviteMsg('已复制 ✓')
      setTimeout(() => setInviteMsg(''), 2000)
    } catch { /* 手动复制 */ }
  }

  // 任何成员行都能随时再拿到 ta 的邀请链接（刷新后链接不会丢）
  async function copyInviteLink(em) {
    const link = `${window.location.origin}/login?email=${encodeURIComponent(em)}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedEmail(em)
      setTimeout(() => setCopiedEmail(''), 1500)
    } catch {
      setInviteLink(link) // 复制被浏览器拦了就把链接显示出来手动复制
    }
  }

  async function removeEmail(em) {
    setInviteErr('')
    const { error } = await supabase.from('allowed_emails').delete().eq('email', em)
    if (error) {
      setInviteErr('移出邀请名单失败，请重试。')
      return
    }
    setAllowed((a) => a.filter((x) => x.email !== em))
  }

  // 固定邀请码链接：后端 get_invite_code() 拿码（前端 bundle 不含码），拼 ?invite= 复制
  async function copyFixedInvite() {
    setInviteErr('')
    const { data: code, error } = await supabase.rpc('get_invite_code')
    if (error || !code) { setInviteErr('拿不到邀请码，刷新或确认你已是成员'); return }
    const link = `${window.location.origin}/?invite=${encodeURIComponent(code)}`
    setInviteLink(link)
    try {
      await navigator.clipboard.writeText(link)
      setInviteMsg('已复制 ✓')
      setTimeout(() => setInviteMsg(''), 2000)
    } catch { /* 复制被拦：链接已显示，手动复制 */ }
  }

  // 数据导出：我的全部文档（Tiptap）→ Markdown 下载（数据所有权，flomo 同款理念）。
  // 之前导的是旧「条目」模型(allEntries 已脱钩返空)→ 导出空文件；现在直接从 docs 表取、用 tiptap-markdown 转。
  const [exporting, setExporting] = useState(false)
  async function exportData() {
    setExporting(true)
    try {
      const { data, error } = await supabase
        .from('docs')
        .select('section, period_key, doc_json, updated_at')
        .eq('owner', me.id)
        .order('period_key', { ascending: false })
      if (error) { setErr(friendlyDbError(error)); return }
      const SECS = { today: '今日', week: '本周', month: '本月', stash: '收集箱' }
      const lines = [`# ${me.display_name} 的 NowNow`, '']
      for (const sec of ['today', 'week', 'month', 'stash']) {
        const docs = (data || []).filter((d) => d.section === sec)
        if (!docs.length) continue
        lines.push(`## ${SECS[sec] || sec}`, '')
        for (const d of docs) {
          const md = docJsonToMarkdown(d.doc_json).trim()
          if (!md) continue
          lines.push(sec === 'stash' ? '' : `### ${d.period_key}`, '', md, '')
        }
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `nownow-${me.handle}.md`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setExporting(false)
    }
  }

  // 设置页主体：桌面模态框和手机整页共用
  const body = (
    <>
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold max-md:text-[17px]"><SettingsIcon size={15} /> 设置</h2>

        {/* 个人信息 */}
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500 max-md:text-[12.5px]">个人信息</div>
          <label className="mt-2 block text-xs text-stone-500 max-md:text-[13px]">
            名字（显示用它，@你 也用它；改完自动保存）
            <span className="relative block">
              <input
                value={handle}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={() => { clearTimeout(saveTimer.current); persistName(handle) }}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-[14px] text-stone-900 max-md:text-[16px] outline-none focus:border-stone-400"
              />
              {saved && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-600">已保存 ✓</span>
              )}
            </span>
          </label>
          <label className="mt-3 block text-xs text-stone-500 max-md:text-[13px]">
            登录邮箱（暂不可更改）
            <input
              value={email}
              disabled
              className="mt-1 w-full cursor-not-allowed rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[14px] text-stone-400 max-md:text-[16px] outline-none"
            />
          </label>
          <label className="mt-3 block text-xs text-stone-500 max-md:text-[13px]">
            修改密码
            <span className="mt-1 flex gap-1.5">
              <input
                type="password"
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setPwMsg('') }}
                onKeyDown={(e) => e.key === 'Enter' && changePassword()}
                placeholder="输入新密码（至少 6 位）"
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-3 py-2 text-[14px] text-stone-900 max-md:text-[16px] outline-none focus:border-stone-400"
              />
              <button
                onClick={changePassword}
                disabled={!newPw}
                className="shrink-0 rounded-md bg-[var(--btn-bg)] px-3 py-2 text-[13px] text-[var(--btn-fg)] hover:bg-[var(--btn-bg-hover)] max-md:text-[14.5px] disabled:opacity-30"
              >
                更新
              </button>
            </span>
            {pwMsg && <span className={'mt-1 block text-xs ' + (pwMsg.includes('✓') ? 'text-emerald-600' : 'text-red-600')}>{pwMsg}</span>}
          </label>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        </div>

        {/* 成员 */}
        <div className="mt-5 border-t border-stone-100 pt-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500 max-md:text-[12.5px]">成员</div>
          <button
            onClick={copyFixedInvite}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--btn-bg)] px-3 py-2 text-[13px] text-[var(--btn-fg)] hover:bg-[var(--btn-bg-hover)] max-md:text-[14.5px]"
          >
            <Copy size={13} /> {inviteMsg || '复制邀请链接'}
          </button>
          {inviteErr && <p className="mt-1.5 text-xs text-red-500">{inviteErr}</p>}
          {inviteLink && (
            <div className="mt-2 rounded-md bg-stone-50 px-2.5 py-2 text-xs text-stone-500 select-all break-all">
              {inviteLink}
            </div>
          )}
          <p className="mt-1 text-[11px] text-stone-500 max-md:text-[12.5px]">
            把这个链接发给谁，对方打开就能用邀请码注册进来，无需审批。
          </p>
          {(() => {
            const joined = profiles.filter((p) => p.status !== 'pending')
            const joinedEmails = new Set(joined.map((p) => (p.email || '').toLowerCase()))
            const waiting = allowed.filter((a) => !joinedEmails.has(a.email.toLowerCase()))
            const total = joined.length + waiting.length
            return (
              <div className="mt-2">
                <button
                  onClick={() => setMembersOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs text-stone-400 outline-none hover:text-stone-600 max-md:text-[14px]"
                >
                  {membersOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  成员与邀请名单（{total}）
                </button>
                {membersOpen && (
                  <div className="mt-1.5 space-y-1">
                    {joined.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-2.5 py-1.5 text-xs max-md:py-2 max-md:text-[14px]">
                        <span className="text-stone-700">
                          {p.display_name}
                          {p.id === me.id ? '（我）' : ''}
                        </span>
                        <span className="flex items-center gap-1.5 text-stone-300">
                          {p.email}
                          {p.email && (
                            <button onClick={() => copyInviteLink(p.email)} title="复制邀请链接" aria-label="复制邀请链接" className="text-stone-300 hover:text-stone-600">
                              {copiedEmail === p.email ? <Check size={11} className="text-emerald-500" /> : <Link2 size={11} />}
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                    {waiting.map((a) => (
                      <div key={a.email} className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs max-md:py-2 max-md:text-[14px]">
                        <span className="text-amber-400">已邀请 · 未加入</span>
                        <span className="flex items-center gap-1.5 text-amber-700">
                          {a.email}
                          <button onClick={() => copyInviteLink(a.email)} title="复制邀请链接" aria-label="复制邀请链接" className="text-stone-300 hover:text-stone-600">
                            {copiedEmail === a.email ? <Check size={11} className="text-emerald-500" /> : <Link2 size={11} />}
                          </button>
                          <button onClick={() => removeEmail(a.email)} title="移出名单" aria-label="移出名单" className="text-stone-300 hover:text-red-500">
                            <X size={11} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* 数据与账号 */}
        <div className="mt-5 border-t border-stone-100 pt-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500 max-md:text-[12.5px]">数据与账号</div>
          <button onClick={exportData} disabled={exporting} className="mt-2 flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-700 disabled:opacity-50 max-md:text-[15px]">
            <Download size={13} /> {exporting ? '导出中…' : '导出我的数据（Markdown）'}
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-2 flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-700 max-md:text-[15px]"
          >
            <LogOut size={13} /> 退出登录
          </button>
        </div>
    </>
  )

  // 桌面=模态框（成员名单长了在框内滚动）；手机=和其他页一致的整页（variant="page"）
  if (variant === 'page')
    return (
      <div className="w-full max-w-sm pt-1">
        {body}
      </div>
    )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="paper-scroll max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg border border-stone-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}
