// Deep, stable personalities for the team: traits, signature habits, short-term memory and
// relationships that grow through simulated interactions. Pure and deterministic (seeded); the scene
// and Character use it to weigh ambient choices. Ambient life only: real work is never touched here.

import type { Employee } from '@shared/types'

// ── traits ─────────────────────────────────────────────────────

export interface Traits {
  /** 0 introvert … 1 extrovert. */
  sociability: number
  playfulness: number
  competitiveness: number
  curiosity: number
  /** Focus and discipline: longer desk stretches, more likely to decline a break. */
  focus: number
  energy: number
  patience: number
  /** Starts things: invitations, conversations. */
  initiative: number
  friendliness: number
  /** 0 likes busy places … 1 prefers quiet ones. */
  quiet: number
  /** Affinity for the office dog. */
  dogLove: number
}

export const TRAIT_KEYS: (keyof Traits)[] = ['sociability', 'playfulness', 'competitiveness', 'curiosity', 'focus', 'energy', 'patience', 'initiative', 'friendliness', 'quiet', 'dogLove']

function hash(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Stable traits from the employee's id (the same every session) with gentle nudges from role.
 * Traits are drawn in a spread (0.1…0.95) so people differ clearly, and a few are linked the way
 * people usually are (extroverts seldom crave quiet) without becoming fixed stereotypes.
 */
/** The same person in another office ("emp-maya@1a2b3c4d") keeps their personality; their memories stay separate. */
export const personaKey = (id: string) => id.split('@')[0]

export function traitsFor(e: Pick<Employee, 'id' | 'role' | 'capabilities' | 'kinds'>): Traits {
  const r = seeded(hash(`traits:${personaKey(e.id)}`))
  const t = {} as Traits
  for (const k of TRAIT_KEYS) t[k] = 0.1 + r() * 0.85
  t.quiet = clamp(t.quiet * 0.6 + (1 - t.sociability) * 0.4)
  t.friendliness = clamp(t.friendliness * 0.7 + t.sociability * 0.3)
  if (e.role === 'pm') t.initiative = clamp(t.initiative + 0.2)
  if (e.capabilities.includes('ui-design')) t.curiosity = clamp(t.curiosity + 0.15)
  if (e.role === 'lead_dev') t.focus = clamp(t.focus + 0.15)
  if (e.kinds.includes('qa')) t.patience = clamp(t.patience + 0.15)
  return t
}

// ── habits ─────────────────────────────────────────────────────

export type Habit =
  | 'coffeeRegular' // keeps going back to the coffee bar
  | 'walker' // short walks between work sessions
  | 'deepFocus' // long desk stretches, often declines breaks
  | 'pongFan' // watches others play ping-pong
  | 'chatty' // starts conversations often
  | 'gamer' // console on the beanbags, invites a friend
  | 'boardWatcher' // checks the team board and milestone wall
  | 'stretcher' // stretches at the desk after a while
  | 'dogPerson' // seeks out the corgi
  | 'loner' // prefers solitary breaks
  | 'inviter' // invites a favourite colleague along
  | 'observer' // watches a group for a moment before joining
  | 'nookReader' // the reading nook and bookshelf

export const HABIT_LABEL: Record<Habit, string> = {
  coffeeRegular: 'coffee regular',
  walker: 'takes little walks',
  deepFocus: 'heads-down',
  pongFan: 'ping-pong spectator',
  chatty: 'starts conversations',
  gamer: 'console gamer',
  boardWatcher: 'checks the boards',
  stretcher: 'desk stretcher',
  dogPerson: "the dog's friend",
  loner: 'solo breaks',
  inviter: 'brings a friend along',
  observer: 'watches before joining',
  nookReader: 'reading nook'
}

/** How well a habit fits a set of traits (habits follow personality, with room for surprise). */
const HABIT_FIT: Record<Habit, (t: Traits) => number> = {
  coffeeRegular: (t) => 0.5 + t.energy * 0.3,
  walker: (t) => 0.3 + (1 - t.patience) * 0.5 + t.curiosity * 0.2,
  deepFocus: (t) => t.focus * 1.1 - t.sociability * 0.3,
  pongFan: (t) => t.competitiveness * 0.6 + t.curiosity * 0.4,
  chatty: (t) => t.sociability * 0.8 + t.initiative * 0.4 - t.quiet * 0.3,
  gamer: (t) => t.playfulness * 0.8 + t.competitiveness * 0.3,
  boardWatcher: (t) => t.curiosity * 0.5 + t.focus * 0.4,
  stretcher: (t) => 0.3 + t.focus * 0.4,
  dogPerson: (t) => t.dogLove * 1.1,
  loner: (t) => t.quiet * 0.9 - t.sociability * 0.4,
  inviter: (t) => t.initiative * 0.6 + t.friendliness * 0.5,
  observer: (t) => (1 - t.initiative) * 0.6 + t.curiosity * 0.3 + t.sociability * 0.2,
  nookReader: (t) => t.quiet * 0.6 + t.patience * 0.3
}

/** Pairs that contradict each other (a loner isn't also chatty). */
const CLASH: [Habit, Habit][] = [
  ['loner', 'chatty'],
  ['loner', 'inviter'],
  ['deepFocus', 'walker'],
  ['observer', 'chatty']
]

/** Each employee's three signature habits: the best-fitting ones, with a seeded nudge so ties differ. */
export function habitsFor(id: string, t: Traits): Habit[] {
  const r = seeded(hash(`habits:${personaKey(id)}`))
  const ranked = (Object.keys(HABIT_FIT) as Habit[]).map((h) => ({ h, s: HABIT_FIT[h](t) + r() * 0.45 })).sort((a, b) => b.s - a.s)
  const out: Habit[] = []
  for (const { h } of ranked) {
    if (out.length === 3) break
    if (CLASH.some(([a, b]) => (a === h && out.includes(b)) || (b === h && out.includes(a)))) continue
    out.push(h)
  }
  return out
}

export interface Profile {
  traits: Traits
  habits: Habit[]
}

export function profileFor(e: Pick<Employee, 'id' | 'role' | 'capabilities' | 'kinds'>): Profile {
  const traits = traitsFor(e)
  return { traits, habits: habitsFor(e.id, traits) }
}

// ── short-term memory ──────────────────────────────────────────

/** Bounded recent context for one person: what they did, with whom, where. */
export class Recent {
  activities: string[] = []
  partners: string[] = []
  places: string[] = []
  static readonly SIZE = 6

  private push(list: string[], v: string, size = Recent.SIZE): void {
    list.unshift(v)
    if (list.length > size) list.length = size
  }
  did(activity: string, place?: string): void {
    this.push(this.activities, activity)
    if (place) this.push(this.places, place, 4)
  }
  met(id: string): void {
    this.push(this.partners, id, 3)
  }
  /** 1 for something not done lately, smaller the more recently (and often) it was done. */
  freshness(activity: string): number {
    let f = 1
    this.activities.forEach((a, i) => {
      if (a === activity) f *= 0.35 + i * 0.1
    })
    return f
  }
}

// ── personality-weighted utility ───────────────────────────────

export interface Context {
  /** People already at the activity's place (crowd), for quiet-vs-busy preference. */
  crowd: number
  /** A ping-pong rally is on (something to watch). */
  rally: boolean
  /** Tiles to the dog (Infinity when unknown). */
  dogDistance: number
  /** A conversation someone could join is under way. */
  joinable: boolean
}

const SOCIAL = new Set(['chat', 'pingpong', 'huddle', 'lunch', 'joinChat', 'watchPong'])
const SOLO = new Set(['sofa', 'armchair', 'read', 'books', 'window', 'aquarium', 'records', 'stroll'])
const PLAY = new Set(['pingpong', 'foosball', 'arcade', 'beanbag', 'watchPong'])

/**
 * The personality multiplier on an activity's base utility: traits and habits create tendencies,
 * memory keeps people from repeating themselves, and context (crowds, a rally, the dog) matters.
 * Returns 0 when something can't happen right now.
 */
export function personalityWeight(activity: string, p: Profile, recent: Recent, ctx: Context): number {
  const t = p.traits
  const has = (h: Habit) => p.habits.includes(h)
  if (activity === 'watchPong' && !ctx.rally) return 0
  if (activity === 'joinChat' && !ctx.joinable) return 0
  if (activity === 'petDog' && !(ctx.dogDistance < 24)) return 0
  let w = 1
  if (SOCIAL.has(activity)) w *= 0.45 + t.sociability * 1.1
  if (SOLO.has(activity)) w *= 0.55 + t.quiet * 0.9
  if (PLAY.has(activity)) w *= 0.5 + t.playfulness
  if (activity === 'pingpong') w *= 0.6 + t.competitiveness * 0.8
  if (activity === 'desk') w *= 0.6 + t.focus * 0.9
  if (activity === 'roadmap' || activity === 'kanban' || activity === 'moodboard' || activity === 'lightTable') w *= 0.6 + t.curiosity * 0.8
  if (activity === 'petDog') w *= 0.15 + t.dogLove * 1.6 * (1 - Math.min(1, ctx.dogDistance / 30))
  if (activity === 'watchPong') w *= 0.4 + t.curiosity * 0.6 + t.competitiveness * 0.4
  if (activity === 'joinChat') w *= 0.3 + t.friendliness * 0.9
  // habits: the signature tendencies
  if (has('coffeeRegular') && activity === 'coffee') w *= 2.4
  if (has('walker') && (activity === 'stroll' || activity === 'window')) w *= 2.6
  if (has('deepFocus') && activity === 'desk') w *= 1.8
  if (has('pongFan') && activity === 'watchPong') w *= 3
  if (has('chatty') && (activity === 'chat' || activity === 'joinChat')) w *= 2.2
  if (has('gamer') && (activity === 'beanbag' || activity === 'arcade')) w *= 2.4
  if (has('boardWatcher') && (activity === 'kanban' || activity === 'roadmap')) w *= 4
  if (has('dogPerson') && activity === 'petDog') w *= 3
  if (has('loner') && SOCIAL.has(activity)) w *= 0.45
  if (has('loner') && SOLO.has(activity)) w *= 1.6
  if (has('nookReader') && (activity === 'read' || activity === 'books')) w *= 2.6
  // quiet-loving people avoid crowds; extroverts are drawn to them
  if (ctx.crowd > 0) w *= t.quiet > 0.55 ? 1 / (1 + ctx.crowd * (t.quiet - 0.4) * 2) : 1 + Math.min(ctx.crowd, 3) * (0.55 - t.quiet) * 0.4
  return w * recent.freshness(activity)
}

/** How long someone stays: patient people linger, restless ones move on sooner. */
export function stayScale(t: Traits): number {
  return 0.75 + t.patience * 0.5
}

// ── relationships ──────────────────────────────────────────────

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Familiarity between colleagues (0 strangers … 1 close) and with the dog. It starts from a small
 * stable seed, grows only through simulated interactions, and fades very slowly. Bounded: one number
 * per pair of people and one per person for the dog.
 */
export class Relationships {
  private pairs = new Map<string, number>()
  private dog = new Map<string, number>()

  static seedFamiliarity(a: string, b: string): number {
    return 0.05 + ((hash(pairKey(a, b)) % 1000) / 1000) * 0.2
  }

  familiarity(a: string, b: string): number {
    return this.pairs.get(pairKey(a, b)) ?? Relationships.seedFamiliarity(a, b)
  }

  /** A shared moment: a chat, a game, a coffee. Bigger moments count more; growth slows near 1. */
  together(a: string, b: string, amount: number): void {
    if (a === b) return
    const f = this.familiarity(a, b)
    this.pairs.set(pairKey(a, b), Math.min(1, f + amount * (1 - f)))
  }

  dogFamiliarity(id: string): number {
    return this.dog.get(id) ?? 0.1
  }

  withDog(id: string, amount: number): void {
    const f = this.dogFamiliarity(id)
    this.dog.set(id, Math.min(1, f + amount * (1 - f)))
  }

  /** Very slow fading for everyone who isn't meeting (called rarely, e.g. once a session). */
  fade(factor = 0.98): void {
    for (const [k, v] of this.pairs) this.pairs.set(k, Math.max(Relationships.seedFamiliarity(...(k.split('|') as [string, string])), v * factor))
  }

  /** The colleagues someone knows best, among those given, best first. */
  favorites(id: string, among: string[]): string[] {
    return among.filter((x) => x !== id).sort((x, y) => this.familiarity(id, y) - this.familiarity(id, x))
  }

  toJSON(): { pairs: Record<string, number>; dog: Record<string, number> } {
    const round = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 1000) / 1000]))
    return { pairs: round(this.pairs), dog: round(this.dog) }
  }

  static fromJSON(j: unknown): Relationships {
    const r = new Relationships()
    const o = j as { pairs?: Record<string, number>; dog?: Record<string, number> } | null
    for (const [k, v] of Object.entries(o?.pairs ?? {})) if (typeof v === 'number' && k.includes('|')) r.pairs.set(k, clamp(v))
    for (const [k, v] of Object.entries(o?.dog ?? {})) if (typeof v === 'number') r.dog.set(k, clamp(v))
    return r
  }
}

// ── social decisions ───────────────────────────────────────────

export interface Candidate {
  id: string
  profile: Profile
  /** Tiles away. */
  distance: number
}

/** Who someone asks to join them: people they know and like, who are sociable and close by. */
export function choosePartner(me: string, candidates: Candidate[], rel: Relationships, rand: () => number, recentPartners: string[] = []): Candidate | null {
  const scored = candidates
    .filter((c) => c.id !== me)
    .map((c) => {
      const f = rel.familiarity(me, c.id)
      // a little novelty: the very last partner is slightly less likely, so pairings rotate
      const novelty = recentPartners[0] === c.id ? 0.6 : 1
      return { c, s: (0.25 + f * 1.6) * (0.4 + c.profile.traits.sociability) * novelty / (1 + c.distance / 14) }
    })
    .filter((x) => x.s > 0)
  const total = scored.reduce((n, x) => n + x.s, 0)
  let pick = rand() * total
  for (const x of scored) {
    pick -= x.s
    if (pick < 0) return x.c
  }
  return scored[scored.length - 1]?.c ?? null
}

/**
 * Whether an invitation is accepted. Friends and sociable people say yes more; focused or tired-of-it
 * people decline more. Activities they love are hard to turn down.
 */
export function acceptsInvite(invitee: Profile, inviter: string, inviteeId: string, activity: string, rel: Relationships, rand: () => number): boolean {
  const t = invitee.traits
  let p = 0.25 + rel.familiarity(inviter, inviteeId) * 0.45 + t.sociability * 0.25 + t.friendliness * 0.15 - t.focus * 0.25
  if (invitee.habits.includes('deepFocus')) p -= 0.2
  if (invitee.habits.includes('loner')) p -= 0.25
  if (PLAY.has(activity)) p += (t.playfulness - 0.5) * 0.4
  if (activity === 'pingpong') p += (t.competitiveness - 0.5) * 0.3
  if (invitee.habits.includes('gamer') && activity === 'beanbag') p += 0.3
  if (invitee.habits.includes('coffeeRegular') && activity === 'coffee') p += 0.3
  return rand() < Math.min(0.92, Math.max(0.05, p))
}

/** Who wins a friendly game: even odds, nudged slightly by competitiveness. */
export function gameWinner(a: { id: string; traits: Traits }, b: { id: string; traits: Traits }, rand: () => number): string {
  const edge = (a.traits.competitiveness - b.traits.competitiveness) * 0.15
  return rand() < 0.5 + edge ? a.id : b.id
}

export type GameReaction = 'celebrate' | 'smile' | 'shrug' | 'groan' | 'none'

/** How someone takes a result: competitive people show it, quieter ones keep it small. */
export function reactToGame(t: Traits, won: boolean): GameReaction {
  if (won) return t.competitiveness > 0.6 ? 'celebrate' : t.quiet > 0.6 ? 'none' : 'smile'
  return t.competitiveness > 0.7 ? 'groan' : t.patience > 0.5 ? 'shrug' : 'none'
}

/** What someone does when the dog comes up to them, by how much they love dogs and know this one. */
export function dogResponse(t: Traits, dogFamiliarity: number, rand: () => number): 'pet' | 'greet' | 'ignore' {
  const love = t.dogLove * 0.75 + dogFamiliarity * 0.35
  const r = rand()
  if (r < love * 0.8) return 'pet'
  if (r < love * 0.8 + 0.25) return 'greet'
  return 'ignore'
}
