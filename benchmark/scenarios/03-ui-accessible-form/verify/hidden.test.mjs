import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const pub = join(process.env.BENCH_REPO, 'public')
const html = readFileSync(join(pub, 'index.html'), 'utf8')
const css = readdirSync(pub).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(pub, f), 'utf8')).join('\n') + [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
const js = readdirSync(pub).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(pub, f), 'utf8')).join('\n')
const form = html.match(/<form[\s\S]*?<\/form>/)?.[0] ?? ''
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]

test('field names are unchanged', () => {
  const names = [...form.matchAll(/<input\b[^>]*>/gi)].map((m) => attr(m[0], 'name'))
  for (const n of ['displayName', 'email', 'password']) assert.ok(names.includes(n), `missing field ${n}`)
})
test('every input has a visible label', () => {
  const labels = [...html.matchAll(/<label\b[^>]*>/gi)].map((m) => attr(m[0], 'for'))
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const id = attr(m[0], 'id')
    const wrapped = new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*name=["']${attr(m[0], 'name')}["']`, 'i').test(html)
    assert.ok((id && labels.includes(id)) || wrapped, `${attr(m[0], 'name')} has no <label>`)
  }
})
test('submit is a real button inside the form', () => {
  assert.match(form, /<button\b(?![^>]*type=["'](?:button|reset)["'])[^>]*>/i)
  assert.doesNotMatch(html, /<div[^>]*onclick/i)
})
test('errors are inline and announced, no alert()', () => {
  assert.doesNotMatch(js, /\balert\s*\(/)
  assert.match(html + js, /aria-live|role=["']alert["']|setAttribute\(\s*["']role["']\s*,\s*["']alert|aria-describedby|ariaDescribedBy|aria-errormessage/)
  assert.match(js, /aria-invalid|ariaInvalid/)
})
test('focus stays visible', () => {
  const removes = /outline\s*:\s*(none|0)\b/.test(css)
  const restores = /:focus(-visible|-within)?[^{]*\{[^}]*(outline\s*:\s*(?!none|0\b)[^;}]+|box-shadow\s*:\s*(?!none)[^;}]+)/.test(css)
  assert.ok(!removes || restores, 'outline removed without a :focus replacement')
})
function hex(c) {
  c = c.replace('#', '')
  if (c.length === 3) c = [...c].map((x) => x + x).join('')
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
}
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
test('text colours meet WCAG AA on their background', () => {
  // each rule's `color` against its own background when it declares one, else the page (white)
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = rule[2]
    const color = body.match(/(?:^|;|\s)color\s*:\s*(#[0-9a-f]{3,6})\b/i)?.[1]
    if (!color) continue
    const bg = body.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i)?.[1] ?? '#ffffff'
    assert.ok(contrast(color, bg) >= 4.5, `${rule[1].trim()} ${color} on ${bg} is ${contrast(color, bg).toFixed(2)}:1`)
  }
})
test('validation rules unchanged', async () => {
  const { validate } = await import(pathToFileURL(join(pub, 'validate.js')).href)
  assert.deepEqual(Object.keys(validate({})).sort(), ['displayName', 'email', 'password'])
  assert.deepEqual(validate({ displayName: 'A', email: 'a@b.co', password: '12345678' }), {})
  assert.ok(validate({ displayName: 'A', email: 'a@b.co', password: '1234567' }).password)
})
