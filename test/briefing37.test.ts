import { describe, expect, it } from 'vitest'
import type { Task } from '../src/shared/types'
import { briefingRisks, countSteps, needsBriefing, stagesOf, standLine, stepState } from '../src/shared/briefing'
import { triageBrief } from '../src/shared/triage'
import { autoDecision } from '../src/main/director/blockers'

const t = (key: string, p: Partial<Task> = {}): Task =>
  ({ id: key, key, title: key, description: '', status: 'pending', dependsOn: [], files: [], changedFiles: [], assigneeId: 'maya', size: 'm', sortOrder: 0, ...p }) as Task
const nameOf = (id: string) => ({ maya: 'Maya', theo: 'Theo', priya: 'Priya' })[id] ?? null

describe('simple stays simple', () => {
  it('a small request runs directly, with no briefing or approval', () => {
    expect(triageBrief('Fix the typo in the README title').strategy).toBe('direct')
    expect(needsBriefing('direct', 1)).toBe(false)
    expect(needsBriefing('light', 1)).toBe(false)
  })
  it('planned or multi-step work gets a briefing', () => {
    expect(needsBriefing('plan', 1)).toBe(true)
    expect(needsBriefing('direct', 3)).toBe(true)
  })
})

describe('the briefing follows real state', () => {
  it('maps each status to planned, waiting, active, done or stuck', () => {
    expect(['proposed', 'pending', 'running', 'merging', 'done', 'failed', 'interrupted', 'cancelled'].map((s) => stepState({ status: s as Task['status'] }))).toEqual(['planned', 'waiting', 'active', 'active', 'done', 'stuck', 'stuck', 'skipped'])
  })

  it('never says more is done than the records show', () => {
    const plan = [t('T1', { status: 'proposed' }), t('T2', { status: 'proposed' })]
    expect(standLine(countSteps(plan))).toBe('2 steps planned, waiting for your OK.')
    const live = [t('T1', { status: 'done' }), t('T2', { status: 'running' }), t('T3'), t('T4', { status: 'cancelled' })]
    expect(standLine(countSteps(live))).toBe('1 done · 1 in progress · 1 to go · 3 steps in all.')
    expect(standLine(countSteps([t('T1', { status: 'done' })]))).toBe('Done.')
  })

  it('stages show what runs together and what builds on what', () => {
    const tasks = [t('T1', { sortOrder: 0 }), t('T2', { sortOrder: 1, assigneeId: 'theo' }), t('T3', { dependsOn: ['T1', 'T2'], sortOrder: 2 })]
    expect(stagesOf(tasks).map((s) => [s.n, s.tasks.map((x) => x.key)])).toEqual([
      [1, ['T1', 'T2']],
      [2, ['T3']]
    ])
  })
})

describe('worth knowing: concrete risks only', () => {
  it('names security, structure, size and shared files; finished work drops out; at most four', () => {
    const tasks = [
      t('T1', { title: 'Add login with sessions', assigneeId: 'maya', files: ['src/auth.ts'] }),
      t('T2', { title: 'Migrate the database schema', assigneeId: 'theo' }),
      t('T3', { title: 'Polish the header', assigneeId: 'priya', files: ['src/auth.ts'] }),
      t('T4', { title: 'Rewrite everything', size: 'l', status: 'done' })
    ]
    const risks = briefingRisks(tasks, { risks: ['Offline sync may conflict'] }, nameOf)
    expect(risks[0]).toBe('Maya\'s “Add login with sessions” touches security-sensitive code, so it gets the stricter checks.')
    expect(risks[1]).toMatch(/^Theo's “Migrate the database schema” changes structure or data/)
    expect(risks).toContain('Maya and Priya change the same files, so those steps run one after the other.')
    expect(risks.join(' ')).not.toMatch(/Rewrite everything/)
    expect(risks.length).toBeLessThanOrEqual(4)
  })
  it('nothing risky: nothing to say', () => {
    expect(briefingRisks([t('T1', { title: 'Change button color' })], null, nameOf)).toEqual([])
  })
})

describe('auto mode decides what Autopia asks, never Claude Code permission prompts', () => {
  it('has an answer for plans, questions and unverified work; none for permissions', () => {
    expect(autoDecision('plan')).toEqual({ kind: 'plan', action: 'approve' })
    expect(autoDecision('question')).toMatchObject({ kind: 'question', answer: expect.stringMatching(/state the assumption/) })
    expect(autoDecision('unverified')).toEqual({ kind: 'unverified', action: 'accept' })
    expect(autoDecision('permission')).toBeNull()
  })
})
