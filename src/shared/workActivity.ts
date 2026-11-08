// What a teammate is really doing, read from the tools Claude Code actually used. The office, the labels and the
// inspector all follow this. Pure and local: no AI, and nothing here is invented when no event arrives; it falls
// back to the plain workflow state instead.

import type { EmployeeStatus } from './types'

export type WorkDoing = 'coding' | 'researching' | 'planning' | 'testing' | 'debugging' | 'reviewing' | 'collaborating' | 'waiting' | 'blocked'

export const DOING_LABEL: Record<WorkDoing, string> = {
  coding: 'Writing code',
  researching: 'Reading and researching',
  planning: 'Planning',
  testing: 'Running tests',
  debugging: 'Debugging',
  reviewing: 'Reviewing',
  collaborating: 'Working with a teammate',
  waiting: 'Waiting',
  blocked: 'Blocked'
}

const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'ToolSearch', 'LS'])
/** Commands that check the work: failing one is what makes the next stretch debugging. */
const CHECKS = /(^|[\s;&|(])((npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|type-check|check)\b|npx\s+(vitest|jest|tsc|playwright|eslint|mocha)\b|vitest\b|jest\b|pytest\b|tsc\b|cargo\s+(test|build|check)\b|go\s+(test|build|vet)\b|make\s+(test|check)\b|playwright\b|eslint\b)/
const LOOKS = /^\s*(cd\s+("[^"]*"|\S+)\s*&&\s*)?(ls|cat|head|tail|find|grep|rg|wc|pwd|tree|git\s+(status|diff|log|show))\b/

export function classifyTool(name: string, input: Record<string, unknown>): 'coding' | 'researching' | 'testing' | null {
  if (WRITES.has(name)) return 'coding'
  if (READS.has(name)) return 'researching'
  if (name !== 'Bash') return null
  const command = typeof input.command === 'string' ? input.command : ''
  if (CHECKS.test(command)) return 'testing'
  return LOOKS.test(command) ? 'researching' : 'coding'
}

/** Refused before it ran, by you or by policy: nothing failed. */
const NEVER_RAN = /declined this|was cancelled|permission to use|has been denied|don't have permission|could no longer be answered/i

/** Reading between two edits is still the same stretch of writing: labels and screens don't flicker. */
export const SETTLE_MS = 4000

/** One Claude Code session's activity, from its real tool events. */
export class WorkTracker {
  doing: WorkDoing | null = null
  private since = 0
  private failing = false
  private checks = new Set<string>()

  constructor(private kind: 'code' | 'design' | 'qa' | null = null) {}

  private set(next: WorkDoing, now: number, force = false): void {
    if (next === this.doing) return
    if (!force && this.doing && now - this.since < SETTLE_MS) return
    this.doing = next
    this.since = now
  }

  tool(id: string, name: string, input: Record<string, unknown>, now: number): WorkDoing | null {
    const c = classifyTool(name, input)
    if (!c) return this.doing
    if (c === 'testing') {
      this.checks.add(id)
      this.set('testing', now, true)
    } else if (this.failing) this.set('debugging', now, true)
    else this.set(c === 'researching' && this.kind === 'qa' ? 'reviewing' : c, now)
    return this.doing
  }

  /** A check that failed starts debugging, and only a check that passes ends it. One that never ran says nothing. */
  result(id: string, isError: boolean, now: number, text = ''): WorkDoing | null {
    if (!this.checks.delete(id)) return this.doing
    if (isError && NEVER_RAN.test(text)) return this.doing
    this.failing = isError
    if (isError) this.set('debugging', now, true)
    return this.doing
  }
}

/** Always answers, even with no tool event yet: the workflow state outranks the last tool. */
export function doingOf(s: Pick<EmployeeStatus, 'activity' | 'doing'> | null | undefined): WorkDoing | null {
  if (!s) return null
  switch (s.activity) {
    case 'idle':
      return null
    case 'meeting':
      return 'planning'
    case 'waiting':
      return 'waiting'
    case 'error':
      return 'blocked'
    case 'testing':
      return s.doing && s.doing !== 'coding' ? s.doing : 'testing'
    case 'reviewing':
      return s.doing === 'collaborating' ? s.doing : 'reviewing'
    default:
      return s.doing ?? 'coding'
  }
}
