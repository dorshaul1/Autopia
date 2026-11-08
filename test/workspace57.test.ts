import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.stubGlobal('window', { addEventListener: () => undefined, autopia: {} })
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
const { restoredPanel } = await import('../src/renderer/src/store')

const has = { task: (id: string) => id === 't', run: (id: string) => id === 'r', employee: (id: string) => id === 'e', delivery: (id: string) => id === 'd' }
const home = { kind: 'conversation' }

describe('coming back to what you left', () => {
  it('reopens what still exists', () => {
    expect(restoredPanel({ panel: { kind: 'task', id: 't' }, resultId: 'd', thread: 'e' }, has)).toEqual({ sheet: [home, { kind: 'task', id: 't' }], resultId: 'd', threadWith: 'e' })
    expect(restoredPanel({ panel: { kind: 'log', runId: 'r' } }, has).sheet[1]).toEqual({ kind: 'log', runId: 'r' })
  })
  it('anything deleted since falls back quietly', () => {
    expect(restoredPanel({ panel: { kind: 'task', id: 'gone' }, resultId: 'gone', thread: 'gone' }, has)).toEqual({ sheet: [home], resultId: null, threadWith: null })
    expect(restoredPanel({ panel: { kind: 'log', runId: 'gone' } }, has).sheet).toEqual([home])
    expect(restoredPanel({ panel: { kind: 'employee', id: 'gone' } }, has).sheet).toEqual([home])
  })
  it('an old saved layout without these still opens', () => {
    expect(restoredPanel(null, has)).toEqual({ sheet: [home], resultId: null, threadWith: null })
    expect(restoredPanel({}, has)).toEqual({ sheet: [home], resultId: null, threadWith: null })
  })
  it('the office folk are still there', () => {
    expect(restoredPanel({ thread: 'office:corgi' }, has).threadWith).toBe('office:corgi')
  })
})

describe('search', () => {
  const src = readFileSync(join(__dirname, '../src/main/db/repo.ts'), 'utf8')
  const body = src.slice(src.indexOf('  search(query: string'), src.indexOf('// ── employees ─'))
  it('covers every kind of thing, and escapes what you type', () => {
    for (const t of ['tasks', 'deliveries', 'messages', 'employees', 'code_files']) expect(body).toContain(`run('${t}'`)
    expect(body).toContain("ESCAPE '\\\\'")
    expect(body).toContain('.all(...w.params, perKind)')
  })
  it('only reads', () => {
    expect(body).not.toMatch(/INSERT|UPDATE |DELETE/)
  })
  it('there is still one command box, and restoring a place starts nothing', () => {
    const store = readFileSync(join(__dirname, '../src/renderer/src/store.ts'), 'utf8')
    const restore = store.slice(store.indexOf('export function restoredPanel'), store.indexOf('export const actions'))
    expect(restore).not.toMatch(/window\.autopia|retry|start/i)
  })
})
