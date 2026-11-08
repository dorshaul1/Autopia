import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM as ROSTER } from '../src/shared/roster'
import { INTERACTIVES } from '../src/renderer/src/office/layout'
import { GREET_ANY_MS, GREET_EACH_MS, RECEPTIONIST, ROUTINES, nextRoutine, passingDesk, receptionDigest, receptionEvents, seeded, shouldGreet, type Routine } from '../src/renderer/src/office/reception'

describe('the receptionist is not part of the team', () => {
  it('has her own id, unknown to the roster', () => {
    expect(ROSTER.some((e) => e.id === RECEPTIONIST.id || e.name.startsWith(RECEPTIONIST.name))).toBe(false)
  })
  it('is clickable at the front desk without overlapping another object', () => {
    expect(INTERACTIVES.filter((i) => i.id === 'receptionist')).toHaveLength(1)
  })
})

describe('routines', () => {
  it('vary, never repeat back to back, and respect cooldowns', () => {
    const rand = seeded(7)
    const last: Partial<Record<Routine, number>> = {}
    let prev: Routine | null = null
    let now = 0
    const seen = new Set<Routine>()
    for (let i = 0; i < 400; i++) {
      const r = nextRoutine(rand, now, last, prev, true)
      expect(r.kind).not.toBe(prev)
      if (last[r.kind] !== undefined) expect(now - last[r.kind]!).toBeGreaterThanOrEqual(ROUTINES[r.kind].cooldown)
      expect(r.ms).toBeGreaterThanOrEqual(ROUTINES[r.kind].ms[0])
      expect(r.ms).toBeLessThanOrEqual(ROUTINES[r.kind].ms[1])
      last[r.kind] = now
      prev = r.kind
      seen.add(r.kind)
      now += r.ms
    }
    expect(seen.size).toBe(Object.keys(ROUTINES).length)
  })
  it('never takes a break when she should stay at the desk', () => {
    const rand = seeded(3)
    for (let i = 0; i < 300; i++) expect(nextRoutine(rand, i * 60_000, {}, null, false).kind).not.toBe('break')
  })
  it('is reproducible for a seed (deterministic, local)', () => {
    const a = seeded(42)
    const b = seeded(42)
    expect([1, 2, 3].map(() => a())).toEqual([1, 2, 3].map(() => b()))
  })
})

describe('greetings', () => {
  it('waves at a passer-by once in a while, not at everyone, every time', () => {
    const by = new Map<string, number>()
    expect(shouldGreet('theo', 100_000, by, -Infinity)).toBe(true)
    by.set('theo', 100_000)
    expect(shouldGreet('theo', 100_000 + GREET_EACH_MS - 1, by, -Infinity)).toBe(false)
    expect(shouldGreet('ines', 100_000 + 5_000, by, 100_000)).toBe(false) // someone else just now
    expect(shouldGreet('ines', 100_000 + GREET_ANY_MS, by, 100_000)).toBe(true)
  })
  it('only counts people walking right by the desk', () => {
    expect(passingDesk(24 * 16, 27 * 16)).toBe(true)
    expect(passingDesk(5 * 16, 6 * 16)).toBe(false)
  })
})

describe('reactions and the desk panel use real state only', () => {
  const d = (id: string, status: string) => ({ id, status }) as never
  it('acknowledges a result the moment it is ready, and flags real pending decisions', () => {
    const e = receptionEvents({ deliveries: [d('a', 'validating')], attention: {} }, { deliveries: [d('a', 'review')], attention: { x: { status: 'pending' } } })
    expect(e).toEqual({ resultsReady: ['a'], needsYou: true })
    expect(receptionEvents({ deliveries: [d('a', 'review')], attention: {} }, { deliveries: [d('a', 'review')], attention: { x: { status: 'resolved' as never } } })).toEqual({ resultsReady: [], needsYou: false })
  })
  it('loading a project with a result already waiting is not a new event', () => {
    expect(receptionEvents({ deliveries: [], attention: {} }, { deliveries: [d('a', 'review')], attention: {} }).resultsReady).toEqual([])
  })
  it('the digest lists pending decisions, results to review, who is working and what finished', () => {
    const digest = receptionDigest({
      attention: { q: { id: 'q', projectId: 'p', status: 'pending', title: 'Approve the plan', createdAt: 1 } as never, r: { id: 'r', projectId: 'p', status: 'resolved', title: 'old', createdAt: 0 } as never },
      projects: { p: { id: 'p', name: 'Shop' } },
      activeProjectId: 'p',
      deliveries: [{ id: 'd1', projectId: 'p', number: 3, request: 'Add search', status: 'review' }],
      tasks: {
        t1: { id: 't1', key: 'T1', title: 'API', status: 'done', assigneeId: 'theo', finishedAt: 10 },
        t2: { id: 't2', key: 'T2', title: 'UI', status: 'running', assigneeId: 'ines', finishedAt: null }
      },
      employees: [
        { id: 'theo', name: 'Theo Lindqvist' },
        { id: 'ines', name: 'Inés Navarro' }
      ],
      statuses: { ines: { activity: 'working', detail: 'Edit src/ui.tsx' } }
    })
    expect(digest).toEqual({
      needs: [{ id: 'q', title: 'Approve the plan', projectId: 'p', project: 'Shop' }],
      ready: [{ id: 'd1', number: 3, request: 'Add search' }],
      finished: [{ id: 't1', label: 'API', who: 'Theo', at: 10 }],
      working: [{ id: 'ines', name: 'Inés', detail: 'Edit src/ui.tsx' }]
    })
  })
  it('an empty office has an empty digest (no invented activity)', () => {
    expect(receptionDigest({ attention: {}, projects: {}, activeProjectId: null, deliveries: [], tasks: {}, employees: [], statuses: {} })).toEqual({ needs: [], ready: [], finished: [], working: [] })
  })
})
