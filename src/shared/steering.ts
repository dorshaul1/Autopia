// What a message sent during the work means, decided locally: which tasks it concerns and whether it's a
// plain instruction to the team (cancel, reprioritize, reorder, reassign). No AI call. When the words don't
// clearly name one task, it asks instead of guessing; when they don't concern anyone specific, everyone hears it.

import type { Employee, Message, Task } from './types'

export type SteerTask = Pick<Task, 'id' | 'key' | 'title' | 'description' | 'files' | 'changedFiles' | 'assigneeId'>
type Person = Pick<Employee, 'id' | 'name'>

const STOP = new Set(
  'the and for with from that this these those have has had was were are not but you your our all any can could would should will shall may might must need needs want wants please also instead now new just like more less very some them they then than into onto over under page pages file files task tasks step steps work team make makes use using add adds change changes create build implement update shared part thing things one two out get let its'.split(' ')
)

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).filter((w) => w.length >= 3 && !STOP.has(w))

const GLOBAL = /\b(all|every|everyone|everybody|everywhere|both|whole|entire|across|site-?wide|globally|team)\b/i
/** Asks for something to be different, as opposed to "fyi" and thanks. */
const ACTIONABLE = /\b(add|make|use|change|remove|replace|rename|fix|should|must|need|needs|instead|switch|move|show|hide|update|keep|don'?t|do not|never|always|only|avoid|prefer)\b/i

/** "Inés" and "ines" are the same person. */
export const plainWords = (s: string): string[] => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const firstName = (name: string) => plainWords(name)[0] ?? ''

/** The tasks a message is about, or everyone when it doesn't single anyone out. */
export function affectedTasks<T extends SteerTask>(text: string, tasks: T[], people: Person[]): { tasks: T[]; scope: 'named' | 'matched' | 'everyone' } {
  const keys = new Set((text.match(/\bT\d+(?:\.\d+)?\b/g) ?? []).map((k) => k.toUpperCase()))
  const said = new Set(plainWords(text))
  const named = people.filter((p) => said.has(firstName(p.name))).map((p) => p.id)
  const direct = tasks.filter((t) => keys.has(t.key) || named.includes(t.assigneeId))
  if (direct.length) return { tasks: direct, scope: 'named' }
  if (GLOBAL.test(text)) return { tasks, scope: 'everyone' }
  const asked = new Set(wordsOf(text))
  const scored = tasks.map((t) => {
    let score = 0
    for (const w of new Set(wordsOf(t.title))) if (asked.has(w)) score += 2
    for (const f of [...t.files, ...t.changedFiles]) {
      const base = f.replace(/^\S+\s+(?=\S)/, '').split('/').pop() ?? ''
      if (base && text.toLowerCase().includes(base.toLowerCase())) score += 4
      else if (wordsOf(base.replace(/\.\w+$/, '')).some((w) => asked.has(w))) score += 2
    }
    for (const w of new Set(wordsOf(t.description))) if (asked.has(w)) score += 0.5
    return { t, score }
  })
  const best = Math.max(0, ...scored.map((s) => s.score))
  if (best < 2) return { tasks, scope: 'everyone' }
  return { tasks: scored.filter((s) => s.score >= best / 2 && s.score >= 2).map((s) => s.t), scope: 'matched' }
}

export interface RoutingPlan<T> {
  /** Sessions running (or stopped and able to continue) that hear it now. */
  reach: T[]
  /** Steps not started yet that it concerns. */
  upcoming: T[]
  /** Finished steps it changes: those need a follow-up, since nobody is working on them any more. */
  revisit: T[]
  scope: 'named' | 'matched' | 'everyone'
}

export function planRouting<T extends SteerTask>(x: { text: string; running: T[]; upcoming: T[]; finished: T[]; people: Person[]; onlyTaskId?: string | null; onlyEmployeeId?: string | null }): RoutingPlan<T> {
  const pick = (t: T) => (x.onlyTaskId ? t.id === x.onlyTaskId : t.assigneeId === x.onlyEmployeeId)
  if (x.onlyTaskId || x.onlyEmployeeId) {
    const finished = x.finished.filter(pick)
    const reach = x.running.filter(pick)
    const upcoming = x.upcoming.filter(pick)
    return { reach, upcoming, revisit: !reach.length && !upcoming.length && ACTIONABLE.test(x.text) ? finished : [], scope: 'named' }
  }
  const { tasks, scope } = affectedTasks(x.text, [...x.running, ...x.upcoming, ...x.finished], x.people)
  const has = (list: T[]) => list.filter((t) => tasks.includes(t))
  return { reach: has(x.running), upcoming: has(x.upcoming), revisit: ACTIONABLE.test(x.text) ? has(x.finished) : [], scope }
}

export type SteerCommand<T> =
  | { kind: 'cancel'; task: T }
  | { kind: 'prioritize'; task: T }
  | { kind: 'order'; first: T; then: T }
  | { kind: 'assign'; task: T; employee: Person }
  | { kind: 'clarify'; verb: string; candidates: T[] }

/** One task from a phrase: its key, or most of the phrase in its title. Several equally good: several back. */
function findTask<T extends SteerTask>(phrase: string, tasks: T[]): T[] {
  const key = phrase.match(/\bT\d+(?:\.\d+)?\b/i)?.[0].toUpperCase()
  if (key) return tasks.filter((t) => t.key === key)
  const asked = [...new Set(wordsOf(phrase))]
  if (!asked.length) return []
  const scored = tasks.map((t) => {
    const title = new Set(wordsOf(t.title))
    return { t, hits: asked.filter((w) => title.has(w)).length }
  })
  const best = Math.max(0, ...scored.map((s) => s.hits))
  if (!best || best / asked.length < 0.5) return []
  return scored.filter((s) => s.hits === best).map((s) => s.t)
}

const POLITE = /^(?:please\s+|can you\s+|could you\s+|let'?s\s+|ok(?:ay)?[,\s]+)*/i
const CANCEL = /^(?:cancel|skip|drop|forget(?:\s+about)?|don'?t\s+(?:do|build|bother\s+with|work\s+on)|no\s+need\s+(?:for|to\s+do)|stop\s+working\s+on)\s+(.+)$/i
const ASSIGN = /^(?:give|assign|hand|move|reassign)\s+(.+?)\s+to\s+([\p{L}]+)$/iu
const LET = /^let\s+([\p{L}]+)\s+(?:do|handle|take|own)\s+(.+)$/iu
const ORDER = /^(?:do|build|finish|start)\s+(.+?)\s+(before|after)\s+(.+)$/i
const PRIORITY = [/^(?:prioriti[sz]e|expedite)\s+(.+)$/i, /^(?:do|build|start|finish|work\s+on)\s+(.+?)\s+(?:first|next|right\s+away|now)$/i, /^(.+?)\s+(?:is|are)\s+(?:urgent|(?:the\s+)?(?:top\s+)?priority|most\s+important)$/i]

/** A direct instruction about a task that Autopia can carry out itself, with no session involved. */
export function parseCommand<T extends SteerTask>(text: string, open: T[], people: Person[]): SteerCommand<T> | null {
  const t = text.trim().replace(/[.!]+$/, '').replace(POLITE, '')
  const one = (phrase: string, verb: string, then: (task: T) => SteerCommand<T>): SteerCommand<T> | null => {
    const found = findTask(phrase, open)
    if (found.length === 1) return then(found[0])
    return found.length > 1 ? { kind: 'clarify', verb, candidates: found } : null
  }
  const cancel = t.match(CANCEL)
  if (cancel) return one(cancel[1], 'cancel', (task) => ({ kind: 'cancel', task }))
  const assign = t.match(ASSIGN)
  const let_ = t.match(LET)
  if (assign || let_) {
    const [phrase, who] = assign ? [assign[1], assign[2]] : [let_![2], let_![1]]
    const employee = people.find((p) => firstName(p.name) === firstName(who))
    if (employee) return one(phrase, 'reassign', (task) => ({ kind: 'assign', task, employee }))
  }
  const order = t.match(ORDER)
  if (order) {
    const [a, b] = [findTask(order[1], open), findTask(order[3], open)]
    if (a.length === 1 && b.length === 1 && a[0] !== b[0]) return order[2].toLowerCase() === 'before' ? { kind: 'order', first: a[0], then: b[0] } : { kind: 'order', first: b[0], then: a[0] }
    if (a.length > 1 || b.length > 1) return { kind: 'clarify', verb: 'reorder', candidates: a.length > 1 ? a : b }
  }
  for (const re of PRIORITY) {
    const m = t.match(re)
    if (m) return one(m[1], 'prioritize', (task) => ({ kind: 'prioritize', task }))
  }
  return null
}

/** Whether making `task` wait for `on` would make the two wait for each other. */
export function wouldCycle(tasks: Pick<Task, 'id' | 'dependsOn'>[], task: string, on: string): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === task) return true
    if (seen.has(id)) return false
    seen.add(id)
    return (byId.get(id)?.dependsOn ?? []).some(walk)
  }
  return walk(on)
}

/** Where your message stands overall: nothing here reads further along than its furthest-behind target. */
export function routingStatus(r: NonNullable<Message['routing']>): Message['status'] {
  const live = r.targets.filter((t) => t.state !== 'released')
  if (!live.length) return 'sent'
  if (live.every((t) => t.state === 'applied')) return 'applied'
  return live.some((t) => t.state === 'delivered' || t.state === 'applied') ? 'delivered' : 'queued'
}

const names = (list: string[]) => {
  const unique = [...new Set(list)]
  return unique.length <= 2 ? unique.join(' and ') : `${unique[0]} and ${unique.length - 1} others`
}

/** The state you see under your message: who has it and what's really happened, from the records. */
export function routingLabel(status: Message['status'], r: Message['routing']): string | null {
  if (status === 'clarify') return 'needs your answer'
  if (!r?.targets.length) return null
  const who = (s: string) => names(r.targets.filter((t) => t.state === s).map((t) => t.name))
  if (status === 'applied') return `applied by ${who('applied')}`
  if (status === 'delivered') return `reached ${[who('delivered'), who('applied')].filter(Boolean).join(' and ')}${r.targets.some((t) => t.state === 'queued') ? `; queued for ${who('queued')}` : ''}`
  if (status === 'queued') return `queued for ${who('queued')}`
  return null
}
