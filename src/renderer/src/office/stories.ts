// Emergent office stories: small multi-person moments built from behaviours the office already has
// (walking to shared places, conversations, games, the dog, real milestones). This module decides
// which story fits whom and paces them; the scene runs them with the existing spots and animations.
// Pure, seeded and bounded. Real work always wins: nobody on a real task is ever part of a story.

import type { Profile } from './personality'

export type StoryKind =
  /** A few colleagues take their coffee together at the dining table. */
  | 'coffeeRound'
  /** Two or three settle onto the beanbags for console games. */
  | 'gameSession'
  /** A ping-pong match, with a friend or two invited to watch. */
  | 'pongMatch'
  /** People gather round the dog. */
  | 'dogGathering'
  /** A friendly sit-down chat at the huddle table. */
  | 'huddle'
  /** A small, brief get-together after a real result was accepted (real milestones only). */
  | 'celebration'

export interface StoryDef {
  /** IDLE_SPOTS kind where people gather ('pair' for ping-pong, 'dog' around the dog). */
  place: string
  min: number
  max: number
  /** How long the shared part lasts once people are there (scaled by their patience). */
  ms: [number, number]
  /** Minimum time before the same kind of story again. */
  cooldown: number
}

const MIN = 60_000

export const STORIES: Record<StoryKind, StoryDef> = {
  coffeeRound: { place: 'dining', min: 2, max: 4, ms: [22_000, 34_000], cooldown: 7 * MIN },
  gameSession: { place: 'beanbag', min: 2, max: 3, ms: [26_000, 40_000], cooldown: 8 * MIN },
  pongMatch: { place: 'pair', min: 2, max: 4, ms: [20_000, 30_000], cooldown: 7 * MIN },
  dogGathering: { place: 'dog', min: 2, max: 3, ms: [12_000, 18_000], cooldown: 9 * MIN },
  huddle: { place: 'huddle', min: 2, max: 4, ms: [20_000, 32_000], cooldown: 7 * MIN },
  celebration: { place: 'dining', min: 2, max: 4, ms: [10_000, 14_000], cooldown: 2 * MIN }
}

/** Which story a would-be host is drawn to, by their habits and traits. 0 = not their thing. */
export function storyAppeal(kind: StoryKind, p: Profile): number {
  const t = p.traits
  const has = (h: string) => p.habits.includes(h as never)
  switch (kind) {
    case 'coffeeRound':
      return 0.4 + t.sociability * 0.6 + (has('coffeeRegular') ? 0.8 : 0) + (has('inviter') ? 0.4 : 0)
    case 'gameSession':
      return 0.15 + t.playfulness * 0.7 + (has('gamer') ? 1.2 : 0)
    case 'pongMatch':
      return 0.15 + t.competitiveness * 0.6 + t.playfulness * 0.3 + (has('pongFan') ? 0.6 : 0)
    case 'dogGathering':
      return t.dogLove * 0.7 + (has('dogPerson') ? 1 : 0)
    case 'huddle':
      return 0.25 + t.sociability * 0.5 + t.initiative * 0.4 + (has('chatty') ? 0.6 : 0)
    case 'celebration':
      return 0 // only ever started by a real milestone
  }
}

/** Who gets the idea: people with initiative and sociability, rarely loners or the heads-down. */
export function hostAppeal(p: Profile): number {
  const t = p.traits
  let a = 0.2 + t.initiative * 0.6 + t.sociability * 0.4
  if (p.habits.includes('loner')) a *= 0.3
  if (p.habits.includes('deepFocus')) a *= 0.6
  if (p.habits.includes('inviter') || p.habits.includes('chatty')) a *= 1.4
  return a
}

export function weightedPick<T>(items: T[], weight: (x: T) => number, rand: () => number): T | null {
  const scored = items.map((x) => ({ x, w: Math.max(0, weight(x)) })).filter((s) => s.w > 0)
  const total = scored.reduce((n, s) => n + s.w, 0)
  let r = rand() * total
  for (const s of scored) {
    r -= s.w
    if (r < 0) return s.x
  }
  return scored[scored.length - 1]?.x ?? null
}

/** Joining a story already under way (someone nearby notices it): sociable, friendly, curious people do. */
export function wantsToJoin(p: Profile, familiarityWithHost: number, kind: StoryKind, rand: () => number): boolean {
  const t = p.traits
  let x = 0.1 + t.sociability * 0.3 + t.friendliness * 0.15 + familiarityWithHost * 0.35
  if (p.habits.includes('loner')) x -= 0.25
  if (kind === 'dogGathering') x += t.dogLove * 0.3
  if (kind === 'gameSession') x += (t.playfulness - 0.5) * 0.4
  return rand() < Math.min(0.85, Math.max(0.03, x))
}

/** Restless people drift off before the end; patient ones stay to the finish. Checked now and then. */
export function leavesEarly(p: Profile, fractionDone: number, rand: () => number): boolean {
  if (fractionDone < 0.4) return false
  return rand() < (1 - p.traits.patience) * 0.12
}

/** How long the shared part lasts: the group's patience stretches or shortens it. */
export function storyLength(kind: StoryKind, members: Profile[], rand: () => number): number {
  const [lo, hi] = STORIES[kind].ms
  const patience = members.reduce((n, m) => n + m.traits.patience, 0) / Math.max(1, members.length)
  return Math.round((lo + rand() * (hi - lo)) * (0.8 + patience * 0.4))
}

// ── pacing ─────────────────────────────────────────────────────

/**
 * Keeps the office calm: one story at a time, a quiet stretch after each, a cooldown per kind, and a
 * rest for each person so the same people aren't in every story. Bounded state.
 */
export class StoryPacer {
  private lastKind = new Map<StoryKind, number>()
  private lastPerson = new Map<string, number>()
  private quietUntil = 0
  private recentKinds: StoryKind[] = []
  static readonly PERSON_REST = 5 * 60_000

  constructor(firstQuietMs = 60_000, now = 0) {
    this.quietUntil = now + firstQuietMs
  }

  canStart(now: number): boolean {
    return now >= this.quietUntil
  }

  kindReady(kind: StoryKind, now: number): boolean {
    return now - (this.lastKind.get(kind) ?? -Infinity) >= STORIES[kind].cooldown
  }

  /** Recently told stories are less appealing, so the office doesn't repeat itself. */
  freshness(kind: StoryKind): number {
    const i = this.recentKinds.indexOf(kind)
    return i < 0 ? 1 : 0.35 + i * 0.2
  }

  personRested(id: string, now: number): boolean {
    return now - (this.lastPerson.get(id) ?? -Infinity) >= StoryPacer.PERSON_REST
  }

  started(kind: StoryKind, now: number): void {
    this.lastKind.set(kind, now)
    this.recentKinds.unshift(kind)
    if (this.recentKinds.length > 3) this.recentKinds.length = 3
  }

  /** A story ended (or fizzled): everyone in it rests, and the office is quiet for a while. */
  ended(people: string[], now: number, rand: () => number, fizzled = false): void {
    for (const id of people) this.lastPerson.set(id, now)
    this.quietUntil = now + (fizzled ? 30_000 : 90_000 + rand() * 150_000)
  }
}
