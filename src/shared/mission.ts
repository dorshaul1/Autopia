// The reading of the work on the Overview: who is doing what, what comes next, and what only you can unblock. Pure and
// token-free. It reads the same records the scheduler acts on and decides nothing: no estimates, no percentages.

import { waitingReason } from './graph'
import { affectedTasks, type SteerTask } from './steering'
import type { Approval, Delivery, Task } from './types'

export type WorkState = 'needsYou' | 'now' | 'blocked' | 'ready' | 'waiting' | 'planned' | 'done' | 'dropped'

export interface WorkItem {
  task: Task
  state: WorkState
  /** The real reason it stands where it stands. Null when there is nothing to add. */
  reason: string | null
  /** Unfinished work it's waiting for. */
  after: Task[]
  /** Unfinished work waiting for it. */
  holding: Task[]
}

export interface Mission {
  needsYou: WorkItem[]
  now: WorkItem[]
  next: WorkItem[]
  planned: WorkItem[]
  done: WorkItem[]
  dropped: WorkItem[]
}

const OPEN = new Set(['proposed', 'pending', 'running', 'merging', 'failed', 'interrupted'])

export function missionOf(x: { tasks: Task[]; approvals: Pick<Approval, 'taskId' | 'status' | 'kind' | 'title'>[]; paused?: boolean; busyName: (id: string) => string | null; nameOf: (id: string) => string | null }): Mission {
  const byId = new Map(x.tasks.map((t) => [t.id, t]))
  const asking = new Map(x.approvals.filter((a) => a.status === 'pending' && a.taskId).map((a) => [a.taskId!, a]))
  const item = (task: Task): WorkItem => {
    const after = task.dependsOn.map((d) => byId.get(d)).filter((d): d is Task => !!d && OPEN.has(d.status))
    const holding = x.tasks.filter((t) => t.dependsOn.includes(task.id) && OPEN.has(t.status))
    const asked = asking.get(task.id)
    if (asked) return { task, after, holding, state: 'needsYou', reason: asked.title }
    switch (task.status) {
      case 'failed':
        return { task, after, holding, state: 'needsYou', reason: firstLine(task.lastError) ?? 'It stopped before finishing.' }
      case 'interrupted':
        return { task, after, holding, state: 'needsYou', reason: firstLine(task.lastError) ?? 'It was interrupted before finishing.' }
      case 'running':
        return { task, after, holding, state: 'now', reason: null }
      case 'merging':
        return { task, after, holding, state: 'now', reason: 'Bringing it into the project' }
      case 'proposed':
        return { task, after, holding, state: 'planned', reason: null }
      case 'done':
        return { task, after, holding, state: 'done', reason: null }
      case 'cancelled':
        return { task, after, holding, state: 'dropped', reason: firstLine(task.lastError) }
      default: {
        const why = waitingReason(task, x.tasks, x.busyName, x.nameOf)
        if (why?.startsWith('Blocked')) return { task, after, holding, state: 'blocked', reason: why }
        if (x.paused) return { task, after, holding, state: 'waiting', reason: 'Paused: new work won’t start until you resume' }
        const free = why === 'Ready — waiting for a free slot'
        return { task, after, holding, state: free ? 'ready' : 'waiting', reason: free ? 'Can start as soon as there’s room' : why }
      }
    }
  }
  const items = x.tasks.map(item)
  const pick = (...states: WorkState[]) => items.filter((i) => states.includes(i.state))
  const rank: Partial<Record<WorkState, number>> = { blocked: 0, ready: 1, waiting: 2 }
  return {
    needsYou: pick('needsYou'),
    now: pick('now'),
    next: pick('blocked', 'ready', 'waiting').sort((a, b) => rank[a.state]! - rank[b.state]! || b.task.priority - a.task.priority || a.task.sortOrder - b.task.sortOrder),
    planned: pick('planned'),
    done: pick('done').sort((a, b) => (b.task.finishedAt ?? 0) - (a.task.finishedAt ?? 0)),
    dropped: pick('dropped')
  }
}

const firstLine = (s: string | null | undefined) => s?.split('\n').find((l) => l.trim())?.trim().slice(0, 240) ?? null

const list = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`

/** One sentence: what's happening now. Nothing is said that the records don't show. */
export function missionHeadline(m: Mission, nameOf: (id: string) => string | null, x: { paused?: boolean; toReview?: number } = {}): string {
  const people = [...new Set(m.now.map((i) => nameOf(i.task.assigneeId) ?? 'A teammate'))]
  const parts: string[] = []
  if (people.length) parts.push(m.now.length > 1 && people.length > 1 ? `${list(people)} are working side by side` : `${list(people)} ${people.length === 1 ? 'is' : 'are'} working on ${steps(m.now.length)}`)
  if (m.needsYou.length) parts.push(`${steps(m.needsYou.length)} ${m.needsYou.length === 1 ? 'needs' : 'need'} you`)
  const blocked = m.next.filter((i) => i.state === 'blocked').length
  if (blocked) parts.push(`${blocked} ${blocked === 1 ? 'is' : 'are'} blocked`)
  const coming = m.next.length - blocked
  if (coming) parts.push(`${coming} up next`)
  if (x.toReview) parts.push(`${x.toReview === 1 ? 'a result is' : `${x.toReview} results are`} ready to review`)
  if (m.planned.length && !parts.length) parts.push(`A plan of ${steps(m.planned.length)} is waiting for your OK`)
  if (x.paused) parts.unshift('Paused: nothing new will start')
  if (!parts.length) return m.done.length ? `Nothing in progress. ${steps(m.done.length).replace(/^./, (c) => c.toUpperCase())} finished so far.` : 'Nothing in progress yet.'
  const text = parts.join(', ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

/** Which actions really work on a task in this state, as the backend enforces them. */
export function taskActions(t: Pick<Task, 'status'>): { priority: boolean; reassign: boolean; retry: boolean; stop: boolean; instruct: boolean; correct: boolean } {
  const s = t.status
  return {
    priority: s === 'pending' || s === 'proposed' || s === 'failed' || s === 'interrupted',
    reassign: s === 'pending' || s === 'proposed' || s === 'failed' || s === 'interrupted',
    retry: s === 'failed' || s === 'interrupted',
    stop: s === 'running' || s === 'pending' || s === 'failed' || s === 'interrupted',
    instruct: s === 'running' || s === 'pending' || s === 'failed' || s === 'interrupted' || s === 'proposed',
    correct: s === 'done'
  }
}

/** Who a teammate really worked with: the steps theirs built on, and the steps built on theirs. */
export function collaboratorsOf(id: string, tasks: Pick<Task, 'id' | 'assigneeId' | 'dependsOn' | 'status'>[]): { employeeId: string; handedTo: number; receivedFrom: number }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = new Map<string, { employeeId: string; handedTo: number; receivedFrom: number }>()
  const at = (employeeId: string) => out.get(employeeId) ?? out.set(employeeId, { employeeId, handedTo: 0, receivedFrom: 0 }).get(employeeId)!
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      const dep = byId.get(d)
      if (!dep || dep.assigneeId === t.assigneeId) continue
      if (dep.assigneeId === id && t.assigneeId !== id) at(t.assigneeId).handedTo++
      if (t.assigneeId === id && dep.assigneeId !== id) at(dep.assigneeId).receivedFrom++
    }
  }
  return [...out.values()].sort((a, b) => b.handedTo + b.receivedFrom - (a.handedTo + a.receivedFrom))
}

/** For a finished request: how its acceptance reports and checks really came out. Reports stay labelled as reports. */
export function deliveryFacts(d: Pick<Delivery, 'id' | 'limitations'>, tasks: Pick<Task, 'deliveryId' | 'status' | 'checks' | 'criteria' | 'changedFiles'>[]) {
  const own = tasks.filter((t) => t.deliveryId === d.id && t.status !== 'proposed')
  const checks = own.flatMap((t) => t.checks)
  const criteria = own.flatMap((t) => t.criteria ?? [])
  return {
    steps: own.length,
    finished: own.filter((t) => t.status === 'done').length,
    checksPassed: checks.filter((c) => c.ok).length,
    checksTotal: checks.length,
    criteriaMet: criteria.filter((c) => c.met).length,
    criteriaTotal: criteria.length,
    files: new Set(own.flatMap((t) => t.changedFiles)).size,
    limitations: d.limitations.length
  }
}

/** What a new instruction would land on, said before you send it. Nothing running is interrupted or reordered by this. */
export function overlapLine<T extends SteerTask & Pick<Task, 'status'>>(text: string, tasks: T[], people: { id: string; name: string }[]): string | null {
  if (text.trim().length < 8) return null
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'merging')
  if (!running.length) return null
  const hit = affectedTasks(text, running, people as never)
  if (hit.scope === 'everyone' || !hit.tasks.length) return null
  const title = hit.tasks[0].title
  const shown = title.length > 40 ? `${title.slice(0, 39)}…` : title
  return `Overlaps with “${shown}”${hit.tasks.length > 1 ? ` and ${hit.tasks.length - 1} more` : ''} in progress. It reaches them at a safe moment; nothing is interrupted.`
}
