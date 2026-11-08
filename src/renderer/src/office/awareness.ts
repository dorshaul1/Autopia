// What employees can notice, and how each of them reacts. Pure and local: perception is line of sight
// through the office's real walls (glass included) within a short range, so nobody reacts to things
// behind a wall or across the floor. Reactions come from personality; nothing here touches real work.

import type { Profile, Traits } from './personality'

/** How far (tiles) each kind of thing can be noticed. */
export const NOTICE = {
  /** A glance at someone walking by or the dog trotting past. */
  glance: 5,
  /** A game, a conversation, the dog playing: worth walking over for. */
  social: 9,
  /** A teammate's real result or setback nearby. */
  event: 7,
  /** Asking someone along: they have to be in earshot. */
  invite: 12
} as const

/**
 * Whether two tile positions can see each other: no wall tile on the straight line between them
 * (Bresenham). Glass walls count: people don't react through them.
 */
export function lineOfSight(walls: Set<string>, ax: number, ay: number, bx: number, by: number): boolean {
  let x = ax
  let y = ay
  const dx = Math.abs(bx - ax)
  const dy = -Math.abs(by - ay)
  const sx = ax < bx ? 1 : -1
  const sy = ay < by ? 1 : -1
  let err = dx + dy
  for (let guard = 0; guard < 200; guard++) {
    if (x === bx && y === by) return true
    if ((x !== ax || y !== ay) && walls.has(`${x},${y}`)) return false
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return false
}

/** Can someone at world point a notice something at world point b, within `radius` tiles? */
export function canNotice(walls: Set<string>, a: { x: number; y: number }, b: { x: number; y: number }, radius: number, tile = 16): boolean {
  const ax = Math.floor(a.x / tile)
  const ay = Math.floor((a.y - 2) / tile)
  const bx = Math.floor(b.x / tile)
  const by = Math.floor((b.y - 2) / tile)
  if (Math.hypot(ax - bx, ay - by) > radius) return false
  return lineOfSight(walls, ax, ay, bx, by)
}

// ── reactions ──────────────────────────────────────────────────

export type Happening =
  /** A rally under way at the ping-pong table. */
  | 'rally'
  /** Someone just won a game and is celebrating. */
  | 'celebration'
  /** A teammate's work was verified, or a result was accepted (real events). */
  | 'success'
  /** A teammate's check just failed while they keep working (a real event). */
  | 'setback'
  /** The dog trotting by or playing. */
  | 'dog'
  /** A conversation with room for one more. */
  | 'conversation'

export type Reaction =
  /** Turn to look for a moment. */
  | 'glance'
  /** A small, warm acknowledgement (a heart or a hello). */
  | 'cheer'
  /** Walk over to be part of it (watch, join, pet). */
  | 'approach'
  /** Hang back and watch first; maybe join after. */
  | 'observe'
  | 'ignore'

/**
 * How one person reacts to something they noticed. The same moment gets different reactions:
 * curious people look, friends cheer, social people join, focused or quiet ones often carry on.
 * `familiarity` is with the person at the centre of it (0 when there is no one in particular).
 */
export function reactTo(what: Happening, p: Profile, familiarity: number, rand: () => number): Reaction {
  const t = p.traits
  const has = (h: string) => p.habits.includes(h as never)
  const r = rand()
  switch (what) {
    case 'rally': {
      const pull = t.curiosity * 0.35 + t.competitiveness * 0.3 + t.playfulness * 0.2 + (has('pongFan') ? 0.35 : 0) - t.focus * 0.15
      if (r < pull * 0.6) return has('observer') || t.initiative < 0.35 ? 'observe' : 'approach'
      return r < pull * 0.6 + t.curiosity * 0.45 ? 'glance' : 'ignore'
    }
    case 'celebration':
      if (r < t.friendliness * 0.4 + familiarity * 0.4) return 'cheer'
      return r < 0.75 - t.quiet * 0.3 ? 'glance' : 'ignore'
    case 'success':
      // happy for a teammate: friends and friendly people show it, focused people barely look up
      if (r < familiarity * 0.5 + t.friendliness * 0.25 - t.focus * 0.15) return 'cheer'
      return r < 0.6 + t.curiosity * 0.2 - t.focus * 0.3 ? 'glance' : 'ignore'
    case 'setback':
      // a look of concern from people who care; never a cheer, and nobody crowds round
      return r < t.friendliness * 0.45 + familiarity * 0.35 ? 'glance' : 'ignore'
    case 'dog': {
      const love = t.dogLove + (has('dogPerson') ? 0.3 : 0)
      if (r < love * 0.35) return 'approach'
      return r < love * 0.35 + 0.3 + t.curiosity * 0.2 ? 'glance' : 'ignore'
    }
    case 'conversation': {
      if (has('loner') || t.quiet > 0.8) return r < 0.25 ? 'glance' : 'ignore'
      const pull = t.sociability * 0.4 + t.friendliness * 0.2 + familiarity * 0.4 + (has('chatty') ? 0.25 : 0)
      if (r < pull * 0.55) return has('observer') || t.initiative < 0.35 ? 'observe' : 'approach'
      return r < pull * 0.55 + 0.25 ? 'glance' : 'ignore'
    }
  }
}

// ── intentions ─────────────────────────────────────────────────

/**
 * A short-term plan: "I'll go watch that", "I'll get a coffee after this". It makes actions form a
 * sequence rather than isolated picks, and expires if it's no longer relevant.
 */
export interface Intention {
  activity: string
  /** Why (for tests and debugging). */
  reason: string
  /** Don't act before this time (observers watch first). */
  notBefore: number
  /** Give up after this time. */
  until: number
}

export function intend(activity: string, reason: string, now: number, delayMs = 0, ttlMs = 25_000): Intention {
  return { activity, reason, notBefore: now + delayMs, until: now + delayMs + ttlMs }
}

/**
 * What naturally follows something, by personality: after a game a drink, after a stretch of real
 * work a coffee for the regulars, a walk for walkers, a chat for the sociable. Null = no plan.
 */
export function followUp(after: string, p: Profile, rand: () => number): string | null {
  const t = p.traits
  const has = (h: string) => p.habits.includes(h as never)
  const r = rand()
  switch (after) {
    case 'pingpong':
      return r < 0.55 ? 'water' : null
    case 'work':
      if (has('coffeeRegular') && r < 0.75) return 'coffee'
      if (has('walker') && r < 0.7) return 'stroll'
      if (has('gamer') && r < 0.35) return 'beanbag'
      if (t.sociability > 0.65 && r < 0.4) return 'chat'
      return null
    case 'stroll':
      return r < 0.35 ? 'window' : null
    case 'lunch':
      return r < 0.4 ? 'coffee' : null
    default:
      return null
  }
}

// ── pacing ─────────────────────────────────────────────────────

/** Per-person, per-kind cooldowns so nobody reacts to the same kind of thing over and over. */
export class ReactionCooldowns {
  private last = new Map<string, number>()
  ready(who: string, kind: string, now: number, ms: number): boolean {
    return now - (this.last.get(`${who}:${kind}`) ?? -Infinity) >= ms
  }
  mark(who: string, kind: string, now: number): void {
    this.last.set(`${who}:${kind}`, now)
    if (this.last.size > 400) this.last.clear()
  }
}

/** How long someone keeps looking: curious and patient people look longer. */
export function glanceMs(t: Traits): number {
  return Math.round(900 + t.curiosity * 700 + t.patience * 400)
}

/** When work calls someone away from a chat: friendly people say bye, the other one responds in kind. */
export function partingWords(leaver: Traits, stayer: Traits): { leaverWaves: boolean; stayerWaves: boolean; stayerLingers: boolean } {
  return {
    leaverWaves: leaver.friendliness > 0.35,
    stayerWaves: stayer.friendliness > 0.45,
    stayerLingers: stayer.patience > 0.5
  }
}
