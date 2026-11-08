// Reads what a project's folder says about itself, for `readEnvironment` to interpret. Only reads; the one thing it ever
// writes is your own settings, inside `.autopia`, which never reaches git.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandProblem, readEnvironment, type OpsConfig, type ProjectEnvironment } from '@shared/environment'
import type { Project } from '@shared/types'

const WORTH_READING = ['index.html', 'package.json', '.nvmrc', '.python-version', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'go.mod', 'Cargo.toml', 'Package.swift', 'Gemfile', 'Makefile', 'makefile']
const MAX_READ = 200_000
const CONFIG = '.autopia/operations.json'
const SKIP = new Set(['node_modules', '.git', '.autopia', 'dist', 'build', 'out', '.next', 'coverage', '.venv', 'venv', '__pycache__', 'target'])

const text = (path: string): string | undefined => {
  try {
    return statSync(path).size <= MAX_READ ? readFileSync(path, 'utf8') : undefined
  } catch {
    return undefined
  }
}

export function opsConfig(root: string): OpsConfig | null {
  const raw = text(join(root, CONFIG))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: OpsConfig = {}
    for (const k of ['run', 'build', 'test', 'typecheck', 'lint'] as const) if (typeof parsed[k] === 'string' && !commandProblem(parsed[k] as string)) out[k] = (parsed[k] as string).trim()
    if (parsed.expects === 'port' || parsed.expects === 'process') out.expects = parsed.expects
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

export function saveOpsConfig(project: Project, config: OpsConfig, exclude: (path: string) => void): void {
  const clean: OpsConfig = {}
  for (const k of ['run', 'build', 'test', 'typecheck', 'lint'] as const) {
    const value = config[k]?.trim()
    if (!value) continue
    const problem = commandProblem(value)
    if (problem) throw new Error(problem)
    clean[k] = value
  }
  if (config.expects) clean.expects = config.expects
  mkdirSync(join(project.path, '.autopia'), { recursive: true })
  exclude(project.path)
  writeFileSync(join(project.path, CONFIG), JSON.stringify(clean, null, 2))
}

/** Looks at the folder as it is right now. A folder that has gone reads as an empty one. */
export function environmentOf(root: string): ProjectEnvironment {
  let files: string[] = []
  try {
    files = readdirSync(root)
  } catch {
    // reported by whatever tries to run in it
  }
  const read: Record<string, string> = {}
  for (const name of WORTH_READING) {
    if (!files.includes(name)) continue
    const t = text(join(root, name))
    if (t !== undefined) read[name] = t
  }
  for (const d of ['public', 'dist', 'build', 'site']) if (files.includes(d) && existsSync(join(root, d, 'index.html'))) read[`${d}/index.html`] = ''
  const isGo = files.includes('go.mod')
  const goSources = isGo ? goFiles(root) : []
  return readEnvironment({
    files,
    read,
    goMain: goSources.some((f) => !f.endsWith('_test.go') && /^package main\b/m.test(text(join(root, f)) ?? '')),
    goTests: isGo && hasGoTests(root, 0),
    config: opsConfig(root)
  })
}

const goFiles = (root: string) => {
  try {
    return readdirSync(root).filter((n) => n.endsWith('.go'))
  } catch {
    return []
  }
}

function hasGoTests(dir: string, depth: number): boolean {
  if (depth > 4) return false
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('_test.go')) return true
      if (SKIP.has(name) || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory() && hasGoTests(p, depth + 1)) return true
    }
  } catch {
    // unreadable: nothing shown
  }
  return false
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | null>((resolve) => {
    execFile('git', args, { cwd, timeout: 8000, maxBuffer: 8_000_000 }, (err, out) => resolve(err ? null : out))
  })

export interface SourceState {
  /** Different whenever the code is. A result only counts for the stamp it ran against. */
  stamp: string
  commit: string | null
  uncommitted: number | null
}

/** What exactly the code is right now. With git: the commit, plus what each uncommitted file really is at this moment. */
export async function sourceState(project: Project): Promise<SourceState> {
  const hash = createHash('sha1')
  if (project.gitEnabled) {
    const [head, status] = await Promise.all([git(project.path, ['rev-parse', 'HEAD']), git(project.path, ['status', '--porcelain', '--no-renames'])])
    if (status !== null) {
      // Autopia's own folder isn't the project's code, even before it's been excluded from git
      const lines = status.split('\n').filter((l) => l && !/^.. "?\.autopia(\/|"?$)/.test(l))
      hash.update(head ?? 'no-commit')
      for (const l of lines) {
        hash.update(l)
        // the status line stays the same however many more times a changed file changes
        try {
          const st = statSync(join(project.path, l.slice(3).replace(/^"|"$/g, '')))
          hash.update(`${st.mtimeMs}:${st.size}`)
        } catch {
          // deleted: the status line says so
        }
      }
      return { stamp: hash.digest('hex'), commit: head?.trim() ?? null, uncommitted: lines.length }
    }
  }
  walkStamp(project.path, hash, 0, { left: 6000 })
  return { stamp: hash.digest('hex'), commit: null, uncommitted: null }
}

function walkStamp(dir: string, hash: ReturnType<typeof createHash>, depth: number, budget: { left: number }): void {
  if (depth > 8 || budget.left <= 0) return
  let names: string[] = []
  try {
    names = readdirSync(dir).sort()
  } catch {
    return
  }
  for (const name of names) {
    if (SKIP.has(name) || name === '.DS_Store' || budget.left-- <= 0) continue
    const p = join(dir, name)
    try {
      const st = statSync(p)
      if (st.isDirectory()) walkStamp(p, hash, depth + 1, budget)
      else hash.update(`${p}:${st.mtimeMs}:${st.size}`)
    } catch {
      // gone while looking
    }
  }
}

/** Names set in the project's .env files. The values are never read out of this function. */
export function envFileNames(root: string): string[] {
  const out = new Set<string>()
  for (const f of ['.env', '.env.local', '.env.development', '.env.production']) {
    for (const m of (text(join(root, f)) ?? '').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\S/gm)) out.add(m[1])
  }
  return [...out]
}

/** Is a program there, and what does it say its version is. */
export async function toolVersion(tool: string, env: NodeJS.ProcessEnv): Promise<{ found: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile(tool, ['--version'], { env, timeout: 4000 }, (err, out, errOut) => {
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ found: false, version: null })
      resolve({ found: true, version: /\d+(\.\d+)+/.exec(`${out}${errOut}`)?.[0] ?? null })
    })
  })
}
