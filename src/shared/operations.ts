// Reading what a real command did, and what that means right now. Pure and token-free: a result only counts for the code
// it ran against, and launch readiness is a list of things known, unknown and wrong. There is no score.

import { ERROR_LINE, NOISE, checkKey } from './checks'
import { isEnvironmentFailure } from './delivery'
import type { EnvCommand, ProjectEnvironment } from './environment'
import type { CheckResult, Delivery, PreviewInfo, ValidationRun } from './types'

export type OpState = 'not_run' | 'running' | 'passed' | 'failed' | 'cancelled' | 'unavailable' | 'interrupted'

export const OP_WORD: Record<OpState, string> = { not_run: 'Not run', running: 'Running', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled', unavailable: 'Not available', interrupted: 'Interrupted' }

export interface TestSummary {
  passed: number
  failed: number
  skipped: number
}

const num = (m: RegExpExecArray | null, i = 1) => (m ? Number(m[i]) : 0)

/** What the test runner itself printed. Null when it printed nothing Autopia can read: then no counts are claimed. */
export function testSummary(output: string): TestSummary | null {
  const text = output.replace(/\u001b\[[\d;]*[A-Za-z]/g, '')
  // Vitest: `Tests  1 failed | 12 passed (13)`
  const vitest = /^\s*Tests\s+(.*\(\d+\))\s*$/m.exec(text)
  if (vitest) return { passed: num(/(\d+) passed/.exec(vitest[1])), failed: num(/(\d+) failed/.exec(vitest[1])), skipped: num(/(\d+) (?:skipped|todo)/.exec(vitest[1])) }
  // Jest: `Tests:       1 failed, 12 passed, 13 total`
  const jest = /^Tests:\s+(.*\d+ total)\s*$/m.exec(text)
  if (jest) return { passed: num(/(\d+) passed/.exec(jest[1])), failed: num(/(\d+) failed/.exec(jest[1])), skipped: num(/(\d+) skipped/.exec(jest[1])) }
  // cargo: `test result: FAILED. 3 passed; 1 failed; 0 ignored`
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)]
  if (cargo.length) return cargo.reduce((a, m) => ({ passed: a.passed + Number(m[1]), failed: a.failed + Number(m[2]), skipped: a.skipped + Number(m[3]) }), { passed: 0, failed: 0, skipped: 0 })
  // pytest: `== 1 failed, 3 passed, 2 skipped in 0.12s ==`
  const pytest = /^=+ (.*\bin [\d.]+s.*) =+\s*$/m.exec(text)
  if (pytest && /\d+ (passed|failed|error)/.test(pytest[1])) return { passed: num(/(\d+) passed/.exec(pytest[1])), failed: num(/(\d+) failed/.exec(pytest[1])) + num(/(\d+) errors?/.exec(pytest[1])), skipped: num(/(\d+) skipped/.exec(pytest[1])) }
  // node:test: `ℹ pass 12` or `# pass 12`
  const nodePass = /^(?:ℹ|#) pass (\d+)\s*$/m.exec(text)
  if (nodePass) return { passed: num(nodePass), failed: num(/^(?:ℹ|#) fail (\d+)\s*$/m.exec(text)), skipped: num(/^(?:ℹ|#) skipped (\d+)\s*$/m.exec(text)) }
  // Mocha: `12 passing` / `1 failing`
  const mocha = /^\s*(\d+) passing\b/m.exec(text)
  if (mocha) return { passed: num(mocha), failed: num(/^\s*(\d+) failing\b/m.exec(text)), skipped: num(/^\s*(\d+) pending\b/m.exec(text)) }
  // go test: one line a package
  const goOk = text.match(/^ok\s+\S+/gm)?.length ?? 0
  const goFail = text.match(/^FAIL\s+\S+\s+[\d.]+s/gm)?.length ?? 0
  if (goOk || goFail) return { passed: goOk, failed: goFail, skipped: 0 }
  return null
}

export function summaryWords(s: TestSummary, command: string): string {
  const unit = /^go /.test(command) ? 'package' : 'test'
  const total = s.passed + s.failed
  const skipped = s.skipped ? `, ${s.skipped} skipped` : ''
  if (s.failed) return `${s.failed} of ${total} ${unit}${total === 1 ? '' : 's'} failed${skipped}`
  return `${s.passed} ${unit}${s.passed === 1 ? '' : 's'} passed${skipped}`
}


/** The lines worth reading first, exactly as the command printed them. Nothing is reworded or explained. */
export function failureLines(output: string, max = 8): string[] {
  const lines = output.replace(/\u001b\[[\d;]*[A-Za-z]/g, '').split('\n')
  const out: string[] = []
  for (const l of lines) {
    const t = l.trimEnd()
    if (!NOISE.test(t) && ERROR_LINE.test(t) && !out.includes(t.trim())) out.push(t.trim().slice(0, 240))
    if (out.length >= max) break
  }
  return out
}

/** A failure's identity, without timings and paths: the same one again means nothing changed. */
export function opSignature(command: string, output: string): string {
  const clean = failureLines(output, 6).map((l) => l.replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '').replace(/:\d+:\d+/g, '').replace(/\/[^\s:'"()]+\//g, '/').replace(/\s+/g, ' ').trim())
  return `${command.trim()}|${clean.join('|')}`
}

// ── a check, as it stands now ────────────────────────────────

export interface CheckView {
  command: EnvCommand
  state: OpState
  /** The newest run of this command that says anything. */
  run: ValidationRun | null
  check: CheckResult | null
  /** It ran, but the code has changed since. It says nothing about the code now. */
  stale: boolean
  summary: TestSummary | null
  /** Whether this command has ever passed on the exact code here now. */
  current: boolean
  /** It passed when this result was run for real, on the same code. */
  verifiedBy?: number
}

/** One command's record, read against the code as it is now. Only Autopia's own runs have a stamp, so only they can be current. */
export function checkView(command: EnvCommand, runs: ValidationRun[], stamp: string | null, denied: boolean, verified: { command: string; number: number }[] = []): CheckView {
  const mine = runs.find((r) => r.command === command.command || r.checks.some((c) => c.command === command.command)) ?? null
  const check = mine?.checks.find((c) => c.command === command.command) ?? null
  if (denied) return { command, state: 'unavailable', run: mine, check, stale: false, summary: null, current: false }
  const by = verified.find((v) => checkKey(v.command) === checkKey(command.command))
  if (!mine && by) return { command, state: 'passed', run: null, check: null, stale: false, summary: null, current: true, verifiedBy: by.number }
  if (!mine) return { command, state: 'not_run', run: null, check: null, stale: false, summary: null, current: false }
  const state: OpState = mine.status === 'running' ? 'running' : mine.status === 'cancelled' ? 'cancelled' : mine.status === 'error' ? 'interrupted' : check?.status === 'passed' ? 'passed' : check?.status === 'failed' ? 'failed' : 'not_run'
  const finished = state === 'passed' || state === 'failed'
  const current = finished && !!stamp && mine.stamp === stamp
  // running a result for real is the same evidence, as long as the code is still exactly what it ran on
  if (!current && state !== 'running' && by) return { command, state: 'passed', run: mine, check: null, stale: false, summary: null, current: true, verifiedBy: by.number }
  return { command, state, run: mine, check, stale: finished && !current, summary: check?.output ? testSummary(check.output) : null, current }
}

// ── what needs attention ─────────────────────────────────────

export interface OpProblem {
  id: string
  /** Which operation. */
  what: string
  /** What it really said. */
  said: string
  lines: string[]
  source: 'process' | 'check' | 'install'
  command: string | null
  /** Code can't fix this one: it's this Mac, the network or another program. Sending the team would waste a session. */
  outside: boolean
}

export function problemsNow(x: { preview: Pick<PreviewInfo, 'status' | 'error' | 'command' | 'logs'> | null; checks: CheckView[] }): OpProblem[] {
  const out: OpProblem[] = []
  if (x.preview?.status === 'crashed') {
    const said = x.preview.error ?? 'It exited without saying why.'
    const lines = x.preview.logs.slice(-10).filter((l) => l !== said && !/^> |^\$ /.test(l))
    const taken = /already used by/.test(said)
    out.push({ id: 'process', what: taken ? 'It couldn’t start: its port is taken' : 'The app stopped by itself', said, lines: taken ? [] : ['', ...lines], source: 'process', command: x.preview.command, outside: taken || isEnvironmentFailure({ detail: said, output: lines.join('\n') }) })
  }
  for (const c of x.checks) {
    if (c.state !== 'failed' || !c.current) continue
    const lines = failureLines(c.check?.output ?? '')
    out.push({ id: c.command.id, what: `${c.command.label} failed`, said: lines[0] ?? 'It exited with an error and printed no error line.', lines, source: 'check', command: c.command.command, outside: isEnvironmentFailure({ detail: lines[0] ?? '', output: c.check?.output }) })
  }
  return out
}

/** What goes to the team: the failure in its own words and nothing Autopia worked out by itself. */
export function fixBrief(p: Pick<OpProblem, 'what' | 'command' | 'said'>, output: string): string {
  return [`${p.what}${p.command ? `: \`${p.command}\`` : ''}.`, 'Autopia ran this for real in the project folder. Find the real cause and fix it. Change nothing else.', '```', output.slice(-3000) || p.said, '```'].join('\n')
}

// ── launch readiness ─────────────────────────────────────────

export type ReadyState = 'ok' | 'problem' | 'unknown' | 'na'

export interface ReadyItem {
  id: string
  label: string
  state: ReadyState
  /** What the evidence is, or what's missing. */
  detail: string
}

export interface LaunchReadiness {
  verdict: 'blocked' | 'unverified' | 'verified'
  headline: string
  items: ReadyItem[]
}

export interface LaunchFacts {
  env: Pick<ProjectEnvironment, 'type' | 'checks' | 'install' | 'docs'>
  checks: CheckView[]
  /** Dependencies: null when the project has none to check. */
  dependencies: string | null
  depsOk: boolean | null
  /** Environment variables the code reads with no value anywhere Autopia can see. */
  missingEnv: string[]
  /** All it reads. Names only. */
  envNames: string[]
  uncommitted: number | null
  hasGit: boolean
  artifacts: string[]
  delivery: Pick<Delivery, 'number' | 'status' | 'verification' | 'limitations'> | null
  openQuality: string[]
  crashed: string | null
  package?: { name: string | null; version: string | null; exportsSomething: boolean; isPrivate: boolean } | null
}

const BUILD_WORD: Partial<Record<ProjectEnvironment['type'], string>> = { web: 'The build output', desktop: 'A built app', game: 'A build', native: 'A build', library: 'The built package', cli: 'A built program', backend: 'A build' }

export function launchReadiness(f: LaunchFacts): LaunchReadiness {
  const items: ReadyItem[] = []
  for (const c of f.checks) {
    const name = c.command.label
    const counts = c.summary ? ` (${summaryWords(c.summary, c.command.command)})` : ''
    if (c.state === 'failed' && c.current) items.push({ id: c.command.id, label: name, state: 'problem', detail: `Failed on the code as it is now${counts}.` })
    else if (c.state === 'passed' && c.current) items.push({ id: c.command.id, label: name, state: 'ok', detail: `Passed on the code as it is now${counts}.` })
    else if (c.stale) items.push({ id: c.command.id, label: name, state: 'unknown', detail: `Last ${c.state} on older code. Run it again to know.` })
    else if (c.state === 'running') items.push({ id: c.command.id, label: name, state: 'unknown', detail: 'Running now.' })
    else if (c.state === 'unavailable') items.push({ id: c.command.id, label: name, state: 'unknown', detail: 'Your organization’s policy doesn’t allow it here.' })
    else items.push({ id: c.command.id, label: name, state: 'unknown', detail: c.state === 'cancelled' ? 'Cancelled before it finished.' : c.state === 'interrupted' ? 'Autopia closed before it finished.' : 'Not run yet.' })
  }
  if (!f.env.checks.length) items.push({ id: 'no-checks', label: 'Build and tests', state: 'unknown', detail: 'Autopia found no build or test command in this project, so nothing shows it works.' })
  if (!f.env.checks.some((c) => c.kind === 'test') && f.env.checks.length) items.push({ id: 'no-tests', label: 'Tests', state: 'unknown', detail: 'This project declares no tests.' })
  if (f.crashed) items.push({ id: 'crashed', label: 'Running it', state: 'problem', detail: f.crashed })
  if (f.depsOk !== null) items.push({ id: 'deps', label: 'Dependencies', state: f.depsOk ? 'ok' : 'problem', detail: f.dependencies ?? (f.depsOk ? 'Every declared package is installed in the project folder.' : 'Some aren’t installed.') })
  if (f.envNames.length) items.push({ id: 'config', label: 'Configuration', state: f.missingEnv.length ? 'unknown' : 'ok', detail: f.missingEnv.length ? `The code reads ${list(f.missingEnv)}, with no value in a .env file. It may be set somewhere else where you launch.` : `Every variable the code reads (${f.envNames.length}) has a value in a .env file.` })
  if (f.delivery) {
    const d = f.delivery
    const v = d.verification
    if (d.status === 'implementing' || d.status === 'validating') items.push({ id: 'delivery', label: `Result #${d.number}`, state: 'unknown', detail: 'The team is still working on it.' })
    else if (v?.state === 'failed' || v?.state === 'blocked') items.push({ id: 'delivery', label: `Result #${d.number}`, state: 'problem', detail: v.reason ?? 'It didn’t pass when run for real.' })
    else if (d.status === 'review') items.push({ id: 'delivery', label: `Result #${d.number}`, state: 'unknown', detail: 'Waiting for your review.' })
    else if (d.status === 'accepted') items.push({ id: 'delivery', label: `Result #${d.number}`, state: 'ok', detail: 'You accepted it.' })
    for (const l of (d.limitations ?? []).slice(0, 3)) if (l !== v?.reason) items.push({ id: `limit:${l}`, label: 'Known limitation', state: 'unknown', detail: l })
  }
  for (const q of f.openQuality.slice(0, 4)) items.push({ id: `quality:${q}`, label: 'Open quality item', state: 'unknown', detail: q })
  if (f.hasGit && f.uncommitted !== null) items.push({ id: 'git', label: 'Saved in git', state: f.uncommitted ? 'unknown' : 'ok', detail: f.uncommitted ? `${f.uncommitted} file${f.uncommitted === 1 ? ' has' : 's have'} uncommitted changes.` : 'Everything is committed.' })
  if (!f.hasGit) items.push({ id: 'git', label: 'Saved in git', state: 'unknown', detail: 'This folder doesn’t use git.' })
  const buildWord = BUILD_WORD[f.env.type]
  if (buildWord && f.env.checks.some((c) => c.kind === 'build')) items.push({ id: 'artifacts', label: buildWord, state: f.artifacts.length ? 'ok' : 'unknown', detail: f.artifacts.length ? `Found ${list(f.artifacts)}. Run the build to be sure it’s current.` : 'None in the folder yet.' })
  if (f.package) {
    const p = f.package
    if (p.isPrivate) items.push({ id: 'package', label: 'Package', state: 'unknown', detail: 'package.json is marked private, so it can’t be published as it is.' })
    else items.push({ id: 'package', label: 'Package', state: p.name && p.version && p.exportsSomething ? 'ok' : 'problem', detail: p.name && p.version && p.exportsSomething ? `${p.name}@${p.version} names what it exports.` : `package.json needs ${[!p.name && 'a name', !p.version && 'a version', !p.exportsSomething && 'an entry point'].filter(Boolean).join(', ')}.` })
  }
  items.push({ id: 'docs', label: 'Instructions', state: f.env.docs.some((d) => /^readme/i.test(d)) ? 'ok' : 'unknown', detail: f.env.docs.some((d) => /^readme/i.test(d)) ? 'It has a readme.' : 'No readme, so anyone new has to work it out.' })

  const problems = items.filter((i) => i.state === 'problem').length
  const unknown = items.filter((i) => i.state === 'unknown').length
  const verdict: LaunchReadiness['verdict'] = problems ? 'blocked' : unknown ? 'unverified' : 'verified'
  const headline = problems ? `${problems} thing${problems === 1 ? '' : 's'} to fix before launch` : unknown ? `Nothing known to be wrong, ${unknown} thing${unknown === 1 ? '' : 's'} not verified` : 'Everything Autopia can check passed, on this exact code'
  return { verdict, headline, items: [...items].sort((a, b) => RANK[a.state] - RANK[b.state]) }
}

const RANK: Record<ReadyState, number> = { problem: 0, unknown: 1, ok: 2, na: 3 }
const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`)

/** One line for the Overview and Command: only what's true now. */
export function opsLine(preview: Pick<PreviewInfo, 'status' | 'url'> | null, checks: CheckView[]): { tone: 'danger' | 'ok' | 'info' | 'muted'; text: string } | null {
  const failed = checks.filter((c) => c.state === 'failed' && c.current)
  if (preview?.status === 'crashed') return { tone: 'danger', text: 'The app stopped by itself' }
  if (failed.length) return { tone: 'danger', text: `${failed.map((c) => c.command.label).join(' and ')} failed on the code as it is now` }
  if (checks.some((c) => c.state === 'running')) return { tone: 'info', text: `Running ${checks.filter((c) => c.state === 'running').map((c) => c.command.label.toLowerCase()).join(' and ')}` }
  if (preview?.status === 'running') return { tone: 'ok', text: preview.url ? 'The app is running' : 'It’s running' }
  const passed = checks.filter((c) => c.current && c.state === 'passed')
  if (passed.length && passed.length === checks.length) return { tone: 'ok', text: 'All its checks passed on the code as it is now' }
  return null
}

// ── the state of a project, as read from its folder ──────────

export interface OpsState {
  environment: ProjectEnvironment
  runtimes: (ProjectEnvironment['runtimes'][number] & { found: boolean; version: string | null })[]
  /** Programs its commands need that this Mac doesn't have. */
  missing: string[]
  /** Commands your organization's policy denies. */
  denied: string[]
  /** Commands you've already seen and OK'd. */
  allowed: string[]
  stamp: string
  uncommitted: number | null
  hasGit: boolean
  dependencyProblem: string | null
  depsDeclared: number
  /** Names only. Values are never read out. */
  envNames: string[]
  missingEnv: string[]
  artifacts: string[]
  openQuality: string[]
  package: LaunchFacts['package']
  /** Which task is on which measured failure. */
  fixes: Record<string, string>
  /** Checks that passed when a result was run for real, on exactly the code here now. */
  verified: { command: string; number: number }[]
  config: import('./environment').OpsConfig | null
}

/** Whether what's installed meets a simple version request. Null when that can't be told: then nothing is claimed. */
export function versionFits(wants: string | null, have: string | null): boolean | null {
  if (!wants || !have) return null
  const need = /^(?:>=|\^|~|v)?\s*(\d+)(?:\.(\d+))?(?:\.x|\.\*)?\s*$/.exec(wants.trim())
  const got = /(\d+)(?:\.(\d+))?/.exec(have)
  if (!need || !got) return null
  const [nMajor, nMinor] = [Number(need[1]), Number(need[2] ?? 0)]
  const [gMajor, gMinor] = [Number(got[1]), Number(got[2] ?? 0)]
  if (/^>=/.test(wants.trim())) return gMajor > nMajor || (gMajor === nMajor && gMinor >= nMinor)
  return gMajor === nMajor && gMinor >= nMinor
}
