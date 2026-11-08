import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { indexRepository, scanSources } from '../src/main/memory/indexer'
import { blobHashes, buildContext, decisionsConflict, matchTargets, Memory } from '../src/main/memory/memory'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'autopia-knowledge-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const write = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}

/** A small project with a module, its test and an unrelated area. */
function fixture() {
  const root = tmp()
  write(root, 'package.json', JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }))
  write(root, 'lib/cart.js', "import { round } from './money.js'\nexport function cartTotal(c) { return round(c) }\nexport const addItem = () => {}\n")
  write(root, 'lib/money.js', 'export const round = (x) => x\n')
  write(root, 'test/cart.test.js', "import { cartTotal } from '../lib/cart.js'\n")
  for (let i = 0; i < 8; i++) write(root, `app/billing/invoice-${i}.js`, 'export const x = 1\n')
  return root
}

function memoryFor(root: string, file = ':memory:') {
  const db = openDatabase(file)
  const repo = new Repo(db)
  const memory = new Memory(repo)
  const project = repo.createProject({ name: 'shop', path: root, goal: '', gitEnabled: false, baseBranch: null })
  return { db, repo, memory, project }
}

describe('repository analysis', () => {
  it('finds test folders, exports and import edges deterministically', async () => {
    const root = fixture()
    const r = await indexRepository(root, false)
    expect(r.facts.find((f) => f.kind === 'convention')?.text).toContain('Test folders: test/')
    expect(r.symbols['lib/cart.js']).toEqual(['cartTotal', 'addItem'])
    expect(r.graph['test/cart.test.js']).toEqual(['lib/cart.js'])
    expect(r.graph['lib/cart.js']).toEqual(['lib/money.js'])
  })

  it('re-reads only the files that changed', () => {
    const root = fixture()
    const files = ['lib/cart.js', 'lib/money.js', 'test/cart.test.js']
    const first = scanSources(root, files)
    expect(first.reread).toBe(3)
    expect(scanSources(root, files, first.scan).reread).toBe(0)
    write(root, 'lib/money.js', "import { cartTotal } from './cart.js'\nexport const round = (x) => x\n")
    utimesSync(join(root, 'lib/money.js'), new Date(), new Date(Date.now() + 5000))
    const third = scanSources(root, files, first.scan)
    expect(third.reread).toBe(1)
    expect(third.graph['lib/money.js']).toEqual(['lib/cart.js'])
  })

  it('ignores a damaged scan cache instead of trusting it', () => {
    const root = fixture()
    const bad = { 'lib/cart.js': { m: 0, s: 0, i: 'nope', x: null } } as never
    expect(scanSources(root, ['lib/cart.js', 'lib/money.js'], bad).graph['lib/cart.js']).toEqual(['lib/money.js'])
  })
})

describe('request targeting and context selection', () => {
  const files = ['lib/cart.js', 'lib/money.js', 'lib/http.js', 'bin/todo.js', 'test/cart.test.js', 'src/a/strings.js', 'src/b/strings.js']
  const symbols = { 'lib/cart.js': ['cartTotal'], 'lib/http.js': ['http'], 'test/cart.test.js': ['cartTotal'] }

  it('matches named paths, file names and distinctive symbols, strongest first', () => {
    expect(matchTargets('Fix lib/money.js rounding', files, symbols)).toEqual([{ file: 'lib/money.js', why: 'named in the request' }])
    expect(matchTargets('cartTotal is wrong', files, symbols)).toEqual([{ file: 'lib/cart.js', why: 'defines `cartTotal`' }])
    // an ambiguous file name is not guessed
    expect(matchTargets('rename strings.js', files, symbols)).toEqual([])
  })

  it('uses file stems only as a fallback, and plain words never match symbols', () => {
    expect(matchTargets('The todo CLI should accept due dates', files, symbols)).toEqual([{ file: 'bin/todo.js', why: '"todo" in the request' }])
    expect(matchTargets('Only allow http: links in lib/money.js', files, symbols).map((t) => t.file)).toEqual(['lib/money.js'])
  })

  it('surfaces the matched file, its imports and the tests that must keep passing; unrelated notes stay out', () => {
    const graph = { 'lib/cart.js': ['lib/money.js'], 'test/cart.test.js': ['lib/cart.js'] }
    const unrelated = { id: 'x', projectId: 'p', kind: 'decision', topic: 'decision:jwt', title: 'Use JWT sessions', text: 'Auth uses JWTs.', rationale: null, alternatives: null, files: ['src/auth.ts'], hashes: {}, commit: null, source: 's', confidence: 'reported', status: 'active', author: 'agent', uses: 0, lastUsedAt: null, createdAt: 0, updatedAt: 0, stale: false, statusNote: null } as const
    const pack = buildContext([unrelated], { purpose: 'task', text: 'cart total ignores quantity', files: [], targets: [{ file: 'lib/cart.js', why: '"cart" in the request' }] }, null, graph)
    expect(pack.text).toContain('- lib/cart.js ("cart" in the request)')
    expect(pack.text).toContain('lib/cart.js imports lib/money.js')
    expect(pack.text).toContain('Tests that import them (keep these passing): test/cart.test.js')
    expect(pack.text).not.toContain('JWT')
    expect(pack.targets).toEqual(['lib/cart.js'])
  })

  it('a corrupted graph degrades to no relationships, never a crash', () => {
    expect(() => buildContext([], { purpose: 'task', text: 'x', files: ['lib/cart.js'] }, null, '{not json')).not.toThrow()
    expect(buildContext([], { purpose: 'task', text: 'x', files: ['lib/cart.js'] }, null, { 'lib/cart.js': 'oops' }).text).toBe('')
  })
})

describe('freshness', () => {
  it('hashes like git, works without git, and refuses paths outside the project', () => {
    const root = tmp()
    write(root, 'a.txt', 'hello\n')
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobHashes(root, ['a.txt'])['a.txt']).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(blobHashes(root, ['missing.txt'])['missing.txt']).toBe('')
    expect(blobHashes(root, ['../etc/passwd', '/etc/passwd'])).toEqual({})
  })

  it('marks a note stale with the reason when its file changes or moves, and "still true" sticks', async () => {
    const root = fixture()
    const { repo, memory, project } = memoryFor(root)
    await memory.refresh(project, true)
    await memory.remember(project, { kind: 'handoff', topic: 'handoff:T1', title: 'T1 Cart', text: 'cartTotal sums lines.', files: ['lib/cart.js'], source: 'T1' })
    await memory.remember(project, { kind: 'completed', topic: 'completed:money', title: 'Money helpers', text: 'round() in lib/money.js.', files: ['lib/money.js'], source: 'T2' })

    write(root, 'lib/cart.js', 'export function cartTotal(c) { return c.length }\n')
    rmSync(join(root, 'lib/money.js'))
    write(root, 'src/money.js', 'export const round = (x) => x\n')
    await memory.refresh(project, true)
    const byTopic = (t: string) => repo.knowledge(project.id).find((e) => e.topic === t)!
    expect(byTopic('handoff:T1')).toMatchObject({ status: 'stale', statusNote: 'lib/cart.js changed since this was recorded' })
    expect(byTopic('completed:money').statusNote).toBe('lib/money.js no longer exists; a file with the same name is at src/money.js')

    // the founder checked it: it stays active until the file changes again
    memory.setStatus(project, byTopic('handoff:T1'), 'active')
    await memory.refresh(project, true)
    expect(byTopic('handoff:T1')).toMatchObject({ status: 'active', statusNote: null })
    write(root, 'lib/cart.js', 'export function cartTotal(c) { return 0 }\n')
    await memory.refresh(project, true)
    expect(byTopic('handoff:T1').status).toBe('stale')
  })
})

describe('decisions', () => {
  it('flags only decisions about the same thing that say different things', () => {
    const a = { title: 'Storage: JSON file', text: 'Recipes in data/recipes.json.', files: ['lib/store.js'] }
    expect(decisionsConflict(a, { title: 'Storage: SQLite', text: 'Recipes in SQLite.', files: [] })).toBe(true)
    expect(decisionsConflict(a, { title: 'Storage: JSON file', text: 'Recipes in data/recipes.json.', files: [] })).toBe(false)
    expect(decisionsConflict(a, { title: 'Use JWT sessions', text: 'Auth via JWT.', files: ['lib/auth.js'] })).toBe(false)
  })

  it("never lets an agent override the founder; a newer agent decision supersedes an older one, kept as history", async () => {
    const root = fixture()
    const { repo, memory, project } = memoryFor(root)
    await memory.remember(project, { kind: 'decision', title: 'Storage: JSON file', text: 'Recipes in data/recipes.json.', files: ['lib/store.js'], source: 'you' }, 'user')
    const agent = await memory.remember(project, { kind: 'decision', title: 'Storage: SQLite', text: 'Recipes in SQLite.', files: ['lib/store.js'], source: 'T3' })
    expect(agent).toMatchObject({ status: 'stale', statusNote: 'Conflicts with your decision "Storage: JSON file". Not shared with the team unless you mark it still true.' })

    await memory.remember(project, { kind: 'decision', title: 'Routing: hash URLs', text: 'Use #/recipes/:id.', files: ['public/app.js'], source: 'T4' })
    await memory.remember(project, { kind: 'decision', title: 'Routing: history API', text: 'Use /recipes/:id with pushState.', files: ['public/app.js'], source: 'T5' })
    const routing = repo.knowledge(project.id).filter((e) => e.title.startsWith('Routing'))
    expect(routing.find((e) => e.title === 'Routing: history API')?.status).toBe('active')
    expect(routing.find((e) => e.title === 'Routing: hash URLs')).toMatchObject({ status: 'archived', statusNote: 'Superseded by "Routing: history API" (T5)' })

    const pack = await memory.retrieve(project, { purpose: 'plan', text: 'storage routing recipes', files: [] })
    expect(pack.text).toContain('data/recipes.json')
    expect(pack.text).not.toContain('SQLite')
    expect(pack.text).not.toContain('#/recipes')
  })
})

describe('persistence, isolation, continuity and secrets', () => {
  it('keeps knowledge across a restart and never shares it between projects', async () => {
    const root = fixture()
    const other = fixture()
    const file = join(tmp(), 'autopia.db')
    const first = memoryFor(root, file)
    const otherProject = first.repo.createProject({ name: 'other', path: other, goal: '', gitEnabled: false, baseBranch: null })
    await first.memory.remember(first.project, { kind: 'handoff', topic: 'handoff:T1', title: 'T1 Cart', text: 'cartTotal sums lines.', files: ['lib/cart.js'], source: 'T1' })
    expect((await first.memory.retrieve(otherProject, { purpose: 'task', text: 'cartTotal sums lines', files: ['lib/cart.js'] })).text).not.toContain('T1 Cart')
    first.db.close()

    const db = openDatabase(file)
    const repo = new Repo(db)
    const pack = await new Memory(repo).retrieve(repo.project(first.project.id), { purpose: 'task', text: 'change cartTotal', files: ['lib/cart.js'] })
    expect(pack.text).toContain('T1 Cart')
    db.close()
  })

  it('tells a fresh planner what is still open, from records only', async () => {
    const root = fixture()
    const { repo, memory, project } = memoryFor(root)
    expect(memory.projectStatus(project.id)).toBe('')
    repo.createApproval({ projectId: project.id, taskId: null, kind: 'task_failed', title: 'T4 is stuck', body: 'npm test failed' })
    expect(memory.projectStatus(project.id)).toContain('Waiting on the founder: T4 is stuck')
  })

  it('never stores secrets as project memory', async () => {
    const root = fixture()
    const { repo, memory, project } = memoryFor(root)
    await memory.remember(project, { kind: 'limitation', title: 'Payments', text: 'Use STRIPE_SECRET=sk_live_abcdefghijklmnop1234 for the API.', files: [], source: 'T9' })
    expect(JSON.stringify(repo.knowledge(project.id))).not.toContain('sk_live_abcdefghijklmnop1234')
  })

  it('a corrupted stored record never blocks retrieval', async () => {
    const root = fixture()
    const { db, memory, project } = memoryFor(root)
    await memory.remember(project, { kind: 'handoff', topic: 'handoff:T1', title: 'T1 Cart', text: 'cartTotal sums lines.', files: ['lib/cart.js'], source: 'T1' })
    await memory.refresh(project, true)
    db.prepare("UPDATE settings SET value = '{broken' WHERE key LIKE 'meta:memory-%'").run()
    db.prepare("UPDATE knowledge SET files = '{\"a\":1}', hashes = '[1]'").run()
    await expect(memory.retrieve(project, { purpose: 'task', text: 'cartTotal', files: ['lib/cart.js'] })).resolves.toBeTruthy()
    await expect(memory.refresh(project, true)).resolves.toBeTruthy()
  })
})
