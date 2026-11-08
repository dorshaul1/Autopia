import { describe, expect, it } from 'vitest'
import type { Employee } from '../src/shared/types'
import { ACTIVITIES, freshNeeds, growNeeds, personaFor, pickActivity, score } from '../src/renderer/src/office/behavior'
import { DESKS, IDLE_SPOTS, PLACEMENTS, allReachable, buildWalkGrid, deskPlacements, requiredSpots, wallTiles } from '../src/renderer/src/office/layout'
import { findPath } from '../src/renderer/src/office/pathfinding'
import { DESK_IDS, seatingPlan } from '../src/shared/roster'

const emp = (p: Partial<Employee> = {}): Employee =>
  ({ id: 'e1', role: 'lead_dev', capabilities: ['backend'], kinds: ['code'], deskId: 'desk-dev', hiredAt: 0, ...p }) as Employee

describe('office layout', () => {
  const full = buildWalkGrid([...PLACEMENTS, ...deskPlacements(Object.keys(DESKS))])

  it('keeps every seat, idle spot and pair spot reachable from the entrance, even fully staffed', () => {
    expect(allReachable(full)).toBe(true)
    expect(allReachable(buildWalkGrid([...PLACEMENTS, ...deskPlacements([])]))).toBe(true)
  })

  it('never puts a required spot inside a wall', () => {
    const walls = wallTiles()
    for (const s of requiredSpots()) expect(walls.has(`${s.x},${s.y}`)).toBe(false)
  })

  it('never furnishes a desk without an occupant; empty slots hold planting instead', () => {
    const founding = deskPlacements(['desk-pm', 'desk-dev', 'desk-design', 'desk-qa'])
    expect(founding.filter((p) => p.id?.startsWith('desk:')).map((p) => p.id)).toEqual(['desk:desk-pm', 'desk:desk-dev', 'desk:desk-qa', 'desk:desk-design'])
    expect(founding.filter((p) => p.key === 'planterBench')).toHaveLength(2)
    const grown = deskPlacements(['desk-pm', 'desk-dev', 'desk-design', 'desk-qa', 'desk-5', 'desk-6'])
    expect(grown.filter((p) => p.key === 'planterBench')).toHaveLength(1)
    expect(allReachable(buildWalkGrid([...PLACEMENTS, ...grown]))).toBe(true)
  })

  it('seats founders at their own desks and hires in order, never leaving a gap', () => {
    const team = [
      { id: 'emp-maya', deskId: 'desk-6', hiredAt: 0 },
      { id: 'emp-theo', deskId: 'desk-dev', hiredAt: 0 },
      { id: 'emp-ines', deskId: 'desk-design', hiredAt: 0 },
      { id: 'emp-kenji', deskId: 'desk-qa', hiredAt: 0 },
      { id: 'hire2', deskId: 'desk-9', hiredAt: 20 },
      { id: 'hire1', deskId: 'desk-pm', hiredAt: 10 }
    ]
    const plan = seatingPlan(team)
    expect(plan.get('emp-maya')).toBe('desk-pm')
    expect(plan.get('hire1')).toBe('desk-5')
    expect(plan.get('hire2')).toBe('desk-6')
  })

  it('has a desk definition for every workstation the company can hire into', () => {
    for (const id of DESK_IDS) expect(DESKS[id]).toBeDefined()
  })

  it('routes across the office quickly', () => {
    const t = performance.now()
    for (let i = 0; i < 50; i++) expect(findPath(full, { x: 3, y: 8 }, IDLE_SPOTS.beanbag[0] && { x: IDLE_SPOTS.beanbag[0].tx, y: IDLE_SPOTS.beanbag[0].ty })).not.toBeNull()
    expect((performance.now() - t) / 50).toBeLessThan(5)
  })
})

describe('idle behaviour', () => {
  it('gives each employee a stable persona', () => {
    expect(personaFor(emp())).toEqual(personaFor(emp()))
    expect(personaFor(emp({ id: 'a' }))).not.toEqual(personaFor(emp({ id: 'b' })))
  })

  it('respects cooldowns', () => {
    const coffee = ACTIVITIES.find((a) => a.id === 'coffee')!
    const p = personaFor(emp())
    expect(score(coffee, freshNeeds(), p, emp(), 10, { coffee: 5000 }, 1000)).toBe(0)
    expect(score(coffee, freshNeeds(), p, emp(), 10, {}, 1000)).toBeGreaterThan(0)
  })

  it('makes tired people want coffee and hungry people want lunch at noon', () => {
    const p = personaFor(emp())
    const coffee = ACTIVITIES.find((a) => a.id === 'coffee')!
    const lunch = ACTIVITIES.find((a) => a.id === 'lunch')!
    const tired = { ...freshNeeds(), energy: 1 }
    expect(score(coffee, tired, p, emp(), 9, {}, 0)).toBeGreaterThan(score(coffee, freshNeeds(), p, emp(), 9, {}, 0))
    const hungry = { ...freshNeeds(), hunger: 1 }
    expect(score(lunch, hungry, p, emp(), 12.5, {}, 0)).toBeGreaterThan(score(lunch, hungry, p, emp(), 16, {}, 0) * 5)
  })

  it('sends designers to the moodboard far more than engineers', () => {
    const mood = ACTIVITIES.find((a) => a.id === 'moodboard')!
    const designer = emp({ id: 'd', capabilities: ['ui-design'] })
    expect(score(mood, freshNeeds(), personaFor(designer), designer, 10, {}, 0)).toBeGreaterThan(score(mood, freshNeeds(), personaFor(emp()), emp(), 10, {}, 0) * 5)
  })

  it('needs grow faster while working and picks are always valid activities', () => {
    const p = personaFor(emp())
    const a = freshNeeds()
    const b = freshNeeds()
    growNeeds(a, 60_000, p, false)
    growNeeds(b, 60_000, p, true)
    expect(b.energy).toBeGreaterThan(a.energy)
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 200; i++) expect(ACTIVITIES).toContain(pickActivity(a, p, emp(), 10, {}, 0, rand))
  })
})
