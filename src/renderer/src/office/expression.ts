// How each person expresses themselves: body-language style from their traits, coordinated
// conversations with turn-taking, and readable reactions to real moments. Pure and seeded; the
// scene and Character play the poses. Ambient only: conversations are body language and generic
// speech bubbles, never words, and nothing here implies work that didn't happen.

import type { Traits } from './personality'

// ── style ──────────────────────────────────────────────────────

export type Amplitude = 'subtle' | 'moderate' | 'lively'

export interface ExpressionStyle {
  /** 0 reserved … 1 animated. */
  liveliness: number
  amplitude: Amplitude
  /** Chance a speaking turn includes a gesture (pointing, explaining). */
  gestureRate: number
  /** Chance per turn a listener nods along. */
  nodRate: number
  /** How readily they laugh. */
  laughRate: number
  /** Walking: speed multiplier and steps per second. */
  pace: number
  walkFps: number
  /** Idle habit while standing around. */
  idle: 'lookAround' | 'think' | 'still'
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

/** A recognisable expressive identity from the traits people already have. */
export function styleFor(t: Traits): ExpressionStyle {
  const liveliness = clamp(t.energy * 0.45 + t.playfulness * 0.3 + t.sociability * 0.25 - t.quiet * 0.2 + 0.1)
  return {
    liveliness,
    amplitude: liveliness > 0.62 ? 'lively' : liveliness < 0.38 ? 'subtle' : 'moderate',
    gestureRate: clamp(0.1 + liveliness * 0.6 + t.initiative * 0.15),
    nodRate: clamp(0.2 + t.friendliness * 0.45 + t.patience * 0.2),
    laughRate: clamp(t.playfulness * 0.5 + t.friendliness * 0.2 - t.quiet * 0.15),
    pace: 0.88 + t.energy * 0.22,
    walkFps: Math.round(7 + t.energy * 3),
    idle: t.curiosity > 0.65 ? 'think' : liveliness > 0.55 ? 'lookAround' : 'still'
  }
}

// ── conversations ──────────────────────────────────────────────

export interface Talker {
  id: string
  traits: Traits
}

export type ListenerCue = 'nod' | 'laugh'

export interface Turn {
  /** Index into the members list. */
  speaker: number
  ms: number
  /** The speaker emphasises with a gesture this turn. */
  gesture: boolean
  /** How listeners respond during the turn (offset ms from the turn start). */
  cues: { who: number; at: number; cue: ListenerCue }[]
}

export interface ConversationPlan {
  turns: Turn[]
  /** Who says goodbye first at the end. */
  closer: number
}

/**
 * A conversation as alternating turns: talkative people speak more and longer, a person seldom speaks
 * three times running, listeners nod and laugh by temperament (laughs are more likely after a playful
 * speaker), and it ends with a goodbye from whoever has the most initiative. Durations fill `totalMs`.
 */
export function planConversation(members: Talker[], totalMs: number, rand: () => number): ConversationPlan {
  const styles = members.map((m) => styleFor(m.traits))
  const share = members.map((m) => 0.3 + m.traits.sociability * 0.6 + m.traits.initiative * 0.3)
  const turns: Turn[] = []
  let used = 0
  let last = -1
  let streak = 0
  while (used < totalMs - 800 && turns.length < 40) {
    // weighted speaker choice; nobody holds the floor three turns in a row
    const options = members.map((_, i) => i).filter((i) => !(i === last && streak >= 2))
    const total = options.reduce((n, i) => n + share[i] * (i === last ? 0.45 : 1), 0)
    let pick = rand() * total
    let speaker = options[options.length - 1]
    for (const i of options) {
      pick -= share[i] * (i === last ? 0.45 : 1)
      if (pick < 0) {
        speaker = i
        break
      }
    }
    streak = speaker === last ? streak + 1 : 1
    last = speaker
    const s = members[speaker].traits
    const ms = Math.min(totalMs - used, Math.round(1400 + rand() * 1800 + s.sociability * 1200 + s.energy * 600))
    const cues: Turn['cues'] = []
    members.forEach((_, who) => {
      if (who === speaker) return
      if (rand() < styles[who].nodRate) cues.push({ who, at: Math.round(ms * (0.3 + rand() * 0.4)), cue: 'nod' })
      const funny = members[speaker].traits.playfulness
      if (rand() < styles[who].laughRate * (0.25 + funny * 0.6)) cues.push({ who, at: Math.round(ms * (0.55 + rand() * 0.3)), cue: 'laugh' })
    })
    turns.push({ speaker, ms, gesture: rand() < styles[speaker].gestureRate, cues })
    used += ms
  }
  let closer = 0
  members.forEach((m, i) => {
    if (m.traits.initiative > members[closer].traits.initiative) closer = i
  })
  return { turns, closer }
}

// ── emotions for real moments ──────────────────────────────────

export type Emotion = 'happy' | 'excited' | 'satisfied' | 'curious' | 'surprised' | 'confused' | 'frustrated' | 'focused'

export type Moment =
  /** Their own task's checks passed (a real event). */
  | 'verified'
  /** A check failed on their running task (real). */
  | 'setback'
  /** They were just assigned real work. */
  | 'taskStart'
  | 'gameWon'
  | 'gameLost'
  /** Someone they invited said no. */
  | 'declined'
  /** The dog tore past (zoomies). */
  | 'zoomies'
  /** Watching an exciting rally. */
  | 'watching'

/**
 * A restrained, readable emotion for a moment, by temperament. Real setbacks get mild frustration or
 * calm focus, never drama; successes get joy that fits the person.
 */
export function emotionFor(m: Moment, t: Traits, rand: () => number): Emotion | null {
  const lively = styleFor(t).liveliness
  switch (m) {
    case 'verified':
      return lively > 0.6 ? 'excited' : t.quiet > 0.6 ? 'satisfied' : 'happy'
    case 'setback':
      return t.patience < 0.35 ? 'frustrated' : 'focused'
    case 'taskStart':
      return 'focused'
    case 'gameWon':
      return t.competitiveness > 0.6 || lively > 0.65 ? 'excited' : t.quiet > 0.6 ? 'satisfied' : 'happy'
    case 'gameLost':
      return t.competitiveness > 0.7 && t.patience < 0.5 ? 'frustrated' : 'satisfied'
    case 'declined':
      return rand() < 0.6 ? 'confused' : null
    case 'zoomies':
      return t.curiosity > 0.5 || lively > 0.55 ? 'surprised' : rand() < 0.4 ? 'curious' : null
    case 'watching':
      return t.curiosity > 0.55 ? 'curious' : rand() < lively ? 'excited' : null
  }
}

/** The pose that shows an emotion while standing (and whether it needs to face the viewer). */
export type Pose = 'cheer' | 'shrug' | 'think' | 'surprise' | 'nod' | 'laugh' | 'lean' | 'still'
export function poseFor(e: Emotion, amplitude: Amplitude): Pose {
  switch (e) {
    case 'excited':
      return amplitude === 'subtle' ? 'nod' : 'cheer'
    case 'happy':
      return amplitude === 'lively' ? 'laugh' : 'nod'
    case 'satisfied':
      return 'nod'
    case 'curious':
      return 'lean'
    case 'surprised':
      return amplitude === 'subtle' ? 'still' : 'surprise'
    case 'confused':
      return 'shrug'
    case 'frustrated':
      return amplitude === 'subtle' ? 'still' : 'shrug'
    case 'focused':
      return amplitude === 'lively' ? 'nod' : 'still'
  }
}
