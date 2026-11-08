import { describe, expect, it } from 'vitest'
import { deviceScale, fitZoom, snapZoom, stepZoom } from '../src/renderer/src/office/camera'

const WORLD_W = 56 * 16
const WORLD_H = 36 * 16

describe('pixel-exact office camera', () => {
  it('renders at the display density on high-density screens only', () => {
    expect(deviceScale(2)).toBe(2)
    expect(deviceScale(3)).toBe(2) // capped for fill rate
    expect(deviceScale(1)).toBe(1)
  })

  it('fits the whole office at a whole number of device pixels per art pixel, never cropping', () => {
    // the real window measured in this session: 1480×876 CSS px at 2× density
    const z = fitZoom(2960, 1752, WORLD_W, WORLD_H, 2)
    expect(z).toBe(3)
    expect(WORLD_W * z).toBeLessThanOrEqual(2960)
    expect(WORLD_H * z).toBeLessThanOrEqual(1752)
    // a window where the next whole zoom would crop falls back to the smaller one
    const tight = fitZoom(2600, 1600, WORLD_W, WORLD_H, 2)
    expect(Number.isInteger(tight)).toBe(true)
    expect(WORLD_W * tight).toBeLessThanOrEqual(2600)
    expect(WORLD_H * tight).toBeLessThanOrEqual(1600)
  })

  it('keeps the previous smooth fit on standard-density screens', () => {
    expect(fitZoom(1480, 876, WORLD_W, WORLD_H, 1)).toBeCloseTo(Math.min(1480 / (WORLD_W + 24), 876 / (WORLD_H + 24)))
  })

  it('every resting zoom is whole on high-density screens; steps move one device pixel per art pixel', () => {
    expect(snapZoom(5.2, 2)).toBe(5)
    expect(snapZoom(5.9, 2, 'down')).toBe(5)
    expect(snapZoom(1.46, 1)).toBe(1.46)
    expect(stepZoom(3, 1, 2, 2, 12)).toBe(4)
    expect(stepZoom(3.4, -1, 2, 2, 12)).toBe(2)
    expect(stepZoom(12, 1, 2, 2, 12)).toBe(12)
    expect(stepZoom(2, -1, 2, 2, 12)).toBe(2)
    expect(stepZoom(1.5, 1, 1, 1, 6)).toBeCloseTo(1.65)
  })
})
