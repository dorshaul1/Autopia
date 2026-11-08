import { describe, expect, it } from 'vitest'
import { humanizeKeys, taskRef } from '../src/shared/naming'

const tasks = [
  { key: 'T3', title: 'Add the login form', assigneeId: 'maya' },
  { key: 'T4', title: 'Wire the session API', assigneeId: 'theo' },
  { key: 'T4.q', title: 'QA: Wire the session API', assigneeId: 'priya' }
]
const nameOf = (id: string) => ({ maya: 'Maya', theo: 'Theo', priya: 'Priya' })[id] ?? null
const h = (s: string) => humanizeKeys(s, tasks, nameOf)

describe('people, not task keys', () => {
  it('names who does a task and what it is', () => {
    expect(taskRef(tasks[0], nameOf)).toBe('Maya\'s “Add the login form”')
    expect(taskRef(tasks[0], () => null)).toBe('“Add the login form”')
  })

  it('a key as the subject becomes the person', () => {
    expect(h('T3 is stuck')).toBe('Maya is stuck')
    expect(h('T4: repair attempt 1 of 3 by Theo in the same session.')).toBe('Theo: repair attempt 1 of 3 by Theo in the same session.')
  })

  it('a key with its own title collapses to one reference', () => {
    expect(h('Not finished: T3 Add the login form')).toBe('Not finished: Maya\'s “Add the login form”')
    expect(h('Merge T3: Add the login form')).toBe('Merge Maya\'s “Add the login form”')
  })

  it('other mentions say whose work it is; unknown keys and plain text are left alone', () => {
    expect(h('Shares files with T3; starts after it')).toBe('Shares files with Maya\'s “Add the login form”; starts after it')
    expect(h('`npm test` failed in T4.q')).toBe('`npm test` failed in Priya\'s “QA: Wire the session API”')
    expect(h('T9 is not a task here')).toBe('T9 is not a task here')
    expect(h('Nothing to rename')).toBe('Nothing to rename')
  })
})
