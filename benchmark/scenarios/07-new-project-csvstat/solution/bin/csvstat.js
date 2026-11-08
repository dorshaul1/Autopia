#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((x) => x !== ''))
}

export function stats(rows) {
  const [header, ...data] = rows
  const out = []
  header.forEach((name, i) => {
    const cells = data.map((r) => (r[i] ?? '').trim()).filter((x) => x !== '')
    if (!cells.length || !cells.every((x) => x !== '' && !isNaN(Number(x)))) return
    const nums = cells.map(Number)
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length
    out.push(`${name}: count=${nums.length} mean=${mean.toFixed(2)} min=${Math.min(...nums)} max=${Math.max(...nums)}`)
  })
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const file = process.argv[2]
  if (!file || !existsSync(file)) {
    console.error(`csvstat: cannot read ${file ?? '(no file given)'}`)
    process.exit(2)
  }
  console.log(stats(parseCsv(readFileSync(file, 'utf8'))).join('\n'))
}
