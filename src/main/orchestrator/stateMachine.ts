import type { ProjectPhase, Task, TaskStatus } from '@shared/types'

/** Allowed project phase transitions. Anything else is a bug and throws. */
const PROJECT: Record<ProjectPhase, ProjectPhase[]> = {
  new: ['planning', 'executing'], // executing = direct single-agent strategy
  planning: ['awaiting_plan_approval', 'new', 'failed'],
  awaiting_plan_approval: ['executing', 'planning'],
  executing: ['blocked', 'completed', 'executing'],
  blocked: ['executing', 'failed', 'completed'],
  completed: ['planning', 'executing'],
  failed: ['planning', 'executing']
}

const TASK: Record<TaskStatus, TaskStatus[]> = {
  proposed: ['pending'],
  pending: ['running', 'cancelled'],
  running: ['merging', 'done', 'failed', 'interrupted', 'pending', 'cancelled'], // pending = QA re-queued behind a fix task
  merging: ['done', 'failed', 'interrupted'],
  done: [],
  failed: ['running', 'cancelled'],
  interrupted: ['running', 'cancelled'],
  cancelled: []
}

export function assertProjectTransition(from: ProjectPhase, to: ProjectPhase): void {
  if (!PROJECT[from].includes(to)) throw new Error(`Illegal project transition ${from} → ${to}`)
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK[from].includes(to)) throw new Error(`Illegal task transition ${from} → ${to}`)
}

export const canPlan = (phase: ProjectPhase): boolean => PROJECT[phase].includes('planning')

/** Dependencies are satisfied by completed or explicitly skipped (cancelled) tasks. */
// the parallel-safety rule is shared with the waiting explanations shown in the app
export { canRunBeside } from '@shared/graph'

/**
 * A plan that Autopia chose to make (you didn't ask for one) and that turned out to be a single task,
 * outside product builds and with no open questions, starts without an approval wait: it is a small
 * request after all. Plans you asked for, revised plans and product plans always wait for your OK.
 */
export function singleTaskPlanStartsNow(p: { autoPlanned: boolean; product: boolean; proposed: number; questions: number }): boolean {
  return p.autoPlanned && !p.product && p.proposed === 1 && p.questions === 0
}

/**
 * With a failed or interrupted task in the project, whether other work can still start: a task is
 * ready only when all its dependencies finished, so everything downstream of the stuck task waits.
 */
export function canContinueAround(tasks: Task[], byId: Map<string, Task>): boolean {
  return tasks.some((t) => isReady(t, byId))
}

export function isReady(task: Task, byId: Map<string, Task>): boolean {
  if (task.status !== 'pending') return false
  return task.dependsOn.every((d) => {
    const s = byId.get(d)?.status
    return s === 'done' || s === 'cancelled'
  })
}

/** Returns an error message if the dependency graph has a cycle or dangling key. */
export function validateGraph(tasks: { key: string; dependsOn: string[] }[]): string | null {
  const keys = new Set(tasks.map((t) => t.key))
  if (keys.size !== tasks.length) return 'Plan has duplicate task keys'
  for (const t of tasks) for (const d of t.dependsOn) if (!keys.has(d)) return `Task ${t.key} depends on unknown ${d}`
  const state = new Map<string, 0 | 1 | 2>()
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return false
    if (state.get(k) === 2) return true
    state.set(k, 1)
    for (const d of byKey.get(k)!.dependsOn) if (!visit(d)) return false
    state.set(k, 2)
    return true
  }
  for (const t of tasks) if (!visit(t.key)) return 'Plan has a dependency cycle'
  return null
}
