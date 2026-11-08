// Pixel-exact camera rules. On a high-density display the office renders at the device resolution, and
// the camera zoom (canvas pixels per art pixel) rests on whole numbers, so every art pixel is the same
// number of screen pixels: no 1-px/2-px stripes in plank seams, letters or outlines. Pure; unit-tested.

/** Canvas pixels per CSS pixel: 2 on high-density displays (capped for fill rate), else 1. */
export function deviceScale(dpr: number): number {
  return dpr >= 1.5 ? 2 : 1
}

const pixelExact = (scale: number) => scale >= 2

/** A resting zoom: whole canvas pixels per art pixel on high-density displays; unchanged otherwise. */
export function snapZoom(z: number, scale: number, mode: 'nearest' | 'down' = 'nearest'): number {
  if (!pixelExact(scale)) return z
  return Math.max(1, mode === 'down' ? Math.floor(z + 1e-6) : Math.round(z))
}

/**
 * The "whole office" zoom. The old fit (with a small margin) is kept on standard displays; on
 * high-density ones the larger whole zoom is used when the office still fits edge to edge, else the
 * smaller one, so the office is never cropped.
 */
export function fitZoom(viewW: number, viewH: number, worldW: number, worldH: number, scale: number, margin = 24): number {
  const exact = Math.min(viewW / (worldW + margin), viewH / (worldH + margin))
  if (!pixelExact(scale)) return exact
  const tight = Math.min(viewW / worldW, viewH / worldH)
  const up = Math.ceil(exact - 1e-6)
  return up <= tight ? up : Math.max(1, Math.floor(exact))
}

/** One zoom step in or out (wheel, buttons), always landing on a resting zoom. */
export function stepZoom(current: number, dir: 1 | -1, scale: number, min: number, max: number): number {
  const next = pixelExact(scale) ? Math.round(current) + dir : current * (dir > 0 ? 1.1 : 0.9)
  return Math.min(max, Math.max(min, next))
}

// ── input ──────────────────────────────────────────────────────

/** How far (CSS px) the pointer may wander during a press and still count as a click, not a drag. */
export const DRAG_SLOP_CSS = 5

/** Trackpad pinch distance (CSS px of wheel delta) per zoom step. */
export const PINCH_STEP = 24

export type WheelIntent = 'pinch' | 'pan' | 'notch'

interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  /** Chromium's legacy wheel delta: ±120 per notch for a mouse wheel, −3 × deltaY for a trackpad. */
  wheelDeltaY?: number
}

/**
 * What a wheel event means: a trackpad pinch (zoom, sent as ctrl+wheel), a two-finger trackpad
 * scroll (pan), or a mouse-wheel notch (one zoom step).
 */
export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return 'pinch'
  if (e.deltaMode !== 0) return 'notch' // line/page units only come from wheels
  if (e.deltaX !== 0) return 'pan'
  const legacy = e.wheelDeltaY
  if (legacy !== undefined && legacy !== 0) {
    if (legacy % 120 === 0) return 'notch'
    if (Math.abs(legacy) === Math.abs(e.deltaY * 3)) return 'pan'
  }
  // no legacy delta: big round deltas are wheel notches, small ones are trackpad motion
  return Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY) ? 'notch' : 'pan'
}

// ── view math (centre + zoom; zoom = canvas pixels per art pixel) ──

export interface View {
  cx: number
  cy: number
  zoom: number
}

/**
 * The centre that keeps a world point under the same screen position at a new zoom.
 * `offX`/`offY` is the screen position relative to the viewport centre, in canvas pixels.
 */
export function anchoredCenter(wx: number, wy: number, offX: number, offY: number, zoom: number): { cx: number; cy: number } {
  return { cx: wx - offX / zoom, cy: wy - offY / zoom }
}

/**
 * Keep the office on screen: the centre may move until a quarter of the viewport shows beyond the
 * office edge. Once the office is much smaller than the viewport it stays centred.
 */
export function clampCenter(cx: number, cy: number, viewW: number, viewH: number, zoom: number, worldW: number, worldH: number): { cx: number; cy: number } {
  const axis = (c: number, view: number, world: number) => {
    const half = view / zoom / 2
    const slack = half / 2
    const lo = Math.min(half - slack, world / 2)
    const hi = Math.max(world - half + slack, world / 2)
    return Math.min(hi, Math.max(lo, c))
  }
  return { cx: axis(cx, viewW, worldW), cy: axis(cy, viewH, worldH) }
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2

/** Frame-rate independent smoothing factor for following a moving target. */
export function followFactor(deltaMs: number, halfLifeMs = 90): number {
  return 1 - Math.pow(0.5, Math.min(deltaMs, 100) / halfLifeMs)
}

// ── overlay cards ─────────────────────────────────────────────

/**
 * Where an object's card goes (CSS px in the office stage): above the object if there's room, else
 * below it, and always fully inside the stage. The arrow keeps pointing at the object; when the object
 * itself is off screen the card stays at the edge without an arrow.
 */
export function placeCard(
  x: number,
  objTop: number,
  objBottom: number,
  w: number,
  h: number,
  stageW: number,
  stageH: number,
  gap = 10,
  margin = 8
): { left: number; top: number; arrowX: number; below: boolean; detached: boolean } {
  const fitsAbove = objTop - gap - h >= margin
  const fitsBelow = objBottom + gap + h <= stageH - margin
  const below = !fitsAbove && fitsBelow
  const rawTop = below ? objBottom + gap : objTop - gap - h
  const top = Math.min(Math.max(margin, rawTop), Math.max(margin, stageH - margin - h))
  const left = Math.min(Math.max(margin, x - w / 2), Math.max(margin, stageW - margin - w))
  const arrowX = Math.min(Math.max(14, x - left), w - 14)
  const detached = x < 0 || x > stageW || objBottom < 0 || objTop > stageH || top !== rawTop
  return { left: Math.round(left), top: Math.round(top), arrowX: Math.round(arrowX), below, detached }
}
