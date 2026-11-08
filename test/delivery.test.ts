import { describe, expect, it } from 'vitest'
import type { CheckResult, Delivery, Task } from '../src/shared/types'
import { parseDiff } from '../src/main/git/review'
import { deliveryLimitations, deliverySummary, revisionScope } from '../src/main/orchestrator/delivery'
import { langFor, tokenize } from '../src/renderer/src/components/workspace/highlight'

const check = (command: string, status: CheckResult['status']): CheckResult => ({ command, status, ok: status === 'passed', ms: 1, output: '', at: 0 })
const task = (p: Partial<Task>): Task => ({ id: 'x', key: 'T1', title: 'Thing', status: 'done', kind: 'code', checks: [], validation: [], changedFiles: [], resultSummary: 'did it', ...p }) as Task

describe('diff parsing', () => {
  const text = [
    'diff --git a/src/app.js b/src/app.js',
    'index 1..2 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,3 +1,4 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' export { a }',
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+hello',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ'
  ].join('\n')
  it('parses files, statuses, counts and line numbers', () => {
    const files = parseDiff(text)
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
      ['src/app.js', 'M', 2, 1, false],
      ['new.txt', 'A', 1, 0, false],
      ['logo.png', 'M', 0, 0, true]
    ])
    const lines = files[0].hunks[0].lines
    expect(lines[1]).toEqual({ t: '-', text: 'const b = 2', oldNo: 2, newNo: null })
    expect(lines[2]).toEqual({ t: '+', text: 'const b = 3', oldNo: null, newNo: 2 })
    expect(lines[4]).toEqual({ t: ' ', text: 'export { a }', oldNo: 3, newNo: 4 })
  })
})

describe('delivery reporting', () => {
  it('summarizes done work and never hides gaps', () => {
    const tasks = [
      task({ key: 'T1', checks: [check('npm test', 'passed')] }),
      task({ key: 'T2', checks: [check('npm test', 'denied')] }),
      task({ key: 'T3', status: 'cancelled' }),
      task({ key: 'T4', checks: [] })
    ]
    expect(deliverySummary(tasks).split('\n')).toHaveLength(3)
    const lim = deliveryLimitations(tasks)
    expect(lim.some((l) => l.includes('T2') && l.includes('declined'))).toBe(true)
    expect(lim.some((l) => l.includes('T3') && l.includes('skipped'))).toBe(true)
    expect(lim.some((l) => l.includes('T4') && l.includes('no automated checks'))).toBe(true)
    expect(lim.some((l) => l.startsWith('T1'))).toBe(false)
  })

  it('scopes a revision to the previous delivery instead of the whole repo', () => {
    const parent = { number: 2, request: 'Build a todo list', summary: 'T1 Todo list: added list.js' } as Delivery
    const s = revisionScope('Make the add button bigger. Also blue.', parent, [task({ validation: ['npm test'] })], ['src/list.js', 'index.html'], '.autopia/feedback/1.png', null)
    expect(s.title).toBe('Make the add button bigger.')
    expect(s.description).toContain('revision of delivery #2')
    expect(s.description).toContain('.autopia/feedback/1.png')
    expect(s.files).toEqual(['src/list.js', 'index.html'])
    expect(s.validation).toEqual(['npm test'])
  })
})

describe('diff highlighting', () => {
  it('tokenizes common languages without evaluating anything', () => {
    expect(langFor('a/b.tsx')).toBe('js')
    const t = tokenize("const x = 'hi' // note", 'js')
    expect(t.map((x) => x.t)).toEqual(['kw', 'plain', 'str', 'plain', 'com'])
  })
})
