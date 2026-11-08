import { describe, expect, it } from 'vitest'
import { commandProblem, makeTargets, readEnvironment, splitCommand, type EnvCommand } from '../src/shared/environment'
import { checkView, failureLines, launchReadiness, opSignature, opsLine, problemsNow, testSummary, versionFits, type LaunchFacts } from '../src/shared/operations'
import { MORE_STAGES, PRIMARY_STAGES, placeOf, stageOf } from '../src/shared/stages'
import type { ValidationRun } from '../src/shared/types'

const pkg = (o: object) => JSON.stringify(o)
const read = (files: Record<string, string>, extra: string[] = []) => readEnvironment({ files: [...Object.keys(files), ...extra], read: files })

describe('reading a project from its files', () => {
  it('a web app: its framework, its package manager, only its own scripts', () => {
    const e = read({ 'package.json': pkg({ scripts: { dev: 'vite', build: 'vite build', test: 'vitest run', typecheck: 'tsc' }, devDependencies: { vite: '5', vitest: '1', typescript: '5' } }), 'pnpm-lock.yaml': '', 'tsconfig.json': '{}' })
    expect(e.type).toBe('web')
    expect(e.frameworks).toContain('Vite')
    expect(e.languages).toEqual(['TypeScript'])
    expect(e.packageManager).toBe('pnpm')
    expect(e.run[0]).toMatchObject({ command: 'pnpm run dev', expects: 'port' })
    expect(e.checks.map((c) => c.command)).toEqual(['pnpm run typecheck', 'pnpm run build', 'pnpm run test'])
    expect(e.install?.command).toBe('pnpm install')
  })

  it('no test script means no test command, whatever else is there', () => {
    const e = read({ 'package.json': pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1', start: 'node .' } }) })
    expect(e.checks.find((c) => c.kind === 'test')).toBeUndefined()
  })

  it('electron is a desktop app with no page to wait for', () => {
    const e = read({ 'package.json': pkg({ scripts: { start: 'electron .' }, devDependencies: { electron: '30' } }) })
    expect(e.type).toBe('desktop')
    expect(e.run[0].expects).toBe('process')
  })

  it('a game engine decides the type, and what can’t run here says so', () => {
    expect(read({ 'project.godot': '' }).type).toBe('game')
    const unity = read({}, ['Assets', 'ProjectSettings'])
    expect(unity.type).toBe('game')
    expect(unity.run).toEqual([])
    expect(unity.limits.join()).toMatch(/Unity/)
    expect(read({}, ['Thing.xcodeproj']).limits.join()).toMatch(/Xcode/)
  })

  it('a phaser project is a game, not a generic web app', () => {
    expect(read({ 'package.json': pkg({ scripts: { dev: 'vite' }, dependencies: { phaser: '3' }, devDependencies: { vite: '5' } }) }).type).toBe('game')
  })

  it('python: only what its own files name', () => {
    const api = read({ 'requirements.txt': 'fastapi\nuvicorn\npytest\n', 'main.py': '' })
    expect(api.type).toBe('backend')
    expect(api.run[0].command).toBe('python3 -m uvicorn main:app --host 127.0.0.1 --port $PORT')
    expect(api.checks.map((c) => c.command)).toEqual(['python3 -m pytest'])
    expect(api.install?.command).toBe('python3 -m pip install -r requirements.txt')
    // fastapi with no entry file: there's nothing Autopia could honestly start
    expect(read({ 'requirements.txt': 'fastapi\nuvicorn\n' }).run).toEqual([])
    // "flask-cors" is not flask
    expect(read({ 'requirements.txt': 'flask-cors\n', 'app.py': '' }).frameworks).not.toContain('Flask')
  })

  it('go, rust and swift use their own tools', () => {
    const go = readEnvironment({ files: ['go.mod', 'main.go'], read: { 'go.mod': 'module x\n\ngo 1.22\n' }, goMain: true, goTests: false })
    expect(go.type).toBe('cli')
    expect(go.runtimes[0].wants).toBe('1.22')
    expect(go.checks.map((c) => c.command)).toEqual(['go build ./...'])
    const lib = readEnvironment({ files: ['go.mod'], read: { 'go.mod': 'module x\n' }, goMain: false, goTests: true })
    expect(lib.type).toBe('library')
    expect(lib.run).toEqual([])
    expect(lib.checks.map((c) => c.command)).toContain('go test ./...')
    expect(read({ 'Cargo.toml': '[package]\nname="x"\n\n[dependencies]\naxum = "0.7"\n' }).type).toBe('backend')
    expect(read({ 'Cargo.toml': '[dependencies]\nbevy = "0.13"\n' }).type).toBe('game')
  })

  it('a library is not offered a server', () => {
    const e = read({ 'package.json': pkg({ name: 'x', main: 'index.js', scripts: { test: 'node --test', build: 'tsc' } }) })
    expect(e.type).toBe('library')
    expect(e.run).toEqual([])
  })

  it('a Makefile’s real targets fill the gaps, and variables aren’t targets', () => {
    expect(makeTargets('CC := gcc\nFOO:=1\nbuild: main.c\n\t$(CC)\ntest:\n\t./t\n%.o: %.c\n')).toEqual(['build', 'test'])
    const e = read({ Makefile: 'build:\n\tcc\nrun:\n\t./a\n' })
    expect(e.checks.map((c) => c.command)).toEqual(['make build'])
    expect(e.run[0]).toMatchObject({ command: 'make run', expects: 'process' })
  })

  it('a page that is only a canvas reads as a game; a page with words does not', () => {
    expect(read({ 'index.html': '<html><title>Dodge</title><canvas id=c></canvas><script src=g.js></script></html>' }).type).toBe('game')
    expect(read({ 'index.html': `<html><body><p>${'Sales by month across every region we serve, with notes on what changed and why it matters to you. '.repeat(3)}</p><canvas></canvas><script></script></body></html>` }).type).toBe('web')
  })

  it('an empty folder is unknown, and says nothing more', () => {
    const e = read({})
    expect(e.type).toBe('unknown')
    expect(e.run).toEqual([])
    expect(e.checks).toEqual([])
  })

  it('a package.json it can’t read is reported, not guessed at', () => {
    const e = read({ 'package.json': '{oops' })
    expect(e.problems.join()).toMatch(/can’t be read/)
    expect(e.checks).toEqual([])
  })

  it('what you set yourself comes first, and is marked as yours', () => {
    const e = readEnvironment({ files: ['package.json'], read: { 'package.json': pkg({ scripts: { dev: 'vite', test: 'vitest' } }) }, config: { run: './serve.sh --port $PORT', expects: 'port', test: './t.sh' } })
    expect(e.configured).toBe(true)
    expect(e.run[0]).toMatchObject({ id: 'configured', command: './serve.sh --port $PORT', expects: 'port' })
    expect(e.checks.find((c) => c.kind === 'test')).toMatchObject({ command: './t.sh', from: '.autopia/operations.json' })
  })
})

describe('commands stay one program', () => {
  it('refuses anything a shell would interpret', () => {
    for (const bad of ['a; rm x', 'a && b', 'a | b', 'a > f', 'a `b`', 'a $(b)', 'a\nb']) expect(commandProblem(bad)).toBeTruthy()
    expect(commandProblem('')).toBeTruthy()
    expect(commandProblem('python3 manage.py runserver 127.0.0.1:$PORT')).toBeNull()
  })
  it('fills in the port and splits on spaces, with no shell', () => {
    expect(splitCommand('python3 x.py --port $PORT', 4100)).toEqual({ bin: 'python3', args: ['x.py', '--port', '4100'] })
    expect(splitCommand('go run .')).toEqual({ bin: 'go', args: ['run', '.'] })
  })
})

describe('reading what a command printed', () => {
  it('each runner, in its own format', () => {
    expect(testSummary(' Test Files  1 failed (2)\n      Tests  1 failed | 12 passed (13)\n')).toEqual({ passed: 12, failed: 1, skipped: 0 })
    expect(testSummary('Tests:       1 failed, 12 passed, 13 total\n')).toEqual({ passed: 12, failed: 1, skipped: 0 })
    expect(testSummary('test result: FAILED. 3 passed; 1 failed; 2 ignored; 0 measured\n')).toEqual({ passed: 3, failed: 1, skipped: 2 })
    expect(testSummary('===== 1 failed, 3 passed, 2 skipped in 0.12s =====\n')).toEqual({ passed: 3, failed: 1, skipped: 2 })
    expect(testSummary('ℹ tests 3\nℹ pass 2\nℹ fail 1\nℹ skipped 0\n')).toEqual({ passed: 2, failed: 1, skipped: 0 })
    expect(testSummary('  12 passing (3ms)\n  1 failing\n')).toEqual({ passed: 12, failed: 1, skipped: 0 })
    expect(testSummary('ok  \tx/a\t0.1s\nFAIL\tx/b\t0.2s\n')).toEqual({ passed: 1, failed: 1, skipped: 0 })
  })
  it('claims no counts when it can’t read any', () => {
    expect(testSummary('all good, probably\n')).toBeNull()
  })
  it('picks the real error lines, as printed', () => {
    const out = 'building...\nsrc/a.ts(3,1): error TS2304: Cannot find name x.\n    at foo (bar.js:1:1)\nnpm ERR! code ELIFECYCLE\ndone\n'
    expect(failureLines(out)).toEqual(['src/a.ts(3,1): error TS2304: Cannot find name x.'])
  })
  it('a failure’s identity ignores timings and paths, not what failed', () => {
    expect(opSignature('t', 'Error: boom in 12ms at /a/b/c.js:1:2')).toBe(opSignature('t', 'Error: boom in 99ms at /x/y/c.js:9:9'))
    expect(opSignature('t', 'Error: boom')).not.toBe(opSignature('t', 'Error: bang'))
  })
  it('version requests', () => {
    expect(versionFits('>=20', '22.1.0')).toBe(true)
    expect(versionFits('>=20', '18.0.0')).toBe(false)
    expect(versionFits('20', '20.11.1')).toBe(true)
    expect(versionFits('^3.11', '3.10.2')).toBe(false)
    expect(versionFits('>=18 <21', '22.0.0')).toBeNull()
    expect(versionFits(null, '1.0')).toBeNull()
  })
})

const test: EnvCommand = { id: 'test', kind: 'test', label: 'Tests', command: 'npm run test', from: 'x' }
const runOf = (o: Partial<ValidationRun> & { result?: 'passed' | 'failed'; output?: string }): ValidationRun => ({ id: 'v', projectId: 'p', deliveryId: null, runId: null, trigger: 'ops', status: o.result ?? 'passed', checks: o.result ? [{ command: test.command, status: o.result, ok: o.result === 'passed', ms: 1, output: o.output ?? '', at: 1 }] : [], error: null, startedAt: 1, endedAt: 2, command: test.command, stamp: 'A', ...o })

describe('a result only counts for the code it ran against', () => {
  it('not run, running, cancelled, interrupted and unavailable are all different', () => {
    expect(checkView(test, [], 'A', false).state).toBe('not_run')
    expect(checkView(test, [runOf({ status: 'running' })], 'A', false).state).toBe('running')
    expect(checkView(test, [runOf({ status: 'cancelled' })], 'A', false).state).toBe('cancelled')
    expect(checkView(test, [runOf({ status: 'error' })], 'A', false).state).toBe('interrupted')
    expect(checkView(test, [], 'A', true).state).toBe('unavailable')
  })
  it('a pass on this code is current; the same pass after a change is not', () => {
    const r = runOf({ result: 'passed' })
    expect(checkView(test, [r], 'A', false)).toMatchObject({ state: 'passed', current: true, stale: false })
    expect(checkView(test, [r], 'B', false)).toMatchObject({ state: 'passed', current: false, stale: true })
  })
  it('the team’s run in a working copy has no stamp, so it never counts as this code', () => {
    expect(checkView(test, [runOf({ result: 'passed', trigger: 'task', stamp: null })], 'A', false)).toMatchObject({ current: false, stale: true })
  })
  it('the newest run decides', () => {
    expect(checkView(test, [runOf({ id: 'new', result: 'failed' }), runOf({ id: 'old', result: 'passed' })], 'A', false).state).toBe('failed')
  })
  it('an old failure isn’t a problem to act on, and an old pass isn’t a good line', () => {
    const fail = checkView(test, [runOf({ result: 'failed', output: 'Error: boom' })], 'B', false)
    expect(problemsNow({ preview: null, checks: [fail] })).toEqual([])
    expect(opsLine(null, [fail])).toBeNull()
    expect(opsLine(null, [checkView(test, [runOf({ result: 'passed' })], 'B', false)])).toBeNull()
  })
  it('a current failure is, in its own words', () => {
    const fail = checkView(test, [runOf({ result: 'failed', output: 'Error: boom' })], 'A', false)
    expect(problemsNow({ preview: null, checks: [fail] })[0]).toMatchObject({ what: 'Tests failed', said: 'Error: boom' })
    expect(opsLine(null, [fail])?.tone).toBe('danger')
  })
  it('what code can’t fix isn’t sent to the team', () => {
    const taken = problemsNow({ preview: { status: 'crashed', error: 'Port 3000 is already used by node (process 1). Autopia won’t stop it.', command: 'npm run dev', logs: [] }, checks: [] })[0]
    expect(taken).toMatchObject({ outside: true, what: 'It couldn’t start: its port is taken' })
    const net = checkView(test, [runOf({ result: 'failed', output: 'npm ERR! ENOTFOUND registry.npmjs.org' })], 'A', false)
    expect(problemsNow({ preview: null, checks: [net] })[0].outside).toBe(true)
    const code = checkView(test, [runOf({ result: 'failed', output: 'Error: boom' })], 'A', false)
    expect(problemsNow({ preview: null, checks: [code] })[0].outside).toBe(false)
  })
  it('a crash is said, with its real error', () => {
    const p = { status: 'crashed' as const, error: 'exited (code 1)', command: 'npm run dev', logs: ['x'], url: null }
    expect(problemsNow({ preview: p, checks: [] })[0].said).toBe('exited (code 1)')
    expect(opsLine(p, [])?.tone).toBe('danger')
  })
})

const facts = (o: Partial<LaunchFacts> = {}): LaunchFacts => ({ env: { type: 'web', checks: [test], install: null, docs: ['README.md'] }, checks: [checkView(test, [runOf({ result: 'passed' })], 'A', false)], dependencies: null, depsOk: null, missingEnv: [], envNames: [], uncommitted: 0, hasGit: true, artifacts: ['dist'], delivery: null, openQuality: [], crashed: null, ...o })

describe('launch readiness is evidence, never a score', () => {
  it('everything checked and passing, on this exact code', () => {
    const r = launchReadiness(facts())
    expect(r.verdict).toBe('verified')
    expect(JSON.stringify(r)).not.toMatch(/\d+%|score/i)
  })
  it('a stale pass makes it unverified, not ready', () => {
    const r = launchReadiness(facts({ checks: [checkView(test, [runOf({ result: 'passed' })], 'B', false)] }))
    expect(r.verdict).toBe('unverified')
    expect(r.items.find((i) => i.id === 'test')).toMatchObject({ state: 'unknown' })
    expect(r.items.find((i) => i.id === 'test')?.detail).toMatch(/older code/)
  })
  it('never run, no tests, no commands: each says so', () => {
    expect(launchReadiness(facts({ checks: [checkView(test, [], 'A', false)] })).items.find((i) => i.id === 'test')?.detail).toMatch(/Not run/)
    const none = launchReadiness(facts({ env: { type: 'web', checks: [], install: null, docs: ['README.md'] }, checks: [] }))
    expect(none.verdict).toBe('unverified')
    expect(none.items.find((i) => i.id === 'no-checks')).toBeTruthy()
  })
  it('a real failure blocks, and comes first', () => {
    const r = launchReadiness(facts({ checks: [checkView(test, [runOf({ result: 'failed' })], 'A', false)] }))
    expect(r.verdict).toBe('blocked')
    expect(r.items[0].state).toBe('problem')
  })
  it('names environment variables, and never asks about the web unless it’s a web project', () => {
    const r = launchReadiness(facts({ envNames: ['API_KEY'], missingEnv: ['API_KEY'] }))
    expect(r.items.find((i) => i.id === 'config')?.detail).toMatch(/API_KEY/)
    expect(JSON.stringify(launchReadiness(facts({ env: { type: 'library', checks: [test], install: null, docs: [] } })))).not.toMatch(/deploy|hosting|domain/i)
  })
  it('a package that can’t be published says what it lacks', () => {
    const r = launchReadiness(facts({ package: { name: 'x', version: null, exportsSomething: true, isPrivate: false } }))
    expect(r.items.find((i) => i.id === 'package')).toMatchObject({ state: 'problem' })
    expect(r.items.find((i) => i.id === 'package')?.detail).toMatch(/a version/)
  })
})

describe('the stage', () => {
  it('has a place in More, and the main row stays four places', () => {
    expect(MORE_STAGES).toContain('operations')
    expect(PRIMARY_STAGES).toEqual(['overview', 'office', 'preview', 'review'])
    const place = placeOf('operations')
    expect(stageOf({ view: place.view, section: place.section!, resultPane: 'all' })).toBe('operations')
  })
})
