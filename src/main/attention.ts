// The attention system: which events deserve you, how repeats collapse into one item, when an item is
// resolved because its cause is gone, which teammate shows an indicator, and when a desktop alert is
// worth sending. Deterministic and local (no AI); every item points at a real approval, task, result or
// usage hold, so nothing is claimed that the records don't show. Pure functions; the orchestrator acts.

import type { Approval, AttentionCategory, Delivery, EmployeeAttention, Notification, NotificationKind, Settings, Task } from '@shared/types'

/** What an event is about, for grouping, priority and the indicator it drives. */
export function categorize(kind: NotificationKind, title: string, ctx: { approvalKind?: Approval['kind'] | null; deliveryId?: string | null; usage?: boolean }): AttentionCategory {
  if (ctx.usage) return 'usage'
  if (ctx.approvalKind === 'permission' || ctx.approvalKind === 'plan' || ctx.approvalKind === 'unverified') return 'approval'
  if (ctx.approvalKind === 'question') return 'question'
  if (ctx.approvalKind === 'task_failed') return /was interrupted/i.test(title) ? 'interrupted' : 'blocked'
  if (ctx.deliveryId && kind === 'decision') return 'review'
  if (kind === 'failure' || kind === 'security') return 'failure'
  if (kind === 'delivered' || kind === 'milestone') return 'outcome'
  return 'info'
}

/** Higher first: what blocks work, then what waits for you, then results, then news. */
export const PRIORITY: Record<AttentionCategory, number> = {
  approval: 90,
  question: 85,
  blocked: 80,
  failure: 75,
  usage: 70,
  interrupted: 60,
  review: 50,
  outcome: 20,
  info: 10
}

/** Categories that stay open until their cause is resolved; the rest are news (resolved on arrival). */
export const ACTIONABLE = new Set<AttentionCategory>(['approval', 'question', 'blocked', 'failure', 'usage', 'interrupted', 'review'])

/** One identity per underlying condition, so repeats update one item instead of piling up. */
export function dedupeKey(n: { projectId: string | null; taskId: string | null; title: string; approvalId?: string | null; deliveryId?: string | null; category: AttentionCategory }): string {
  if (n.category === 'usage') return 'usage:hold'
  if (n.approvalId) return `approval:${n.approvalId}`
  if (n.deliveryId) return `delivery:${n.deliveryId}:${n.category}`
  if (n.taskId) return `task:${n.taskId}:${n.category}`
  return `project:${n.projectId ?? '-'}:${n.category}:${n.title.replace(/\d+/g, '#').slice(0, 80)}`
}

export interface Facts {
  pendingApprovals: Set<string>
  deliveries: Map<string, Pick<Delivery, 'status'>>
  tasks: Map<string, Pick<Task, 'status'>>
  usageHeld: boolean
}

/** Whether an open item's cause is gone (the approval was decided, the result reviewed, the task moved on). */
export function isResolved(n: Pick<Notification, 'category' | 'approvalId' | 'deliveryId' | 'taskId'>, f: Facts): boolean {
  if (!ACTIONABLE.has(n.category)) return true
  if (n.category === 'usage') return !f.usageHeld
  if (n.approvalId) return !f.pendingApprovals.has(n.approvalId)
  if (n.deliveryId) return f.deliveries.get(n.deliveryId)?.status !== 'review'
  if (n.taskId) {
    const s = f.tasks.get(n.taskId)?.status
    return !s || !['failed', 'interrupted'].includes(s)
  }
  return false
}

export type DesktopPref = Settings['desktopNotifications']

/**
 * A native alert only when Autopia is in the background, for something that needs you (or anything,
 * if you chose "all"), never in quiet mode, and never again for a repeat of an unchanged condition.
 */
export function shouldAlert(n: { category: AttentionCategory; repeat: boolean }, prefs: { desktop: DesktopPref; quiet: boolean }, focused: boolean): boolean {
  if (focused || prefs.quiet || prefs.desktop === 'off' || n.repeat) return false
  if (prefs.desktop === 'all') return n.category !== 'info'
  return ACTIONABLE.has(n.category) && n.category !== 'interrupted'
}

/**
 * The one indicator above each teammate: the most pressing thing about their own work that waits for
 * you. Plans belong to the PM. Results waiting for your review show on the teammates whose finished
 * tasks are in them. Real records only.
 */
export function employeeAttention(input: {
  approvals: Pick<Approval, 'id' | 'kind' | 'projectId' | 'taskId' | 'title'>[]
  tasks: Pick<Task, 'id' | 'assigneeId' | 'status' | 'deliveryId' | 'projectId'>[]
  deliveries: Pick<Delivery, 'id' | 'status' | 'projectId' | 'number'>[]
  /** Each project's planner (offices have their own teams). */
  pmOf: (projectId: string) => string | null
}): EmployeeAttention[] {
  const byTask = new Map(input.tasks.map((t) => [t.id, t]))
  const best = new Map<string, EmployeeAttention>()
  const offer = (a: EmployeeAttention) => {
    const cur = best.get(a.employeeId)
    if (!cur || PRIORITY[a.kind] > PRIORITY[cur.kind]) best.set(a.employeeId, a)
  }
  for (const a of input.approvals) {
    const task = a.taskId ? byTask.get(a.taskId) : null
    const employeeId = task?.assigneeId ?? (a.kind === 'plan' ? input.pmOf(a.projectId) : null)
    if (!employeeId) continue
    const kind: AttentionCategory = a.kind === 'question' ? 'question' : a.kind === 'task_failed' ? (task?.status === 'interrupted' ? 'interrupted' : 'blocked') : 'approval'
    const label =
      kind === 'question'
        ? 'Has a question for you'
        : kind === 'blocked'
          ? 'Blocked: needs you'
          : kind === 'interrupted'
            ? 'Interrupted: ready to continue'
            : a.kind === 'plan'
              ? 'Plan ready for your approval'
              : a.kind === 'permission'
                ? 'Waiting for your permission'
                : 'Waiting for your decision'
    offer({ employeeId, kind, projectId: a.projectId, taskId: a.taskId, approvalId: a.id, deliveryId: null, label })
  }
  for (const d of input.deliveries.filter((x) => x.status === 'review')) {
    for (const t of input.tasks.filter((x) => x.deliveryId === d.id && x.status === 'done')) {
      offer({ employeeId: t.assigneeId, kind: 'review', projectId: d.projectId, taskId: t.id, approvalId: null, deliveryId: d.id, label: `Finished: result #${d.number} is ready for your review` })
    }
  }
  return [...best.values()]
}
