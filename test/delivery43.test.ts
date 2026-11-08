import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { declaredChecks, detectPackageManager, isEnvironmentFailure, judgeRender, nextStep, repairBrief, verificationSignature, type RenderSnapshot, type VerificationStep } from '../src/shared/delivery'
import { runtimeEvidence } from '../src/shared/runtime'
import { readiness } from '../src/main/quality/readiness'

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: { fromPartition: () => ({}) }, app: { getPath: () => tmpdir() } }))

const page: RenderSnapshot = { loadError: null, httpStatus: 200, textLength: 400, mediaCount: 2, overlay: null, uniformFrame: false, exceptions: [], consoleErrors: [], failedRequests: [] }

describe('package manager', () => {
  it('follows the project: its field, then its lockfile, then npm', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn')
    expect(detectPackageManager(['bun.lock'])).toBe('bun')
    expect(detectPackageManager(['package-lock.json'])).toBe('npm')
    expect(detectPackageManager([])).toBe('npm')
    expect(detectPackageManager(['package-lock.json'], 'pnpm@9.1.0')).toBe('pnpm')
  })
  it('runs only checks the project declares, with its manager', () => {
    expect(declaredChecks({ typecheck: 'tsc', build: 'vite build', test: 'vitest run', lint: 'x' }, 'pnpm').map((c) => c.command)).toEqual(['pnpm run typecheck', 'pnpm run build', 'pnpm run test'])
    expect(declaredChecks({ test: 'echo "Error: no test specified" && exit 1' }, 'npm')).toEqual([])
    expect(declaredChecks(undefined, 'npm')).toEqual([])
  })
})

describe('the page has to really work', () => {
  const kinds = (s: Partial<RenderSnapshot>) => judgeRender({ ...page, ...s }).map((i) => i.kind)
  it('a real page passes, and console warnings alone do not fail it', () => {
    expect(judgeRender(page)).toEqual([])
    expect(kinds({ consoleErrors: ['Warning: Each child in a list should have a unique key'] })).toEqual([])
  })
  it('HTTP 200 with nothing on screen is blank', () => {
    expect(kinds({ textLength: 0, mediaCount: 0 })).toEqual(['blank'])
    expect(kinds({ uniformFrame: true })).toEqual(['blank'])
  })
  it('catches runtime errors, the error overlay, missing files, bad status and load failures', () => {
    expect(kinds({ exceptions: ['TypeError: x is undefined'] })).toEqual(['runtime'])
    expect(kinds({ overlay: 'Failed to resolve import' })).toEqual(['overlay'])
    expect(kinds({ failedRequests: ['404 /assets/app.js'] })).toEqual(['asset'])
    expect(kinds({ failedRequests: ['404 /favicon.ico'] })).toEqual([])
    expect(kinds({ httpStatus: 500 })).toEqual(['http'])
    expect(kinds({ loadError: 'no response' })).toEqual(['load'])
  })
})

const failed = (detail: string, id: VerificationStep['id'] = 'build'): VerificationStep => ({ id, label: id, status: 'failed', command: 'npm run build', detail, ms: 12 })
const passed: VerificationStep = { id: 'test', label: 'Tests', status: 'passed', command: 'npm test', detail: 'Passed.', ms: 3 }
const decide = (steps: VerificationStep[], over: Partial<Parameters<typeof nextStep>[0]> = {}) => nextStep({ steps, attempts: 0, limit: 3, lastSignature: null, canRepair: true, ...over })

describe('what happens next always ends', () => {
  it('verified only when nothing failed or was blocked', () => {
    expect(decide([passed]).state).toBe('verified')
    expect(decide([passed, failed('boom')]).state).toBe('fixing')
    expect(decide([passed, { ...passed, status: 'blocked', detail: 'Policy denies it.' }]).state).toBe('blocked')
  })
  it('the same failure after a repair stops instead of retrying blindly', () => {
    const first = [failed('Cannot find x at /a/b/c.ts:1:2 (120ms)')]
    const again = [failed('Cannot find x at /other/place/c.ts:9:9 (800ms)')]
    expect(verificationSignature(first)).toBe(verificationSignature(again))
    expect(decide(again, { attempts: 1, lastSignature: verificationSignature(first) }).state).toBe('failed')
  })
  it('a different failure gets another try, within the budget', () => {
    expect(decide([failed('new problem')], { attempts: 1, lastSignature: 'build:old problem' }).state).toBe('fixing')
    expect(decide([failed('new problem')], { attempts: 3, lastSignature: 'build:old problem' }).state).toBe('failed')
  })
  it('never spends a session on what code cannot fix', () => {
    const network = failed('npm ERR! getaddrinfo ENOTFOUND registry.npmjs.org', 'install')
    expect(isEnvironmentFailure(network)).toBe(true)
    expect(decide([network]).state).toBe('blocked')
    expect(decide([failed('boom')], { canRepair: false }).state).toBe('failed')
  })
  it('the repair brief carries the real output', () => {
    const b = repairBrief([{ ...failed('boom'), output: 'stack trace here' }, passed], 4)
    expect(b).toMatch(/result #4/)
    expect(b).toMatch(/stack trace here/)
    expect(b).not.toMatch(/## Tests/)
  })
})

// real commands, a real dev server process; only the hidden window's measurement is stubbed
function app(files: Record<string, string>, scripts: Record<string, string>, deps: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'autopia-verify-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts, dependencies: deps }))
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body)
  return dir
}
const SERVER = `require('http').createServer((q,s)=>s.end('<h1>hi</h1>')).listen(process.env.PORT,'127.0.0.1')`
async function verify(dir: string, snap: RenderSnapshot = page, denied: (c: string) => boolean = () => false) {
  const { PreviewManager } = await import('../src/main/preview')
  const { runVerification } = await import('../src/main/quality/verify')
  const preview = new PreviewManager(() => null, () => undefined, join(dir, 'pids'))
  const steps = await runVerification({ id: 'p', path: dir, gitEnabled: false } as never, { preview, probe: async () => snap, env: async () => process.env, stableMs: 300 }, denied)
  return { steps, status: Object.fromEntries(steps.map((s) => [s.id, s.status])), preview }
}
const P = { timeout: 90_000 }

describe('running a result for real', () => {
  it('a working app: build and tests pass, the server stays up, the page renders', P, async () => {
    const { status } = await verify(app({ 'server.cjs': SERVER, 'ok.cjs': '' }, { dev: 'node server.cjs', build: 'node ok.cjs', test: 'node ok.cjs' }))
    expect(status).toEqual({ build: 'passed', test: 'passed', server: 'passed', render: 'passed' })
  })
  it('a failed build fails, with its real output, and the rest still runs for one complete repair', P, async () => {
    const { steps, status } = await verify(app({ 'server.cjs': SERVER, 'bad.cjs': 'console.error("error TS2304: Cannot find name foo"); process.exit(2)' }, { dev: 'node server.cjs', build: 'node bad.cjs' }))
    expect(status).toEqual({ build: 'failed', server: 'passed', render: 'passed' })
    expect(steps[0].detail).toMatch(/TS2304/)
    expect(decide(steps).state).toBe('fixing')
  })
  it('a server that crashes on start fails with its error, and no page is judged', P, async () => {
    const { steps, status } = await verify(app({ 'server.cjs': `console.error("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'");process.exit(1)` }, { dev: 'node server.cjs' }))
    expect(status).toEqual({ server: 'failed' })
    expect(steps[0].detail).toMatch(/ERR_MODULE_NOT_FOUND/)
  })
  it('a server that listens and then dies does not count as running', P, async () => {
    const { status } = await verify(app({ 'server.cjs': `${SERVER};setTimeout(()=>{console.error('Error: boom');process.exit(1)},150)` }, { dev: 'node server.cjs' }))
    expect(status.server).toBe('failed')
  })
  it('blank pages and runtime errors fail even though the server answered 200', P, async () => {
    const dir = () => app({ 'server.cjs': SERVER }, { dev: 'node server.cjs' })
    expect((await verify(dir(), { ...page, textLength: 0, mediaCount: 0 })).status).toEqual({ server: 'passed', render: 'failed' })
    const r = await verify(dir(), { ...page, exceptions: ['TypeError: boom'] })
    expect(r.status.render).toBe('failed')
    expect(r.steps[1].detail).toMatch(/TypeError: boom/)
  })
  it('missing dependencies are installed by the project’s manager, then verified on disk', P, async () => {
    // a local package: a real install, with no network
    const dir = app({ 'server.cjs': `require('dep');${SERVER}` }, { dev: 'node server.cjs' }, { dep: 'file:./dep' })
    mkdirSync(join(dir, 'dep'))
    writeFileSync(join(dir, 'dep', 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0', main: 'i.js' }))
    writeFileSync(join(dir, 'dep', 'i.js'), '')
    const { steps, status } = await verify(dir)
    expect(steps[0].command).toBe('npm install')
    expect(status).toEqual({ install: 'passed', server: 'passed', render: 'passed' })
  })
  it('an install that can’t succeed stops there, and nothing downstream pretends to pass', P, async () => {
    const dir = app({ 'server.cjs': SERVER }, { dev: 'node server.cjs', build: 'node x' }, { dep: 'file:./does-not-exist' })
    const { status } = await verify(dir)
    expect(status).toEqual({ install: 'failed' })
  })
  it('a command the organization denies is blocked, never run and never skipped silently', P, async () => {
    const dir = app({ 'server.cjs': SERVER, 'marker.cjs': `require('fs').writeFileSync(__dirname+'/ran','')` }, { dev: 'node server.cjs', build: 'node marker.cjs' })
    const { steps, status } = await verify(dir, page, (c) => c === 'npm run build')
    expect(status.build).toBe('blocked')
    expect(decide(steps).state).toBe('blocked')
    expect((await import('node:fs')).existsSync(join(dir, 'ran'))).toBe(false)
  })
  it('a script that isn’t a server is not reported as a crash', P, async () => {
    const { status } = await verify(app({ 'cli.cjs': 'console.log("hello")' }, { start: 'node cli.cjs' }))
    expect(status).toEqual({ server: 'skipped' })
  })
  it('a project with nothing to run has nothing to fail', P, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopia-verify-'))
    writeFileSync(join(dir, 'notes.txt'), 'x')
    expect((await verify(dir)).steps).toEqual([])
  })
})

describe('no false Ready', () => {
  const delivery = { id: 'd', limitations: [] } as never
  const task = { id: 't', key: 'T1', deliveryId: 'd', status: 'done', kind: 'code', title: 'x', description: '', criteria: [], fixAttempts: 0, finishedAt: 1, checks: [{ command: 'npm test', status: 'passed', output: '', ok: true, ms: 1, at: 1 }], qualityPlan: null } as never
  const audit = { deliveryId: 'd', kind: 'audit', status: 'done', findings: [], metrics: {}, shots: [] } as never
  const preview = { kind: 'script', status: 'stopped', error: null, url: null } as const
  const v = (state: 'verified' | 'failed' | 'blocked', steps: VerificationStep[]) => ({ state, steps, commit: 'a', attempts: 0, signature: null, reason: 'why', at: 1 })
  const of = (state: 'verified' | 'failed' | 'blocked', steps: VerificationStep[]) => readiness(delivery, [task], [], [audit], [], true, null, runtimeEvidence(preview, null, v(state, steps))).completion.status
  it('every failure kind keeps it out of "verified", even when every task reported success', () => {
    expect(of('failed', [failed('blank', 'render')])).toBe('failed')
    expect(of('failed', [failed('crash', 'server')])).toBe('failed')
    expect(of('failed', [failed('boom', 'build')])).toBe('failed')
    expect(of('blocked', [{ ...passed, status: 'blocked' }])).toBe('blocked')
  })
  it('a recorded pass verifies it, and a live crash still outranks that record', () => {
    expect(of('verified', [passed, { ...passed, id: 'render', label: 'Rendered page', command: null }])).toBe('verified')
    const crashed = runtimeEvidence({ kind: 'script', status: 'crashed', error: 'boom', url: null }, null, v('verified', [passed]))
    expect(crashed?.status).toBe('failed')
  })
})

describe('the gate, end to end through the engine', () => {
  const setup = async (build: string) => {
    const { qualityWorld } = await import('../benchmark/harness/qualityWorld')
    const { QualityEngine } = await import('../src/main/quality/engine')
    const w = qualityWorld()
    writeFileSync(join(w.project.path, 'package.json'), JSON.stringify({ name: 'x', scripts: { build } }))
    writeFileSync(join(w.project.path, 'b.cjs'), 'console.error("error: broken build");process.exit(1)')
    const repairs: string[] = []
    const asked: string[][] = []
    const engine = new QualityEngine(w.repo, { info: () => ({ kind: 'none', status: 'unavailable', error: null, url: null, logs: [], command: null }) } as never, () => {}, {
      busy: () => () => {},
      correct: () => null,
      askToVerify: (_p, _d, c) => void asked.push(c),
      canRepair: () => true,
      repairVerification: (_p, _d, brief) => (repairs.push(brief), 'T9')
    })
    const project = { ...w.project, gitEnabled: false }
    const d = w.repo.createDelivery({ projectId: project.id, parentId: null, kind: 'brief', request: 'x', baseSha: null, screenshot: null })
    return { w, engine, project, d, repairs, asked }
  }
  it('asks once for the exact commands before running anything, and remembers', P, async () => {
    const { engine, project, d, asked, w } = await setup('node b.cjs')
    expect(await engine.verify(project, d)).toBe('waiting')
    expect(asked).toEqual([['npm run build']])
    engine.setVerifyConsent(project.id, asked[0], true)
    expect(await engine.verify(project, w.repo.delivery(d.id))).toBe('fixing')
    expect(asked).toHaveLength(1)
  })
  it('declining is honest: blocked, nothing run, never verified', P, async () => {
    const { engine, project, d, w } = await setup('node b.cjs')
    engine.setVerifyConsent(project.id, [], false)
    expect(await engine.verify(project, d)).toBe('blocked')
    expect(w.repo.delivery(d.id).verification?.state).toBe('blocked')
  })
  it('fails → one repair with the real output → same failure stops; no endless loop, no false Ready', P, async () => {
    const { engine, project, d, repairs, w } = await setup('node b.cjs')
    engine.setVerifyConsent(project.id, ['npm run build'], true)
    expect(await engine.verify(project, d)).toBe('fixing')
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatch(/broken build/)
    expect(await engine.verify(project, w.repo.delivery(d.id))).toBe('failed')
    expect(repairs).toHaveLength(1)
    const v = w.repo.delivery(d.id).verification!
    expect(v.reason).toMatch(/didn’t change the failure/)
    expect(engine.readiness(project.id, d.id).completion.status).toBe('failed')
  })
  it('a repair that works passes on the rerun, from the same measurement', P, async () => {
    const { engine, project, d, repairs, w } = await setup('node b.cjs')
    engine.setVerifyConsent(project.id, ['npm run build'], true)
    await engine.verify(project, d)
    writeFileSync(join(project.path, 'b.cjs'), '')
    expect(await engine.verify(project, w.repo.delivery(d.id))).toBe('verified')
    expect(repairs).toHaveLength(1)
    expect(w.repo.delivery(d.id).verification?.steps.map((s) => s.status)).toEqual(['passed'])
  })
})
