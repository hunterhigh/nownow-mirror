import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

// Suggestion 在中文输入法 composition 中不能抢走 `/`、`@` 或候选文本。
// Slash 与成员建议共用这个守卫，避免两套输入菜单出现行为漂移。
export function allowSuggestionCommand({ editor }) {
  return !editor.view.composing
}

// 打 `/` 弹插入菜单（飞书/Notion 式）。具体菜单项 + 渲染由 DocEditor 通过 configure 注入。
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // 选中某项 → 删掉 /query 触发文本，再跑该项的命令
        command: ({ editor, range, props }) => props.command({ editor, range }),
      },
    }
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })]
  },
})
