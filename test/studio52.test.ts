import { describe, expect, it } from 'vitest'
import { feedbackRequest, type Picked } from '../src/shared/inspect'
import { comparePair, cropOf, diagnosticsOf, fixRequest, isCapturePath, readStudioPrefs, relRect, surfaceOf, type Capture } from '../src/shared/studio'

const shot = (over: Partial<Capture>): Capture => ({ path: '.autopia/screenshots/a.png', at: 1, source: 'you', width: 1280, height: 800, page: '/', deliveryId: null, deliveryNumber: null, taskId: null, ...over })

describe('what kind of thing a product is', () => {
  const web = { kind: 'script' as const, framework: 'vite', launch: [] }
  const none = { kind: 'none' as const, framework: null, launch: [] }
  const open = [{ id: 'xcode', label: 'Open in Xcode', path: 'a.xcodeproj', note: '' }]
  it('a page that runs is shown running', () => {
    expect(surfaceOf(web, 'saas')).toBe('web')
    expect(surfaceOf(web, 'game')).toBe('webGame')
    expect(surfaceOf({ ...web, framework: 'express' }, 'other')).toBe('service')
  })
  it('what runs elsewhere says so, and nothing gets an empty browser', () => {
    expect(surfaceOf({ ...none, launch: [{ id: 'engine:godot', label: '', path: '', note: '' }] }, 'other')).toBe('game')
    expect(surfaceOf({ ...none, launch: open }, 'other')).toBe('native')
    expect(surfaceOf(none, 'ai')).toBe('results')
  })
})

describe('what the logs say', () => {
  it('folds repeats, puts errors first, and keeps server output apart from the page', () => {
    const d = diagnosticsOf(['[page warning] slow', '[page error] boom', '[page error] boom', 'VITE ready', 'Error: no db', '[page] failed to load /x'])
    expect(d.problems[0]).toEqual({ level: 'error', text: 'boom', count: 2 })
    expect(d.errors).toBe(3)
    expect(d.warnings).toBe(1)
    expect(d.output).toEqual(['VITE ready', 'Error: no db'])
  })
  it('quiet logs report nothing rather than saying all is well', () => {
    expect(diagnosticsOf(['ready']).problems).toEqual([])
  })
  it('a fix request carries the real words', () => {
    expect(fixRequest('boom', '/cart')).toContain('boom')
    expect(fixRequest('boom', '/cart')).toContain('/cart')
  })
})

describe('marks on a picture', () => {
  const box = { width: 200, height: 100 }
  it('a click is a spot and a drag is an area, in fractions', () => {
    expect(relRect({ x: 100, y: 50 }, { x: 102, y: 51 }, box)).toEqual({ x: 0.5, y: 0.5, width: 0, height: 0 })
    const area = relRect({ x: 150, y: 80 }, { x: 50, y: 20 }, box)!
    expect([area.x, area.y, area.width]).toEqual([0.25, 0.2, 0.5])
    expect(area.height).toBeCloseTo(0.6)
  })
  it('can’t leave the picture', () => {
    expect(relRect({ x: -50, y: -50 }, { x: 900, y: 900 }, box)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(relRect({ x: 0, y: 0 }, { x: 9, y: 9 }, { width: 0, height: 0 })).toBeNull()
  })
  it('the same mark lands in the same place at any pixel density', () => {
    const mark = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }
    expect(cropOf(mark, { width: 1000, height: 800 })).toEqual({ x: 250, y: 400, width: 500, height: 200 })
    expect(cropOf(mark, { width: 2000, height: 1600 })).toEqual({ x: 500, y: 800, width: 1000, height: 400 })
  })
  it('a spot keeps its neighbourhood and stays inside', () => {
    const c = cropOf({ x: 0.98, y: 0.02, width: 0, height: 0 }, { width: 1000, height: 1000 })
    expect(c.x + c.width).toBeLessThanOrEqual(1000)
    expect(c.y).toBe(0)
    expect(c.width).toBeGreaterThan(1)
  })
})

describe('what reaches the teammate', () => {
  const region: Picked = { kind: 'region', rect: { x: 10, y: 20, width: 100, height: 50 }, page: '/shop' }
  it('a mark names its picture and never claims a place in the code', () => {
    const text = feedbackRequest([{ note: 'Make this bigger', pick: region, sources: [], shot: '.autopia/screenshots/mark-1.png', capture: { path: '.autopia/screenshots/whole.png', at: 1 }, mark: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }])
    expect(text).toContain('Make this bigger')
    expect(text).toContain('.autopia/screenshots/mark-1.png')
    expect(text).toContain('.autopia/screenshots/whole.png')
    expect(text).toContain('not a place in the code')
    expect(text).toContain('/shop')
    expect(text).toMatch(/could not place this in the source/)
  })
  it('a spot says spot', () => {
    expect(feedbackRequest([{ note: 'x', pick: { ...region, rect: { x: 1, y: 1, width: 0, height: 0 } }, sources: [], shot: null, mark: { x: 0.5, y: 0.5, width: 0, height: 0 } }])).toContain('the spot 50% across')
  })
  it('only pictures Autopia wrote can be named', () => {
    expect(isCapturePath('.autopia/screenshots/a-1.png')).toBe(true)
    expect(isCapturePath('.autopia/quality/a.png')).toBe(true)
    for (const bad of ['../secret.png', '/etc/passwd', '.autopia/screenshots/../../x.png', '.autopia/screenshots/a.txt', null]) expect(isCapturePath(bad)).toBe(false)
  })
})

describe('comparing', () => {
  it('needs two real captures', () => {
    expect(comparePair([])).toBeNull()
    expect(comparePair([shot({})])).toBeNull()
  })
  it('prefers the two sides of a change', () => {
    const before = shot({ path: 'b', at: 2, source: 'before', taskId: 't' })
    const after = shot({ path: 'a', at: 3, source: 'after', taskId: 't' })
    expect(comparePair([shot({ path: 'n', at: 9 }), after, before])).toEqual([before, after])
    expect(comparePair([shot({ path: 'n', at: 9 }), after, before], 't')).toEqual([before, after])
  })
  it('otherwise the newest two at the same width, earlier first', () => {
    const a = shot({ path: 'a', at: 1 })
    const b = shot({ path: 'b', at: 2, width: 390 })
    const c = shot({ path: 'c', at: 3 })
    expect(comparePair([c, b, a])).toEqual([a, c])
  })
})

describe('coming back', () => {
  it('restores what you left and survives anything unreadable', () => {
    expect(readStudioPrefs('{"viewport":"mobile","drawer":true}')).toEqual({ viewport: 'mobile', drawer: true })
    expect(readStudioPrefs('{"viewport":"toaster"}').viewport).toBe('desktop')
    expect(readStudioPrefs('nonsense')).toEqual({ viewport: 'desktop', drawer: false })
    expect(readStudioPrefs(null).drawer).toBe(false)
  })
})

describe('pointing with a real mouse', () => {
  it('never cancels a pointer event, or the browser drops the mouse events that pick', async () => {
    const { pickScript } = await import('../src/main/inspector')
    expect(pickScript).toContain("e.type.indexOf('pointer')!==0)e.preventDefault()")
  })
})
