import { describe, expect, it } from 'vitest'
import type { Project, Task } from '../src/shared/types'
import { evaluateChecks, keepFailures } from '../src/shared/checks'
import { canRunBeside } from '../src/shared/graph'
import { isReady } from '../src/main/orchestrator/stateMachine'
import { fixPrompt, taskPrompt } from '../src/main/orchestrator/prompts'
import { run } from '../src/main/quality/verify'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'team67-'))
writeFileSync(join(dir, 'long.js'), "console.log('FAIL first test'); for (let i = 0; i < 4000; i++) console.log('line ' + i); console.log('summary at the end'); process.exitCode = 1")

// the shape of a real failing run: the failures come first, then pages of passes, then a summary
const realRun = [
  ' FAIL  test/cart.test.ts > cart > adds up the total',
  'AssertionError: expected 41 to be 42',
  ' ❯ test/cart.test.ts:12:20',
  ' FAIL  test/save.test.ts > save > survives a reload',
  'TypeError: Cannot read properties of undefined (reading state)',
  ' ❯ src/save.ts:8:3',
  ...Array.from({ length: 800 }, (_, i) => ` ✓ test/ok${i}.test.ts > passes ${i} 2ms`),
  ' Test Files  2 failed | 80 passed (82)',
  '      Tests  2 failed | 800 passed (802)'
].join('\n')

describe('what a repair is told', () => {
  it('keeps which tests failed and why, as well as the summary', () => {
    // what used to be kept was the end: the summary, and not one failing name
    expect(realRun.slice(-2000)).not.toContain('adds up the total')
    const kept = keepFailures(realRun)
    for (const s of ['adds up the total', 'expected 41 to be 42', 'survives a reload', 'src/save.ts:8:3', '2 failed | 800 passed']) expect(kept).toContain(s)
    expect(kept.length).toBeLessThanOrEqual(3000)
  })
  it('leaves short output alone, and falls back to the end when nothing looks like a failure', () => {
    expect(keepFailures('short')).toBe('short')
    expect(keepFailures('x'.repeat(5000), 100)).toHaveLength(100)
  })
  it('a failed check carries the failures into the repair prompt', () => {
    const [r] = evaluateChecks(['npm test'], [{ command: 'npm test', output: realRun, isError: true, ms: 1, at: 1 } as never])
    expect(r.status).toBe('failed')
    expect(fixPrompt(r, 1, 2, true)).toContain('expected 41 to be 42')
  })
  it('a really long run keeps its opening when captured', async () => {
    const out = await run('node long.js', dir, process.env, 20_000, { tail: 2000 })
    expect(out.ok).toBe(false)
    expect(out.output).toContain('FAIL first test')
    expect(out.output).toContain('summary at the end')
  })
})

const t = (p: Partial<Task>): Task => ({ id: 'x', key: 'T1', title: 'one', description: 'd', acceptance: 'a', status: 'pending', dependsOn: [], files: [], changedFiles: [], validation: [], ...p }) as Task

describe('who can run when', () => {
  it('independent files run side by side, shared ones wait, and unknown scope never runs beside anything', () => {
    const a = t({ files: ['src/a.ts'] })
    expect(canRunBeside(t({ files: ['src/b.ts'] }), [a])).toBe(true)
    expect(canRunBeside(t({ files: ['src/a.ts'] }), [a])).toBe(false)
    expect(canRunBeside(t({ files: [] }), [a])).toBe(false)
    expect(canRunBeside(t({ files: [] }), [])).toBe(true)
    // the plan missed it, but the running task has really changed it
    expect(canRunBeside(t({ files: ['src/c.ts'] }), [t({ files: ['src/a.ts'], changedFiles: ['M src/c.ts'] })])).toBe(false)
  })
  it('a task waits for what it depends on, and goes on only once that is finished or skipped', () => {
    const dep = t({ id: 'd', key: 'T1', status: 'running' })
    const task = t({ id: 'n', key: 'T2', dependsOn: ['d'] })
    const by = (s: Task['status']) => new Map([['d', { ...dep, status: s }], ['n', task]])
    for (const s of ['running', 'merging', 'failed', 'interrupted', 'pending'] as const) expect(isReady(task, by(s))).toBe(false)
    expect(isReady(task, by('done'))).toBe(true)
    expect(isReady(task, by('cancelled'))).toBe(true)
  })
  it('a task whose dependency was skipped is told it is not there', () => {
    const project = { name: 'p', goal: 'g' } as Project
    const text = taskPrompt(project, t({ key: 'T2' }), [], '', [t({ key: 'T1', title: 'Build the store' })])
    expect(text).toContain('T1 Build the store')
    expect(text).toContain('Do not assume its work exists')
    expect(taskPrompt(project, t({ key: 'T2' }), [])).not.toContain('Skipped')
  })
})

describe('asking you plainly', () => {
  it('says what a teammate wants in plain words', async () => {
    const { permissionAsk } = await import('../src/shared/decisions')
    expect(permissionAsk('Bash')).toBe('run a command')
    expect(permissionAsk('Read')).toBe('read a file')
    expect(permissionAsk('Edit')).toBe('change a file')
    expect(permissionAsk('mcp__github__create_issue')).toBe('use github')
    expect(permissionAsk('Strange')).toBe('use Strange')
  })
  it('offers first what people choose, and a decline is always there', async () => {
    const { decisionOptions } = await import('../src/shared/decisions')
    const step = decisionOptions({ kind: 'permission', taskId: 't' }, { live: true })
    expect(step.map((o) => o.label)).toEqual(['Decline', 'Allow once', 'Allow for this step'])
    expect(step.find((o) => o.primary)?.label).toBe('Allow for this step')
    // not in a step, there's nothing wider to offer
    expect(decisionOptions({ kind: 'permission', taskId: null }, { live: true }).find((o) => o.primary)?.label).toBe('Allow once')
  })
  it('agents are told not to cause avoidable prompts, and never told to skip one', async () => {
    const { workSystemPrompt } = await import('../src/main/orchestrator/prompts')
    const text = workSystemPrompt({ name: 'A B', role: 'Frontend Engineer', kinds: ['code'], capabilities: [] } as never, 'code', 'startup', false)
    expect(text).toContain('Do not start a command with `cd`')
    expect(text).not.toMatch(/skip.*permission|bypass/i)
  })
})

describe('starting something', () => {
  it('a name used before gets the next free folder, and the old one is untouched', async () => {
    const { prepareNewProjectDir } = await import('../src/main/projectFs')
    const { readFileSync } = await import('node:fs')
    const parent = mkdtempSync(join(tmpdir(), 'names-'))
    const first = prepareNewProjectDir(parent, 'Tiny Timer')
    writeFileSync(join(first, 'index.html'), 'mine')
    const second = prepareNewProjectDir(parent, 'Tiny Timer')
    expect(second).toBe(`${first}-2`)
    expect(readFileSync(join(first, 'index.html'), 'utf8')).toBe('mine')
    // still empty, so it's still free
    expect(prepareNewProjectDir(parent, 'Tiny Timer')).toBe(second)
  })
})

describe('saying what to build', () => {
  it('a description is a request, however it is worded', async () => {
    const { describesAProduct } = await import('../src/shared/conversation')
    // from a real run: this got "thanks for the summary" and nothing was built
    expect(describesAProduct('A tiny countdown timer page served by a small Node server with no dependencies.')).toBe(true)
    expect(describesAProduct('A landing page for my bakery, with pre-orders')).toBe(true)
    expect(describesAProduct('Recipe manager for my family')).toBe(true)
  })
  it('questions, greetings and thinking aloud still get a reply', async () => {
    const { describesAProduct } = await import('../src/shared/conversation')
    for (const t of ['hi', 'What can you build for me?', 'how does this work', 'I was thinking about a contact page', 'maybe a small game of some kind', 'thanks that looks good']) expect(describesAProduct(t)).toBe(false)
  })
  it('the Start button decides, not the wording', () => {
    const src = readFileSync(join(__dirname, '../src/renderer/src/components/home/Creator.tsx'), 'utf8')
    expect(src).toContain("intent: 'build', instruction: true")
  })
})
