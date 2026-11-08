import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { triageBrief } from '../src/shared/triage'
import type { KnowledgeEntry, Task } from '../src/shared/types'
import { buildContext } from '../src/main/memory/memory'
import { criteriaPrompt, directTask } from '../src/main/orchestrator/prompts'
import { canContinueAround, isReady } from '../src/main/orchestrator/stateMachine'
import { criteriaSignature, repairStopReason, teamUnmet } from '../src/main/quality/readiness'

const t = (id: string, p: Partial<Task> = {}): Task => ({ id, key: id, status: 'pending', dependsOn: [], files: [], ...p }) as Task

describe('adaptive strategy', () => {
  it('keeps small, well-defined requests direct', () => {
    expect(triageBrief('Fix the cart total: it ignores quantity. Add a regression test.').strategy).toBe('direct')
  })
  it('gives a focused medium change to one owner who plans in-session (no meeting, no approval wait)', () => {
    // the benchmark's multi-file feature request (scenario 02)
    const brief = JSON.parse(readFileSync(new URL('../benchmark/scenarios/02-feature-due-dates/scenario.json', import.meta.url), 'utf8')).steps[0].request
    const r = triageBrief(brief)
    expect(r).toMatchObject({ complexity: 'medium', strategy: 'light' })
  })
  it('plans when there are separate workstreams or architectural scope', () => {
    expect(triageBrief('Build a REST API with a database schema, plus a React UI page to list items, and tests for both.').strategy).toBe('plan')
    expect(triageBrief('Refactor the report module into smaller modules without changing behaviour, and update the docs and tests accordingly for the team.').strategy).toBe('plan')
    expect(triageBrief('Refactor the architecture into microservices with a real-time integration layer, auth, database, UI and deploy pipeline.').strategy).toBe('plan')
  })
  it('a light task asks the owner to plan and to report every requirement', () => {
    const project = { goal: 'Add due dates to the todo CLI. Reject invalid dates.' } as never
    const light = directTask(project, triageBrief('Add due dates to the todo CLI.'), true)
    expect(light.description).toMatch(/short task list/)
    expect(light.acceptance).toMatch(/criterion/)
    expect(directTask(project, triageBrief('Add due dates.')).description).toBe('Add due dates to the todo CLI. Reject invalid dates.')
  })
})

describe('dependencies around a stuck task', () => {
  const tasks = [t('A', { status: 'failed' }), t('B', { dependsOn: ['A'] }), t('C'), t('D', { dependsOn: ['C'] })]
  const byId = new Map(tasks.map((x) => [x.id, x]))
  it('keeps independent work going and holds everything downstream', () => {
    expect(canContinueAround(tasks, byId)).toBe(true)
    expect(isReady(byId.get('B')!, byId)).toBe(false)
    expect(isReady(byId.get('C')!, byId)).toBe(true)
  })
  it('is blocked once only dependents remain', () => {
    const rest = [t('A', { status: 'failed' }), t('B', { dependsOn: ['A'] }), t('C', { status: 'done' })]
    expect(canContinueAround(rest, new Map(rest.map((x) => [x.id, x])))).toBe(false)
  })
})

describe('bounded repair', () => {
  it('stops on an unchanged failure or an exhausted budget, never loops', () => {
    expect(repairStopReason('sig-a', null, 0, 2)).toBeNull()
    expect(repairStopReason('sig-b', 'sig-a', 1, 2)).toBeNull()
    expect(repairStopReason('sig-b', 'sig-b', 2, 3)).toMatch(/remained after repair attempt 2/)
    expect(repairStopReason('sig-c', 'sig-b', 2, 2)).toMatch(/budget used \(2/)
  })
  it('compares unmet requirements as a set', () => {
    expect(criteriaSignature([{ criterion: 'B works' }, { criterion: 'A works ' }])).toBe(criteriaSignature([{ criterion: 'a works' }, { criterion: 'b works' }]))
    expect(criteriaSignature([{ criterion: 'A works' }])).not.toBe(criteriaSignature([{ criterion: 'A works' }, { criterion: 'B works' }]))
  })
  it('only repairs requirements the team owns', () => {
    expect(teamUnmet({ criterion: 'Search filters the list live', met: false })).toBe(true)
    expect(teamUnmet({ criterion: 'Search filters the list live', met: true })).toBe(false)
    expect(teamUnmet({ criterion: '[security] node_modules/@noble/hashes false-positive credential', met: false })).toBe(false)
  })
  it('the repair prompt names exactly the unmet requirements and forbids guessing', () => {
    const p = criteriaPrompt([{ criterion: 'Typing in search filters the list live', met: false, evidence: 'not wired yet' }], 1, 2)
    expect(p).toMatch(/repair 1 of 2/)
    expect(p).toMatch(/Typing in search filters the list live \(your note: not wired yet\)/)
    expect(p).toMatch(/instead of guessing/)
  })
})

describe('handoffs reach dependent tasks', () => {
  const k = (p: Partial<KnowledgeEntry>): KnowledgeEntry =>
    ({ id: Math.random().toString(36).slice(2), projectId: 'p', kind: 'handoff', topic: 't', title: 'title', text: 'text', rationale: null, alternatives: null, files: [], hashes: {}, commit: null, source: 's', confidence: 'reported', status: 'active', ...p }) as KnowledgeEntry
  const handoff = k({ topic: 'handoff:T1', title: 'T1 Backend API', text: 'POST /api/recipes returns 201 with the created id; validation errors are 422 { errors }.' })
  const q = { purpose: 'task' as const, text: 'Build the create form page', files: ['public/form.html'], size: 'm' as const }
  it('an unrelated-looking handoff is dropped by relevance alone', () => {
    expect(buildContext([handoff], q, null).ids).toEqual([])
  })
  it('is always included when it belongs to a dependency', () => {
    const pack = buildContext([handoff], { ...q, pinned: ['handoff:T1'] }, null)
    expect(pack.ids).toEqual([handoff.id])
    expect(pack.text).toMatch(/422/)
  })
})
