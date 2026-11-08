import { describe, expect, it } from 'vitest'
import { simulate, type SimTask } from '../src/shared/parallel'
import { missingOriginalTeam, OFFICE_TYPES } from '../src/shared/offices'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { DEFAULT_SETTINGS, LIMITS } from '../src/shared/settings'

const t = (id: string, ms: number, dependsOn: string[] = [], assigneeId = 'a', kind = 'code'): SimTask => ({ id, ms, dependsOn, assigneeId, kind })

describe('independent work runs at the same time; dependent work starts as soon as it can', () => {
  it('three independent tasks on three people take as long as the longest', () => {
    const r = simulate([t('x', 10, [], 'a'), t('y', 20, [], 'b'), t('z', 15, [], 'c')], ['a', 'b', 'c'].map((id) => ({ id, kinds: ['code'] })), 4)
    expect(r).toEqual({ makespan: 20, peak: 3, serial: 45 })
  })
  it('a dependent task starts the moment its own prerequisite finishes, not when unrelated work does', () => {
    // b depends only on a (10); c (100) is unrelated: b runs 10..15 while c is still going
    const r = simulate([t('a', 10, [], 'p'), t('b', 5, ['a'], 'p'), t('c', 100, [], 'q')], [{ id: 'p', kinds: ['code'] }, { id: 'q', kinds: ['code'] }], 4)
    expect(r.makespan).toBe(100)
  })
  it("a busy owner's ready task goes to an idle colleague who can do it", () => {
    const people = [{ id: 'a', kinds: ['code'] }, { id: 'b', kinds: ['code'] }]
    expect(simulate([t('x', 10, [], 'a'), t('y', 10, [], 'a')], people, 4).makespan).toBe(10)
    expect(simulate([t('x', 10, [], 'a'), t('y', 10, [], 'a')], people, 4, false).makespan).toBe(20)
  })
  it('never more at once than the session limit', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kinds: ['code'] }))
    expect(simulate(['1', '2', '3', '4', '5'].map((id, i) => t(id, 10, [], people[i].id)), people, 2).peak).toBe(2)
  })
})

describe('full teams by default', () => {
  it('the original office gets the Tech Startup roles it was missing, once, and keeps everyone it has', () => {
    const missing = missingOriginalTeam(FOUNDING_TEAM, 0)
    expect(missing.map((e) => e.title)).toEqual(['Frontend Developer', 'Backend Developer'])
    expect(missingOriginalTeam([...FOUNDING_TEAM, ...missing], 0)).toEqual([])
    // a team that already hired a Priya keeps her and is not given a second one
    expect(missingOriginalTeam([...FOUNDING_TEAM, { name: 'Priya Raman', title: 'Front-end Engineer', projectId: null }], 0).map((e) => e.name)).toEqual(['Lucas Moreau'])
  })
  it('every office type defines its full roster, and more sessions can run at once', () => {
    for (const def of Object.values(OFFICE_TYPES)) expect(def.roles.length).toBeGreaterThanOrEqual(6)
    expect(DEFAULT_SETTINGS.maxParallel).toBe(4)
    expect(LIMITS.maxParallel[1]).toBe(8)
  })
})
