import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.BENCH_REPO
const { toHtml } = await import(pathToFileURL(join(repo, 'lib/markdown.js')).href)
const flat = (s) => s.replace(/\n/g, '')

test('existing behaviour', () => {
  assert.equal(toHtml('# Title\n\nHello\nworld & <you>'), '<h1>Title</h1>\n<p>Hello world &amp; &lt;you&gt;</p>')
})
test('unordered lists', () => {
  assert.equal(flat(toHtml('- one\n- two & three')), '<ul><li>one</li><li>two &amp; three</li></ul>')
})
test('inline code, escaped and not further formatted', () => {
  assert.equal(toHtml('Use `a < b` here'), '<p>Use <code>a &lt; b</code> here</p>')
  assert.equal(toHtml('`**not bold**`'), '<p><code>**not bold**</code></p>')
})
test('bold', () => assert.equal(toHtml('a **big** deal'), '<p>a <strong>big</strong> deal</p>'))
test('links', () => {
  assert.equal(toHtml('see [docs](https://x.dev/a?b=1&c=2)'), '<p>see <a href="https://x.dev/a?b=1&amp;c=2">docs</a></p>')
  assert.equal(toHtml('[rel](/path)'), '<p><a href="/path">rel</a></p>')
})
test('dangerous links are not rendered as links', () => {
  const out = toHtml('[x](javascript:alert(1))')
  assert.doesNotMatch(out, /<a\b/)
  assert.doesNotMatch(toHtml('[x](" onmouseover="y)'), /<a[^>]*onmouseover/)
})
test('formatting inside list items', () => {
  assert.equal(flat(toHtml('- **a** and `b`')), '<ul><li><strong>a</strong> and <code>b</code></li></ul>')
})
test('no leftover partial state', () => {
  const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f === '.git' ? [] : statSync(p).isDirectory() ? files(p) : [p] })
  for (const f of files(repo)) {
    assert.doesNotMatch(f, /\.(orig|rej|tmp|bak)$|~$/, `stray file ${f}`)
    if (/\.[cm]?js$/.test(f)) assert.doesNotMatch(readFileSync(f, 'utf8'), /^(<<<<<<<|>>>>>>>) /m, f)
  }
})
