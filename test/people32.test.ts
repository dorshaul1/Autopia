import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { profileFor, seeded, type Profile } from '../src/renderer/src/office/personality'
import { BREAK_LABEL, SUGGESTIONS, answerLine, answerSuggestion, closeness, describePerson, dogLine, preferredBreaks, standoutTraits } from '../src/renderer/src/office/people'

const base = profileFor(FOUNDING_TEAM[0])
const person = (traits: Partial<Profile['traits']>, habits: Profile['habits']): Profile => ({ traits: { ...base.traits, ...traits }, habits })

describe('getting to know a teammate', () => {
  it('each person reads differently, and the same every time', () => {
    const lines = FOUNDING_TEAM.map((e) => describePerson(e.name.split(' ')[0], profileFor(e)))
    expect(new Set(lines).size).toBe(lines.length)
    expect(FOUNDING_TEAM.map((e) => describePerson(e.name.split(' ')[0], profileFor(e)))).toEqual(lines)
    for (const l of lines) expect(l).toMatch(/^An? .+ teammate\. \S+ .+\.$/)
  })
  it('only traits that really stand out are named, strongest first', () => {
    const neutral = Object.fromEntries(Object.keys(base.traits).map((k) => [k, 0.5])) as Profile['traits']
    const chips = standoutTraits({ ...neutral, curiosity: 0.98, sociability: 0.52, energy: 0.05 })
    expect(chips[0].word).toBe('curious')
    expect(chips.map((c) => c.word)).toContain('calm')
    expect(chips.map((c) => c.key)).not.toContain('sociability')
  })
  it('favourite breaks follow their habits', () => {
    expect(preferredBreaks(person({}, ['coffeeRegular', 'gamer', 'boardWatcher']))).toEqual(expect.arrayContaining([BREAK_LABEL.coffee]))
    const reader = preferredBreaks(person({ quiet: 0.9, sociability: 0.1 }, ['nookReader', 'loner', 'walker']))
    expect(reader.some((b) => b === BREAK_LABEL.read || b === BREAK_LABEL.books || b === BREAK_LABEL.stroll || b === BREAK_LABEL.window)).toBe(true)
  })
  it('Puffy and friendships in plain words', () => {
    expect(dogLine('Kenji', { ...base.traits, dogLove: 0.95 }, 0.6)).toMatch(/favourite person/)
    expect(dogLine('Theo', { ...base.traits, dogLove: 0.1 }, 0.05)).toMatch(/Not much of a dog person/)
    expect([closeness(0.8), closeness(0.4), closeness(0.2), closeness(0.06)]).toEqual(['close', 'friendly', 'getting to know', 'acquainted'])
  })
})

describe('suggesting a break', () => {
  const rate = (p: Profile, id: (typeof SUGGESTIONS)[number]['id'], want: string, mid = false) => {
    const r = seeded(11)
    let n = 0
    for (let i = 0; i < 2000; i++) if (answerSuggestion(p, id, mid, r) === want) n++
    return n / 2000
  }
  it('people say yes to what fits them, and no thanks to what doesn’t', () => {
    const gamer = person({ playfulness: 0.9, friendliness: 0.7 }, ['gamer', 'inviter', 'chatty'])
    const loner = person({ sociability: 0.1, quiet: 0.9, friendliness: 0.3 }, ['loner', 'nookReader', 'deepFocus'])
    expect(rate(gamer, 'beanbag', 'accept')).toBeGreaterThan(rate(loner, 'beanbag', 'accept'))
    expect(rate(loner, 'chat', 'decline')).toBeGreaterThan(rate(gamer, 'chat', 'decline'))
  })
  it('in the middle of something, patient people finish first ("later")', () => {
    const patient = person({ patience: 0.9 }, ['chatty', 'gamer', 'walker'])
    expect(rate(patient, 'coffee', 'accept', true)).toBe(0)
    expect(rate(patient, 'coffee', 'later', true)).toBeGreaterThan(0.3)
  })
  it('the answer reads naturally and never invents dialogue', () => {
    expect(answerLine('Theo', 'pingpong', 'accept', 'Inés')).toBe('Theo is heading over with Inés.')
    expect(answerLine('Theo', 'coffee', 'later')).toMatch(/once this is done/)
    expect(answerLine('Theo', 'coffee', 'decline')).toBe('Theo would rather not right now.')
  })
})
