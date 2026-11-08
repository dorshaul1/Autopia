// The one input: what a message is, who should answer and how that person talks. The obvious cases are
// settled here without AI; the rest go to one Claude Code call that replies and decides what happens, in the
// voice of the teammate chosen here. Nothing in this file speaks for anyone: it only sets the stage.

import { isStatusQuestion } from './composer'
import { affectedTasks, plainWords } from './steering'
import type { Employee, Message, Task } from './types'

const IMPERATIVE = /^(please\s+)?(add|make|build|create|fix|change|remove|delete|rename|update|implement|improve|refactor|move|replace|show|hide|allow|support|write|plan)\b/i

/** Only what's certain: a clear instruction, or a status question the records can answer. All else is talk. */
export function understand(text: string): 'work' | 'status' | 'talk' {
  const t = text.trim()
  if (isStatusQuestion(t)) return 'status'
  if ((IMPERATIVE.test(t) || /^bug:\s/i.test(t)) && !t.endsWith('?') && t.split(/\s+/).length >= 3) return 'work'
  return 'talk'
}

/**
 * In a project with nothing in it, saying what it should be is asking for it, however it's phrased: "A timer page served
 * by a small server" has no verb to find. Questions, greetings and thinking aloud still get a reply.
 */
export function describesAProduct(text: string): boolean {
  const t = text.trim()
  return t.split(/\s+/).length >= 4 && !/\?\s*$/.test(t) && !/^(what|why|how|when|where|who|which|can|could|should|would|do|does|is|are|hi|hey|hello|thanks|thank)\b/i.test(t) && !/\b(thinking|wondering|maybe|not sure|i guess)\b/i.test(t)
}

type Person = Pick<Employee, 'id' | 'name' | 'role' | 'kinds'>
const EXPERTISE: [RegExp, (p: Person) => boolean][] = [
  [/\b(design|color|colour|font|layout|style|styling|css|ui|ux|look|looks|icon|spacing|animation|accessib\w*)\b/i, (p) => p.kinds.includes('design')],
  [/\b(test|tests|testing|qa|flaky|regression|coverage)\b/i, (p) => p.kinds.includes('qa')],
  [/\b(api|database|schema|server|backend|architecture|performance|deploy|code|function|bug|crash\w*|error|exception|stack)\b/i, (p) => p.role === 'lead_dev' || p.kinds.includes('code')],
  [/\b(plan|priority|priorities|roadmap|timeline|when|scope|estimate|deadline)\b/i, (p) => p.role === 'pm']
]

/**
 * The teammate who answers: whoever you addressed, whoever owns what you're asking about, whoever you were
 * just talking to, the one whose expertise it is, and otherwise the project lead.
 */
export function pickResponder(x: { text: string; employeeId?: string | null; taskId?: string | null; team: Person[]; tasks: Pick<Task, 'id' | 'key' | 'title' | 'description' | 'files' | 'changedFiles' | 'assigneeId' | 'status'>[]; recent: Pick<Message, 'role' | 'employeeId' | 'createdAt'>[]; now: number }): { id: string; why: 'addressed' | 'owner' | 'continuing' | 'expertise' | 'lead' } {
  const onTeam = (id: string | null | undefined) => !!id && x.team.some((p) => p.id === id)
  if (onTeam(x.employeeId)) return { id: x.employeeId!, why: 'addressed' }
  const said = new Set(plainWords(x.text))
  const named = x.team.find((p) => said.has(plainWords(p.name)[0]))
  if (named) return { id: named.id, why: 'addressed' }
  const owner = x.tasks.find((t) => t.id === x.taskId)?.assigneeId
  if (onTeam(owner)) return { id: owner!, why: 'owner' }
  const expert = EXPERTISE.find(([re]) => re.test(x.text))?.[1]
  const last = [...x.recent].reverse().find((m) => m.role === 'autopia' && onTeam(m.employeeId))
  const fresh = last && x.now - last.createdAt < 15 * 60_000
  if (fresh && (!expert || expert(x.team.find((p) => p.id === last.employeeId)!))) return { id: last.employeeId!, why: 'continuing' }
  const active = x.tasks.filter((t) => t.status === 'running')
  const about = active.length ? affectedTasks(x.text, active, x.team) : null
  if (about?.scope === 'matched' && onTeam(about.tasks[0].assigneeId)) return { id: about.tasks[0].assigneeId, why: 'owner' }
  const fit = expert ? x.team.find(expert) : null
  if (fit) return { id: fit.id, why: 'expertise' }
  return { id: (x.team.find((p) => p.role === 'pm') ?? x.team[0]).id, why: 'lead' }
}

export interface Voice {
  humor: string
  warmth: string
  directness: string
  vocabulary: string
  depth: string
  confidence: string
  quirk: string
}

/** The founding team, written by hand. Everyone else gets a stable voice drawn from their identity. */
const AUTHORED: Record<string, Voice> = {
  'emp-maya': { humor: 'dry, the occasional raised-eyebrow aside', warmth: 'warm, looks out for people', directness: 'leads with the answer and the next step', vocabulary: 'plain words, product terms over jargon', depth: 'stays at what it means for you unless asked', confidence: 'calm, says "I don\'t know yet" without fuss', quirk: 'sums a muddle up in one short sentence' },
  'emp-theo': { humor: 'deadpan, mostly at the expense of old code', warmth: 'friendly but sparing with words', directness: 'blunt, no softening, never rude', vocabulary: 'precise engineering terms, used correctly', depth: 'names the real file or mechanism when it helps', confidence: 'firm about what he has checked, explicit about what he hasn\'t', quirk: 'tends to start with the conclusion, then one reason' },
  'emp-ines': { humor: 'playful, sees the funny side of small details', warmth: 'enthusiastic and encouraging', directness: 'honest about what looks wrong, kindly', vocabulary: 'visual words: rhythm, weight, breathing room', depth: 'talks about how it feels to use before how it is built', confidence: 'sure of her eye, happy to be persuaded', quirk: 'notices one small detail nobody asked about' },
  'emp-kenji': { humor: 'very dry and rare, usually about things breaking', warmth: 'polite and steady', directness: 'exact, separates what he saw from what he assumes', vocabulary: 'careful, concrete, avoids superlatives', depth: 'gives the steps that reproduce it', confidence: 'trusts evidence, not vibes, and says which one he has', quirk: 'asks how you know, once, when it matters' }
}

const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}
const POOL: { [K in keyof Voice]: string[] } = {
  humor: ['dry one-liners, sparingly', 'light teasing among friends', 'rarely jokes, earnest', 'nerdy references, once in a while', 'cheerful, laughs at their own mistakes'],
  warmth: ['warm and easy', 'reserved until they know you', 'upbeat', 'quietly kind', 'matter-of-fact but caring'],
  directness: ['says it straight', 'gentle, leads you there', 'brief to the point of terse', 'thinks out loud a little, then lands it'],
  vocabulary: ['casual, contractions everywhere', 'tidy and precise', 'vivid comparisons from everyday life', 'plain, short words'],
  depth: ['goes technical only when asked', 'likes naming the actual mechanism', 'explains the why before the how'],
  confidence: ['confident, owns it when wrong', 'measured, hedges only when truly unsure', 'modest, credits teammates'],
  quirk: ['often answers with a tiny example', 'tends to end on the one thing they would do next', 'brings up how players or users will feel', 'likes a short list of two', 'asks one good question back when it helps', 'compares things to something they tried before']
}

/** The same person sounds the same in every office and every session. */
export function voiceOf(e: Pick<Employee, 'id'>): Voice {
  const key = e.id.split('@')[0]
  if (AUTHORED[key]) return AUTHORED[key]
  const pick = (k: keyof Voice) => POOL[k][hash(`${k}:${key}`) % POOL[k].length]
  return { humor: pick('humor'), warmth: pick('warmth'), directness: pick('directness'), vocabulary: pick('vocabulary'), depth: pick('depth'), confidence: pick('confidence'), quirk: pick('quirk') }
}

export function voicePrompt(e: Pick<Employee, 'id'>): string {
  const v = voiceOf(e)
  return `How you talk: humor: ${v.humor}. Warmth: ${v.warmth}. Directness: ${v.directness}. Words: ${v.vocabulary}. Technical depth: ${v.depth}. Confidence: ${v.confidence}. Habit: ${v.quirk}.`
}

export type TalkAction = 'none' | 'clarify' | 'new_work' | 'change' | 'bug'
export interface TalkOutput {
  reply: string
  action: TalkAction
  /** The instruction in full, understood from the conversation ("that header" spelled out). */
  request: string | null
  /** A teammate who should take this instead. */
  handoff: string | null
}

export function parseTalk(raw: unknown): TalkOutput | null {
  const o = raw as Partial<TalkOutput> | null
  if (!o || typeof o.reply !== 'string' || !o.reply.trim()) return null
  const action = (['none', 'clarify', 'new_work', 'change', 'bug'] as const).find((a) => a === o.action) ?? 'none'
  const request = typeof o.request === 'string' && o.request.trim() ? o.request.trim() : null
  // something to do with nothing said about what: asking is the safe reading
  return { reply: o.reply.trim(), action: action !== 'none' && action !== 'clarify' && !request ? 'clarify' : action, request, handoff: typeof o.handoff === 'string' && o.handoff.trim() ? o.handoff.trim() : null }
}

/** A message that needs no project knowledge, so it runs on the lightest model with no tools at all. */
export const isCasual = (text: string) => text.trim().split(/\s+/).length <= 6 && !/\b[\w-]+\.[a-z][a-z0-9]{0,4}\b/i.test(text) && !/\b(file|code|why|how|bug|error|page|build|test|fail\w*|broken)\b/i.test(text)
