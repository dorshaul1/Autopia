import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Task } from '../src/shared/types'
import { diagnose } from '../src/main/director/blockers'
import * as git from '../src/main/git/git'
import { continuationNote, interruptionFrom, nextStep, recordFor, recoveryBody, refresh, type GitFacts } from '../src/main/orchestrator/recovery'

const base: Pick<Task, 'resultSummary' | 'checks' | 'sessionId' | 'recovery'> = { resultSummary: null, checks: [], sessionId: 'sess-1', recovery: null }
const facts = (f: Partial<GitFacts> = {}): GitFacts => ({ worktree: true, branch: true, commits: 0, uncommitted: [], merged: false, ...f })

describe('interrupted is not failed', () => {
  it('names real interruptions and leaves genuine failures alone', () => {
    expect(interruptionFrom('Interrupted: Autopia was closed while this task was running')).toBe('restart')
    expect(interruptionFrom('Claude Code exited (code 143) without a result')).toBe('cli_exit')
    expect(interruptionFrom('Claude Code exited (code null) without a result: socket hang up')).toBe('network')
    expect(interruptionFrom('API Error: Connection error.')).toBe('network')
    expect(interruptionFrom('No conversation found with session ID: 1234')).toBe('resume_failed')
    expect(interruptionFrom('`npm test` failed: 2 tests failing')).toBeNull()
    expect(interruptionFrom('Blocked: which database should I use?')).toBeNull()
  })
})

describe('the one safe next step keeps the most finished work', () => {
  it('already merged: only record it as done (no duplicate merge or commit)', () => {
    expect(nextStep({ stage: 'integrate', git: facts({ merged: true, worktree: false, branch: false }), sessionId: 's', sessionResumable: null })).toBe('finish')
  })
  it('stopped while merging verified work: integrate it without a new Claude Code session', () => {
    expect(nextStep({ stage: 'integrate', git: facts({ commits: 1 }), sessionId: 's', sessionResumable: null })).toBe('integrate')
  })
  it('worktree there: resume the session, or continue in a new one if Claude Code no longer has it', () => {
    expect(nextStep({ stage: 'work', git: facts({ uncommitted: ['a.ts'] }), sessionId: 's', sessionResumable: null })).toBe('resume')
    expect(nextStep({ stage: 'work', git: facts(), sessionId: 's', sessionResumable: false })).toBe('continue')
    expect(nextStep({ stage: 'work', git: facts(), sessionId: null, sessionResumable: null })).toBe('continue')
  })
  it('worktree gone but branch kept: re-attach it; nothing kept: start again', () => {
    expect(nextStep({ stage: 'work', git: facts({ worktree: false, commits: 2 }), sessionId: 's', sessionResumable: null })).toBe('reattach')
    expect(nextStep({ stage: 'work', git: facts({ worktree: false, branch: false }), sessionId: 's', sessionResumable: null })).toBe('restart')
  })
  it('projects without git resume in place', () => {
    expect(nextStep({ stage: 'work', git: null, sessionId: 's', sessionResumable: null })).toBe('resume')
  })
})

describe('the recovery record', () => {
  it('says what is preserved, only from facts', () => {
    const rec = recordFor({ ...base, checks: [{ command: 'npm test', status: 'passed' } as never] }, 'restart', 'work', facts({ commits: 2, uncommitted: ['src/a.ts', 'src/b.ts'] }), 'main', 1)
    expect(rec.preserved).toEqual(['2 commits on the task branch', "Uncommitted changes in the task's worktree: src/a.ts, src/b.ts", '1 check(s) had passed', 'The Claude Code session, to resume with its context'])
    expect(rec.next).toBe('resume')
    expect(recoveryBody(rec)).toMatch(/^Autopia was closed while it was running\.\nPreserved:\n• 2 commits/)
  })

  it('counts interruptions in a row; the director stops resuming a crash loop', () => {
    const once = recordFor(base, 'cli_exit', 'work', facts(), 'main', 1)
    const twice = recordFor({ ...base, recovery: once }, 'cli_exit', 'work', facts(), 'main', 2)
    expect([once.count, twice.count]).toEqual([1, 2])
    const task = { status: 'interrupted' as const, lastError: 'Interrupted: Claude Code stopped unexpectedly.', repairStop: null }
    expect(diagnose({ ...task, recovery: once }, null).autoAction).toBe('resume')
    expect(diagnose({ ...task, recovery: twice }, null)).toMatchObject({ kind: 'interrupted', autoAction: null })
  })

  it('a session Claude Code no longer has is never claimed as restored', () => {
    const rec = refresh({ ...recordFor(base, 'resume_failed', 'work', null, 'main', 1), sessionResumable: false }, base, facts({ uncommitted: ['x.ts'] }), 'main')
    expect(rec.next).toBe('continue')
    expect(rec.preserved).toContain('The previous Claude Code session is gone; a new one starts from the files above.')
    expect(rec.preserved.join(' ')).not.toMatch(/to resume with its context/)
    const note = continuationNote(rec, { base: 'main', diffStat: ' src/x.ts | 4 ++--', uncommitted: ['x.ts'], lastSummary: null, lastError: null })
    expect(note).toMatch(/could not be resumed, so this is a new session in the same worktree/)
    expect(note).toMatch(/Do not revert or redo finished work/)
  })

  it('a usage-limit pause is not resumed by the director', () => {
    const d = diagnose({ status: 'interrupted', lastError: 'Paused at your Claude usage limit (resets Tue 17:00)', repairStop: null, recovery: recordFor(base, 'usage_limit', 'work', null, null, 1) }, null)
    expect(d.autoAction).toBeNull()
  })
})

// Real git, in a temporary repository: the facts recovery relies on, and that re-attaching never resets work.
describe('worktree recovery against a real repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopia-recovery-'))
  const repo = join(root, 'repo')
  const wt = join(root, 'wt')
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', ...args], { cwd, stdio: 'pipe' }).toString().trim()
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('reports commits, uncommitted files and merges; re-attaches a kept branch with its work', { timeout: 120_000 }, async () => {
    execFileSync('mkdir', ['-p', repo])
    sh(repo, 'init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    sh(repo, 'add', '-A')
    sh(repo, 'commit', '-q', '-m', 'init')

    await git.createWorktree(repo, wt, 'autopia/t1', 'main')
    writeFileSync(join(wt, 'a.ts'), 'export const a = 1\n')
    sh(wt, 'add', '-A')
    sh(wt, 'commit', '-q', '-m', 'T1: work')
    writeFileSync(join(wt, 'b.ts'), 'export const b = 2\n')

    expect(await git.branchExists(repo, 'autopia/t1')).toBe(true)
    expect(await git.commitsAhead(repo, 'main', 'autopia/t1')).toBe(1)
    expect(await git.uncommittedFiles(wt)).toEqual(['b.ts'])
    expect(await git.hasMergeCommit(repo, 'main', 'Merge T1: Add a')).toBe(false)

    // the worktree directory disappears (e.g. cleaned up); the branch and its commit remain
    await git.removeWorktreeKeepBranch(repo, wt)
    expect(existsSync(wt)).toBe(false)
    await git.attachWorktree(repo, wt, 'autopia/t1')
    expect(existsSync(join(wt, 'a.ts'))).toBe(true)
    expect(await git.commitsAhead(repo, 'main', 'autopia/t1')).toBe(1)

    // merged, then cut off before it was recorded: the merge commit is found, so nothing runs again
    await git.mergeIntoBase(repo, 'main', 'autopia/t1', 'Merge T1: Add a')
    expect(await git.hasMergeCommit(repo, 'main', 'Merge T1: Add a')).toBe(true)
  }, 30_000)
})
