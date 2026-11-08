// Phase 75: is this Mac ready, and who gets the first-run touches. The whole journey is in scripts/first-run-e2e.mjs.
import { describe, expect, it } from 'vitest'
import { friendlyError } from '../src/shared/friendlyError'
import { firstRunOnLaunch, readinessOf } from '../src/shared/readiness'
import type { ClaudeInfo } from '../src/shared/types'

const info = (p: Partial<ClaudeInfo>): ClaudeInfo => ({ available: false, path: null, version: null, error: null, restrictions: [], allowedModels: null, ...p })
const signedIn = { loggedIn: true, email: 'a@b.c', organization: null, plan: 'pro', method: 'claude.ai' }

describe('readiness', () => {
  it('still looking is its own state, and nothing can start yet', () => {
    expect(readinessOf(null).state).toBe('checking')
    expect(readinessOf(info({})).state).toBe('checking')
    expect(readinessOf(null).canStart).toBe(false)
  })
  it('missing, outdated and broken each say what to do, with the raw message kept aside', () => {
    const missing = readinessOf(info({ error: 'Claude Code CLI not found on PATH.' }))
    expect([missing.state, missing.canStart]).toEqual(['missing', false])
    expect(missing.command).toContain('install')
    expect(missing.body).not.toMatch(/PATH/)
    expect(missing.detail).toMatch(/PATH/)
    const old = readinessOf(info({ path: '/x/claude', version: '1.0.0 (Claude Code)', error: 'This Claude Code version (1.0.0) lacks --json-schema, which Autopia needs' }))
    expect(old.state).toBe('outdated')
    expect(old.body).toContain('1.0.0')
    expect(old.body).not.toContain('--')
    expect(readinessOf(info({ path: '/x/claude', error: 'claude --version failed: boom' })).state).toBe('broken')
  })
  it('finding Claude Code never counts as being signed in', () => {
    const found = { available: true, path: '/x/claude', version: '2.0.0' }
    const out = readinessOf(info({ ...found, account: { ...signedIn, loggedIn: false } }))
    expect([out.state, out.canStart]).toEqual(['signedOut', false])
    expect(readinessOf(info({ ...found, account: null })).state).toBe('unconfirmed')
    expect(readinessOf(info({ ...found })).state).toBe('unconfirmed')
    expect(readinessOf(info({ ...found, account: signedIn })).state).toBe('ready')
  })
  it('couldn’t tell doesn’t block: a real problem shows on the first request', () => {
    expect(readinessOf(info({ available: true, path: '/x/claude', account: null })).canStart).toBe(true)
  })
})

describe('who gets first-run touches', () => {
  it('only someone who started with no products', () => {
    expect(firstRunOnLaunch(null, 0)).toBe('new')
    expect(firstRunOnLaunch(null, 3)).toBeNull()
  })
  it('an unfinished first run resumes, and a finished one stays finished, whatever exists now', () => {
    expect(firstRunOnLaunch('new', 1)).toBe('new')
    expect(firstRunOnLaunch('done', 0)).toBe('done')
  })
  it('anything odd in storage counts as nothing', () => {
    expect(firstRunOnLaunch('banana', 2)).toBeNull()
  })
})

describe('first-run errors in plain words', () => {
  it.each([
    ['Invalid API key · Please run /login', 'isn’t signed in'],
    ['Failed to start Claude Code: spawn claude ENOENT', 'couldn’t start'],
    ['Command failed: /x/claude auth login', 'Sign-in didn’t finish'],
    ['spawn git ENOENT', 'needs Git'],
    ['EACCES: permission denied, mkdir', 'isn’t allowed to write']
  ])('%s', (raw, words) => {
    const e = friendlyError(raw)
    expect(e.message).toContain(words)
    expect(e.detail).toBe(raw)
  })
})
