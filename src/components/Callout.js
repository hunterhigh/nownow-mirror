import { Node, mergeAttributes } from '@tiptap/core'

// 提示块（飞书 Callout 式）：一个带背景色 + 左竖条的块容器，里面可放任意内容。
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-callout') || 'note',
        renderHTML: (attributes) => ({ 'data-callout': attributes.kind || 'note' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'doc-callout' }), 0]
  },
  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    }
  },

  addStorage() {
    return {
      markdown: {
        parse: { setup: setupCalloutMarkdown },
        serialize(state, node) {
          const kind = String(node.attrs.kind || 'note').toUpperCase()
          if (node.attrs.private) state.write('<!-- guanfu:private -->\n')
          state.write(`> [!${kind}]`)
          state.ensureNewLine()
          state.wrapBlock('> ', null, node, () => state.renderContent(node))
          state.closeBlock(node)
        },
      },
    }
  },
})

function setupCalloutMarkdown(md) {
  if (md.__guanfuCallout) return
  md.__guanfuCallout = true

  md.core.ruler.after('block', 'guanfu_callout', (state) => {
    const { tokens } = state
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].type !== 'blockquote_open') continue

      let depth = 1
      let closeIndex = -1
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].type === 'blockquote_open') depth += 1
        if (tokens[cursor].type === 'blockquote_close') depth -= 1
        if (depth === 0) { closeIndex = cursor; break }
      }
      if (closeIndex < 0) continue

      const inline = tokens.slice(index + 1, closeIndex).find((token) => token.type === 'inline')
      const match = inline?.content?.match(/^\[!(NOTE|TIP|INFO|WARNING)\](?:\n|$)/i)
      if (!inline || !match) continue

      const kind = match[1].toLowerCase()
      const privateMarker = tokens[index - 1]?.type === 'html_block'
        && tokens[index - 1].content.trim() === '<!-- guanfu:private -->'
      if (privateMarker) tokens[index - 1].type = 'guanfu_private_marker'
      tokens[index].type = 'guanfu_callout_open'
      tokens[index].meta = { kind, private: privateMarker }
      tokens[closeIndex].type = 'guanfu_callout_close'
      inline.content = inline.content.slice(match[0].length)

      const children = inline.children || []
      if (children[0]?.type === 'text') {
        children[0].content = children[0].content.replace(/^\[!(NOTE|TIP|INFO|WARNING)\]$/i, '')
        if (!children[0].content) children.shift()
        if (children[0]?.type === 'softbreak') children.shift()
      }
    }
  })

  md.renderer.rules.guanfu_callout_open = (tokens, index) =>
    `<div data-callout="${tokens[index].meta.kind}"${tokens[index].meta.private ? ' data-private="true"' : ''} class="doc-callout">`
  md.renderer.rules.guanfu_callout_close = () => '</div>'
  md.renderer.rules.guanfu_private_marker = () => ''
}
