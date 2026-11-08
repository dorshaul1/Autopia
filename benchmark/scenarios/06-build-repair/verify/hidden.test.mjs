import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.BENCH_REPO
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))

test('rename finished, not reverted', () => {
  assert.ok(!existsSync(join(repo, 'src/util/strings.js')), 'strings.js still exists')
  assert.ok(existsSync(join(repo, 'src/util/text.js')))
  for (const f of files(join(repo, 'src'))) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /strings\.js|\btitleCase\b/, f)
  }
})
test('manifest lists the public API', () => {
  const api = JSON.parse(readFileSync(join(repo, 'dist/api.json'), 'utf8'))
  assert.deepEqual(api.exports, ['badge', 'formatName', 'toTitleCase'])
})
test('behaviour unchanged', async () => {
  const m = await import(pathToFileURL(join(repo, 'src/index.js')).href)
  assert.equal(m.formatName('ada', 'LOVELACE'), 'Lovelace, Ada')
  assert.equal(m.badge('grace', 'hopper'), '[GH] Grace')
  assert.equal(m.toTitleCase('  mIxEd case '), 'Mixed Case')
})
