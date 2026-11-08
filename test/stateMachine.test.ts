import { describe, expect, it } from 'vitest'
import { assertProjectTransition, assertTaskTransition, isReady, validateGraph } from '../src/main/orchestrator/stateMachine'
import type { Task } from '../src/shared/types'

const task = (id: string, status: Task['status'], dependsOn: string[] = []): Task =>
  ({ id, status, dependsOn }) as Task

describe('state machine', () => {
  it('allows the happy path and rejects skips', () => {
    expect(() => assertProjectTransition('new', 'planning')).not.toThrow()
    expect(() => assertProjectTransition('planning', 'awaiting_plan_approval')).not.toThrow()
    expect(() => assertProjectTransition('new', 'completed')).toThrow()
    expect(() => assertTaskTransition('pending', 'running')).not.toThrow()
    expect(() => assertTaskTransition('proposed', 'running')).toThrow()
    expect(() => assertTaskTransition('done', 'running')).toThrow()
  })

  it('only readies tasks whose dependencies are done or skipped', () => {
    const a = task('a', 'done')
    const b = task('b', 'running')
    const c = task('c', 'pending', ['a'])
    const d = task('d', 'pending', ['a', 'b'])
    const byId = new Map([a, b, c, d].map((t) => [t.id, t]))
    expect(isReady(c, byId)).toBe(true)
    expect(isReady(d, byId)).toBe(false)
  })

  it('validates plan graphs', () => {
    expect(validateGraph([{ key: 'T1', dependsOn: [] }, { key: 'T2', dependsOn: ['T1'] }])).toBeNull()
    expect(validateGraph([{ key: 'T1', dependsOn: ['T2'] }, { key: 'T2', dependsOn: ['T1'] }])).toMatch(/cycle/)
    expect(validateGraph([{ key: 'T1', dependsOn: ['X'] }])).toMatch(/unknown/)
    expect(validateGraph([{ key: 'T1', dependsOn: [] }, { key: 'T1', dependsOn: [] }])).toMatch(/duplicate/)
  })
})
