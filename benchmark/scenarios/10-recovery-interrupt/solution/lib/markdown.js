// A deliberately small markdown subset: headings, paragraphs, - lists, `code`, **bold**, [links](url).
export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SAFE_URL = /^(https?:\/\/|\/|\.{0,2}\/|#|[\w-]+(?:\/|$|\.\w+))/i

function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      let out = ''
      let last = 0
      for (const m of part.matchAll(/\[([^\]]+)\]\(([^)\s]*(?:\([^)\s]*\))?[^)\s]*)\)/g)) {
        out += emphasis(part.slice(last, m.index))
        const url = m[2]
        out += SAFE_URL.test(url) && !/^\w+:/.test(url.replace(/^https?:/i, '')) ? `<a href="${escapeHtml(url)}">${emphasis(m[1])}</a>` : emphasis(m[0])
        last = m.index + m[0].length
      }
      return out + emphasis(part.slice(last))
    })
    .join('')
}

const emphasis = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

export function toHtml(md) {
  return md
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const h = block.match(/^(#{1,6})\s+(.*)$/)
      if (h) return `<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*- /.test(l))) return `<ul>\n${lines.map((l) => `<li>${inline(l.replace(/^\s*- /, '').trim())}</li>`).join('\n')}\n</ul>`
      return `<p>${inline(block.replace(/\s*\n\s*/g, ' ').trim())}</p>`
    })
    .join('\n')
}
