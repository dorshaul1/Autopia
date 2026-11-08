import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alreadySettled, decisionKind, decisionOptions, impactLine, impactOf, inspectFilter, logWindow, parsePermission, rankBoard, sessionFacts, type BoardItem } from '../src/shared/decisions'

const tasks = [
  { id: 'a', dependsOn: [], status: 'failed' as const },
  { id: 'b', dependsOn: ['a'], status: 'pending' as const },
  { id: 'c', dependsOn: ['b'], status: 'pending' as const },
  { id: 'd', dependsOn: [], status: 'pending' as const },
  { id: 'p', dependsOn: [], status: 'proposed' as const }
]
const labels = (o: { label: string }[]) => o.map((x) => x.label)
const rec = (next: 'resume' | 'finish', reason: 'restart' | 'usage_limit' = 'restart') => ({ next, reason, preserved: [], count: 1 }) as never

describe('what it holds up', () => {
  it('a live prompt holds a session, however little depends on it', () => {
    expect(impactOf({ kind: 'permission', taskId: 'd' }, tasks, true)).toEqual({ holds: 'session', waiting: 0 })
  })
  it('counts everything downstream, not just the next step', () => {
    expect(impactOf({ kind: 'task_failed', taskId: 'a' }, tasks, null)).toEqual({ holds: 'tasks', waiting: 2 })
    expect(impactOf({ kind: 'task_failed', taskId: 'd' }, tasks, null)).toEqual({ holds: 'task', waiting: 0 })
  })
  it('a plan holds what it plans, and something with no task holds nothing', () => {
    expect(impactOf({ kind: 'plan', taskId: null }, tasks, null)).toEqual({ holds: 'tasks', waiting: 1 })
    expect(impactOf({ kind: 'verify', taskId: null }, tasks, null).holds).toBe('nothing')
  })
  it('says so plainly, and never invents a deadline', () => {
    expect(impactLine({ holds: 'session', waiting: 1 }, 'Inés', 'permission')).toBe('Inés is paused until you answer. 1 step is waiting on this.')
    expect(impactLine({ holds: 'tasks', waiting: 2 }, null, 'blocked')).toBe('2 steps are waiting on this.')
    expect(impactLine({ holds: 'task', waiting: 0 }, 'Inés', 'blocked')).toMatch(/Other work carries on/)
    for (const h of ['session', 'task', 'tasks', 'nothing'] as const) expect(impactLine({ holds: h, waiting: 1 }, 'A', 'blocked')).not.toMatch(/urgent|minutes|deadline|hours/i)
  })
})

describe('what comes first', () => {
  const d = (id: string, holds: 'session' | 'tasks' | 'task', at: number, kind = 'task_failed'): BoardItem => ({ type: 'decision', id, approval: { kind, createdAt: at } as never, projectName: '', employeeId: null, task: null, live: null, impact: { holds, waiting: 0 }, run: null, diagnosis: null })
  const review: BoardItem = { type: 'notice', id: 'r', notification: { category: 'review', updatedAt: 1 } as never, projectName: null }
  const failure: BoardItem = { type: 'notice', id: 'f', notification: { category: 'failure', updatedAt: 1 } as never, projectName: null }
  it('live sessions, then plans, then blocking, then the rest; a result to review waits last', () => {
    expect(rankBoard([review, d('t', 'task', 1), failure, d('b', 'tasks', 2), d('p', 'tasks', 3, 'plan'), d('s2', 'session', 9), d('s1', 'session', 5)]).map((i) => i.id)).toEqual(['s1', 's2', 'p', 'b', 't', 'f', 'r'])
  })
})

describe('only answers that really exist', () => {
  it('a permission gets exactly the native answers, in its own scope', () => {
    expect(labels(decisionOptions({ kind: 'permission', taskId: 't' }, { live: true }))).toEqual(['Decline', 'Allow once', 'Allow for this step'])
    expect(labels(decisionOptions({ kind: 'permission', taskId: null }, { live: true }))).toEqual(['Decline', 'Allow once'])
  })
  it('a permission with nothing behind it has no answers at all', () => {
    expect(decisionOptions({ kind: 'permission', taskId: 't' }, { live: false })).toEqual([])
  })
  it('nothing defaults to allowing: there is no option without a click, and no "always"', () => {
    expect(labels(decisionOptions({ kind: 'permission', taskId: 't' }, { live: true, autoMode: true })).join()).not.toMatch(/always|everything/i)
  })
  it('recovery says what it really does; a step already merged can’t be cancelled', () => {
    expect(labels(decisionOptions({ kind: 'task_failed', taskId: 't' }, { live: null, interrupted: true, recovery: rec('resume') }))).toEqual(['Cancel this step', 'Resume'])
    expect(labels(decisionOptions({ kind: 'task_failed', taskId: 't' }, { live: null, interrupted: true, recovery: rec('finish') }))).toEqual(['Mark done'])
  })
  it('resuming into a usage limit is held back until it resets', () => {
    const [, resume] = decisionOptions({ kind: 'task_failed', taskId: 't' }, { live: null, interrupted: true, recovery: rec('resume', 'usage_limit'), holdUntil: 100, now: 50 })
    expect(resume.disabled).toBe(true)
  })
  it('stopping a whole request asks twice', () => {
    const o = decisionOptions({ kind: 'task_failed', taskId: 't' }, { live: null })
    expect(o.find((x) => x.label.startsWith('Stop'))?.confirm).toBeTruthy()
    expect(o.find((x) => x.label === 'Try again')?.primary).toBe(true)
  })
  it('kinds read as what they are', () => {
    expect(decisionKind({ kind: 'task_failed' }, { status: 'interrupted', recovery: rec('resume') })).toBe('interrupted')
    expect(decisionKind({ kind: 'task_failed' }, { status: 'failed', recovery: null })).toBe('blocked')
  })
  it('a lost race isn’t an error', () => {
    expect(alreadySettled('This decision was already made')).toBe(true)
    expect(alreadySettled('This request expired: the Claude Code session already ended')).toBe(true)
    expect(alreadySettled('disk full')).toBe(false)
  })
  it('reads a permission as recorded, and survives anything else', () => {
    expect(parsePermission(JSON.stringify({ tool: 'Bash', subject: 'npm test', runId: 'r' }))).toEqual({ tool: 'Bash', subject: 'npm test', reason: null, runId: 'r' })
    expect(parsePermission('not json').subject).toBe('not json')
  })
})

describe('reading a session', () => {
  const e = (kind: string, over: Partial<{ toolName: string; isError: boolean; summary: string; detail: string }> = {}) => ({ kind, toolName: over.toolName ?? null, isError: over.isError ?? false, summary: over.summary ?? 'x', detail: over.detail ?? null })
  it('counts only what was recorded', () => {
    const f = sessionFacts([e('tool_use', { toolName: 'Edit', detail: JSON.stringify({ file_path: '/p/a.ts' }) }), e('tool_use', { toolName: 'Write', detail: '{cut off' }), e('tool_use', { toolName: 'Read', detail: JSON.stringify({ file_path: '/p/b.ts' }) }), e('tool_use', { toolName: 'mcp__github__create_issue' }), e('tool_result', { isError: true, toolName: 'Bash' }), e('system', { summary: 'You declined: Bash x' }), e('system', { summary: 'Waiting for your OK: Bash x' })])
    expect(f.toolCalls).toBe(4)
    expect(f.files).toEqual(['/p/a.ts'])
    expect(f.mcp).toEqual(['github: create_issue'])
    expect(f.problems).toBe(1)
    expect(f.decisions).toBe(1)
  })
  it('each view shows what it says', () => {
    const tool = e('tool_use', { toolName: 'Bash' })
    const asked = e('system', { summary: 'You allowed: Bash x' })
    const chatter = e('system', { summary: 'Session started' })
    const think = e('thinking')
    expect(inspectFilter('story', tool)).toBe(true)
    expect(inspectFilter('story', think)).toBe(false)
    expect(inspectFilter('story', chatter)).toBe(false)
    expect(inspectFilter('story', asked)).toBe(true)
    expect(inspectFilter('decisions', asked)).toBe(true)
    expect(inspectFilter('decisions', tool)).toBe(false)
    expect(inspectFilter('problems', e('tool_result', { isError: true }))).toBe(true)
    expect(inspectFilter('everything', think)).toBe(true)
  })
  it('a very long log renders only its newest part', () => {
    const many = Array.from({ length: 100_000 }, (_, i) => i)
    const t = Date.now()
    const { rows, hidden } = logWindow(many, 300)
    expect(rows.length).toBe(300)
    expect(rows[299]).toBe(99_999)
    expect(hidden).toBe(99_700)
    expect(Date.now() - t).toBeLessThan(50)
    expect(logWindow([1, 2], 300)).toEqual({ rows: [1, 2], hidden: 0 })
  })
})

describe('what the backend guarantees', () => {
  const src = readFileSync(join(__dirname, '../src/main/orchestrator/orchestrator.ts'), 'utf8')
  it('a restart closes questions no session can hear, as it does permissions', () => {
    const r = src.slice(src.indexOf('recoverFromRestart(): void'), src.indexOf('for (const run of this.repo.runsWithStatus'))
    expect(r).toContain("pendingApprovalsOfKind('permission')")
    expect(r).toContain("pendingApprovalsOfKind('question')")
  })
  it('a permission answer goes only to its own waiting request, once', () => {
    const r = src.slice(src.indexOf('async resolveApproval('), src.indexOf("if (decision.kind === 'budget')"))
    expect(r).toContain("throw new Error('This decision was already made')")
    expect(r).toContain('this.permissionWaiters.get(id)')
    expect(r).toContain('this.permissionWaiters.delete(id)')
  })
  it('the board adds no store of its own, and old renderers are gone', () => {
    const board = src.slice(src.indexOf('decisionBoard(): BoardItem[]'), src.indexOf('companyStatus(): CompanyStatus'))
    expect(board).not.toMatch(/setMeta|\.set\(|updateTask|resolveApproval/)
    const card = readFileSync(join(__dirname, '../src/renderer/src/components/ApprovalDock.tsx'), 'utf8')
    expect(card).not.toContain('Allow once')
  })
})
