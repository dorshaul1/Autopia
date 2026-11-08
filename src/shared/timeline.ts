// How a product evolved, told from the delivery records it already has. Pure and token-free: a delivery is what one
// request produced, never a tool call or a commit, and nothing here says anything the records don't.

import type { Capture } from './studio'
import type { CheckResult, Delivery, ProductMilestone } from './types'

const BOILERPLATE = /^Visual feedback from the running app\b/i

/** The request in a line: your words, without the wrapper Autopia adds for the teammate. */
export function deliveryTitle(d: Pick<Delivery, 'request'>): string {
  const lines = d.request.split('\n').map((l) => l.trim()).filter(Boolean)
  const line = (lines.find((l) => !BOILERPLATE.test(l)) ?? lines[0] ?? 'A request').replace(/\s*\b(requirements|details|notes):\s*$/i, '')
  const sentence = line.length > 110 ? (/^.{30,}?[.!?](?=\s|$)/.exec(line)?.[0] ?? line) : line
  return sentence.length > 110 ? `${sentence.slice(0, 109).trimEnd()}…` : sentence
}

const FIX = /\b(fix\w*|bug\w*|broken|crash\w*|error\w*|wrong|doesn.?t work|not working|repair\w*)\b/i

/** What sort of thing it was, from what was asked. */
export function deliveryWord(d: Pick<Delivery, 'kind' | 'request' | 'number'>): 'First build' | 'New work' | 'Fix' | 'Change' {
  if (d.kind === 'brief') return d.number === 1 ? 'First build' : 'New work'
  return FIX.test(d.request) ? 'Fix' : 'Change'
}

export type ReviewState = 'working' | 'awaiting' | 'reviewed' | 'changes' | 'discarded'

/** Where it stands with you. Whether it works is a separate question, answered by the evidence. */
export function reviewStateOf(d: Pick<Delivery, 'status'>): ReviewState {
  switch (d.status) {
    case 'implementing':
    case 'validating':
      return 'working'
    case 'review':
      return 'awaiting'
    case 'accepted':
      return 'reviewed'
    case 'revising':
      return 'changes'
    default:
      return 'discarded'
  }
}

export const REVIEW_WORD: Record<ReviewState, string> = { working: 'In progress', awaiting: 'Awaiting your review', reviewed: 'Reviewed', changes: 'Changes requested', discarded: 'Discarded' }

export type TimelineEntry =
  | { type: 'delivery'; id: string; delivery: Delivery; title: string; word: ReturnType<typeof deliveryWord>; state: ReviewState; revises: number | null; followUps: number[]; marked: boolean; at: number }
  | { type: 'milestone'; id: string; n: number; title: string; at: number }

export interface TimelineGroup {
  label: string
  entries: TimelineEntry[]
}

const DAY = 86_400_000

function periodOf(at: number, now: number): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (at >= today) return 'Today'
  if (at >= today - DAY) return 'Yesterday'
  if (at >= today - 6 * DAY) return 'This week'
  return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Newest first. Work under way sits at the top; verified milestones sit where they happened. */
export function timelineOf(x: { deliveries: Delivery[]; milestones?: Pick<ProductMilestone, 'n' | 'title' | 'status' | 'gate'>[]; marks?: string[]; now: number }): TimelineGroup[] {
  const entries: TimelineEntry[] = x.deliveries.map((d) => ({
    type: 'delivery',
    id: d.id,
    delivery: d,
    title: deliveryTitle(d),
    word: deliveryWord(d),
    state: reviewStateOf(d),
    revises: x.deliveries.find((p) => p.id === d.parentId)?.number ?? null,
    followUps: x.deliveries.filter((c) => c.parentId === d.id).map((c) => c.number).sort((a, b) => a - b),
    marked: !!x.marks?.includes(d.id),
    at: d.completedAt ?? d.createdAt
  }))
  for (const m of x.milestones ?? []) if (m.status === 'done' && m.gate?.at) entries.push({ type: 'milestone', id: `m${m.n}`, n: m.n, title: m.title, at: m.gate.at })
  const groups = new Map<string, TimelineEntry[]>()
  const working = entries.filter((e) => e.type === 'delivery' && e.state === 'working')
  if (working.length) groups.set('In progress', working)
  for (const e of entries.filter((i) => !working.includes(i)).sort((a, b) => b.at - a.at)) {
    const label = periodOf(e.at, x.now)
    groups.set(label, [...(groups.get(label) ?? []), e])
  }
  return [...groups].map(([label, list]) => ({ label, entries: list }))
}

export interface DeliveryPictures {
  /** The best real picture of this result, if one was ever taken. */
  own: Capture | null
  /** Two real pictures worth comparing, earlier first, and what they are. Null when there aren't two. */
  pair: [Capture, Capture] | null
  source: string | null
}

const PREFER: Capture['source'][] = ['after', 'you', 'check', 'before']
const best = (list: Capture[]) => [...list].sort((a, b) => PREFER.indexOf(a.source) - PREFER.indexOf(b.source) || b.at - a.at || b.width - a.width)[0] ?? null

/** Only pictures on record: around a change first, then this result against the one before it. Never a claim about which is better. */
export function picturesOf(d: Pick<Delivery, 'id' | 'parentId' | 'number'>, captures: Capture[], deliveries: Pick<Delivery, 'id' | 'number'>[]): DeliveryPictures {
  const mine = captures.filter((c) => c.deliveryId === d.id)
  const own = best(mine)
  const before = mine.find((c) => c.source === 'before')
  const after = mine.find((c) => c.source === 'after' && (!before || c.taskId === before.taskId))
  if (before && after) return { own, pair: [before, after], source: 'Before and after your change' }
  if (!own) return { own, pair: null, source: null }
  // the result this revises, or else the most recent earlier one with a picture at the same width
  const earlier = [...deliveries].filter((x) => x.number < d.number).sort((a, b) => (a.id === d.parentId ? -1 : b.id === d.parentId ? 1 : b.number - a.number))
  for (const prev of earlier) {
    const theirs = captures.filter((c) => c.deliveryId === prev.id)
    const match = theirs.find((c) => c.width === own.width) ?? null
    if (match) return { own, pair: [match, own], source: `Result #${prev.number} and this one` }
  }
  return { own, pair: null, source: null }
}

export interface CheckChange {
  command: string
  was: CheckResult['status'] | null
  now: CheckResult['status']
}

/** Checks that really came out differently between two results. A check only one of them ran says so. */
export function checkChanges(earlier: Pick<CheckResult, 'command' | 'status'>[], later: Pick<CheckResult, 'command' | 'status'>[]): CheckChange[] {
  const before = new Map(earlier.map((c) => [c.command, c.status]))
  return later.filter((c) => before.get(c.command) !== c.status).map((c) => ({ command: c.command, was: before.get(c.command) ?? null, now: c.status }))
}

/** The summary as the team left it, without its internal step labels. */
export function summaryLines(summary: string | null, verified = false): string[] {
  // once it has been run for real, "I couldn't run it" is out of date: the evidence says what happened
  const outdated = /\b(declined|have(n.t| not) (run|seen)|unconfirmed|not (been )?run|unconfirmed|not verified|no .{0,20}result|nothing has been run)\b/i
  return (summary ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(/^T\d+(\.\d+)?\s+/, '').replace(/^[^:]{0,90}:\s*/, ''))
    .map((l) => (verified ? l.replace(/,? but [^.]*\.?$/i, (m) => (outdated.test(m) ? '.' : m)).split(/(?<=[.!?])\s+/).filter((x) => !outdated.test(x)).join(' ').replace(/\s*\.$/, '.') : l))
    .filter((l) => l.trim())
}
