import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONABLE, PRIORITY, categorize, dedupeKey, employeeAttention, isResolved, shouldAlert, type Facts } from '../src/main/attention'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

const facts = (f: Partial<Facts> = {}): Facts => ({ pendingApprovals: new Set(), deliveries: new Map(), tasks: new Map(), usageHeld: false, ...f })

describe('only what needs you is actionable', () => {
  it('classifies real events by what they are about', () => {
    expect(categorize('decision', 'Plan for Shop', { approvalKind: 'plan' })).toBe('approval')
    expect(categorize('decision', 'Maya wants to run a command', { approvalKind: 'permission' })).toBe('approval')
    expect(categorize('decision', 'Maya: question for you', { approvalKind: 'question' })).toBe('question')
    expect(categorize('failure', 'Maya is stuck', { approvalKind: 'task_failed' })).toBe('blocked')
    expect(categorize('decision', 'Maya was interrupted', { approvalKind: 'task_failed' })).toBe('interrupted')
    expect(categorize('decision', 'Result #2 is ready to review', { deliveryId: 'd2' })).toBe('review')
    expect(categorize('decision', 'Claude usage limit reached', { usage: true })).toBe('usage')
    expect(categorize('failure', 'Checks failed', {})).toBe('failure')
    expect(categorize('delivered', 'Finished: Shop', {})).toBe('outcome')
    expect(categorize('manager', 'Planning stalled', {})).toBe('info')
  })

  it('news is never an open item; blockers rank above results', () => {
    expect(ACTIONABLE.has('outcome')).toBe(false)
    expect(ACTIONABLE.has('info')).toBe(false)
    expect(PRIORITY.approval).toBeGreaterThan(PRIORITY.review)
    expect(PRIORITY.blocked).toBeGreaterThan(PRIORITY.interrupted)
  })
})

describe('one item per condition, resolved when its cause is gone', () => {
  it('keys a condition by its cause', () => {
    expect(dedupeKey({ projectId: 'p', taskId: 't', title: 'x', approvalId: 'a1', category: 'blocked' })).toBe('approval:a1')
    expect(dedupeKey({ projectId: 'p', taskId: null, title: 'Result #3', deliveryId: 'd3', category: 'review' })).toBe('delivery:d3:review')
    expect(dedupeKey({ projectId: 'p', taskId: 't', title: 'x', category: 'usage' })).toBe('usage:hold')
    // numbers in a title don't make a new condition
    expect(dedupeKey({ projectId: 'p', taskId: null, title: 'Checks failed (2)', category: 'failure' })).toBe(dedupeKey({ projectId: 'p', taskId: null, title: 'Checks failed (5)', category: 'failure' }))
  })

  it('closes on the real state: decided, reviewed, moved on, limit reset', () => {
    expect(isResolved({ category: 'approval', approvalId: 'a1', deliveryId: null, taskId: null }, facts({ pendingApprovals: new Set(['a1']) }))).toBe(false)
    expect(isResolved({ category: 'approval', approvalId: 'a1', deliveryId: null, taskId: null }, facts())).toBe(true)
    expect(isResolved({ category: 'review', approvalId: null, deliveryId: 'd1', taskId: null }, facts({ deliveries: new Map([['d1', { status: 'review' }]]) }))).toBe(false)
    expect(isResolved({ category: 'review', approvalId: null, deliveryId: 'd1', taskId: null }, facts({ deliveries: new Map([['d1', { status: 'accepted' } as never]]) }))).toBe(true)
    expect(isResolved({ category: 'blocked', approvalId: null, deliveryId: null, taskId: 't' }, facts({ tasks: new Map([['t', { status: 'running' }]]) }))).toBe(true)
    expect(isResolved({ category: 'usage', approvalId: null, deliveryId: null, taskId: null }, facts({ usageHeld: true }))).toBe(false)
    expect(isResolved({ category: 'usage', approvalId: null, deliveryId: null, taskId: null }, facts())).toBe(true)
  })

  it('persists in the database: repeats count on one item, open items survive a restart, resolution sticks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopia-attn-'))
    const file = join(dir, 'a.db')
    try {
      let repo = new Repo(openDatabase(file))
      const first = repo.addNotification({ projectId: null, taskId: null, kind: 'decision', title: 'Result #1 is ready to review', body: '2 tasks done.', category: 'review', key: 'delivery:d1:review', deliveryId: 'd1', priority: 50, resolved: false })
      repo.markNotificationsRead([first.id])
      // the same, unchanged: still read, counted
      const again = repo.repeatNotification(repo.openNotification('delivery:d1:review')!.id, { title: first.title, body: first.body })
      expect([again.id, again.count, again.read]).toEqual([first.id, 2, true])
      // what it says changed: unread again
      expect(repo.repeatNotification(first.id, { title: first.title, body: '3 tasks done.' }).read).toBe(false)
      // news is history from the start
      expect(repo.addNotification({ projectId: null, taskId: null, kind: 'milestone', title: 'Halfway', body: '' }).resolvedAt).not.toBeNull()

      repo = new Repo(openDatabase(file)) // restart
      expect(repo.openNotifications().map((n) => n.key)).toEqual(['delivery:d1:review'])
      expect(repo.notifications()[0].key).toBe('delivery:d1:review') // open items come first, however old
      repo.resolveNotification(first.id)
      expect(repo.openNotification('delivery:d1:review')).toBeNull()
      expect(new Repo(openDatabase(file)).openNotifications()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('desktop notifications', () => {
  const prefs = { desktop: DEFAULT_SETTINGS.desktopNotifications, quiet: DEFAULT_SETTINGS.quietMode }
  it('only in the background, only for what needs you, never repeated, never in quiet mode', () => {
    expect(prefs).toEqual({ desktop: 'important', quiet: false })
    expect(shouldAlert({ category: 'approval', repeat: false }, prefs, false)).toBe(true)
    expect(shouldAlert({ category: 'approval', repeat: false }, prefs, true)).toBe(false) // you're looking at it
    expect(shouldAlert({ category: 'approval', repeat: true }, prefs, false)).toBe(false) // unchanged condition
    expect(shouldAlert({ category: 'outcome', repeat: false }, prefs, false)).toBe(false)
    expect(shouldAlert({ category: 'outcome', repeat: false }, { ...prefs, desktop: 'all' }, false)).toBe(true)
    expect(shouldAlert({ category: 'info', repeat: false }, { ...prefs, desktop: 'all' }, false)).toBe(false)
    expect(shouldAlert({ category: 'blocked', repeat: false }, { ...prefs, quiet: true }, false)).toBe(false)
    expect(shouldAlert({ category: 'blocked', repeat: false }, { ...prefs, desktop: 'off' }, false)).toBe(false)
  })
})

describe('indicators above teammates', () => {
  const tasks = [
    { id: 't1', assigneeId: 'maya', status: 'failed' as const, deliveryId: 'd1', projectId: 'p1' },
    { id: 't2', assigneeId: 'theo', status: 'done' as const, deliveryId: 'd2', projectId: 'p2' },
    { id: 't3', assigneeId: 'maya', status: 'running' as const, deliveryId: 'd1', projectId: 'p1' }
  ]
  it('one per person, the most pressing first, across projects, from real records only', () => {
    const items = employeeAttention({
      approvals: [
        { id: 'a1', kind: 'task_failed', projectId: 'p1', taskId: 't1', title: 'Maya is stuck' },
        { id: 'a2', kind: 'permission', projectId: 'p1', taskId: 't3', title: 'Maya wants to run a command' },
        { id: 'a3', kind: 'plan', projectId: 'p2', taskId: null, title: 'Plan for Shop' }
      ],
      tasks,
      deliveries: [{ id: 'd2', status: 'review', projectId: 'p2', number: 2 }],
      pmOf: () => 'priya'
    })
    const by = Object.fromEntries(items.map((i) => [i.employeeId, i]))
    expect(by.maya).toMatchObject({ kind: 'approval', approvalId: 'a2', projectId: 'p1' }) // permission outranks blocked
    expect(by.priya).toMatchObject({ kind: 'approval', approvalId: 'a3', label: 'Plan ready for your approval' })
    expect(by.theo).toMatchObject({ kind: 'review', deliveryId: 'd2', projectId: 'p2' })
    expect(items).toHaveLength(3)
  })

  it('nothing pending: no indicators (a finished result already reviewed shows nothing)', () => {
    expect(employeeAttention({ approvals: [], tasks, deliveries: [{ id: 'd2', status: 'accepted' as never, projectId: 'p2', number: 2 }], pmOf: () => 'priya' })).toEqual([])
  })
})

describe('a failed result stops needing you once it is decided', () => {
  it('closes when the result is no longer waiting for review', async () => {
    const { isResolved } = await import('../src/main/attention')
    const n = { category: 'failure', approvalId: null, deliveryId: 'd', taskId: null } as never
    const facts = (status: string) => ({ pendingApprovals: new Set<string>(), deliveries: new Map([['d', { status }]]), tasks: new Map(), usageHeld: false }) as never
    expect(isResolved(n, facts('review'))).toBe(false)
    expect(isResolved(n, facts('accepted'))).toBe(true)
    expect(isResolved(n, facts('validating'))).toBe(true)
  })
})
