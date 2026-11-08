// One reading of everything that needs you: what kind of thing it is, what it's holding up, and which answers really
// exist for it. Pure and token-free. The backend decides what's pending and what's live; nothing here can approve anything.

import type { Approval, ApprovalDecision, BlockerDiagnosis, Notification, Task, TaskRecovery } from './types'

export type DecisionKind = 'permission' | 'question' | 'plan' | 'interrupted' | 'blocked' | 'unverified' | 'verify' | 'closing'

/** What it's really holding up. "session" means a Claude Code process is waiting on this exact answer right now. */
export interface DecisionImpact {
  holds: 'session' | 'task' | 'tasks' | 'nothing'
  /** Steps that can't start until this is settled, not counting the step itself. */
  waiting: number
}

export interface DecisionTask {
  id: string
  key: string
  title: string
  status: Task['status']
  assigneeId: string
  lastError: string | null
  recovery: TaskRecovery | null
}

export interface BoardDecision {
  type: 'decision'
  id: string
  approval: Approval
  projectName: string
  employeeId: string | null
  task: DecisionTask | null
  /** For a permission or a live question: whether a session is still waiting on it. Null for everything else. */
  live: boolean | null
  impact: DecisionImpact
  run: { id: string; sessionId: string | null; cwd: string } | null
  diagnosis: BlockerDiagnosis | null
}

/** Open and worth your attention, but not a choice to make here: a result to review, a failed check, the usage limit. */
export interface BoardNotice {
  type: 'notice'
  id: string
  notification: Notification
  projectName: string | null
}

/** Autopia couldn't tell what an instruction meant, or which work it was about, and asked. */
export interface BoardClarify {
  type: 'clarify'
  id: string
  projectId: string
  projectName: string
  text: string
  at: number
}

export type BoardItem = BoardDecision | BoardNotice | BoardClarify

export const NATIVE_QUESTION = /has a question$/

export function decisionKind(a: Pick<Approval, 'kind'>, task: Pick<DecisionTask, 'status' | 'recovery'> | null): DecisionKind {
  if (a.kind === 'task_failed') return task?.status === 'interrupted' && task.recovery ? 'interrupted' : 'blocked'
  if (a.kind === 'budget') return 'closing'
  return a.kind
}

export const DECISION_WORD: Record<DecisionKind, string> = {
  permission: 'Permission',
  question: 'Question',
  plan: 'Plan',
  interrupted: 'Interrupted',
  blocked: 'Blocked',
  unverified: 'Not fully checked',
  verify: 'Run it for real',
  closing: 'Old item'
}

export function impactOf(a: Pick<Approval, 'kind' | 'taskId'>, tasks: Pick<Task, 'id' | 'dependsOn' | 'status'>[], live: boolean | null): DecisionImpact {
  if (live) return { holds: 'session', waiting: waitingOn(a.taskId, tasks) }
  if (a.kind === 'plan') return { holds: 'tasks', waiting: tasks.filter((t) => t.status === 'proposed').length }
  if (!a.taskId) return { holds: 'nothing', waiting: 0 }
  const waiting = waitingOn(a.taskId, tasks)
  return { holds: waiting ? 'tasks' : 'task', waiting }
}

/** Everything downstream that can't start, however many steps away. */
function waitingOn(id: string | null, tasks: Pick<Task, 'id' | 'dependsOn' | 'status'>[]): number {
  if (!id) return 0
  const open = tasks.filter((t) => t.status === 'pending')
  const seen = new Set<string>()
  const walk = (from: string) => {
    for (const t of open) {
      if (!seen.has(t.id) && t.dependsOn.includes(from)) {
        seen.add(t.id)
        walk(t.id)
      }
    }
  }
  walk(id)
  return seen.size
}

const steps = (n: number) => `${n} ${n === 1 ? 'step is' : 'steps are'} waiting on this`

/** Said plainly, and only what the records show. No deadlines: none of these has one. */
export function impactLine(i: DecisionImpact, who: string | null, kind: DecisionKind): string {
  const name = who ?? 'A teammate'
  if (i.holds === 'session') return `${name} is paused until you answer.${i.waiting ? ` ${steps(i.waiting)}.` : ''}`
  if (kind === 'plan') return i.waiting ? `Nothing starts until you say so. ${i.waiting} ${i.waiting === 1 ? 'step' : 'steps'} planned.` : 'Nothing starts until you say so.'
  if (i.holds === 'tasks') return `${steps(i.waiting).replace(/^./, (c) => c.toUpperCase())}.`
  if (i.holds === 'task') return 'Only this step is affected. Other work carries on.'
  return 'Nothing else is waiting on this.'
}

/** Most held up first: a live session costs more every minute than a step that's simply stopped. */
export function rankBoard(items: BoardItem[]): BoardItem[] {
  const score = (i: BoardItem) => {
    if (i.type === 'clarify') return 70
    if (i.type === 'notice') return i.notification.category === 'review' ? 90 : 60
    if (i.impact.holds === 'session') return 0
    if (i.approval.kind === 'plan') return 20
    return i.impact.holds === 'tasks' ? 30 : 40
  }
  const at = (i: BoardItem) => (i.type === 'decision' ? i.approval.createdAt : i.type === 'notice' ? i.notification.updatedAt : i.at)
  return [...items].sort((a, b) => score(a) - score(b) || at(a) - at(b))
}

export type DecisionOption = {
  label: string
  decision: ApprovalDecision
  primary?: boolean
  tip?: string
  /** Stops more than this one thing, so it's asked twice. */
  confirm?: string
  disabled?: boolean
}

/** What Resume does for an interrupted task, in the words of its button. */
export const RESUME_LABEL: Record<TaskRecovery['next'], string> = { finish: 'Mark done', integrate: 'Finish merging', resume: 'Resume', reattach: 'Resume', continue: 'Continue', restart: 'Start again' }
const RESUME_TIP: Record<TaskRecovery['next'], string> = {
  finish: 'It was already merged; records it as done without running anything',
  integrate: 'Commits and merges the finished work (your uncommitted changes stay protected); no new session',
  resume: 'Continues the same Claude Code session in its working copy',
  reattach: 'Re-attaches the kept branch and continues the same session',
  continue: 'Starts a new Claude Code session from the files already in its working copy',
  restart: 'Nothing was kept, so the step starts again'
}

/**
 * Only answers the backend really accepts for this item as it stands. A permission with no session behind it has none:
 * there's nothing left to answer. Plans and questions have their own controls.
 */
export function decisionOptions(a: Pick<Approval, 'kind' | 'taskId'>, x: { live: boolean | null; recovery?: TaskRecovery | null; interrupted?: boolean; holdUntil?: number | null; now?: number; autoMode?: boolean }): DecisionOption[] {
  switch (a.kind) {
    case 'permission': {
      if (x.live === false) return []
      return [
        { label: 'Decline', decision: { kind: 'permission', action: 'deny' } },
        { label: 'Allow once', decision: { kind: 'permission', action: 'allow' }, primary: !a.taskId },
        ...(a.taskId ? [{ label: 'Allow for this step', decision: { kind: 'permission', action: 'allow_task' } as ApprovalDecision, tip: 'This exact request won’t ask again until this step finishes', primary: true }] : []),
      ]
    }
    case 'verify':
      return [
        { label: 'Don’t run it', decision: { kind: 'verify', action: 'skip' } },
        { label: 'Run these', decision: { kind: 'verify', action: 'allow' }, primary: true }
      ]
    case 'unverified':
      return [
        { label: 'Skip this step', decision: { kind: 'unverified', action: 'skip' } },
        { label: 'Accept without the checks', decision: { kind: 'unverified', action: 'accept' }, tip: 'It goes in without that evidence, and stays marked as unchecked' },
        { label: 'Try again', decision: { kind: 'unverified', action: 'retry' }, primary: true }
      ]
    case 'task_failed': {
      const r = x.interrupted ? x.recovery : null
      if (r) {
        const held = r.reason === 'usage_limit' && !!x.holdUntil && x.holdUntil > (x.now ?? Date.now())
        return [
          ...(r.next !== 'finish' ? [{ label: 'Cancel this step', decision: { kind: 'task_failed', action: 'skip' } as ApprovalDecision, tip: 'Its kept work is left out' }] : []),
          { label: RESUME_LABEL[r.next], decision: { kind: 'task_failed', action: 'retry' }, primary: true, tip: held ? 'Available after your usage limit resets' : RESUME_TIP[r.next], disabled: held }
        ]
      }
      return [
        { label: 'Stop the whole request', decision: { kind: 'task_failed', action: 'stop' }, confirm: 'Everything not yet finished in this request is cancelled.' },
        { label: 'Skip this step', decision: { kind: 'task_failed', action: 'skip' } },
        { label: 'Try again', decision: { kind: 'task_failed', action: 'retry' }, primary: true }
      ]
    }
    case 'budget':
      return [{ label: 'Dismiss', decision: { kind: 'budget', action: 'pause' }, tip: 'Budgets no longer exist, so this can simply be closed' }]
    default:
      return []
  }
}

export function parsePermission(body: string): { tool: string; subject: string; reason: string | null; runId: string | null } {
  try {
    const v = JSON.parse(body) as { tool?: string; subject?: string; reason?: string | null; runId?: string }
    return { tool: v.tool ?? 'Tool', subject: v.subject ?? '', reason: v.reason ?? null, runId: v.runId ?? null }
  } catch {
    return { tool: 'Tool', subject: body, reason: null, runId: null }
  }
}

/** What a teammate is asking to do, in words anyone can read. The exact request is shown beside it. */
export function permissionAsk(tool: string): string {
  if (tool === 'Bash') return 'run a command'
  if (tool === 'Read' || tool === 'NotebookRead') return 'read a file'
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'change a file'
  if (tool === 'Glob' || tool === 'Grep' || tool === 'LS') return 'look through some files'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'look something up online'
  if (tool === 'Task' || tool === 'Agent') return 'bring in a helper'
  const connector = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1]
  return `use ${connector ?? tool}`
}

/** A click that lost a race isn't a failure: someone or something already settled it. */
export const alreadySettled = (message: string) => /already made|expired|no longer/i.test(message)

// ── reading one session ─────────────────────────────────

export interface EventLike {
  kind: string
  toolName: string | null
  isError: boolean
  summary: string
  detail: string | null
}

export type InspectView = 'story' | 'tools' | 'problems' | 'decisions' | 'everything'

const DECIDED = /^(You allowed|You declined|You answered|Waiting for your OK|Allowed \(you OK'd)/

export function inspectFilter(view: InspectView, e: EventLike): boolean {
  switch (view) {
    case 'tools':
      return e.kind === 'tool_use' || e.kind === 'tool_result'
    case 'problems':
      return e.isError || e.kind === 'stderr' || e.kind === 'error'
    case 'decisions':
      return e.kind === 'system' && DECIDED.test(e.summary)
    case 'story':
      return e.kind === 'text' || e.kind === 'tool_use' || e.kind === 'error' || e.isError || e.kind === 'result' || (e.kind === 'system' && DECIDED.test(e.summary))
    default:
      return true
  }
}

const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** What one session's recorded events really show: tools called, files it wrote, servers it reached. */
export function sessionFacts(events: EventLike[]): { tools: { name: string; count: number }[]; toolCalls: number; problems: number; files: string[]; mcp: string[]; decisions: number } {
  const counts = new Map<string, number>()
  const files = new Set<string>()
  const mcp = new Set<string>()
  let toolCalls = 0
  let problems = 0
  let decisions = 0
  for (const e of events) {
    if (e.isError || e.kind === 'stderr' || e.kind === 'error') problems++
    if (e.kind === 'system' && DECIDED.test(e.summary) && !e.summary.startsWith('Waiting')) decisions++
    if (e.kind !== 'tool_use' || !e.toolName) continue
    toolCalls++
    counts.set(e.toolName, (counts.get(e.toolName) ?? 0) + 1)
    const server = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(e.toolName)
    if (server) mcp.add(`${server[1]}: ${server[2]}`)
    if (WRITES.has(e.toolName) && e.detail) {
      try {
        const input = JSON.parse(e.detail) as { file_path?: string; notebook_path?: string }
        const path = input.file_path ?? input.notebook_path
        if (path) files.add(path)
      } catch {
        // cut short when it was recorded: the summary line still says what it did
      }
    }
  }
  return { tools: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), toolCalls, problems, files: [...files], mcp: [...mcp], decisions }
}

/** The stretch of a long log worth rendering now: the newest part, and earlier on request. */
export function logWindow<T>(events: T[], shown: number): { rows: T[]; hidden: number } {
  const start = Math.max(0, events.length - shown)
  return { rows: start ? events.slice(start) : events, hidden: start }
}
