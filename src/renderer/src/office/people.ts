// Getting to know a teammate: a readable description of the personality they already have, their
// preferred breaks, and how they respond when you suggest one. Pure and deterministic (seeded);
// everything is derived from personality.ts, so there is one source of truth.

import { ACTIVITIES } from './behavior'
import { Recent, personalityWeight, type Profile, type Traits } from './personality'

// ── description ────────────────────────────────────────────────

/** Words for the ends of each trait (low, high). */
const WORDS: Record<keyof Traits, [string, string]> = {
  sociability: ['reserved', 'outgoing'],
  playfulness: ['earnest', 'playful'],
  competitiveness: ['easygoing', 'competitive'],
  curiosity: ['steady', 'curious'],
  focus: ['easily distracted', 'focused'],
  energy: ['calm', 'energetic'],
  patience: ['restless', 'patient'],
  initiative: ['laid-back', 'proactive'],
  friendliness: ['cool', 'warm'],
  quiet: ['lively-room', 'quiet-loving'],
  dogLove: ['indifferent to dogs', 'dog-loving']
}

export interface TraitChip {
  key: keyof Traits
  word: string
  /** 0…1, how strongly it shows. */
  strength: number
}

/** The traits that stand out most for this person (furthest from average), strongest first. */
export function standoutTraits(t: Traits, n = 4): TraitChip[] {
  return (Object.keys(WORDS) as (keyof Traits)[])
    .filter((k) => k !== 'quiet' || t.quiet > 0.5) // "lively-room" isn't a phrase people use
    .map((k) => ({ key: k, word: WORDS[k][t[k] >= 0.5 ? 1 : 0], strength: Math.abs(t[k] - 0.5) * 2 }))
    .filter((c) => c.strength > 0.25)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, n)
}

/** Each habit as something a person does, for a natural sentence. */
const HABIT_VERB: Record<Profile['habits'][number], string> = {
  coffeeRegular: 'keeps going back for coffee',
  walker: 'takes little walks',
  deepFocus: 'goes heads-down when working',
  pongFan: 'watches the ping-pong',
  chatty: 'starts conversations',
  gamer: 'plays console games',
  boardWatcher: 'checks the team boards',
  stretcher: 'stretches at the desk',
  dogPerson: 'makes time for Puffy',
  loner: 'takes breaks alone',
  inviter: 'brings a friend along',
  observer: 'watches before joining in',
  nookReader: 'reads in the nook'
}

/** One or two plain sentences: who they are, from their strongest traits and signature habits. */
export function describePerson(firstName: string, p: Profile): string {
  const chips = standoutTraits(p.traits, 3).map((c) => c.word)
  const lead = chips.length >= 2 ? `${chips.slice(0, -1).join(', ')} and ${chips[chips.length - 1]}` : chips[0] ?? 'even-tempered'
  const habits = p.habits.map((h) => HABIT_VERB[h])
  const article = /^[aeiou]/i.test(lead) ? 'An' : 'A'
  return `${article} ${lead} teammate. ${firstName} ${habits.length > 1 ? `${habits.slice(0, -1).join(', ')} and ${habits[habits.length - 1]}` : habits[0]}.`
}

// ── preferences ────────────────────────────────────────────────

/** Readable names for the breaks people take. */
export const BREAK_LABEL: Record<string, string> = {
  coffee: 'coffee',
  water: 'the water cooler',
  snack: 'a snack',
  lunch: 'lunch',
  island: 'the kitchen island',
  sofa: 'the sofa',
  armchair: 'an armchair',
  read: 'the reading nook',
  books: 'the bookshelf',
  window: 'the window',
  aquarium: 'the aquarium',
  records: 'the record player',
  arcade: 'the arcade',
  beanbag: 'console games',
  chat: 'a chat',
  pingpong: 'ping-pong',
  huddle: 'the huddle table',
  phone: 'phone calls',
  moodboard: 'the moodboard',
  lightTable: 'the light table',
  roadmap: 'the milestone wall',
  kanban: 'the team board',
  stroll: 'a short walk',
  watchPong: 'watching ping-pong',
  joinChat: 'joining conversations',
  petDog: 'time with Puffy'
}

/** Their favourite breaks: the activities their personality weighs most, in a neutral moment. */
export function preferredBreaks(p: Profile, n = 3): string[] {
  const ctx = { crowd: 0, rally: true, dogDistance: 8, joinable: true }
  return ACTIVITIES.filter((a) => BREAK_LABEL[a.id] && a.id !== 'desk')
    .map((a) => ({ id: a.id, w: a.base * personalityWeight(a.id, p, new Recent(), ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map((x) => BREAK_LABEL[x.id])
}

/** How someone gets on with the dog, in words (from their love of dogs and how well they know her). */
export function dogLine(firstName: string, t: Traits, familiarity: number): string {
  const bond = t.dogLove * 0.7 + familiarity * 0.3
  if (bond > 0.7) return `Puffy's favourite person. ${firstName} stops for a fuss whenever he's around.`
  if (bond > 0.5) return `Gets on well with Puffy and often says hello.`
  if (bond > 0.3) return `Friendly with Puffy, in passing.`
  return `Not much of a dog person; Puffy mostly leaves ${firstName} be.`
}

/** Familiarity in words. */
export function closeness(f: number): string {
  return f > 0.6 ? 'close' : f > 0.35 ? 'friendly' : f > 0.18 ? 'getting to know' : 'acquainted'
}

// ── suggestions from you ───────────────────────────────────────

/** Breaks you can suggest; each maps to a real activity and place in the office. */
export const SUGGESTIONS = [
  { id: 'coffee', label: 'Coffee break', icon: 'coffee' },
  { id: 'pingpong', label: 'Ping-pong', icon: 'play' },
  { id: 'beanbag', label: 'Console games', icon: 'play' },
  { id: 'chat', label: 'Chat with someone', icon: 'chat' },
  { id: 'petDog', label: 'Visit Puffy', icon: 'fish' },
  { id: 'sofa', label: 'Sit in the lounge', icon: 'moon' }
] as const
export type SuggestionId = (typeof SUGGESTIONS)[number]['id']

export type Answer = 'accept' | 'later' | 'decline'

/**
 * How someone answers your suggestion. People like things that fit them; focused people often finish
 * what they're doing first; loners pass on social plans. Busy-with-real-work never reaches here.
 */
export function answerSuggestion(p: Profile, id: SuggestionId, midActivity: boolean, rand: () => number): Answer {
  const t = p.traits
  const ctx = { crowd: 0, rally: true, dogDistance: 8, joinable: true }
  const like = personalityWeight(id === 'chat' ? 'chat' : id, p, new Recent(), ctx)
  let yes = 0.45 + Math.min(0.35, (like - 1) * 0.25) + t.friendliness * 0.15 - (p.habits.includes('deepFocus') ? 0.1 : 0)
  if ((id === 'chat' || id === 'pingpong') && p.habits.includes('loner')) yes -= 0.25
  const r = rand()
  if (r < Math.min(0.92, Math.max(0.12, yes))) return midActivity && t.patience > 0.4 ? 'later' : 'accept'
  return r < Math.min(0.97, yes + 0.25) ? 'later' : 'decline'
}

/** What you see after suggesting something (plain, in the team's voice; no fabricated dialogue). */
const PHRASE: Record<SuggestionId, string> = {
  coffee: 'a coffee',
  pingpong: 'a game of ping-pong',
  beanbag: 'some console games',
  chat: 'a chat',
  petDog: 'a visit to Puffy',
  sofa: 'some time in the lounge'
}

export function answerLine(firstName: string, id: SuggestionId, a: Answer, partner?: string): string {
  const what = PHRASE[id]
  if (a === 'accept') return partner ? `${firstName} is heading over with ${partner}.` : `${firstName} is up for ${what}.`
  if (a === 'later') return `${firstName} will go once this is done.`
  return `${firstName} would rather not right now.`
}
