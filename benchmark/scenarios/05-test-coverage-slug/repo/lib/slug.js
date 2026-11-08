// Turns any title into a URL slug: "Crème Brûlée — 2 ways!" → "creme-brulee-2-ways"
export function slugify(input, { separator = '-', maxLength = 80 } = {}) {
  if (typeof input !== 'string') throw new TypeError('slugify expects a string')
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, separator)
  const trimmed = trimSeparator(base, separator)
  if (trimmed.length <= maxLength) return trimmed
  return trimSeparator(trimmed.slice(0, maxLength), separator)
}

function trimSeparator(s, sep) {
  let start = 0
  let end = s.length
  while (s.startsWith(sep, start)) start += sep.length
  while (end > start && s.endsWith(sep, end)) end -= sep.length
  return s.slice(start, end)
}
