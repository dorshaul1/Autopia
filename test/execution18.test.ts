import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { resultTelemetry, strategyStats } from '../src/main/director/metrics'
import { canRunBeside, singleTaskPlanStartsNow } from '../src/main/orchestrator/stateMachine'
import type { Delivery, Run, Task } from '../src/shared/types'

describe('single-task plans', () => {
  it('start right away only when Autopia chose to plan, outside product builds, with nothing to answer', () => {
    expect(singleTaskPlanStartsNow({ autoPlanned: true, product: false, proposed: 1, questions: 0 })).toBe(true)
    // you asked for a plan, or revised one: you review it
    expect(singleTaskPlanStartsNow({ autoPlanned: false, product: false, proposed: 1, questions: 0 })).toBe(false)
    // a real decomposition, a product spec, or open questions: you review it
    expect(singleTaskPlanStartsNow({ autoPlanned: true, product: false, proposed: 2, questions: 0 })).toBe(false)
    expect(singleTaskPlanStartsNow({ autoPlanned: true, product: true, proposed: 1, questions: 0 })).toBe(false)
    expect(singleTaskPlanStartsNow({ autoPlanned: true, product: false, proposed: 1, questions: 1 })).toBe(false)
  })
})

describe('parallel safety', () => {
  const t = (files: string[]) => ({ files })
  it('runs independent planned work side by side', () => {
    expect(canRunBeside(t(['public/app.js']), [t(['server.js'])])).toBe(true)
    expect(canRunBeside(t([]), [])).toBe(true)
  })
  it('never runs overlapping work, or work with unknown files, beside another writer', () => {
    expect(canRunBeside(t(['public/app.js']), [t(['public/'])])).toBe(false)
    expect(canRunBeside(t([]), [t(['server.js'])])).toBe(false)
    expect(canRunBeside(t(['server.js']), [t([])])).toBe(false)
    // the legacy engine only checked overlap (for benchmark A/B)
    expect(canRunBeside(t([]), [t(['server.js'])], true)).toBe(true)
  })
})

const run = (p: Partial<Run>): Run => ({ id: Math.random().toString(36), projectId: 'p', taskId: null, employeeId: 'e1', kind: 'task', purpose: 'work', status: 'succeeded', startedAt: 0, endedAt: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, numTurns: 0, ...p }) as Run
const task = (id: string, deliveryId: string): Task => ({ id, deliveryId, key: id, status: 'done' }) as Task
const delivery = (id: string, strategy: Delivery['strategy'], createdAt = 0): Delivery => ({ id, projectId: 'p', strategy, createdAt, completedAt: 100_000 }) as Delivery

describe('execution telemetry', () => {
  it('profiles a result from its recorded sessions: planning, work, repair, tokens, wall time', () => {
    const runs = [
      run({ kind: 'planning', purpose: 'plan', employeeId: 'pm', startedAt: 1_000, endedAt: 31_000, costUsd: 0.2, numTurns: 4, inputTokens: 10, cacheReadTokens: 500, outputTokens: 40 }),
      run({ taskId: 'T1', startedAt: 40_000, endedAt: 100_000, costUsd: 0.5, numTurns: 7, inputTokens: 100, cacheWriteTokens: 50, cacheReadTokens: 5000, outputTokens: 300 }),
      run({ taskId: 'T1', purpose: 'fix', startedAt: 100_000, endedAt: 120_000, costUsd: 0.1, numTurns: 2 }),
      run({ taskId: 'T2', employeeId: 'e2', startedAt: 45_000, endedAt: 90_000, costUsd: 0.3, numTurns: 5 }),
      // another project's planning in the same window never counts
      run({ projectId: 'other', kind: 'planning', purpose: 'plan', startedAt: 2_000, endedAt: 3_000, costUsd: 9 })
    ]
    const t = resultTelemetry(delivery('d1', 'plan'), [task('T1', 'd1'), task('T2', 'd1')], runs)
    expect(t).toMatchObject({
      strategy: 'plan',
      agents: 2,
      sessions: { planning: 1, work: 2, repair: 1, total: 4 },
      turns: 18,
      retries: 1,
      ms: { planning: 30_000, work: 105_000, repair: 20_000 },
      wallMs: 119_000,
      tokens: { fresh: 10 + 40 + 100 + 50 + 300, cached: 5500 }
    })
    expect(t.costUsd).toBeCloseTo(1.1)
    expect(t.planningCostUsd).toBeCloseTo(0.2)
  })

  it('compares strategies on finished results that recorded one', () => {
    const runs = [
      run({ taskId: 'A', startedAt: 0, endedAt: 60_000, costUsd: 0.3 }),
      run({ kind: 'planning', purpose: 'plan', startedAt: 0, endedAt: 10_000, costUsd: 0.1 }),
      run({ taskId: 'B', startedAt: 20_000, endedAt: 80_000, costUsd: 0.4 }),
      run({ taskId: 'B', purpose: 'fix', startedAt: 80_000, endedAt: 90_000, costUsd: 0.1 }),
      run({ taskId: 'C', startedAt: 0, endedAt: 1_000, costUsd: 1 })
    ]
    const ds = [delivery('d1', 'direct'), delivery('d2', 'plan'), { ...delivery('d3', null), completedAt: 5 } as Delivery]
    const stats = strategyStats(ds, [task('A', 'd1'), task('B', 'd2'), task('C', 'd3')], runs)
    expect(stats.map((s) => s.strategy)).toEqual(['direct', 'plan'])
    expect(stats.find((s) => s.strategy === 'plan')).toMatchObject({ results: 1, medianSessions: 3, firstPassRate: 0 })
    expect(stats.find((s) => s.strategy === 'plan')!.planningShare).toBeCloseTo(0.1 / 0.6)
    expect(stats.find((s) => s.strategy === 'direct')).toMatchObject({ planningShare: 0, firstPassRate: 1 })
  })
})

describe('strategy is recorded on each result', () => {
  it('persists the strategy (migration v13) and older results read as unknown', () => {
    const db = openDatabase(':memory:')
    const repo = new Repo(db)
    const p = repo.createProject({ name: 'x', path: '/tmp/x', goal: 'g', gitEnabled: false, baseBranch: null })
    const d = repo.createDelivery({ projectId: p.id, parentId: null, kind: 'brief', request: 'r', baseSha: null, screenshot: null })
    expect(d.strategy).toBeNull()
    expect(repo.updateDelivery(d.id, { strategy: 'light' }).strategy).toBe('light')
    db.close()
  })
})
