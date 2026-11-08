import { describe, expect, it } from 'vitest'
import { classifyTool, doingOf, SETTLE_MS, WorkTracker } from '../src/shared/workActivity'
import { MIN_STAY_MS, PlaceMachine, placeFor, SETTLE_BEFORE_LEAVING_MS } from '../src/renderer/src/office/workPlace'
import { detectMoments } from '../src/renderer/src/office/moments'
import { LAYOUTS } from '../src/renderer/src/office/offices'

const bash = (command: string) => classifyTool('Bash', { command })

describe('reading the real tools', () => {
  it('sorts what they do', () => {
    expect(classifyTool('Edit', {})).toBe('coding')
    expect(classifyTool('Read', {})).toBe('researching')
    expect(classifyTool('WebSearch', {})).toBe('researching')
    expect(classifyTool('TodoWrite', {})).toBeNull()
    expect(classifyTool('StructuredOutput', {})).toBeNull()
  })
  it('knows a check from any other command', () => {
    for (const c of ['npm test', 'npm run build', 'pnpm typecheck', 'npx vitest run', 'cd web && npm test', 'cd "/Users/a/Application Support/x" && npm test', 'pytest -q', 'cargo test', 'tsc --noEmit']) expect(bash(c), c).toBe('testing')
    for (const c of ['git status', 'ls -la', 'cat a.json', 'cd src && grep -r x .', 'cd "/Users/a/Application Support/x" && git status']) expect(bash(c), c).toBe('researching')
    for (const c of ['npm install', 'mkdir src', 'node scripts/gen.js']) expect(bash(c), c).toBe('coding')
  })
})

describe('one session', () => {
  it('a failed check is debugging until a check passes', () => {
    const w = new WorkTracker('code')
    expect(w.tool('1', 'Bash', { command: 'npm test' }, 0)).toBe('testing')
    expect(w.result('1', true, 1000)).toBe('debugging')
    expect(w.tool('2', 'Read', {}, 2000)).toBe('debugging')
    expect(w.tool('3', 'Edit', {}, 3000)).toBe('debugging')
    expect(w.tool('4', 'Bash', { command: 'npm test' }, 4000)).toBe('testing')
    w.result('4', false, 5000)
    expect(w.tool('5', 'Edit', {}, 5000 + SETTLE_MS)).toBe('coding')
  })
  it('an ordinary command failing is not debugging', () => {
    const w = new WorkTracker('code')
    w.tool('1', 'Bash', { command: 'mkdir src' }, 0)
    expect(w.result('1', true, 100)).toBe('coding')
  })
  it('a check you declined never ran, so nothing failed', () => {
    const w = new WorkTracker('code')
    w.tool('1', 'Bash', { command: 'npm test' }, 0)
    expect(w.result('1', true, 100, 'The user declined this in Autopia. Do not retry it')).toBe('testing')
    expect(w.result('2', true, 100, 'declined')).toBe('testing')
    w.tool('3', 'Bash', { command: 'npm test' }, 200)
    expect(w.result('3', true, 300, 'FAIL src/a.test.ts: expected 1')).toBe('debugging')
  })
  it('a quick read between edits does not flicker', () => {
    const w = new WorkTracker('code')
    w.tool('1', 'Edit', {}, 0)
    expect(w.tool('2', 'Read', {}, 1000)).toBe('coding')
    expect(w.tool('3', 'Read', {}, SETTLE_MS + 1)).toBe('researching')
  })
  it('QA reading code is reviewing', () => {
    expect(new WorkTracker('qa').tool('1', 'Read', {}, 0)).toBe('reviewing')
  })
  it('tools it does not know change nothing', () => {
    const w = new WorkTracker('code')
    w.tool('1', 'Edit', {}, 0)
    expect(w.tool('2', 'SomethingNew', {}, 99_000)).toBe('coding')
  })
})

describe('with missing or late events', () => {
  it('falls back to the workflow state, and that state outranks the last tool', () => {
    expect(doingOf(null)).toBeNull()
    expect(doingOf({ activity: 'idle', doing: 'coding' })).toBeNull()
    expect(doingOf({ activity: 'working' })).toBe('coding')
    expect(doingOf({ activity: 'testing' })).toBe('testing')
    expect(doingOf({ activity: 'meeting', doing: 'researching' })).toBe('planning')
    expect(doingOf({ activity: 'waiting', doing: 'coding' })).toBe('waiting')
    expect(doingOf({ activity: 'error', doing: 'testing' })).toBe('blocked')
    expect(doingOf({ activity: 'reviewing', doing: 'collaborating' })).toBe('collaborating')
  })
})

describe('where the work happens', () => {
  it('developers test at their desk; QA walks over; the planner uses the whiteboard', () => {
    expect(placeFor('engineer', 'testing')).toBe('desk')
    expect(placeFor('qa', 'testing')).toBe('testing')
    expect(placeFor('qa', 'reviewing')).toBe('desk')
    expect(placeFor('pm', 'planning')).toBe('whiteboard')
    expect(placeFor('pm', 'coding')).toBe('desk')
  })
  it('a check over in a moment is not worth the walk', () => {
    const m = new PlaceMachine()
    expect(m.next('testing', 0)).toBe('desk')
    expect(m.next('desk', 1000)).toBe('desk')
    expect(m.next('testing', 2000)).toBe('desk')
    expect(m.next('testing', 2000 + SETTLE_BEFORE_LEAVING_MS)).toBe('testing')
  })
  it('stays through the gaps between commands, then goes back', () => {
    const m = new PlaceMachine()
    m.next('testing', 0)
    m.next('testing', SETTLE_BEFORE_LEAVING_MS)
    expect(m.next('desk', SETTLE_BEFORE_LEAVING_MS + 5000)).toBe('testing')
    expect(m.next('desk', SETTLE_BEFORE_LEAVING_MS + MIN_STAY_MS)).toBe('desk')
  })
  it('being needed or finished brings them straight back', () => {
    const m = new PlaceMachine()
    m.next('testing', 0)
    m.next('testing', SETTLE_BEFORE_LEAVING_MS)
    expect(m.next('desk', SETTLE_BEFORE_LEAVING_MS + 1, true)).toBe('desk')
  })
  it('the planner is at the board as soon as planning starts', () => expect(new PlaceMachine().next('whiteboard', 0)).toBe('whiteboard'))
  it('every office has these places, each with its own character', () => {
    for (const l of Object.values(LAYOUTS)) for (const k of ['whiteboard', 'testing']) expect(l.IDLE_SPOTS[k]?.length, `${l.type} ${k}`).toBeGreaterThan(0)
  })
})

describe('finishing', () => {
  const task = (over: object) => ({ id: 't', status: 'running', assigneeId: 'a', checks: [], dependsOn: [], finishedAt: null, deliveryId: null, ...over }) as never
  it('with no checks is a quiet moment, never a verified one', () => {
    const m = detectMoments({ tasks: { t: task({}) }, deliveries: [] }, { tasks: { t: task({ status: 'done' }) }, deliveries: [] }, 0)
    expect(m.map((x) => x.kind)).toEqual(['finished'])
  })
})
