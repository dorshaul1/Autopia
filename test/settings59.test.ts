import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, defaultsForSection, mcpWord, readableSettings, sectionAtDefaults, settingsErrors, settingsPatch } from '../src/shared/settings'

describe('saving settings', () => {
  it('sends only what changed', () => {
    expect(settingsPatch({ ...DEFAULT_SETTINGS, effort: 'high' }, DEFAULT_SETTINGS)).toEqual({ effort: 'high' })
    expect(settingsPatch(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual({})
  })
  it('holds back a value that can’t be right, and still sends the rest', () => {
    const d = { ...DEFAULT_SETTINGS, maxParallel: 99, quietMode: true }
    expect(settingsErrors(d).maxParallel).toBeTruthy()
    expect(settingsPatch(d, DEFAULT_SETTINGS)).toEqual({ quietMode: true })
    expect(settingsPatch({ ...DEFAULT_SETTINGS, maxParallel: NaN }, DEFAULT_SETTINGS)).toEqual({})
  })
  it('restoring a page only touches that page', () => {
    const notes = defaultsForSection('notifications')
    expect(Object.keys(notes).sort()).toEqual(['desktopNotifications', 'quietMode'])
    for (const g of ['work', 'notifications', 'memory'] as const) {
      expect(defaultsForSection(g)).not.toHaveProperty('permissionProfile')
      expect(defaultsForSection(g)).not.toHaveProperty('preferSubscription')
    }
    expect(sectionAtDefaults('memory', { ...DEFAULT_SETTINGS, effort: 'max' })).toBe(true)
    expect(sectionAtDefaults('work', { ...DEFAULT_SETTINGS, effort: 'max' })).toBe(false)
  })
})

describe('reading stored settings', () => {
  it('keeps every good choice as it is', () => {
    const s = readableSettings({ effort: 'high', maxParallel: 7, autoApprove: true, permissionProfile: 'full', model: 'opus' })
    expect(s).toMatchObject({ effort: 'high', maxParallel: 7, autoApprove: true, permissionProfile: 'full', model: 'opus' })
  })
  it('an old or damaged value reads as its default, alone', () => {
    const s = readableSettings({ effort: 'turbo', maxParallel: 500, quietMode: 'yes', desktopNotifications: 'loud', memoryRetentionDays: 90, somethingOld: 1 })
    expect(s).toMatchObject({ effort: 'auto', maxParallel: DEFAULT_SETTINGS.maxParallel, quietMode: false, desktopNotifications: 'important', memoryRetentionDays: 90 })
    expect(s).not.toHaveProperty('somethingOld')
  })
  it('nothing stored is the defaults', () => {
    expect(readableSettings({})).toEqual(DEFAULT_SETTINGS)
  })
})

describe('settings and earlier versions, in a real database', () => {
  it('a database from before Phase 58 opens with everything kept, and a saved Effort really persists', async () => {
    const { openDatabase } = await import('../src/main/db/database')
    const { Repo } = await import('../src/main/db/repo')
    const file = join(mkdtempSync(join(tmpdir(), 'autopia-mig-')), 'a.db')
    let db = openDatabase(file)
    let repo = new Repo(db)
    repo.updateSettings({ effort: 'high', maxParallel: 6 })
    const p = repo.createProject({ name: 'Old', path: '/tmp/old', goal: 'g', gitEnabled: false, baseBranch: null })
    const team = repo.employees().filter((e) => e.projectId === p.id).map((e) => e.name)
    // back to how an older version left it
    db.exec('ALTER TABLE validations DROP COLUMN command; ALTER TABLE validations DROP COLUMN stamp;')
    db.pragma('user_version = 20')
    db.prepare(`INSERT INTO validations (id, project_id, trigger, status, checks, started_at) VALUES ('v', ?, 'manual', 'passed', '[]', 1)`).run(p.id)
    db.prepare(`INSERT INTO settings (key, value) VALUES ('quietMode', '{oops') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
    db.close()
    db = openDatabase(file)
    repo = new Repo(db)
    expect(repo.projects().map((x) => x.name)).toEqual(['Old'])
    expect(repo.employees().filter((e) => e.projectId === p.id).map((e) => e.name)).toEqual(team)
    expect(repo.settings()).toMatchObject({ effort: 'high', maxParallel: 6, quietMode: false })
    expect(repo.validations(p.id)[0]).toMatchObject({ id: 'v', status: 'passed', command: null, stamp: null })
    db.close()
  })
})

describe('what looks like a credential', () => {
  it('a book author is not one, and a real one still is', async () => {
    const { redact } = await import('../src/main/memory/secrets')
    expect(redact('author: validAuthorName')).toBe('author: validAuthorName')
    expect(redact('authToken: abcdef123456')).toContain('[redacted]')
    expect(redact('auth = abcdef123456')).toContain('[redacted]')
  })
})

describe('a real run settles what a session could not do', () => {
  it('a declined check that really passed is gone, even through a pipe', async () => {
    const { withoutSettled } = await import('../src/shared/checks')
    const c = (command: string, status: 'passed' | 'denied' | 'failed') => ({ command, status })
    expect(withoutSettled([c('npm test 2>&1 | grep x', 'denied'), c('npm run test', 'passed')]).map((x) => x.command)).toEqual(['npm run test'])
    expect(withoutSettled([c('npm test', 'denied')])).toHaveLength(1)
    expect(withoutSettled([c('npm test', 'failed'), c('npm run test', 'passed')])).toHaveLength(2)
  })
  it('a verified result drops only the out-of-date claim', async () => {
    const { summaryLines } = await import('../src/shared/timeline')
    const raw = 'T1 Fix: I fixed the total, but nothing has been run: npm test was declined. It no longer mutates items.'
    expect(summaryLines(raw, true).join()).not.toMatch(/declined|nothing has been run/)
    expect(summaryLines(raw, true).join()).toMatch(/no longer mutates/)
    expect(summaryLines(raw, false).join()).toMatch(/declined/)
  })
})

describe('starting a server is not a check', () => {
  it('refusing it leaves nothing undone, and refusing a real check still does', async () => {
    const { refusedChecks } = await import('../src/shared/checks')
    const e = (command: string) => ({ command, isError: true, output: '', ms: 1, at: 1, founderDenied: true, policyDenied: false })
    expect(refusedChecks([e('PORT=3457 timeout 20 npm run dev')])).toEqual([])
    expect(refusedChecks([e('npm test')])).toEqual(['npm test'])
  })
})

describe('what a design review prompt asks', () => {
  it('a change to an existing product is not an invitation to redesign it', async () => {
    const { designReviewPrompt } = await import('../src/main/skills/expertise')
    const existing = designReviewPrompt({ direction: null, asked: 'Change the heading', type: 'web' })
    expect(existing).toMatch(/notes for the founder/)
    expect(existing).toMatch(/Change the heading/)
    expect(existing).not.toMatch(/Read/)
    expect(designReviewPrompt({ direction: 'Warm and calm', asked: '', type: 'web' })).toMatch(/breaks the direction/)
    expect(designReviewPrompt({ direction: null, asked: 'x', type: 'game' })).toMatch(/can.{0,3}t judge feel/)
    expect(designReviewPrompt({ direction: null, asked: 'This looks rough, make it professional', type: 'web' })).toMatch(/has to look finished/)
    expect(designReviewPrompt({ direction: null, asked: 'Add a total under the table', type: 'web' })).not.toMatch(/has to look finished/)
  })
})

describe('what can change what someone sees', () => {
  it('code and pages can; tests, docs and config can not', async () => {
    const { reachesThePage } = await import('../src/main/quality/engine')
    for (const f of ['index.html', 'game.js', 'src/App.tsx', 'style.css']) expect(reachesThePage(f)).toBe(true)
    for (const f of ['README.md', 'test/a.js', 'a.test.js', 'package.json', 'docs/x.html']) expect(reachesThePage(f)).toBe(false)
  })
})

describe('words', () => {
  it('cuts at a word and says so', async () => {
    const { clip } = await import('../src/shared/friendlyError')
    expect(clip('short', 10)).toBe('short')
    expect(clip('which were declined by the policy', 20)).toBe('which were declined…')
  })
  it('a name from an idea skips the small words', async () => {
    const { projectNameFrom } = await import('../src/shared/composer')
    expect(projectNameFrom('A landing page for my bakery')).toBe('Landing Page Bakery')
  })
  it('a TypeError is an error line', async () => {
    const { failureLines } = await import('../src/shared/operations')
    expect(failureLines("x\nTypeError: Cannot read properties of undefined\n")).toEqual(['TypeError: Cannot read properties of undefined'])
  })
})

describe('what Claude Code says about an MCP server', () => {
  it('in words, and anything unknown as it said it', () => {
    expect(mcpWord('connected').tone).toBe('ready')
    expect(mcpWord('failed').tone).toBe('danger')
    expect(mcpWord('needs-auth').word).toMatch(/signing in/)
    expect(mcpWord('something-new')).toEqual({ word: 'something-new', tone: 'quiet' })
  })
})
