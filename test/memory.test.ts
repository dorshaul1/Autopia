import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeEntry } from '../src/shared/types'
import { buildContext, existingFor, fileMatch, preferenceIn } from '../src/main/memory/memory'
import { isSecretPath, redact } from '../src/main/memory/secrets'
import { indexRepository } from '../src/main/memory/indexer'

const k = (p: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: Math.random().toString(36).slice(2),
  projectId: 'p',
  kind: 'completed',
  topic: 't',
  title: 'title',
  text: 'text',
  rationale: null,
  alternatives: null,
  files: [],
  hashes: {},
  commit: null,
  source: 's',
  confidence: 'reported',
  status: 'active',
  author: 'agent',
  uses: 0,
  lastUsedAt: null,
  createdAt: 0,
  updatedAt: 0,
  stale: false,
  ...p
})

describe('retrieval', () => {
  const entries = [
    k({ kind: 'workflow', confidence: 'verified', author: 'system', title: 'Build, test and run', text: '`npm test` → node --test' }),
    k({ kind: 'completed', title: 'T1 List rendering', text: 'renders items', files: ['public/app.js'] }),
    k({ kind: 'completed', title: 'T2 Server port', text: 'reads PORT', files: ['server.js'] }),
    k({ kind: 'completed', title: 'T0 Old', text: 'outdated', files: ['public/app.js'], status: 'stale', stale: true }),
    k({ kind: 'decision', title: 'Plain DOM, no framework', text: 'Keep vanilla JS', rationale: 'tiny app' }),
    k({ kind: 'lesson', topic: 'lesson:founder:ask:npm-test', title: 'Claude Code asked 5 times', text: 'x' })
  ]

  it('selects relevant, current entries and labels their provenance', () => {
    const pack = buildContext(entries, { purpose: 'task', text: 'Add a counter to the item list in app.js', files: ['public/app.js'], taskKind: 'code', size: 's' }, 'abc1234def')
    expect(pack.text).toContain('List rendering')
    expect(pack.text).toContain('npm test')
    expect(pack.text).not.toContain('Server port')
    expect(pack.text).not.toContain('outdated') // stale knowledge is never sent
    expect(pack.text).not.toContain('asked 5 times') // founder-only insight
    expect(pack.text).toContain('the repository is the source of truth'.replace('the', 'The'))
    expect(pack.text).toMatch(/Read from the repository at abc1234/)
    expect(pack.chars).toBeLessThanOrEqual(1000 + 400)
  })

  it('respects the size budget', () => {
    const many = Array.from({ length: 60 }, (_, i) => k({ kind: 'completed', title: `T${i} app work`, text: 'x'.repeat(200), files: ['public/app.js'] }))
    const pack = buildContext(many, { purpose: 'task', text: 'app', files: ['public/app.js'], size: 's' }, null)
    expect(pack.ids.length).toBeLessThan(8)
  })

  it('matches files by path, directory and glob', () => {
    expect(fileMatch('src/a.ts', 'src/a.ts')).toBe(true)
    expect(fileMatch('src/**', 'src/a.ts')).toBe(true)
    expect(fileMatch('src/a.ts', 'lib/a.ts')).toBe(false)
  })
})

describe('privacy', () => {
  it('recognizes secret files', () => {
    for (const f of ['.env', 'config/.env.local', 'id_rsa', 'certs/server.pem', 'secrets.json', 'gcp/service-account-prod.json']) expect(isSecretPath(f)).toBe(true)
    for (const f of ['env.ts', 'src/environment.js', 'keyboard.js', 'README.md']) expect(isSecretPath(f)).toBe(false)
  })

  it('redacts credentials from any stored text', () => {
    const t = redact('use API_KEY=abcd1234efgh and token ghp_abcdefghijklmnopqrstuvwxyz123456 or sk-ant-api03-abcdefghijklmnopqrst; "password": "hunter2!"')
    expect(t).not.toMatch(/abcd1234efgh|ghp_abc|sk-ant-api03|hunter2/)
    expect(t).toContain('[redacted]')
  })

  it('indexes a repository without opening or listing secret files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopia-mem-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test', dev: 'node server.js' }, dependencies: { express: '^4' } }))
    writeFileSync(join(dir, '.env'), 'STRIPE_SECRET=sk_live_supersecretvalue123')
    writeFileSync(join(dir, 'server.js'), 'console.log(1)')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.test.js'), '')
    const r = await indexRepository(dir, false)
    const all = JSON.stringify(r.facts)
    expect(all).not.toContain('supersecret')
    expect(all).not.toContain('.env')
    expect(r.skippedSecrets).toBe(1)
    expect(r.facts.find((f) => f.kind === 'stack')?.text).toContain('Express')
    expect(r.facts.find((f) => f.kind === 'workflow')?.text).toContain('npm test')
    expect(r.facts.find((f) => f.kind === 'convention')?.text).toContain('node:test')
  })
})

describe('exploration metric', () => {
  it('counts surveying, not reading the files a task edits', async () => {
    const { countExploration } = await import('../src/main/memory/memory')
    const ev = (toolName: string, summary: string) => ({ id: 0, runId: 'r', seq: 0, ts: 0, kind: 'tool_use' as const, summary, detail: null, toolName, isError: false })
    expect(
      countExploration([
        ev('Bash', '$ ls public && cat package.json'),
        ev('Read', 'Read public/app.js'),
        ev('Read', 'Read server.js'),
        ev('Grep', 'Search "render"'),
        ev('Edit', 'Edit public/app.js'),
        ev('Bash', '$ npm test')
      ])
    ).toBe(3)
  })
})

describe('code relationships', () => {
  it('resolves relative imports and reports both directions for task files', async () => {
    const { importGraph } = await import('../src/main/memory/indexer')
    const { relationships } = await import('../src/main/memory/memory')
    const dir = mkdtempSync(join(tmpdir(), 'autopia-graph-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.js'), "import { b } from './b.js'\nimport x from 'react'\n")
    writeFileSync(join(dir, 'src', 'b.js'), "export const b = require('./c')\n")
    writeFileSync(join(dir, 'src', 'c.js'), '')
    const g = importGraph(dir, ['src/a.js', 'src/b.js', 'src/c.js'])
    expect(g).toEqual({ 'src/a.js': ['src/b.js'], 'src/b.js': ['src/c.js'] })
    expect(relationships(g, ['src/b.js'])).toEqual(['- src/b.js imports src/c.js; used by src/a.js'])
  })
})

describe('knowing what the project already has', () => {
  const symbols = { 'src/lib/money.ts': ['formatPrice', 'Currency'], 'src/ui/Button.tsx': ['Button'], 'src/ui/App.tsx': ['App'], 'test/money.test.ts': ['priceFixture'] }
  it('points at what exists under a related name, before anyone writes another', () => {
    expect(existingFor(symbols, 'Show the price on the checkout page', [])).toEqual([{ file: 'src/lib/money.ts', name: 'formatPrice' }])
    expect(existingFor(symbols, 'Add a button to the header', [])).toEqual([{ file: 'src/ui/Button.tsx', name: 'Button' }])
  })
  it('stays quiet about vague names, tests and the files already in the task', () => {
    expect(existingFor(symbols, 'Fix the app shell', [])).toEqual([])
    expect(existingFor(symbols, 'Add a button', ['src/ui/Button.tsx'])).toEqual([])
    expect(existingFor(symbols, 'fixture for tests', [])).toEqual([])
  })
  it('hears a lasting wish, and only that', () => {
    expect(preferenceIn('Nice work. Never use inline styles.')).toBe('Never use inline styles.')
    expect(preferenceIn('From now on keep commits small')).toBe('From now on keep commits small')
    expect(preferenceIn('Make the header blue')).toBeNull()
    expect(preferenceIn('never mind, always mind me')).toBeNull()
    expect(preferenceIn('Should we always do this?')).toBeNull()
  })
  it('a stated preference always reaches the agent; design direction only reaches designers', () => {
    const entry = (topic: string, kind: 'convention', text: string) => ({ id: topic, projectId: 'p', kind, topic, title: topic, text, rationale: null, alternatives: null, files: [], hashes: {}, commit: null, source: 's', confidence: 'user' as const, status: 'active' as const, author: 'user' as const, uses: 0, lastUsedAt: null, createdAt: 0, updatedAt: 0, stale: false, statusNote: null })
    const q = (taskKind: 'code' | 'design') => ({ purpose: 'task' as const, text: 'unrelated work', files: [], taskKind })
    const pref = entry('preference:no-inline', 'convention', 'Never use inline styles')
    const dir = { ...entry('convention:design-direction', 'convention', 'Warm and calm'), confidence: 'reported' as const, author: 'agent' as const }
    expect(buildContext([pref, dir], q('code'), null).text).toContain('Never use inline styles')
    expect(buildContext([dir], q('code'), null).text).not.toContain('Warm and calm')
    expect(buildContext([dir], q('design'), null).text).toContain('Warm and calm')
  })
})
