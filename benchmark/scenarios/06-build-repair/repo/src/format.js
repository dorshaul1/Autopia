import { titleCase } from './util/strings.js'
import { initials } from './util/text.js'

export function formatName(first, last) {
  return `${titleCase(last)}, ${titleCase(first)}`
}

export function badge(first, last) {
  return `[${initials(`${first} ${last}`)}] ${titleCase(first)}`
}
