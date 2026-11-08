// Regression attribution: before a failing check sends an agent into repair, decide from recorded
// evidence whether the failure is this change's doing. Deterministic; no AI, no extra command runs.

import type { BashEvidence } from '@shared/checks'
import type { CheckResult } from '@shared/types'
import { failureSignature } from './readiness'

export type FailureKind = 'introduced' | 'pre_existing' | 'environment' | 'flaky' | 'unknown'

export interface FailureClass {
  kind: FailureKind
  /** The evidence the classification rests on, in words. */
  evidence: string
}

/** A check outcome recorded before this task started (validation history, earlier tasks' checks). */
export interface BaselineCheck {
  command: string
  status: CheckResult['status']
  output: string
  at: number
  /** Where it was recorded, for the explanation (e.g. "T3", "a validation"). */
  source: string
}

// the machine, not the code: busy ports, network, disk, permissions, killed processes
const ENVIRONMENT = /EADDRINUSE|address already in use|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|socket hang up|ENOSPC|No space left|EMFILE|Too many open files|EACCES|EPERM|operation not permitted|Killed|SIGKILL|out of memory|JavaScript heap out of memory/i

const norm = (c: string) => c.replace(/\s+/g, ' ').trim().replace(/\s+2>&1$/, '')

/**
 * - environment: the output names a machine problem (port in use, network, disk, permissions).
 * - flaky: the same command passed earlier in this session with no file edited in between.
 * - pre_existing: the latest recorded run of the command before this task began failed the same way.
 * - introduced: the latest recorded run before this task passed (the change broke it).
 * - unknown: no baseline; treated as this change's (the existing repair path).
 */
export function classifyFailure(failed: Pick<CheckResult, 'command' | 'output'>, ctx: { baseline: BaselineCheck[]; session: BashEvidence[]; edits: number[]; taskStartedAt: number }): FailureClass {
  const env = ENVIRONMENT.exec(failed.output)
  if (env) return { kind: 'environment', evidence: `the output points at the machine, not the code ("${env[0]}")` }

  const runs = ctx.session.filter((b) => norm(b.command) === norm(failed.command) && !b.founderDenied && !b.policyDenied).sort((a, b) => a.at - b.at)
  const lastFail = [...runs].reverse().find((b) => b.isError)
  const passBefore = lastFail ? [...runs].reverse().find((b) => !b.isError && b.at < lastFail.at) : undefined
  if (lastFail && passBefore && !ctx.edits.some((t) => t > passBefore.at && t < lastFail.at)) {
    return { kind: 'flaky', evidence: 'it passed earlier in this session and then failed with no file edited in between' }
  }

  const before = ctx.baseline.filter((b) => norm(b.command) === norm(failed.command) && b.at < ctx.taskStartedAt && (b.status === 'passed' || b.status === 'failed')).sort((a, b) => b.at - a.at)[0]
  if (before?.status === 'failed' && failureSignature(before) === failureSignature(failed)) {
    return { kind: 'pre_existing', evidence: `it already failed the same way before this work started (${before.source})` }
  }
  if (before?.status === 'passed') return { kind: 'introduced', evidence: `it passed before this work started (${before.source})` }
  return { kind: 'unknown', evidence: 'no earlier run of this command to compare with' }
}

/** Only failures this change plausibly caused send the agent into repair. */
export const repairable = (k: FailureKind) => k === 'introduced' || k === 'unknown'
