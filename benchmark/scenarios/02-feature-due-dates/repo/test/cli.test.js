import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bin = new URL('../bin/todo.js', import.meta.url).pathname
const run = (env, ...args) => execFileSync('node', [bin, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })

test('add, list and done', () => {
  const env = { TODO_FILE: join(mkdtempSync(join(tmpdir(), 'todo-')), 'todo.json') }
  run(env, 'add', 'Buy', 'milk')
  run(env, 'add', 'Call mum')
  run(env, 'done', '1')
  assert.equal(run(env, 'list'), '[x] 1. Buy milk\n[ ] 2. Call mum\n')
})
