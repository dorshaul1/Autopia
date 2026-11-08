import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { qualityWorld } from '../benchmark/harness/qualityWorld'
import type { BashEvidence } from '../src/shared/checks'
import { brokenImports, importsOfDeleted, scanSources } from '../src/main/memory/indexer'
import { buildContext, reliedOn } from '../src/main/memory/memory'
import { undoBlocker, type UndoContext } from '../src/main/orchestrator/delivery'
import { classifyFailure, repairable, type BaselineCheck } from '../src/main/quality/regression'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'autopia-regress-'))
  dirs.push(root)
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(join(root, f, '..'), { recursive: true })
    writeFileSync(join(root, f), t)
  }
  return root
}
const run = (command: string, isError: boolean, at: number, output = isError ? 'not ok 1 - adds' : 'ok'): BashEvidence => ({ command, isError, output, ms: 5, at, founderDenied: false, policyDenied: false })
const base = (status: 'passed' | 'failed', at: number, output = status === 'failed' ? 'not ok 1 - adds' : 'ok'): BaselineCheck => ({ command: 'npm test', status, output, at, source: 'T2' })

describe('failure attribution', () => {
  const failed = { command: 'npm test', output: 'not ok 1 - adds' }
  it('a failure that already happened the same way before this work is pre-existing (not repaired)', () => {
    const c = classifyFailure(failed, { baseline: [base('failed', 50)], session: [run('npm test', true, 200)], edits: [150], taskStartedAt: 100 })
    expect(c).toMatchObject({ kind: 'pre_existing', evidence: expect.stringContaining('T2') })
    expect(repairable(c.kind)).toBe(false)
  })
  it('a check that passed before this work started and fails now was broken by it (repaired)', () => {
    const c = classifyFailure(failed, { baseline: [base('passed', 50)], session: [run('npm test', true, 200)], edits: [150], taskStartedAt: 100 })
    expect(c.kind).toBe('introduced')
    expect(repairable(c.kind)).toBe(true)
  })
  it('the same command failing differently than before is not "pre-existing"', () => {
    expect(classifyFailure({ command: 'npm test', output: 'not ok 7 - search filters' }, { baseline: [base('failed', 50)], session: [], edits: [], taskStartedAt: 100 }).kind).toBe('unknown')
  })
  it('evidence recorded after this work began is not a baseline', () => {
    expect(classifyFailure(failed, { baseline: [base('passed', 150)], session: [], edits: [], taskStartedAt: 100 }).kind).toBe('unknown')
  })
  it('a machine problem is not the code', () => {
    const c = classifyFailure({ command: 'npm test', output: 'Error: listen EADDRINUSE: address already in use :::3000' }, { baseline: [base('passed', 50)], session: [], edits: [], taskStartedAt: 100 })
    expect(c.kind).toBe('environment')
    expect(repairable(c.kind)).toBe(false)
  })
  it('passed then failed with no edit in between is flaky; with an edit in between it is not', () => {
    const session = [run('npm test', false, 200), run('npm test', true, 300)]
    expect(classifyFailure(failed, { baseline: [], session, edits: [], taskStartedAt: 100 }).kind).toBe('flaky')
    expect(classifyFailure(failed, { baseline: [], session, edits: [250], taskStartedAt: 100 }).kind).toBe('unknown')
  })
})

describe('interface compatibility', () => {
  const root = () =>
    repo({
      'lib/cart.js': 'export function cartTotal(c) { return 0 }\nexport const addItem = () => {}\n',
      'lib/types.ts': 'export interface Line { qty: number }\nexport type Sku = string\n',
      'app.js': "import { cartTotal, addItem } from './lib/cart.js'\nimport { Line } from './lib/types'\n",
      'lib/all.js': "export * from './cart.js'\n",
      'page.js': "import { anything } from './lib/all.js'\n"
    })
  const files = ['lib/cart.js', 'lib/types.ts', 'app.js', 'lib/all.js', 'page.js']

  it('records which names each file relies on, and tells the agent before it changes them', () => {
    const s = scanSources(root(), files)
    expect(s.uses['app.js']).toEqual({ 'lib/cart.js': ['cartTotal', 'addItem'], 'lib/types.ts': ['Line'] })
    expect(reliedOn(s.uses, ['lib/cart.js'])).toEqual(['- lib/cart.js: cartTotal (used by app.js), addItem (used by app.js)'])
    const pack = buildContext([], { purpose: 'task', text: 'change the cart', files: ['lib/cart.js'] }, null, s.graph, s.uses)
    expect(pack.text).toContain('Exports other files rely on')
  })

  it('flags a removed export that is still imported, and only that', () => {
    const r = root()
    const before = scanSources(r, files)
    expect(brokenImports(before.uses, before.symbols, files)).toEqual([])
    // the change renames cartTotal → total but leaves app.js importing the old name
    writeFileSync(join(r, 'lib/cart.js'), 'export function total(c) { return 0 }\nexport const addItem = () => {}\n')
    utimesSync(join(r, 'lib/cart.js'), new Date(), new Date(Date.now() + 5000))
    const after = scanSources(r, files, before.scan)
    expect(brokenImports(after.uses, after.symbols, ['lib/cart.js'])).toEqual([{ importer: 'app.js', target: 'lib/cart.js', missing: ['cartTotal'] }])
    // unrelated edges are not checked for an unrelated change; a re-export-everything target is never guessed
    expect(brokenImports(after.uses, after.symbols, ['page.js'])).toEqual([])
  })

  it('flags imports of a file the change deleted', () => {
    const r = root()
    const s = scanSources(r, files)
    // lib/all.js re-exports everything from cart.js, so deleting cart.js breaks it too
    expect(importsOfDeleted(s.scan, ['lib/cart.js'])).toEqual([{ importer: 'app.js', target: 'lib/cart.js' }, { importer: 'lib/all.js', target: 'lib/cart.js' }])
    expect(importsOfDeleted(s.scan, [])).toEqual([])
  })

  it('review QA reports a broken import as a verified defect in the change (so the one correction can fix it)', async () => {
    const w = qualityWorld()
    try {
      const d = w.delivery()
      w.write('app.js', "import { cartTotal } from './lib/cart.js'\nconsole.log(cartTotal)\n")
      w.task(d, { files: { 'lib/cart.js': 'export function total() { return 0 }\n' }, checks: [{ status: 'passed' }] })
      const audit = await w.engine.audit(w.project, d.id)
      expect(audit.findings.find((f) => f.rule === 'broken-import')).toMatchObject({ certainty: 'verified', severity: 'high', inScope: true, file: 'app.js', message: 'app.js imports cartTotal from lib/cart.js, which no longer exports it.' })
      expect(w.engine.readiness(w.project.id, d.id).completion.status).toBe('failed')
    } finally {
      w.close()
    }
  })
})

describe('undoing a discarded result', () => {
  const ok: UndoContext = { gitEnabled: true, status: 'rejected', hasCommits: true, alreadyUndone: false, busy: false, onBase: true, merges: 2, files: ['lib/cart.js'], dirty: [], later: [] }
  it('is allowed only when it can be done with new commits and touches nothing else', () => {
    expect(undoBlocker(ok)).toBeNull()
  })
  it('never touches your uncommitted work', () => {
    expect(undoBlocker({ ...ok, dirty: ['lib/cart.js', 'notes.md'] })).toMatch(/uncommitted changes in lib\/cart\.js.*never overwrites your work/)
    expect(undoBlocker({ ...ok, dirty: ['notes.md'] })).toBeNull()
  })
  it('never undoes part of a later result', () => {
    expect(undoBlocker({ ...ok, later: [{ number: 5, files: ['lib/cart.js'] }] })).toMatch(/Result #5, made after this one, also changed lib\/cart\.js/)
    expect(undoBlocker({ ...ok, later: [{ number: 5, files: ['README.md'] }] })).toBeNull()
  })
  it('is refused while work is running, off the main branch, without git, twice, or for results you kept', () => {
    expect(undoBlocker({ ...ok, busy: true })).toMatch(/working/)
    expect(undoBlocker({ ...ok, onBase: false })).toMatch(/main branch/)
    expect(undoBlocker({ ...ok, gitEnabled: false })).toMatch(/git/)
    expect(undoBlocker({ ...ok, alreadyUndone: true })).toMatch(/already/)
    expect(undoBlocker({ ...ok, status: 'accepted' })).toMatch(/discarded/)
    expect(undoBlocker({ ...ok, merges: 0 })).toMatch(/nothing to undo/)
  })
})
