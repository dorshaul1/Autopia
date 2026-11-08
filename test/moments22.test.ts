import { describe, expect, it } from 'vitest'
import { detectMoments, HANDOFF_WINDOW_MS, MomentQueue, visitSpot, type MomentState } from '../src/renderer/src/office/moments'

type Partial2 = Partial<MomentState['tasks'][string]>
const passed = { command: 'npm test', status: 'passed' } as never
const failed = { command: 'npm test', status: 'failed' } as never
const task = (id: string, p: Partial2 = {}) => ({ id, status: 'pending', assigneeId: 'e1', checks: [], dependsOn: [], finishedAt: null, deliveryId: 'd1', ...p }) as MomentState['tasks'][string]
const state = (tasks: MomentState['tasks'][string][], deliveries: MomentState['deliveries'] = []): MomentState => ({ tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), deliveries })
const NOW = 1_000_000

describe('moments come only from real changes', () => {
  it('celebrates a verified completion, never an unverified or failed one', () => {
    const before = state([task('A', { status: 'running' }), task('B', { status: 'running' }), task('C', { status: 'running' })])
    const after = state([task('A', { status: 'done', checks: [passed] }), task('B', { status: 'done', checks: [] }), task('C', { status: 'failed', checks: [failed] })])
    expect(detectMoments(before, after, NOW).filter((m) => m.kind !== 'finished')).toEqual([{ kind: 'verified', employeeId: 'e1', key: 'verified:A' }])
  })

  it('a done task with any failing check is not "verified"', () => {
    expect(detectMoments(state([task('A', { status: 'running' })]), state([task('A', { status: 'done', checks: [passed, failed] })]), NOW)).toEqual([])
  })

  it('notices a new failed check while the work continues', () => {
    const m = detectMoments(state([task('A', { status: 'running', checks: [] })]), state([task('A', { status: 'running', checks: [failed] })]), NOW)
    expect(m).toEqual([{ kind: 'setback', employeeId: 'e1', key: 'setback:A:1' }])
  })

  it('a handoff is a task starting right after a different teammate finished its dependency', () => {
    const done = task('A', { status: 'done', assigneeId: 'theo', finishedAt: NOW - 30_000, checks: [passed] })
    const m = detectMoments(state([done, task('B', { assigneeId: 'ines', dependsOn: ['A'] })]), state([done, task('B', { assigneeId: 'ines', dependsOn: ['A'], status: 'running' })]), NOW)
    expect(m).toEqual([{ kind: 'handoff', employeeId: 'theo', partnerId: 'ines', key: 'handoff:A:B' }])
  })

  it('no handoff for the same person, an old dependency (a later retry), or a dependency that is not done', () => {
    const run = (dep: Partial2, assignee = 'ines') => {
      const a = task('A', { assigneeId: 'theo', ...dep })
      return detectMoments(state([a, task('B', { assigneeId: assignee, dependsOn: ['A'], status: 'failed' })]), state([a, task('B', { assigneeId: assignee, dependsOn: ['A'], status: 'running' })]), NOW)
    }
    expect(run({ status: 'done', finishedAt: NOW - 1000 }, 'theo')).toEqual([])
    expect(run({ status: 'done', finishedAt: NOW - HANDOFF_WINDOW_MS - 1 })).toEqual([])
    expect(run({ status: 'cancelled', finishedAt: NOW - 1000 })).toEqual([])
  })

  it('your accepting a result reaches its finished contributors only', () => {
    const tasks = [task('A', { status: 'done', assigneeId: 'theo' }), task('B', { status: 'done', assigneeId: 'ines' }), task('C', { status: 'cancelled', assigneeId: 'kenji' }), task('D', { status: 'done', assigneeId: 'maya', deliveryId: 'd2' })]
    const m = detectMoments(state(tasks, [{ id: 'd1', status: 'review' }]), state(tasks, [{ id: 'd1', status: 'accepted' }]), NOW)
    expect(m.map((x) => x.employeeId).sort()).toEqual(['ines', 'theo'])
    // discarding is not a celebration
    expect(detectMoments(state(tasks, [{ id: 'd1', status: 'review' }]), state(tasks, [{ id: 'd1', status: 'rejected' }]), NOW)).toEqual([])
  })

  it('loading or switching projects is not an event', () => {
    expect(detectMoments(state([]), state([task('A', { status: 'done', checks: [passed] })], [{ id: 'd1', status: 'accepted' }]), NOW)).toEqual([])
    const same = state([task('A', { status: 'done', checks: [passed] })])
    expect(detectMoments(same, same, NOW)).toEqual([])
  })
})

describe('scheduling', () => {
  const v = (id: string, key = `verified:${id}`) => ({ kind: 'verified' as const, employeeId: id, key })
  it('plays each real event once', () => {
    const q = new MomentQueue()
    expect(q.admit([v('e1')], NOW, () => true)).toHaveLength(1)
    expect(q.admit([v('e1')], NOW + 99, () => true)).toHaveLength(0)
  })

  it('gives each person one moment per batch, the most important first', () => {
    const q = new MomentQueue()
    const out = q.admit([{ kind: 'handoff', employeeId: 'e1', partnerId: 'e2', key: 'h' }, { kind: 'setback', employeeId: 'e1', key: 's' }], NOW, () => true)
    expect(out.map((m) => m.kind)).toEqual(['setback'])
  })

  it('cools down repeated setbacks and handoffs per person', () => {
    const q = new MomentQueue()
    expect(q.admit([{ kind: 'setback', employeeId: 'e1', key: 's1' }], NOW, () => true)).toHaveLength(1)
    expect(q.admit([{ kind: 'setback', employeeId: 'e1', key: 's2' }], NOW + 5000, () => true)).toHaveLength(0)
    expect(q.admit([{ kind: 'setback', employeeId: 'e1', key: 's3' }], NOW + 20_000, () => true)).toHaveLength(1)
  })

  it('never stages what the scene says does not fit real activity right now', () => {
    const q = new MomentQueue()
    expect(q.admit([v('busy')], NOW, () => false)).toHaveLength(0)
    // a refused event is not retried later (it is about that moment)
    expect(q.admit([v('busy')], NOW + 1000, () => true)).toHaveLength(0)
  })
})

describe('visit placement', () => {
  const seat = { tx: 3, ty: 8, facing: 'up' as const, pose: 'sitUp' as const }
  it('stands beside the desk on a free, walkable tile, facing the teammate', () => {
    expect(visitSpot(seat, () => true)).toMatchObject({ tx: 4, ty: 8, facing: 'left', pose: 'stand' })
    expect(visitSpot(seat, (x) => x !== 4)).toMatchObject({ tx: 2, facing: 'right' })
    expect(visitSpot(seat, (x, y) => y === 9)).toMatchObject({ tx: 3, ty: 9, facing: 'up' })
    expect(visitSpot(seat, () => false)).toBeNull()
  })
})
