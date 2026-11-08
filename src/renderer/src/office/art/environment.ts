// Floors, walls and architectural sprites (glass, partitions, the reception feature wall).

import { COLS, ENTRANCE, FEATURE_WALL, PLACEMENTS, ROWS, TILE, WALL_DECOR, WALLS, WORLD_H, WORLD_W, ZONES, type PosterKind, type Rect } from '../layout'
import { M, PAL, type Ramp } from './palette'
import { drawText, makeCanvas, mix, rng, shade, textWidth, type Px } from './px'

export const CAP_TOP = 10
export const FACE_TOP = 16
export const FACE_BOTTOM = 4 * TILE

export const px0 = (r: Rect) => ({ x0: r.x * TILE, y0: r.y * TILE, x1: (r.x + r.w) * TILE, y1: (r.y + r.h) * TILE })

export function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >> 13), 1274126177)
  return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

// ── floors ───────────────────────────────────────────────────────

export function oakPlanks(px: Px, r: Rect, ramp: Ramp = M.oakFloor, seed = 1): void {
  const { x0, y0, x1, y1 } = px0(r)
  const H = 5
  for (let y = y0; y < y1; y += H) {
    const row = Math.floor(y / H)
    const offset = Math.floor(hash(row, seed) * 40)
    let x = x0 - offset
    while (x < x1) {
      const len = 34 + Math.floor(hash(row * 31 + x, seed) * 30)
      const t = hash(x, row + seed * 7)
      const tone = t < 0.33 ? shade(ramp.base, 0.035) : t < 0.66 ? ramp.base : shade(ramp.base, -0.035)
      const a = Math.max(x, x0)
      const b = Math.min(x + len, x1)
      const h = Math.min(H, y1 - y)
      px.r(a, y, b - a, h, tone)
      px.h(a, y + h - 1, b - a, shade(tone, -0.07)) // soft seam
      if (x >= x0) px.v(x, y, h, shade(tone, -0.1))
      for (let k = 0; k < 2; k++) {
        const gx = a + Math.floor(hash(x + k, row) * Math.max(1, b - a - 10))
        const gl = 4 + Math.floor(hash(k, x + row) * 10)
        px.h(gx, y + 1 + k * 2, Math.max(0, Math.min(gl, b - gx)), shade(tone, -0.035))
      }
      if (hash(x * 3, row) < 0.04) px.p(a + 6, y + 2, shade(tone, -0.18))
      x += len
    }
  }
}

/** Chevron oak for the lounge: planks slope alternately in 8 px columns. */
export function chevron(px: Px, r: Rect, ramp: Ramp = M.walnut): void {
  const { x0, y0, x1, y1 } = px0(r)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const col = Math.floor(x / 8)
      const lx = x % 8
      const yy = y + (col % 2 === 0 ? lx : 7 - lx)
      const plank = Math.floor(yy / 4)
      const seam = yy % 4 === 0
      const t = hash(col, plank)
      const base = t < 0.33 ? shade(ramp.hi, 0.04) : t < 0.66 ? ramp.hi : shade(ramp.hi, -0.05)
      px.p(x, y, seam ? shade(base, -0.14) : lx === 0 ? shade(base, -0.06) : base)
    }
  }
}

export function carpetTiles(px: Px, r: Rect, ramp: Ramp = M.carpet): void {
  const { x0, y0, x1, y1 } = px0(r)
  const R = rng(5)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const vertical = ((Math.floor(x / 16) + Math.floor(y / 16)) & 1) === 0
      const stripe = vertical ? x % 3 === 0 : y % 3 === 0
      const n = R()
      let c: string = stripe ? ramp.mid : ramp.base
      if (n < 0.05) c = ramp.hi
      else if (n > 0.97) c = ramp.lo
      px.p(x, y, c)
    }
  }
}

export function stoneTiles(px: Px, r: Rect, ramp: Ramp = M.stone, size = 16): void {
  const { x0, y0, x1, y1 } = px0(r)
  const R = rng(8)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lx = x % size
      const ly = y % size
      const tone = hash(Math.floor(x / size), Math.floor(y / size)) < 0.5 ? ramp.base : shade(ramp.base, -0.025)
      let c: string = lx === 0 || ly === 0 ? ramp.mid : lx === 1 || ly === 1 ? ramp.hi : tone
      if (c === tone && R() < 0.035) c = R() < 0.5 ? ramp.mid : ramp.hi
      px.p(x, y, c)
    }
  }
}

export function polishedConcrete(px: Px, r: Rect, ramp: Ramp = M.concrete): void {
  const { x0, y0, x1, y1 } = px0(r)
  const R = rng(9)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cloud = (Math.sin(x * 0.09 + Math.sin(y * 0.05) * 2) + Math.sin(y * 0.07 + x * 0.02)) * 0.25
      let c = mix(ramp.base, ramp.hi, Math.max(0, Math.min(1, 0.5 + cloud)))
      const n = R()
      if (n < 0.02) c = ramp.mid
      else if (n > 0.985) c = ramp.hi
      px.p(x, y, c)
    }
  }
}

export function contactShadow(px: Px, x: number, y: number, w: number): void {
  px.alpha(0.22, () => px.r(x + 1, y - 2, w, 3, '#000'))
  px.alpha(0.1, () => px.r(x + 2, y + 1, w, 2, '#000'))
}

// ── main background ──────────────────────────────────────────────

export function rug(px: Px, x: number, y: number, w: number, h: number, field: string, border: string, accent: string): void {
  px.r(x, y, w, h, field)
  for (let yy = y; yy < y + h; yy += 2) px.h(x, yy, w, shade(field, -0.03))
  px.outlineRect(x + 3, y + 3, w - 6, h - 6, border)
  px.outlineRect(x + 5, y + 5, w - 10, h - 10, accent)
  for (let xx = x; xx < x + w; xx += 2) px.p(xx, y - 1, shade(field, -0.08)).p(xx + 1, y + h, shade(field, -0.08))
}

/**
 * An interior wall stands in the middle of its tile column, but room floors start at the next tile, so a
 * strip of corridor oak showed on both sides of every vertical wall, inside the rooms. Each half of the
 * wall's column now gets the floor of the room on that side (patterns are in world coordinates, so they
 * continue without a seam). Columns next to open corridor keep the oak.
 */
export function wallColumnFloors(px: Px, floors?: Partial<Record<keyof typeof ZONES, (r: Rect) => void>>): void {
  const FLOOR: Partial<Record<keyof typeof ZONES, (r: Rect) => void>> = floors ?? {
    meeting: (r) => carpetTiles(px, r),
    focus: (r) => carpetTiles(px, r),
    booths: (r) => carpetTiles(px, r),
    kitchen: (r) => stoneTiles(px, r),
    reception: (r) => polishedConcrete(px, r),
    supply: (r) => polishedConcrete(px, r),
    studio: (r) => oakPlanks(px, r, M.birch, 4),
    lounge: (r) => chevron(px, r)
  }
  for (const w of WALLS.filter((x) => x.axis === 'v')) {
    for (const [half, col] of [[0, w.x - 1], [0.5, w.x + 1]] as const) {
      for (const [name, z] of Object.entries(ZONES) as [keyof typeof ZONES, Rect][]) {
        const paint = FLOOR[name]
        if (!paint || col < z.x || col >= z.x + z.w) continue
        const y0 = Math.max(w.y, z.y)
        const y1 = Math.min(w.y + w.len, z.y + z.h)
        if (y1 > y0) paint({ x: w.x + half, y: y0, w: 0.5, h: y1 - y0 })
      }
    }
  }
}

export function doorMat(px: Px, x: number, y: number, w: number, h: number): void {
  px.r(x, y, w, h, '#33303a')
  for (let xx = x + 2; xx < x + w - 2; xx += 2) px.v(xx, y + 2, h - 4, '#3e3a46')
  px.outlineRect(x, y, w, h, '#24212a')
}

export function paintBackground(accent: Ramp = M.terracotta): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(WORLD_W, WORLD_H)
  px.r(0, 0, WORLD_W, WORLD_H, PAL.void)

  oakPlanks(px, { x: 1, y: 4, w: COLS - 2, h: ROWS - 5 })
  carpetTiles(px, ZONES.meeting)
  carpetTiles(px, ZONES.focus)
  stoneTiles(px, ZONES.kitchen)
  oakPlanks(px, ZONES.studio, M.birch, 4)
  chevron(px, ZONES.lounge)
  polishedConcrete(px, ZONES.reception)
  polishedConcrete(px, ZONES.supply)
  carpetTiles(px, ZONES.booths)
  wallColumnFloors(px)

  // reception: the entrance mat
  const e = ENTRANCE
  doorMat(px, e.x * TILE + 2, 33 * TILE + 4, e.w * TILE - 4, 26)

  // lounge rug (accent colour is customizable)
  rug(px, 1 * TILE + 8, 29 * TILE + 4, 7 * TILE, 5 * TILE + 8, '#eadfc8', accent.base, M.sage.mid)
  for (let x = 1 * TILE + 17; x < 8 * TILE; x += 8) {
    for (let k = 0; k < 3; k++) px.p(x + k, 29 * TILE + 13 - k, accent.mid).p(x + 6 - k, 29 * TILE + 13 - k, accent.mid)
  }
  // studio rug under the work area, boardroom rug, focus-room rug
  rug(px, 1 * TILE + 8, 22 * TILE + 8, 7 * TILE, 3 * TILE, '#dfe3e4', M.slate.hi, accent.hi)
  px.alpha(0.35, () => px.r(27 * TILE + 4, 5 * TILE + 10, 9 * TILE - 8, 5 * TILE - 4, M.carpet.lo))
  px.alpha(0.3, () => px.r(34 * TILE + 4, 20 * TILE + 8, 5 * TILE - 8, 4 * TILE - 8, M.carpet.lo))
  // game corner: court mat under the ping-pong table, cosy rug in front of the TV
  const mat = { x: 44 * TILE - 4, y: 22 * TILE + 4, w: 7 * TILE + 8, h: 4 * TILE - 4 }
  px.r(mat.x, mat.y, mat.w, mat.h, M.slate.mid)
  px.outlineRect(mat.x + 3, mat.y + 3, mat.w - 6, mat.h - 6, '#c9d1dc')
  px.v(mat.x + mat.w / 2, mat.y + 3, mat.h - 6, '#c9d1dc')
  rug(px, 43 * TILE + 8, 30 * TILE + 8, 6 * TILE, 3 * TILE + 4, '#d9cfe0', M.slate.base, accent.base)
  // kitchen: runner along the counters
  px.alpha(0.5, () => px.r(40 * TILE + 4, 5 * TILE + 4, 14 * TILE, 10, M.stone.mid))

  // door mats at room thresholds and the corridor runner
  doorMat(px, 30 * TILE + 2, 15 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 11 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 35 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  px.alpha(0.18, () => px.r(1 * TILE, 16 * TILE + 6, (COLS - 2) * TILE, 2 * TILE - 12, M.walnut.lo))

  // floor transitions: brushed steel and walnut thresholds
  px.h(39 * TILE, 16 * TILE, 16 * TILE, M.steel.mid)
  px.h(1 * TILE, 27 * TILE, 14 * TILE, shade(M.walnut.hi, -0.25))

  for (const p of PLACEMENTS) {
    if (p.key.startsWith('chair') || p.key.startsWith('stool') || p.key.startsWith('armchair') || p.key.startsWith('beanbag') || p.key === 'deskDivider' || p.uid) continue
    contactShadow(px, p.tx * TILE, (p.ty + p.th) * TILE, p.tw * TILE)
  }

  paintNorthWall(px)

  // side walls: thin caps
  for (const x of [0, WORLD_W - TILE]) {
    px.r(x, 0, TILE, WORLD_H, PAL.void)
    const edge = x === 0 ? TILE - 6 : x
    px.r(edge, CAP_TOP, 6, WORLD_H - CAP_TOP, PAL.wallCap)
    px.v(x === 0 ? edge + 5 : edge, CAP_TOP, WORLD_H - CAP_TOP, PAL.wallCapHi)
  }
  px.alpha(0.12, () => px.r(TILE, FACE_BOTTOM, 3, WORLD_H - FACE_BOTTOM - TILE, '#000'))

  // south wall cap with the glass entrance
  const sy = (ROWS - 1) * TILE
  px.r(0, sy, WORLD_W, TILE, PAL.void)
  px.r(TILE - 6, sy, WORLD_W - 2 * TILE + 12, 6, PAL.wallCap).h(TILE - 6, sy, WORLD_W - 2 * TILE + 12, PAL.wallCapHi)
  const ex = e.x * TILE
  px.r(ex, sy, e.w * TILE, 6, '#7d8894')
  px.alpha(0.55, () => px.r(ex + 2, sy + 1, e.w * TILE - 4, 4, M.glass.base))
  for (const x of [ex, ex + (e.w * TILE) / 2 - 1, ex + e.w * TILE - 2]) px.r(x, sy - 2, 2, 8, M.black.base)
  return canvas
}

function paintNorthWall(px: Px): void {
  const D = WALL_DECOR
  px.r(0, 0, WORLD_W, FACE_TOP, PAL.void)
  px.r(0, CAP_TOP, WORLD_W, FACE_TOP - CAP_TOP, PAL.wallCap).h(0, FACE_TOP - 1, WORLD_W, PAL.wallCapHi)
  for (let y = FACE_TOP; y < FACE_BOTTOM; y++) {
    px.h(TILE, y, WORLD_W - 2 * TILE, mix(M.plaster.mid, M.plaster.base, Math.min(1, (y - FACE_TOP) / 14)))
  }
  // boardroom accent: acoustic felt
  const felt = D.boardFelt
  for (let x = felt.x * TILE; x < (felt.x + felt.w) * TILE; x++) px.v(x, FACE_TOP, FACE_BOTTOM - FACE_TOP, x % 4 === 0 ? M.slate.lo : M.slate.mid)
  px.h(felt.x * TILE, FACE_TOP, felt.w * TILE, M.slate.base)

  // engineering oak slat accent behind the storage run
  const s = D.workspaceSlats
  for (let x = s.x * TILE; x < (s.x + s.w) * TILE; x++) {
    const k = x % 4
    px.v(x, FACE_TOP, FACE_BOTTOM - FACE_TOP, k === 3 ? M.walnut.lo : k === 0 ? M.oak.hi : M.oak.base)
  }

  // kitchen: subway-tile backsplash
  const bs = D.backsplash
  for (let y = 38; y < FACE_BOTTOM; y++) {
    for (let x = bs.x * TILE; x < (bs.x + bs.w) * TILE; x++) {
      const row = Math.floor((y - 38) / 4)
      const lx = (x + (row % 2) * 4) % 8
      px.p(x, y, (y - 38) % 4 === 0 || lx === 0 ? M.white.mid : M.white.hi)
    }
  }
  // coffee bar: chalkboard menu with a walnut frame
  const cm = D.coffeeMenu
  const mx = cm.x * TILE + 2
  px.r(mx - 2, 18, cm.w * TILE, 19, M.walnut.mid).r(mx, 20, cm.w * TILE - 4, 15, '#2c3530')
  const R0 = rng(12)
  for (let i = 0; i < 4; i++) {
    px.h(mx + 3, 23 + i * 3, 10 + Math.floor(R0() * 10), '#d9dfd6').h(mx + cm.w * TILE - 12, 23 + i * 3, 5, '#e9c46a')
  }
  px.p(mx + 30, 21, '#f2a1a1').p(mx + 31, 21, '#f2a1a1')

  // window frames (glass is animated separately)
  for (const w of D.windows) {
    const x = w.x * TILE
    const { top, bottom } = windowSpan(w.tall)
    px.r(x - 2, top - 2, w.w * TILE + 4, bottom - top + 4, M.black.lo)
    if (w.tall) px.r(x - 3, bottom, w.w * TILE + 6, 3, M.black.base).h(x - 3, bottom, w.w * TILE + 6, M.black.hi)
  }

  // milestone board frame (content is live)
  const rm = D.roadmap
  px.r(rm.x * TILE + 1, 19, rm.w * TILE - 2, 33, M.steel.lo).h(rm.x * TILE + 1, 19, rm.w * TILE - 2, M.steel.hi)
  px.r(rm.x * TILE + 6, 52, rm.w * TILE - 12, 2, M.steel.mid)
  px.p(rm.x * TILE + 10, 51, '#2b59c3').p(rm.x * TILE + 13, 51, '#e04f5f').p(rm.x * TILE + 16, 51, '#1fbf75')
  px.alpha(0.22, () => px.h(rm.x * TILE + 2, 54, rm.w * TILE - 4, '#000'))

  // boardroom whiteboard with marker tray and scribbles
  const wb = D.whiteboard
  const wx = wb.x * TILE + 2
  px.r(wx, 22, wb.w * TILE - 4, 28, M.steel.lo).r(wx + 1, 23, wb.w * TILE - 6, 26, '#fbfcfd')
  // a little architecture sketch (box → box → ✓), notes underneath, and a boxed "do not erase" corner
  px.outlineRect(wx + 4, 25, 7, 5, '#2b59c3').outlineRect(wx + 16, 25, 7, 5, '#2b59c3')
  px.h(wx + 11, 27, 4, '#2b2e38').p(wx + 14, 26, '#2b2e38').p(wx + 14, 28, '#2b2e38')
  px.h(wx + 23, 27, 3, '#2b2e38').p(wx + 27, 28, '#1fbf75').p(wx + 28, 29, '#1fbf75').p(wx + 29, 28, '#1fbf75').p(wx + 30, 27, '#1fbf75').p(wx + 31, 26, '#1fbf75')
  const R = rng(4)
  for (let i = 0; i < 3; i++) px.h(wx + 4, 33 + i * 3, 12 + Math.floor(R() * 12), ['#2b2e38', '#2b59c3', '#2b2e38'][i])
  px.outlineRect(wx + 3, 42, 15, 5, '#e04f5f').h(wx + 5, 44, 11, '#e04f5f')
  px.r(wx + 32, 27, 6, 6, '#ffe066').r(wx + 32, 35, 6, 6, '#ff9fb2')
  px.r(wx + 4, 49, 24, 2, M.steel.mid).p(wx + 8, 48, '#2b59c3').p(wx + 11, 48, '#e04f5f').p(wx + 14, 48, '#1fbf75')

  // boardroom TV bezel (screen animated separately)
  const tv = D.meetingTv
  px.r(tv.x * TILE - 2, 20, tv.w * TILE + 4, 34, '#0e0f13').h(tv.x * TILE - 2, 20, tv.w * TILE + 4, '#30323a')
  px.alpha(0.25, () => px.r(tv.x * TILE - 1, 54, tv.w * TILE + 2, 3, '#000'))

  // kitchen upper cabinets: flat white fronts, black pulls, under-cabinet light
  for (const c of D.upperCabinets) {
    const x = c.x * TILE
    const w = c.w * TILE
    px.r(x, 18, w, 18, M.white.base).h(x, 18, w, M.white.hi).h(x, 35, w, M.white.lo)
    for (let k = 1; k < c.w * 2; k++) px.v(x + k * 8, 19, 16, M.white.mid)
    for (let k = 0; k < c.w * 2; k++) px.r(x + k * 8 + 3, 31, 2, 1, M.black.base)
    px.alpha(0.35, () => px.r(x + 2, 36, w - 4, 4, '#fff1c8'))
  }

  // matte black skirting + wall shadow on the floor
  px.r(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, 3, M.black.base).h(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, M.black.hi)
  px.alpha(0.2, () => px.r(TILE, FACE_BOTTOM, WORLD_W - 2 * TILE, 3, '#000'))
  px.alpha(0.09, () => px.r(TILE, FACE_BOTTOM + 3, WORLD_W - 2 * TILE, 4, '#000'))
}

/** A framed print, 24 × 30 px. */
export function paintPoster(px: Px, x: number, y: number, kind: PosterKind): void {
  const w = 2 * TILE - 8
  const h = 30
  px.r(x, y, w, h, M.black.lo)
  px.r(x + 1, y + 1, w - 2, h - 2, M.white.hi)
  const ix = x + 4
  const iy = y + 4
  const iw = w - 8
  const ih = h - 8
  if (kind === 'ship') {
    for (let k = 0; k < ih; k++) px.h(ix, iy + k, iw, mix('#1f3b5a', '#f39c6b', k / ih))
    px.r(ix + iw / 2 - 1, iy + 6, 3, 10, '#f4f1ea').p(ix + iw / 2, iy + 4, '#f4f1ea').r(ix + iw / 2 - 2, iy + 14, 5, 2, '#e85d4a')
    px.p(ix + iw / 2, iy + 17, '#ffd23f').p(ix + iw / 2, iy + 18, '#f08a24')
  } else if (kind === 'grid') {
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const c = [M.terracotta.base, M.mustard.base, M.sage.base, M.slate.hi][(gx + gy * 2) % 4]
        px.r(ix + gx * Math.floor(iw / 3), iy + gy * Math.floor(ih / 3), Math.floor(iw / 3) - 1, Math.floor(ih / 3) - 1, c)
      }
    }
  } else if (kind === 'bloom') {
    px.r(ix, iy, iw, ih, '#f3ede2')
    px.v(ix + iw / 2, iy + 8, ih - 8, M.leaf.mid)
    px.ellipse(ix + iw / 2, iy + 6, 4, 4, M.terracotta.base).ellipse(ix + iw / 2, iy + 6, 2, 2, M.mustard.hi)
    px.p(ix + iw / 2 - 2, iy + 14, M.leaf.base).p(ix + iw / 2 + 2, iy + 16, M.leaf.base)
  } else {
    for (let k = 0; k < ih; k++) px.h(ix, iy + k, iw, mix('#cfe7ef', '#2a5d86', k / ih))
    for (let xx = 0; xx < iw; xx++) px.p(ix + xx, iy + 12 + Math.round(Math.sin(xx / 2) * 2), '#ffffff')
  }
  px.alpha(0.25, () => px.h(x, y + h, w, '#000'))
}

/** Vertical extent of a north-wall window: tall glazing for workspaces, a smaller one over the sink. */
export function windowSpan(tall: boolean): { top: number; bottom: number } {
  return tall ? { top: 18, bottom: 60 } : { top: 20, bottom: 37 }
}

// ── architectural sprites ────────────────────────────────────────

export const GLASS_FACE = 30

/** South-facing glass partition face with mullions, rails and reflections. */
export function glassFace(widthPx: number): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(widthPx, GLASS_FACE)
  px.alpha(0.26, () => px.r(0, 3, widthPx, GLASS_FACE - 6, M.glass.mid))
  px.alpha(0.55, () => {
    for (let x = 4; x < widthPx; x += 26) for (let i = 0; i < 9; i++) px.p(x + i, GLASS_FACE - 7 - i, '#ffffff').p(x + i + 3, GLASS_FACE - 7 - i, M.glass.hi)
  })
  px.alpha(0.3, () => px.h(0, 11, widthPx, '#ffffff'))
  px.alpha(0.16, () => px.r(0, 12, widthPx, 3, '#ffffff'))
  px.r(0, 0, widthPx, 3, M.black.base).h(0, 0, widthPx, M.black.hi)
  px.r(0, GLASS_FACE - 3, widthPx, 3, M.black.base)
  for (let x = 0; x < widthPx; x += 32) px.r(x, 0, 2, GLASS_FACE, M.black.base)
  px.r(widthPx - 2, 0, 2, GLASS_FACE, M.black.base)
  return canvas
}

/** One sliding glass door leaf (the door animates by moving this sprite). */
export function glassDoor(widthPx: number): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(widthPx, GLASS_FACE)
  px.alpha(0.32, () => px.r(2, 3, widthPx - 4, GLASS_FACE - 6, M.glass.mid))
  px.alpha(0.6, () => {
    for (let i = 0; i < 8; i++) px.p(5 + i, GLASS_FACE - 8 - i, '#ffffff')
  })
  px.outlineRect(0, 0, widthPx, GLASS_FACE, M.black.base)
  px.outlineRect(1, 1, widthPx - 2, GLASS_FACE - 2, M.black.lo)
  px.r(widthPx - 6, 12, 2, 8, M.steel.base)
  return canvas
}

export function glassEdge(heightPx: number): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(6, heightPx)
  px.alpha(0.35, () => px.r(1, 0, 4, heightPx, M.glass.mid))
  px.alpha(0.5, () => px.v(2, 0, heightPx, '#ffffff'))
  px.v(0, 0, heightPx, M.black.base).v(5, 0, heightPx, M.black.base)
  for (let y = 0; y < heightPx; y += 32) px.h(0, y, 6, M.black.base)
  return canvas
}

export const PARTITION_END = 30

/** Solid drywall partition seen from above, with its south end face. */
export function partition(heightPx: number, plaster: Ramp = M.plaster): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(10, heightPx)
  px.r(1, 0, 8, heightPx - PARTITION_END, PAL.wallCap).v(1, 0, heightPx - PARTITION_END, PAL.wallCapHi)
  px.r(1, heightPx - PARTITION_END, 8, PARTITION_END, plaster.base).h(1, heightPx - PARTITION_END, 8, plaster.hi)
  px.r(1, heightPx - 3, 8, 3, M.black.base)
  px.alpha(0.25, () => px.v(9, 0, heightPx, '#000'))
  return canvas
}

export const SOLID_FACE = 30

/** South-facing face of an interior drywall wall: dark cap, plaster face, black skirting. */
export function solidFace(widthPx: number, plaster: Ramp = M.plaster): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(widthPx, SOLID_FACE)
  px.r(0, 0, widthPx, 8, PAL.wallCap).h(0, 0, widthPx, shade(PAL.wallCap, -0.2)).h(0, 7, widthPx, PAL.wallCapHi)
  for (let y = 8; y < SOLID_FACE - 3; y++) px.h(0, y, widthPx, mix(plaster.mid, plaster.base, Math.min(1, (y - 8) / 10)))
  px.r(0, SOLID_FACE - 3, widthPx, 3, M.black.base).h(0, SOLID_FACE - 3, widthPx, M.black.hi)
  return canvas
}

/** Walnut door jamb post for openings in solid walls. */
export function doorJamb(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(3, SOLID_FACE)
  px.r(0, 0, 3, SOLID_FACE, M.walnut.base).v(0, 0, SOLID_FACE, M.walnut.hi).v(2, 0, SOLID_FACE, M.walnut.lo)
  return canvas
}

export const FEATURE_FACE = 40
export const FEATURE_CAP = 8

/**
 * Reception feature wall: dark walnut slats, an LED cove, and AUTOPIA in dimensional backlit
 * channel letters. Returns the wall and its halo glow (composited additively in the scene).
 */
/** The lobby's logo wall. Each office dresses it its own way (materials, light colour, tagline). */
export interface FeatureStyle {
  /** The wall the sign is mounted on. Plain plaster unless an office wants its own. */
  plate?: Ramp
  /** How strongly the letters light the room around them. Dark signs need less to read. */
  glow?: number
  tag: string
  /** Slat ramp behind the letters. */
  slats: Ramp
  /** Letter and cove light ramp. */
  light: Ramp
  /** The letters' dark return (depth). */
  returnColor: string
  tagColor: string
}
export const STARTUP_FEATURE: FeatureStyle = { tag: 'SOFTWARE STUDIO', slats: M.walnut, light: M.brand, returnColor: '#3b230f', tagColor: '#e9d8b4' }

export function featureWall(style: FeatureStyle = STARTUP_FEATURE): { wall: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const fw = FEATURE_WALL
  const w = fw.w * TILE
  const h = FEATURE_CAP + FEATURE_FACE
  const { canvas, px } = makeCanvas(w, h)
  px.r(0, 0, w, FEATURE_CAP, PAL.wallCap).h(0, FEATURE_CAP - 1, w, PAL.wallCapHi).h(0, 0, w, shade(PAL.wallCap, -0.2))
  // the panel always holds the whole name, however narrow this office's wall is
  const nameW = textWidth('AUTOPIA', 3, 1)
  const panelW = Math.min(w - 8, Math.max(w - 4 * TILE, nameW + 12))
  const panelX = Math.round((w - panelW) / 2)
  const plate = style.plate ?? M.plaster
  px.r(0, FEATURE_CAP, w, FEATURE_FACE, plate.base)
  px.h(0, FEATURE_CAP, w, plate.hi)
  for (let x = panelX; x < panelX + panelW; x++) {
    const k = (x - panelX) % 5
    px.v(x, FEATURE_CAP, FEATURE_FACE - 3, k === 4 ? style.slats.lo : k === 0 ? style.slats.hi : k === 3 ? style.slats.mid : style.slats.base)
  }
  // LED cove washing down the slats
  px.h(panelX, FEATURE_CAP, panelW, style.light.hi)
  px.alpha(0.35, () => px.h(panelX, FEATURE_CAP + 1, panelW, style.light.base))
  px.alpha(0.15, () => px.r(panelX, FEATURE_CAP + 2, panelW, 4, style.light.base))
  px.r(0, h - 3, w, 3, M.black.base)

  // channel letters: lit face, brass rim, dark return for depth
  const label = 'AUTOPIA'
  const scale = 3
  const tw = textWidth(label, scale, 1)
  const lx = Math.round((w - tw) / 2)
  const ly = FEATURE_CAP + 7
  drawText(px, label, lx + 1, ly + 2, style.returnColor, scale, 1)
  drawText(px, label, lx + 1, ly + 1, style.light.lo, scale, 1)
  drawText(px, label, lx, ly, style.light.mid, scale, 1)
  const { canvas: core, px: cp } = makeCanvas(w, h)
  drawText(cp, label, lx, ly, style.light.hi, scale, 1)
  const img = cp.ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4 + 3
      if (!(src[i] && src[i - 4] && src[i + 4] && src[i - w * 4] && src[i + w * 4])) img.data[i] = 0
    }
  }
  cp.ctx.putImageData(img, 0, 0)
  px.ctx.drawImage(core, 0, 0)
  const tag = style.tag
  const tagW = textWidth(tag, 1, 1)
  px.alpha(0.8, () => drawText(px, tag, Math.round((w - tagW) / 2), ly + 7 * scale + 3, style.tagColor, 1, 1))

  // halo: blurred letters and cove line
  const { canvas: glow } = makeCanvas(w + 40, h + 40)
  const g = glow.getContext('2d')!
  const { canvas: lettersOnly, px: lp } = makeCanvas(w, h)
  drawText(lp, label, lx, ly, style.light.base, scale, 1)
  lp.h(panelX, FEATURE_CAP, panelW, style.light.base)
  g.filter = 'blur(5px)'
  g.drawImage(lettersOnly, 20, 20)
  g.filter = 'blur(12px)'
  g.globalAlpha = 0.85
  g.drawImage(lettersOnly, 20, 20)
  return { wall: canvas, glow }
}

// ── time of day ──────────────────────────────────────────────────

/** 0 = deep night, 1 = full day. */
export function daylight(date = new Date()): number {
  const h = date.getHours() + date.getMinutes() / 60
  if (h < 5 || h > 21) return 0
  if (h < 8) return (h - 5) / 3
  if (h > 18) return (21 - h) / 3
  return 1
}

export function windowGlass(widthTiles: number, heightPx: number, seed: number, light: number): HTMLCanvasElement {
  const w = widthTiles * TILE
  const h = heightPx
  const { canvas, px } = makeCanvas(w, h)
  const top = mix('#0d1430', '#86c7ef', light)
  const bottom = mix('#2b2752', '#dcecf4', light)
  for (let y = 0; y < h; y++) px.h(0, y, w, mix(top, bottom, y / h))
  const R = rng(seed)
  if (light < 0.4) for (let i = 0; i < w / 5; i++) px.p(Math.floor(R() * w), Math.floor(R() * h * 0.4), '#ffffff')
  for (const depth of [0.55, 1]) {
    let x = -Math.floor(R() * 6)
    while (x < w) {
      const bw = 6 + Math.floor(R() * 10)
      const bh = Math.floor((8 + R() * (h * 0.55)) * depth)
      const c = mix(mix('#1a2040', '#9fb6c9', light * 0.85), '#ffffff', (1 - depth) * 0.35 * light)
      px.r(x, h - bh, bw, bh, c)
      if (depth === 1) {
        for (let wy = h - bh + 2; wy < h - 1; wy += 3) {
          for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
            if (R() < (light < 0.5 ? 0.45 : 0.1)) px.p(wx, wy, light < 0.5 ? '#ffd889' : shade(c, 0.22))
          }
        }
      }
      x += bw + (R() < 0.3 ? 1 : 0)
    }
  }
  for (let mx = TILE * 2; mx < w; mx += TILE * 2) px.r(mx - 1, 0, 2, h, M.black.lo)
  px.alpha(0.22, () => {
    for (let i = 0; i < 14; i++) px.p(4 + i, h - 6 - i, '#ffffff').p(6 + i, h - 6 - i, '#ffffff')
  })
  return canvas
}

export function clockFace(date: Date): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 16)
  px.ellipse(8, 8, 7, 7, M.black.base).ellipse(8, 8, 6, 6, M.white.hi)
  for (const [x, y] of [
    [8, 3],
    [13, 8],
    [8, 13],
    [3, 8]
  ]) px.p(x, y, M.black.base)
  const hand = (angle: number, len: number, color: string) => {
    for (let i = 0; i <= len; i += 0.5) px.p(Math.round(8 + Math.sin(angle) * i), Math.round(8 - Math.cos(angle) * i), color)
  }
  const m = date.getMinutes()
  const h = (date.getHours() % 12) + m / 60
  hand((m / 60) * Math.PI * 2, 5, M.black.lo)
  hand((h / 12) * Math.PI * 2, 3, M.black.lo)
  px.p(8, 8, '#e04f5f')
  return canvas
}
