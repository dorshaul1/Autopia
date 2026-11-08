import type { ProjectMetrics, Run } from '@shared/types'
import type { Repo } from '../db/repo'

/** Total length of the union of [start, end) intervals. */
export function unionMs(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let cur: [number, number] | null = null
  for (const [s, e] of sorted) {
    if (!cur || s > cur[1]) {
      if (cur) total += cur[1] - cur[0]
      cur = [s, e]
    } else cur[1] = Math.max(cur[1], e)
  }
  if (cur) total += cur[1] - cur[0]
  return total
}

/** Where the time, money and sessions went, from recorded runs and checks only. */
export function projectMetrics(repo: Repo, projectId: string): ProjectMetrics {
  const now = Date.now()
  const runs = repo.allRuns(projectId)
  const tasks = repo.tasks(projectId)
  const span = (r: Run): [number, number] => [r.startedAt, r.endedAt ?? (r.status === 'running' ? now : r.startedAt)]
  const intervals = runs.map(span)
  const sum = (rs: Run[]) => rs.reduce((n, r) => n + (span(r)[1] - span(r)[0]), 0)
  const checks = tasks.flatMap((t) => t.checks)
  const checkIntervals = checks.map((c): [number, number] => [c.at, c.at + c.ms])
  const first = Math.min(...intervals.map((i) => i[0]), ...checkIntervals.map((i) => i[0]))
  const last = Math.max(...intervals.map((i) => i[1]), ...checkIntervals.map((i) => i[1]))
  const wallMs = Number.isFinite(first) ? last - first : 0
  const activeMs = unionMs([...intervals, ...checkIntervals])
  const agentMs = sum(runs)
  const metered = runs.filter((r) => r.inputTokens !== null || r.outputTokens !== null)
  const employees = repo.employees().map((e) => {
    const mine = runs.filter((r) => r.employeeId === e.id)
    const busyMs = unionMs(mine.map(span))
    return {
      employeeId: e.id,
      busyMs,
      sessions: mine.length,
      costUsd: mine.reduce((n, r) => n + (r.costUsd ?? 0), 0),
      utilization: wallMs ? busyMs / wallMs : 0
    }
  })
  return {
    wallMs,
    activeMs,
    agentMs,
    waitingMs: Math.max(0, wallMs - activeMs),
    parallelism: activeMs ? agentMs / unionMs(intervals) || 0 : 0,
    planningMs: sum(runs.filter((r) => r.purpose === 'plan')),
    workMs: sum(runs.filter((r) => r.purpose === 'work' || r.purpose === 'retry')),
    fixMs: sum(runs.filter((r) => r.purpose === 'fix' || r.purpose === 'resolve')),
    validationMs: checks.reduce((n, c) => n + c.ms, 0),
    sessions: runs.length,
    retries: tasks.reduce((n, t) => n + Math.max(0, t.attempts - 1) + t.fixAttempts, 0),
    failures: runs.filter((r) => r.status === 'failed').length,
    conflicts: tasks.reduce((n, t) => n + t.conflicts, 0),
    inputTokens: metered.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: metered.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    cacheReadTokens: metered.reduce((n, r) => n + (r.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: metered.reduce((n, r) => n + (r.cacheWriteTokens ?? 0), 0),
    costUsd: runs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    meteredRuns: metered.length,
    employees,
    timeline: runs.map((r) => ({
      runId: r.id,
      employeeId: r.employeeId,
      taskId: r.taskId,
      purpose: r.purpose,
      status: r.status,
      start: r.startedAt,
      end: r.endedAt
    }))
  }
}
