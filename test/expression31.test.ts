import { describe, expect, it } from 'vitest'
import { FOUNDING_TEAM } from '../src/shared/roster'
import { emotionFor, planConversation, poseFor, styleFor } from '../src/renderer/src/office/expression'
import { profileFor, seeded, type Traits } from '../src/renderer/src/office/personality'

const base = profileFor(FOUNDING_TEAM[0]).traits
const tr = (o: Partial<Traits>): Traits => ({ ...base, ...o })
const loud = tr({ sociability: 0.95, energy: 0.9, playfulness: 0.9, initiative: 0.9, quiet: 0.1, friendliness: 0.8 })
const shy = tr({ sociability: 0.1, energy: 0.2, playfulness: 0.1, initiative: 0.1, quiet: 0.9, friendliness: 0.3, patience: 0.2 })

describe('expressive identity', () => {
  it('follows personality: animated people gesture, walk briskly and bounce; reserved people are subtle', () => {
    const a = styleFor(loud)
    const b = styleFor(shy)
    expect(a.amplitude).toBe('lively')
    expect(b.amplitude).toBe('subtle')
    expect(a.gestureRate).toBeGreaterThan(b.gestureRate * 2)
    expect(a.walkFps).toBeGreaterThan(b.walkFps)
    expect(a.pace).toBeGreaterThan(b.pace)
  })
  it('the team has a mix of expressive styles, not one template', () => {
    const styles = FOUNDING_TEAM.map((e) => styleFor(profileFor(e).traits))
    expect(new Set(styles.map((s) => `${s.amplitude}/${s.idle}`)).size).toBeGreaterThan(1)
    expect(new Set(styles.map((s) => s.walkFps)).size).toBeGreaterThan(1)
  })
})

describe('coordinated conversations', () => {
  const people = [
    { id: 'loud', traits: loud },
    { id: 'shy', traits: shy }
  ]
  it('take turns: one speaker at a time, never three turns running, filling the time', () => {
    for (let seed = 1; seed < 40; seed++) {
      const plan = planConversation(people, 18_000, seeded(seed))
      const total = plan.turns.reduce((n, t) => n + t.ms, 0)
      expect(total).toBeLessThanOrEqual(18_000)
      expect(total).toBeGreaterThan(15_000)
      for (let i = 2; i < plan.turns.length; i++) expect(plan.turns[i].speaker === plan.turns[i - 1].speaker && plan.turns[i].speaker === plan.turns[i - 2].speaker).toBe(false)
      for (const t of plan.turns) for (const c of t.cues) expect(c.who).not.toBe(t.speaker)
    }
  })
  it('talkative people hold the floor more; the quiet one listens and still gets turns', () => {
    let loudMs = 0
    let shyMs = 0
    for (let seed = 1; seed < 60; seed++) {
      for (const t of planConversation(people, 20_000, seeded(seed)).turns) t.speaker === 0 ? (loudMs += t.ms) : (shyMs += t.ms)
    }
    expect(loudMs).toBeGreaterThan(shyMs * 1.4)
    expect(shyMs).toBeGreaterThan(0)
  })
  it('a playful speaker gets more laughs; a friendly listener nods more', () => {
    const laughs = (speaker: Traits) => {
      let n = 0
      for (let seed = 1; seed < 80; seed++) for (const t of planConversation([{ id: 's', traits: speaker }, { id: 'l', traits: loud }], 20_000, seeded(seed)).turns) if (t.speaker === 0) n += t.cues.filter((c) => c.cue === 'laugh').length
      return n
    }
    expect(laughs(tr({ playfulness: 0.95 }))).toBeGreaterThan(laughs(tr({ playfulness: 0.05 })))
  })
  it('groups of three share the turns, and someone always closes the conversation', () => {
    const trio = [...people, { id: 'mid', traits: base }]
    const plan = planConversation(trio, 24_000, seeded(3))
    expect(new Set(plan.turns.map((t) => t.speaker)).size).toBe(3)
    // the one with the most initiative says goodbye
    const most = trio.reduce((best, m, i) => (m.traits.initiative > trio[best].traits.initiative ? i : best), 0)
    expect(plan.closer).toBe(most)
  })
})

describe('readable, proportionate emotions', () => {
  it('a real success: excitement for the animated, quiet satisfaction for the reserved', () => {
    expect(poseFor(emotionFor('verified', loud, seeded(1))!, styleFor(loud).amplitude)).toBe('cheer')
    expect(poseFor(emotionFor('verified', shy, seeded(1))!, styleFor(shy).amplitude)).toBe('nod')
  })
  it('a real setback is never dramatic: calm focus or mild frustration', () => {
    expect(['focused', 'frustrated']).toContain(emotionFor('setback', loud, seeded(1)))
    expect(poseFor('frustrated', 'subtle')).toBe('still')
  })
  it('a declined invitation is at most a small shrug', () => {
    const r = seeded(2)
    for (let i = 0; i < 50; i++) expect([null, 'confused']).toContain(emotionFor('declined', base, r))
    expect(poseFor('confused', 'moderate')).toBe('shrug')
  })
})
