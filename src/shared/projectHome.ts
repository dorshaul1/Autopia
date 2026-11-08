// Where a product stands and what happened while you were away, worked out from what's already recorded. Pure and
// token-free: it never summarises with AI, and nothing here appears unless the records show it.

import type { Approval, Delivery, Project, Task } from './types'

export type ProductMoment = 'fresh' | 'planning' | 'needs_you' | 'working' | 'blocked' | 'ready' | 'idle'

export interface ProductOverview {
  moment: ProductMoment
  needsYou: Pick<Approval, 'id' | 'kind' | 'title' | 'body'>[]
  active: Task[]
  planned: Task[]
  problems: Task[]
  latest: Delivery | null
  recent: Delivery[]
  /** Only after real time away, and only if something happened. */
  since: { away: string; finished: Task[]; results: Delivery[] } | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export function timeAway(ms: number): string {
  if (ms < DAY) {
    const h = Math.max(1, Math.round(ms / HOUR))
    return h === 1 ? 'an hour' : `${h} hours`
  }
  const d = Math.round(ms / DAY)
  if (d < 14) return d === 1 ? 'a day' : `${d} days`
  const w = Math.round(d / 7)
  return w < 9 ? `${w} weeks` : `${Math.round(d / 30)} months`
}

/** Being away this long is worth a summary, and worth opening on the Overview. */
export const RETURN_AFTER_MS = DAY

export function productOverview(x: { project: Pick<Project, 'phase' | 'paused'>; tasks: Task[]; deliveries: Delivery[]; approvals: Pick<Approval, 'id' | 'kind' | 'title' | 'body' | 'status'>[]; lastSeen: number | null; now: number }): ProductOverview {
  const real = x.tasks.filter((t) => t.status !== 'proposed')
  const active = real.filter((t) => t.status === 'running' || t.status === 'merging')
  const planned = real.filter((t) => t.status === 'pending')
  const problems = real.filter((t) => t.status === 'failed' || t.status === 'interrupted')
  const needsYou = x.approvals.filter((a) => a.status === 'pending')
  const recent = [...x.deliveries].filter((d) => d.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  const latest = recent[0] ?? null
  const ready = x.deliveries.some((d) => d.status === 'review')
  const moment: ProductMoment = needsYou.length ? 'needs_you' : x.project.phase === 'planning' ? 'planning' : active.length ? 'working' : problems.length || x.project.phase === 'failed' || x.project.phase === 'blocked' ? 'blocked' : ready ? 'ready' : !real.length && !x.deliveries.length ? 'fresh' : 'idle'
  let since: ProductOverview['since'] = null
  if (x.lastSeen && x.now - x.lastSeen >= HOUR) {
    const finished = real.filter((t) => t.status === 'done' && (t.finishedAt ?? 0) > x.lastSeen!)
    const results = recent.filter((d) => (d.completedAt ?? 0) > x.lastSeen!)
    if (finished.length || results.length || x.now - x.lastSeen >= RETURN_AFTER_MS) since = { away: timeAway(x.now - x.lastSeen), finished, results }
  }
  return { moment, needsYou, active, planned, problems, latest, recent: recent.slice(0, 4), since }
}

/** What the product is, in a sentence: the brief's own words if there is one, else what you first asked. */
export function purposeOf(vision: string | null | undefined, goal: string): string {
  const raw = (vision || goal).split(/\n\s*Attached \(read these files\)/)[0].replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const sentence = /^.{20,}?[.!?](?=\s|$)/.exec(raw)?.[0] ?? raw
  return sentence.length > 200 ? `${sentence.slice(0, 199).trimEnd()}…` : sentence
}

/** A game is played and an AI product is tried; everything else is opened. */
export function openLabel(office: string): string {
  return office === 'studio' ? 'Play it' : office === 'lab' ? 'Try it' : 'Open it'
}

export interface HubItem {
  id: string
  name: string
  purpose: string
  needsYou: number
  working: number
  toReview: number
  blocked: boolean
  /** Last time anything happened. */
  at: number
}

export type HubGroup = 'attention' | 'active' | 'ready' | 'recent' | 'older'
export const HUB_LABEL: Record<HubGroup, string> = { attention: 'Needs you', active: 'In progress', ready: 'Ready to review', recent: 'Recent', older: 'Not touched lately' }
export const OLDER_AFTER_MS = 14 * DAY

/** What each product is doing decides where it sits: the important ones can't get lost in a long list. */
export function hubGroups<T extends HubItem>(items: T[], now: number, query = ''): { group: HubGroup; items: T[] }[] {
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => `${i.name} ${i.purpose}`.toLowerCase().includes(q)) : items
  const by = new Map<HubGroup, T[]>()
  for (const i of shown) {
    const g: HubGroup = i.needsYou || i.blocked ? 'attention' : i.working ? 'active' : i.toReview ? 'ready' : now - i.at > OLDER_AFTER_MS ? 'older' : 'recent'
    by.set(g, [...(by.get(g) ?? []), i])
  }
  return (Object.keys(HUB_LABEL) as HubGroup[]).filter((g) => by.has(g)).map((g) => ({ group: g, items: by.get(g)!.sort((a, b) => b.at - a.at) }))
}
