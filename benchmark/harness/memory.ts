// Deterministic benchmark of project memory (no AI calls): drives the real Memory class against a
// real SQLite database and the real indexer, on the benchmark scenario repositories and on a
// generated large repository. Every number is measured here; `--legacy` runs the pre-Phase-15
// behaviour where the code keeps it switchable (task file targeting).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { Memory } from '../../src/main/memory/memory'
import type { Project } from '../../src/shared/types'
import { createSandbox, removeSandbox, walk } from './sandbox'
import { BENCH_ROOT, loadScenarios } from './scenarios'

const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

/** Notes about unrelated work, as a long-lived project accumulates them. None should reach these tasks. */
const DISTRACTORS = [
  { kind: 'decision' as const, title: 'Use JWT sessions for login', text: 'Auth uses short-lived JWTs in an httpOnly cookie; refresh tokens rotate.', files: ['src/auth/session.ts'] },
  { kind: 'handoff' as const, title: 'T7 Checkout page', text: 'Checkout posts to /api/orders and shows the Stripe card element; totals come from the cart service.', files: ['web/checkout.tsx'] },
  { kind: 'completed' as const, title: 'Dark mode toggle', text: 'Added a theme switch in settings.css with prefers-color-scheme fallback.', files: ['web/settings.css'] },
  { kind: 'decision' as const, title: 'Postgres for analytics events', text: 'Events go to a partitioned Postgres table, not the app database.', files: ['infra/events.sql'] },
  { kind: 'limitation' as const, title: 'Image uploads capped at 5 MB', text: 'The CDN rejects larger uploads; resize on the client first.', files: ['web/upload.ts'] }
]

/**
 * Unrelated application code around the scenario, so the task lives in a codebase too big for the
 * repository layout to name every file (as in any real project). 12 areas × 20 files, with imports.
 */
const FILLER_AREAS = ['billing', 'accounts', 'search-index', 'notifications', 'admin', 'analytics', 'shipping', 'catalog', 'reviews', 'payments', 'audit', 'scheduler']
const NEIGHBOURS = ['address', 'cache', 'config', 'dates', 'errors', 'format', 'http', 'ids', 'logger', 'money', 'paging', 'retry', 'strings', 'units', 'validate']
function addFiller(root: string): void {
  // neighbours in the scenario's own folders (real folders hold more than the files a task touches)
  for (const dir of new Set(walk(root).filter((f) => f.includes('/')).map((f) => f.slice(0, f.lastIndexOf('/'))))) {
    for (const n of NEIGHBOURS) {
      const name = /(^|\/)(test|tests)$/.test(dir) ? `${n}.test.js` : `${n}.js`
      // never touch a scenario file
      if (!existsSync(join(root, dir, name))) writeFileSync(join(root, dir, name), `export const ${n} = (x) => x\n`)
    }
  }
  for (const area of FILLER_AREAS) {
    mkdirSync(join(root, 'app', area), { recursive: true })
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(root, 'app', area, `${area}-${i}.js`), `import { helper } from './${area}-${(i + 1) % 20}.js'\nexport function ${area.replace(/-/g, '_')}${i}(x) { return helper(x) }\nexport const helper = (x) => x\n`)
    }
  }
}

const project = (repo: Repo, path: string, name: string): Project => repo.createProject({ name, path, goal: '', gitEnabled: false, baseBranch: null })

interface ScenarioRow {
  scenario: string
  modified: string[]
  surfacedModified: string[]
  relatedTests: string[]
  surfacedTests: string[]
  distractorsInjected: number
  /** Files matched from the request, and how many of them the reference solution really changes. */
  matched: string[]
  matchedCorrect: number
  contextChars: number
  ms: number
}

async function retrieval(legacy: boolean): Promise<ScenarioRow[]> {
  const rows: ScenarioRow[] = []
  for (const s of loadScenarios()) {
    const sb = createSandbox(s)
    addFiller(sb.repo)
    const db = openDatabase(':memory:')
    const repo = new Repo(db)
    const memory = new Memory(repo)
    const p = project(repo, sb.repo, s.id)
    for (const d of DISTRACTORS) await memory.remember(p, { ...d, source: 'earlier task' })
    const request = s.steps[0].request
    const t0 = performance.now()
    // the query an implementation task gets when its plan names no files (direct and light tasks)
    const pack = await memory.retrieve(p, { purpose: 'task', text: request, files: [], size: 'm', match: !legacy })
    const ms = performance.now() - t0
    const initial = new Set(walk(s.repo))
    const solution = walk(s.solution).filter((f) => f !== '.delete')
    let deleted: string[] = []
    try {
      deleted = readFileSync(join(s.solution, '.delete'), 'utf8').split('\n').filter(Boolean)
    } catch {
      // no deletions in this solution
    }
    const modified = [...new Set([...solution.filter((f) => initial.has(f)), ...deleted])].filter((f) => !TEST_FILE.test(f))
    const graph = repo.meta<Record<string, string[]>>(`memory-graph:${p.id}`) ?? {}
    const relatedTests = [...initial].filter((f) => TEST_FILE.test(f) && (graph[f] ?? []).some((x) => modified.includes(x)))
    const mentioned = (f: string) => pack.text.includes(f)
    rows.push({
      scenario: s.id,
      modified,
      surfacedModified: modified.filter(mentioned),
      relatedTests,
      surfacedTests: relatedTests.filter(mentioned),
      distractorsInjected: DISTRACTORS.filter((d) => pack.text.includes(d.title)).length,
      matched: pack.targets ?? [],
      matchedCorrect: (pack.targets ?? []).filter((f) => modified.includes(f) || solution.includes(f)).length,
      contextChars: pack.chars,
      ms: Math.round(ms)
    })
    db.close()
    removeSandbox(sb)
  }
  return rows
}

/** A synthetic repository: `modules` folders of `perModule` files, each importing two neighbours. */
function largeRepo(root: string, modules: number, perModule: number): number {
  let n = 0
  for (let m = 0; m < modules; m++) {
    mkdirSync(join(root, 'src', `mod${m}`), { recursive: true })
    for (let i = 0; i < perModule; i++) {
      const imports = [`./f${(i + 1) % perModule}.js`, `../mod${(m + 1) % modules}/f${i}.js`]
      writeFileSync(join(root, 'src', `mod${m}`, `f${i}.js`), `${imports.map((x, k) => `import { v as v${k} } from '${x}'`).join('\n')}\nexport const v = ${i}\n`)
      n++
    }
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'large', type: 'module', scripts: { test: 'node --test' } }))
  return n
}

async function largeRepository() {
  const root = mkdtempSync(join(tmpdir(), 'autopia-bench-large-'))
  try {
    const files = largeRepo(root, 50, 80)
    const db = openDatabase(':memory:')
    const repo = new Repo(db)
    const memory = new Memory(repo)
    const p = project(repo, root, 'large')
    let t0 = performance.now()
    await memory.refresh(p, true)
    const first = performance.now() - t0
    writeFileSync(join(root, 'src/mod3/f7.js'), `import { v as a } from './f8.js'\nexport const v = 1\n`)
    t0 = performance.now()
    await memory.refresh(p, true)
    const second = performance.now() - t0
    const graph = repo.meta<Record<string, string[]>>(`memory-graph:${p.id}`) ?? {}
    db.close()
    return { files, firstIndexMs: Math.round(first), reindexAfterOneEditMs: Math.round(second), filesInGraph: Object.keys(graph).length, editSeen: JSON.stringify(graph['src/mod3/f7.js'] ?? []) === JSON.stringify(['src/mod3/f8.js']) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Freshness, conflicts, isolation, restart and corruption, each as a pass/fail probe on real storage. */
async function lifecycle() {
  const out: Record<string, boolean> = {}
  const root = mkdtempSync(join(tmpdir(), 'autopia-bench-life-'))
  const dbFile = join(root, 'autopia.db')
  try {
    mkdirSync(join(root, 'a/lib'), { recursive: true })
    mkdirSync(join(root, 'b'), { recursive: true })
    writeFileSync(join(root, 'a/lib/store.js'), 'export const save = (x) => x\n')
    writeFileSync(join(root, 'a/package.json'), '{"name":"a","type":"module"}')
    writeFileSync(join(root, 'b/package.json'), '{"name":"b","type":"module"}')
    let db = openDatabase(dbFile)
    let repo = new Repo(db)
    let memory = new Memory(repo)
    const a = project(repo, join(root, 'a'), 'A')
    const b = project(repo, join(root, 'b'), 'B')
    await memory.remember(a, { kind: 'handoff', topic: 'handoff:T1', title: 'T1 Storage', text: 'save() in lib/store.js writes recipes; call it after every change.', files: ['lib/store.js'], source: 'T1' })

    // isolation: project B never sees project A's notes, even for the same words
    const inB = await memory.retrieve(b, { purpose: 'task', text: 'save recipes after every change in lib/store.js', files: ['lib/store.js'] })
    out['isolation: other project notes never retrieved'] = !inB.text.includes('T1 Storage')

    // restart: the same database reopened keeps the note and still retrieves it
    db.close()
    db = openDatabase(dbFile)
    repo = new Repo(db)
    memory = new Memory(repo)
    const a2 = repo.project(a.id)
    const after = await memory.retrieve(a2, { purpose: 'task', text: 'change how recipes are saved', files: ['lib/store.js'] })
    out['continuity: notes survive a restart and are retrieved'] = after.text.includes('T1 Storage')

    // freshness without git: editing the file the note describes makes it stale
    writeFileSync(join(root, 'a/lib/store.js'), 'export const save = async (x) => { await write(x) }\n')
    await memory.refresh(a2, true)
    const note = repo.knowledge(a.id).find((e) => e.topic === 'handoff:T1')
    out['freshness: edited file marks its note stale (no git)'] = note?.status === 'stale'

    // removed file: a note about a deleted file must not stay active
    await memory.remember(a2, { kind: 'completed', topic: 'completed:legacy', title: 'Legacy importer', text: 'lib/legacy.js imports CSV.', files: ['lib/legacy.js'], source: 'T2' })
    writeFileSync(join(root, 'a/lib/legacy.js'), 'export {}\n')
    await memory.remember(a2, { kind: 'completed', topic: 'completed:legacy', title: 'Legacy importer', text: 'lib/legacy.js imports CSV.', files: ['lib/legacy.js'], source: 'T2' })
    rmSync(join(root, 'a/lib/legacy.js'))
    await memory.refresh(a2, true)
    out['freshness: note about a removed file is set aside'] = repo.knowledge(a.id).find((e) => e.topic === 'completed:legacy')?.status !== 'active'

    // conflicting decisions: an agent decision that contradicts the founder's does not become active
    await memory.remember(a2, { kind: 'decision', title: 'Storage: JSON file', text: 'Recipes are stored in data/recipes.json.', files: ['lib/store.js'], source: 'founder' }, 'user')
    await memory.remember(a2, { kind: 'decision', title: 'Storage: SQLite', text: 'Recipes are stored in SQLite via better-sqlite3.', files: ['lib/store.js'], source: 'T3' })
    const decisions = repo.knowledge(a.id).filter((e) => e.kind === 'decision' && e.status === 'active')
    out["conflicts: an agent decision never overrides the founder's"] = decisions.length === 1 && decisions[0].author === 'user'

    // corruption: a damaged import graph or knowledge row must not stop retrieval
    db.prepare("UPDATE settings SET value = '{not json' WHERE key = ?").run(`meta:memory-graph:${a.id}`)
    db.prepare("UPDATE knowledge SET files = 'garbage', hashes = '[' WHERE project_id = ? AND topic = 'handoff:T1'").run(a.id)
    let survived = true
    try {
      await memory.retrieve(a2, { purpose: 'task', text: 'store', files: ['lib/store.js'] })
    } catch {
      survived = false
    }
    out['recovery: corrupted memory data does not block work'] = survived
    db.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return out
}

export async function memoryBench(log: (m: string) => void, legacy: boolean, label: string): Promise<void> {
  log(`Memory benchmark (${legacy ? 'legacy targeting' : 'current'}), no AI calls\n`)
  const rows = await retrieval(legacy)
  log('Scenario                     modified files surfaced   related tests surfaced   matched (correct)   distractors   context chars   ms')
  for (const r of rows)
    log(`${r.scenario.padEnd(28)} ${`${r.surfacedModified.length}/${r.modified.length}`.padEnd(25)} ${`${r.surfacedTests.length}/${r.relatedTests.length}`.padEnd(24)} ${`${r.matched.length} (${r.matchedCorrect})`.padEnd(19)} ${String(r.distractorsInjected).padEnd(13)} ${String(r.contextChars).padEnd(15)} ${r.ms}`)
  const sum = (f: (r: ScenarioRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const recall = {
    modified: `${sum((r) => r.surfacedModified.length)}/${sum((r) => r.modified.length)}`,
    tests: `${sum((r) => r.surfacedTests.length)}/${sum((r) => r.relatedTests.length)}`,
    matchedPrecision: `${sum((r) => r.matchedCorrect)}/${sum((r) => r.matched.length)}`,
    distractors: sum((r) => r.distractorsInjected),
    contextChars: sum((r) => r.contextChars)
  }
  log(`\nTotal: modified files surfaced ${recall.modified} · related tests surfaced ${recall.tests} · matched files that the solution changes ${recall.matchedPrecision} · distractors injected ${recall.distractors} (of ${DISTRACTORS.length * rows.length} chances) · context ${recall.contextChars} chars`)
  const large = await largeRepository()
  log(`\nLarge repository (${large.files} files): first index ${large.firstIndexMs} ms · re-index after one edit ${large.reindexAfterOneEditMs} ms · files in import graph ${large.filesInGraph} · edit reflected: ${large.editSeen}`)
  const life = await lifecycle()
  log('')
  for (const [k, v] of Object.entries(life)) log(`${v ? 'PASS' : 'FAIL'}  ${k}`)
  const record = { at: new Date().toISOString(), label, legacy, recall, rows, large, lifecycle: life }
  appendFileSync(join(BENCH_ROOT, 'results', 'memory.jsonl'), JSON.stringify(record) + '\n')
}
