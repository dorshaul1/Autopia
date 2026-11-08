import { plural } from '@shared/friendlyError'
// Delivery readiness from evidence only. Each dimension is verified, failed, not checked, blocked or
// not applicable; there is no numeric score. Work is "ready" only when every applicable dimension is
// verified; anything else needs your documented exception or is not ready.

import { VENDORED } from './audit'
import type { CheckResult, CompletionReport, Delivery, EvidenceStatus, QualityCorrection, QualityDimension, QualityException, QualityFinding, QualityReport, Readiness, RepairRecord, Run, Task } from '@shared/types'
import { classifyFindings, describeKey, recommendations, regradeLegacy } from './findings'
import { DIMENSION_LABEL } from './plan'
import { baseCheck, shortCommand, withoutSettled } from '@shared/checks'
import { COMPLETENESS_RULES } from '@shared/completeness'
import type { RuntimeEvidence } from '@shared/runtime'

const ORDER: QualityDimension[] = ['requirements', 'runtime', 'tests', 'static', 'build', 'security', 'accessibility', 'visual', 'interaction', 'design', 'performance', 'review']

/** Which dimension a check command provides evidence for. */
/** An unmet criterion the team owns: criteria about vendored files (dependencies, node_modules) are not the team's work. */
export function teamUnmet(c: { criterion: string; met: boolean }): boolean {
  return !c.met && !VENDORED.test(c.criterion) && !/\bnode_modules\b|vendored/i.test(c.criterion)
}

export function checkDimension(command: string): QualityDimension {
  if (/\blint|eslint|ruff|flake8|stylelint|prettier --check/.test(command)) return 'static'
  if (/type-?check|\btsc\b|mypy|pyright/.test(command)) return 'static'
  if (/\bbuild\b|cargo build|go build/.test(command)) return 'build'
  if (/\baudit\b|snyk|semgrep|bandit/.test(command)) return 'security'
  return 'tests'
}

/** Reads a file and reports what's there. Nothing runs, so a pass says nothing about whether the code works. */
export function isFileProbe(command: string): boolean {
  return /^(cd \S+ && )?(grep|egrep|fgrep|rg|cat|ls|head|tail|wc|stat|file|find|test|\[)(\s|$)/.test(command.trim())
}

/** A failure's identity without timings, paths and counters: equal signatures mean nothing changed. */
export function failureSignature(c: Pick<CheckResult, 'command' | 'output'>): string {
  const lines = c.output
    .split('\n')
    .filter((l) => /error|fail|✖|✗|assert|expected|exception|not ok|cannot|undefined|TypeError|SyntaxError/i.test(l))
    .map((l) =>
      l
        .replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '')
        .replace(/\(\d+(\.\d+)?ms\)/g, '')
        .replace(/:\d+:\d+/g, '')
        .replace(/\/[^\s:'"()]+\//g, '/')
        .replace(/0x[0-9a-f]+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 12)
  return `${c.command.trim()}|${lines.join('|')}`
}

/** Fewer automatic repairs for low-risk work, the configured maximum for the rest. */
export function repairBudget(risk: 'low' | 'normal' | 'high' | undefined, max: number): number {
  return risk === 'low' ? Math.min(1, max) : max
}

/** Unmet requirements compared as a set, so a repair that changes nothing is recognised. */
export function criteriaSignature(unmet: { criterion: string }[]): string {
  return `criteria:${unmet.map((c) => c.criterion.trim().toLowerCase()).sort().join('|')}`
}

/**
 * Whether another focused repair is allowed: never for a failure identical to the one the last repair
 * left behind, never past the budget. Returns why it stops, or null to repair.
 */
export function repairStopReason(signature: string, last: string | null, attempts: number, limit: number, what = 'The same failure'): string | null {
  if (last === signature) return `${what} remained after repair attempt ${attempts}; stopped instead of retrying blindly.`
  if (attempts >= limit) return `Repair budget used (${plural(limit, 'attempt')}).`
  return null
}

const worst = (a: EvidenceStatus, b: EvidenceStatus): EvidenceStatus => {
  const rank: Record<EvidenceStatus, number> = { failed: 0, blocked: 1, not_checked: 2, verified: 3, na: 4 }
  return rank[a] <= rank[b] ? a : b
}

export function readiness(
  delivery: Delivery,
  tasks: Task[],
  runs: Run[],
  reports: QualityReport[],
  exceptions: QualityException[],
  previewable: boolean,
  correction: QualityCorrection | null = null,
  runtime: RuntimeEvidence | null = null,
  /** Someone (a Claude Code session) really looked at the pictures: how many it was given. */
  designReview: { saw?: number; gaps?: unknown[]; distinctive?: boolean } | null = null
): Readiness {
  const own = tasks.filter((t) => t.deliveryId === delivery.id)
  const done = own.filter((t) => t.status === 'done')
  const status = new Map<QualityDimension, EvidenceStatus>()
  const applies = new Map<QualityDimension, boolean>()
  const evidence = new Map<QualityDimension, string[]>()
  const note = (d: QualityDimension, s: string) => evidence.set(d, [...(evidence.get(d) ?? []), s])
  const set = (d: QualityDimension, s: EvidenceStatus) => status.set(d, status.has(d) ? worst(status.get(d)!, s) : s)

  // what the plans said should be checked
  for (const t of own) for (const i of t.qualityPlan?.items ?? []) if (i.applies) applies.set(i.dimension, true)
  if (!own.some((t) => t.qualityPlan)) {
    // tasks from before quality planning: tests and security are always relevant to code work
    if (own.some((t) => t.kind !== 'design')) (applies.set('tests', true), applies.set('security', true))
    if (own.some((t) => t.kind === 'design') && previewable) (applies.set('visual', true), applies.set('accessibility', true))
  }
  applies.set('requirements', true)
  // interface work needs a visual check whenever the project can be previewed now, even if it couldn't
  // be when the task was planned (e.g. the first page didn't exist yet)
  if (previewable && own.some((t) => t.status === 'done' && t.kind === 'design')) (applies.set('visual', true), applies.set('accessibility', true))

  // real check results (latest per command per task)
  for (const t of done) {
    for (const c of withoutSettled(t.checks)) {
      // the same command really ran in the project folder and passed: a session not being allowed to run it says nothing
      if (c.status !== 'passed' && c.status !== 'failed' && runtime?.checks?.some((r) => r.status === 'passed' && baseCheck(r.command) === baseCheck(c.command))) continue
      const d = checkDimension(c.command)
      if (isFileProbe(c.command)) {
        // finding a string in a file passes without the code ever running: worth listing, never "tests verified"
        if (applies.get('tests')) note('tests', `${t.key}: \`${shortCommand(c.command)}\` only looks at a file, so it doesn't count as a test`)
        continue
      }
      applies.set(d, true)
      const s: EvidenceStatus = c.status === 'passed' ? 'verified' : c.status === 'failed' ? 'failed' : c.status === 'blocked' || c.status === 'denied' ? 'blocked' : 'not_checked'
      set(d, s)
      note(d, `${t.key}: \`${shortCommand(c.command)}\` ${c.status === 'missing' ? 'not run' : c.status}`)
    }
  }

  // requirements: every task finished, criteria reported met, and its checks passed
  const unfinished = own.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const skipped = own.filter((t) => t.status === 'cancelled')
  const criteria = done.flatMap((t) => t.criteria.map((c) => ({ ...c, taskKey: t.key })))
  // an unmet criterion is resolved by a later repair that names it and finished with passing checks;
  // criteria about vendored files are not the team's work
  const passing = (t: Task) => t.checks.length > 0 && t.checks.every((c) => c.status === 'passed')
  const supersededBy = (c: (typeof criteria)[number]) => {
    const from = done.find((t) => t.key === c.taskKey)
    return done.find((t) => t.key !== c.taskKey && passing(t) && (t.finishedAt ?? 0) > (from?.finishedAt ?? 0) && t.description.includes(c.criterion.slice(0, 80)))
  }
  // "run the tests and quote the output": what a session couldn't do because a command was declined. A real run settles it
  const provenByRun = runtime?.status === 'verified' && !runtime.notRunYet
  const onlyProcess = (c: { criterion: string; evidence?: string }) => /^(run|re-?run|confirm|inspect|quote|the project checks?)\b|\b(checks?|tests?) (still )?pass\b/i.test(c.criterion.trim()) || /\b(declined|denied|not (been )?(run|confirmed)|could ?n.?t run|was not run)\b/i.test(c.evidence ?? '')
  const unconfirmed = provenByRun ? criteria.filter((c) => teamUnmet(c) && !supersededBy(c) && onlyProcess(c)) : []
  for (const c of unconfirmed) note('requirements', `${c.taskKey}: "${c.criterion.slice(0, 80)}" couldn’t be confirmed in the session; Autopia ran the result for real instead`)
  const unmet = criteria.filter((c) => teamUnmet(c) && !supersededBy(c) && !unconfirmed.includes(c))
  for (const c of criteria.filter((x) => !x.met && supersededBy(x))) note('requirements', `${c.taskKey}: "${c.criterion.slice(0, 80)}" re-verified by ${supersededBy(c)!.key}`)
  const checksOk = (t: Task) => t.checks.length > 0 && t.checks.every((c) => c.status === 'passed')
  if (unfinished.length || unmet.length) set('requirements', 'failed')
  else if (skipped.length) set('requirements', 'not_checked')
  else if (done.length && done.every(checksOk)) set('requirements', 'verified')
  else set('requirements', 'not_checked')
  for (const t of unfinished) note('requirements', `${t.key} ${t.status}`)
  for (const t of skipped) note('requirements', `${t.key} skipped`)
  for (const c of unmet) note('requirements', `${c.taskKey}: not met: ${c.criterion}`)
  if (criteria.length && !unmet.length) note('requirements', `${criteria.length} acceptance criteria reported met (agent report; counted only with passing checks)`)

  // static audit and visual QA reports for this delivery (latest of each kind)
  const latest = (kind: QualityReport['kind']) => reports.find((r) => r.deliveryId === delivery.id && r.kind === kind && r.status !== 'running')
  const audit = latest('audit')
  const visual = latest('visual')
  // reports from before findings were graded are graded on read, under today's rules
  const graded = (fs: QualityFinding[]) => (fs.some((f) => !f.certainty) ? classifyFindings(fs.map(regradeLegacy), null, null) : fs)
  const auditFindings = graded(audit?.findings ?? [])
  const visualFindings = graded(visual?.findings ?? [])
  const findings: QualityFinding[] = [...auditFindings, ...visualFindings].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  // only a measured, serious defect this result is responsible for fails it; suspicions need a look
  const blocking = (f: QualityFinding) => f.severity === 'high' && f.certainty === 'verified' && f.inScope !== false
  const suspect = (f: QualityFinding) => f.severity === 'high' && f.certainty === 'suspected'
  if (audit?.status === 'done') {
    const sec = auditFindings.filter((f) => f.dimension === 'security')
    const nothingToAudit = !sec.length && /^0 file/.test(audit.note ?? '')
    set('security', nothingToAudit ? 'na' : sec.some(blocking) ? 'failed' : sec.some(suspect) ? 'not_checked' : 'verified')
    note('security', nothingToAudit ? 'Nothing to audit: this result ends up changing no files.' : sec.length ? `${plural(sec.length, 'static finding')}: ${sec.filter(blocking).length} verified high, ${sec.filter(suspect).length} suspected high to confirm` : `Static audit: no findings${audit.note ? ` (${audit.note})` : ''}`)
    const perf = auditFindings.filter((f) => f.dimension === 'performance')
    if (perf.length) note('performance', `${plural(perf.length, 'static pattern')} to review`)
  }
  if (visual) {
    if (visual.status === 'done') {
      applies.set('visual', true)
      applies.set('accessibility', true)
      for (const d of ['visual', 'accessibility'] as const) {
        const fs = visualFindings.filter((f) => f.dimension === d && f.severity !== 'info')
        set(d, fs.some(blocking) ? 'failed' : 'verified')
        const real = fs.filter((f) => f.certainty === 'verified')
        note(d, fs.length ? `${plural(real.length, 'measured finding')}${fs.length > real.length ? `, ${fs.length - real.length} unconfirmed` : ''} ${((w) => (w.length ? `at ${w.join('/')}px` : 'on the page'))([...new Set(fs.map((f) => f.width).filter(Boolean))])}` : `No issues at ${visual.shots.map((s) => s.width).join('/')}px`)
      }
      // measuring a page, using it and looking at it are three different claims
      const m = visual.metrics as { controlsFound?: number; controlsUsed?: number; pagesUsed?: number }
      if (m.controlsFound !== undefined) {
        const broken = visualFindings.filter((f) => COMPLETENESS_RULES.has(f.rule ?? '') && f.severity !== 'info')
        if (m.controlsFound > 0) {
          applies.set('interaction', true)
          // something that does nothing is never "verified", even when it isn't this change's to fix
          set('interaction', broken.some(blocking) ? 'failed' : broken.some((f) => f.certainty === 'verified' && f.severity !== 'low') || !m.controlsUsed ? 'not_checked' : 'verified')
          note('interaction', `Really used ${m.controlsUsed ?? 0} of ${m.controlsFound} controls on ${plural(m.pagesUsed ?? 1, 'page')}${broken.length ? `. ${broken.slice(0, 3).map((f) => f.message.replace(/\.$/, '')).join('. ')}` : ''}. Using them shows whether they respond, not whether they're pleasant.`)
        }
      }
      applies.set('design', true)
      if (designReview?.saw) {
        const high = visualFindings.filter((f) => f.rule === 'design-review' && f.severity === 'high' && f.inScope !== false)
        set('design', high.length ? 'failed' : 'verified')
        note('design', `A Claude Code session looked at ${plural(designReview.saw, 'real screenshot')}: ${designReview.gaps?.length ? plural(designReview.gaps.length, 'gap') : 'no gaps'}. It's one reviewer's judgement of still pictures.`)
      } else {
        set('design', 'not_checked')
        note('design', 'Layout was measured, but nobody has looked at how it looks.')
      }
      if (applies.get('performance') && visual.metrics.loadMs !== undefined) {
        set('performance', 'verified')
        note('performance', `Measured: load ${visual.metrics.loadMs} ms, ${visual.metrics.domNodes} DOM nodes, ${visual.metrics.transferKb} KB transferred`)
      }
    } else {
      for (const d of ['visual', 'accessibility'] as const) {
        if (!applies.get(d)) continue
        if (visual.status === 'skipped' && /not a page/.test(visual.note ?? '')) {
          applies.set(d, false)
          continue
        }
        set(d, visual.status === 'skipped' ? 'not_checked' : 'blocked')
        note(d, visual.error ?? visual.note ?? 'Not run')
      }
    }
  }

  // the real app, from the folder you run it in: checks that passed in a temporary worktree can't vouch for it
  if (runtime && !(runtime.notRunYet && visual?.status === 'done')) {
    applies.set('runtime', true)
    set('runtime', runtime.status)
    note('runtime', runtime.note)
    for (const d of runtime.details ?? []) note('runtime', d)
    for (const c of runtime.checks ?? []) {
      const dim = checkDimension(c.command)
      applies.set(dim, true)
      set(dim, c.status === 'passed' ? 'verified' : c.status)
      note(dim, `In the project folder: \`${shortCommand(c.command)}\` ${c.status}`)
    }
  }

  // independent review: only evidence is a reviewer subagent session
  const offered = runs.some((r) => own.some((t) => t.id === r.taskId) && r.skills?.subagents.includes('reviewer'))
  const reviewed = runs.some((r) => own.some((t) => t.id === r.taskId) && r.skills?.subagentsUsed?.includes('reviewer'))
  if (applies.get('review')) {
    set('review', reviewed ? 'verified' : 'not_checked')
    note('review', reviewed ? 'The reviewer subagent ran (recorded from the session)' : offered ? 'Reviewer was offered but not used' : 'No independent review ran')
  }

  const exByDim = new Map(exceptions.map((e) => [e.dimension, e.note]))
  const dimensions = ORDER.map((d) => {
    const a = !!applies.get(d)
    const s: EvidenceStatus = !a ? 'na' : (status.get(d) ?? 'not_checked')
    return { dimension: d, label: DIMENSION_LABEL[d], status: s, applies: a, evidence: evidence.get(d) ?? [], exception: exByDim.get(d) ?? null }
  })

  const open = dimensions.filter((d) => d.applies && d.status !== 'verified')
  const blockers = open.filter((d) => !d.exception).map((d) => `${d.label}: ${d.status === 'not_checked' ? 'not checked' : d.status}${d.evidence[0] ? ` (${d.evidence[0]})` : ''}`)
  const verdict: Readiness['verdict'] = !open.length
    ? 'ready'
    : open.every((d) => d.exception)
      ? 'ready_with_exceptions'
      : open.some((d) => d.status === 'failed')
        ? 'not_ready'
        : 'unverified'

  const repairs: RepairRecord[] = own
    .filter((t) => t.fixAttempts > 0 || t.repairStop)
    .map((t) => {
      const fixRuns = runs.filter((r) => r.taskId === t.id && (r.purpose === 'fix' || r.purpose === 'retry'))
      return {
        taskKey: t.key,
        taskTitle: t.title,
        attempts: t.fixAttempts,
        tokens: fixRuns.reduce((s, r) => s + (r.inputTokens ?? 0) + (r.outputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0), 0),
        ms: fixRuns.reduce((s, r) => s + ((r.endedAt ?? r.startedAt) - r.startedAt), 0),
        costUsd: fixRuns.reduce((s, r) => s + (r.costUsd ?? 0), 0),
        outcome: t.status === 'done' && t.checks.every((c) => c.status === 'passed') ? 'repaired' : t.status === 'running' ? 'in progress' : 'failed',
        stopReason: t.repairStop
      }
    })

  const completion = completionReport({ verdict, dimensions, unmet: unmet.length, unfinished: unfinished.length + skipped.length, findings, delivery, visualRan: visual?.status === 'done', auditRan: audit?.status === 'done', correction, checks: done.flatMap((t) => t.checks.map((c) => ({ ...c, key: t.key }))) })
  return { deliveryId: delivery.id, verdict, dimensions, criteria, blockers, repairs, findings, completion }
}

/**
 * What the result really is, in one status, with what was actually run, what failed, what was not
 * verified and what is known to be missing. Derived only from recorded evidence; an agent finishing
 * its turn is never evidence of anything.
 */
export function completionReport(x: {
  verdict: Readiness['verdict']
  dimensions: Readiness['dimensions']
  unmet: number
  unfinished: number
  findings: QualityFinding[]
  delivery: Pick<Delivery, 'limitations'>
  visualRan: boolean
  auditRan: boolean
  correction: QualityCorrection | null
  checks: (CheckResult & { key: string })[]
}): CompletionReport {
  const applicable = x.dimensions.filter((d) => d.applies)
  const latest = new Map<string, CheckResult & { key: string }>()
  for (const c of x.checks) latest.set(c.command, c)
  const tested = [...latest.values()].map((c) => `\`${shortCommand(c.command)}\` ${c.status === 'missing' ? 'not run' : c.status}`)
  if (x.auditRan) tested.push('Static audit of the changed code')
  if (x.visualRan) tested.push('Layout and accessibility measured on the running app at 375/768/1280 px')
  const inScopeDefect = (f: QualityFinding) => f.certainty === 'verified' && f.inScope !== false && f.severity !== 'info'
  const failed = [
    ...[...latest.values()].filter((c) => c.status === 'failed').map((c) => `\`${shortCommand(c.command)}\` failed (${c.key})`),
    ...x.findings.filter((f) => inScopeDefect(f) && f.severity === 'high').map((f) => `${f.message}${f.file ? ` (${f.file})` : ''}`)
  ]
  const unverified = applicable.filter((d) => d.status === 'not_checked' || d.status === 'blocked').map((d) => `${d.label}: ${d.exception ? `accepted by you (${d.exception})` : (d.evidence[0] ?? 'not checked')}`)
  const out = x.correction?.outcome
  const limitations = [
    ...(x.delivery.limitations ?? []),
    ...x.findings.filter((f) => inScopeDefect(f) && f.severity === 'medium').slice(0, 3).map((f) => `${f.message}${f.file ? ` (${f.file})` : ''}`),
    ...x.findings.filter((f) => f.certainty === 'suspected' && f.severity === 'high').slice(0, 3).map((f) => `To confirm: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`),
    ...(out?.remaining.length ? [`The automatic fix did not resolve: ${out.remaining.map(describeKey).join(', ')}`] : []),
    ...(out?.introduced.length ? [`The automatic fix introduced: ${out.introduced.map(describeKey).join(', ')}`] : [])
  ]
  const blocked = applicable.some((d) => d.status === 'blocked' && !d.exception)
  const status: CompletionReport['status'] = failed.length || (x.verdict === 'not_ready' && applicable.some((d) => d.status === 'failed' && d.dimension !== 'requirements'))
    ? 'failed'
    : x.unmet || x.unfinished
      ? 'partial'
      : blocked
        ? 'blocked'
        : unverified.length || limitations.length
          ? 'limited'
          : 'verified'
  const headline = {
    verified: 'Verified: every applicable check ran and passed.',
    limited: 'Done, with limitations: what passed is verified; the rest is listed below.',
    partial: `Partly done: ${x.unmet ? `${plural(x.unmet, 'requirement')} not met` : ''}${x.unmet && x.unfinished ? ', ' : ''}${x.unfinished ? `${plural(x.unfinished, 'task')} not finished` : ''}.`,
    blocked: 'Blocked: some checks could not run (policy or a declined permission).',
    failed: 'Failed: checks or measured defects show it does not work as required yet.'
  }[status]
  return { status, headline, tested, failed, unverified, limitations, recommendations: recommendations(x.findings), correction: x.correction }
}
