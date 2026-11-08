import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { ACTIVITIES, activity, freshNeeds, personaFor, pickActivity } from '../src/renderer/src/office/behavior'
import { Recent, Relationships, TRAIT_KEYS, acceptsInvite, choosePartner, dogResponse, personalityWeight, profileFor, reactToGame, seeded, type Context } from '../src/renderer/src/office/personality'

const team = FOUNDING_TEAM
const quietCtx: Context = { crowd: 0, rally: false, dogDistance: Infinity, joinable: false }

/** What someone does over a long, simulated stretch of idle time (seeded, so the test is exact). */
function diary(e: (typeof team)[number], picks = 3000, ctx: Context = quietCtx): Map<string, number> {
  const profile = profileFor(e)
  const persona = personaFor(e)
  const recent = new Recent()
  const rand = seeded(42)
  const counts = new Map<string, number>()
  const cooldowns: Record<string, number> = {}
  for (let i = 0, now = 0; i < picks; i++, now += 30_000) {
    const a = pickActivity(freshNeeds(), persona, e, 14, cooldowns, now, rand, () => false, () => 8, (x) => personalityWeight(x.id, profile, recent, ctx))
    cooldowns[a.id] = now + a.cooldownMs
    recent.did(a.id)
    counts.set(a.id, (counts.get(a.id) ?? 0) + 1)
  }
  return counts
}

describe('distinct, stable personalities', () => {
  it('every employee has a different combination of traits and habits, the same every session', () => {
    const profiles = team.map(profileFor)
    expect(profiles.map((p) => p.habits.join())).toEqual(team.map(profileFor).map((p) => p.habits.join())) // deterministic
    for (let i = 0; i < profiles.length; i++) {
      expect(profiles[i].habits).toHaveLength(3)
      for (let j = i + 1; j < profiles.length; j++) {
        const d = Math.sqrt(TRAIT_KEYS.reduce((n, k) => n + (profiles[i].traits[k] - profiles[j].traits[k]) ** 2, 0))
        expect(d).toBeGreaterThan(0.3)
      }
    }
    expect(new Set(profiles.map((p) => [...p.habits].sort().join())).size).toBe(profiles.length)
  })

  it('habits follow personality without contradictions (a loner is never also chatty)', () => {
    for (const e of team) {
      const h = profileFor(e).habits
      expect(h.includes('loner') && h.includes('chatty')).toBe(false)
      expect(h.includes('deepFocus') && h.includes('walker')).toBe(false)
    }
  })

  it('personality changes what people actually do with their breaks', () => {
    const share = (e: (typeof team)[number], ids: string[]) => {
      const d = diary(e)
      const total = [...d.values()].reduce((a, b) => a + b, 0)
      return ids.reduce((n, id) => n + (d.get(id) ?? 0), 0) / total
    }
    const solo = ['sofa', 'armchair', 'read', 'books', 'window', 'aquarium', 'records', 'stroll']
    const byQuiet = [...team].sort((a, b) => profileFor(a).traits.quiet - profileFor(b).traits.quiet)
    // the quietest person spends clearly more of their breaks alone than the most outgoing one
    expect(share(byQuiet[byQuiet.length - 1], solo)).toBeGreaterThan(share(byQuiet[0], solo) * 1.3)
    // and a coffee regular drinks more coffee than someone without the habit
    const regular = team.find((e) => profileFor(e).habits.includes('coffeeRegular'))
    const other = team.find((e) => !profileFor(e).habits.includes('coffeeRegular'))
    if (regular && other) expect(share(regular, ['coffee'])).toBeGreaterThan(share(other, ['coffee']))
  })

  it('moments only exist when they do: nobody watches ping-pong without a rally, or pets a dog that is not there', () => {
    const p = profileFor(team[0])
    expect(personalityWeight('watchPong', p, new Recent(), quietCtx)).toBe(0)
    expect(personalityWeight('petDog', p, new Recent(), quietCtx)).toBe(0)
    expect(personalityWeight('joinChat', p, new Recent(), quietCtx)).toBe(0)
    expect(personalityWeight('watchPong', p, new Recent(), { ...quietCtx, rally: true })).toBeGreaterThan(0)
  })

  it('short-term memory makes repeating the same thing less likely, and is bounded', () => {
    const r = new Recent()
    for (let i = 0; i < 20; i++) r.did('coffee', 'kitchen')
    expect(r.activities.length).toBe(Recent.SIZE)
    expect(r.places.length).toBeLessThanOrEqual(4)
    expect(r.freshness('coffee')).toBeLessThan(0.05)
    expect(r.freshness('sofa')).toBe(1)
  })

  it('quiet people avoid crowds, outgoing people are drawn to them', () => {
    const [quietest, loudest] = [...team].sort((a, b) => profileFor(b).traits.quiet - profileFor(a).traits.quiet).map(profileFor).filter((_, i, a) => i === 0 || i === a.length - 1)
    const crowded = { ...quietCtx, crowd: 3 }
    expect(personalityWeight('coffee', quietest, new Recent(), crowded)).toBeLessThan(personalityWeight('coffee', quietest, new Recent(), quietCtx))
    expect(personalityWeight('coffee', loudest, new Recent(), crowded)).toBeGreaterThanOrEqual(personalityWeight('coffee', loudest, new Recent(), quietCtx))
  })
})

describe('relationships grow through time together, and persist', () => {
  it('familiarity grows with shared moments, never past 1, and survives a save and reload', () => {
    const rel = new Relationships()
    const start = rel.familiarity('a', 'b')
    for (let i = 0; i < 30; i++) rel.together('a', 'b', 0.1)
    expect(rel.familiarity('a', 'b')).toBeGreaterThan(start + 0.5)
    expect(rel.familiarity('b', 'a')).toBe(rel.familiarity('a', 'b'))
    expect(rel.familiarity('a', 'b')).toBeLessThanOrEqual(1)
    rel.withDog('a', 0.5)
    const back = Relationships.fromJSON(JSON.parse(JSON.stringify(rel)))
    expect(back.familiarity('a', 'b')).toBeCloseTo(rel.familiarity('a', 'b'), 2)
    expect(back.dogFamiliarity('a')).toBeCloseTo(rel.dogFamiliarity('a'), 2)
    expect(Relationships.fromJSON('garbage').familiarity('a', 'b')).toBe(start) // bad data is ignored safely
  })

  it('people seek out friends: a close colleague is picked far more often', () => {
    const rel = new Relationships()
    for (let i = 0; i < 20; i++) rel.together('me', 'friend', 0.2)
    const cands = ['friend', 'x', 'y', 'z'].map((id) => ({ id, profile: profileFor(team[0]), distance: 5 }))
    const rand = seeded(7)
    let friend = 0
    for (let i = 0; i < 1000; i++) if (choosePartner('me', cands, rel, rand)?.id === 'friend') friend++
    expect(friend).toBeGreaterThan(400)
  })

  it('invitations are accepted more by friends, and declined more by heads-down people', () => {
    const rel = new Relationships()
    for (let i = 0; i < 20; i++) rel.together('a', 'friend', 0.2)
    const p = profileFor(team[1])
    const rate = (inviter: string, profile = p) => {
      const rand = seeded(3)
      let yes = 0
      for (let i = 0; i < 2000; i++) if (acceptsInvite(profile, inviter, 'friend', 'coffee', rel, rand)) yes++
      return yes / 2000
    }
    expect(rate('a')).toBeGreaterThan(rate('stranger'))
    const focused = { ...p, traits: { ...p.traits, focus: 0.95 }, habits: ['deepFocus' as const] }
    expect(rate('a', focused)).toBeLessThan(rate('a'))
  })
})

describe('individual reactions', () => {
  const base = profileFor(team[0]).traits
  it('a competitive winner celebrates, a quiet one keeps it small; losers take it differently', () => {
    expect(reactToGame({ ...base, competitiveness: 0.9 }, true)).toBe('celebrate')
    expect(reactToGame({ ...base, competitiveness: 0.2, quiet: 0.8 }, true)).toBe('none')
    expect(reactToGame({ ...base, competitiveness: 0.9 }, false)).toBe('groan')
    expect(reactToGame({ ...base, competitiveness: 0.3, patience: 0.8 }, false)).toBe('shrug')
  })
  it('dog lovers pet the corgi far more often than people indifferent to dogs', () => {
    const count = (dogLove: number) => {
      const rand = seeded(5)
      let pets = 0
      for (let i = 0; i < 1000; i++) if (dogResponse({ ...base, dogLove }, 0.1, rand) === 'pet') pets++
      return pets
    }
    expect(count(0.95)).toBeGreaterThan(count(0.15) * 3)
  })
  it('the new activities are registered with the existing activity system', () => {
    for (const id of ['stroll', 'watchPong', 'joinChat', 'petDog']) expect(activity(id)).toBeTruthy()
    expect(ACTIVITIES.length).toBeGreaterThan(27)
  })
})
