import { initials, toTitleCase } from './util/text.js'

export function formatName(first, last) {
  return `${toTitleCase(last)}, ${toTitleCase(first)}`
}

export function badge(first, last) {
  return `[${initials(`${first} ${last}`)}] ${toTitleCase(first)}`
}
