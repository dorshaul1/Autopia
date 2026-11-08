// Milestone state derived from the real task graph and recorded gates (shared by scheduler and UI).

import type { ProductMilestone, ProductSpec, Task } from './types'

/** Milestone status from the real task graph plus the recorded gate (never from estimates). */
export function milestoneStatus(m: ProductMilestone, tasks: Task[]): ProductMilestone['status'] {
  const own = tasks.filter((t) => t.milestone === m.n && t.status !== 'proposed')
  if (!own.length) return m.gate?.verdict === 'passed' ? 'done' : 'pending'
  if (own.some((t) => t.status === 'failed' || t.status === 'interrupted')) return 'failed'
  const finished = own.every((t) => t.status === 'done' || t.status === 'cancelled')
  if (!finished) return own.some((t) => t.status !== 'pending') ? 'active' : 'pending'
  if (!m.gate) return 'verifying'
  return m.gate.verdict === 'failed' && !m.gate.repairTaskKey ? 'failed' : m.gate.verdict === 'failed' ? 'active' : 'done'
}

/** The first milestone that is not finished and verified; later milestones wait for it. */
export function currentMilestone(spec: ProductSpec, tasks: Task[]): number | null {
  for (const m of spec.milestones) {
    const own = tasks.filter((t) => t.milestone === m.n && t.status !== 'proposed')
    if (!own.length) continue
    const finished = own.every((t) => t.status === 'done' || t.status === 'cancelled')
    if (!finished || !m.gate) return m.n
    if (m.gate.verdict === 'failed' && m.gate.repairTaskKey) {
      const repair = tasks.find((t) => t.key === m.gate!.repairTaskKey)
      // wait for the repair; a finished repair is re-verified before the next milestone starts.
      // A skipped repair releases the milestone (its failure stays recorded).
      if (!repair || (repair.status !== 'done' && repair.status !== 'cancelled')) return m.n
      if (repair.status === 'done' && (repair.finishedAt ?? 0) > m.gate.at) return m.n
    }
  }
  return null
}

