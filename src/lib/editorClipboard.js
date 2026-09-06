// Explicit "paste as plain text" path. EditorView.pasteText sets ProseMirror's
// preferPlain flag, so MarkdownClipboard returns null and the default literal
// text parser handles line breaks. Keep this separate from Markdown paste.
export function pasteLiteralText(view, text) {
  return view.pasteText(text)
}

export function clipboardImageFile(clipboardData) {
  return [...(clipboardData?.files || [])].find((file) => file.type?.startsWith('image/')) || null
}

export function handleClipboardImagePaste({ editable, uploaderId, event, insertImage }) {
  if (!editable || !uploaderId) return false
  const file = clipboardImageFile(event.clipboardData)
  if (!file) return false

  event.preventDefault()
  insertImage(file)
  return true
}
