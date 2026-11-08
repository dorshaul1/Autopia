import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Scenario } from './scenarios'

/** Everything the benchmark creates lives under here; nothing outside it is ever written or removed. */
export const SANDBOX_ROOT = join(tmpdir(), 'autopia-bench')

const SKIP = new Set(['node_modules', '.git', '.autopia', 'dist'])

export interface Sandbox {
  root: string
  /** The disposable working copy the agent changes. */
  repo: string
  /** Hidden checks, outside the repo so the agent never sees them. */
  verify: string
}

/** A fresh, disposable copy of the scenario's initial state. */
export function createSandbox(s: Scenario): Sandbox {
  mkdirSync(SANDBOX_ROOT, { recursive: true })
  const root = mkdtempSync(join(SANDBOX_ROOT, `${s.id}-`))
  const repo = join(root, 'repo')
  cpSync(s.repo, repo, { recursive: true })
  return { root, repo, verify: join(root, 'verify') }
}

/** Removes a sandbox. Refuses anything outside SANDBOX_ROOT. */
export function removeSandbox(sb: Sandbox): void {
  if (!sb.root.startsWith(SANDBOX_ROOT + '/')) throw new Error(`refusing to remove ${sb.root}`)
  rmSync(sb.root, { recursive: true, force: true })
}

/** Reference solution overlay: copies files over the repo; `.delete` lists files to remove. */
export function applySolution(s: Scenario, sb: Sandbox): void {
  for (const f of walk(s.solution)) {
    if (f === '.delete') continue
    cpSync(join(s.solution, f), join(sb.repo, f))
  }
  const del = join(s.solution, '.delete')
  if (existsSync(del)) for (const f of readFileSync(del, 'utf8').split('\n').filter(Boolean)) rmSync(join(sb.repo, f), { force: true })
}

export function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((f) => {
    if (SKIP.has(f)) return []
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)]
  })
}

export interface CheckRun {
  command: string
  ok: boolean
  exitCode: number | null
  ms: number
  /** Last lines of output, for the report. */
  tail: string
}

/** Environment for verification: no npm/vite runner variables, no Claude session variables. */
function verifyEnv(sb: Sandbox): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^(npm_|VITE|CLAUDE|ANTHROPIC|NODE_OPTIONS$)/.test(k)) env[k] = v
  return { ...env, BENCH_REPO: sb.repo, BENCH_VERIFY: sb.verify, CI: '1' }
}

/** Runs the independent checks. Hidden checks are copied in only now, next to (not inside) the repo. */
export async function runChecks(s: Scenario, sb: Sandbox, commands: string[], timeoutMs = 120_000): Promise<CheckRun[]> {
  rmSync(sb.verify, { recursive: true, force: true })
  cpSync(s.hidden, sb.verify, { recursive: true })
  const out: CheckRun[] = []
  for (const command of commands) {
    const t0 = Date.now()
    const r = await sh(command, sb.repo, verifyEnv(sb), timeoutMs)
    out.push({ command, ok: r.code === 0, exitCode: r.code, ms: Date.now() - t0, tail: r.output.split('\n').slice(-25).join('\n').slice(-3000) })
  }
  rmSync(sb.verify, { recursive: true, force: true })
  return out
}

function sh(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((res) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => {
      output += `\n[benchmark] timed out after ${timeoutMs / 1000}s`
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.on('close', (code) => (clearTimeout(timer), res({ code, output })))
  })
}

export interface ChangeStats {
  files: number
  added: number
  removed: number
  paths: string[]
}

/** What the run changed relative to the scenario's initial state (line multiset diff, no git needed). */
export function changes(s: Scenario, sb: Sandbox): ChangeStats {
  const before = new Set(walk(s.repo))
  const after = new Set(walk(sb.repo))
  const paths = [...new Set([...before, ...after])].sort()
  let added = 0
  let removed = 0
  const changed: string[] = []
  for (const p of paths) {
    const a = before.has(p) ? readFileSync(join(s.repo, p), 'utf8').split('\n') : []
    const b = after.has(p) ? readFileSync(join(sb.repo, p), 'utf8').split('\n') : []
    const count = new Map<string, number>()
    for (const l of a) count.set(l, (count.get(l) ?? 0) + 1)
    let add = 0
    for (const l of b) {
      const n = count.get(l) ?? 0
      if (n > 0) count.set(l, n - 1)
      else add++
    }
    const rem = [...count.values()].reduce((x, y) => x + y, 0)
    if (add || rem || before.has(p) !== after.has(p)) {
      changed.push(p)
      added += add
      removed += rem
    }
  }
  return { files: changed.length, added, removed, paths: changed }
}
