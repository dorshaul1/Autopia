// Meaningful office moments, derived only from real state changes the app already receives (task and
// result updates). Pure and deterministic: no AI, no invented events. The scene decides how to stage
// an admitted moment; real work always takes priority.

import type { Delivery, Task } from '@shared/types'
import type { Spot } from './layout'

export type MomentKind = 'verified' | 'finished' | 'setback' | 'handoff' | 'accepted'

export interface Moment {
  kind: MomentKind
  /** Who reacts (for a handoff: the teammate who finished and walks over). */
  employeeId: string
  /** For a handoff: the teammate who picked the work up. */
  partnerId?: string
  /** Stable identity, so the same real event never plays twice. */
  key: string
}

type T = Pick<Task, 'id' | 'status' | 'assigneeId' | 'checks' | 'dependsOn' | 'finishedAt' | 'deliveryId'>
export interface MomentState {
  tasks: Record<string, T>
  deliveries: Pick<Delivery, 'id' | 'status'>[]
}

/** A finished task only hands off to work that started soon after it (a later retry is not a handoff). */
export const HANDOFF_WINDOW_MS = 3 * 60_000

const failedCount = (t: T) => t.checks.filter((c) => c.status === 'failed').length

/**
 * What changed between two snapshots, as moments:
 * - verified: a task reached done with checks that all passed;
 * - finished: a task reached done with no checks: a quiet moment of relief, never a claim that it was verified;
 * - setback: a running task recorded a new failed check;
 * - handoff: a task started because a teammate's just-finished task unblocked it;
 * - accepted: you accepted a result (its finished contributors react).
 * Tasks new to the snapshot never produce moments (loading a project is not an event).
 */
export function detectMoments(prev: MomentState, next: MomentState, now: number): Moment[] {
  const out: Moment[] = []
  for (const t of Object.values(next.tasks)) {
    const p = prev.tasks[t.id]
    if (!p) continue
    if (p.status !== 'done' && t.status === 'done' && t.checks.length && t.checks.every((c) => c.status === 'passed')) {
      out.push({ kind: 'verified', employeeId: t.assigneeId, key: `verified:${t.id}` })
    } else if (p.status !== 'done' && t.status === 'done' && !t.checks.length) {
      out.push({ kind: 'finished', employeeId: t.assigneeId, key: `finished:${t.id}` })
    }
    if (p.status === 'running' && t.status === 'running' && failedCount(t) > failedCount(p)) {
      out.push({ kind: 'setback', employeeId: t.assigneeId, key: `setback:${t.id}:${failedCount(t)}` })
    }
    if (p.status !== 'running' && t.status === 'running') {
      const from = t.dependsOn
        .map((d) => next.tasks[d])
        .filter((d): d is T => !!d && d.status === 'done' && d.assigneeId !== t.assigneeId && now - (d.finishedAt ?? 0) < HANDOFF_WINDOW_MS)
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]
      if (from) out.push({ kind: 'handoff', employeeId: from.assigneeId, partnerId: t.assigneeId, key: `handoff:${from.id}:${t.id}` })
    }
  }
  for (const d of next.deliveries) {
    const p = prev.deliveries.find((x) => x.id === d.id)
    if (p?.status !== 'review' || d.status !== 'accepted') continue
    const who = new Set(Object.values(next.tasks).filter((t) => t.deliveryId === d.id && t.status === 'done').map((t) => t.assigneeId))
    for (const id of who) out.push({ kind: 'accepted', employeeId: id, key: `accepted:${d.id}:${id}` })
  }
  return out
}

const PRIORITY: Record<MomentKind, number> = { setback: 3, verified: 2, accepted: 2, finished: 1, handoff: 1 }
/** Minimum gap per person and kind, so frequent events (repeated failures) don't repeat on screen. */
const COOLDOWN_MS: Record<MomentKind, number> = { setback: 15_000, verified: 0, finished: 0, accepted: 0, handoff: 120_000 }

/**
 * Admits moments in priority order: each real event once, each person in at most one moment per batch,
 * cooldowns per person and kind, and only when the scene says it can stage it now (`canPlay`).
 */
export class MomentQueue {
  private seen = new Set<string>()
  private last = new Map<string, number>()

  admit(moments: Moment[], now: number, canPlay: (m: Moment) => boolean): Moment[] {
    const out: Moment[] = []
    const busy = new Set<string>()
    for (const m of [...moments].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind])) {
      if (this.seen.has(m.key)) continue
      this.seen.add(m.key)
      if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250))
      const people = [m.employeeId, m.partnerId].filter((x): x is string => !!x)
      if (people.some((p) => busy.has(p))) continue
      const cooled = people.every((p) => now - (this.last.get(`${p}:${m.kind}`) ?? -Infinity) >= COOLDOWN_MS[m.kind])
      if (!cooled || !canPlay(m)) continue
      for (const p of people) {
        busy.add(p)
        this.last.set(`${p}:${m.kind}`, now)
      }
      out.push(m)
    }
    return out
  }
}

/** Where a visitor stands beside a seated teammate: right, left, then behind, whichever is walkable and free. */
export function visitSpot(seat: Spot, walkable: (x: number, y: number) => boolean): Spot | null {
  const options: Spot[] = [
    { tx: seat.tx + 1, ty: seat.ty, facing: 'left', pose: 'stand' },
    { tx: seat.tx - 1, ty: seat.ty, facing: 'right', pose: 'stand' },
    { tx: seat.tx, ty: seat.ty + 1, facing: 'up', pose: 'stand' }
  ]
  return options.find((o) => walkable(o.tx, o.ty)) ?? null
}
