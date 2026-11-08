import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { quickChecks, runSelfChecks } from '../src/main/quality/verify'
import { NEVER_COMMIT } from '../src/main/git/git'
import { buildArgs, setSupportedFlags, WORK_TOOLS } from '../src/main/claude/cli'
import { understand } from '../src/shared/conversation'
import type { Project } from '../src/shared/types'

const pkg = (scripts: object, dependencies: object = {}) => JSON.stringify({ name: 'x', scripts, dependencies })
function setup(scripts: object, deps: object = {}) {
  const root = mkdtempSync(join(tmpdir(), 'engine40-'))
  const project = join(root, 'project')
  const copy = join(root, 'copy')
  mkdirSync(project)
  mkdirSync(copy)
  writeFileSync(join(project, 'package.json'), pkg(scripts, deps))
  writeFileSync(join(copy, 'package.json'), pkg(scripts, deps))
  return { project, copy, p: { path: project } as Project }
}
const allow = () => false

describe('checks Autopia runs itself', () => {
  it('runs the quick ones: never build, which waits for the full run', () => {
    const { copy } = setup({ test: 'node -e 0', build: 'node -e 0', typecheck: 'node -e 0' })
    expect(quickChecks(copy)).toEqual(['npm run typecheck', 'npm run test'])
  })
  it('reports real pass and failure, with the output', async () => {
    const { copy, p } = setup({ test: 'node t.js' })
    writeFileSync(join(copy, 't.js'), 'console.log("nope"); process.exit(1)')
    const [bad] = await runSelfChecks(p, copy, ['npm run test'], process.env, allow)
    expect(bad.isError).toBe(true)
    expect(bad.output).toContain('nope')
    writeFileSync(join(copy, 't.js'), 'process.exit(0)')
    expect((await runSelfChecks(p, copy, ['npm run test'], process.env, allow))[0].isError).toBe(false)
  })
  it('a working copy borrows the project folder’s packages instead of installing again', async () => {
    const { project, copy, p } = setup({ test: 'node t.js' }, { dep: '1.0.0' })
    mkdirSync(join(project, 'node_modules/dep'), { recursive: true })
    writeFileSync(join(project, 'node_modules/dep/package.json'), JSON.stringify({ version: '1.0.0' }))
    writeFileSync(join(copy, 't.js'), 'require("fs").statSync("node_modules/dep/package.json")')
    const [r] = await runSelfChecks(p, copy, ['npm run test'], process.env, allow)
    expect(r.isError).toBe(false)
    expect(lstatSync(join(copy, 'node_modules')).isSymbolicLink()).toBe(true)
  })
  it('never installs through the link, and a denied install says it did not run', async () => {
    const { project, copy, p } = setup({ test: 'node -e 0' }, { dep: '1.0.0' })
    mkdirSync(join(project, 'node_modules/dep'), { recursive: true })
    writeFileSync(join(project, 'node_modules/dep/package.json'), JSON.stringify({ version: '1.0.0' }))
    writeFileSync(join(copy, 'package.json'), pkg({ test: 'node -e 0' }, { dep: '1.0.0', other: '1.0.0' }))
    const [r] = await runSelfChecks(p, copy, ['npm run test'], process.env, () => true)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/did not run/)
    expect(existsSync(join(copy, 'node_modules'))).toBe(false)
    expect(readFileSync(join(project, 'node_modules/dep/package.json'), 'utf8')).toContain('1.0.0')
  })
  it('the borrowed folder is never committed', () => {
    expect(NEVER_COMMIT.test('node_modules')).toBe(true)
    expect(NEVER_COMMIT.test('app/node_modules/x.js')).toBe(true)
    expect(NEVER_COMMIT.test('src/node_modules_helper.ts')).toBe(false)
  })
})

describe('what a session carries', () => {
  const spec = (extra: object) => ({ cwd: '/', prompt: 'x', systemPrompt: 'y', sessionId: 's', resume: false, permissionProfile: 'standard', ...extra }) as Parameters<typeof buildArgs>[0]
  it('workers get the tools they use; subagents only when routed', () => {
    setSupportedFlags(new Set(['--tools']))
    const args = buildArgs(spec({ mode: 'write' }))
    expect(args[args.indexOf('--tools') + 1]).toBe(WORK_TOOLS.join(','))
    setSupportedFlags(new Set(['--tools', '--agents']))
    const routed = buildArgs(spec({ mode: 'write', agents: { a: {} } }))
    expect(routed[routed.indexOf('--tools') + 1]).toContain('Task')
    setSupportedFlags(null)
  })
  it('an old Claude Code without the flag still works', () => {
    setSupportedFlags(new Set())
    expect(buildArgs(spec({ mode: 'write' }))).not.toContain('--tools')
    setSupportedFlags(null)
  })
})

describe('a bug report', () => {
  it('needs no conversation first', () => {
    expect(understand('Bug: the cart total is wrong with two items')).toBe('work')
  })
})

describe('foundation', () => {
  it('a request that mentions status is a request, not a status question', async () => {
    const { isStatusQuestion } = await import('../src/shared/composer')
    const text = 'Build a small task tracker web app: add tasks, mark them done, filter by status, saved in the browser.'
    expect(isStatusQuestion(text)).toBe(false)
    expect(understand(text)).toBe('work')
    expect(isStatusQuestion("what's the status")).toBe(true)
    expect(isStatusQuestion('what is the progress on the rather long list of pages we discussed earlier today?')).toBe(true)
    expect(isStatusQuestion('I think the status page should show more detail about each of the deploys we run')).toBe(false)
  })
  it('the foundation is checked with its build; other steps are not', () => {
    const { copy } = setup({ test: 'node -e 0', build: 'node -e 0' })
    expect(quickChecks(copy)).toEqual(['npm run test'])
    expect(quickChecks(copy, true)).toEqual(['npm run build', 'npm run test'])
  })
})

describe('one check under different spellings', () => {
  it('counts as one', async () => {
    const { checkKey } = await import('../src/shared/checks')
    for (const c of ['npm test', 'npm test 2>&1', 'npm run test', 'cd "/a b" && npm test 2>&1', 'npm t']) expect(checkKey(c)).toBe('npm run test')
    expect(checkKey('npm run build')).toBe('npm run build')
    expect(checkKey('npm run test:e2e')).toBe('npm run test:e2e')
  })
})

describe('no evidence, no verified', () => {
  it('nothing run is never verified', async () => {
    const { nextStep } = await import('../src/shared/delivery')
    const base = { attempts: 0, limit: 2, lastSignature: null, canRepair: true }
    expect(nextStep({ ...base, steps: [] }).state).toBe('blocked')
    expect(nextStep({ ...base, steps: [{ id: 'server', label: 'Dev server', status: 'skipped', command: null, detail: '', ms: 0 }] }).state).toBe('blocked')
    expect(nextStep({ ...base, steps: [{ id: 'render', label: 'Page', status: 'passed', command: null, detail: '', ms: 0 }] }).state).toBe('verified')
  })
})

describe('what counts as security-sensitive', () => {
  it('real auth work does; ordinary words do not', async () => {
    const { SECURITY_SIGNALS } = await import('../src/shared/signals')
    for (const t of ['Add login with a password', 'Store the session token safely', 'Encrypt user data', 'Add authentication', 'validate the JWT']) expect(SECURITY_SIGNALS.test(t)).toBe(true)
    for (const t of ['Generate ids with crypto.randomUUID()', 'Tasks persist across sessions', 'design tokens are not a word here', 'written by the page authors']) expect(SECURITY_SIGNALS.test(t)).toBe(false)
  })
})
