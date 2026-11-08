import { describe, expect, it } from 'vitest'
import { criticalPath, criticalRanks, filesOverlap, waitingReason } from '../src/shared/graph'
import { triageBrief } from '../src/shared/triage'
import type { Task } from '../src/shared/types'
import { unionMs } from '../src/main/orchestrator/metrics'

const t = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, key: id, status: 'pending', dependsOn: [], size: 'm', files: [], assigneeId: 'e', sortOrder: 0, ...p }) as Task

describe('triage', () => {
  it('sends short single-area briefs straight to one agent', () => {
    const r = triageBrief('Add a --shout flag to greet.js that uppercases output.')
    expect(r).toMatchObject({ complexity: 'simple', strategy: 'direct', role: 'lead_dev' })
  })
  it('routes pure UI work to the designer', () => {
    expect(triageBrief('Restyle the landing page buttons with a dark theme.').role).toBe('designer')
  })
  it('plans multi-area work', () => {
    const r = triageBrief('Build a REST API with a database schema, plus a React UI page to list items, and tests for both.')
    expect(r.strategy).toBe('plan')
    expect(r.complexity).not.toBe('simple')
  })
  it('flags architectural scope as complex', () => {
    expect(triageBrief('Refactor the architecture into microservices with a real-time integration layer, auth, database, UI and deploy pipeline.').complexity).toBe('complex')
  })
})

describe('graph', () => {
  const tasks = [t('A', { size: 'l' }), t('B', { size: 's' }), t('C', { dependsOn: ['A'] }), t('D', { dependsOn: ['B', 'C'] })]
  it('ranks by remaining weighted path', () => {
    const r = criticalRanks(tasks)
    expect(r.get('A')).toBe(4 + 2 + 2)
    expect(r.get('B')).toBe(1 + 2)
  })
  it('finds the critical path', () => {
    expect([...criticalPath(tasks)].sort()).toEqual(['A', 'C', 'D'])
  })
  it('ignores finished work', () => {
    const done = tasks.map((x) => (x.id === 'A' ? { ...x, status: 'done' as const } : x))
    expect(criticalRanks(done).get('A')).toBe(2 + 2)
  })
  it('detects overlapping file ownership', () => {
    expect(filesOverlap(['src/ui/**'], ['src/ui/button.tsx'])).toBe(true)
    expect(filesOverlap(['src/api/server.ts'], ['src/ui/app.tsx'])).toBe(false)
    expect(filesOverlap(['package.json'], ['package.json'])).toBe(true)
    expect(filesOverlap([], ['x'])).toBe(false)
  })
  it('explains why a task waits', () => {
    const run = t('R', { status: 'running', files: ['src/a.ts'] })
    expect(waitingReason(t('X', { dependsOn: ['R'] }), [run], () => null)).toBe('Waiting on R')
    expect(waitingReason(t('Y', { files: ['src/a.ts'] }), [run], () => null)).toMatch(/Shares files with R/)
    expect(waitingReason(t('Z', { files: ['src/b.ts'] }), [run], () => 'Theo')).toBe('Theo is finishing another task')
    // a task with no planned files never runs beside another writer (Phase 18), and the reason says so
    expect(waitingReason(t('U'), [run], () => 'Theo')).toMatch(/Starts after R: one of them has no planned files/)
  })
})

describe('metrics', () => {
  it('measures overlap as a union of intervals', () => {
    expect(unionMs([[0, 10], [5, 15], [20, 30]])).toBe(25)
  })
})
