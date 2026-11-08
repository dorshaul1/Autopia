import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { DOG, DOG_BEHAVIORS, cooled, dogRandom, nextDogBehavior, nextReaction, spendEnergy, type DogBehavior, type DogContext } from '../src/renderer/src/office/dog'

const ctx = (o: Partial<DogContext> = {}): DogContext => ({ reduced: false, energy: 0.6, someoneWorking: true, someoneIdle: true, ...o })

describe('the office dog', () => {
  it('is not a teammate or an agent', () => {
    expect(FOUNDING_TEAM.some((e) => e.id === DOG.id)).toBe(false)
  })

  it('varies what she does: never twice in a row, cooldowns respected, every behaviour eventually', () => {
    const rand = dogRandom(11)
    const last: Partial<Record<DogBehavior, number>> = {}
    let prev: DogBehavior | null = null
    let energy = 0.6
    const seen = new Set<DogBehavior>()
    for (let i = 0, now = 0; i < 600; i++, now += 20_000) {
      const k = nextDogBehavior(rand, now, last, prev, ctx({ energy }))
      expect(k).not.toBe(prev)
      if (last[k] !== undefined) expect(now - last[k]!).toBeGreaterThanOrEqual(DOG_BEHAVIORS[k].cooldown)
      last[k] = now
      prev = k
      energy = spendEnergy(energy, k)
      seen.add(k)
    }
    expect(seen.size).toBe(Object.keys(DOG_BEHAVIORS).length)
  })

  it('no zoomies with reduced motion or when tired; no desk naps when nobody is working', () => {
    const rand = dogRandom(5)
    for (let i = 0; i < 300; i++) {
      expect(nextDogBehavior(rand, i * 1e6, {}, null, ctx({ reduced: true, energy: 1 }))).not.toBe('zoomies')
      expect(nextDogBehavior(rand, i * 1e6, {}, null, ctx({ energy: 0.3 }))).not.toBe('zoomies')
      expect(nextDogBehavior(rand, i * 1e6, {}, null, ctx({ someoneWorking: false }))).not.toBe('napDesk')
    }
  })

  it('tired dogs nap more than bouncy ones; a nap restores her', () => {
    const count = (energy: number) => {
      const rand = dogRandom(2)
      let naps = 0
      for (let i = 0; i < 2000; i++) {
        const k = nextDogBehavior(rand, i * 1e6, {}, null, ctx({ energy }))
        if (k === 'nap' || k === 'napDesk') naps++
      }
      return naps
    }
    expect(count(0.1)).toBeGreaterThan(count(0.7))
    expect(count(0.9)).toBe(0)
    expect(spendEnergy(0.1, 'nap')).toBe(1)
    expect(spendEnergy(0.2, 'zoomies')).toBe(0)
  })

  it('a click gets a different happy reaction each time, and no hop with reduced motion', () => {
    const rand = dogRandom(9)
    let prev = null as ReturnType<typeof nextReaction> | null
    for (let i = 0; i < 100; i++) {
      const r = nextReaction(rand, prev, true)
      expect(r).not.toBe(prev)
      expect(r).not.toBe('hop')
      prev = r
    }
  })

  it('cooldown helper', () => {
    const m = new Map([['theo', 1000]])
    expect(cooled(m, 'theo', 1500, 1000)).toBe(false)
    expect(cooled(m, 'theo', 2000, 1000)).toBe(true)
    expect(cooled(m, 'ines', 0, 1000)).toBe(true)
  })
})
