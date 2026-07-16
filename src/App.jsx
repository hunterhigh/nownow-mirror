import { Component, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login'
import Board from './Board'

// 任何渲染崩溃都显示可操作的错误页，绝不白屏
class ErrorBoundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) {
    return { err }
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">页面出错了：{String(this.state.err?.message || this.state.err)}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-[var(--btn-bg)] px-4 py-2 text-sm text-[var(--btn-fg)]"
        >
          刷新重试
        </button>
      </div>
    )
  }
}

// 整个产品就两个页面：登录页 + 主页面（首次起名是主页面里的一张卡）
const INVITE_KEY = 'nownow_invite'
const APP_ENV = import.meta.env.VITE_APP_ENV || 'production'
const AUTH_BOOT_TIMEOUT_MS = 12_000

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('认证服务连接超时')), timeoutMs)
    }),
  ])
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [ready, setReady] = useState(false) // 登录态已向服务器校验/刷新完成，才渲染主页发查询
  const [bootError, setBootError] = useState('')

  // 邀请链接：?invite=token 先存起来（magic link 跳转会丢 query），登录后兑换
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('invite')
    if (t) {
      localStorage.setItem(INVITE_KEY, t)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), AUTH_BOOT_TIMEOUT_MS)
        if (data.session) {
          // 本地缓存的 session 可能已失效/access_token 过期。getUser 向服务器校验、
          // 并在 client 内部把 token 刷新到有效——失效就登出回登录页。
          const { data: u, error } = await withTimeout(
            supabase.auth.getUser(),
            AUTH_BOOT_TIMEOUT_MS,
          )
          if (!alive) return
          if (error || !u?.user) {
            await supabase.auth.signOut({ scope: 'local' })
            setSession(null)
            return
          }
          // getUser 后 client 已持有有效(可能刚刷新)的 token。重取一次拿最新 session再渲染，
          // 保证 Board 首次发查询(loadProfiles/docs)一定带着有效 token。
          const { data: fresh } = await withTimeout(
            supabase.auth.getSession(),
            AUTH_BOOT_TIMEOUT_MS,
          )
          if (!alive) return
          setSession(fresh.session || data.session)
        } else {
          setSession(null)
        }
      } catch (error) {
        if (!alive) return
        console.error('[auth-bootstrap] failed:', error)
        setBootError('暂时无法连接服务，请稍后重试。你的本地内容和登录信息没有被删除。')
      } finally {
        if (alive) setReady(true)
      }
    })()
    // 注意：onAuthStateChange 启动时会立刻拿 localStorage 里(可能过期)的 session 触发 INITIAL_SESSION。
    // 渲染门控在 ready(校验完成)上，所以不会用未校验的 stale session 抢先渲染 Board、发出 anon 查询。
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (alive) setSession(s) })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  if (!ready || session === undefined) return null
  if (bootError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">{bootError}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-[var(--btn-bg)] px-4 py-2 text-sm text-[var(--btn-fg)]"
        >
          重新连接
        </button>
      </div>
    )
  }
  // 关键：必须有 session.user.id 才算真登录。session 存在但 user.id 为空时（token 失效/掉登录态）
  // 绝不渲染 Board——否则 Board 会拿 owner=null 去查/存（页面全空、看着像"数据全丢"，实则只是掉登录）。
  const authed = !!session?.user?.id
  // /login：未登录时显示登录页；登录成功后地址改回 / 并直接进主页
  // （之前这里无条件渲染登录页，导致登录成功了页面也"没反应"）
  if (window.location.pathname === '/login') {
    if (!authed)
      return (
        <ErrorBoundary>
          <Login />
        </ErrorBoundary>
      )
    window.history.replaceState(null, '', '/')
  }
  return (
    <ErrorBoundary>
      {APP_ENV !== 'production' && (
        <div className="fixed right-3 top-3 z-[1000] rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)] shadow-sm">
          {APP_ENV}
        </div>
      )}
      {authed ? <Board session={session} /> : <Login />}
    </ErrorBoundary>
  )
}
