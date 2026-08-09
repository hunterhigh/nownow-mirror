// Cloudflare Pages worker：把 Supabase 全部流量代理到同域名 /sb/* 下。
// 大陆访问 *.supabase.co 慢且不稳，而 now-now.pages.dev 本身可达——
// 让 API/认证/Realtime 全走这个域名，由 Cloudflare 边缘转发（CF→Supabase 是国际线路，快）。
const PRODUCTION_SUPABASE_ORIGIN = 'https://yklskyyirfboamhtzzhp.supabase.co'
const PRODUCTION_HOSTS = new Set(['now-now.pages.dev'])
const BUILD_SUPABASE_ORIGIN = '__NOWNOW_SUPABASE_ORIGIN__'

function cleanOrigin(value) {
  return String(value || '').replace(/\/+$/, '')
}

function getSupabaseOrigin(request, env) {
  const configured = cleanOrigin(env.SUPABASE_ORIGIN || env.VITE_SUPABASE_URL)
  if (configured) return configured

  const buildOrigin = BUILD_SUPABASE_ORIGIN.startsWith('__') ? '' : cleanOrigin(BUILD_SUPABASE_ORIGIN)
  if (buildOrigin) return buildOrigin

  // 生产域名保留老行为，避免本次改动影响线上；任何非生产链接没配 env 时直接失败，
  // 不能悄悄落到生产库。
  const host = new URL(request.url).hostname
  if (PRODUCTION_HOSTS.has(host)) return PRODUCTION_SUPABASE_ORIGIN
  return ''
}

// 正式域名启用后（2026-08-09，nownow.cc），老地址 301 到新域名。
// 重定向精确主机名：老地址 + www 都归到裸域名：
//   · 预览部署（<hash>.now-now.pages.dev）不重定向 —— 那是拿来验证构建的
//   · /sb/* 也重定向 —— 老页面已经打不开了，API 也不该再从老域名走
// 用 301（永久）：让浏览器和搜索引擎记住新地址。
const CANONICAL_HOST = 'nownow.cc'
const REDIRECT_HOSTS = new Set(['now-now.pages.dev', 'www.nownow.cc'])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (REDIRECT_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname.startsWith('/sb/')) {
      const supabaseOrigin = getSupabaseOrigin(request, env)
      if (!supabaseOrigin) {
        return new Response('Missing SUPABASE_ORIGIN for this Pages environment', { status: 500 })
      }
      const target = supabaseOrigin + url.pathname.slice(3) + url.search
      // 用原请求克隆出转发请求：方法/头/体/WebSocket upgrade 全保留
      return fetch(new Request(target, request))
    }

    // 静态资源；未命中的路径回退到 index.html（SPA 路由，如 /login）
    let res = await env.ASSETS.fetch(request)
    if (res.status === 404 && (request.headers.get('accept') || '').includes('text/html')) {
      res = await env.ASSETS.fetch(new Request(new URL('/', url), request))
    }
    return res
  },
}
