// "Done" means installed, built, running, rendered and verified, in the folder you actually run. This
// is the pure part of that gate: what to run, how to read what happened and what happens next. It decides
// without AI; agents are only called to repair a failure this code has measured.

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type VerificationState = 'verifying' | 'fixing' | 'verified' | 'failed' | 'blocked'
export type VerificationStepId = 'install' | 'config' | 'typecheck' | 'build' | 'test' | 'server' | 'render'
export type StepStatus = 'passed' | 'failed' | 'blocked' | 'skipped'

export interface VerificationStep {
  id: VerificationStepId
  label: string
  status: StepStatus
  command: string | null
  /** One line: what happened. */
  detail: string
  /** The tail of the real output, for a failed step. */
  output?: string
  ms: number
}

export interface DeliveryVerification {
  state: VerificationState
  /** The commit this evidence is about (null without git). */
  commit: string | null
  steps: VerificationStep[]
  /** Automatic repairs used so far. */
  attempts: number
  /** The failure the last repair was sent for: the same one again means it didn't help. */
  signature: string | null
  /** Why this stopped: what is wrong and what it takes. */
  reason: string | null
  at: number
}

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm']
]

/** The manager the project itself chose: its `packageManager` field, then its lockfile, then npm. */
export function detectPackageManager(files: string[], packageManagerField?: string): PackageManager {
  const named = packageManagerField?.split('@')[0]
  if (named === 'npm' || named === 'pnpm' || named === 'yarn' || named === 'bun') return named
  return LOCKFILES.find(([f]) => files.includes(f))?.[1] ?? 'npm'
}

export const installCommand = (pm: PackageManager) => `${pm} install`
export const runCommand = (pm: PackageManager, script: string) => `${pm} run ${script}`
/** Arguments after the script name: only npm needs the `--` separator. */
export const scriptArgs = (pm: PackageManager, args: string[]) => (args.length ? (pm === 'npm' ? ['--', ...args] : args) : [])

const SCRIPT_CHECKS: { id: VerificationStepId; label: string; scripts: string[] }[] = [
  { id: 'typecheck', label: 'Types', scripts: ['typecheck', 'type-check', 'check-types', 'types:check', 'tsc'] },
  { id: 'build', label: 'Build', scripts: ['build'] },
  { id: 'test', label: 'Tests', scripts: ['test', 'test:unit'] }
]

/** The project's own declared checks. Nothing is invented: no script, no check. */
export function declaredChecks(scripts: Record<string, string> | undefined, pm: PackageManager): { id: VerificationStepId; label: string; command: string }[] {
  const out: { id: VerificationStepId; label: string; command: string }[] = []
  for (const c of SCRIPT_CHECKS) {
    const script = c.scripts.find((s) => scripts?.[s] && !/no test specified/i.test(scripts[s]))
    if (script) out.push({ id: c.id, label: c.label, command: runCommand(pm, script) })
  }
  return out
}

/** What the loaded page really was. Measured in a hidden window. */
export interface RenderSnapshot {
  loadError: string | null
  httpStatus: number | null
  textLength: number
  /** Images, canvas, video and svg with a visible size. */
  mediaCount: number
  /** The dev server's error overlay, if it is showing. */
  overlay: string | null
  /** Every pixel of the frame is the same color; null if no frame could be captured. */
  uniformFrame: boolean | null
  exceptions: string[]
  consoleErrors: string[]
  failedRequests: string[]
}

export interface RenderIssue {
  kind: 'load' | 'http' | 'overlay' | 'runtime' | 'asset' | 'blank'
  message: string
}

/** HTTP 200 isn't "works": the page has to show something, without errors, with its files. */
export function judgeRender(s: RenderSnapshot): RenderIssue[] {
  const issues: RenderIssue[] = []
  if (s.loadError) issues.push({ kind: 'load', message: `The page did not load: ${s.loadError}` })
  if (s.httpStatus !== null && s.httpStatus >= 400) issues.push({ kind: 'http', message: `The page answered HTTP ${s.httpStatus}` })
  if (s.overlay) issues.push({ kind: 'overlay', message: `The dev server shows an error: ${s.overlay.slice(0, 400)}` })
  for (const e of s.exceptions.slice(0, 5)) issues.push({ kind: 'runtime', message: `Uncaught error: ${e.slice(0, 400)}` })
  for (const r of s.failedRequests.filter((x) => !/favicon/i.test(x)).slice(0, 8)) issues.push({ kind: 'asset', message: `A file failed to load: ${r.slice(0, 200)}` })
  if (!s.loadError && !s.overlay) {
    if (s.textLength < 3 && s.mediaCount === 0) issues.push({ kind: 'blank', message: 'The page is blank: it renders no text or images.' })
    else if (s.uniformFrame === true) issues.push({ kind: 'blank', message: 'The page is visually blank: every pixel is the same color.' })
  }
  return issues
}

/** Failures code changes can't fix: repairing these would only waste a session. */
const ENVIRONMENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|E401|E403|ENOSPC|EACCES|EPERM|ENOENT.*(npm|pnpm|yarn|bun)|command not found: (npm|pnpm|yarn|bun)|spawn (npm|pnpm|yarn|bun) ENOENT|Unsupported engine|registry\.npmjs/i

export function isEnvironmentFailure(step: Pick<VerificationStep, 'detail' | 'output'>): boolean {
  return ENVIRONMENT.test(`${step.detail}\n${step.output ?? ''}`)
}

/** A failure's identity without timings, ports and paths: equal signatures mean nothing changed. */
export function verificationSignature(steps: VerificationStep[]): string {
  const clean = (t: string) =>
    t
      .replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '')
      .replace(/127\.0\.0\.1:\d+|localhost:\d+/g, 'host')
      .replace(/\/[^\s:'"()]+\//g, '/')
      .replace(/:\d+:\d+/g, '')
      .replace(/\b[0-9a-f]{7,40}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  return steps
    .filter((s) => s.status === 'failed')
    .map((s) => `${s.id}:${clean(s.detail)}`)
    .join('|')
}

export type NextStep = { state: 'verified'; reason: null } | { state: 'fixing'; reason: null } | { state: 'failed' | 'blocked'; reason: string }

/**
 * What the evidence means. Always ends: an identical failure stops immediately, and the repair budget is
 * finite. Anything that didn't run is never verified.
 */
export function nextStep(x: { steps: VerificationStep[]; attempts: number; limit: number; lastSignature: string | null; canRepair: boolean }): NextStep {
  // nothing ran, so nothing was shown to work: "verified" would be a claim with no evidence behind it
  if (!x.steps.some((s) => s.status === 'passed')) {
    if (!x.steps.some((s) => s.status === 'failed' || s.status === 'blocked')) return { state: 'blocked', reason: 'There was nothing Autopia could run here, so this isn’t verified.' }
  }
  const failed = x.steps.filter((s) => s.status === 'failed')
  const names = (list: VerificationStep[]) => list.map((s) => s.label.toLowerCase()).join(', ')
  const blocked = x.steps.filter((s) => s.status === 'blocked')
  if (!failed.length && !blocked.length) return { state: 'verified', reason: null }
  if (blocked.length && !failed.length) return { state: 'blocked', reason: blocked.map((s) => s.detail).join(' ') }
  const env = failed.filter(isEnvironmentFailure)
  if (env.length === failed.length) return { state: 'blocked', reason: `Not something the team can fix in code: ${env[0].detail}` }
  const signature = verificationSignature(x.steps)
  if (signature === x.lastSignature) return { state: 'failed', reason: `The automatic repair didn’t change the failure (${names(failed)}), so Autopia stopped instead of retrying blindly.` }
  if (x.attempts >= x.limit) return { state: 'failed', reason: `Still failing (${names(failed)}) after ${x.attempts} automatic repair${x.attempts === 1 ? '' : 's'}.` }
  if (!x.canRepair) return { state: 'failed', reason: `Failing (${names(failed)}), and no automatic repair can run right now (paused, or Claude Code is unavailable).` }
  return { state: 'fixing', reason: null }
}

/** The repair brief: the measured failure, in its own words. */
export function repairBrief(steps: VerificationStep[], number: number): string {
  const failed = steps.filter((s) => s.status === 'failed')
  return [
    `Autopia verified result #${number} by actually running it in the project folder, and this failed. Find the real cause and fix it in the code or configuration. Change nothing else.`,
    ...failed.map((s) => [`\n## ${s.label}${s.command ? `: \`${s.command}\`` : ''}`, s.detail, s.output ? `\`\`\`\n${s.output.slice(-2500)}\n\`\`\`` : ''].filter(Boolean).join('\n')),
    '\nAutopia reruns the same verification when you finish (install, checks, the dev server and the rendered page), so an explanation without a change won’t pass. If it needs something you can’t do from here, say exactly what.'
  ].join('\n')
}
