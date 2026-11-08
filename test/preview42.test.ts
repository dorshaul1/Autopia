import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dependencyState } from '../src/main/deps'
import { stopWorktreeProcesses } from '../src/main/git/git'
import { readiness } from '../src/main/quality/readiness'
import { dependencyProblem, previewCrashed, runtimeEvidence } from '../src/shared/runtime'
import { workSystemPrompt } from '../src/main/orchestrator/prompts'

function project(deps: Record<string, string>, installed: Record<string, string> | null, lock?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'autopia-deps-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }))
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: Object.fromEntries(Object.entries(lock).map(([k, v]) => [`node_modules/${k}`, { version: v }])) }))
  if (installed) {
    mkdirSync(join(dir, 'node_modules'))
    for (const [name, version] of Object.entries(installed)) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true })
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ version }))
    }
  }
  return dir
}

describe('what is really installed in the project folder', () => {
  it('no node_modules: not runnable', () => {
    const d = dependencyState(project({ vite: '^8.0.0' }, null))!
    expect(d.ok).toBe(false)
    expect(dependencyProblem(d)).toMatch(/aren’t installed/)
  })
  it('node_modules from before a package was added: the exact ERR_MODULE_NOT_FOUND case is caught', () => {
    const d = dependencyState(project({ vite: '^8.0.0', '@tailwindcss/vite': '^4.0.0' }, { vite: '8.3.5' }))!
    expect(d.installedFolder).toBe(true)
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual(['@tailwindcss/vite'])
    expect(dependencyProblem(d)).toMatch(/@tailwindcss\/vite/)
  })
  it('a version the lockfile no longer asks for counts as outdated', () => {
    const d = dependencyState(project({ vite: '^8.0.0' }, { vite: '8.1.0' }, { vite: '8.3.5' }))!
    expect(d.outdated).toEqual(['vite'])
    expect(d.ok).toBe(false)
  })
  it('everything installed at the locked version is ready', () => {
    const d = dependencyState(project({ vite: '^8.0.0' }, { vite: '8.3.5' }, { vite: '8.3.5' }))!
    expect(d.ok).toBe(true)
    expect(dependencyProblem(d)).toBeNull()
  })
  it('a folder without a package.json has nothing to install', () => {
    expect(dependencyState(mkdtempSync(join(tmpdir(), 'autopia-deps-')))).toBeNull()
  })
})

const delivery = { id: 'd', limitations: [] } as never
// every check passed in the task's worktree: exactly the evidence that used to say "verified"
const task = { id: 't', key: 'T1', deliveryId: 'd', status: 'done', kind: 'code', title: 'x', description: '', criteria: [], fixAttempts: 0, finishedAt: 1, checks: [{ command: 'npm test', status: 'passed', output: '', ok: true, ms: 1, at: 1 }], qualityPlan: null } as never
const audit = { deliveryId: 'd', kind: 'audit', status: 'done', findings: [], metrics: {}, shots: [] } as never
const verdict = (runtime: ReturnType<typeof runtimeEvidence>) => readiness(delivery, [task], [], [audit], [], true, null, runtime)
const crashed = { kind: 'script', status: 'crashed', error: 'ERR_MODULE_NOT_FOUND', url: null } as const

describe('Ready · verified needs the real app', () => {
  it('passing worktree checks alone can no longer outvote a crashed preview', () => {
    expect(verdict(null).completion.status).toBe('verified')
    const r = verdict(runtimeEvidence(crashed, null))
    expect(r.completion.status).toBe('failed')
    expect(r.verdict).toBe('not_ready')
    expect(r.dimensions.find((d) => d.dimension === 'runtime')?.evidence[0]).toMatch(/ERR_MODULE_NOT_FOUND/)
  })
  it('stopping a crashed preview does not launder the crash', () => {
    expect(verdict(runtimeEvidence({ ...crashed, status: 'stopped' }, null)).completion.status).toBe('failed')
    expect(previewCrashed({ status: 'stopped', error: 'x' })).toBe(true)
    expect(previewCrashed({ status: 'stopped', error: null })).toBe(false)
  })
  it('dependencies missing from the project folder are never reported verified', () => {
    const deps = dependencyState(project({ vite: '^8.0.0' }, null))
    const r = verdict(runtimeEvidence({ kind: 'script', status: 'stopped', error: null, url: null }, deps))
    expect(r.completion.status).not.toBe('verified')
    expect(r.dimensions.find((d) => d.dimension === 'runtime')?.status).toBe('not_checked')
  })
  it('a dev-script app that never ran from the project folder is not verified by worktree checks', () => {
    const never = runtimeEvidence({ kind: 'script', status: 'stopped', error: null, url: null }, { declared: 1, installedFolder: true, missing: [], outdated: [], ok: true })
    expect(never?.status).toBe('not_checked')
    expect(verdict(never).completion.status).toBe('limited')
    // visual QA on the running app is proof it ran
    const visual = { deliveryId: 'd', kind: 'visual', status: 'done', findings: [], metrics: {}, shots: [] } as never
    expect(readiness(delivery, [task], [], [visual, audit], [], true, null, never).dimensions.find((d) => d.dimension === 'runtime')?.applies).toBe(false)
  })
  it('the app really running is what verifies it', () => {
    const r = verdict(runtimeEvidence({ kind: 'script', status: 'running', error: null, url: 'http://127.0.0.1:1/' }, null))
    expect(r.completion.status).toBe('verified')
    expect(r.dimensions.find((d) => d.dimension === 'runtime')?.status).toBe('verified')
  })
  it('projects without a preview are unaffected', () => {
    expect(runtimeEvidence({ kind: 'none', status: 'unavailable', error: null, url: null }, null)).toBeNull()
  })
})

describe('temporary worktrees', () => {
  it('a server left running from a worktree is stopped with it, and only that one', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autopia wt.'))
    const [mine, other] = [join(base, 'task-1'), join(base, 'task-2')]
    for (const d of [mine, other]) {
      mkdirSync(d)
      writeFileSync(join(d, 'server.cjs'), 'setInterval(() => {}, 1000)')
    }
    const a = spawn('node', [join(mine, 'server.cjs')], { stdio: 'ignore' })
    const b = spawn('node', [join(other, 'server.cjs')], { stdio: 'ignore' })
    const exited = new Promise<void>((r) => a.on('exit', () => r()))
    await new Promise((r) => setTimeout(r, 300))
    expect(await stopWorktreeProcesses(mine)).toBe(1)
    await exited
    expect(b.exitCode).toBeNull()
    b.kill()
  })
  it('teammates are told an install in a worktree is not a fix', () => {
    const p = workSystemPrompt({ name: 'Theo', title: 'Dev', capabilities: [] } as never, 'code' as never)
    expect(p).toMatch(/node_modules is not delivered/)
    expect(p).toMatch(/Never report an install as a fix/)
  })
})

// the real manager with real processes; only the window toolkit is stubbed
vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: { fromPartition: () => ({}) }, app: { getPath: () => tmpdir() } }))

describe('the preview follows the project folder', () => {
  const app = (dir: string, extra: object = {}) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'node server.cjs' }, ...extra }))
    // crashes until the fix lands, like a dev server whose config can't load
    writeFileSync(join(dir, 'server.cjs'), `const fs=require('fs');if(!fs.existsSync(__dirname+'/fixed')){console.error("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'");process.exit(1)};require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT,'127.0.0.1')`)
  }
  const until = async (m: { info: (p: never) => { status: string } }, p: never, want: string) => {
    for (let i = 0; i < 80 && m.info(p).status !== want; i++) await new Promise((r) => setTimeout(r, 100))
    return m.info(p).status
  }
  const setup = async () => {
    const { PreviewManager } = await import('../src/main/preview')
    const dir = mkdtempSync(join(tmpdir(), 'autopia-preview-'))
    app(dir)
    const m = new PreviewManager(() => null, () => undefined, join(dir, 'pids'))
    return { m, dir, p: { id: 'p', path: dir } as never }
  }

  it('reports a crash with the real error, and restarts what you confirmed once the fix is merged', async () => {
    const { m, dir, p } = await setup()
    await m.start(p, true)
    expect(await until(m as never, p, 'crashed')).toBe('crashed')
    expect(m.info(p).error).toMatch(/ERR_MODULE_NOT_FOUND/)
    writeFileSync(join(dir, 'fixed'), '')
    await m.refreshAfterChange(p)
    expect(await until(m as never, p, 'running')).toBe('running')
    expect(m.info(p).error).toBeNull()
    await m.stop('p')
  }, 60_000)

  it('never runs an install you did not confirm: the stale crash clears and it waits for you', async () => {
    const { m, dir, p } = await setup()
    await m.start(p, true)
    await until(m as never, p, 'crashed')
    app(dir, { dependencies: { 'left-pad': '^1.0.0' } })
    await m.refreshAfterChange(p)
    const info = m.info(p)
    expect(info.status).toBe('stopped')
    expect(info.error).toBeNull()
    expect(info.command).toBe('npm install && npm run dev')
    expect(info.reason).toMatch(/installs them first/)
  }, 60_000)

  it('shows what a restart would really run, even on a crashed preview', async () => {
    const { m, dir, p } = await setup()
    await m.start(p, true)
    await until(m as never, p, 'crashed')
    app(dir, { dependencies: { 'left-pad': '^1.0.0' } })
    expect(m.info(p).status).toBe('crashed')
    expect(m.info(p).command).toBe('npm install && npm run dev')
  }, 60_000)
})
