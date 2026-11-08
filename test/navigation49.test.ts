import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contextActions } from '../src/shared/contextActions'
import { MORE_STAGES, placeOf, PRIMARY_STAGES, stageOf, type Stage } from '../src/shared/stages'
import type { WhatsNext } from '../src/shared/whatsNext'

const all: Stage[] = [...PRIMARY_STAGES, ...MORE_STAGES]
const full = { section: 'tasks', resultPane: 'preview' }

describe('stages', () => {
  it('every stage maps to a place and back', () => {
    for (const s of all) expect(stageOf({ ...full, ...placeOf(s) }), s).toBe(s)
  })
  it('old saved places still land somewhere', () => {
    expect(stageOf({ view: 'workspace', section: 'overview', resultPane: 'preview' })).toBe('overview')
    expect(stageOf({ view: 'result', section: 'tasks', resultPane: 'all' })).toBe('review')
    expect(stageOf({ view: 'home', section: 'tasks', resultPane: 'preview' })).toBeNull()
  })
  it('Review remembers which of its views you were on, and is never the preview', () => {
    expect(placeOf('review', 'checks').resultPane).toBe('checks')
    expect(placeOf('review', 'preview').resultPane).toBe('all')
  })
  const none = { current: null, hasDeliveries: false, hasTasks: false, hasRuns: false, hasBrief: false }
  it('four places, a few tools, and the brief opens from the Overview', () => {
    expect(PRIMARY_STAGES).toEqual(['overview', 'office', 'preview', 'review'])
    expect(MORE_STAGES).toEqual(['cost', 'files', 'operations', 'memory', 'logs'])
    expect(PRIMARY_STAGES).not.toContain('brief')
    expect(MORE_STAGES).not.toContain('brief')
  })
  it('time and cost keeps its place', () => {
    expect(stageOf({ view: 'workspace', section: 'insights', resultPane: 'all' })).toBe('cost')
    expect(placeOf('cost')).toEqual({ view: 'workspace', section: 'insights' })
  })
  it('a page a window remembers but that no longer exists lands on the Overview', () => {
    for (const section of ['tasks', 'anything']) expect(stageOf({ view: 'workspace', section, resultPane: 'all' })).toBe('overview')
  })
})

describe('what makes sense right now', () => {
  const base = { next: null, stage: 'office' as Stage, previewRunning: false, panel: null }
  const working: WhatsNext = { tone: 'info', live: true, text: 'Theo is working', action: { kind: 'stop', label: 'Stop' } }
  it('nothing going on means nothing to press', () => expect(contextActions(base)).toEqual([]))
  it('a decision is the primary action; stopping never is', () => {
    expect(contextActions({ ...base, next: { tone: 'warn', text: 'x', action: { kind: 'decide', label: 'Show me' } } })[0]).toMatchObject({ kind: 'decide', primary: true })
    expect(contextActions({ ...base, next: working })[0]).toMatchObject({ kind: 'stop', primary: false })
  })
  it('live work offers a look, unless you are already looking', () => {
    expect(contextActions({ ...base, next: working }).map((a) => a.kind)).toContain('work')
    expect(contextActions({ ...base, stage: 'overview', next: working }).map((a) => a.kind)).not.toContain('work')
  })
  it('the preview is offered only when running and not already on screen', () => {
    expect(contextActions({ ...base, previewRunning: true }).map((a) => a.kind)).toEqual(['preview'])
    expect(contextActions({ ...base, stage: 'preview', previewRunning: true })).toEqual([])
  })
  it('follows what is selected', () => {
    expect(contextActions({ ...base, panel: { kind: 'employee', id: 'e', name: 'Theo' } })[0]).toMatchObject({ kind: 'message', label: 'Message Theo', employeeId: 'e' })
    expect(contextActions({ ...base, panel: { kind: 'task', id: 't', runId: 'r' } })[0]).toMatchObject({ kind: 'log', runId: 'r' })
    expect(contextActions({ ...base, panel: { kind: 'task', id: 't', runId: null } })).toEqual([])
  })
  it('never crowds the bar', () => {
    const next: WhatsNext = { ...working, also: { kind: 'pause', label: 'Pause' } }
    expect(contextActions({ ...base, next, previewRunning: true, panel: { kind: 'employee', id: 'e', name: 'T' } }).length).toBe(3)
  })
})

describe('no competing versions', () => {
  const root = join(__dirname, '../src/renderer/src')
  const app = readFileSync(join(root, 'App.tsx'), 'utf8')
  it('one composer per place: no office dock, no first-run overlay, no project menu', () => {
    expect(app).not.toMatch(/dock-wrap|FirstRun|NextUp|ExpandedComposer/)
    expect(readFileSync(join(root, 'components/composer/Composer.tsx'), 'utf8')).not.toMatch(/cmp-target/)
  })
  it('no tabs inside the product stages except Review', () => {
    expect(readFileSync(join(root, 'components/workspace/Workspace.tsx'), 'utf8')).not.toMatch(/FocusShell|Tabs/)
  })
  it('an error in the shell cannot take down the whole window', () => {
    for (const label of ['Rail', 'Header', 'Status']) expect(app).toContain(`<ErrorBoundary label="${label}">`)
  })
})

describe('no page is a dead end', () => {
  const root = join(__dirname, '../src/renderer/src')
  const read = (f: string) => readFileSync(join(root, f), 'utf8')
  it('Settings always has its way back, on screen and on Esc', () => {
    expect(read('components/shell/CommandBar.tsx')).toMatch(/view === 'settings'[\s\S]*cbar-back[\s\S]*leaveSettings/)
    expect(read('App.tsx')).toContain("if (s.view === 'settings') return actions.leaveSettings()")
  })
  it('Back returns to where you were, and to Home when no product is open', () => {
    const store = read('store.ts')
    expect(store).toContain("if (s.view === 'settings' && prev.view !== 'settings') beforeSettings =")
    expect(store).toMatch(/leaveSettings\(\) \{[\s\S]*'home'/)
  })
  it('a remembered page that has gone never lands on nothing', () => {
    expect(read('store.ts')).toContain("['home', 'office', 'workspace', 'result', 'settings'].includes")
    expect(read('components/workspace/Workspace.tsx')).toContain('!KNOWN.includes(raw)')
  })
})
