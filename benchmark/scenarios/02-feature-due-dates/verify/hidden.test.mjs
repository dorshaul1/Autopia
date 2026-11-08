import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bin = join(process.env.BENCH_REPO, 'bin/todo.js')
const fresh = () => ({ TODO_FILE: join(mkdtempSync(join(tmpdir(), 'todo-h-')), 'todo.json'), TODO_TODAY: '2026-06-15' })
const run = (env, ...args) => spawnSync('node', [bin, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })
const lines = (r) => r.stdout.trim().split('\n')

test('due dates are shown and overdue is marked', () => {
  const env = fresh()
  assert.equal(run(env, 'add', 'Pay rent', '--due', '2026-06-01').status, 0)
  assert.equal(run(env, 'add', 'Book flights', '--due', '2026-07-01').status, 0)
  assert.equal(run(env, 'add', 'No date').status, 0)
  const out = lines(run(env, 'list'))
  assert.equal(out.length, 3)
  assert.match(out[0], /^\[ \] 1\. Pay rent \(due 2026-06-01\).*OVERDUE$/)
  assert.match(out[1], /^\[ \] 2\. Book flights \(due 2026-07-01\)$/)
  assert.equal(out[2], '[ ] 3. No date')
})
test('done tasks are never overdue; --overdue filters', () => {
  const env = fresh()
  run(env, 'add', 'Old', '--due', '2026-01-01')
  run(env, 'add', 'Also old', '--due', '2026-02-01')
  run(env, 'add', 'Future', '--due', '2027-01-01')
  run(env, 'done', '1')
  assert.doesNotMatch(lines(run(env, 'list'))[0], /OVERDUE/)
  const overdue = lines(run(env, 'list', '--overdue'))
  assert.equal(overdue.length, 1)
  assert.match(overdue[0], /Also old/)
})
test('today itself is not overdue', () => {
  const env = fresh()
  run(env, 'add', 'Today', '--due', '2026-06-15')
  assert.doesNotMatch(run(env, 'list').stdout, /OVERDUE/)
})
for (const bad of ['2026-13-40', 'tomorrow', '2026-02-30']) {
  test(`invalid date ${bad} is rejected and nothing is saved`, () => {
    const env = fresh()
    const r = run(env, 'add', 'Bad', '--due', bad)
    assert.equal(r.status, 1)
    assert.ok(r.stderr.trim().length > 0)
    const saved = existsSync(env.TODO_FILE) ? JSON.parse(readFileSync(env.TODO_FILE, 'utf8')).tasks : []
    assert.equal(saved.length, 0)
  })
}
test('existing commands unchanged', () => {
  const env = fresh()
  run(env, 'add', 'Buy', 'milk')
  run(env, 'done', '1')
  assert.equal(run(env, 'list').stdout, '[x] 1. Buy milk\n')
  assert.equal(run(env, 'done', '9').status, 1)
})
