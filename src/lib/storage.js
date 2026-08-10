import { supabase, supabaseBase, supabaseAnonKey } from './supabase'

const BUCKET = 'doc-images'
const AVATAR_BUCKET = 'avatars'

// 上传图片到 Supabase Storage（路径 {uploaderId}/时间戳-随机.ext），返回公开 URL。
// 插入文档时只在 doc_json 存这个 URL，不把图片塞进 JSON。
//
// onProgress(percent 0..100) 可选：传了就走带进度的 XHR 上传（Supabase 的 .upload() 不报进度），
// 给图片节点右上角画上传圈用。没传就走普通 client 上传。
export async function uploadImage(file, uploaderId, onProgress) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `${uploaderId}/${Date.now()}-${rand}.${ext}`

  if (typeof onProgress === 'function') {
    await xhrUpload(path, file, onProgress)
  } else {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || undefined,
      upsert: false,
    })
    if (error) throw error
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// 带上传进度的 XHR 上传：打到 Storage REST 端点（走同一个 /sb 代理 base），
// 用当前登录用户的 access_token 过 RLS（insert 策略要求 authenticated）。
async function xhrUpload(path, file, onProgress) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('未登录，无法上传')

  const url = `${supabaseBase}/storage/v1/object/${BUCKET}/${encodeURI(path)}`
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', supabaseAnonKey)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', '3600')
    if (file.type) xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve() }
      else reject(new Error(`上传失败 ${xhr.status}: ${xhr.responseText || ''}`.trim()))
    }
    xhr.onerror = () => reject(new Error('上传网络错误'))
    xhr.send(file)
  })
}

// ---- 自定义头像 ----
//
// 头像最大显示到 80px（登录页），预设图是 256px。用户随手传的手机照片可能有几 MB，
// 而每个成员的每次页面加载都要下载它 —— 所以**先在浏览器里缩到 256×256 再传**：
// 一张 3MB 的照片压完通常只剩几十 KB，对 80 个人的加载体验是数量级的差别。
const AVATAR_SIZE = 256

/** 把图片按"填满正方形"裁剪缩放到 256×256，输出 webp（不支持就退回 png）。 */
async function squareThumbnail(file) {
  // imageOrientation: 'from-image' 必须显式写：竖着拍的 iPhone 照片，像素其实是横的，
  // 靠 EXIF 里的方向标记纠正。各引擎对默认值不一致（老 Chrome/Safari 按 'none' 处理），
  // 不写的话头像会**永久**歪 90°——方向被烤进导出的 webp 里，之后再也纠不回来。
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bitmap.width, bitmap.height) // 居中裁成正方形，不拉伸变形
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close?.()
  // 不支持 webp 编码的引擎会**静默**吐回 PNG（照样返回 blob），
  // 所以扩展名要认 blob.type，不能认"我请求的是什么"——否则文件名会说谎。
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
  if (!blob) blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('这张图没法处理')
  return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'png' }
}

/**
 * 上传自定义头像，返回**存进 profiles.avatar 的值**：`custom:<uid>/<文件名>`。
 *
 * 返回路径而不是完整 URL —— 完整 URL 会把"当时从哪个域名传的"腌进数据里
 * （本地开发直连 supabase.co、线上走 /sb 代理），换域名或换环境就废。
 * 见 migration-036。
 */
export async function uploadAvatar(file, userId) {
  const { blob, ext } = await squareThumbnail(file)
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = `${userId}/${name}`
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    cacheControl: '31536000', // 文件名带时间戳，内容永不变 —— 可以放心长缓存
    contentType: blob.type || 'image/webp',
    upsert: false,
  })
  if (error) throw error
  return `custom:${path}`
}

/** `custom:<path>` → 当前环境可用的图片 URL（线上自动走 /sb 代理）。 */
export function customAvatarUrl(value) {
  const path = String(value || '').slice('custom:'.length)
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
}
