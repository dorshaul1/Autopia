// The task briefing: what the team is about to build, in what order, by whom, and what could go
// wrong. Built only from what already exists (the plan's tasks, the routing signals, the product spec
// and the live task states), so it costs no AI calls and always matches real execution.

import { filesOverlap, levels, touchedFiles } from './graph'
import { ARCH_SIGNALS, SECURITY_SIGNALS } from './signals'
import type { ProductSpec, Task } from './types'

export type StepState = 'planned' | 'waiting' | 'active' | 'done' | 'stuck' | 'skipped'

/** A task's place in the briefing, from its real status only. */
export function stepState(t: Pick<Task, 'status'>): StepState {
  switch (t.status) {
    case 'proposed':
      return 'planned'
    case 'pending':
      return 'waiting'
    case 'running':
    case 'merging':
      return 'active'
    case 'done':
      return 'done'
    case 'failed':
    case 'interrupted':
      return 'stuck'
    default:
      return 'skipped'
  }
}

/**
 * Simple work runs straight away with no briefing: one task, chosen without a planning meeting.
 * A briefing appears for planned work, or whenever a request became several tasks.
 */
export function needsBriefing(strategy: string | null | undefined, taskCount: number): boolean {
  return strategy === 'plan' || taskCount > 1
}

export interface Stage {
  /** 1-based; tasks in one stage can run side by side (they wait on nothing in this stage). */
  n: number
  tasks: Task[]
}

/** The order of work: stages from the dependency graph (stage 1 starts first; later ones build on it). */
export function stagesOf(tasks: Task[]): Stage[] {
  const depth = levels(tasks)
  const out: Stage[] = []
  for (const t of [...tasks].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.sortOrder - b.sortOrder)) {
    const n = (depth.get(t.id) ?? 0) + 1
    const stage = out.find((s) => s.n === n) ?? (out.push({ n, tasks: [] }), out[out.length - 1])
    stage.tasks.push(t)
  }
  return out
}

/**
 * The few risks worth knowing before work starts (at most four), each from a concrete signal: work
 * touching security or the data model, large tasks, steps that must wait for each other because they
 * share files, and the product's own stated risks. Finished work no longer counts as a risk.
 */
export function briefingRisks(tasks: Task[], spec: Pick<ProductSpec, 'risks'> | null, nameOf: (employeeId: string) => string | null): string[] {
  const open = tasks.filter((t) => !['done', 'cancelled'].includes(t.status))
  const who = (t: Task) => nameOf(t.assigneeId) ?? 'A teammate'
  const out: string[] = []
  for (const t of open) {
    const text = `${t.title}\n${t.description}`
    if (SECURITY_SIGNALS.test(text)) out.push(`${who(t)}'s “${t.title}” touches security-sensitive code, so it gets the stricter checks.`)
    else if (ARCH_SIGNALS.test(text)) out.push(`${who(t)}'s “${t.title}” changes structure or data, which later steps build on.`)
    else if (t.size === 'l') out.push(`${who(t)}'s “${t.title}” is a large step; it drives how long the whole request takes.`)
  }
  // parallel steps that share files run one after another instead (safer, but slower)
  const depth = levels(open)
  for (let i = 0; i < open.length && out.length < 6; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]
      const b = open[j]
      if (depth.get(a.id) === depth.get(b.id) && a.assigneeId !== b.assigneeId && filesOverlap(touchedFiles(a), touchedFiles(b))) {
        out.push(`${who(a)} and ${who(b)} change the same files, so those steps run one after the other.`)
        break
      }
    }
  }
  for (const r of spec?.risks ?? []) out.push(r)
  return [...new Set(out)].slice(0, 4)
}

export interface BriefingCounts {
  planned: number
  waiting: number
  active: number
  done: number
  stuck: number
  total: number
}

export function countSteps(tasks: Pick<Task, 'status'>[]): BriefingCounts {
  const c: BriefingCounts = { planned: 0, waiting: 0, active: 0, done: 0, stuck: 0, total: 0 }
  for (const t of tasks) {
    const s = stepState(t)
    if (s === 'skipped') continue
    c[s]++
    c.total++
  }
  return c
}

/** One plain line for where the work stands (never more done than the records show). */
export function standLine(c: BriefingCounts): string {
  if (!c.total) return 'Nothing planned yet.'
  if (c.planned === c.total) return `${c.total} step${c.total === 1 ? '' : 's'} planned, waiting for your OK.`
  if (c.done === c.total) return c.total === 1 ? 'Done.' : `All ${c.total} steps done.`
  const parts = [c.done && `${c.done} done`, c.active && `${c.active} in progress`, c.stuck && `${c.stuck} need${c.stuck === 1 ? 's' : ''} you`, c.waiting + c.planned && `${c.waiting + c.planned} to go`].filter(Boolean)
  return `${parts.join(' · ')}${c.total > 1 ? ` · ${c.total} steps in all` : ''}.`
}
