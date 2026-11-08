// A deliberately small markdown subset: # headings and paragraphs separated by blank lines.
export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function toHtml(md) {
  return md
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const h = block.match(/^(#{1,6})\s+(.*)$/)
      if (h) return `<h${h[1].length}>${escapeHtml(h[2].trim())}</h${h[1].length}>`
      return `<p>${escapeHtml(block.replace(/\s*\n\s*/g, ' ').trim())}</p>`
    })
    .join('\n')
}
