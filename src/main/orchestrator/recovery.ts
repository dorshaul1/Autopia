// Task recovery: what an interruption left behind and the one safe way to continue from it. Built only
// from verified facts (the task's own record and what git reports about its worktree and branch);
// nothing is assumed, and nothing destructive is ever replayed. Pure functions; the orchestrator
// gathers the facts and acts.

import type { Task, TaskRecovery } from '@shared/types'

export type InterruptReason = TaskRecovery['reason']

/** Errors that mean the work was cut off, not that it failed (it can continue where it stopped). */
export function interruptionFrom(error: string): InterruptReason | null {
  if (/No conversation found|session .* not found/i.test(error)) return 'resume_failed'
  if (/^Interrupted: Autopia was closed|Autopia was closed while/i.test(error)) return 'restart'
  if (/went to sleep|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network (error|connection)|connection (reset|closed|error)|fetch failed|API Error: (5\d\d|Connection)|overloaded_error/i.test(error)) return 'network'
  if (/^Claude Code exited \(code [^)]*\) without a result/i.test(error)) return 'cli_exit'
  return null
}

export const REASON_LABEL: Record<InterruptReason, string> = {
  restart: 'Autopia was closed while it was running',
  cli_exit: 'Claude Code stopped unexpectedly',
  network: 'The network connection dropped',
  usage_limit: 'Your Claude usage limit was reached',
  stalled: 'The session stopped responding',
  resume_failed: 'Claude Code no longer had the previous session',
  stopped: 'You stopped the work'
}

/** A few words for the teammate's status line. */
export const SHORT_REASON: Record<InterruptReason, string> = {
  restart: 'app closed',
  cli_exit: 'Claude Code stopped',
  network: 'network dropped',
  usage_limit: 'usage limit',
  stalled: 'stalled',
  resume_failed: 'session gone',
  stopped: 'stopped by you'
}

export interface GitFacts {
  /** The task's worktree directory exists. */
  worktree: boolean
  /** The task branch exists. */
  branch: boolean
  /** Commits on the task branch that the base branch doesn't have. */
  commits: number
  /** Uncommitted files in the worktree. */
  uncommitted: string[]
  /** The base branch already has this task's merge commit. */
  merged: boolean
}

/**
 * The single safe next step, in order of how much finished work it keeps:
 * already merged → just record it as done; work had passed its checks → integrate it (no AI);
 * worktree there with a resumable session → resume that session; branch kept but worktree gone →
 * re-attach it; work on disk but no session → a new session that starts from the verified state;
 * nothing kept → start again.
 */
export function nextStep(f: { stage: TaskRecovery['stage']; git: GitFacts | null; sessionId: string | null; sessionResumable: boolean | null }): TaskRecovery['next'] {
  const g = f.git
  if (g?.merged) return 'finish'
  if (f.stage === 'integrate' && (!g || g.worktree || (g.branch && g.commits > 0))) return 'integrate'
  const session = !!f.sessionId && f.sessionResumable !== false
  if (!g) return session ? 'resume' : 'continue'
  if (g.worktree) return session ? 'resume' : 'continue'
  if (g.branch && g.commits > 0) return 'reattach'
  return 'restart'
}

export const NEXT_LABEL: Record<TaskRecovery['next'], string> = {
  finish: 'Mark done',
  integrate: 'Finish merging',
  resume: 'Resume',
  reattach: 'Resume',
  continue: 'Continue',
  restart: 'Start again'
}

const list = (files: string[], n = 3) => `${files.slice(0, n).join(', ')}${files.length > n ? ` and ${files.length - n} more` : ''}`

/** What is preserved, in plain lines (only what git and the task record show). */
export function preservedLines(task: Pick<Task, 'resultSummary' | 'checks' | 'sessionId'>, f: { stage: TaskRecovery['stage']; git: GitFacts | null; sessionResumable: boolean | null; base: string | null }): string[] {
  const out: string[] = []
  const g = f.git
  if (g?.merged) out.push(`Already merged into ${f.base ?? 'the base branch'}; nothing needs to run again.`)
  if (g && !g.merged && g.commits > 0) out.push(`${g.commits} commit${g.commits === 1 ? '' : 's'} on the task branch`)
  if (g?.uncommitted.length) out.push(`Uncommitted changes in the task's worktree: ${list(g.uncommitted)}`)
  if (f.stage === 'integrate' && !g?.merged) out.push('The work had finished and passed its checks; only merging is left.')
  else if (task.checks.some((c) => c.status === 'passed')) out.push(`${task.checks.filter((c) => c.status === 'passed').length} check(s) had passed`)
  if (task.sessionId && f.sessionResumable !== false && (!g || g.worktree || g.branch)) out.push('The Claude Code session, to resume with its context')
  if (f.sessionResumable === false) out.push('The previous Claude Code session is gone; a new one starts from the files above.')
  if (g && !g.worktree && !g.branch && !g.merged) out.push('No files were kept from the previous attempt.')
  return out
}

/**
 * The record kept on an interrupted task. `count` counts interruptions in a row (reset when the task
 * finishes), so a task that keeps getting cut off stops being resumed automatically.
 */
export function recordFor(
  task: Pick<Task, 'resultSummary' | 'checks' | 'sessionId' | 'recovery'>,
  reason: InterruptReason,
  stage: TaskRecovery['stage'],
  git: GitFacts | null,
  base: string | null,
  now: number,
  sessionResumable: boolean | null = task.recovery?.sessionResumable ?? null
): TaskRecovery {
  return {
    reason,
    stage,
    at: now,
    count: (task.recovery?.count ?? 0) + 1,
    sessionId: task.sessionId,
    sessionResumable,
    git,
    preserved: preservedLines(task, { stage, git, sessionResumable, base }),
    next: nextStep({ stage, git, sessionId: task.sessionId, sessionResumable })
  }
}

/** The same record with fresh git facts (what is on disk now), keeping why and when it stopped. */
export function refresh(rec: TaskRecovery, task: Pick<Task, 'resultSummary' | 'checks' | 'sessionId'>, git: GitFacts | null, base: string | null): TaskRecovery {
  return {
    ...rec,
    git,
    sessionId: task.sessionId,
    preserved: preservedLines(task, { stage: rec.stage, git, sessionResumable: rec.sessionResumable, base }),
    next: nextStep({ stage: rec.stage, git, sessionId: task.sessionId, sessionResumable: rec.sessionResumable })
  }
}

/** Interrupted this many times in a row: stop resuming on its own and let you look first. */
export const AUTO_RESUME_LIMIT = 2

/** The approval text: why it stopped, what is kept, what Resume will do. */
export function recoveryBody(rec: TaskRecovery): string {
  const what: Record<TaskRecovery['next'], string> = {
    finish: 'Mark done records it as finished without running anything.',
    integrate: 'Finish merging commits and merges the finished work, with your uncommitted changes protected. No new Claude Code session.',
    resume: 'Resume continues the same Claude Code session in its worktree.',
    reattach: 'Resume re-attaches the kept branch as its worktree and continues from there.',
    continue: 'Continue starts a new Claude Code session from the files already in the worktree; finished parts are not redone.',
    restart: 'Start again begins the task from scratch.'
  }
  return [`${REASON_LABEL[rec.reason]}.`, rec.preserved.length ? `Preserved:\n${rec.preserved.map((l) => `• ${l}`).join('\n')}` : '', what[rec.next]].filter(Boolean).join('\n')
}

/**
 * The opening of a new session when the previous one could not be resumed: the task, plus only what is
 * verifiably there now (git's own summary of the worktree), so the agent continues instead of redoing.
 */
export function continuationNote(rec: Pick<TaskRecovery, 'reason'>, f: { base: string | null; diffStat: string; uncommitted: string[]; lastSummary: string | null; lastError: string | null }): string {
  return [
    `## Continuing interrupted work`,
    `This task was started before and stopped (${REASON_LABEL[rec.reason].toLowerCase()}). Its previous Claude Code session could not be resumed, so this is a new session in the same worktree.`,
    f.diffStat ? `What is already in this worktree compared with ${f.base ?? 'the base branch'} (from git):\n${f.diffStat}` : 'Git shows no changes in this worktree yet.',
    f.uncommitted.length ? `Uncommitted files: ${list(f.uncommitted, 12)}` : '',
    f.lastSummary ? `The previous attempt's last report: ${f.lastSummary}` : '',
    f.lastError && !/^Interrupted:/i.test(f.lastError) ? `It stopped with: ${f.lastError.split('\n')[0].slice(0, 300)}` : '',
    'Start by reviewing these existing changes. Keep what is correct, finish only what remains, then run the task checks. Do not revert or redo finished work, and do not run destructive commands to "start clean".'
  ]
    .filter(Boolean)
    .join('\n\n')
}
