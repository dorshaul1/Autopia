import { clip } from '@shared/friendlyError'
// Deterministic blocker diagnosis: what actually stopped a task, whether the director may resolve it
// on its own (bounded, once per distinct blocker), and what to recommend when the CEO must decide.
// Security and permission boundaries are never resolved automatically.

import type { Approval, ApprovalDecision, BlockerDiagnosis, Task } from '@shared/types'
import { AUTO_RESUME_LIMIT, REASON_LABEL } from '../orchestrator/recovery'

const first = (s: string) =>
  clip(
    s
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 3) ?? s,
    400
  )

export function diagnose(task: Pick<Task, 'status' | 'lastError' | 'repairStop'> & { recovery?: Task['recovery'] }, approval: Pick<Approval, 'kind' | 'body'> | null): BlockerDiagnosis {
  const err = task.lastError ?? approval?.body ?? ''
  const d = (kind: BlockerDiagnosis['kind'], reason: string, recommendation: string | null, autoAction: BlockerDiagnosis['autoAction'] = null): BlockerDiagnosis => ({
    kind,
    summary: first(err) || 'No error text recorded',
    autoAction,
    reason,
    recommendation
  })

  // checked before everything else: the quoted error would otherwise match a rule with an automatic retry
  if (/^Stopped: the agent ran .* times with the same error/i.test(err)) {
    return d('repeated_failure', 'The agent kept repeating the same failing command instead of changing approach, so Autopia stopped it. Its work so far is kept.', 'Read the error, then retry with a hint about what to change, or skip the task.')
  }
  if (approval?.kind === 'budget' || /budget limit reached|project budget/i.test(err)) {
    return d('budget', 'Spending more needs your approval.', 'Raise the budget if the remaining work is worth it, or keep the project paused.')
  }
  if (approval?.kind === 'unverified') {
    return d('unverified', 'Required checks could not run, so the work cannot count as verified.', 'Retry if the cause was temporary; accept only if you can verify it another way.')
  }
  if (/denied|blocked by (your )?(organization|policy)|requires approval|declined/i.test(err) && !/merge/i.test(err)) {
    return d('policy', 'A permission boundary stopped it. Autopia never works around permission policy.', 'Allow the command in your Claude Code policy if it is safe, or skip the task.')
  }
  if (/uncommitted changes|never overwrites your work/i.test(err)) {
    return d('user_changes', 'Your own uncommitted edits touch the same files; Autopia will not overwrite them.', 'Commit or stash your changes, then retry.')
  }
  if (/Claude Code CLI is not available|claude: command not found|not logged in|please run \/login/i.test(err)) {
    return d('cli_unavailable', 'Claude Code is not available or not signed in.', 'Sign in on Home, or run claude in a terminal, then press Try again.')
  }
  if (/Stalled twice/i.test(err)) {
    return d('stalled', 'The session went silent twice; something it runs probably never exits (often a dev server started in the foreground). Resuming again would repeat it.', 'Retry with a note to run servers in the background with a timeout, or skip the task.')
  }
  // Waiting for the Claude plan to reset: never retried automatically from here (the orchestrator
  // continues it after the reset only if you turned that on).
  if (/paused at your Claude usage limit/i.test(err)) {
    return d('usage_limit', 'Paused at your Claude plan limit. It continues when the limit resets.', 'Continue from the usage indicator after the reset time.')
  }
  // cut off again and again (a crash loop): stop resuming on its own and let you look first
  if (task.status === 'interrupted' && (task.recovery?.count ?? 0) >= AUTO_RESUME_LIMIT) {
    return d('interrupted', `Interrupted ${task.recovery!.count} times in a row. Its work is kept, but Autopia stopped resuming it on its own.`, 'Review what is preserved, then Resume or cancel the task.')
  }
  if (/^Interrupted:|was closed while|went to sleep|ECONNRESET|socket hang up|network (error|connection)|connection (reset|closed)|ETIMEDOUT/i.test(err) || task.status === 'interrupted') {
    const rec = task.status === 'interrupted' ? task.recovery : null
    const how: Record<NonNullable<typeof rec>['next'], string> = {
      finish: 'It was already merged; Mark done records it without running anything.',
      integrate: 'The work had passed its checks; only the merge is left (no new Claude Code session).',
      resume: 'It can resume in the same Claude Code session and worktree.',
      reattach: 'Its branch was kept; Resume re-attaches it and continues the same session.',
      continue: 'Its files are kept; Continue starts a new Claude Code session from them.',
      restart: 'Nothing was kept, so it starts again.'
    }
    return d('interrupted', rec ? `${REASON_LABEL[rec.reason]}: interrupted, not failed. ${how[rec.next]}` : 'The session was interrupted, not failed. It can resume in the same Claude Code session and worktree.', null, 'resume')
  }
  if (/Merge conflicts? with|Could not resolve conflicts/i.test(err)) {
    return d('merge_conflict', 'Automatic conflict resolution already ran within its limit.', 'Resolve the conflict on the preserved task branch, or skip the task and re-plan that area.')
  }
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|command not found: (vite|jest|vitest|tsc|eslint|mocha|next)|No module named|sh: \S+: command not found/i.test(err)) {
    return d('missing_dependency', 'A declared dependency is not installed.', 'Retry after installing dependencies.', 'install_and_retry')
  }
  if (/^Blocked:|needs_input|unclear|which (one|option)|not specified/i.test(err)) {
    return d('requirements', 'The agent could not proceed without a product decision.', 'Answer the question in the task, or adjust the brief.')
  }
  if (/\b(build|tsc|typecheck|type-check|compile)\b[^\n]*fail|error TS\d+|SyntaxError|Build failed/i.test(err)) {
    return d('build_failure', task.repairStop ?? 'The build still fails after bounded repair.', 'Look at the error; retry with a hint, or skip and re-plan.')
  }
  if (/\btest|assert|expected|✖|not ok|failing/i.test(err)) {
    return d('test_failure', task.repairStop ?? 'Tests still fail after bounded repair.', 'Read the failing test; retry with a hint about the intended behaviour, or skip.')
  }
  return d('unknown', 'No safe automatic action applies.', 'Open the task and its activity log to decide.')
}

/** Identity of a blocker so the director never repeats the same automatic action on unchanged evidence. */
export function blockerKey(taskId: string, b: BlockerDiagnosis): string {
  return `${taskId}:${b.kind}:${b.summary.replace(/\d+/g, '#').slice(0, 120)}`
}

/** The founder's answer to a teammate's question while auto mode is on (they decide and say so). */
export const AUTO_ANSWER = 'Auto mode is on, so the founder is not answering questions right now. Choose the most sensible option yourself, state the assumption in your summary, and continue.'

/**
 * What auto mode decides for a waiting approval. Everything Autopia itself asks has an answer;
 * Claude Code's permission prompts (your Claude Code / organization policy) never do. Blocked tasks
 * go through `diagnose` (bounded retries), and old budget approvals simply close elsewhere.
 */
export function autoDecision(kind: Approval['kind']): ApprovalDecision | null {
  switch (kind) {
    case 'plan':
      return { kind: 'plan', action: 'approve' }
    case 'question':
      return { kind: 'question', answer: AUTO_ANSWER }
    case 'unverified':
      return { kind: 'unverified', action: 'accept' }
    default:
      return null
  }
}
