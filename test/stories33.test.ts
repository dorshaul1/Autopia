import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { profileFor, seeded, type Profile } from '../src/renderer/src/office/personality'
import { STORIES, StoryPacer, hostAppeal, leavesEarly, storyAppeal, storyLength, wantsToJoin, weightedPick } from '../src/renderer/src/office/stories'

const base = profileFor(FOUNDING_TEAM[0])
const person = (traits: Partial<Profile['traits']>, habits: Profile['habits']): Profile => ({ traits: { ...base.traits, ...traits }, habits })
const rate = (f: (r: () => number) => boolean) => {
  const r = seeded(13)
  let n = 0
  for (let i = 0; i < 2000; i++) if (f(r)) n++
  return n / 2000
}

describe('stories suit the people who start them', () => {
  it('a gamer hosts console sessions, a coffee regular a coffee round, a dog person a gathering round Puffy', () => {
    const gamer = person({}, ['gamer', 'inviter', 'chatty'])
    const regular = person({}, ['coffeeRegular', 'walker', 'loner'])
    const dogFan = person({ dogLove: 0.95 }, ['dogPerson', 'observer', 'stretcher'])
    expect(storyAppeal('gameSession', gamer)).toBeGreaterThan(storyAppeal('gameSession', regular))
    expect(storyAppeal('coffeeRound', regular)).toBeGreaterThan(storyAppeal('coffeeRound', dogFan))
    expect(storyAppeal('dogGathering', dogFan)).toBeGreaterThan(storyAppeal('dogGathering', gamer))
  })
  it('celebrations only follow real milestones: nobody starts one on a whim', () => {
    for (const e of FOUNDING_TEAM) expect(storyAppeal('celebration', profileFor(e))).toBe(0)
  })
  it('people with initiative start things; loners and the heads-down rarely do', () => {
    expect(hostAppeal(person({ initiative: 0.9, sociability: 0.8 }, ['inviter']))).toBeGreaterThan(hostAppeal(person({ initiative: 0.2, sociability: 0.2 }, ['loner', 'deepFocus'])) * 4)
  })
  it('joining and leaving early follow personality', () => {
    const social = person({ sociability: 0.9, friendliness: 0.9 }, ['chatty'])
    const loner = person({ sociability: 0.1, friendliness: 0.2 }, ['loner'])
    expect(rate((r) => wantsToJoin(social, 0.6, 'huddle', r))).toBeGreaterThan(rate((r) => wantsToJoin(loner, 0.1, 'huddle', r)) * 3)
    expect(rate((r) => leavesEarly(person({ patience: 0.1 }, []), 0.8, r))).toBeGreaterThan(rate((r) => leavesEarly(person({ patience: 0.95 }, []), 0.8, r)))
    expect(rate((r) => leavesEarly(person({ patience: 0.1 }, []), 0.2, r))).toBe(0) // nobody walks off right away
  })
  it('patient groups linger; restless ones keep it short', () => {
    const patient = [person({ patience: 0.95 }, []), person({ patience: 0.9 }, [])]
    const restless = [person({ patience: 0.05 }, []), person({ patience: 0.1 }, [])]
    expect(storyLength('huddle', patient, () => 0.5)).toBeGreaterThan(storyLength('huddle', restless, () => 0.5))
  })
})

describe('restraint', () => {
  it('quiet stretches between stories, a cooldown per kind, and a rest for each person', () => {
    const p = new StoryPacer(60_000, 0)
    expect(p.canStart(30_000)).toBe(false)
    expect(p.canStart(60_000)).toBe(true)
    p.started('coffeeRound', 60_000)
    p.ended(['a', 'b'], 90_000, () => 0) // quiet for at least 90 s
    expect(p.canStart(150_000)).toBe(false)
    expect(p.canStart(181_000)).toBe(true)
    expect(p.kindReady('coffeeRound', 181_000)).toBe(false)
    expect(p.kindReady('huddle', 181_000)).toBe(true)
    expect(p.personRested('a', 181_000)).toBe(false)
    expect(p.personRested('c', 181_000)).toBe(true)
    expect(p.freshness('coffeeRound')).toBeLessThan(p.freshness('huddle'))
  })
  it('a story that fizzles (nobody came) only pauses briefly', () => {
    const p = new StoryPacer(0, 0)
    p.ended(['a'], 1000, () => 0.9, true)
    expect(p.canStart(31_000)).toBe(true)
  })
  it('group sizes stay small enough to read at a glance', () => {
    for (const d of Object.values(STORIES)) expect(d.max).toBeLessThanOrEqual(4)
  })
  it('weighted choice never picks something with no appeal', () => {
    const r = seeded(1)
    for (let i = 0; i < 200; i++) expect(weightedPick(['a', 'b'], (x) => (x === 'a' ? 0 : 1), r)).toBe('b')
  })
})
