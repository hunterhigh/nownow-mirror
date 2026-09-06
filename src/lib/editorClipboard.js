// Explicit "paste as plain text" path. EditorView.pasteText sets ProseMirror's
// preferPlain flag, so MarkdownClipboard returns null and the default literal
// text parser handles line breaks. Keep this separate from Markdown paste.
export function pasteLiteralText(view, text) {
  return view.pasteText(text)
}
