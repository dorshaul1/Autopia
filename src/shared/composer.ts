// What the Composer does with a message, decided locally (no AI) from what you wrote and the project's
// real state: no mode to pick. You can still send it the other way with one click.

import type { Message, MessageIntent } from './types'

export interface IntentContext {
  text: string
  newProject: boolean
  /** Planning or building right now. */
  busy: boolean
  /** A plan is waiting for your OK. */
  planPending: boolean
  /** Something has been delivered (in review or accepted). */
  delivered: boolean
  employeeId: string | null
  /** Files attached: a one-word message with a screenshot can still be a request. */
  hasFiles?: boolean
}

export const INTENT_LABEL: Record<MessageIntent, string> = {
  build: 'Start building',
  plan: 'Plan a new feature',
  change: 'Request a change',
  note: 'Feedback for the team',
  ask: 'Ask a question',
  reply: 'Change the plan'
}

/** One line under the composer saying exactly what happens on send. */
export function intentHint(intent: MessageIntent, ctx: Pick<IntentContext, 'newProject' | 'employeeId'>, employeeName: string | null): string {
  if (ctx.newProject) return intent === 'ask' ? 'Creates the project, then answers. Nothing is changed.' : 'Creates a project in ~/Autopia and gets started. Big ideas get a plan for your OK first.'
  switch (intent) {
    case 'build':
      return 'Small requests start right away. Big ones get a plan for your OK first.'
    case 'plan':
      return 'Maya plans it first. Nothing is built until you approve.'
    case 'change':
      return employeeName ? `${employeeName} makes the change and keeps everything else working.` : 'One teammate makes the change and keeps everything else working.'
    case 'note':
      return 'Reaches the teammates it concerns at their next step, and steps not started yet. Nothing restarts.'
    case 'ask':
      return `${employeeName ?? 'A teammate'} reads the project and answers. Nothing is changed.`
    case 'reply':
      return 'Maya revises the plan. Nothing is built until you approve it.'
  }
}

const QUESTION = /\?\s*$|^(why|how|what|where|when|which|who|whose|is|are|does|do|did|can you explain|explain|tell me|could you tell)\b/i
const IMPERATIVE = /^(add|make|build|create|fix|change|remove|delete|rename|update|implement|improve|refactor|move|use|replace|set|show|hide|allow|support)\b/i

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  return !!t && QUESTION.test(t) && !IMPERATIVE.test(t)
}

/** The options that make sense right now, the default first. */
export function intentOptions(ctx: IntentContext): MessageIntent[] {
  const q = looksLikeQuestion(ctx.text)
  let list: MessageIntent[]
  if (ctx.newProject) list = ['build']
  else if (ctx.planPending) list = ['reply', 'ask']
  else if (ctx.busy) list = ['note', 'ask']
  else if (ctx.delivered) list = ['change', 'plan', 'ask']
  else list = ['build', 'plan', 'ask']
  if (q && list.includes('ask')) list = ['ask', ...list.filter((x) => x !== 'ask')]
  return list
}

/** "What's happening?", "why did it fail?", "what changed?": answered from records, no AI call. */
const STATUS = /\b(what('?s| is) \S+ (doing|working on)|what'?s (happening|going on|the status|left|next|blocking)|status|progress|how far|how (is|are) (it|things|we) going|what (did|has) (changed|been done)|what changed|why (did|does|is) (it|this|that|the \w+) (fail|stuck|stop|blocked|slow)|why (it|is it) (failed|stuck|stopped)|is (it|anyone|the team) (working|done|stuck)|who is (working|on))\b/i

const SMALL_TALK = /^(hi+|hey+|hello+|hiya|yo|sup|howdy|shalom|good (morning|afternoon|evening|night)|morning|how are you|what'?s up|thanks?( you)?( so much)?|thx|ty|cheers|ok(ay)?|k|cool|nice|great|good|awesome|perfect|got it|sure|yes|yep|no|nope|lol|bye|test(ing)?|שלום|היי|הי|מה קורה|תודה( רבה)?|אוקיי?|סבבה|יופי|מעולה|כן|לא)[\s!.,?…]*$/iu

/** A greeting or thanks to someone: "hi theo", "hello team", "thanks maya". */
const GREETING_TO = /^(hi+|hey+|hello+|hiya|yo|howdy|shalom|good (morning|afternoon|evening)|thanks?( you)?|thx|שלום|היי|הי|תודה)\s+[\p{L}'’-]+[\s!.,?…]*$/iu

/**
 * Not a request for work: a greeting, a thanks, or a single word that says nothing to act on (a typo
 * included). It gets an answer right away; nobody is put to work and no result is created.
 */
export function isSmallTalk(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return SMALL_TALK.test(t) || GREETING_TO.test(t) || t.split(/\s+/).length === 1
}

export function isStatusQuestion(text: string): boolean {
  const t = text.trim()
  // "build a tracker that filters by status" is a request that happens to contain the word
  return STATUS.test(t) && !IMPERATIVE.test(t) && (t.endsWith('?') || t.split(/\s+/).length <= 10)
}

/**
 * The one intent for a message, decided locally from what you wrote and the project's real state: no
 * mode to pick before sending. Questions are answered (status questions from records, others by a
 * read-only session); everything else becomes work, a change, plan feedback, or feedback that reaches
 * whoever is working now.
 */
export function resolveIntent(ctx: IntentContext): MessageIntent {
  if (ctx.newProject) return 'build'
  const t = ctx.text.trim()
  if (looksLikeQuestion(t) || isStatusQuestion(t) || (isSmallTalk(t) && !ctx.hasFiles)) return 'ask'
  if (ctx.planPending) return 'reply'
  if (ctx.busy) return 'note'
  if (/^(plan|design a plan|make a plan|let'?s plan)\b/i.test(t)) return 'plan'
  return ctx.delivered ? 'change' : 'build'
}

/** Where one of your messages stands, in plain words: every message shows a state until its outcome. */
export function messageStateLabel(status: Message['status'], intent: MessageIntent): string {
  if (status === 'queued') return 'queued for the session that’s running'
  if (status === 'delivered') return intent === 'note' ? 'delivered to the team' : 'delivered'
  if (status === 'failed') return 'failed'
  if (status === 'working') return intent === 'ask' ? 'being answered' : 'in progress'
  if (intent === 'ask') return status === 'answered' ? 'answered' : 'question'
  if (intent === 'reply') return 'plan feedback'
  if (intent === 'note') return 'shared with the team'
  return intent === 'change' ? 'change request' : 'request'
}

/** A readable project name from the idea. */
export function projectNameFrom(idea: string): string {
  // if you named it, that's its name
  const called = /\b(?:called|named)\s+["“']?([\p{Lu}\p{N}][\p{L}\p{N}'’-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}'’-]*){0,3})/u.exec(idea)
  if (called) return called[1].slice(0, 40)
  const first = idea.trim().split(/[.:\n!?]/)[0]
  const stop = new Set(['my', 'our', 'your', 'a', 'an', 'the', 'build', 'make', 'create', 'me', 'i', 'want', 'need', 'please', 'small', 'simple', 'web', 'app', 'that', 'for', 'to', 'with', 'where', 'which', 'lets', "let's"])
  const words = first.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w && !stop.has(w.toLowerCase()))
  const pick = words.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1))
  return (pick.join(' ') || 'New project').slice(0, 40)
}
