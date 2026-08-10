import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { customAvatarUrl } from '../lib/storage'
import { report } from '../lib/report'

// 可选头像。只存标识（'a1'…），图片是随前端发布的静态资源 —— 换设计改文件即可，
// 不用动数据库里任何一行。
export const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5']

// 没选过头像时用哪张。**这只是前端的解释方式，数据库里存的仍然是 null。**
// 所以改这一行不需要迁移、不需要回填 80 个用户，改回去也是一行 ——
// 如果把它写进数据库的 default 或者批量 update，就变成一次不可逆的写入了。
export const DEFAULT_AVATAR = 'a3'

// 自定义头像存的是 `custom:<uid>/<file>`（storage 路径，不是完整 URL —— 见 migration-036），
// 这里按当前环境现拼 URL：线上自动走 /sb 代理，换域名也不用回填数据。
export const isCustomAvatar = (id) => typeof id === 'string' && id.startsWith('custom:')

// null / 未知值都落到默认头像。现在登录页、标签页图标、桌面图标走的都是这张，
// 所以 /logo.png（兔子）已经没有任何引用了。
export const avatarSrc = (id) => {
  if (isCustomAvatar(id)) return customAvatarUrl(id)
  return `/avatars/${id && AVATARS.includes(id) ? id : DEFAULT_AVATAR}.png`
}

// 传太大的图会让**每个成员的每次加载**都背上它 —— 上传前会在浏览器里缩到 256px，
// 这个上限只是挡住"误选了一个 50MB 的原图"，不是最终体积。
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export default function AvatarPicker({ current, onPick, onClose, onUpload }) {
  const ref = useRef(null)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 点外面关掉 + Esc 关掉。没有这两样的浮层，在手机上会变成关不掉的东西。
  //
  // ⚠️ 判断"点在外面"用的是 closest('[data-avatar-picker]')，**不是** ref.contains。
  // 原因：Board 的 sidebarContent 被渲染了两份（桌面固定左栏 + 一直挂载的手机抽屉），
  // 所以同时存在两个 AvatarPicker。用 ref.contains 时，另一个实例会认为这次点击
  // 发生在"它的外面"，于是在 mousedown 阶段就把 avatarOpen 关掉 ——
  // 而 onClick 还没来得及触发。表现就是：点了头像，什么也没发生。
  // 上传过程中不许关：关掉 = 组件卸载，失败提示就落在一个不存在的组件上，
  // 而 Board 那边刻意不弹 alert（交给这里显示）——两下一凑就是彻底的静默失败：
  // 用户以为换好了，实际什么也没发生。busy 期间锁住这两个出口。
  useEffect(() => {
    const onDown = (e) => { if (!busy && !e.target?.closest?.('[data-avatar-picker]')) onClose?.() }
    const onKey = (e) => { if (!busy && e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, busy])

  async function pickFile(file) {
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) { setErr('这不是图片文件'); return }
    if (file.size > MAX_UPLOAD_BYTES) { setErr('图片太大了（超过 20MB）'); return }
    setBusy(true)
    try {
      await onUpload?.(file)
      onClose?.()
    } catch (e) {
      // 失败必须说出来：静默失败会让人以为"换好了"，下次刷新才发现没换
      setErr('上传失败，换张图或稍后再试')
      // 也要上报：否则线上"所有人都传不上"这种事（比如存桶没建）你只能等人来投诉
      report('avatar-upload', e, { size: file.size, type: file.type })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = '' // 同一张图再选一次也要能触发 change
    }
  }

  const custom = isCustomAvatar(current)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="选择头像"
      data-avatar-picker=""
      className="absolute left-0 top-full z-30 mt-1 w-[148px] rounded-lg p-1.5 shadow-lg"
      style={{ background: 'var(--surface)' }}
    >
      <div className="grid grid-cols-3 gap-1.5">
        {/* 「+」放第一格（海涛）：自定义是主动作，预设是备选，主动作该在最前。 */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="上传自己的头像"
          aria-label="上传自己的头像"
          className={
            'flex h-10 w-10 cursor-pointer items-center justify-center rounded-[7px] border border-dashed transition-colors ' +
            (busy ? 'opacity-60' : 'hover:bg-[var(--nav-soft)]')
          }
          style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-muted)' }}
        >
          <Plus size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {/* 不再单列一个"默认"格子：默认就是 a3 本身，两个格子长得一模一样只会让人
            分不清自己选中的是哪个。没选过的人会看到 a3 被高亮 —— 这是实话。 */}
        {AVATARS.map((id) => {
          const active = !custom && (current ?? DEFAULT_AVATAR) === id
          return (
            <button
              key={id}
              onClick={() => { onPick?.(id); onClose?.() }}
              disabled={busy} // 上传中别让人再选预设：两个写入竞速，最后谁落地全看运气
              title={`头像 ${id}`}
              aria-label={`选择头像 ${id}`}
              aria-pressed={active}
              // cursor-pointer 是显式加的：Tailwind v4 起 <button> 默认是 cursor: default，
              // 不写的话鼠标停在可点的头像上仍然是箭头，看起来像不可点。
              //
              // **选中态不再画任何框**（海涛：什么都不需要）。靠透明度区分：
              // 没选中的一律 70% 透明，选中那张是唯一全亮的 —— 五张图并排时
              // 这个对比已经够读，再加边框反而是在柔和的配色上砸一道硬线。
              className={'cursor-pointer overflow-hidden rounded-[7px] transition-opacity ' + (active ? '' : 'opacity-70 hover:opacity-100')}
            >
              <img src={avatarSrc(id)} alt="" className="block h-10 w-10 object-cover" />
            </button>
          )
        })}
      </div>
      {busy && <p className="mt-1.5 px-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>上传中…</p>}
      {err && <p className="mt-1.5 px-0.5 text-[11px] text-red-500">{err}</p>}
    </div>
  )
}
