import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { wallTiles } from '../src/renderer/src/office/layout'
import { NOTICE, ReactionCooldowns, canNotice, followUp, intend, lineOfSight, partingWords, reactTo, type Happening } from '../src/renderer/src/office/awareness'
import { profileFor, seeded, type Profile } from '../src/renderer/src/office/personality'

const walls = wallTiles()
const T = 16
const at = (tx: number, ty: number) => ({ x: tx * T + 8, y: ty * T + 13 })
const base = profileFor(FOUNDING_TEAM[0])
const person = (traits: Partial<Profile['traits']>, habits: Profile['habits'] = []): Profile => ({ traits: { ...base.traits, ...traits }, habits })
const rate = (what: Happening, p: Profile, want: string, fam = 0.1) => {
  const rand = seeded(9)
  let n = 0
  for (let i = 0; i < 2000; i++) if (reactTo(what, p, fam, rand) === want) n++
  return n / 2000
}

describe('perception follows the real office walls', () => {
  it('nobody sees through the boardroom glass, but people do through its open door', () => {
    // engineering floor → boardroom, straight through the glass wall at x = 25
    expect(lineOfSight(walls, 23, 9, 28, 9)).toBe(false)
    // corridor → boardroom through the door in its south wall (x 30–31, y 14)
    expect(lineOfSight(walls, 30, 16, 30, 11)).toBe(true)
  })
  it('only nearby things are noticed, and never across a wall', () => {
    expect(canNotice(walls, at(30, 26), at(33, 26), NOTICE.glance)).toBe(false) // the supply room's solid wall
    expect(canNotice(walls, at(44, 26), at(47, 26), NOTICE.glance)).toBe(true) // open play area
    expect(canNotice(walls, at(44, 26), at(54, 33), NOTICE.glance)).toBe(false) // too far for a glance
  })
})

describe('the same moment, different people', () => {
  it('a curious ping-pong fan walks over to watch; a focused, incurious person rarely even looks', () => {
    const fan = person({ curiosity: 0.9, competitiveness: 0.8, playfulness: 0.7, focus: 0.2 }, ['pongFan'])
    const heads = person({ curiosity: 0.1, competitiveness: 0.1, playfulness: 0.1, focus: 0.95 }, ['deepFocus'])
    const goes = (p: Profile) => rate('rally', p, 'approach') + rate('rally', p, 'observe')
    expect(goes(fan)).toBeGreaterThan(goes(heads) * 3)
    expect(rate('rally', heads, 'ignore')).toBeGreaterThan(rate('rally', fan, 'ignore'))
  })
  it('observers watch before joining; chatty people step straight in; loners stay out', () => {
    const observer = person({ sociability: 0.8, initiative: 0.2 }, ['observer'])
    const chatty = person({ sociability: 0.9, initiative: 0.8, quiet: 0.2 }, ['chatty'])
    const loner = person({ sociability: 0.2, quiet: 0.9 }, ['loner'])
    expect(rate('conversation', observer, 'observe')).toBeGreaterThan(0.2)
    expect(rate('conversation', observer, 'approach')).toBe(0)
    expect(rate('conversation', chatty, 'approach')).toBeGreaterThan(0.3)
    expect(rate('conversation', loner, 'approach') + rate('conversation', loner, 'observe')).toBe(0)
  })
  it('a teammate’s success gets cheers from friends; a setback only ever gets a look', () => {
    const friendly = person({ friendliness: 0.9, focus: 0.3 })
    expect(rate('success', friendly, 'cheer', 0.8)).toBeGreaterThan(rate('success', friendly, 'cheer', 0.05))
    expect(rate('setback', friendly, 'cheer', 0.9)).toBe(0)
    expect(rate('setback', friendly, 'approach', 0.9)).toBe(0)
  })
  it('dog lovers go over to the dog; people indifferent to dogs mostly carry on', () => {
    const lover = person({ dogLove: 0.95 }, ['dogPerson'])
    const meh = person({ dogLove: 0.1, curiosity: 0.1 })
    expect(rate('dog', lover, 'approach')).toBeGreaterThan(rate('dog', meh, 'approach') * 5)
    expect(rate('dog', meh, 'ignore')).toBeGreaterThan(0.4)
  })
})

describe('coherent sequences and pacing', () => {
  it('what follows real work depends on the person', () => {
    const regular = person({}, ['coffeeRegular'])
    const quiet = person({ sociability: 0.2 }, ['deepFocus'])
    const count = (p: Profile, want: string | null) => {
      const rand = seeded(4)
      let n = 0
      for (let i = 0; i < 1000; i++) if (followUp('work', p, rand) === want) n++
      return n
    }
    expect(count(regular, 'coffee')).toBeGreaterThan(600)
    expect(count(quiet, null)).toBe(1000)
  })
  it('an intention waits for its moment and then expires', () => {
    const i = intend('watchPong', 'observe', 1000, 3000, 20_000)
    expect(i.notBefore).toBe(4000)
    expect(i.until).toBe(24_000)
  })
  it('the same kind of thing is reacted to at most once per cooldown, per person', () => {
    const c = new ReactionCooldowns()
    expect(c.ready('ines', 'rally', 0, 40_000)).toBe(true)
    c.mark('ines', 'rally', 0)
    expect(c.ready('ines', 'rally', 39_000, 40_000)).toBe(false)
    expect(c.ready('theo', 'rally', 39_000, 40_000)).toBe(true)
    expect(c.ready('ines', 'dog', 39_000, 40_000)).toBe(true)
    expect(c.ready('ines', 'rally', 40_000, 40_000)).toBe(true)
  })
  it('called away to work: friendly people say bye; patient partners linger a moment', () => {
    expect(partingWords(person({ friendliness: 0.8 }).traits, person({ friendliness: 0.8, patience: 0.8 }).traits)).toEqual({ leaverWaves: true, stayerWaves: true, stayerLingers: true })
    expect(partingWords(person({ friendliness: 0.1 }).traits, person({ friendliness: 0.1, patience: 0.1 }).traits)).toEqual({ leaverWaves: false, stayerWaves: false, stayerLingers: false })
  })
})
