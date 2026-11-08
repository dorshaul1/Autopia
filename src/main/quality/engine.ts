import { environmentOf } from '../environment'
import { plural } from '@shared/friendlyError'
// The quality engine: runs the deterministic audits when a delivery reaches review, keeps their
// reports, and derives readiness from evidence. It reuses the existing check evidence, preview and
// revision flow instead of adding parallel infrastructure. No AI calls are made here.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PushEvent } from '@shared/ipc'
import type { Delivery, Project, QualityCorrection, QualityDimension, QualityFinding, QualityOverview, QualityReport, Readiness } from '@shared/types'
import type { Repo } from '../db/repo'
import { changeSet } from '../git/review'
import { detectPreview, type PreviewManager, hasPage } from '../preview'
import { auditDiff, VENDORED, wholeFiles } from './audit'
import { brokenImports, importsOfDeleted, indexRepository, scanSources, type FileScan } from '../memory/indexer'
import { classifyFindings, correctable, correctionOutcome, findingKeys } from './findings'
import { readiness } from './readiness'
import { runtimeEvidence } from '@shared/runtime'
import { nextStep, repairBrief, verificationSignature, type DeliveryVerification, type VerificationStep } from '@shared/delivery'
import { resolveLoginEnv } from '../claude/cli'
import { deniedByPolicy } from '../preview'
import { head as gitHead } from '../git/review'
import { probeRender } from './probe'
import { commandsFor, quickChecks, runSelfChecks, runVerification } from './verify'
import { dependencyState } from '../deps'
import { runVisualQa } from './visual'
import { probeInteractions } from './interactions'
import { COMPLETENESS_RULES, completenessFindings, probeSummary } from '@shared/completeness'
import { COMPLETENESS_ON } from '../product/product'
import { EXPERTISE_ON, type DesignGap } from '../skills/expertise'
import { directionFindings } from './direction'

/** The project's own sources, plus its page and style files, within reason. */
function readSources(root: string, mapped: Map<string, unknown>): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const take = (path: string) => {
    try {
      out.push({ path, text: readFileSync(join(root, path), 'utf8') })
    } catch {
      // gone or unreadable: nothing to measure
    }
  }
  for (const f of [...mapped.keys()].slice(0, 400)) take(f)
  const walk = (dir: string, depth: number) => {
    for (const name of readdirSync(join(root, dir || '.'))) {
      if (name.startsWith('.') || /^(node_modules|dist|build|out|coverage|vendor)$/.test(name) || out.length > 500) continue
      const rel = dir ? `${dir}/${name}` : name
      if (statSync(join(root, rel)).isDirectory()) {
        if (depth < 6) walk(rel, depth + 1)
      } else if (/\.(html?|css|scss|vue|svelte)$/.test(name)) take(rel)
    }
  }
  try {
    walk('', 0)
  } catch {
    // an unreadable folder just means less to measure
  }
  return out
}

export interface QualityHooks {
  /** Shows the QA engineer at work in the office while an audit runs; returns a release function. */
  busy(projectId: string, detail: string): () => void
  /** Sends verified defects back for one focused correction; returns its task key, or null if it cannot run now. */
  correct(project: Project, d: Delivery, findings: QualityFinding[]): string | null
  /** A creative director's look at the real screenshots, for products with a direction; [] otherwise. */
  designReview(project: Project, d: Delivery, shots: string[]): Promise<DesignGap[]>
  /** Asks you once per project to OK the exact commands verification runs. */
  askToVerify(project: Project, d: Delivery, commands: string[], early?: boolean): void
  /** Whether an automatic repair could start right now. */
  canRepair(project: Project): boolean
  /** Sends a measured failure to the team; null if nobody can take it. */
  repairVerification(project: Project, d: Delivery, brief: string): string | null
}

export type VerifyOutcome = 'verified' | 'fixing' | 'failed' | 'blocked' | 'waiting'
interface VerifyConsent {
  commands: string[]
  declined?: boolean
}

const UI_FILE = /\.(html?|css|scss|less|[jt]sx|vue|svelte)$/i

/** Could this file change what someone sees? Tests, docs and project config can't. */
export const reachesThePage = (file: string): boolean => !/(^|\/)(tests?|__tests__|docs?|scripts)\/|\.(test|spec)\.|\.(md|txt|lock)$|(^|\/)(package(-lock)?\.json|\.gitignore|LICENSE)$/i.test(file)

export class QualityEngine {
  private running = new Set<string>()

  constructor(
    private repo: Repo,
    private preview: PreviewManager,
    private emit: (e: PushEvent) => void,
    private hooks: QualityHooks
  ) {}

  private save(r: QualityReport): QualityReport {
    this.repo.saveQualityReport(r)
    this.emit({ type: 'quality', report: r })
    return r
  }

  private begin(project: Project, deliveryId: string | null, kind: QualityReport['kind']): QualityReport {
    return this.save({ id: randomUUID(), projectId: project.id, deliveryId, kind, status: 'running', findings: [], metrics: {}, shots: [], note: null, error: null, startedAt: Date.now(), endedAt: null })
  }

  private consent(projectId: string): VerifyConsent | null {
    return this.repo.meta<VerifyConsent>(`verify-consent:${projectId}`)
  }

  private record(d: Delivery, v: DeliveryVerification): Delivery {
    const updated = this.repo.updateDelivery(d.id, { verification: v })
    this.emit({ type: 'delivery', delivery: updated })
    return updated
  }

  /**
   * The gate before anything is called done: runs the result for real in the project folder. Decides what
   * happens next from what it measured; the team is only called when something real failed, and a repair
   * that changes nothing ends the loop.
   */
  async verify(project: Project, d: Delivery): Promise<VerifyOutcome> {
    const commit = project.gitEnabled ? await gitHead(project.path).catch(() => null) : null
    const prior = d.verification
    const base = { commit, attempts: prior?.attempts ?? 0, signature: prior?.signature ?? null, at: Date.now() }
    // the same commit already passed: running it again would prove nothing new
    const same = commit && this.repo.deliveries(project.id).find((x) => x.verification?.state === 'verified' && x.verification.commit === commit)
    if (same) {
      this.record(d, { ...same.verification!, attempts: base.attempts, at: Date.now() })
      return 'verified'
    }
    const consent = this.consent(project.id)
    if (consent?.declined) {
      const detail = 'You chose not to let Autopia run it, so it isn’t verified.'
      this.record(d, { ...base, state: 'blocked', reason: detail, steps: [{ id: 'config', label: 'Run for real', status: 'blocked', command: null, detail, ms: 0 }] })
      return 'blocked'
    }
    const wanted = commandsFor(project, this.preview.info(project)).filter((c) => !deniedByPolicy(c))
    if (wanted.some((c) => !consent?.commands.includes(c))) {
      this.record(d, { ...base, state: 'verifying', steps: [], reason: 'Waiting for your OK to run it.' })
      this.hooks.askToVerify(project, d, wanted)
      return 'waiting'
    }
    this.record(d, { ...base, state: 'verifying', steps: [], reason: null })
    const release = this.hooks.busy(project.id, 'Running the result for real')
    let steps: VerificationStep[]
    try {
      steps = await runVerification(
        project,
        {
          preview: this.preview,
          probe: probeRender,
          env: resolveLoginEnv,
          onStep: (s) => this.record(this.repo.delivery(d.id), { ...base, state: 'verifying', steps: s, reason: null })
        },
        deniedByPolicy
      )
    } finally {
      release()
    }
    const limit = this.repo.settings().maxFixAttempts
    const next = nextStep({ steps, attempts: base.attempts, limit, lastSignature: base.signature, canRepair: this.hooks.canRepair(project) })
    if (next.state === 'fixing') {
      const fresh = this.record(this.repo.delivery(d.id), { ...base, state: 'fixing', steps, attempts: base.attempts + 1, signature: verificationSignature(steps), reason: null })
      if (this.hooks.repairVerification(project, fresh, repairBrief(steps, d.number))) return 'fixing'
      this.record(fresh, { ...fresh.verification!, state: 'failed', attempts: base.attempts, reason: 'It failed, and no teammate can take the repair right now.' })
      return 'failed'
    }
    this.record(this.repo.delivery(d.id), { ...base, state: next.state, steps, reason: next.reason })
    return next.state
  }

  /** Asks once, up front, so nobody has to stop and ask for each test run later. */
  askEarly(project: Project, d: Delivery): void {
    const consent = this.consent(project.id)
    if (consent?.declined) return
    const wanted = commandsFor(project, this.preview.info(project)).filter((c) => !deniedByPolicy(c))
    if (wanted.some((c) => !consent?.commands.includes(c))) this.hooks.askToVerify(project, d, wanted, true)
  }

  /**
   * A new project's commands only exist once its foundation does: asks about those, and gives you a minute to
   * answer. If you're away the work carries on and the question stays; nothing runs without your OK.
   */
  async askForFoundation(project: Project, d: Delivery, dir: string): Promise<void> {
    const consent = this.consent(project.id)
    if (consent?.declined) return
    const local = { ...project, path: dir }
    const wanted = [...new Set([...commandsFor(local, this.preview.info(local)), ...quickChecks(dir, true)])].filter((c) => !deniedByPolicy(c))
    if (!wanted.some((c) => !consent?.commands.includes(c))) return
    this.hooks.askToVerify(project, d, wanted, true)
    const until = Date.now() + 60_000
    while (Date.now() < until && !this.consent(project.id)?.commands.some((c) => wanted.includes(c)) && !this.consent(project.id)?.declined) await new Promise((r) => setTimeout(r, 500))
  }

  /** Which of this working copy's declared checks you've OK'd Autopia to run. Your organization's denials still hold. */
  selfChecks(project: Project, dir: string, withBuild = false): string[] {
    const consent = this.consent(project.id)
    if (!consent || consent.declined) return []
    return quickChecks(dir, withBuild).filter((c) => consent.commands.includes(c) && !deniedByPolicy(c))
  }

  runSelfChecks(project: Project, dir: string, commands: string[]) {
    return resolveLoginEnv().then((env) => runSelfChecks(project, dir, commands, env, deniedByPolicy))
  }

  /** Whether you've already said yes to running this exact command in this project. */
  mayRunCommand(projectId: string, command: string): boolean {
    const c = this.consent(projectId)
    return !!c && !c.declined && c.commands.includes(command)
  }

  /** You OK'd the commands, or declined: both are remembered for this project. */
  setVerifyConsent(projectId: string, commands: string[], allowed: boolean): void {
    const had = this.consent(projectId)?.commands ?? []
    this.repo.setMeta(`verify-consent:${projectId}`, { commands: allowed ? [...new Set([...had, ...commands])] : had, declined: !allowed } satisfies VerifyConsent)
  }

  /** You OK'd one exact command by itself. Whether verification may run is a separate answer, so that stays as it was. */
  allowCommand(projectId: string, command: string): void {
    const had = this.consent(projectId)
    this.repo.setMeta(`verify-consent:${projectId}`, { commands: [...new Set([...(had?.commands ?? []), command])], declined: had?.declined ?? false } satisfies VerifyConsent)
  }

  commandAllowed(projectId: string, command: string): boolean {
    return !!this.consent(projectId)?.commands.includes(command)
  }

  /** Static audit of what the delivery added (git diff base..head, or the task files without git). */
  async audit(project: Project, deliveryId: string | null): Promise<QualityReport> {
    const r = this.begin(project, deliveryId, 'audit')
    const release = this.hooks.busy(project.id, 'Auditing changed code')
    try {
      const d = deliveryId ? this.repo.delivery(deliveryId) : null
      const tasks = this.repo.tasks(project.id).filter((t) => !d || t.deliveryId === d.id)
      const read = (p: string) => {
        const f = join(project.path, p)
        try {
          return existsSync(f) && statSync(f).size < 400_000 ? readFileSync(f, 'utf8') : null
        } catch {
          return null
        }
      }
      const files =
        project.gitEnabled && d?.baseSha
          ? (await changeSet(project.path, d.baseSha, d.headSha, tasks)).files
          : wholeFiles([...new Set(tasks.flatMap((t) => t.changedFiles.map((c) => c.replace(/^\S+\s+/, ''))))], read)
      // static findings are on lines this work added: in scope by construction; plus named imports the
      // change left pointing at an export that no longer exists (a certain break when the module loads)
      const changed = files.filter((f) => f.status !== 'D').map((f) => f.path)
      const deleted = files.filter((f) => f.status === 'D').map((f) => f.path)
      const findings = classifyFindings([...auditDiff(files, read), ...(await this.interfaceBreaks(project, changed, deleted))], null, true)
      const own = files.filter((f) => !VENDORED.test(f.path))
      const lines = own.reduce((s, f) => s + f.additions, 0)
      const skipped = files.length - own.length
      return this.save({ ...r, status: 'done', findings, note: `${plural(own.length, 'file')}, ${plural(lines, 'added line')}${skipped ? `; ${plural(skipped, 'vendored file')} skipped` : ''}`, endedAt: Date.now() })
    } catch (err) {
      return this.save({ ...r, status: 'error', error: (err as Error).message, endedAt: Date.now() })
    } finally {
      release()
    }
  }

  /**
   * Visual, accessibility and page-performance QA on the real running app. A static preview is
   * Autopia's own read-only file server, so it may start one; a project's dev script needs your OK
   * and is only used when you already started it.
   */
  async visual(project: Project, deliveryId: string | null): Promise<QualityReport> {
    if (this.running.has(project.id)) throw new Error('Visual QA is already running for this project')
    const r = this.begin(project, deliveryId, 'visual')
    const info = this.preview.info(project)
    let url = info.status === 'running' ? info.url : null
    let startedHere = false
    if (!url) {
      if (!hasPage(info)) return this.save({ ...r, status: 'skipped', note: info.reason ?? 'This project has no browser preview.', endedAt: Date.now() })
      const okd = !!info.command && this.consent(project.id)?.commands.includes(info.command.split(' && ').pop()!)
      if (info.kind === 'script' && !okd) {
        return this.save({ ...r, status: 'skipped', note: `Start the preview first: it runs \`${info.command}\`, which needs your OK.`, endedAt: Date.now() })
      }
    }
    this.running.add(project.id)
    const release = this.hooks.busy(project.id, 'Visual QA at 375 / 768 / 1280 px')
    try {
      if (!url) {
        const started = await this.preview.start(project, info.kind === 'script')
        startedHere = true
        for (let i = 0; i < 40 && this.preview.info(project).status === 'starting'; i++) await new Promise((res) => setTimeout(res, 250))
        const now = this.preview.info(project)
        if (now.status !== 'running' || !now.url) throw new Error(now.error ?? started.error ?? 'The preview did not start')
        url = now.url
      }
      // an API answers on a port too: there's no page to judge, so nothing visual applies to it
      const served = await fetch(url, { signal: AbortSignal.timeout(5000) }).then((x) => x.headers.get('content-type') ?? '', () => '')
      if (served && !/html/i.test(served)) return this.save({ ...r, status: 'skipped', note: `It answers with ${served.split(';')[0]}, not a page, so visual checks don’t apply.`, endedAt: Date.now() })
      const v = await runVisualQa(project.path, r.id, url)
      // looking isn't enough: use it. A probe that can't run says nothing either way, so it adds nothing
      const used = COMPLETENESS_ON ? await probeInteractions(project.path, r.id, url).catch(() => null) : null
      if (used) {
        this.repo.setMeta(`page-shots:${r.id}`, used.shots)
        this.repo.setMeta(`interaction-summary:${r.id}`, probeSummary(used))
        Object.assign(v.metrics, { controlsFound: used.total, controlsUsed: used.tried, pagesUsed: used.pages.length })
      }
      const findings = used ? [...v.findings, ...completenessFindings(used, `${project.name} ${project.goal}`)] : v.findings
      const done = this.save({ ...r, status: 'done', findings: this.gradeVisual(project, deliveryId, findings), metrics: v.metrics, shots: v.shots, note: url, endedAt: Date.now() })
      // the delivery no longer needs the "not inspected visually" caveat
      const d = deliveryId ? this.repo.delivery(deliveryId) : null
      if (d && d.limitations.some((l) => /did not inspect it visually/.test(l))) {
        const updated = this.repo.updateDelivery(d.id, { limitations: d.limitations.filter((l) => !/did not inspect it visually/.test(l)) })
        this.emit({ type: 'delivery', delivery: updated })
      }
      return done
    } catch (err) {
      return this.save({ ...r, status: 'error', error: (err as Error).message, endedAt: Date.now() })
    } finally {
      if (startedHere) await this.preview.stop(project.id).catch(() => undefined)
      this.running.delete(project.id)
      release()
    }
  }

  /**
   * Imports broken by this change, from an incremental scan of the project's sources (the memory index
   * keeps the cache, so only changed files are re-read). Deterministic; no AI, nothing executed.
   */
  private async interfaceBreaks(project: Project, changed: string[], deleted: string[] = []): Promise<QualityFinding[]> {
    const prev = this.repo.meta<Record<string, FileScan>>(`memory-scan:${project.id}`)
    // the memory index knows every source file; without one yet, build it now (deterministic, local)
    const known = prev && typeof prev === 'object' && !Array.isArray(prev) && Object.keys(prev).length ? prev : (await indexRepository(project.path, project.gitEnabled).catch(() => null))?.scan ?? {}
    const files = [...new Set([...Object.keys(known), ...changed])].filter((f) => existsSync(join(project.path, f)))
    const scan = scanSources(project.path, files, known)
    const toDeleted = importsOfDeleted(scan.scan, deleted).map((b) => ({
      dimension: 'build' as const,
      severity: 'high' as const,
      rule: 'broken-import',
      message: `${b.importer} still imports ${b.target}, which this change deleted.`,
      file: b.importer,
      line: null,
      width: null,
      count: 1,
      evidence: `Deleted in this change: ${b.target}`
    }))
    return [...toDeleted, ...brokenImports(scan.uses, scan.symbols, changed).map((b) => ({
      dimension: 'build' as const,
      severity: 'high' as const,
      rule: 'broken-import',
      message: `${b.importer} imports ${b.missing.join(', ')} from ${b.target}, which no longer exports ${b.missing.length === 1 ? 'it' : 'them'}.`,
      file: b.importer,
      line: null,
      width: null,
      count: 1,
      evidence: `${b.target} exports: ${(scan.symbols[b.target] ?? []).slice(0, 12).join(', ') || 'nothing'}`
    }))]
  }

  /**
   * Visual findings are judged against the last visual report of an earlier result: what was already
   * there is pre-existing (out of scope). Without one, they belong to this result if it changed UI files.
   */
  private gradeVisual(project: Project, deliveryId: string | null, findings: QualityFinding[]): QualityFinding[] {
    const d = deliveryId ? this.repo.delivery(deliveryId) : null
    const earlier = d ? this.repo.qualityReports(project.id, 200).find((x) => x.kind === 'visual' && x.status === 'done' && x.deliveryId && x.deliveryId !== d.id && x.startedAt < d.createdAt) : null
    const touchedUi = d ? this.repo.tasks(project.id).some((t) => t.deliveryId === d.id && (t.kind === 'design' || t.changedFiles.some((c) => UI_FILE.test(c)))) : false
    // a game's playfield is usually a fixed size made for a bigger screen: not fitting a phone is worth saying, not a failure
    const isGame = environmentOf(project.path).type === 'game'
    const fair = isGame ? findings.map((f) => (f.rule === 'page-overflow' && (f.width ?? 0) < 768 ? { ...f, severity: 'medium' as const } : f)) : findings
    const graded = classifyFindings(fair, earlier ? earlier.findings : null, d ? touchedUi || null : null)
    if (!d) return graded
    // these describe the whole product. A small change isn't asked to fix them, and on a codebase Autopia didn't
    // build, the first time they're measured they aren't this work's doing: they're reported, not auto-corrected
    const broad = this.repo.tasks(project.id).some((t) => t.deliveryId === d.id && t.size !== 's')
    const own = broad && (!!this.repo.productSpec(project.id) || earlier?.metrics.controlsFound !== undefined)
    return own ? graded : graded.map((f) => (COMPLETENESS_RULES.has(f.rule) ? { ...f, inScope: false } : f))
  }

  /**
   * Runs when the team hands a delivery to review: the static audit always; visual QA when the plan calls
   * for it. Verified defects that this result introduced get ONE focused correction before you see it;
   * the second pass records what that correction fixed, what remains and anything it introduced.
   */
  async onReview(project: Project, d: Delivery): Promise<void> {
    const audit = await this.audit(project, d.id)
    const tasks = this.repo.tasks(project.id).filter((t) => t.deliveryId === d.id && t.status === 'done')
    // what really changed decides, not what a plan expected: a request can reshape the interface without naming a file up front
    const touched = tasks.flatMap((t) => t.changedFiles.map((c) => c.replace(/^\S+\s+/, '')))
    const wantsVisual = hasPage(detectPreview(project)) && (tasks.some((t) => t.kind === 'design' || t.qualityPlan?.items.some((i) => i.dimension === 'visual' && i.applies)) || touched.some(reachesThePage))
    const visual = wantsVisual ? await this.visual(project, d.id).catch(() => null) : null
    const findings = [...(audit.status === 'done' ? audit.findings : []), ...(visual?.status === 'done' ? visual.findings : [])]
    const key = `quality-correction:${d.id}`
    const prior = this.repo.meta<QualityCorrection>(key)
    // what the code really does against what was promised, measured: the direction is more than a document
    const spec = this.repo.productSpec(project.id)
    if (spec?.direction && EXPERTISE_ON) findings.push(...directionFindings(spec, readSources(project.path, this.repo.codeFiles(project.id))))
    // what's really on screen against what was promised: once before you see it, and once more to check a correction
    if (visual?.status === 'done' && visual.shots.length && !prior?.outcome) {
      const gaps = await this.hooks.designReview(project, d, [...visual.shots.map((s) => s.path), ...(this.repo.meta<string[]>(`page-shots:${visual.id}`) ?? [])]).catch(() => [])
      findings.push(...gaps.filter((g) => g.severity === 'high').map((g) => ({ dimension: 'visual' as const, severity: 'high' as const, rule: 'design-review', message: g.message, fix: g.fix, file: null, line: null, width: null, count: 1, evidence: 'Creative review of the real screenshots', certainty: 'verified' as const, inScope: true })))
    }
    if (!prior) {
      const targets = correctable(findings)
      if (targets.length) {
        const taskKey = this.hooks.correct(project, d, targets.slice(0, 6))
        if (taskKey) {
          this.repo.setMeta(key, { taskKey, targeted: findingKeys(targets.slice(0, 6)), before: findingKeys(findings), outcome: null, at: Date.now() } satisfies QualityCorrection)
          return // the result goes back to the team; review QA runs again when the fix is merged
        }
      }
    } else if (!prior.outcome) {
      const outcome = correctionOutcome(prior.targeted, findings, prior.before)
      this.repo.setMeta(key, { ...prior, outcome } satisfies QualityCorrection)
    }
    this.recordFinalGate(project.id, d.id)
  }

  correction(deliveryId: string): QualityCorrection | null {
    const c = this.repo.meta<QualityCorrection>(`quality-correction:${deliveryId}`)
    return c && Array.isArray(c.targeted) ? c : null
  }

  /**
   * Verifies a finished product milestone from evidence: the milestone tasks' real check results, a
   * static audit of the files they changed, and visual QA when the slice is user-facing. A first
   * failure gets one focused repair task; a second is recorded and carried as a limitation.
   */
  async milestoneGate(project: Project, n: number, addRepair: (title: string, description: string, kind: 'code' | 'design') => { key: string }): Promise<void> {
    const spec = this.repo.productSpec(project.id)
    const m = spec?.milestones.find((x) => x.n === n)
    if (!spec || !m) return
    const tasks = this.repo.tasks(project.id).filter((t) => t.milestone === n && t.status === 'done')
    const evidence: string[] = []
    const problems: string[] = []
    let unverified = false
    for (const t of tasks) {
      for (const c of t.checks) {
        evidence.push(`${t.key}: \`${c.command}\` ${c.status}`)
        if (c.status === 'failed') problems.push(`\`${c.command}\` failed in ${t.key}`)
        else if (c.status !== 'passed') unverified = true
      }
      if (!t.checks.length && t.kind !== 'design') (unverified = true), evidence.push(`${t.key}: no checks ran`)
      // a finished repair with passing checks was created for exactly these criteria: it supersedes the earlier report
      const repair = m.gate?.repairTaskKey ? tasks.find((x) => x.key === m.gate!.repairTaskKey) : null
      const resolvedByRepair = !!repair && repair.key !== t.key && (repair.finishedAt ?? 0) > (t.finishedAt ?? 0) && repair.checks.length > 0 && repair.checks.every((c) => c.status === 'passed')
      const unmet = t.criteria.filter((x) => !x.met)
      if (unmet.length && resolvedByRepair) evidence.push(`${t.key}: ${unmet.length} unmet criteria re-verified by ${repair!.key} (checks passed)`)
      else for (const c of unmet) problems.push(`${t.key} criterion not met: ${c.criterion}`)
    }
    const read = (p: string) => {
      try {
        const f = join(project.path, p)
        return existsSync(f) && statSync(f).size < 400_000 ? readFileSync(f, 'utf8') : null
      } catch {
        return null
      }
    }
    const files = [...new Set(tasks.flatMap((t) => t.changedFiles.map((c) => c.replace(/^\S+\s+/, ''))))].filter((f) => !VENDORED.test(f))
    // only certain findings justify a repair task; pattern suspicions are evidence, not problems
    const graded = classifyFindings(auditDiff(wholeFiles(files, read), read), null, true).filter((f) => f.severity === 'high')
    const high = graded.filter((f) => f.certainty === 'verified')
    for (const f of high) problems.push(`[${f.dimension}] ${f.message} (${f.file}${f.line ? `:${f.line}` : ''})`)
    evidence.push(`Static audit of ${plural(files.length, 'file')}: ${plural(high.length, 'verified high-severity finding')}${graded.length > high.length ? `, ${graded.length - high.length} suspected to confirm` : ''}`)
    const ui = tasks.some((t) => t.kind === 'design' || t.qualityPlan?.items.some((i) => i.dimension === 'visual' && i.applies))
    if (ui) {
      const v = await this.visual(project, this.repo.openDelivery(project.id)?.id ?? null).catch((err: Error) => ({ status: 'error' as const, error: err.message, findings: [], note: null }))
      if (v.status === 'done') {
        const bad = v.findings.filter((f) => f.severity === 'high' && f.certainty === 'verified' && f.inScope !== false)
        evidence.push(`Visual QA: ${plural(v.findings.length, 'finding')}, ${bad.length} high`)
        for (const f of bad) problems.push(`[${f.dimension}] ${f.message}${f.file ? ` (${f.file}${f.width ? ` at ${f.width}px` : ''})` : ''}`)
      } else {
        unverified = true
        evidence.push(`Visual QA not run: ${v.error ?? v.note ?? v.status}`)
      }
    }
    const verdict = problems.length ? 'failed' : unverified ? 'unverified' : 'passed'
    let repairTaskKey: string | null = null
    if (verdict === 'failed' && !m.gate?.repairTaskKey) {
      const kind = problems.every((p) => /visual|accessibility/.test(p)) ? 'design' : 'code'
      repairTaskKey = addRepair(
        `Milestone ${n} fixes`,
        ['Focused repair from the milestone verification. Fix only these concrete problems, keep working behaviour unchanged, and re-run the affected checks:', ...problems.slice(0, 10).map((p) => `- ${p}`)].join('\n'),
        kind
      ).key
    }
    const fresh = this.repo.productSpec(project.id)!
    const gate = { verdict, evidence, at: Date.now(), repairTaskKey: repairTaskKey ?? m.gate?.repairTaskKey ?? null } as const
    const status = verdict === 'failed' ? (repairTaskKey ? 'active' : 'failed') : 'done'
    this.emit({ type: 'product', spec: this.repo.saveProductSpec({ ...fresh, milestones: fresh.milestones.map((x) => (x.n === n ? { ...x, gate, status } : x)) }) })
  }

  /** The final milestone is verified by delivery review; its gate mirrors the delivery's readiness. */
  recordFinalGate(projectId: string, deliveryId: string): void {
    const spec = this.repo.productSpec(projectId)
    if (!spec?.milestones.length) return
    const r = this.readiness(projectId, deliveryId)
    const n = spec.milestones[spec.milestones.length - 1].n
    const verdict = r.verdict === 'ready' || r.verdict === 'ready_with_exceptions' ? 'passed' : r.verdict === 'not_ready' ? 'failed' : 'unverified'
    const evidence = r.dimensions.filter((d) => d.applies).map((d) => `${d.label}: ${d.exception ? 'exception' : d.status.replace('_', ' ')}`)
    this.emit({
      type: 'product',
      spec: this.repo.saveProductSpec({ ...spec, milestones: spec.milestones.map((x) => (x.n === n ? { ...x, status: verdict === 'failed' ? 'failed' : 'done', gate: { verdict, evidence, at: Date.now(), repairTaskKey: null } } : x)) })
    })
  }

  readiness(projectId: string, deliveryId: string): Readiness {
    const project = this.repo.project(projectId)
    const d = this.repo.delivery(deliveryId)
    return readiness(d, this.repo.tasks(projectId), this.repo.allRuns(projectId), this.repo.qualityReports(projectId, 200), this.repo.qualityExceptions(d.id), hasPage(detectPreview(project)), this.correction(d.id), runtimeEvidence(this.preview.info(project), dependencyState(project.path), d.verification), this.repo.meta<{ saw?: number; gaps?: unknown[]; distinctive?: boolean }>(`design-review:${d.id}`))
  }

  overview(projectId: string): QualityOverview {
    const deliveries = this.repo.deliveries(projectId)
    const current = deliveries.find((d) => d.status === 'review') ?? deliveries.find((d) => d.status !== 'implementing') ?? null
    const finished = deliveries.filter((d) => d.completedAt).slice(0, 12).reverse()
    const tasks = this.repo.tasks(projectId)
    return {
      readiness: current ? this.readiness(projectId, current.id) : null,
      reports: this.repo.qualityReports(projectId, 30),
      trend: finished.map((d) => {
        const own = tasks.filter((t) => t.deliveryId === d.id)
        const checks = own.flatMap((t) => t.checks)
        return {
          number: d.number,
          verdict: this.readiness(projectId, d.id).verdict,
          checksPassed: checks.filter((c) => c.status === 'passed').length,
          checksTotal: checks.length,
          repairs: own.reduce((s, t) => s + t.fixAttempts, 0),
          at: d.completedAt!
        }
      })
    }
  }

  setException(projectId: string, deliveryId: string, dimension: QualityDimension, note: string | null): Readiness {
    const text = note?.trim() ?? null
    if (text !== null && text.length < 4) throw new Error('Describe why this is acceptable (it is recorded with the delivery)')
    this.repo.setQualityException(projectId, deliveryId, dimension, text)
    return this.readiness(projectId, deliveryId)
  }

  /** Data URL of a quality screenshot (only files Autopia wrote under .autopia/quality). */
  shot(project: Project, rel: string): string {
    if (!/^\.autopia\/quality\/[\w-]+\.png$/.test(rel)) throw new Error('Unknown screenshot')
    return `data:image/png;base64,${readFileSync(join(project.path, rel)).toString('base64')}`
  }
}
