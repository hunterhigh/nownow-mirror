import { useEffect, useRef } from 'react'

// 可选头像。只存标识（'a1'…），图片是随前端发布的静态资源 —— 换设计改文件即可，
// 不用动数据库里任何一行。
export const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5']

// 没选过头像时用哪张。**这只是前端的解释方式，数据库里存的仍然是 null。**
// 所以改这一行不需要迁移、不需要回填 80 个用户，改回去也是一行 ——
// 如果把它写进数据库的 default 或者批量 update，就变成一次不可逆的写入了。
export const DEFAULT_AVATAR = 'a3'

// null / 未知值都落到默认头像。现在登录页、标签页图标、桌面图标走的都是这张，
// 所以 /logo.png（兔子）已经没有任何引用了。
export const avatarSrc = (id) => `/avatars/${id && AVATARS.includes(id) ? id : DEFAULT_AVATAR}.png`

export default function AvatarPicker({ current, onPick, onClose }) {
  const ref = useRef(null)

  // 点外面关掉 + Esc 关掉。没有这两样的浮层，在手机上会变成关不掉的东西。
  //
  // ⚠️ 判断"点在外面"用的是 closest('[data-avatar-picker]')，**不是** ref.contains。
  // 原因：Board 的 sidebarContent 被渲染了两份（桌面固定左栏 + 一直挂载的手机抽屉），
  // 所以同时存在两个 AvatarPicker。用 ref.contains 时，另一个实例会认为这次点击
  // 发生在"它的外面"，于是在 mousedown 阶段就把 avatarOpen 关掉 ——
  // 而 onClick 还没来得及触发。表现就是：点了头像，什么也没发生。
  useEffect(() => {
    const onDown = (e) => { if (!e.target?.closest?.('[data-avatar-picker]')) onClose?.() }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
        {/* 不再单列一个"默认"格子：默认就是 a3 本身，两个格子长得一模一样只会让人
            分不清自己选中的是哪个。没选过的人会看到 a3 被高亮 —— 这是实话。 */}
        {AVATARS.map((id) => {
          const active = (current ?? DEFAULT_AVATAR) === id
          return (
            <button
              key={id}
              onClick={() => { onPick?.(id); onClose?.() }}
              title={`头像 ${id}`}
              aria-label={`选择头像 ${id}`}
              aria-pressed={active}
              // cursor-pointer 是显式加的：Tailwind v4 起 <button> 默认是 cursor: default，
              // 不写的话鼠标停在可点的头像上仍然是箭头，看起来像不可点。
              className={'cursor-pointer overflow-hidden rounded-[7px] transition-opacity ' + (active ? '' : 'opacity-70 hover:opacity-100')}
              style={active ? { outline: '2px solid var(--ink)', outlineOffset: '1px' } : undefined}
            >
              <img src={avatarSrc(id)} alt="" className="block h-10 w-10 object-cover" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
