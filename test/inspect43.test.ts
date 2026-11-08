import { describe, expect, it } from 'vitest'
import { compareSnapshots, feedbackKind, feedbackRequest, feedbackStatus, groupFeedback, type Picked } from '../src/shared/inspect'

const snap = (text = 'Save', color = 'red') => ({ text, width: 80, height: 30, styles: { color } })
const el: Picked = { kind: 'element', rect: { x: 1, y: 2, width: 3, height: 4 }, element: { tag: 'button', selector: '#save', id: 'save', classes: [], attrs: {}, components: ['SaveButton', 'Form'], reported: [], near: 'form', page: '/', snapshot: snap(), opaque: false } }
const src = (file: string) => ({ file, line: 3, confidence: 'exact' as const, why: 'React reported it' })
const item = (id: string, files: string[]) => ({ id, sources: files.map(src) })

describe('grouping', () => {
  it('same file together, independent apart, unknown together', () => {
    const g = groupFeedback([item('a', ['x.tsx']), item('b', ['y.tsx']), item('c', ['x.tsx']), item('d', []), item('e', [])])
    expect(g.map((x) => x.map((i) => i.id))).toEqual([['a', 'c'], ['b'], ['d', 'e']])
  })
  it('an item that bridges two groups merges them', () => {
    const g = groupFeedback([item('a', ['x']), item('b', ['y']), item('c', ['x', 'y'])])
    expect(g).toHaveLength(1)
    expect(g[0].map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('the request', () => {
  it('carries your words, what you pointed at, and how sure the source is', () => {
    const r = feedbackRequest([{ note: 'Make this blue', pick: el, sources: [{ file: 'src/Save.tsx', line: 3, confidence: 'likely', why: 'defines SaveButton' }], shot: null }])
    expect(r).toContain('Make this blue')
    expect(r).toContain('Selector: #save')
    expect(r).toContain('SaveButton < Form')
    expect(r).toContain('src/Save.tsx:3 (defines SaveButton)')
    expect(r).toMatch(/confirm in the source/)
  })
  it('admits when it does not know where something lives', () => {
    expect(feedbackRequest([{ note: 'x', pick: el, sources: [], shot: null }])).toMatch(/could not place this in the source/)
  })
  it('looks vs behaviour', () => {
    expect(feedbackKind('make it bigger and blue')).toBe('design')
    expect(feedbackKind('this button does not save')).toBe('code')
  })
})

describe('what is claimed afterwards', () => {
  it('compares what can be measured', () => {
    expect(compareSnapshots(snap(), snap('Save', 'blue'))).toEqual({ state: 'changed', what: ['color'] })
    expect(compareSnapshots(snap(), snap('Send'))).toEqual({ state: 'changed', what: ['text'] })
    expect(compareSnapshots(snap(), snap())).toEqual({ state: 'same' })
    expect(compareSnapshots(snap(), null)).toEqual({ state: 'gone' })
  })
  it('never reads as done before it is, and never as verified without a measurement', () => {
    expect(feedbackStatus({ taskId: null, check: null }, null).label).toBe('Not sent')
    expect(feedbackStatus({ taskId: 't', check: null }, 'running').label).toBe('Being changed')
    expect(feedbackStatus({ taskId: 't', check: null }, 'failed').tone).toBe('danger')
    expect(feedbackStatus({ taskId: 't', check: null }, 'done').tone).toBe('warn')
    expect(feedbackStatus({ taskId: 't', check: { state: 'same' } }, 'done').tone).toBe('warn')
    expect(feedbackStatus({ taskId: 't', check: { state: 'changed', what: ['color'] } }, 'done').tone).toBe('ok')
  })
})

describe('what decides grouping', () => {
  it('a shared parent does not tie independent changes together', () => {
    const s = (file: string, confidence: 'exact' | 'likely') => ({ file, line: 1, confidence, why: '' })
    const g = groupFeedback([{ id: 'a', sources: [s('Save.jsx', 'exact'), s('App.jsx', 'likely')] }, { id: 'b', sources: [s('Banner.jsx', 'exact'), s('App.jsx', 'likely')] }])
    expect(g).toHaveLength(2)
  })
})
