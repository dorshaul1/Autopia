// Execution-engine metrics computed from recorded runs, tasks and deliveries. Deterministic and
// observational: they show where time and tokens go and how often work needs rework; they do not
// change any rule automatically.

import type { Delivery, ResultTelemetry, Run, StrategyStats, Task } from '@shared/types'


const median = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const ms = (r: Run) => (r.endedAt ?? r.startedAt) - r.startedAt

/**
 * One result's execution profile from its recorded sessions. Planning sessions belong to a result when
 * they ran in its project between its creation and its first task session (planning has no task).
 */
export function resultTelemetry(d: Delivery, tasks: Task[], runs: Run[]): ResultTelemetry {
  const own = tasks.filter((t) => t.deliveryId === d.id)
  const taskRuns = runs.filter((r) => r.kind === 'task' && own.some((t) => t.id === r.taskId))
  const firstTask = taskRuns.length ? Math.min(...taskRuns.map((r) => r.startedAt)) : Infinity
  const planning = runs.filter((r) => r.kind === 'planning' && r.projectId === d.projectId && r.startedAt >= d.createdAt - 1000 && r.startedAt < firstTask)
  const repair = taskRuns.filter((r) => r.purpose === 'fix' || r.purpose === 'retry' || r.purpose === 'resolve')
  const all = [...planning, ...taskRuns]
  const sum = (rs: Run[], f: (r: Run) => number) => rs.reduce((n, r) => n + f(r), 0)
  return {
    deliveryId: d.id,
    strategy: d.strategy,
    agents: new Set(taskRuns.map((r) => r.employeeId)).size,
    sessions: { planning: planning.length, work: taskRuns.length - repair.length, repair: repair.length, total: all.length },
    turns: sum(all, (r) => r.numTurns ?? 0),
    costUsd: sum(all, (r) => r.costUsd ?? 0),
    planningCostUsd: sum(planning, (r) => r.costUsd ?? 0),
    tokens: { fresh: sum(all, (r) => (r.inputTokens ?? 0) + (r.cacheWriteTokens ?? 0) + (r.outputTokens ?? 0)), cached: sum(all, (r) => r.cacheReadTokens ?? 0) },
    ms: { planning: sum(planning, ms), work: sum(taskRuns.filter((r) => !repair.includes(r)), ms), repair: sum(repair, ms) },
    wallMs: all.length ? Math.max(...all.map((r) => r.endedAt ?? r.startedAt)) - Math.min(...all.map((r) => r.startedAt)) : 0,
    retries: repair.length
  }
}

export function strategyStats(deliveries: Delivery[], tasks: Task[], runs: Run[]): StrategyStats[] {
  const groups = new Map<string, ResultTelemetry[]>()
  for (const d of deliveries.filter((x) => x.completedAt && x.strategy)) {
    const t = resultTelemetry(d, tasks, runs)
    if (t.sessions.total) groups.set(d.strategy!, [...(groups.get(d.strategy!) ?? []), t])
  }
  return [...groups.entries()]
    .sort()
    .map(([strategy, ts]) => {
      const cost = ts.reduce((n, t) => n + t.costUsd, 0)
      return {
        strategy,
        results: ts.length,
        medianCostUsd: median(ts.map((t) => t.costUsd)),
        medianWallMinutes: median(ts.map((t) => t.wallMs / 60_000)),
        medianSessions: median(ts.map((t) => t.sessions.total)),
        planningShare: cost > 0 ? ts.reduce((n, t) => n + t.planningCostUsd, 0) / cost : null,
        firstPassRate: ts.filter((t) => t.retries === 0).length / ts.length
      }
    })
}
