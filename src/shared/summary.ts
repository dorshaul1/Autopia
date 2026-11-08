import { criticalPath } from './graph'
import type { Employee, Project, Run, Task } from './types'

/** A concise, factual status line built from real task and run state. No AI involved. */
export function projectSummary(project: Project, tasks: Task[], runs: Run[], employees: Employee[], now = Date.now()): string {
  const name = (id: string) => employees.find((e) => e.id === id)?.name.split(' ')[0] ?? 'someone'
  const real = tasks.filter((t) => t.status !== 'proposed')
  const done = real.filter((t) => t.status === 'done' || t.status === 'cancelled')
  const running = real.filter((t) => t.status === 'running' || t.status === 'merging')
  const failed = real.filter((t) => t.status === 'failed' || t.status === 'interrupted')
  const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`)

  switch (project.phase) {
    case 'new':
      return project.goal.trim() ? 'Ready to start.' : 'Not started yet. Describe what to build.'
    case 'planning':
      return `${name(runs.find((r) => r.kind === 'planning' && r.status === 'running')?.employeeId ?? '')} is planning; no one else is active.`
    case 'awaiting_plan_approval': {
      const proposed = tasks.filter((t) => t.status === 'proposed')
      const team = new Set(proposed.map((t) => t.assigneeId)).size
      return `Plan of ${proposed.length} task${proposed.length > 1 ? 's' : ''} for a team of ${team} is waiting for your approval.`
    }
    case 'completed':
    {
      // only claim passing checks when every recorded check actually passed
      const checks = done.flatMap((t) => t.checks)
      const verdict = !checks.length ? 'no automated checks ran' : checks.every((c) => c.status === 'passed') ? 'all checks passed' : 'some checks didn’t pass or couldn’t run'
      return `Finished ${done.length} of ${real.length} tasks; ${verdict}.`
    }
    case 'failed':
      return `Stopped with ${done.length}/${real.length} tasks done.`
  }

  const parts = [`${done.length}/${real.length} done`]
  if (running.length) {
    parts.push(
      running
        .map((t) => `${t.key} with ${name(t.assigneeId)}${t.startedAt ? ` (${mins(now - t.startedAt)})` : ''}`)
        .join(', ') + ' in progress'
    )
  }
  if (failed.length) parts.push(`${failed.map((t) => t.key).join(', ')} need${failed.length === 1 ? 's' : ''} your decision`)
  const crit = criticalPath(real)
  const nextUp = real.filter((t) => t.status === 'pending' && crit.has(t.id)).map((t) => t.key)
  if (nextUp.length && !failed.length) parts.push(`critical path next: ${nextUp.join(' → ')}`)
  return parts.join(' · ') + '.'
}
