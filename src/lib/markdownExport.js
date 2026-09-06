import { docJsonToMarkdown } from './markdown'

const SECTION_ORDER = ['today', 'week', 'month', 'stash']
const SECTION_LABELS = {
  today: '今日',
  week: '本周',
  month: '本月',
  stash: '收集箱',
}

export function buildMarkdownExport({ displayName, docs = [] }) {
  const lines = [`# ${displayName} 的观复`, '']

  for (const section of SECTION_ORDER) {
    const content = docs
      .filter((doc) => doc.section === section)
      .map((doc) => ({ doc, markdown: docJsonToMarkdown(doc.doc_json).trim() }))
      .filter((item) => item.markdown)
    if (!content.length) continue

    lines.push(`## ${SECTION_LABELS[section]}`, '')
    for (const { doc, markdown } of content) {
      if (section !== 'stash') lines.push(`### ${doc.period_key}`, '')
      lines.push(markdown, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}
