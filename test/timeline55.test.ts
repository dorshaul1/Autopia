import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkChanges, deliveryTitle, deliveryWord, picturesOf, reviewStateOf, summaryLines, timelineOf } from '../src/shared/timeline'
import type { Capture } from '../src/shared/studio'
import type { Delivery } from '../src/shared/types'

const now = new Date(2026, 10, 6, 15).getTime()
const DAY = 86_400_000
const d = (n: number, over: Partial<Delivery> = {}): Delivery => ({ id: `d${n}`, projectId: 'p', parentId: null, number: n, kind: 'revision', request: `Change ${n}`, status: 'accepted', baseSha: null, headSha: null, summary: null, strategy: null, limitations: [], verification: null, screenshot: null, createdAt: now - DAY * 40, completedAt: now - 1000, decidedAt: null, decisionNote: null, ...over })
const shot = (over: Partial<Capture>): Capture => ({ path: 'p', at: 1, source: 'check', width: 1280, height: 800, page: null, deliveryId: null, deliveryNumber: null, taskId: null, ...over })

describe('saying what a delivery is', () => {
  it('uses your words, not the wrapper', () => {
    expect(deliveryTitle({ request: 'Visual feedback from the running app. Change what was asked.\n\nMake the Buy button larger\nPointed at: x' })).toBe('Make the Buy button larger')
    expect(deliveryTitle({ request: 'Make the Buy button larger\n\nVisual feedback from the running app.' })).toBe('Make the Buy button larger')
    expect(deliveryTitle({ request: '' })).toBe('A request')
    expect(deliveryTitle({ request: 'x'.repeat(300) }).length).toBeLessThanOrEqual(110)
  })
  it('names the sort of thing from what was asked', () => {
    expect(deliveryWord({ kind: 'brief', number: 1, request: 'a shop' })).toBe('First build')
    expect(deliveryWord({ kind: 'brief', number: 3, request: 'a shop' })).toBe('New work')
    expect(deliveryWord({ kind: 'revision', number: 2, request: 'Fix the crash' })).toBe('Fix')
    expect(deliveryWord({ kind: 'revision', number: 2, request: 'Make it bigger' })).toBe('Change')
  })
  it('review state is yours, separate from whether work ran', () => {
    expect(reviewStateOf({ status: 'validating' })).toBe('working')
    expect(reviewStateOf({ status: 'review' })).toBe('awaiting')
    expect(reviewStateOf({ status: 'accepted' })).toBe('reviewed')
    expect(reviewStateOf({ status: 'revising' })).toBe('changes')
    expect(reviewStateOf({ status: 'rejected' })).toBe('discarded')
  })
  it('summary keeps the sentence and loses internal labels', () => {
    expect(summaryLines('T1 Add footer: Added a footer\n\nT2.1 Fix: Fixed it')).toEqual(['Added a footer', 'Fixed it'])
    expect(summaryLines(null)).toEqual([])
  })
})

describe('the timeline', () => {
  const groups = (list: Delivery[], x = {}) => timelineOf({ deliveries: list, now, ...x })
  it('work under way first, then newest first, by period', () => {
    const g = groups([d(1, { completedAt: now - 60 * DAY }), d(2, { completedAt: now - DAY }), d(3, { completedAt: now - 3600_000 }), d(4, { status: 'implementing', completedAt: null })])
    expect(g.map((x) => x.label)[0]).toBe('In progress')
    expect(g.map((x) => x.label).slice(1, 3)).toEqual(['Today', 'Yesterday'])
    expect(g[g.length - 1].label).toMatch(/2026/)
  })
  it('links a change to what it revises, both ways', () => {
    const [g] = groups([d(1, { completedAt: now - 2000 }), d(2, { parentId: 'd1' })])
    const by = (id: string) => g.entries.find((e) => e.id === id) as Extract<(typeof g.entries)[number], { type: 'delivery' }>
    expect(by('d2').revises).toBe(1)
    expect(by('d1').followUps).toEqual([2])
    expect(by('d1').revises).toBeNull()
  })
  it('only a verified milestone is an event', () => {
    const m = [{ n: 1, title: 'Basics', status: 'done', gate: { at: now - 500 } }, { n: 2, title: 'Next', status: 'active', gate: null }] as never
    const entries = groups([d(1)], { milestones: m }).flatMap((g) => g.entries)
    expect(entries.filter((e) => e.type === 'milestone').map((e) => e.id)).toEqual(['m1'])
  })
  it('your marks show, and an old product with none still works', () => {
    expect(groups([d(1)], { marks: ['d1'] })[0].entries[0]).toMatchObject({ marked: true })
    expect(groups([])).toEqual([])
  })
  it('one request is one entry, however many steps it took', () => {
    expect(groups([d(1)]).flatMap((g) => g.entries).length).toBe(1)
  })
})

describe('real pictures only', () => {
  const list = [{ id: 'd1', number: 1 }, { id: 'd2', number: 2 }]
  it('no picture means none, never a stand-in', () => {
    expect(picturesOf(d(2), [], list)).toEqual({ own: null, pair: null, source: null })
    expect(picturesOf(d(2), [shot({ deliveryId: 'd1' })], list).own).toBeNull()
  })
  it('around a change comes first', () => {
    const before = shot({ path: 'b', deliveryId: 'd2', source: 'before', taskId: 't' })
    const after = shot({ path: 'a', deliveryId: 'd2', source: 'after', taskId: 't' })
    const p = picturesOf(d(2), [after, before], list)
    expect(p.pair).toEqual([before, after])
    expect(p.own).toEqual(after)
    expect(p.source).toMatch(/Before and after/)
  })
  it('otherwise this result and an earlier one at the same width, earlier first', () => {
    const mine = shot({ path: 'm', deliveryId: 'd2' })
    const old = shot({ path: 'o', deliveryId: 'd1' })
    expect(picturesOf(d(2), [mine, old], list)).toMatchObject({ pair: [old, mine], source: 'Result #1 and this one' })
    expect(picturesOf(d(2), [mine, shot({ deliveryId: 'd1', width: 375 })], list).pair).toBeNull()
  })
  it('nothing claims improvement', () => {
    const mine = shot({ path: 'm', deliveryId: 'd2' })
    const { source } = picturesOf(d(2), [mine, shot({ path: 'o', deliveryId: 'd1' })], list)
    expect(source).not.toMatch(/better|improved|fixed/i)
  })
})

describe('checks between results', () => {
  it('reports only what really differs', () => {
    expect(checkChanges([{ command: 'a', status: 'failed' }, { command: 'b', status: 'passed' }], [{ command: 'a', status: 'passed' }, { command: 'b', status: 'passed' }, { command: 'c', status: 'failed' }])).toEqual([
      { command: 'a', was: 'failed', now: 'passed' },
      { command: 'c', was: null, now: 'failed' }
    ])
  })
})

describe('one place for results', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../src', p), 'utf8')
  it('the old review page is gone', () => {
    const review = src('renderer/src/components/workspace/Review.tsx')
    expect(review).not.toContain('function DeliveryDetail')
    expect(review).not.toContain('export function Review(')
    expect(src('renderer/src/components/workspace/Workspace.tsx')).not.toContain('DeliveryStepper')
  })
  it('a change request carries the delivery it is about', () => {
    expect(src('renderer/src/components/deliveries/Deliveries.tsx')).toContain('actions.compose({ deliveryId: d.id })')
  })
})
