import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collaboratorsOf, deliveryFacts, missionHeadline, missionOf, overlapLine, taskActions, } from '../src/shared/mission'
import type { Task } from '../src/shared/types'

const t = (id: string, over: Partial<Task> = {}): Task => ({ id, projectId: 'p', deliveryId: 'd', key: id.toUpperCase(), title: `Step ${id}`, description: '', acceptance: '', kind: 'code', assigneeId: 'ines', status: 'pending', dependsOn: [], sortOrder: 0, attempts: 0, sessionId: null, resultSummary: null, lastError: null, changedFiles: [], rationale: null, size: 's', files: [], validation: [], checks: [], model: null, fixAttempts: 0, conflicts: 0, priority: 0, skills: [], consults: 0, note: null, startedAt: null, finishedAt: null, qualityPlan: null, criteria: [], repairStop: null, recovery: null, milestone: null, createdAt: 1, ...over }) as Task
const nameOf = (id: string) => ({ ines: 'Inés', kenji: 'Kenji' })[id] ?? null
const read = (tasks: Task[], approvals: never[] = [], paused = false) => missionOf({ tasks, approvals, paused, busyName: () => null, nameOf })

describe('reading the work', () => {
  it('puts each step where it really stands', () => {
    const m = read([t('a', { status: 'running', files: ['a.js'] }), t('b', { status: 'failed', lastError: 'npm test failed\nmore', files: ['b.js'] }), t('c', { dependsOn: ['b'], files: ['c.js'] }), t('d', { dependsOn: ['a'], files: ['d.js'] }), t('e', { files: ['e.js'], assigneeId: 'kenji' }), t('f', { status: 'done' }), t('g', { status: 'cancelled' }), t('h', { status: 'proposed' })])
    expect(m.now.map((i) => i.task.id)).toEqual(['a'])
    expect(m.needsYou[0].reason).toBe('npm test failed')
    expect(m.next.map((i) => [i.task.id, i.state])).toEqual([['c', 'blocked'], ['e', 'ready'], ['d', 'waiting']])
    expect(m.done.map((i) => i.task.id)).toEqual(['f'])
    expect(m.dropped.map((i) => i.task.id)).toEqual(['g'])
    expect(m.planned.map((i) => i.task.id)).toEqual(['h'])
  })
  it('a blocked step names its real cause, and a question outranks everything', () => {
    const m = missionOf({ tasks: [t('a', { status: 'failed' }), t('b', { dependsOn: ['a'], assigneeId: 'kenji' }), t('c', { status: 'running' })], approvals: [{ taskId: 'c', status: 'pending', kind: 'question', title: 'Which logo?' }], busyName: () => null, nameOf })
    expect(m.next[0].reason).toMatch(/^Blocked/)
    expect(m.next[0].reason).toContain('A')
    expect(m.needsYou.find((i) => i.task.id === 'c')?.reason).toBe('Which logo?')
    expect(m.now).toEqual([])
  })
  it('says how much waits on a step', () => {
    const m = read([t('a', { status: 'running' }), t('b', { dependsOn: ['a'] }), t('c', { dependsOn: ['a'] })])
    expect(m.now[0].holding.map((x) => x.id)).toEqual(['b', 'c'])
    expect(m.next.every((i) => i.after[0].id === 'a')).toBe(true)
  })
  it('high priority goes first within the same standing, and pausing is stated', () => {
    expect(read([t('a'), t('b', { priority: 1 })]).next[0].task.id).toBe('b')
    expect(read([t('a')], [], true).next[0].reason).toMatch(/Paused/)
  })
})

describe('the headline', () => {
  it('says only what the records show', () => {
    const say = (tasks: Task[], x = {}) => missionHeadline(read(tasks), nameOf, x)
    expect(say([])).toBe('Nothing in progress yet.')
    expect(say([t('a', { status: 'done' })])).toBe('Nothing in progress. 1 step finished so far.')
    expect(say([t('a', { status: 'running' }), t('b', { status: 'running', assigneeId: 'kenji' })])).toBe('Inés and Kenji are working side by side.')
    expect(say([t('a', { status: 'running' }), t('b', { status: 'failed' }), t('c')], { toReview: 1 })).toBe('Inés is working on 1 step, 1 step needs you, 1 up next, a result is ready to review.')
    expect(say([t('a', { status: 'proposed' })])).toBe('A plan of 1 step is waiting for your OK.')
    expect(missionHeadline(read([t('a')], [], true), nameOf, { paused: true })).toMatch(/^Paused/)
    for (const s of [say([t('a', { status: 'running' })])]) expect(s).not.toMatch(/%|estimate|remaining/)
  })
})

describe('only real controls', () => {
  it('offers what the backend does for each state', () => {
    expect(taskActions({ status: 'running' })).toMatchObject({ priority: false, stop: true, instruct: true, retry: false })
    expect(taskActions({ status: 'pending' })).toMatchObject({ priority: true, reassign: true, stop: true })
    expect(taskActions({ status: 'failed' })).toMatchObject({ retry: true, priority: true })
    expect(taskActions({ status: 'done' })).toMatchObject({ correct: true, stop: false, instruct: false, priority: false })
    expect(taskActions({ status: 'cancelled' })).toMatchObject({ stop: false, retry: false, instruct: false, correct: false })
  })
})

describe('a finished request', () => {
  it('reports facts, and an absent check stays absent', () => {
    const f = deliveryFacts({ id: 'd', limitations: ['x'] }, [t('a', { status: 'done', checks: [{ ok: true } as never, { ok: false } as never], criteria: [{ criterion: 'c', met: true, evidence: '' }], changedFiles: ['M a'] }), t('b', { status: 'cancelled' }), t('z', { deliveryId: 'other', status: 'done' })])
    expect(f).toEqual({ steps: 2, finished: 1, checksPassed: 1, checksTotal: 2, criteriaMet: 1, criteriaTotal: 1, files: 1, limitations: 1 })
  })
})

describe('a new instruction', () => {
  const people = [{ id: 'ines', name: 'Inés Navarro' }]
  const running = t('a', { status: 'running', title: 'Build the checkout page' })
  it('says when it lands on work in progress', () => {
    expect(overlapLine('make the checkout page simpler', [running], people)).toMatch(/Overlaps with “Build the checkout page”.*nothing is interrupted/)
  })
  it('stays quiet when nothing overlaps or nothing is running', () => {
    expect(overlapLine('write a poem about clouds', [running], people)).toBeNull()
    expect(overlapLine('make the checkout page simpler', [t('b', { title: 'Build the checkout page' })], people)).toBeNull()
  })
})

describe('one view of the work', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../src', p), 'utf8')
  it('the old views are gone', () => {
    expect(src('renderer/src/components/home/ProjectHome.tsx')).toContain('MissionControl')
    expect(src('renderer/src/store.ts')).not.toContain("kind: 'execution'")
    expect(src('renderer/src/components/sheet/Sheet.tsx')).not.toContain('ExecutionView')
  })
  it('a plain instruction on a task is never read as a question', () => {
    expect(src('main/orchestrator/orchestrator.ts')).toContain('input.instruction === true && !!input.taskId')
    expect(src('main/ipc.ts')).toContain('instruction: input.instruction === true')
  })
})
