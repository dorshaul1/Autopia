import { plural } from '@shared/friendlyError'
// Runs a result for real, in the project folder: install, the project's own checks, the dev server, and
// the rendered page. Every step is measured here; no agent's account of it counts. Runs only commands
// you've OK'd (see commandsFor), never one your organization's policy denies.

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { declaredChecks, detectPackageManager, installCommand, judgeRender, type PackageManager, type RenderSnapshot, type VerificationStep } from '@shared/delivery'
import { dependencyProblem } from '@shared/runtime'
import { environmentOf } from '../environment'
import type { BashEvidence } from '@shared/checks'
import type { PreviewInfo, Project } from '@shared/types'
import { dependencyState } from '../deps'

const CHECK_TIMEOUT_MS = 6 * 60_000
const INSTALL_TIMEOUT_MS = 8 * 60_000
const SERVER_TIMEOUT_MS = 60_000
/** A server that dies right after starting isn't running: it has to stay up this long. */
const STABLE_MS = 3000
const OUTPUT_TAIL = 6000
const PROBE_TIMEOUT_MS = 60_000

export interface VerifyDeps {
  preview: {
    info(project: Project): PreviewInfo
    start(project: Project, confirmed: boolean): Promise<PreviewInfo>
    stop(projectId: string): Promise<void>
  }
  probe(url: string, id: string): Promise<RenderSnapshot>
  env(): Promise<NodeJS.ProcessEnv>
  /** Live progress. */
  onStep?(steps: VerificationStep[]): void
  stableMs?: number
}

interface Manifest {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
}

function manifest(dir: string): Manifest | 'invalid' | null {
  const p = join(dir, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Manifest
  } catch {
    return 'invalid'
  }
}

export function packageManagerOf(dir: string): PackageManager {
  const m = manifest(dir)
  return detectPackageManager(readdirSync(dir), m && m !== 'invalid' ? m.packageManager : undefined)
}

/** The quick checks a working copy declares (build waits for the full run at the end). */
export function quickChecks(dir: string, withBuild = false): string[] {
  const m = manifest(dir)
  if (!m || m === 'invalid') return []
  return declaredChecks(m.scripts, packageManagerOf(dir)).filter((c) => withBuild || c.id !== 'build').map((c) => c.command)
}

/** Exactly what verification would run in this folder right now (what you're asked to OK). */
export function commandsFor(project: Project, preview: PreviewInfo): string[] {
  const m = manifest(project.path)
  if (m === 'invalid') return []
  if (!m) return otherChecks(project.path).map((c) => c.command)
  const pm = packageManagerOf(project.path)
  const out: string[] = []
  // always listed when there are dependencies, so a later change to them doesn't need asking again
  if (dependencyState(project.path)?.declared) out.push(installCommand(pm))
  for (const c of declaredChecks(m.scripts, pm)) out.push(c.command)
  if (preview.kind === 'script' && preview.command && preview.expects !== 'process') out.push(preview.command.split(' && ').pop()!)
  return out
}

/** Types, build and tests of a project with no package.json, from its own files. */
function otherChecks(dir: string): { id: 'typecheck' | 'build' | 'test'; label: string; command: string }[] {
  return environmentOf(dir).checks.flatMap((c) => (c.kind === 'typecheck' || c.kind === 'build' || c.kind === 'test' ? [{ id: c.kind, label: c.label, command: c.command }] : []))
}

export function run(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, watch?: { tail?: number; onSpawn?: (pid: number | undefined) => void; onOutput?: (tail: string) => void }): Promise<{ ok: boolean; output: string; timedOut: boolean; ms: number }> {
  const started = Date.now()
  const tail = watch?.tail ?? OUTPUT_TAIL
  return new Promise((resolve) => {
    const [bin, ...args] = command.split(' ')
    // CI=1: test runners run once instead of watching, and nothing waits on a prompt
    const child = spawn(bin, args, { cwd, env: { ...env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let output = ''
    // test runners print the failures first and a summary last: long output keeps its opening as well as its end
    let opening = ''
    let dropped = false
    let timedOut = false
    watch?.onSpawn?.(child.pid)
    const add = (b: Buffer) => {
      const joined = output + b.toString()
      if (joined.length > tail) {
        if (!dropped) opening = joined.slice(0, tail)
        dropped = true
      }
      output = joined.slice(-tail)
      watch?.onOutput?.(output)
    }
    child.stdout!.on('data', add)
    child.stderr!.on('data', add)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGTERM')
      } catch {
        // already gone
      }
    }, timeoutMs)
    const done = (ok: boolean) => {
      clearTimeout(timer)
      resolve({ ok, output: (dropped ? `${opening}\n…\n${output}` : output).replace(/\u001b\[[\d;]*[A-Za-z]/g, ''), timedOut, ms: Date.now() - started })
    }
    child.on('error', (err) => ((output += `\n${err.message}`), done(false)))
    child.on('exit', (code) => done(code === 0 && !timedOut))
  })
}

/**
 * Lets a task's working copy run its checks without installing everything again: it borrows the project
 * folder's packages unless this work changed them, and then it gets its own. False if it can't be made ready.
 */
async function readyWorkingCopy(project: Project, dir: string, env: NodeJS.ProcessEnv, denied: (command: string) => boolean): Promise<boolean> {
  const state = dependencyState(dir)
  if (!state?.declared || state.ok) return true
  const install = installCommand(packageManagerOf(dir))
  const link = join(dir, 'node_modules')
  if (!existsSync(link) && dir !== project.path) {
    if (dependencyProblem(dependencyState(project.path))) {
      if (denied(install) || !(await run(install, project.path, env, INSTALL_TIMEOUT_MS)).ok) return false
    }
    if (existsSync(join(project.path, 'node_modules'))) symlinkSync(join(project.path, 'node_modules'), link)
    if (dependencyState(dir)?.ok) return true
  }
  // never install through the link: that would change the project folder's packages
  if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link)
  return !denied(install) && (await run(install, dir, env, INSTALL_TIMEOUT_MS)).ok && !!dependencyState(dir)?.ok
}

/** The project's own quick checks, run by Autopia in a task's working copy. Same evidence as an agent running them. */
export async function runSelfChecks(project: Project, dir: string, commands: string[], env: NodeJS.ProcessEnv, denied: (command: string) => boolean): Promise<BashEvidence[]> {
  const ready = await readyWorkingCopy(project, dir, env, denied)
  const out: BashEvidence[] = []
  for (const command of commands) {
    if (!ready) {
      out.push({ command, isError: true, output: 'Its packages could not be installed, so this did not run.', ms: 0, at: Date.now(), founderDenied: false, policyDenied: false })
      continue
    }
    const r = await run(command, dir, env, CHECK_TIMEOUT_MS)
    out.push({ command, isError: !r.ok, output: r.output, ms: r.ms, at: Date.now(), founderDenied: false, policyDenied: false })
  }
  return out
}

const firstError = (output: string) =>
  output
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /error|fail|cannot|not found|✖|✗/i.test(l))
    ?.slice(0, 220) ?? 'See the output.'

/** Web frameworks are servers for sure; an unknown script might be a CLI or a desktop app. */
const isServer = (framework: string | null) => !!framework

/**
 * Steps run in order; a failed check doesn't stop the others, so one repair can see everything at once.
 * The server and page are only skipped when dependencies couldn't be installed at all.
 */
export async function runVerification(project: Project, deps: VerifyDeps, denied: (command: string) => boolean): Promise<VerificationStep[]> {
  const steps: VerificationStep[] = []
  const add = (s: VerificationStep) => {
    steps.push(s)
    deps.onStep?.([...steps])
    return s
  }
  const m = manifest(project.path)
  if (m === 'invalid') {
    add({ id: 'config', label: 'Configuration', status: 'failed', command: null, detail: 'package.json can’t be parsed.', ms: 0 })
    return steps
  }
  const env = await deps.env()
  const pm = packageManagerOf(project.path)

  let installed = true
  if (m) {
    const problem = dependencyProblem(dependencyState(project.path))
    if (problem) {
      const command = installCommand(pm)
      if (denied(command)) {
        installed = false
        add({ id: 'install', label: 'Install', status: 'blocked', command, detail: `Your organization’s policy denies \`${command}\`.`, ms: 0 })
      } else {
        const r = await run(command, project.path, env, INSTALL_TIMEOUT_MS)
        const still = dependencyProblem(dependencyState(project.path))
        installed = r.ok && !still
        add({ id: 'install', label: 'Install', status: installed ? 'passed' : 'failed', command, detail: installed ? `Installed with ${pm}.` : r.timedOut ? 'The install timed out.' : (still && r.ok ? `It finished, but ${still}` : firstError(r.output)), output: installed ? undefined : r.output, ms: r.ms })
      }
    } else if (dependencyState(project.path)?.declared) {
      add({ id: 'install', label: 'Install', status: 'passed', command: null, detail: 'Every declared package is installed.', ms: 0 })
    }
    if (!installed) return steps
  }
  for (const c of m ? declaredChecks(m.scripts, pm) : otherChecks(project.path)) {
    if (denied(c.command)) {
      add({ id: c.id, label: c.label, status: 'blocked', command: c.command, detail: `Your organization’s policy denies \`${c.command}\`.`, ms: 0 })
      continue
    }
    const r = await run(c.command, project.path, env, CHECK_TIMEOUT_MS)
    add({ id: c.id, label: c.label, status: r.ok ? 'passed' : 'failed', command: c.command, detail: r.ok ? 'Passed.' : r.timedOut ? `Timed out after ${CHECK_TIMEOUT_MS / 60_000} minutes.` : firstError(r.output), output: r.ok ? undefined : r.output, ms: r.ms })
  }

  // the app itself: reuse a server you already have running, otherwise start one just for this
  const before = deps.preview.info(project)
  if (before.kind === 'none') return steps
  if (before.expects === 'process') {
    add({ id: 'server', label: 'Dev server', status: 'skipped', command: null, detail: 'This project’s script doesn’t run a web server, so there’s no page to check.', ms: 0 })
    return steps
  }
  if (before.kind === 'script' && before.command && denied(before.command.split(' && ').pop()!)) {
    add({ id: 'server', label: 'Dev server', status: 'blocked', command: before.command, detail: `Your organization’s policy denies \`${before.command}\`.`, ms: 0 })
    return steps
  }
  const started = Date.now()
  const reused = before.status === 'running'
  try {
    if (!reused) await deps.preview.start(project, true)
    const deadline = Date.now() + SERVER_TIMEOUT_MS
    while (deps.preview.info(project).status === 'starting' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
    await new Promise((r) => setTimeout(r, deps.stableMs ?? STABLE_MS))
    const now = deps.preview.info(project)
    const command = before.kind === 'script' ? (now.command ?? before.command) : null
    if (now.status !== 'running' || !now.url) {
      const error = now.status === 'starting' ? `The server didn’t start listening within ${SERVER_TIMEOUT_MS / 1000}s.` : (now.error ?? 'The dev server stopped.')
      // a script that finishes on its own, or an unknown one that never listens, isn't a web server failing
      const notAServer = /exited \(code 0\)/.test(error) || (!isServer(before.framework) && /did(n’t| not) start listening/.test(error))
      add({ id: 'server', label: 'Dev server', status: notAServer ? 'skipped' : 'failed', command, detail: notAServer ? 'This project’s script doesn’t run a web server, so there’s no page to check.' : error, output: notAServer ? undefined : now.logs.slice(-40).join('\n'), ms: Date.now() - started })
      return steps
    }
    add({ id: 'server', label: 'Dev server', status: 'passed', command, detail: `Running and stable at ${now.url}`, ms: Date.now() - started })

    // an API isn't a page: it answered, and that's what can be said without inventing anything
    const served = await fetch(now.url, { signal: AbortSignal.timeout(5000) }).then((x) => x.headers.get('content-type') ?? '', () => '')
    if (served && !/html/i.test(served)) {
      add({ id: 'render', label: 'Rendered page', status: 'skipped', command: null, detail: `It answers with ${served.split(';')[0]}, not a page.`, ms: 0 })
      return steps
    }
    const probeStart = Date.now()
    const snap = await Promise.race([
      deps.probe(now.url, `${project.id}-${Date.now()}`),
      new Promise<RenderSnapshot>((resolve) => setTimeout(() => resolve({ loadError: `the page check didn’t finish within ${PROBE_TIMEOUT_MS / 1000}s`, httpStatus: null, textLength: 0, mediaCount: 0, overlay: null, uniformFrame: null, exceptions: [], consoleErrors: [], failedRequests: [] }), PROBE_TIMEOUT_MS))
    ])
    const issues = judgeRender(snap)
    // the server may have died while the page loaded
    const after = deps.preview.info(project)
    if (after.status !== 'running') issues.push({ kind: 'load', message: `The dev server stopped while the page loaded: ${after.error ?? 'no error printed'}` })
    add({
      id: 'render',
      label: 'Rendered page',
      status: issues.length ? 'failed' : 'passed',
      command: null,
      detail: issues.length ? issues[0].message : `Rendered ${snap.textLength} characters${snap.mediaCount ? ` and ${plural(snap.mediaCount, 'image')}` : ''}, no runtime errors.`,
      output: issues.length ? [...issues.map((i) => i.message), ...snap.consoleErrors.slice(0, 8).map((e) => `console.error: ${e}`), ...after.logs.slice(-15)].join('\n') : undefined,
      ms: Date.now() - probeStart
    })
    return steps
  } finally {
    // leave things as they were: your own preview keeps running, ours doesn't linger
    if (!reused) await deps.preview.stop(project.id).catch(() => undefined)
  }
}
