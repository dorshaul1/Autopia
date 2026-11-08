// Local, token-free idle behaviour: personas, needs and weighted activity choice.
// Pure functions so the simulation is deterministic to test and costs nothing to run.
// Real work always wins: none of this runs while an employee has an active workflow status.

import type { Employee } from '@shared/types'
import { profileFor } from './personality'

export interface Persona {
  /** 0..1 affinities that bias which breaks someone takes. */
  social: number
  caffeine: number
  playful: number
  calm: number
  /** Walking speed multiplier. */
  pace: number
  /** What they do with their hands while idle at the desk. */
  fidget: 'type' | 'stretch' | 'look'
  /** A favourite spot kind they drift back to. */
  favorite: string
  /** Desk personalisation. */
  item: 'succulent' | 'photo' | 'figurine' | 'bottle' | 'books' | 'speaker'
  mug: string
  sticky: string
}

export type Need = 'energy' | 'social' | 'fun' | 'rest' | 'hunger' | 'thirst'
export type Needs = Record<Need, number>

export interface ActivityDef {
  id: string
  /** IDLE_SPOTS key, 'desk', or 'pair' for two-person activities. */
  spots: string
  satisfies: Partial<Needs>
  base: number
  /** Minimum time between two runs of this activity for the same person. */
  cooldownMs: number
  /** How long they stay once there. */
  stayMs: [number, number]
  affinity?: 'social' | 'caffeine' | 'playful' | 'calm'
  /** Hour windows (local time) where the activity is more likely, with a multiplier. */
  peak?: { from: number; to: number; x: number }[]
  /** Role bias: multiplier when the employee's role/capabilities match. */
  for?: { match: (e: Employee) => boolean; x: number }
  pair?: 'chat' | 'pingpong'
  bubble?: 'coffee' | 'idea' | 'music' | 'heart' | 'chat' | 'phone' | 'book' | 'food'
}

const MIN = 60_000
const isDesigner = (e: Employee) => e.capabilities.includes('ui-design')
const isPm = (e: Employee) => e.role === 'pm'

export const ACTIVITIES: ActivityDef[] = [
  { id: 'desk', spots: 'desk', satisfies: { rest: 0.1 }, base: 1.1, cooldownMs: 0, stayMs: [10_000, 22_000] },
  {
    id: 'coffee',
    spots: 'coffee',
    satisfies: { energy: 0.8, thirst: 0.3 },
    base: 0.45,
    cooldownMs: 4 * MIN,
    stayMs: [4_500, 6_000],
    affinity: 'caffeine',
    peak: [
      { from: 8, to: 11, x: 2 },
      { from: 14, to: 16, x: 1.6 }
    ],
    bubble: 'coffee'
  },
  { id: 'water', spots: 'cooler', satisfies: { thirst: 0.7 }, base: 0.25, cooldownMs: 3 * MIN, stayMs: [3_000, 5_000] },
  { id: 'snack', spots: 'fridge', satisfies: { hunger: 0.4 }, base: 0.18, cooldownMs: 6 * MIN, stayMs: [3_000, 5_000], bubble: 'food' },
  { id: 'lunch', spots: 'dining', satisfies: { hunger: 1, social: 0.3, rest: 0.3 }, base: 0.12, cooldownMs: 40 * MIN, stayMs: [30_000, 55_000], peak: [{ from: 11.5, to: 13.75, x: 8 }], bubble: 'food' },
  { id: 'island', spots: 'island', satisfies: { rest: 0.3, hunger: 0.2 }, base: 0.15, cooldownMs: 5 * MIN, stayMs: [10_000, 18_000] },
  { id: 'sink', spots: 'sink', satisfies: {}, base: 0.05, cooldownMs: 10 * MIN, stayMs: [2_500, 4_000] },
  { id: 'sofa', spots: 'sofa', satisfies: { rest: 0.7 }, base: 0.22, cooldownMs: 5 * MIN, stayMs: [12_000, 24_000], affinity: 'calm', peak: [{ from: 18, to: 23, x: 1.6 }] },
  { id: 'armchair', spots: 'armchair', satisfies: { rest: 0.6 }, base: 0.15, cooldownMs: 5 * MIN, stayMs: [12_000, 20_000], affinity: 'calm' },
  { id: 'read', spots: 'readingNook', satisfies: { rest: 0.6, fun: 0.2 }, base: 0.12, cooldownMs: 6 * MIN, stayMs: [15_000, 28_000], affinity: 'calm', bubble: 'book' },
  { id: 'books', spots: 'bookshelf', satisfies: { fun: 0.2 }, base: 0.1, cooldownMs: 6 * MIN, stayMs: [5_000, 8_000], affinity: 'calm', bubble: 'book' },
  { id: 'window', spots: 'window', satisfies: { rest: 0.3 }, base: 0.12, cooldownMs: 4 * MIN, stayMs: [6_000, 10_000], affinity: 'calm' },
  { id: 'aquarium', spots: 'aquarium', satisfies: { rest: 0.3, fun: 0.2 }, base: 0.08, cooldownMs: 8 * MIN, stayMs: [5_000, 9_000], bubble: 'heart' },
  { id: 'records', spots: 'records', satisfies: { fun: 0.3 }, base: 0.06, cooldownMs: 10 * MIN, stayMs: [5_000, 8_000], bubble: 'music' },
  { id: 'arcade', spots: 'arcade', satisfies: { fun: 0.8 }, base: 0.12, cooldownMs: 6 * MIN, stayMs: [9_000, 16_000], affinity: 'playful', bubble: 'music' },
  { id: 'foosball', spots: 'foosball', satisfies: { fun: 0.7 }, base: 0.1, cooldownMs: 6 * MIN, stayMs: [9_000, 16_000], affinity: 'playful' },
  { id: 'beanbag', spots: 'beanbag', satisfies: { rest: 0.5, fun: 0.4 }, base: 0.12, cooldownMs: 6 * MIN, stayMs: [12_000, 22_000], affinity: 'playful' },
  { id: 'chat', spots: 'pair', pair: 'chat', satisfies: { social: 0.8 }, base: 0.3, cooldownMs: 3 * MIN, stayMs: [14_000, 24_000], affinity: 'social', bubble: 'chat' },
  { id: 'pingpong', spots: 'pair', pair: 'pingpong', satisfies: { fun: 0.9, social: 0.4 }, base: 0.12, cooldownMs: 8 * MIN, stayMs: [16_000, 26_000], affinity: 'playful' },
  { id: 'huddle', spots: 'huddle', satisfies: { social: 0.2 }, base: 0.1, cooldownMs: 4 * MIN, stayMs: [8_000, 14_000] },
  { id: 'phone', spots: 'phone', satisfies: { social: 0.3 }, base: 0.07, cooldownMs: 12 * MIN, stayMs: [15_000, 30_000], bubble: 'phone' },
  { id: 'printer', spots: 'printer', satisfies: {}, base: 0.05, cooldownMs: 10 * MIN, stayMs: [4_000, 7_000] },
  { id: 'lockers', spots: 'lockers', satisfies: {}, base: 0.03, cooldownMs: 15 * MIN, stayMs: [3_000, 5_000] },
  { id: 'moodboard', spots: 'moodboard', satisfies: { fun: 0.2 }, base: 0.04, cooldownMs: 5 * MIN, stayMs: [6_000, 10_000], for: { match: isDesigner, x: 10 }, bubble: 'idea' },
  { id: 'lightTable', spots: 'lightTable', satisfies: { fun: 0.2 }, base: 0.03, cooldownMs: 5 * MIN, stayMs: [8_000, 14_000], for: { match: isDesigner, x: 10 }, bubble: 'idea' },
  { id: 'roadmap', spots: 'roadmap', satisfies: {}, base: 0.05, cooldownMs: 5 * MIN, stayMs: [5_000, 8_000], for: { match: isPm, x: 8 }, bubble: 'idea' },
  { id: 'kanban', spots: 'kanban', satisfies: {}, base: 0.05, cooldownMs: 5 * MIN, stayMs: [4_000, 7_000], for: { match: isPm, x: 6 }, bubble: 'idea' },
  { id: 'reception', spots: 'reception', satisfies: { social: 0.2 }, base: 0.04, cooldownMs: 15 * MIN, stayMs: [4_000, 7_000] },
  // personality-driven (Phase 29): only chosen when the moment exists (a rally, a chat, the dog)
  { id: 'stroll', spots: 'stroll', satisfies: { rest: 0.25 }, base: 0.08, cooldownMs: 5 * MIN, stayMs: [3_000, 6_000] },
  { id: 'watchPong', spots: 'pongWatch', satisfies: { fun: 0.4, social: 0.2 }, base: 0.3, cooldownMs: 4 * MIN, stayMs: [10_000, 16_000] },
  { id: 'joinChat', spots: 'pair', satisfies: { social: 0.6 }, base: 0.25, cooldownMs: 3 * MIN, stayMs: [8_000, 14_000], bubble: 'chat' },
  { id: 'petDog', spots: 'dog', satisfies: { fun: 0.3, rest: 0.2 }, base: 0.15, cooldownMs: 6 * MIN, stayMs: [3_500, 5_000], bubble: 'heart' }
]

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]))
export const activity = (id: string): ActivityDef | undefined => BY_ID.get(id)

function hash(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Stable per-employee persona derived from their id and role (no randomness between launches). */
export function personaFor(e: Employee): Persona {
  const h = hash(e.id)
  const f = (salt: number) => ((h >>> salt) % 1000) / 1000
  const p: Persona = {
    social: 0.3 + f(1) * 0.6,
    caffeine: 0.3 + f(5) * 0.6,
    playful: 0.2 + f(9) * 0.7,
    calm: 0.3 + f(13) * 0.6,
    pace: 0.92 + f(17) * 0.2,
    fidget: (['type', 'stretch', 'look'] as const)[h % 3],
    favorite: ['window', 'sofa', 'arcade', 'aquarium', 'island', 'read'][(h >>> 4) % 6],
    item: (['succulent', 'photo', 'figurine', 'bottle', 'books', 'speaker'] as const)[(h >>> 7) % 6],
    mug: ['#fbfaf7', '#c96a43', '#5f6b80', '#d9a440', '#7f9a7c', '#ff8fb1'][(h >>> 11) % 6],
    sticky: ['#ffe066', '#ff9fb2', '#9fe0c0', '#a8d1ff'][(h >>> 14) % 4]
  }
  // the deep personality (traits + habits) drives the simple affinities too, so they agree
  const { traits, habits } = profileFor(e)
  p.social = traits.sociability
  p.playful = traits.playfulness
  p.calm = traits.quiet
  if (e.role === 'lead_dev' || e.role === 'engineer') p.caffeine = Math.min(1, p.caffeine + 0.2)
  if (habits.includes('coffeeRegular')) p.caffeine = Math.min(1, p.caffeine + 0.3)
  if (habits.includes('stretcher')) p.fidget = 'stretch'
  else if (habits.includes('deepFocus')) p.fidget = 'type'
  else if (habits.includes('observer')) p.fidget = 'look'
  return p
}

export const freshNeeds = (): Needs => ({ energy: 0.3, social: 0.3, fun: 0.2, rest: 0.2, hunger: 0.2, thirst: 0.3 })

/** Seconds to go from 0 to 1 for each need while idle; work makes people tired and thirsty faster. */
const RATE: Needs = { energy: 900, social: 700, fun: 1100, rest: 1000, hunger: 2400, thirst: 700 }

export function growNeeds(n: Needs, dtMs: number, persona: Persona, working: boolean): void {
  const dt = dtMs / 1000
  for (const k of Object.keys(RATE) as Need[]) {
    let rate = 1 / RATE[k]
    if (k === 'social') rate *= 0.6 + persona.social
    if (working && (k === 'energy' || k === 'rest' || k === 'thirst')) rate *= 1.8
    n[k] = Math.min(1, n[k] + rate * dt)
  }
}

export function satisfy(n: Needs, a: ActivityDef): void {
  for (const [k, v] of Object.entries(a.satisfies) as [Need, number][]) n[k] = Math.max(0, n[k] - v)
}

/** How attractive an activity is right now (0 = impossible). */
export function score(a: ActivityDef, n: Needs, p: Persona, e: Employee, hour: number, cooldowns: Record<string, number>, now: number): number {
  if ((cooldowns[a.id] ?? 0) > now) return 0
  let s = a.base
  let pull = 0
  for (const [k, v] of Object.entries(a.satisfies) as [Need, number][]) pull += n[k] * v
  s *= 1 + pull * 2.5
  if (a.affinity) s *= 0.4 + p[a.affinity] * 1.2
  for (const w of a.peak ?? []) if (hour >= w.from && hour < w.to) s *= w.x
  if (a.for?.match(e)) s *= a.for.x
  if (a.id === p.favorite) s *= 1.5
  // late evening: fewer errands, more lounging
  if ((hour >= 20 || hour < 7) && (a.id === 'printer' || a.id === 'lockers' || a.id === 'phone')) s *= 0.3
  return s
}

/** Weighted random pick; `skip` excludes activities that can't happen right now (e.g. no partner). */
export function pickActivity(
  n: Needs,
  p: Persona,
  e: Employee,
  hour: number,
  cooldowns: Record<string, number>,
  now: number,
  rand: () => number,
  skip: (a: ActivityDef) => boolean = () => false,
  /** Tiles to walk for an activity; nearby breaks are preferred, far ones still happen. */
  distance: (a: ActivityDef) => number = () => 0,
  /** Personality, memory and context multiplier (personality.ts); 0 rules an activity out. */
  extra: (a: ActivityDef) => number = () => 1
): ActivityDef {
  const scored = ACTIVITIES.map((a) => ({ a, s: skip(a) ? 0 : (score(a, n, p, e, hour, cooldowns, now) * extra(a)) / (1 + distance(a) / 22) })).filter((x) => x.s > 0)
  const total = scored.reduce((t, x) => t + x.s, 0)
  let r = rand() * total
  for (const x of scored) {
    r -= x.s
    if (r <= 0) return x.a
  }
  return BY_ID.get('desk')!
}
