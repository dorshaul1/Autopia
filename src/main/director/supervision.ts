// Event-driven supervision of running Claude Code sessions: pure, deterministic rules applied to the
// session's real stream events (no AI, no polling of the model). The orchestrator feeds them what it
// already records and acts on the verdicts.

import type { BashEvidence } from '@shared/checks'

/** Silence with no tool running: warn, then restart the session once. */
export const STALL_WARN_MS = 4 * 60_000
export const STALL_KILL_MS = 10 * 60_000

/**
 * A running tool call is not silence: Claude Code reports nothing until it returns. Its own Bash tool
 * stops a command after 10 minutes at most, so a Bash call is only suspicious beyond that; a subagent
 * (Agent/Task) can legitimately work much longer. Recorded history: an `npm test` ran 267 s with no
 * output, past the 4-minute silence warning.
 */
export function toolBudgetMs(name: string): number {
  return name === 'Agent' || name === 'Task' ? 30 * 60_000 : 12 * 60_000
}

/** Extra time past a tool's budget before the session is restarted. */
const TOOL_GRACE_MS = 5 * 60_000

export interface SessionClock {
  now: number
  /** Last stream event (any kind). */
  lastEventAt: number
  /** Permission prompts waiting for the founder. */
  waitingOnFounder: number
  /** Tool calls started and not yet returned. */
  inFlight: { name: string; since: number }[]
}

export type StallVerdict = { kind: 'ok' } | { kind: 'warn' | 'restart'; reason: string }

export function stallVerdict(c: SessionClock): StallVerdict {
  if (c.waitingOnFounder > 0) return { kind: 'ok' }
  if (c.inFlight.length) {
    const oldest = c.inFlight.reduce((a, b) => (b.since < a.since ? b : a))
    const budget = Math.max(...c.inFlight.map((t) => toolBudgetMs(t.name)))
    const running = c.now - oldest.since
    const min = Math.round(running / 60_000)
    if (running > budget + TOOL_GRACE_MS) return { kind: 'restart', reason: `${oldest.name} has been running for ${min} min, well past its ${budget / 60_000}-minute limit` }
    if (running > budget) return { kind: 'warn', reason: `${oldest.name} is still running after ${min} min, longer than expected` }
    return { kind: 'ok' }
  }
  const idle = c.now - c.lastEventAt
  const min = Math.round(idle / 60_000)
  if (idle > STALL_KILL_MS) return { kind: 'restart', reason: `no output for ${min} min with no tool running` }
  if (idle > STALL_WARN_MS) return { kind: 'warn', reason: `no output for ${min} min with no tool running` }
  return { kind: 'ok' }
}

/** Note it when the same failure repeats this often in one session; stop the session at the second. */
export const REPEAT_NOTE = 3
export const REPEAT_STOP = 6

/**
 * The most-repeated identical failure in a session: the same command failing with the same first error
 * line. Different errors from the same command are progress (the agent changed something), not a loop.
 */
export function repeatedFailure(bash: BashEvidence[]): { command: string; error: string; count: number } | null {
  const counts = new Map<string, { command: string; error: string; count: number }>()
  for (const b of bash) {
    if (!b.isError || b.founderDenied || b.policyDenied) continue
    const error = (b.output.split('\n').find((l) => /error|fail|cannot|not found|denied|EADDRINUSE|ENOENT|✖|not ok/i.test(l)) ?? b.output.split('\n').find((l) => l.trim()) ?? '').trim().replace(/\d+(\.\d+)?\s*m?s\b/g, '').slice(0, 160)
    const key = `${b.command.replace(/\s+/g, ' ').trim()}\n${error}`
    const c = counts.get(key) ?? { command: b.command.trim(), error, count: 0 }
    c.count++
    counts.set(key, c)
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0]
  return top && top.count >= 2 ? top : null
}
