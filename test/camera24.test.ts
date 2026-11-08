import { describe, expect, it } from 'vitest'
import { anchoredCenter, clampCenter, followFactor, wheelIntent } from '../src/renderer/src/office/camera'

const W = 56 * 16
const H = 36 * 16

describe('wheel input', () => {
  const ev = (o: Partial<Parameters<typeof wheelIntent>[0]>) => wheelIntent({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o })
  it('a trackpad pinch zooms', () => {
    expect(ev({ ctrlKey: true, deltaY: -3.2 })).toBe('pinch')
  })
  it('a two-finger trackpad scroll pans, in any direction', () => {
    expect(ev({ deltaY: 6, wheelDeltaY: -18 })).toBe('pan')
    expect(ev({ deltaX: 4, deltaY: 1, wheelDeltaY: -3 })).toBe('pan')
    expect(ev({ deltaY: 2.5 })).toBe('pan')
  })
  it('a mouse-wheel notch zooms one step', () => {
    expect(ev({ deltaY: 100, wheelDeltaY: -120 })).toBe('notch')
    expect(ev({ deltaY: -4, wheelDeltaY: 120 })).toBe('notch') // macOS accelerated wheel
    expect(ev({ deltaY: 3, deltaMode: 1 })).toBe('notch')
    expect(ev({ deltaY: 100 })).toBe('notch')
  })
})

describe('view math', () => {
  it('zooming about a point keeps that point under the cursor', () => {
    // cursor 300 px right of centre, over world x = 500 at zoom 3
    const c = anchoredCenter(500, 200, 300, -60, 4)
    expect(c.cx + 300 / 4).toBeCloseTo(500)
    expect(c.cy - 60 / 4).toBeCloseTo(200)
  })

  it('the office never leaves the screen: at most a quarter of the view shows beyond an edge', () => {
    const zoom = 6
    const viewW = 1600
    const c = clampCenter(-1000, 99999, viewW, 1000, zoom, W, H)
    const half = viewW / zoom / 2
    expect(c.cx - half).toBeCloseTo(-half / 2) // left edge at most a quarter-view past the office
    expect(c.cy).toBeLessThanOrEqual(H)
    // a centre inside the office is left alone
    expect(clampCenter(400, 300, viewW, 1000, zoom, W, H)).toEqual({ cx: 400, cy: 300 })
  })

  it('when the whole office is small on screen it stays centred', () => {
    expect(clampCenter(0, 0, 4000, 3000, 1, W, H)).toEqual({ cx: W / 2, cy: H / 2 })
  })

  it('following is frame-rate independent and caps long frames', () => {
    const at60 = 1 - (1 - followFactor(100 / 6)) ** 6
    const at10 = followFactor(100)
    expect(at60).toBeCloseTo(at10, 5)
    expect(followFactor(5000)).toBe(followFactor(100)) // returning from the background doesn't snap
  })
})

describe('cards and tooltips stay on screen', () => {
  it('an object card opens above, flips below near the top, and slides in from the sides', async () => {
    const { placeCard } = await import('../src/renderer/src/office/camera')
    const mid = placeCard(500, 400, 430, 250, 120, 1000, 800)
    expect(mid).toMatchObject({ top: 400 - 10 - 120, below: false, detached: false })
    const top = placeCard(500, 40, 70, 250, 120, 1000, 800)
    expect(top).toMatchObject({ top: 80, below: true })
    const right = placeCard(990, 400, 430, 250, 120, 1000, 800)
    expect(right.left + 250).toBeLessThanOrEqual(992)
    expect(right.arrowX).toBe(250 - 14) // still points at the object, as far right as the card allows
    const off = placeCard(-200, 400, 430, 250, 120, 1000, 800)
    expect(off).toMatchObject({ left: 8, detached: true })
  })

  it('a tooltip flips to the side with room and never leaves the window', async () => {
    const { placeTip } = await import('../src/renderer/src/components/Tooltip')
    const a = (x: number, y: number) => ({ left: x - 15, right: x + 15, top: y - 15, bottom: y + 15, width: 30 })
    // bottom-right HUD button: prefers above, pushed left to fit
    const br = placeTip(a(1460, 890), 180, 24, 1480, 920, 'above')
    expect(br.top).toBe(890 - 15 - 8 - 24)
    expect(br.left + 180).toBeLessThanOrEqual(1480 - 8)
    // top-left clock: prefers above, no room, opens below and starts at the margin
    const tl = placeTip(a(30, 20), 230, 24, 1480, 920, 'above')
    expect(tl).toEqual({ left: 8, top: 20 + 15 + 8 })
  })
})
