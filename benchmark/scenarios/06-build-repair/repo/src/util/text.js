export function toTitleCase(s) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export function initials(s) {
  return s.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('')
}
