import { describe, expect, it } from 'vitest'
import { appearanceFor, chooseAssignee, fitScore, hiringSignal, HIRE_TEMPLATES, taskSkills } from '../src/shared/capabilities'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { projectSummary } from '../src/shared/summary'
import type { Employee, Project, Task } from '../src/shared/types'

const team = FOUNDING_TEAM
const byName = (n: string) => team.find((e) => e.name.startsWith(n))!
const none = () => 0

describe('staffing', () => {
  it('infers skills from task text and files', () => {
    expect(taskSkills({ kind: 'code', title: 'REST API', description: 'node:http server with JSON endpoints', files: ['src/server.js'] })).toEqual(
      expect.arrayContaining(['backend', 'api'])
    )
    expect(taskSkills({ kind: 'design', title: 'Landing page', description: 'responsive hero', files: ['styles.css'] })).toEqual(
      expect.arrayContaining(['ui-design', 'styling'])
    )
  })
  it('matches the specialist and never assigns build work to the PM', () => {
    expect(chooseAssignee(team, 'code', ['backend', 'api'], none)!.employee.name).toMatch(/Theo/)
    expect(chooseAssignee(team, 'design', ['ui-design'], none)!.employee.name).toMatch(/Inés/)
    expect(chooseAssignee(team, 'qa', ['qa'], none)!.employee.name).toMatch(/Kenji/)
    // skills nobody lists must not leave a planned task without an owner
    expect(chooseAssignee(team, 'code', ['mobile' as never], none)!.employee.role).not.toBe('pm')
    expect(chooseAssignee(team, 'code', ['planning'], none)?.employee.role).not.toBe('pm')
  })
  it('lets related roles cover adjacent work, preferring the less loaded', () => {
    const loaded = (id: string) => (id === byName('Theo').id ? 2 : 0)
    expect(chooseAssignee(team, 'code', ['testing'], loaded)!.employee.name).toMatch(/Kenji/)
    expect(fitScore(byName('Inés'), 'code', ['frontend', 'styling'])).toBe(1)
    expect(fitScore(byName('Kenji'), 'design', ['ui-design'])).toBe(0)
  })
  it('spreads equally qualified independent work across a hired engineer', () => {
    const hire: Employee = { ...byName('Theo'), id: 'h1', name: 'Priya Raman', role: 'engineer', capabilities: HIRE_TEMPLATES[0].capabilities, kinds: ['code'] }
    const load = new Map<string, number>([[byName('Theo').id, 1]])
    expect(chooseAssignee([...team, hire], 'code', ['backend', 'api'], (id) => load.get(id) ?? 0)!.employee.id).toBe('h1')
  })
})

describe('hiring signal', () => {
  it('only recommends hiring after repeated waits on one person', () => {
    expect(hiringSignal(new Map([[byName('Theo').id, 1]]), team)).toBeNull()
    const s = hiringSignal(new Map([[byName('Inés').id, 3]]), team)
    expect(s?.template.id).toBe('frontend')
  })
  it('gives hires a stable look', () => {
    expect(appearanceFor('Priya Raman')).toEqual(appearanceFor('Priya Raman'))
  })
})

describe('status summary', () => {
  const project = { phase: 'executing', goal: 'x' } as Project
  const t = (key: string, status: Task['status'], p: Partial<Task> = {}) =>
    ({ id: key, key, status, dependsOn: [], size: 'm', files: [], assigneeId: byName('Theo').id, ...p }) as Task
  it('summarises real state', () => {
    const s = projectSummary(project, [t('T1', 'done'), t('T2', 'running', { startedAt: 1_000 }), t('T3', 'pending', { dependsOn: ['T2'] })], [], team, 121_000)
    expect(s).toBe('1/3 done · T2 with Theo (2m) in progress · critical path next: T3.')
  })
  it('surfaces decisions', () => {
    expect(projectSummary(project, [t('T1', 'failed')], [], team)).toContain('T1 needs your decision')
  })
})
