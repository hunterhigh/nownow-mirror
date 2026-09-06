import { Extension, InputRule, wrappingInputRule } from '@tiptap/core'

const TASK_MARKER = /^\s*[-+*]\s+\[([ xX])\]\s$/
const TASK_MARKER_AFTER_BULLET = /^\s*\[([ xX])\]\s$/
const CALLOUT_MARKER = /^>\s+\[!(NOTE|TIP|INFO|WARNING)\]\s$/i
const CALLOUT_MARKER_AFTER_QUOTE = /^\s*\[!(NOTE|TIP|INFO|WARNING)\]\s$/i

function checkedFromMatch(match) {
  return match[1].toLowerCase() === 'x'
}

// StarterKit 已处理标题、普通列表、引用、分隔线和代码围栏。
// 这里只补观复 schema 里没有原生 input rule 的块类型。
export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',

  addInputRules() {
    const { taskItem, callout } = this.editor.schema.nodes
    const rules = []

    if (taskItem) {
      rules.push(wrappingInputRule({
        find: TASK_MARKER,
        type: taskItem,
        getAttributes: (match) => ({ checked: checkedFromMatch(match) }),
      }))
      // 真实逐键输入时，StarterKit 会在 `- ` 阶段先建立普通项目列表。
      // 当紧接着输入 `[ ] ` / `[x] `，把当前项目提升后原子转换为任务项。
      rules.push(new InputRule({
        find: TASK_MARKER_AFTER_BULLET,
        handler: ({ state, range, match, chain }) => {
          const inBulletItem = state.selection.$from.depth > 1
            && state.selection.$from.node(-1).type.name === 'listItem'
            && state.selection.$from.node(-2).type.name === 'bulletList'
          if (!inBulletItem) return null

          chain()
            .deleteRange(range)
            .liftListItem('listItem')
            .toggleTaskList()
            .updateAttributes('taskItem', { checked: checkedFromMatch(match) })
            .run()
        },
      }))
    }
    if (callout) {
      rules.push(wrappingInputRule({
        find: CALLOUT_MARKER,
        type: callout,
        getAttributes: (match) => ({ kind: match[1].toLowerCase() }),
      }))
      // 与任务标记相同，逐键输入时 `> ` 会先触发普通引用规则。
      // 在引用首行完成 `[!TYPE] ` 后，将这一引用转换为相应类型的 Callout。
      rules.push(new InputRule({
        find: CALLOUT_MARKER_AFTER_QUOTE,
        handler: ({ state, range, match, chain }) => {
          const inBlockquote = state.selection.$from.depth > 1
            && state.selection.$from.node(-1).type.name === 'blockquote'
          if (!inBlockquote) return null

          chain()
            .deleteRange(range)
            .lift('blockquote')
            .toggleCallout()
            .updateAttributes('callout', { kind: match[1].toLowerCase() })
            .run()
        },
      }))
    }

    return rules
  },
})
