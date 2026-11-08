import { describe, expect, it } from 'vitest'
import type { BashEvidence } from '../src/shared/checks'
import { canRunBeside, touchedFiles, waitingReason } from '../src/shared/graph'
import type { Task } from '../src/shared/types'
import { diagnose } from '../src/main/director/blockers'
import { REPEAT_NOTE, REPEAT_STOP, repeatedFailure, stallVerdict, STALL_KILL_MS, STALL_WARN_MS } from '../src/main/director/supervision'

const MIN = 60_000
const fail = (command: string, output: string, p: Partial<BashEvidence> = {}): BashEvidence => ({ command, isError: true, output, ms: 10, at: 0, founderDenied: false, policyDenied: false, ...p })
const t = (key: string, p: Partial<Task> = {}): Task => ({ id: key, key, status: 'pending', dependsOn: [], files: [], changedFiles: [], assigneeId: 'e', ...p }) as Task

describe('repeated failures', () => {
  it('counts the same command failing the same way, and nothing else', () => {
    const portBusy = 'Error: listen EADDRINUSE: address already in use :::3000'
    expect(repeatedFailure([fail('node server.js', portBusy), fail('node server.js', portBusy), fail('node server.js', portBusy)])).toMatchObject({ command: 'node server.js', count: 3 })
    // the agent changed something and the error changed: progress, not a loop
    expect(repeatedFailure([fail('npm test', 'not ok 1 - adds'), fail('npm test', 'not ok 2 - subtracts'), fail('npm test', 'not ok 3 - divides')])).toBeNull()
    // timings in the output don't make identical failures look different
    expect(repeatedFailure([fail('npm test', '✖ adds (12ms)'), fail('npm test', '✖ adds (9ms)')])?.count).toBe(2)
  })

  it('ignores calls you declined or your policy blocked, and successes', () => {
    expect(repeatedFailure([fail('git log', 'denied', { policyDenied: true }), fail('git log', 'denied', { policyDenied: true }), fail('rm x', 'no', { founderDenied: true })])).toBeNull()
    expect(repeatedFailure([{ ...fail('npm test', 'ok'), isError: false }])).toBeNull()
  })

  it('notes before it stops, and the stop is never retried automatically', () => {
    expect(REPEAT_NOTE).toBeLessThan(REPEAT_STOP)
    const err = 'Stopped: the agent ran `node server.js` 6 times with the same error (Error: Cannot find module "express") instead of changing approach. Its work so far is kept in the task\'s worktree.'
    const d = diagnose(t('T3', { status: 'failed', lastError: err }), null)
    // without the explicit rule this would read as a missing dependency and be retried automatically
    expect(d.kind).toBe('repeated_failure')
    expect(d.autoAction).toBeNull()
  })
})

describe('stall detection', () => {
  const at = (p: { idle?: number; tools?: { name: string; ago: number }[]; waiting?: number }) =>
    stallVerdict({ now: 100 * MIN, lastEventAt: 100 * MIN - (p.idle ?? 0), waitingOnFounder: p.waiting ?? 0, inFlight: (p.tools ?? []).map((x) => ({ name: x.name, since: 100 * MIN - x.ago })) })

  it('a long-running tool is not a stall (recorded: npm test ran 267 s with no output)', () => {
    expect(at({ idle: 267_000, tools: [{ name: 'Bash', ago: 267_000 }] }).kind).toBe('ok')
    expect(at({ idle: 11 * MIN, tools: [{ name: 'Bash', ago: 11 * MIN }] }).kind).toBe('ok')
    // a subagent can work far longer than a Bash command
    expect(at({ idle: 25 * MIN, tools: [{ name: 'Agent', ago: 25 * MIN }] }).kind).toBe('ok')
  })

  it('warns, then restarts, only past the tool\'s own limit', () => {
    expect(at({ idle: 13 * MIN, tools: [{ name: 'Bash', ago: 13 * MIN }] })).toMatchObject({ kind: 'warn' })
    expect(at({ idle: 18 * MIN, tools: [{ name: 'Bash', ago: 18 * MIN }] })).toMatchObject({ kind: 'restart', reason: expect.stringContaining('Bash has been running for 18 min') })
  })

  it('silence with nothing running is still caught; waiting on you never is', () => {
    expect(at({ idle: STALL_WARN_MS + MIN }).kind).toBe('warn')
    expect(at({ idle: STALL_KILL_MS + MIN }).kind).toBe('restart')
    expect(at({ idle: 60 * MIN, waiting: 1 }).kind).toBe('ok')
  })
})

describe('dependencies and parallel safety', () => {
  it('a failed dependency blocks; a running one queues', () => {
    const tasks = [t('T1', { status: 'failed' }), t('T2', { dependsOn: ['T1'] }), t('T3', { status: 'running' }), t('T4', { dependsOn: ['T3'] })]
    expect(waitingReason(tasks[1], tasks, () => null)).toBe('Blocked: T1 needs attention first')
    expect(waitingReason(tasks[3], tasks, () => null)).toBe('Waiting on T3')
    // with names, the wait says whose work it is (clearer in the office than keys alone)
    const team = [t('T5', { status: 'running', assigneeId: 'maya' }), t('T6', { dependsOn: ['T5'], assigneeId: 'theo' })]
    expect(waitingReason(team[1], team, () => null, (id) => ({ maya: 'Maya', theo: 'Theo' })[id] ?? null)).toBe('Waiting for Maya to finish T5')
  })

  it('uses the files a running task actually changed, not just its plan (4 recorded tasks edited outside their plan)', () => {
    const running = t('T1', { status: 'running', files: ['public/form.js'], changedFiles: ['M public/js/detail.js'] })
    expect(touchedFiles(running)).toEqual(['public/form.js', 'public/js/detail.js'])
    expect(canRunBeside(t('T2', { files: ['public/js/detail.js'] }), [running])).toBe(false)
    expect(canRunBeside(t('T2', { files: ['server.js'] }), [running])).toBe(true)
  })

  it('explains a wait exactly as the scheduler decides it', () => {
    const tasks = [t('T1', { status: 'running', files: [] }), t('T2', { files: ['a.js'] }), t('T3', { status: 'running', files: ['b.js'] }), t('T4', { files: ['b.js'] })]
    expect(waitingReason(tasks[1], [tasks[0], tasks[1]], () => null)).toBe("Starts after T1: one of them has no planned files, so they can't safely overlap")
    expect(waitingReason(tasks[3], [tasks[2], tasks[3]], () => null)).toBe('Shares files with T3; starts after it to avoid conflicts')
    expect(canRunBeside(tasks[1], [tasks[0]])).toBe(false)
  })
})
