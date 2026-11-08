// Deterministic repository indexing: facts read straight from manifests and the file list.
// No AI, no full-file scans: a few small manifest reads plus `git ls-files`. Secret files are
// never opened and never listed.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { KnowledgeKind } from '@shared/types'
import { resolveLoginEnv } from '../claude/cli'
import { isSecretPath, redact } from './secrets'

const execFileAsync = promisify(execFile)
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.venv', 'venv', '__pycache__', 'target', '.autopia', '.turbo', '.cache'])

export interface Fact {
  kind: KnowledgeKind
  topic: string
  title: string
  text: string
  files: string[]
}

/** What one source file imports and exports, kept between refreshes and re-read only when it changes. */
export interface FileScan {
  /** mtime (ms) and size when read: a changed file is re-read, an unchanged one never is. */
  m: number
  s: number
  /** Relative import specifiers as written (resolved against the current file list on every refresh). */
  i: string[]
  /** Exported names (functions, classes, constants), for matching requests to the code. '*' = not knowable statically. */
  x: string[]
  /** Names imported by name per specifier (`import { a, b as c } from './x'` → { './x': ['a', 'b'] }). */
  n?: Record<string, string[]>
}

export interface IndexResult {
  facts: Fact[]
  /** Relative imports between source files (file -> files it imports). */
  graph: Record<string, string[]>
  /** Exported names per source file. */
  symbols: Record<string, string[]>
  /** importer → target → names it imports by name. */
  uses: Record<string, Record<string, string[]>>
  /** Per-file scan cache for the next (incremental) refresh. */
  scan: Record<string, FileScan>
  /** Source files actually read this time (the rest came from the cache). */
  reread: number
  files: number
  skippedSecrets: number
  hasClaudeMd: boolean
}

export async function listFiles(root: string, git: boolean): Promise<string[]> {
  if (git) {
    const env = await resolveLoginEnv()
    const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, env, maxBuffer: 32 * 1024 * 1024 })
    return stdout.split('\n').filter(Boolean)
  }
  const out: string[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 6 || out.length > 5000) return
    for (const name of readdirSync(dir)) {
      if (IGNORED_DIRS.has(name)) continue
      const full = join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      try {
        if (statSync(full).isDirectory()) walk(full, r, depth + 1)
        else out.push(r)
      } catch {
        // unreadable entry: skip
      }
    }
  }
  walk(root, '', 0)
  return out
}

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', swift: 'Swift', cs: 'C#',
  css: 'CSS', scss: 'SCSS', html: 'HTML', vue: 'Vue', svelte: 'Svelte', sql: 'SQL', sh: 'Shell'
}

const FRAMEWORKS: [string, string][] = [
  ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['vite', 'Vite'],
  ['electron', 'Electron'], ['express', 'Express'], ['fastify', 'Fastify'], ['koa', 'Koa'], ['@nestjs/core', 'NestJS'],
  ['tailwindcss', 'Tailwind CSS'], ['prisma', 'Prisma'], ['typeorm', 'TypeORM'], ['better-sqlite3', 'SQLite (better-sqlite3)'],
  ['jest', 'Jest'], ['vitest', 'Vitest'], ['mocha', 'Mocha'], ['playwright', 'Playwright'], ['@playwright/test', 'Playwright'],
  ['eslint', 'ESLint'], ['prettier', 'Prettier'], ['typescript', 'TypeScript']
]

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Facts about the project, each tied to the files it was read from (for freshness tracking). */
export async function indexRepository(root: string, git: boolean, prevScan: Record<string, FileScan> = {}): Promise<IndexResult> {
  const all = await listFiles(root, git).catch(() => [] as string[])
  const skippedSecrets = all.filter(isSecretPath).length
  const files = all.filter((f) => !isSecretPath(f) && !f.split('/').some((seg) => IGNORED_DIRS.has(seg)))
  const has = (f: string) => files.includes(f)
  const facts: Fact[] = []

  // languages by file count
  const langs = new Map<string, number>()
  for (const f of files) {
    const l = LANG[f.split('.').pop()?.toLowerCase() ?? '']
    if (l) langs.set(l, (langs.get(l) ?? 0) + 1)
  }
  const langText = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${l} (${n} files)`).join(', ')

  const pkg = has('package.json') ? readJson(join(root, 'package.json')) : null
  const deps = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) }
  const frameworks = FRAMEWORKS.filter(([d]) => d in deps).map(([, n]) => n)
  const stackBits = [langText && `Languages: ${langText}.`, frameworks.length ? `Frameworks/tools: ${[...new Set(frameworks)].join(', ')}.` : 'No framework dependencies.']
  if (pkg) stackBits.push(`Node package "${pkg.name ?? '(unnamed)'}", module type ${pkg.type === 'module' ? 'ESM ("type": "module")' : 'CommonJS (default)'}.`)
  for (const [f, label] of [
    ['pyproject.toml', 'Python project (pyproject.toml)'],
    ['requirements.txt', 'Python dependencies in requirements.txt'],
    ['go.mod', 'Go module (go.mod)'],
    ['Cargo.toml', 'Rust crate (Cargo.toml)']
  ] as const)
    if (has(f)) stackBits.push(`${label}.`)
  if (stackBits.length) facts.push({ kind: 'stack', topic: 'stack', title: 'Technology stack', text: stackBits.filter(Boolean).join(' '), files: ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].filter(has) })

  // build / test / dev workflow
  const scripts = (pkg?.scripts as Record<string, string>) ?? {}
  const wf = Object.entries(scripts)
    .filter(([k]) => /^(dev|start|build|test|lint|typecheck|type-check|format|preview|serve)$/.test(k))
    .map(([k, v]) => `\`npm ${k === 'test' || k === 'start' ? k : `run ${k}`}\` → ${v}`)
  if (has('Makefile')) wf.push('Makefile present (make targets).')
  if (has('pytest.ini') || files.some((f) => /(^|\/)tests?\/.*\.py$/.test(f))) wf.push('Python tests (pytest).')
  if (wf.length) facts.push({ kind: 'workflow', topic: 'workflow', title: 'Build, test and run', text: wf.join('\n'), files: ['package.json', 'Makefile'].filter(has) })

  // important dependencies (names and versions only)
  const depNames = Object.keys(deps)
  if (depNames.length) {
    facts.push({
      kind: 'dependency',
      topic: 'dependencies',
      title: 'Dependencies',
      text: depNames.slice(0, 30).map((d) => `${d}@${deps[d]}`).join(', ') + (depNames.length > 30 ? ` and ${depNames.length - 30} more` : ''),
      files: ['package.json']
    })
  }

  // modules: top-level areas and entry points
  const tops = new Map<string, string[]>()
  for (const f of files) {
    const top = f.includes('/') ? f.split('/')[0] : '.'
    tops.set(top, [...(tops.get(top) ?? []), f])
  }
  const entries = [pkg?.main, (pkg?.bin && typeof pkg.bin === 'string' ? pkg.bin : null), 'index.html', 'public/index.html', 'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.tsx', 'src/App.tsx', 'server.js', 'app.py', 'main.py', 'main.go']
    .filter((x): x is string => typeof x === 'string' && has(x))
  const moduleLines = [...tops.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([d, fs]) => `${d === '.' ? 'root' : `${d}/`} (${fs.length} files${d === '.' ? `: ${fs.slice(0, 6).join(', ')}` : `, e.g. ${fs.slice(0, 3).join(', ')}`})`)
  facts.push({
    kind: 'module',
    topic: 'layout',
    title: 'Repository layout',
    text: `${files.length} files. ${entries.length ? `Entry points: ${entries.join(', ')}. ` : ''}Areas: ${moduleLines.join('; ')}.`,
    files: entries
  })

  // conventions from config files
  const conv: string[] = []
  const conf: string[] = []
  const tsconfig = has('tsconfig.json') ? readJson(join(root, 'tsconfig.json')) : null
  if (tsconfig) {
    const strict = (tsconfig.compilerOptions as Record<string, unknown> | undefined)?.strict
    conv.push(`TypeScript${strict ? ' strict mode' : ''} (tsconfig.json).`)
    conf.push('tsconfig.json')
  }
  for (const f of ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs']) if (has(f)) (conv.push(`ESLint config in ${f}.`), conf.push(f))
  for (const f of ['.prettierrc', '.prettierrc.json', 'prettier.config.js', '.editorconfig']) if (has(f)) (conv.push(`Formatting rules in ${f}.`), conf.push(f))
  const tests = files.filter((f) => TEST_FILE.test(f))
  const testDirs = [...new Set(tests.map((f) => f.match(/^(.*?(?:^|\/)(?:test|tests|__tests__))\//)?.[1]).filter(Boolean))]
  if (testDirs.length) conv.push(`Test folders: ${testDirs.slice(0, 4).map((d) => `${d}/`).join(', ')}.`)
  if (tests.length) conv.push(`Tests live next to code as ${[...new Set(tests.map((t) => t.replace(/^.*?(\.(test|spec)\.[jt]sx?)$/, '*$1').replace(/^.*\/(test_).*$/, 'test_*.py')))].slice(0, 3).join(', ')} (${tests.length} files${tests[0] ? `, e.g. ${tests[0]}` : ''}).`)
  if (scripts.test?.includes('node --test')) conv.push("Tests use Node's built-in test runner (node:test).")
  if (conv.length) facts.push({ kind: 'convention', topic: 'conventions', title: 'Conventions', text: conv.join(' '), files: conf })

  const hasClaudeMd = has('CLAUDE.md') || has('.claude/CLAUDE.md')
  const scanned = scanSources(root, files, prevScan)
  // what everything else leans on: changing these has the widest reach
  const importers = new Map<string, number>()
  for (const [f, deps] of Object.entries(scanned.graph)) if (!TEST_FILE.test(f)) for (const d of deps) importers.set(d, (importers.get(d) ?? 0) + 1)
  const hubs = [...importers].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (hubs.length) facts.push({ kind: 'module', topic: 'layout:hubs', title: 'Most relied-on files', text: hubs.map(([f, n]) => `${f} (imported by ${n})`).join(', '), files: hubs.map(([f]) => f) })
  return { facts: facts.map((f) => ({ ...f, text: redact(f.text) })), ...scanned, files: files.length, skippedSecrets, hasClaudeMd }
}

export const TEST_FILE = /(^|\/)(test|tests|__tests__)\/.+\.[cm]?[jt]sx?$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/

/** Source files read per refresh at most; beyond this the graph covers the first ones (sorted). */
const MAX_SOURCES = 5000
const SOURCE = /\.(m?[jt]sx?|cjs|css|scss|html|vue|svelte)$/

/**
 * Imports and exports of every source file, incrementally: a file whose size and mtime are unchanged
 * since the last refresh is not read again. Read-only, size-capped, no AI.
 */
export function scanSources(
  root: string,
  files: string[],
  prev: Record<string, FileScan> = {}
): { graph: Record<string, string[]>; symbols: Record<string, string[]>; uses: Record<string, Record<string, string[]>>; scan: Record<string, FileScan>; reread: number } {
  const set = new Set(files)
  const graph: Record<string, string[]> = {}
  const symbols: Record<string, string[]> = {}
  const scan: Record<string, FileScan> = {}
  let reread = 0
  for (const f of files.filter((x) => SOURCE.test(x)).sort().slice(0, MAX_SOURCES)) {
    let st: { mtimeMs: number; size: number }
    try {
      st = statSync(join(root, f))
    } catch {
      continue
    }
    if (st.size > 200_000) continue
    let entry = prev[f]
    if (!entry || entry.m !== st.mtimeMs || entry.s !== st.size || !Array.isArray(entry.i) || !Array.isArray(entry.x) || !entry.n || typeof entry.n !== 'object') {
      let text: string
      try {
        text = readFileSync(join(root, f), 'utf8')
      } catch {
        continue
      }
      reread++
      entry = { m: st.mtimeMs, s: st.size, i: importSpecs(text), x: exportedNames(text), n: importedNames(text) }
    }
    scan[f] = entry
    // every JS/TS module gets an export list, even an empty one: losing all exports is a change too
    if (/\.(m?[jt]sx?|cjs)$/.test(f)) symbols[f] = entry.x
    const out = resolveImports(f, entry.i, set)
    if (out.length) graph[f] = out
  }
  // which exported names each importer relies on, per resolved target file
  const uses: Record<string, Record<string, string[]>> = {}
  for (const [f, entry] of Object.entries(scan)) {
    for (const [spec, names] of Object.entries(entry.n ?? {})) {
      const target = resolveImports(f, [spec], set)[0]
      if (target && names.length) (uses[f] ??= {})[target] = [...new Set([...((uses[f] ?? {})[target] ?? []), ...names])]
    }
  }
  return { graph, symbols, uses, scan, reread }
}

/** Relative imports in JS/TS/CSS/HTML sources, resolved to repository paths. */
export function importGraph(root: string, files: string[]): Record<string, string[]> {
  return scanSources(root, files).graph
}

function importSpecs(text: string): string[] {
  const specs = [
    ...text.matchAll(/(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]|<script[^>]+src=["']([^"']+)["']|<link[^>]+href=["']([^"']+\.css)["']/g)
  ].map((m) => m.slice(1).find(Boolean)!)
  return [...new Set(specs.filter((spec) => spec && !/^(https?:)?\/\//.test(spec) && (spec.startsWith('.') || spec.startsWith('/'))))]
}

/** Named ESM imports (and named re-exports) per specifier; default and namespace imports are not named. */
function importedNames(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of text.matchAll(/(?:import|export)\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!m[2].startsWith('.') && !m[2].startsWith('/')) continue
    const names = m[1]
      .split(',')
      .map((p) => p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default')
    if (names.length) out[m[2]] = [...new Set([...(out[m[2]] ?? []), ...names])]
  }
  return out
}

function exportedNames(text: string): string[] {
  const names = new Set<string>()
  // re-exporting everything or assigning module.exports: the export list cannot be known statically
  if (/export\s*\*\s*from|module\.exports\s*=/.test(text)) names.add('*')
  for (const m of text.matchAll(/export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const\s+enum|const|let|var|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of text.matchAll(/export\s*(?:type\s+)?\{([^}]*)\}/g)) for (const part of m[1].split(',')) {
    const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
    if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') names.add(name)
  }
  for (const m of text.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1])
  return [...names].slice(0, 200)
}

/** Importers whose relative imports now point at a file this change deleted. */
export function importsOfDeleted(scan: Record<string, FileScan>, deleted: string[]): { importer: string; target: string }[] {
  if (!deleted.length) return []
  const gone = new Set(deleted)
  return Object.entries(scan).flatMap(([importer, e]) => resolveImports(importer, e.i, gone).map((target) => ({ importer, target })))
}

/**
 * Named imports that the imported file does not export: a guaranteed failure when the module loads.
 * Only edges touching `focus` are checked (the files a change touched), and a target whose exports
 * cannot be known statically ('*', or no scan) is skipped rather than guessed.
 */
export function brokenImports(uses: Record<string, Record<string, string[]>>, symbols: Record<string, string[]>, focus: string[]): { importer: string; target: string; missing: string[] }[] {
  const f = new Set(focus)
  const out: { importer: string; target: string; missing: string[] }[] = []
  for (const [importer, targets] of Object.entries(uses)) {
    for (const [target, names] of Object.entries(targets)) {
      if (!f.has(importer) && !f.has(target)) continue
      const exported = symbols[target]
      if (!exported || exported.includes('*')) continue
      const missing = names.filter((n) => !exported.includes(n))
      if (missing.length) out.push({ importer, target, missing })
    }
  }
  return out
}

export function resolveImports(f: string, specs: string[], set: Set<string>): string[] {
  const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''
  const out = new Set<string>()
  for (const spec of specs) {
    if (!spec || /^(https?:)?\/\//.test(spec) || (!spec.startsWith('.') && !spec.startsWith('/'))) continue
    const base = spec.startsWith('/') ? spec.slice(1) : join(dir, spec)
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'].map((e) => base + e), ...['index.ts', 'index.tsx', 'index.js'].map((i) => join(base, i))]
    const hit = candidates.map((c) => c.replace(/^\.\//, '')).find((c) => set.has(c)) ?? (spec.startsWith('/') && dir.startsWith('public') ? candidates.map((c) => join('public', c)).find((c) => set.has(c)) : undefined)
    if (hit && hit !== f) out.add(hit)
  }
  return [...out]
}

export function existsIn(root: string, rel: string): boolean {
  return existsSync(join(root, rel))
}
