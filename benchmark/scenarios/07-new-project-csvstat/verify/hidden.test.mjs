import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.env.BENCH_REPO
const fx = (f) => join(process.env.BENCH_VERIFY, 'fixtures', f)
const run = (...a) => spawnSync('node', [join(repo, 'bin/csvstat.js'), ...a], { encoding: 'utf8' })

test('basic numeric columns', () => {
  const r = run(fx('basic.csv'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), ['age: count=3 mean=34.33 min=28 max=41', 'score: count=2 mean=90.25 min=88.5 max=92'].join('\n'))
})
test('quoted fields and empty cells', () => {
  const r = run(fx('quoted.csv'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), ['price: count=3 mean=5.75 min=-2.25 max=12.5', 'qty: count=2 mean=6.50 min=3 max=10'].join('\n'))
})
test('missing file exits 2', () => {
  const r = run(join(repo, 'nope.csv'))
  assert.equal(r.status, 2)
  assert.ok(r.stderr.trim())
})
test('project hygiene', () => {
  assert.ok(existsSync(join(repo, 'README.md')))
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length)
  assert.ok(pkg.scripts?.test)
})
