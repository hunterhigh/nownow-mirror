import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'

export default function DocTagBar({ tags, selectedId, editable, ready, onSelect, onCreate, onRename, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const committingRef = useRef(false)
  const mainTag = { id: null, name: 'main', system: true }
  const items = [mainTag, ...tags]
  const hasCustomTags = tags.length > 0
  const selectedCustomIndex = tags.findIndex((tag) => tag.id === selectedId)

  useEffect(() => {
    if (creating || editingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [creating, editingId])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  async function commitDraft() {
    if (committingRef.current) return
    const name = draft.trim()
    if (!name) {
      setCreating(false)
      return
    }
    committingRef.current = true
    try {
      await onCreate(name)
      setDraft('')
      setCreating(false)
    } catch (error) {
      alert(error?.message || '标签创建失败，请重试。')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    } finally {
      committingRef.current = false
    }
  }

  function submitDraft(e) {
    e.preventDefault()
    commitDraft()
  }

  async function commitRename() {
    if (committingRef.current || !editingId) return
    const name = renameDraft.trim()
    const current = tags.find((tag) => tag.id === editingId)
    if (!name || !current || name === current.name) {
      setEditingId(null)
      setRenameDraft('')
      return
    }
    committingRef.current = true
    try {
      await onRename(editingId, name)
      setEditingId(null)
      setRenameDraft('')
    } catch (error) {
      alert(error?.message || '标签重命名失败，请重试。')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    } finally {
      committingRef.current = false
    }
  }

  function submitRename(e) {
    e.preventDefault()
    commitRename()
  }

  function startRename() {
    const tag = tags.find((item) => item.id === selectedId)
    if (!tag) return
    setMenuOpen(false)
    setCreating(false)
    setDraft('')
    setEditingId(tag.id)
    setRenameDraft(tag.name)
  }

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {items.map((tag) => {
          const active = selectedId === tag.id
          if (!tag.system && editingId === tag.id) {
            return (
              <form key={tag.id} onSubmit={submitRename} className="shrink-0">
                <input
                  ref={inputRef}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setRenameDraft('')
                    }
                  }}
                  onBlur={commitRename}
                  className="h-6 w-24 rounded-full border border-stone-200 bg-white px-3 text-[13px] text-stone-800 outline-none focus:border-stone-300"
                />
              </form>
            )
          }
          return (
            <button
              key={tag.id || 'main'}
              type="button"
              onClick={() => onSelect(tag.system ? null : (active ? null : tag.id))}
              className={
                'flex h-6 shrink-0 items-center rounded-full px-3 text-[13px] leading-none transition-colors ' +
                (active
                  ? 'bg-[var(--nav-soft)] text-stone-900'
                  : 'text-stone-500 hover:bg-[var(--nav-soft)] hover:text-stone-900')
              }
            >
              {tag.name}
            </button>
          )
        })}
        {creating && (
          <form onSubmit={submitDraft} className="shrink-0">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft('')
                  setCreating(false)
                  setEditingId(null)
                  setRenameDraft('')
                }
              }}
              onBlur={commitDraft}
              placeholder="新标签"
              className="h-6 w-24 rounded-full border border-stone-200 bg-white px-3 text-[13px] text-stone-800 outline-none focus:border-stone-300"
            />
          </form>
        )}
      </div>
      {editable && (
        <div ref={menuRef} className="relative flex w-9 shrink-0 justify-end">
          <button
            type="button"
            onClick={() => {
              if (!ready) return
              if (!hasCustomTags) {
                setEditingId(null)
                setRenameDraft('')
                setCreating(true)
                return
              }
              setMenuOpen((v) => !v)
            }}
            disabled={!ready}
            title={ready ? (hasCustomTags ? '标签管理' : '新建标签') : '标签数据准备中'}
            className={
              'flex h-6 w-9 items-center justify-center bg-[var(--nav-soft)] text-stone-500 hover:text-stone-900 disabled:opacity-40 ' +
              (hasCustomTags ? 'rounded-md' : 'rounded-full')
            }
          >
            {hasCustomTags ? <MoreHorizontal size={16} /> : <Plus size={16} />}
          </button>
          {hasCustomTags && menuOpen && (
            <div className="absolute right-0 top-7 z-30 w-28 rounded-lg border border-stone-200 bg-white p-1 text-[13px] shadow-lg">
              <button
                type="button"
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-stone-700 hover:bg-stone-100"
                onClick={() => {
                  setMenuOpen(false)
                  setEditingId(null)
                  setRenameDraft('')
                  setCreating(true)
                }}
              >
                新建标签
              </button>
              {selectedCustomIndex >= 0 && (
                <>
                  <button
                    type="button"
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-stone-700 hover:bg-stone-100"
                    onClick={startRename}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-red-500 hover:bg-red-50"
                    onClick={() => {
                      setMenuOpen(false)
                      onDelete(selectedId)
                    }}
                  >
                    删除标签
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
