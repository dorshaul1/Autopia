import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.BENCH_REPO
const { slugify } = await import(pathToFileURL(join(repo, 'lib/slug.js')).href)

test('behaviour unchanged', () => {
  assert.equal(slugify('Crème Brûlée — 2 ways!'), 'creme-brulee-2-ways')
  assert.equal(slugify('Salt & Pepper'), 'salt-and-pepper')
  assert.equal(slugify('  --Hello--  '), 'hello')
  assert.equal(slugify('a b c', { separator: '_' }), 'a_b_c')
  assert.equal(slugify('hello wonderful world', { maxLength: 10 }), 'hello-wond')
  assert.equal(slugify('hello world', { maxLength: 6 }), 'hello')
  assert.equal(slugify(''), '')
  assert.throws(() => slugify(null), TypeError)
})
const tests = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); if (f === 'node_modules' || f.startsWith('.')) return []; return statSync(p).isDirectory() ? tests(p) : /\.test\.[cm]?js$|^test.*\.[cm]?js$/.test(f) || dir.endsWith('/test') ? [p] : [] })
test('a real test suite exists', () => {
  const found = tests(repo)
  assert.ok(found.length > 0, 'no test files')
  const asserts = found.map((f) => (readFileSync(f, 'utf8').match(/assert|expect\(/g) ?? []).length).reduce((a, b) => a + b, 0)
  assert.ok(asserts >= 8, `only ${asserts} assertions`)
})
