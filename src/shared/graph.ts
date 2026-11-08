import type { Task, TaskSize } from './types'

// Dependency-graph utilities shared by the scheduler (main) and the UI (renderer).

export const SIZE_WEIGHT: Record<TaskSize, number> = { s: 1, m: 2, l: 4 }

const open = (t: Task) => t.status !== 'done' && t.status !== 'cancelled'

/**
 * Remaining critical-path length from each task to the end of the graph, counting only unfinished
 * work. The scheduler starts the highest-ranked ready task first to minimise total completion time.
 */
export function criticalRanks(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const dependents = new Map<string, string[]>()
  for (const t of tasks) for (const d of t.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), t.id])
  const memo = new Map<string, number>()
  const rank = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const t = byId.get(id)!
    const own = open(t) ? SIZE_WEIGHT[t.size] : 0
    const down = Math.max(0, ...(dependents.get(id) ?? []).map((c) => rank(c, seen)))
    memo.set(id, own + down)
    return own + down
  }
  for (const t of tasks) rank(t.id)
  return memo
}

/** Tasks on the longest remaining path (ties included). */
export function criticalPath(tasks: Task[]): Set<string> {
  const ranks = criticalRanks(tasks)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const dependents = new Map<string, string[]>()
  for (const t of tasks) for (const d of t.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), t.id])
  const roots = tasks.filter((t) => open(t) && t.dependsOn.every((d) => !open(byId.get(d)!)))
  const best = Math.max(0, ...roots.map((t) => ranks.get(t.id)!))
  const path = new Set<string>()
  const walk = (id: string) => {
    path.add(id)
    const kids = (dependents.get(id) ?? []).filter((c) => open(byId.get(c)!))
    const top = Math.max(0, ...kids.map((c) => ranks.get(c)!))
    for (const c of kids) if (ranks.get(c) === top && top > 0) walk(c)
  }
  for (const r of roots) if (ranks.get(r.id) === best && best > 0) walk(r.id)
  return path
}

const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '').trim()
const stem = (p: string) => norm(p.split('*')[0]).replace(/\/$/, '')

/** True when two path/glob hint lists could touch the same files. Empty lists never overlap. */
export function filesOverlap(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      const sx = stem(x)
      const sy = stem(y)
      if (!sx || !sy) return true // a bare "*" claims everything
      if (sx === sy || sx.startsWith(sy + '/') || sy.startsWith(sx + '/')) return true
      if ((x.includes('*') && sy.startsWith(sx)) || (y.includes('*') && sx.startsWith(sy))) return true
    }
  }
  return false
}

/** Depth of each task in the DAG (0 = no dependencies), for layered graph layouts. */
export function levels(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const memo = new Map<string, number>()
  const depth = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const t = byId.get(id)
    const d = t && t.dependsOn.length ? 1 + Math.max(...t.dependsOn.filter((x) => byId.has(x)).map((x) => depth(x, seen))) : 0
    memo.set(id, d)
    return d
  }
  for (const t of tasks) depth(t.id)
  return memo
}

/** Human explanation of why a pending task has not started yet. */
/** Files a task planned to touch plus the ones it has actually changed so far (plans are often off). */
export function touchedFiles(t: Pick<Task, 'files'> & { changedFiles?: string[] }): string[] {
  return [...new Set([...t.files, ...(t.changedFiles ?? []).map((c) => c.replace(/^\S+\s+/, ''))])]
}

/**
 * Whether a ready task may start while `running` tasks of the same project are in flight: never when
 * the files either side planned or already changed overlap, and never when either side has no planned
 * files (a repair, a correction, a follow-up can touch anything). `legacy` checks planned files only.
 */
export function canRunBeside(task: Pick<Task, 'files'> & { changedFiles?: string[] }, running: (Pick<Task, 'files'> & { changedFiles?: string[] })[], legacy = false): boolean {
  const mine = legacy ? task.files : touchedFiles(task)
  if (running.some((r) => filesOverlap(mine, legacy ? r.files : touchedFiles(r)))) return false
  if (!legacy && running.length && (!task.files.length || running.some((r) => !r.files.length))) return false
  return true
}

/**
 * Why a pending task hasn't started, in plain words. With `nameOf` (employee id → first name) it says
 * whose work it waits for ("Waiting for Maya to finish T3"), which reads better than keys alone.
 */
export function waitingReason(task: Task, tasks: Task[], busyEmployee: (id: string) => string | null, nameOf?: (employeeId: string) => string | null): string | null {
  if (task.status !== 'pending') return null
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const blockers = task.dependsOn.map((d) => byId.get(d)).filter((d): d is Task => !!d && open(d))
  const whose = (ts: Task[]) => {
    const names = [...new Set(ts.map((t) => (t.assigneeId !== task.assigneeId && nameOf?.(t.assigneeId)) || null))]
    const keys = ts.map((t) => t.key).join(', ')
    if (!nameOf || names.includes(null)) return keys
    return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} to finish ${keys}`
  }
  // a dependency that failed or was interrupted needs someone to act: this task is blocked, not queued
  const stuck = blockers.filter((b) => b.status === 'failed' || b.status === 'interrupted')
  if (stuck.length) return `Blocked: ${stuck.map((b) => (nameOf && b.assigneeId !== task.assigneeId && nameOf(b.assigneeId) ? `${nameOf(b.assigneeId)}'s ${b.key}` : b.key)).join(', ')} needs attention first`
  if (blockers.length) {
    const w = whose(blockers)
    return w.includes(' to finish ') ? `Waiting for ${w}` : `Waiting on ${w}`
  }
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'merging')
  const clash = running.find((r) => !canRunBeside(task, [r]))
  const owner = (t: Task) => (nameOf && t.assigneeId !== task.assigneeId ? nameOf(t.assigneeId) : null)
  if (clash) {
    const who = owner(clash) ? `${owner(clash)}'s ${clash.key}` : clash.key
    return filesOverlap(touchedFiles(task), touchedFiles(clash)) ? `Shares files with ${who}; starts after it to avoid conflicts` : `Starts after ${who}: one of them has no planned files, so they can't safely overlap`
  }
  const busy = busyEmployee(task.assigneeId)
  if (busy) return `${busy} is finishing another task`
  return 'Ready — waiting for a free slot'
}
