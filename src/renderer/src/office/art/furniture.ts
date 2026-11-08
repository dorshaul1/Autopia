// Procedurally painted furniture and props, built from the material ramps in palette.ts.
// Each factory returns a canvas anchored bottom-left to its footprint. See docs/ART_DIRECTION.md.

import type { DeskVariant } from '../layout'
import { M, type Ramp } from './palette'
import { block, drawText, makeCanvas, mix, rng, selout, shade, textWidth, type Px } from './px'

const finish = (px: Px, w: number, h: number, darken = 0.5) => selout(px, 0, 0, w, h, darken)

// ── small prop helpers ─────────────────────────────────────────────

function mug(px: Px, x: number, y: number, body: string, fill = '#5a3a24'): void {
  px.r(x, y, 4, 4, body).h(x, y, 4, shade(body, 0.25)).h(x + 1, y, 2, fill).p(x + 4, y + 1, body).p(x + 4, y + 2, body)
}

function plantPot(px: Px, x: number, y: number, pot: Ramp, leaves: Ramp): void {
  px.r(x, y + 3, 5, 4, pot.base).h(x, y + 3, 5, pot.hi).h(x, y + 6, 5, pot.mid)
  px.p(x + 1, y + 1, leaves.base).p(x + 2, y, leaves.hi).p(x + 3, y + 1, leaves.base).p(x + 2, y + 2, leaves.mid).p(x + 4, y + 2, leaves.hi).p(x, y + 2, leaves.mid)
}

function books(px: Px, x: number, base: number, maxX: number, seed: number, tall = 9): void {
  const R = rng(seed)
  const colors = [M.terracotta.base, M.slate.base, M.mustard.base, M.sage.base, M.white.base, M.forest.base, '#2b59c3', M.black.hi]
  while (x < maxX) {
    if (R() < 0.12 && x < maxX - 6) {
      // a leaning stack or object break
      px.r(x, base - 3, 6, 1, colors[Math.floor(R() * colors.length)]).r(x, base - 2, 6, 2, colors[Math.floor(R() * colors.length)])
      x += 7
      continue
    }
    const bw = 2 + Math.floor(R() * 2)
    const bh = tall - 3 + Math.floor(R() * 4)
    const c = colors[Math.floor(R() * colors.length)]
    px.r(x, base - bh, bw, bh, c).v(x, base - bh, bh, shade(c, 0.22)).p(x + bw - 1, base - bh + 2, shade(c, -0.25))
    x += bw + (R() < 0.15 ? 1 : 0)
  }
}

// ── workspace ──────────────────────────────────────────────────────

export const DESK_W = 48
export const DESK_H = 48
/** Monitor screen rects in desk-texture coordinates; animated screens are overlaid here. */
export const DESK_SCREENS = [
  { x: 8, y: 4, w: 15, h: 10 },
  { x: 26, y: 4, w: 15, h: 10 }
]
/** Desk-lamp head position (desk coords) for variants that have one; the scene adds its glow. */
export const DESK_LAMP = { x: 8, y: 22 }

/** Personal touches chosen per employee (deterministic, so a desk always looks like its owner's). */
export interface DeskPersonal {
  seed: number
  mug: string
  item: 'succulent' | 'photo' | 'figurine' | 'bottle' | 'books' | 'speaker'
  sticky: string
}

function personalItem(px: Px, item: DeskPersonal['item'], x: number, y: number, seed: number): void {
  const R = rng(seed)
  switch (item) {
    case 'succulent':
      px.r(x, y + 3, 5, 3, M.white.base).h(x, y + 3, 5, M.white.hi)
      px.p(x + 1, y + 2, M.sage.hi).p(x + 2, y + 1, M.sage.base).p(x + 3, y + 2, M.sage.hi).p(x + 2, y + 2, M.sage.mid).p(x + 4, y + 1, M.sage.base)
      break
    case 'photo':
      px.r(x, y, 5, 6, M.black.base).r(x + 1, y + 1, 3, 4, mix('#7fb6ff', '#f39c6b', R())).p(x + 2, y + 3, M.forest.base)
      break
    case 'figurine':
      px.r(x + 1, y + 3, 3, 3, ['#e04f5f', '#5fb7ff', '#b98cff'][Math.floor(R() * 3)]).r(x + 1, y + 1, 3, 2, '#f1c9a5').p(x + 1, y + 1, M.black.base).p(x + 2, y, M.black.base)
      break
    case 'bottle':
      px.r(x + 1, y, 3, 6, ['#5fb7ff', '#1fbf75', '#f2a53a'][Math.floor(R() * 3)]).h(x + 1, y, 3, M.black.base).v(x + 1, y + 1, 4, '#ffffff')
      break
    case 'books':
      px.r(x, y + 3, 6, 1, M.terracotta.base).r(x, y + 4, 6, 1, M.slate.hi).r(x, y + 5, 6, 1, M.mustard.base)
      break
    case 'speaker':
      px.r(x + 1, y, 4, 6, M.black.base).p(x + 2, y + 2, M.black.hi).p(x + 3, y + 4, M.black.hi)
      break
  }
}

export function desk(variant: DeskVariant, personal?: DeskPersonal): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(DESK_W, DESK_H)
  const top = 17
  // oak top with banded edge, black A-frame legs
  block(px, 1, top, 46, 20, 3, M.oak)
  px.h(1, top, 46, shade(M.oak.hi, 0.12))
  const R = rng(variant.length * 31)
  for (let i = 0; i < 8; i++) px.h(3 + Math.floor(R() * 34), top + 2 + Math.floor(R() * 16), 5 + Math.floor(R() * 8), shade(M.oak.hi, -0.05))
  px.r(2, top + 23, 2, 8, M.black.base).v(2, top + 23, 8, M.black.hi)
  px.r(44, top + 23, 2, 8, M.black.base)
  px.h(4, top + 25, 28, M.black.mid) // cable tray
  // drawer pedestal
  block(px, 31, top + 23, 12, 0, 8, M.white)
  px.h(31, top + 26, 12, M.white.mid).h(35, top + 24, 4, M.black.base).h(35, top + 28, 4, M.black.base)

  // felt desk mat, keyboard, mouse
  px.r(12, top + 8, 26, 9, M.black.mid).h(12, top + 8, 26, M.black.hi)
  const kb = variant === 'dev' ? M.black.base : M.white.mid
  px.r(15, top + 10, 16, 4, kb).h(15, top + 10, 16, shade(kb, 0.25))
  for (let k = 0; k < 7; k++) px.p(16 + k * 2, top + 11, variant === 'dev' ? ['#ff6b8a', '#ffd166', '#5ee6a8', '#5fb7ff', '#b98cff'][k % 5] : shade(kb, -0.12))
  for (let k = 0; k < 6; k++) px.p(17 + k * 2, top + 12, shade(kb, -0.12))
  if (variant === 'dev') px.alpha(0.5, () => px.h(15, top + 14, 16, '#b98cff'))
  px.r(34, top + 11, 2, 3, M.white.hi).p(34, top + 11, '#ffffff').p(35, top + 13, M.white.mid)

  // monitor arm + cable
  px.r(23, 15, 2, 6, M.black.base).r(22, top + 1, 4, 2, M.black.mid)
  px.v(24, top + 3, 4, M.black.lo)
  // dual monitors: thin bezels, chin
  for (const mx of [7, 25]) {
    px.r(mx, 3, 17, 13, M.black.lo)
    px.h(mx, 3, 17, M.black.base)
    px.r(mx + 1, 4, 15, 10, '#11151d')
    px.h(mx + 1, 14, 15, M.black.base)
  }

  switch (variant) {
    case 'pm': {
      px.r(3, top + 6, 9, 9, '#f6f0df').v(7, top + 6, 9, '#d8cfb8').h(3, top + 14, 9, '#e4dcc6')
      for (let i = 0; i < 3; i++) px.h(4, top + 8 + i * 2, 2, '#9aa3b5').h(8, top + 8 + i * 2, 3, '#9aa3b5')
      px.r(12, top + 7, 1, 6, '#2b59c3')
      mug(px, 40, top + 3, personal?.mug ?? M.white.hi, '#c08a5a')
      px.r(7, 3, 3, 3, personal?.sticky ?? '#ffe066').r(37, 4, 3, 3, '#ff9fb2')
      plantPot(px, 41, top + 11, M.terracotta, M.leaf)
      deskLamp(px)
      break
    }
    case 'dev': {
      // headphones resting on the desk, rubber duck, energy can, monitor light bar
      px.r(39, top + 4, 7, 1, M.black.base).r(39, top + 5, 2, 3, '#e04f5f').r(44, top + 5, 2, 3, '#e04f5f')
      px.r(41, top + 12, 4, 3, '#ffd23f').r(42, top + 10, 3, 3, '#ffd23f').p(45, top + 11, '#f08a24').p(43, top + 11, M.black.lo)
      px.r(4, top + 4, 3, 6, '#1fbf75').h(4, top + 4, 3, '#c8f7dc').h(4, top + 7, 3, '#0d7a49')
      px.h(9, 2, 30, M.black.base).h(14, 2, 20, '#fff1c8')
      break
    }
    case 'design': {
      px.r(3, top + 6, 10, 9, '#2a2d36').r(4, top + 7, 8, 7, '#3a3f4c').p(11, top + 7, '#5ee6a8').h(5, top + 13, 6, M.white.hi)
      ;[M.terracotta.base, M.mustard.base, M.sage.base, M.slate.hi].forEach((c, i) => px.r(39 + i * 2, top + 9 - i, 2, 6, c))
      mug(px, 41, top + 2, personal?.mug ?? '#ff8fb1')
      deskLamp(px)
      break
    }
    case 'qa': {
      px.r(3, top + 3, 8, 12, '#9b6b43').r(4, top + 5, 6, 9, '#fbfbf7').r(5, top + 2, 4, 2, M.steel.base)
      for (let i = 0; i < 3; i++) px.p(5, top + 7 + i * 2, '#1fbf75').h(7, top + 7 + i * 2, 2, '#9aa3b5')
      px.r(42, top - 6, 3, 9, '#5fb7ff').h(42, top - 6, 3, '#cfe9f3').r(42, top - 8, 3, 2, M.black.base)
      px.r(39, top + 12, 3, 2, '#e04f5f').p(40, top + 12, M.black.lo).p(39, top + 13, M.black.lo)
      px.r(7, 4, 3, 3, personal?.sticky ?? '#ffe066')
      break
    }
  }
  if (personal) {
    // one personal belonging at the back of the desk, a mug if the role kit has none
    personalItem(px, personal.item, variant === 'qa' ? 35 : 36, top - 4, personal.seed)
    if (variant === 'dev') mug(px, 9, top + 12, personal.mug)
    if (variant === 'qa') mug(px, 13, top + 3, personal.mug)
  }
  finish(px, DESK_W, DESK_H)
  return canvas
}

function deskLamp(px: Px): void {
  px.r(2, 32, 5, 2, M.black.base).h(2, 32, 5, M.black.hi)
  for (let i = 0; i < 9; i++) px.p(4 + Math.floor(i / 3), 31 - i, M.black.base)
  px.r(6, 20, 6, 3, M.black.base).h(6, 20, 6, M.black.hi).h(7, 23, 4, '#ffe9b0')
}

/** Office chair; `away` is the empty chair pushed back and turned slightly, as people leave it. */
export function officeChair(away = false): HTMLCanvasElement {
  if (away) {
    const { canvas, px } = makeCanvas(16, 26)
    px.round(4, 11, 9, 7, M.black.base)
    for (let y = 12; y < 17; y++) for (let x = 5 + (y & 1); x < 12; x += 2) px.p(x, y, M.black.hi)
    px.h(5, 11, 7, M.black.hi).v(12, 13, 3, M.black.mid)
    px.r(2, 16, 2, 3, M.black.mid).r(13, 15, 2, 3, M.black.mid)
    px.r(3, 18, 11, 3, M.black.mid).h(3, 18, 11, M.black.base)
    px.r(7, 21, 2, 1, M.steel.mid)
    px.h(2, 22, 12, M.black.base).p(7, 23, M.black.base).p(8, 23, M.black.base)
    px.p(2, 23, M.black.lo).p(13, 23, M.black.lo).p(5, 24, M.black.lo).p(10, 24, M.black.lo)
    finish(px, 16, 26)
    return canvas
  }
  const { canvas, px } = makeCanvas(16, 26)
  // low mesh back seen from behind, so the sitter's shoulders read above it
  px.round(3, 12, 10, 7, M.black.base)
  for (let y = 13; y < 18; y++) for (let x = 4 + (y & 1); x < 12; x += 2) px.p(x, y, M.black.hi)
  px.h(4, 12, 8, M.black.hi).v(3, 14, 3, M.black.mid).v(12, 14, 3, M.black.mid)
  px.r(1, 16, 2, 3, M.black.mid).r(13, 16, 2, 3, M.black.mid).h(1, 16, 2, M.black.hi).h(13, 16, 2, M.black.hi)
  px.r(2, 19, 12, 2, M.black.mid).h(2, 19, 12, M.black.base)
  px.r(7, 21, 2, 1, M.steel.mid)
  px.h(2, 22, 12, M.black.base).p(7, 23, M.black.base).p(8, 23, M.black.base)
  px.p(2, 23, M.black.lo).p(13, 23, M.black.lo).p(5, 24, M.black.lo).p(10, 24, M.black.lo)
  finish(px, 16, 26)
  return canvas
}

/** Acoustic felt divider standing on the seam between two desks. */
export function deskDivider(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(6, 46)
  px.r(1, 2, 4, 30, M.sage.base).v(1, 2, 30, M.sage.hi).v(4, 2, 30, M.sage.mid)
  px.r(1, 32, 4, 12, M.sage.mid).h(1, 32, 4, M.sage.hi).h(1, 43, 4, M.sage.lo)
  for (let y = 4; y < 30; y += 3) px.p(2, y, M.sage.mid)
  finish(px, 6, 46, 0.45)
  return canvas
}

export function storage(): HTMLCanvasElement {
  const w = 96
  const h = 32
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 10, w, 5, 15, M.white)
  px.r(0, 10, w, 5, M.oak.hi).h(0, 10, w, shade(M.oak.hi, 0.12)).h(0, 14, w, M.oak.mid)
  for (let k = 1; k < 6; k++) px.v(k * 16, 16, 13, M.white.mid)
  for (let k = 0; k < 6; k++) px.r(k * 16 + 7, 20, 2, 1, M.black.base)
  px.r(0, 30, w, 2, M.black.base)
  // binders, speaker, framed photo, trophy, plant
  ;[M.slate.base, M.terracotta.base, M.slate.base, M.mustard.base, M.white.mid].forEach((c, i) => px.r(4 + i * 3, 1, 3, 10, c).h(4 + i * 3, 1, 3, shade(c, 0.2)).p(5 + i * 3, 7, M.white.hi))
  px.r(24, 4, 6, 7, M.black.base).p(26, 6, M.black.hi).p(27, 8, M.black.hi)
  px.r(36, 3, 8, 8, M.black.lo).r(37, 4, 6, 6, mix('#7fb6ff', '#f7c66b', 0.4)).r(37, 8, 6, 2, M.forest.base)
  px.r(52, 3, 3, 6, M.mustard.hi).r(51, 2, 5, 2, M.mustard.base).r(52, 9, 3, 2, M.black.base)
  plantPot(px, 66, 3, M.white, M.leaf)
  px.r(78, 5, 12, 6, M.white.hi).h(78, 5, 12, '#ffffff').p(80, 7, M.slate.hi)
  finish(px, w, h)
  return canvas
}

export function bookshelf(): HTMLCanvasElement {
  const w = 48
  const h = 54
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, 46, 50, M.walnut.lo)
  px.v(1, 2, 50, M.black.base).v(46, 2, 50, M.black.base).h(1, 2, 46, M.black.hi)
  for (let s = 0; s < 4; s++) {
    const base = 13 + s * 12
    px.r(2, base - 10, 44, 10, shade(M.walnut.lo, -0.15))
    if (s === 1) {
      plantPot(px, 4, base - 7, M.white, M.leaf)
      books(px, 12, base, 44, 3 + s, 9)
    } else if (s === 2) {
      books(px, 3, base, 26, 3 + s, 9)
      px.r(30, base - 6, 3, 6, M.mustard.hi).r(29, base - 7, 5, 2, M.mustard.base)
      px.r(37, base - 7, 8, 7, '#d8cfc0').h(37, base - 7, 8, '#ece5d8')
    } else books(px, 3, base, 44, 3 + s, 9)
    px.r(2, base, 44, 2, M.oak.base).h(2, base, 44, M.oak.hi)
  }
  px.r(1, 52, 46, 2, M.black.base)
  finish(px, w, h)
  return canvas
}

export function printer(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 36)
  block(px, 1, 16, 30, 3, 15, M.white)
  px.h(1, 25, 30, M.white.mid).r(13, 21, 6, 1, M.black.base).r(13, 29, 6, 1, M.black.base)
  px.r(1, 34, 30, 2, M.black.base)
  // printer body
  px.round(3, 3, 26, 13, M.slate.lo)
  px.r(4, 4, 24, 4, M.slate.base).h(4, 4, 24, M.slate.hi)
  px.r(6, 0, 18, 4, M.white.hi).h(6, 0, 18, '#ffffff')
  px.r(5, 11, 22, 2, M.black.lo).r(20, 6, 6, 3, '#11151d').p(21, 7, '#5ee6a8').p(23, 7, '#5fb7ff')
  px.r(8, 13, 14, 2, M.white.hi)
  finish(px, 32, 36)
  return canvas
}

export const KANBAN_BOARD = { x: 4, y: 4, w: 40, h: 24 }

export function kanbanFrame(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(48, 46)
  px.r(2, 2, 44, 28, M.steel.lo).r(3, 3, 42, 26, M.steel.base)
  px.r(3, 30, 42, 2, M.steel.mid).p(10, 30, '#2b59c3').p(13, 30, '#e04f5f').p(16, 30, '#1fbf75')
  px.r(7, 32, 2, 10, M.black.base).r(39, 32, 2, 10, M.black.base)
  px.h(4, 41, 8, M.black.base).h(36, 41, 8, M.black.base)
  px.p(4, 42, M.black.lo).p(11, 42, M.black.lo).p(36, 42, M.black.lo).p(43, 42, M.black.lo)
  finish(px, 48, 46)
  return canvas
}

export function huddleTable(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(48, 34)
  px.round(2, 6, 44, 14, M.walnut.hi)
  px.h(4, 6, 40, shade(M.walnut.hi, 0.15))
  px.r(2, 18, 44, 3, M.walnut.mid).h(3, 20, 42, M.walnut.lo)
  px.r(22, 21, 4, 10, M.black.base).v(22, 21, 10, M.black.hi).r(16, 31, 16, 2, M.black.base)
  px.r(8, 4, 12, 8, M.steel.base).h(8, 4, 12, M.steel.hi).r(7, 11, 14, 2, M.steel.mid)
  mug(px, 28, 9, M.white.hi)
  mug(px, 36, 11, M.terracotta.base)
  finish(px, 48, 34)
  return canvas
}

function barStool(frontFacing: boolean): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 26)
  px.ellipse(8, 9, 5, 2, M.walnut.base).h(5, 8, 6, M.walnut.hi)
  if (frontFacing) px.round(4, 3, 8, 5, M.walnut.mid)
  px.v(5, 12, 11, M.black.base).v(10, 12, 11, M.black.base).v(8, 12, 9, M.black.mid)
  px.h(5, 18, 6, M.black.hi)
  finish(px, 16, 26)
  return canvas
}
export const stoolN = () => barStool(true)
export const stoolS = () => barStool(false)

export function cooler(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 38)
  px.round(4, 1, 8, 12, M.glass.mid)
  px.v(5, 3, 8, M.glass.hi).h(5, 1, 6, M.glass.hi).r(6, 12, 4, 2, M.glass.lo)
  block(px, 3, 14, 10, 2, 20, M.white)
  px.r(4, 19, 8, 4, M.black.mid).p(5, 20, '#4a90e2').p(10, 20, '#e04f5f').r(5, 22, 6, 1, M.steel.mid)
  px.r(3, 36, 10, 2, M.black.base)
  finish(px, 16, 38)
  return canvas
}

export function bin(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(12, 18)
  px.r(2, 5, 8, 12, M.black.base)
  for (let y = 6; y < 16; y += 2) for (let x = 3 + (y % 4 === 0 ? 1 : 0); x < 9; x += 2) px.p(x, y, M.black.hi)
  px.ellipse(6, 5, 4, 1, M.black.lo).p(4, 4, '#fbfbf7').p(6, 3, '#fbfbf7').p(7, 4, '#e9e4d6')
  finish(px, 12, 18)
  return canvas
}

// ── meeting room ───────────────────────────────────────────────────

export function meetingTable(): HTMLCanvasElement {
  const w = 112
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  const t = 8
  px.round(1, t, w - 2, 26, M.walnut.base)
  px.round(2, t, w - 4, 2, M.walnut.hi)
  px.alpha(0.3, () => {
    for (let i = 0; i < 4; i++) px.h(14 + i * 24, t + 5 + (i % 2) * 7, 12, '#c99a78')
  })
  px.r(1, t + 26, w - 2, 3, M.walnut.mid).h(2, t + 28, w - 4, M.walnut.lo)
  for (const x of [16, w - 20]) px.r(x, t + 29, 3, 8, M.black.base).h(x - 4, t + 36, 11, M.black.base)
  px.r(w / 2 - 6, t + 12, 12, 3, M.black.mid).p(w / 2 - 3, t + 13, '#5ee6a8').p(w / 2 + 2, t + 13, M.white.hi)
  for (const x of [26, 58]) {
    px.r(x, t - 4, 12, 8, M.steel.base).h(x, t - 4, 12, M.steel.hi).p(x + 6, t, '#ffffff')
    px.r(x - 1, t + 4, 14, 3, M.steel.mid)
  }
  for (const x of [26, 58]) {
    px.r(x, t + 15, 12, 7, '#20252f').r(x + 1, t + 16, 10, 5, '#3b6ea5').h(x + 2, t + 17, 6, '#9cc9f2')
    px.r(x - 1, t + 22, 14, 3, M.steel.base)
  }
  px.r(84, t + 6, 9, 7, '#f6f0df').v(88, t + 6, 7, '#d8cfb8').r(94, t + 7, 1, 5, '#2b2e38')
  for (const [x, y] of [
    [44, 4],
    [76, 18],
    [98, 15]
  ]) px.r(x, t + y, 3, 4, '#cfe9f3').p(x, t + y, '#ffffff')
  px.ellipse(w / 2, t + 6, 4, 2, M.black.mid).p(w / 2, t + 6, '#5ee6a8')
  finish(px, w, h)
  return canvas
}

function shellChair(front: boolean, r: Ramp): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 24)
  if (front) {
    px.round(3, 2, 10, 10, r.mid).round(4, 3, 8, 8, r.base).h(4, 3, 8, r.hi)
    px.round(2, 11, 12, 5, r.base).h(3, 11, 10, r.hi)
    px.v(3, 16, 6, M.black.base).v(12, 16, 6, M.black.base)
  } else {
    px.round(3, 8, 10, 9, r.base).h(4, 8, 8, r.hi).v(12, 9, 7, r.mid)
    px.r(2, 16, 12, 2, r.mid)
    px.v(3, 18, 5, M.black.base).v(12, 18, 5, M.black.base)
  }
  finish(px, 16, 24)
  return canvas
}
export const meetingChairN = () => shellChair(true, M.slate)
export const meetingChairS = () => shellChair(false, M.slate)

export function credenza(): HTMLCanvasElement {
  const w = 80
  const { canvas, px } = makeCanvas(w, 30)
  block(px, 0, 12, w, 4, 12, M.walnut)
  for (let k = 0; k < 4; k++) px.r(k * 20 + 2, 17, 16, 9, shade(M.walnut.base, 0.04)).v(k * 20 + 18, 17, 9, M.walnut.lo)
  px.r(0, 28, w, 2, M.black.base)
  px.r(28, 9, 24, 3, M.black.base).h(28, 9, 24, M.black.hi) // soundbar
  plantPot(px, 6, 4, M.white, M.leafDeep)
  px.r(62, 4, 5, 8, '#e9e3d6').p(63, 2, M.leaf.base).p(65, 1, M.leaf.hi).p(64, 3, '#e8483f')
  px.r(70, 7, 6, 5, '#2b59c3').r(70, 5, 6, 2, M.terracotta.base)
  finish(px, w, 30)
  return canvas
}

export function flipchart(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 46)
  px.r(2, 2, 12, 18, '#fbfbf7').h(2, 2, 12, M.black.base)
  px.h(4, 6, 7, '#2b59c3').h(4, 9, 5, '#2b2e38').h(4, 12, 8, '#e04f5f').p(10, 15, '#1fbf75').p(11, 14, '#1fbf75')
  px.alpha(0.6, () => px.h(2, 20, 12, M.white.mid))
  px.v(3, 20, 24, M.black.base).v(12, 20, 24, M.black.base).v(8, 20, 20, M.black.mid)
  finish(px, 16, 46)
  return canvas
}

// ── kitchen ────────────────────────────────────────────────────────

export function kitchenRun(): HTMLCanvasElement {
  const w = 128
  const h = 36
  const { canvas, px } = makeCanvas(w, h)
  const top = 14
  // quartz counter (top plane) + sage cabinet fronts + black toe kick
  px.r(0, top, w, 7, M.stone.hi)
  const R = rng(17)
  for (let i = 0; i < 40; i++) px.p(Math.floor(R() * w), top + 1 + Math.floor(R() * 5), R() < 0.5 ? M.stone.mid : '#ffffff')
  px.h(0, top + 6, w, M.stone.mid)
  px.r(0, top + 7, w, 13, M.sage.base)
  for (let k = 1; k < 16; k++) px.v(k * 8, top + 8, 11, M.sage.mid)
  for (let k = 0; k < 16; k++) px.r(k * 8 + (k % 2 ? 1 : 5), top + 10, 1, 3, M.black.base)
  px.h(0, top + 7, w, M.sage.hi)
  px.r(0, h - 2, w, 2, M.black.base)

  // bread box, utensil crock and knife block (tiles 40..41)
  px.r(3, 5, 15, 10, M.walnut.base).r(3, 4, 15, 3, M.walnut.hi).h(3, 4, 15, shade(M.walnut.hi, 0.15)).h(4, 9, 13, M.walnut.lo).r(9, 10, 3, 1, M.black.base)
  px.r(21, 8, 5, 7, M.white.base).h(21, 8, 5, M.white.hi).v(22, 3, 5, M.black.base).v(24, 2, 6, M.walnut.mid).p(23, 4, M.steel.base)
  px.r(28, 7, 5, 8, M.walnut.mid).h(28, 7, 5, M.walnut.hi).p(29, 5, M.black.base).p(29, 6, M.black.base).p(31, 4, M.black.base).p(31, 5, M.black.base).p(31, 6, M.black.base)
  // kettle + toaster (tile 39)
  px.ellipse(36, 10, 3, 3, M.black.base).p(35, 8, M.black.hi).r(39, 9, 2, 1, M.black.base).r(34, 13, 5, 1, M.black.lo)
  px.r(41, 8, 6, 6, M.mustard.base).h(41, 8, 6, M.mustard.hi).h(42, 8, 1, M.black.lo).h(45, 8, 1, M.black.lo)
  // sink with black gooseneck faucet (tiles 40..41)
  px.r(52, top + 1, 24, 5, M.steel.lo).r(53, top + 2, 22, 3, M.steel.mid)
  px.r(63, 4, 2, 11, M.black.base).r(63, 4, 6, 2, M.black.base).p(68, 6, M.black.base)
  px.r(78, 9, 10, 5, '#e3dfd7').v(80, 7, 6, '#f3f1ec').v(83, 7, 6, '#f3f1ec').v(86, 8, 5, '#c7d9e6') // dish rack
  // fruit bowl (tile 42)
  px.ellipse(91, 13, 4, 2, M.white.hi).p(89, 11, '#e8483f').p(91, 10, '#f2a53a').p(93, 11, '#7cc04a').p(90, 10, '#ffd23f')
  // microwave (tiles 43..44)
  px.r(98, 2, 26, 13, M.black.base).h(98, 2, 26, M.black.hi).r(100, 4, 16, 9, '#1b1f27').r(101, 5, 6, 2, M.black.hi)
  px.r(118, 4, 4, 9, M.black.mid).p(119, 5, '#5ee6a8').p(120, 5, '#5ee6a8')
  // mug tree
  px.v(96, 4, 10, M.walnut.base)
  mug(px, 93, 6, M.terracotta.base)
  finish(px, w, h)
  return canvas
}

export function fridge(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 56)
  px.r(1, 2, 30, 52, M.steel.base)
  px.v(1, 2, 52, M.steel.hi).v(30, 2, 52, M.steel.lo).h(1, 2, 30, M.steel.hi)
  px.v(16, 2, 52, M.steel.lo)
  px.r(13, 14, 2, 18, M.black.base).r(18, 14, 2, 18, M.black.base)
  px.r(5, 18, 6, 9, M.black.mid).r(6, 19, 4, 7, '#2a3038').p(7, 20, '#5fb7ff')
  px.r(22, 10, 4, 3, '#ffd23f').r(24, 15, 3, 4, '#ff8fb1').r(21, 36, 6, 5, '#fbfbf7').r(22, 37, 4, 3, '#e8a0b4')
  px.r(1, 52, 30, 2, M.black.base)
  finish(px, 32, 56)
  return canvas
}

export function island(): HTMLCanvasElement {
  const w = 80
  const h = 44
  const { canvas, px } = makeCanvas(w, h)
  const top = 8
  px.r(0, top, w, 26, M.stone.hi)
  const R = rng(23)
  for (let i = 0; i < 60; i++) px.p(Math.floor(R() * w), top + 1 + Math.floor(R() * 24), R() < 0.5 ? M.stone.mid : '#ffffff')
  px.h(0, top, w, '#ffffff')
  px.r(0, top + 26, w, 8, M.walnut.base)
  for (let x = 1; x < w; x += 3) px.v(x, top + 26, 8, M.walnut.mid)
  px.h(0, top + 26, w, M.stone.mid)
  px.r(0, h - 2, w, 2, M.black.base)
  // cutting board with bread, herb pots, coffee cups, laptop
  px.r(6, top + 6, 16, 9, '#c8975c').h(6, top + 6, 16, '#ddb27a').ellipse(14, top + 10, 4, 2, '#d79b55').h(12, top + 9, 4, '#efc183')
  plantPot(px, 28, top - 2, M.white, M.leaf)
  plantPot(px, 34, top - 1, M.white, M.leafDeep)
  mug(px, 46, top + 14, M.white.hi)
  mug(px, 54, top + 4, M.slate.hi)
  px.r(60, top + 8, 14, 9, M.steel.base).h(60, top + 8, 14, M.steel.hi).p(67, top + 12, '#ffffff')
  finish(px, w, h)
  return canvas
}

// ── lounge ─────────────────────────────────────────────────────────

export function sofa(): HTMLCanvasElement {
  const w = 80
  const h = 36
  const { canvas, px } = makeCanvas(w, h)
  const c = sofaFabric(M.forest)
  px.round(1, 2, w - 2, 16, c.mid)
  for (const x of [8, 29, 50]) {
    px.round(x, 4, 22, 12, c.base)
    px.h(x + 1, 4, 20, c.hi)
    px.v(x + 21, 6, 8, c.mid)
  }
  px.round(5, 16, w - 10, 10, c.base)
  px.h(6, 16, w - 12, c.hi)
  px.v(29, 17, 8, c.mid).v(51, 17, 8, c.mid)
  px.round(0, 9, 8, 18, c.mid).h(1, 9, 6, c.hi)
  px.round(w - 8, 9, 8, 18, c.mid).h(w - 7, 9, 6, c.hi)
  px.r(2, 26, w - 4, 3, c.lo)
  px.v(5, 29, 4, M.walnut.lo).v(w - 6, 29, 4, M.walnut.lo).v(40, 29, 3, M.walnut.lo)
  // throw pillows + blanket over the arm
  px.round(11, 9, 10, 9, accent.base).h(12, 9, 8, accent.hi).p(15, 13, accent.mid)
  px.round(59, 9, 10, 9, M.terracotta.base).h(60, 9, 8, M.terracotta.hi)
  for (let y = 10; y < 26; y++) px.h(w - 7, y, 5, (y & 1) ? '#e9e1d2' : '#d8cfbd')
  finish(px, w, h)
  return canvas
}

export function coffeeTable(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(48, 24)
  px.round(2, 4, 44, 12, M.walnut.hi).h(4, 4, 40, shade(M.walnut.hi, 0.15))
  px.r(2, 15, 44, 3, M.walnut.mid).h(3, 17, 42, M.walnut.lo)
  px.v(6, 18, 4, M.black.base).v(41, 18, 4, M.black.base)
  px.r(7, 6, 11, 7, '#e85d4a').r(8, 7, 9, 1, '#ffffff').r(9, 9, 9, 3, '#2b59c3')
  px.r(24, 7, 12, 6, M.black.mid).r(26, 6, 3, 4, '#f4ead7').p(27, 5, '#ffd889')
  plantPot(px, 38, 3, M.white, M.leaf)
  finish(px, 48, 24)
  return canvas
}

/** Fabric accent for lounge seating, set from the office customization before textures are built. */
let accent: Ramp = M.mustard
export function setFabricAccent(r: Ramp): void {
  accent = r
}

/** Sofas follow the fabric choice, like the armchairs and the lounge rug. */
const sofaFabric = (_fallback: Ramp) => accent

/** Textures whose look depends on the fabric choice (restyled in place when it changes). */
export const FABRIC_KEYS = ['sofa', 'waitingSofa', 'armchairN', 'armchairS', 'rug:woven', 'rug:round', 'rug:stripe', 'rug:check', 'decor:pouf'] as const

export const fabricAccent = (): Ramp => accent

function armchair(front: boolean): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(20, 30)
  const c = accent
  if (front) {
    px.round(2, 2, 16, 14, c.mid).h(3, 2, 14, c.hi)
    px.round(4, 4, 12, 10, c.base)
    px.round(3, 14, 14, 9, c.base).h(4, 14, 12, c.hi)
    px.round(0, 10, 4, 14, c.mid).round(16, 10, 4, 14, c.mid)
    px.r(1, 23, 18, 2, c.lo).v(3, 25, 3, M.walnut.lo).v(16, 25, 3, M.walnut.lo)
  } else {
    px.round(2, 8, 16, 15, c.base).h(3, 8, 14, c.hi).v(17, 9, 13, c.mid)
    px.round(0, 14, 4, 10, c.mid).round(16, 14, 4, 10, c.mid)
    px.r(1, 23, 18, 2, c.lo).v(3, 25, 3, M.walnut.lo).v(16, 25, 3, M.walnut.lo)
  }
  finish(px, 20, 30)
  return canvas
}
export const armchairN = () => armchair(true)
export const armchairS = () => armchair(false)

export function floorLamp(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 50)
  px.round(2, 2, 12, 10, '#efe2c4').h(3, 2, 10, '#fff6e0').h(2, 11, 12, '#d9c7a1')
  px.alpha(0.8, () => px.h(4, 12, 8, '#ffe2a0'))
  px.v(8, 12, 30, M.walnut.base)
  for (let i = 0; i < 8; i++) px.p(8 - Math.floor(i / 2), 41 + i, M.walnut.base).p(8 + Math.floor(i / 2), 41 + i, M.walnut.base)
  finish(px, 16, 50)
  return canvas
}

export function sideTable(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 24)
  px.ellipse(8, 10, 6, 3, M.walnut.hi).h(4, 8, 8, shade(M.walnut.hi, 0.15))
  px.r(2, 12, 12, 2, M.walnut.mid)
  px.v(7, 14, 8, M.black.base).h(4, 21, 8, M.black.base)
  px.r(5, 4, 4, 5, '#efe2c4').h(5, 4, 4, '#fff6e0').p(6, 9, M.black.base)
  finish(px, 16, 24)
  return canvas
}

export function lowShelf(): HTMLCanvasElement {
  const w = 80
  const { canvas, px } = makeCanvas(w, 30)
  block(px, 0, 10, w, 4, 14, M.walnut)
  px.r(2, 15, w - 4, 7, M.walnut.lo)
  books(px, 3, 22, 36, 41, 7)
  for (let x = 40; x < 60; x += 2) px.v(x, 15, 7, x % 4 ? '#2b2e38' : M.terracotta.mid) // vinyl
  px.r(62, 16, 14, 6, M.slate.base)
  px.r(0, 28, w, 2, M.black.base)
  plantPot(px, 6, 3, M.terracotta, M.leaf)
  px.r(30, 2, 6, 8, '#e9e3d6').h(30, 2, 6, '#fbf8f2').p(32, 0, M.leaf.base).p(33, 1, M.leaf.hi)
  px.r(50, 5, 14, 5, M.black.base).ellipse(56, 6, 3, 1, M.black.hi)
  finish(px, w, 30)
  return canvas
}

export function bookshelfTall(): HTMLCanvasElement {
  const w = 48
  const h = 58
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, 46, 54, M.walnut.base).v(1, 2, 54, M.walnut.hi).v(46, 2, 54, M.walnut.mid).h(1, 2, 46, M.walnut.hi)
  for (let s = 0; s < 4; s++) {
    const base = 14 + s * 12
    px.r(3, base - 10, 42, 10, M.walnut.lo)
    if (s === 0) {
      books(px, 4, base, 30, 51, 9)
      plantPot(px, 34, base - 7, M.terracotta, M.leaf)
    } else if (s === 2) {
      px.r(5, base - 8, 10, 8, M.white.hi).r(6, base - 7, 8, 6, mix('#f39c6b', '#1f3b5a', 0.4))
      books(px, 18, base, 44, 52, 9)
    } else books(px, 4, base, 44, 50 + s, 9)
    px.h(3, base, 42, M.walnut.hi)
  }
  px.r(1, 56, 46, 2, M.black.base)
  finish(px, w, h)
  return canvas
}

export const AQUARIUM_WATER = { x: 3, y: 4, w: 42, h: 17 }

export function aquarium(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(48, 38)
  block(px, 1, 22, 46, 2, 12, M.walnut)
  px.v(24, 25, 9, M.walnut.lo).r(1, 36, 46, 2, M.black.base)
  px.r(2, 2, 44, 20, M.black.base)
  const { x, y, w, h } = AQUARIUM_WATER
  for (let i = 0; i < h; i++) px.h(x, y + i, w, mix('#6fd0ea', '#1c5a88', i / h))
  px.r(x, y + h - 3, w, 3, '#d9c08c').h(x, y + h - 3, w, '#efd9a6')
  for (const [ox, hgt, col] of [
    [5, 10, M.leaf.mid],
    [8, 6, M.leaf.hi],
    [33, 12, M.leaf.mid],
    [36, 7, M.leafDeep.base],
    [20, 5, M.leaf.hi]
  ] as [number, number, string][]) {
    for (let i = 0; i < hgt; i++) px.p(x + ox + (i % 3 === 1 ? 1 : 0), y + h - 3 - i, col)
  }
  px.r(25, y + h - 5, 5, 2, '#8d8d8d').p(26, y + h - 6, '#a5a5a5')
  px.alpha(0.5, () => px.v(x + 1, y, h, '#ffffff'))
  px.h(2, 2, 44, M.black.hi)
  finish(px, 48, 38)
  return canvas
}

export function recordConsole(): HTMLCanvasElement {
  const w = 48
  const { canvas, px } = makeCanvas(w, 32)
  block(px, 0, 12, w, 4, 12, M.walnut)
  px.r(2, 17, 20, 6, M.walnut.lo)
  for (let x = 3; x < 21; x += 2) px.v(x, 17, 6, x % 4 ? '#2b2e38' : M.mustard.base)
  px.r(25, 17, 20, 6, '#3a3330')
  for (let y = 18; y < 23; y++) for (let x = 26 + (y & 1); x < 44; x += 2) px.p(x, y, '#4a423d')
  px.v(5, 28, 3, M.black.base).v(42, 28, 3, M.black.base)
  // turntable
  px.r(8, 6, 18, 7, M.black.base).h(8, 6, 18, M.black.hi).ellipse(16, 9, 5, 2, '#1b1b1f').p(16, 9, M.terracotta.base).v(23, 6, 4, M.steel.base)
  plantPot(px, 33, 4, M.white, M.leafDeep)
  finish(px, w, 32)
  return canvas
}

// ── reception ──────────────────────────────────────────────────────

export function receptionDesk(): HTMLCanvasElement {
  const w = 96
  const h = 40
  const { canvas, px } = makeCanvas(w, h)
  px.r(58, 0, 16, 11, M.black.base).h(58, 0, 16, M.black.hi).r(64, 11, 4, 3, M.black.mid)
  px.r(30, 4, 6, 9, '#e9e3d6').p(31, 2, M.leaf.base).p(33, 1, '#ff9fb2').p(34, 3, M.leaf.hi).p(32, 0, '#ffd23f').p(35, 1, M.leaf.base)
  px.ellipse(18, 12, 3, 2, M.mustard.base).p(18, 10, M.mustard.hi)
  px.r(80, 7, 7, 6, M.black.base).r(81, 8, 5, 4, '#3b6ea5')
  // walnut top band, fluted white front with a backlit brass logo strip
  px.r(0, 13, w, 5, M.walnut.hi).h(0, 13, w, shade(M.walnut.hi, 0.18)).h(0, 17, w, M.walnut.mid)
  px.r(1, 18, w - 2, 19, M.white.base)
  for (let x = 3; x < w - 3; x += 3) px.v(x, 19, 17, M.white.mid)
  px.h(1, 18, w - 2, M.white.hi).h(1, 36, w - 2, M.white.lo)
  const label = 'AUTOPIA'
  const tw = textWidth(label, 1, 1)
  const lx = Math.round((w - tw) / 2)
  px.r(lx - 4, 22, tw + 8, 10, M.black.base).h(lx - 4, 22, tw + 8, M.black.hi)
  drawText(px, label, lx, 23, M.brand.base)
  px.r(0, 37, w, 3, M.black.base)
  finish(px, w, h)
  return canvas
}

export function waitingSofa(): HTMLCanvasElement {
  const w = 48
  const { canvas, px } = makeCanvas(w, 32)
  const c = sofaFabric(M.slate)
  px.round(1, 2, w - 2, 14, c.mid)
  px.round(6, 4, 17, 10, c.base).round(25, 4, 17, 10, c.base)
  px.h(7, 4, 15, c.hi).h(26, 4, 15, c.hi)
  px.round(4, 14, w - 8, 8, c.base).h(5, 14, w - 10, c.hi).v(24, 15, 6, c.mid)
  px.round(0, 8, 6, 15, c.mid).round(w - 6, 8, 6, 15, c.mid)
  px.r(2, 22, w - 4, 2, c.lo).v(4, 24, 4, M.black.base).v(w - 5, 24, 4, M.black.base)
  finish(px, w, 32)
  return canvas
}

/** Long planter box with ornamental grasses, running north-south (1 × 3 tiles). */
export function planter(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 62)
  px.r(2, 8, 12, 44, M.black.mid).v(2, 8, 44, M.black.hi)
  px.r(3, 9, 10, 42, '#4b3a2c')
  px.r(2, 52, 12, 8, M.black.base).h(2, 52, 12, M.black.hi)
  const R = rng(61)
  for (let i = 0; i < 70; i++) {
    const x = 3 + Math.floor(R() * 10)
    const y = 4 + Math.floor(R() * 48)
    const len = 3 + Math.floor(R() * 6)
    const c = [M.leaf.hi, M.leaf.base, M.leaf.mid, M.sage.hi][Math.floor(R() * 4)]
    for (let k = 0; k < len; k++) px.p(x + (k > len / 2 ? (R() < 0.5 ? -1 : 1) : 0), y - k, c)
  }
  finish(px, 16, 62)
  return canvas
}

// ── play area ──────────────────────────────────────────────────────

export function pingpong(): HTMLCanvasElement {
  const w = 80
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  const top = 8
  px.r(2, top, w - 4, 26, '#2f5fa8').h(2, top, w - 4, '#4b7cc4')
  px.outlineRect(3, top + 1, w - 6, 24, '#f4f6f9')
  px.h(4, top + 13, w - 8, '#dfe6ef')
  px.r(w / 2 - 1, top - 3, 2, 29, '#eef1f5').v(w / 2 - 1, top - 3, 29, M.black.base)
  px.r(2, top + 26, w - 4, 3, '#244a85')
  for (const x of [6, w - 8]) px.r(x, top + 29, 2, 8, M.black.base)
  px.r(w / 2 - 4, top + 29, 8, 6, M.black.mid)
  // the paddles and the resting ball are separate sprites (PINGPONG_PADDLES, PINGPONG_BALL):
  // they leave the table while people play
  finish(px, w, h)
  return canvas
}

/** A foosball table, seen the same way as the ping-pong table: felt on top, rods across, players on the rods. */
export function foosball(): HTMLCanvasElement {
  const w = 50
  const h = 40
  const { canvas, px } = makeCanvas(w, h)
  const top = 6
  // the cabinet
  px.r(1, top, w - 2, 22, shade(M.walnut.base, -0.25)).h(1, top, w - 2, shade(M.walnut.base, 0.2))
  px.r(1, top + 22, w - 2, 3, M.walnut.base)
  // the pitch
  px.r(4, top + 2, w - 8, 18, '#2f7d4f').h(4, top + 2, w - 8, '#3f9460')
  px.outlineRect(5, top + 3, w - 10, 16, '#d9efe0')
  px.v(w / 2, top + 3, 16, '#d9efe0')
  // the goals
  px.r(3, top + 8, 2, 6, M.black.base)
  px.r(w - 5, top + 8, 2, 6, M.black.base)
  // rods and players: red on the left half's rods, blue on the others
  const rods: [number, string][] = [[11, '#e04f5f'], [20, '#3f6fd8'], [29, '#e04f5f'], [38, '#3f6fd8']]
  for (const [x, c] of rods) {
    px.v(x, top - 1, 25, '#c9ced6')
    px.r(x, top - 3, 1, 2, M.black.base)
    for (const y of x === 11 || x === 38 ? [top + 10] : [top + 5, top + 10, top + 15]) px.r(x - 1, y, 3, 3, c).h(x - 1, y, 3, shade(c, 0.25))
  }
  // the ball
  px.r(24, top + 12, 2, 2, '#f7f3e7')
  // legs
  for (const x of [4, w - 6]) px.r(x, top + 25, 2, 7, M.black.base)
  px.r(w / 2 - 6, top + 25, 12, 2, M.black.mid)
  finish(px, w, h)
  return canvas
}

/** Where the ball rests on the table between games (art pixels from the table's top-left). */
export const PINGPONG_BALL = { x: 48, y: 14 }

/** Where each paddle rests on the table (art pixels, from the table's top-left), and its colour. */
export const PINGPONG_PADDLES = [
  { x: 11, y: 14, color: '#e04f5f', handle: 1 as const },
  { x: 62, y: 24, color: M.black.base, handle: -1 as const }
]

/** A paddle: round face and a short wooden handle on one side. */
export function paddle(color: string, handle: 1 | -1): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(10, 5)
  const fx = handle > 0 ? 0 : 3
  px.ellipse(fx + 3, 2, 3, 2, color)
  px.r(handle > 0 ? 6 : 0, 2, 3, 1, M.walnut.base)
  return canvas
}

export function arcade(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 48)
  px.r(1, 2, 14, 44, '#2a1f3d').v(1, 2, 44, '#3b2d55').v(14, 2, 44, '#1c1529')
  px.r(2, 3, 12, 5, '#ff5ea8').h(2, 3, 12, '#ff9fcb')
  drawText(px, 'P', 3, 3, '#ffffff')
  px.r(3, 10, 10, 9, '#0b0f1c')
  px.r(4, 12, 2, 2, '#ffd23f').r(8, 15, 3, 1, '#5ee6a8').p(10, 12, '#ff5ea8').p(5, 17, '#5fb7ff')
  px.r(2, 20, 12, 4, '#3b2d55').p(4, 21, '#e04f5f').p(9, 21, '#5fb7ff').p(11, 22, '#ffd23f').v(5, 20, 2, M.black.base)
  px.r(2, 25, 12, 19, '#2a1f3d').r(6, 32, 4, 3, M.black.base).p(7, 33, '#ffd23f')
  px.r(1, 44, 14, 2, M.black.base)
  finish(px, 16, 48)
  return canvas
}

export function phoneBooth(): HTMLCanvasElement {
  const w = 32
  const h = 64
  const { canvas, px } = makeCanvas(w, h)
  // roof (top plane), felt side walls, glass front showing a lit interior
  px.r(1, 2, 30, 30, M.black.base).h(1, 2, 30, M.black.hi)
  px.r(3, 4, 26, 26, M.forest.mid)
  for (let y = 6; y < 30; y += 3) px.h(4, y, 24, M.forest.base)
  px.r(1, 32, 30, 30, M.black.base)
  px.r(3, 34, 26, 26, '#2c3b33')
  px.alpha(0.5, () => px.r(3, 34, 26, 8, '#ffe2a0'))
  px.r(9, 46, 14, 3, M.walnut.hi).v(15, 49, 8, M.black.base)
  px.r(6, 52, 5, 5, M.mustard.base)
  px.alpha(0.3, () => px.r(3, 34, 26, 26, M.glass.mid))
  px.alpha(0.6, () => {
    for (let i = 0; i < 12; i++) px.p(6 + i, 56 - i, '#ffffff')
  })
  px.r(25, 44, 2, 8, M.steel.base)
  px.r(1, 62, 30, 2, M.black.lo)
  finish(px, w, h)
  return canvas
}

export function beanbag(r: Ramp): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(20, 18)
  px.ellipse(10, 11, 8, 5, r.base).ellipse(9, 9, 6, 4, r.hi).ellipse(10, 13, 7, 2, r.mid).p(8, 7, shade(r.hi, 0.15))
  finish(px, 20, 18)
  return canvas
}

// ── plants (two sway frames each) ──────────────────────────────────

type Leaf = [number, number, string]

function leafBlob(cx: number, cy: number, rx: number, ry: number, r: Ramp, out: Leaf[], vein = true): void {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry)
      if (d > 1) continue
      let c = r.base
      if (d < 0.35 && y <= 0 && x <= 0) c = r.hi
      else if (x > rx * 0.35 || y > ry * 0.45) c = r.mid
      if (d > 0.8 && (y > 0 || x > 0)) c = r.lo
      if (vein && x === 0 && Math.abs(y) < ry) c = r.mid
      out.push([cx + x, cy + y, c])
    }
  }
}

function plantCanvas(w: number, h: number, pot: (px: Px) => void, leaves: Leaf[], sway: number): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(w, h)
  for (const [x, y, c] of leaves) px.p(x + (y < h * 0.4 ? sway : 0), y, c)
  pot(px)
  finish(px, w, h, 0.45)
  return canvas
}

function ceramicPot(px: Px, x: number, y: number, w: number, h: number, r: Ramp): void {
  px.r(x, y, w, h, r.base).h(x, y, w, r.hi).h(x + 1, y + 1, w - 2, r.hi).v(x + w - 1, y, h, r.mid).h(x + 1, y + h - 1, w - 2, r.mid)
  px.alpha(0.3, () => px.v(x + 2, y + 2, h - 4, '#ffffff'))
  px.r(x + 1, y, w - 2, 1, '#4b3a2c')
}

export function plant(kind: 'monstera' | 'fig' | 'snake' | 'small' | 'cactus' | 'palm', frame: 0 | 1): HTMLCanvasElement {
  const sway = frame === 0 ? 0 : 1
  switch (kind) {
    case 'monstera': {
      const leaves: Leaf[] = []
      leafBlob(7, 10, 6, 5, M.leaf, leaves)
      leafBlob(16, 8, 6, 5, M.leafDeep, leaves)
      leafBlob(11, 16, 7, 4, M.leaf, leaves)
      leafBlob(5, 19, 4, 3, M.leafDeep, leaves)
      leafBlob(18, 18, 4, 3, M.leaf, leaves)
      const cuts = new Set(['4,9', '5,11', '9,8', '19,7', '18,10', '14,15', '8,17', '12,18'])
      return plantCanvas(24, 36, (px) => ceramicPot(px, 6, 23, 12, 11, M.white), leaves.filter(([x, y]) => !cuts.has(`${x},${y}`)), sway)
    }
    case 'fig': {
      const leaves: Leaf[] = []
      for (let y = 10; y < 32; y++) leaves.push([10, y, M.walnut.mid])
      for (const [x, y, r] of [
        [10, 5, M.leaf],
        [6, 9, M.leafDeep],
        [14, 10, M.leaf],
        [8, 14, M.leaf],
        [14, 17, M.leafDeep],
        [5, 18, M.leaf],
        [11, 21, M.leafDeep]
      ] as [number, number, Ramp][]) leafBlob(x, y, 3, 3, r, leaves)
      return plantCanvas(20, 44, (px) => ceramicPot(px, 4, 32, 12, 11, M.concrete), leaves, sway)
    }
    case 'snake': {
      const leaves: Leaf[] = []
      for (const [x, top] of [
        [4, 7],
        [6, 2],
        [8, 4],
        [10, 8],
        [7, 10]
      ]) {
        for (let y = top; y < 22; y++) {
          leaves.push([x, y, y === top ? '#c9d36a' : (y + x) % 4 === 0 ? M.leaf.base : M.leafDeep.base])
          if (y > top + 2) leaves.push([x + 1, y, y % 3 === 0 ? '#b8c35a' : M.leafDeep.mid])
        }
      }
      return plantCanvas(16, 32, (px) => ceramicPot(px, 2, 21, 12, 10, M.black), leaves, sway)
    }
    case 'small': {
      const leaves: Leaf[] = []
      leafBlob(7, 6, 4, 3, M.leaf, leaves, false)
      for (const [x, y] of [
        [3, 9],
        [2, 11],
        [11, 9],
        [12, 12]
      ]) leaves.push([x, y, M.leaf.base])
      return plantCanvas(14, 18, (px) => ceramicPot(px, 3, 10, 8, 7, M.terracotta), leaves, sway)
    }
    case 'cactus': {
      const leaves: Leaf[] = []
      const arm = (x: number, top: number, bottom: number) => {
        for (let y = top; y < bottom; y++) {
          leaves.push([x, y, M.leaf.hi], [x + 1, y, M.leaf.base], [x + 2, y, y % 3 === 0 ? M.leaf.hi : M.leaf.mid], [x + 3, y, M.leafDeep.lo])
        }
      }
      arm(6, 3, 24)
      for (let x = 2; x < 6; x++) leaves.push([x, 15, M.leaf.base], [x, 16, M.leaf.mid])
      arm(1, 9, 16)
      for (let x = 10; x < 13; x++) leaves.push([x, 12, M.leaf.base], [x, 13, M.leaf.mid])
      arm(12, 7, 13)
      leaves.push([7, 2, '#f08fa6'], [8, 1, '#f7b6c6'], [8, 2, '#e8688a'])
      return plantCanvas(17, 34, (px) => ceramicPot(px, 3, 24, 11, 9, M.terracotta), leaves, 0)
    }
    case 'palm': {
      const leaves: Leaf[] = []
      for (let y = 12; y < 32; y++) leaves.push([10, y, y % 3 ? M.walnut.mid : M.walnut.lo], [11, y, y % 3 ? M.walnut.base : M.walnut.mid])
      const frond = (dir: 1 | -1, len: number, lift: number, r: Ramp) => {
        for (let i = 0; i < len; i++) {
          const x = 10 + dir * i
          const y = 11 - lift + Math.round((i * i) / (len * 0.7))
          leaves.push([x, y, r.base], [x, y + 1, r.mid])
          if (i % 2 === 0 && i > 1) leaves.push([x, y + 2, r.mid], [x + dir, y + 3, r.lo])
        }
      }
      frond(-1, 10, 3, M.leaf)
      frond(1, 10, 3, M.leafDeep)
      frond(-1, 8, 7, M.leafDeep)
      frond(1, 8, 7, M.leaf)
      frond(-1, 4, 10, M.leaf)
      frond(1, 4, 10, M.leaf)
      return plantCanvas(22, 44, (px) => ceramicPot(px, 5, 32, 12, 11, M.birch), leaves, sway)
    }
  }
}

// ── small props & effects ──────────────────────────────────────────

export function roomba(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(12, 10)
  px.ellipse(6, 5, 5, 3, M.black.base).ellipse(6, 4, 4, 2, M.black.hi).p(6, 3, '#5ee6a8').h(4, 7, 5, M.black.lo)
  return canvas
}

export function fish(color: string): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(5, 3)
  px.r(1, 0, 3, 3, color).p(0, 1, color).p(4, 0, shade(color, -0.2)).p(4, 2, shade(color, -0.2)).p(1, 1, '#111')
  return canvas
}

/** A rubber duck, for debugging. Floats in the aquarium. */
export function rubberDuck(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(6, 5)
  px.r(1, 2, 5, 3, '#ffd23f').h(1, 4, 5, '#e8b21f').r(2, 0, 3, 3, '#ffd23f').p(3, 1, '#251a18').p(0, 1, '#f28c28').p(1, 1, '#f28c28').p(5, 2, '#fff1a8')
  return canvas
}

export function dot(color: string, size = 1): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(size, size)
  px.r(0, 0, size, size, color)
  return canvas
}

export function shadowBlob(w: number, h: number): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(w, h)
  px.alpha(0.3, () => px.ellipse(Math.floor(w / 2), Math.floor(h / 2), Math.floor(w / 2) - 1, Math.floor(h / 2), '#000000'))
  return canvas
}

export function selectionRing(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(20, 9)
  px.ellipse(10, 4, 9, 4, M.brand.base)
  const ctx = px.ctx
  ctx.globalCompositeOperation = 'destination-out'
  px.ellipse(10, 4, 7, 2, '#000')
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

export type BubbleKind = 'alert' | 'error' | 'check' | 'dots' | 'coffee' | 'idea' | 'chat' | 'music' | 'heart' | 'phone' | 'book' | 'food' | 'hi'

/** Speech/emote bubble with an icon. */
export function bubble(icon: BubbleKind): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(13, 13)
  px.round(0, 0, 13, 10, '#ffffff').p(3, 10, '#ffffff').p(4, 10, '#ffffff').p(3, 11, '#ffffff')
  px.h(1, 9, 11, '#e6e9ee')
  selout(px, 0, 0, 13, 13, 0.7)
  switch (icon) {
    case 'alert':
      px.v(6, 2, 4, '#e8a317').p(6, 7, '#e8a317')
      break
    case 'error':
      for (let i = 0; i < 5; i++) px.p(4 + i, 2 + i, '#e04f5f').p(8 - i, 2 + i, '#e04f5f')
      break
    case 'check':
      ;[
        [3, 5],
        [4, 6],
        [5, 7],
        [6, 6],
        [7, 5],
        [8, 4],
        [9, 3]
      ].forEach(([x, y]) => px.p(x, y, '#1fbf75'))
      break
    case 'dots':
      px.p(3, 5, '#666').p(6, 5, '#666').p(9, 5, '#666')
      break
    case 'coffee':
      px.r(4, 4, 4, 4, '#7a4a2a').v(8, 5, 2, '#7a4a2a').p(5, 2, '#bbb').p(6, 1, '#bbb')
      break
    case 'idea':
      px.r(5, 2, 3, 4, '#ffd23f').p(4, 3, '#ffd23f').p(8, 3, '#ffd23f').h(5, 6, 3, '#999').h(5, 7, 3, '#777')
      break
    case 'chat':
      px.h(3, 3, 7, '#8a8f99').h(3, 5, 5, '#8a8f99').h(3, 7, 6, '#8a8f99')
      break
    case 'music':
      px.v(7, 2, 5, '#7a4fb0').p(8, 2, '#7a4fb0').p(9, 3, '#7a4fb0').r(5, 6, 2, 2, '#7a4fb0')
      break
    case 'phone':
      px.r(4, 2, 5, 7, '#33353d').r(5, 3, 3, 4, '#7fb6ff').p(6, 8, '#9aa3b5')
      break
    case 'book':
      px.r(2, 3, 4, 5, '#c96a43').r(7, 3, 4, 5, '#5f6b80').v(6, 2, 7, '#8a8f99').h(3, 4, 2, '#f4ead7').h(8, 4, 2, '#f4ead7')
      break
    case 'food':
      px.ellipse(6, 6, 4, 2, '#e3dfd7').p(5, 4, '#e8483f').p(7, 4, '#7cc04a').p(6, 3, '#f2a53a')
      break
    case 'hi':
      px.v(4, 3, 4, '#e8a317').v(6, 2, 5, '#e8a317').v(8, 3, 4, '#e8a317').r(4, 6, 6, 2, '#e8a317').p(9, 5, '#e8a317')
      break
    case 'heart':
      px.p(4, 3, '#e04f5f').p(5, 3, '#e04f5f').p(7, 3, '#e04f5f').p(8, 3, '#e04f5f').h(3, 4, 7, '#e04f5f').h(4, 5, 5, '#e04f5f').h(5, 6, 3, '#e04f5f').p(6, 7, '#e04f5f')
      break
  }
  return canvas
}

// ── coffee bar ─────────────────────────────────────────────────────

/** Brew LED and spout positions on the coffee bar (bar-texture coordinates) for live effects. */
export const COFFEE_BAR = { w: 80, h: 46, spouts: [13, 27], spoutY: 15, led: { x: 33, y: 6 } }

export function coffeeBar(): HTMLCanvasElement {
  const { w, h } = COFFEE_BAR
  const { canvas, px } = makeCanvas(w, h)
  const top = 18
  // quartz top, fluted walnut front, brass foot rail
  px.r(0, top, w, 6, M.stone.hi).h(0, top, w, '#ffffff').h(0, top + 5, w, M.stone.mid)
  const R = rng(29)
  for (let i = 0; i < 30; i++) px.p(Math.floor(R() * w), top + 1 + Math.floor(R() * 4), M.stone.mid)
  px.r(0, top + 6, w, 19, M.walnut.base)
  for (let x = 1; x < w; x += 3) px.v(x, top + 7, 17, M.walnut.mid).v(x + 1, top + 7, 17, M.walnut.hi)
  px.h(0, top + 6, w, M.walnut.lo)
  px.h(2, top + 21, w - 4, M.brand.lo).h(2, top + 20, w - 4, M.brand.base)
  px.r(0, h - 2, w, 2, M.black.base)
  // two-group espresso machine
  px.r(4, 1, 34, 15, M.steel.base).h(4, 1, 34, M.steel.hi).r(4, 0, 34, 2, M.black.base)
  px.v(4, 2, 14, M.steel.hi).v(37, 2, 14, M.steel.lo).h(4, 9, 34, M.steel.mid)
  for (const gx of [9, 23]) {
    px.ellipse(gx + 4, 5, 2, 2, M.white.hi).p(gx + 4, 5, M.black.base).p(gx + 5, 4, '#e04f5f') // gauge
    px.r(gx + 1, 10, 7, 3, M.black.base).h(gx + 1, 10, 7, M.black.hi).r(gx + 7, 11, 5, 1, M.black.mid) // group + portafilter
  }
  px.r(6, 15, 30, 2, M.steel.mid).h(6, 15, 30, M.steel.lo) // drip tray
  for (let x = 7; x < 35; x += 2) px.p(x, 15, M.steel.hi)
  px.r(5, -1 + 1, 32, 1, M.steel.lo)
  for (let k = 0; k < 4; k++) px.r(7 + k * 7, 0, 5, 1, M.white.hi) // warming cups on top
  // grinder with a bean hopper
  px.r(41, 6, 8, 11, M.black.base).v(41, 6, 11, M.black.hi).r(42, 1, 6, 6, M.glass.mid).r(42, 3, 6, 4, '#6b4a33').h(42, 1, 6, M.glass.hi)
  px.r(43, 13, 4, 2, M.black.lo)
  // stacked cups, syrups, pastry dome
  for (let k = 0; k < 3; k++) px.r(52 + (k % 2), 13 - k * 3, 6, 3, M.white.hi).h(52 + (k % 2), 13 - k * 3, 6, '#ffffff').h(52 + (k % 2), 15 - k * 3, 6, M.white.mid)
  ;['#c0542f', '#e9a443', '#7a9a52'].forEach((c, i) => px.r(61 + i * 3, 6, 2, 11, c).p(61 + i * 3, 5, M.black.base).p(61 + i * 3, 4, M.black.base).v(61 + i * 3, 8, 6, shade(c, 0.3)))
  px.r(70, 15, 9, 2, M.steel.mid)
  px.alpha(0.45, () => px.ellipse(74, 11, 4, 4, M.glass.hi))
  px.r(71, 12, 3, 2, '#d79b55').r(74, 13, 3, 2, '#e3a865').p(73, 10, M.steel.base)
  px.alpha(0.7, () => px.p(72, 8, '#ffffff'))
  finish(px, w, h)
  return canvas
}

/** Glass-door drinks fridge with bottles and cans, lit from inside. */
export function drinksFridge(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 50)
  px.r(1, 2, 14, 46, M.black.base).h(1, 2, 14, M.black.hi).r(1, 2, 14, 4, M.black.mid)
  px.r(3, 7, 10, 37, '#dff3fb')
  for (let s = 0; s < 4; s++) {
    const y = 15 + s * 9
    px.h(3, y, 10, M.steel.mid)
    for (let k = 0; k < 4; k++) px.r(4 + k * 2, y - 5 + (k % 2), 1, 5 - (k % 2), ['#e04f5f', '#1fbf75', '#f2a53a', '#5fb7ff', '#b98cff'][(s + k) % 5])
  }
  px.alpha(0.5, () => px.v(4, 8, 30, '#ffffff'))
  px.v(12, 18, 10, M.steel.base).r(1, 46, 14, 2, M.black.lo)
  finish(px, 16, 50)
  return canvas
}

/** Three-stream recycling station. */
export function recycling(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 24)
  ;[M.slate.base, '#2b59c3', M.sage.base].forEach((c, i) => {
    const x = 1 + i * 10
    px.r(x, 6, 9, 16, c).v(x, 6, 16, shade(c, 0.2)).r(x, 3, 9, 4, shade(c, -0.25)).h(x, 3, 9, shade(c, 0.1)).r(x + 3, 4, 3, 1, M.black.lo)
    px.r(x + 3, 12, 3, 3, M.white.hi)
  })
  finish(px, 32, 24)
  return canvas
}

// ── kitchen dining ─────────────────────────────────────────────────

export function diningTable(): HTMLCanvasElement {
  const w = 48
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  const t = 8
  px.r(1, t, w - 2, 24, M.oak.hi).h(1, t, w - 2, shade(M.oak.hi, 0.12))
  const R = rng(37)
  for (let i = 0; i < 6; i++) px.h(3 + Math.floor(R() * 34), t + 3 + Math.floor(R() * 18), 6 + Math.floor(R() * 6), M.oak.base)
  px.r(1, t + 24, w - 2, 3, M.oak.mid).h(1, t + 26, w - 2, M.oak.lo)
  for (const x of [4, w - 6]) px.r(x, t + 27, 2, 9, M.black.base)
  // plates, a bowl of lemons, bud vase
  for (const [x, y] of [
    [9, 5],
    [33, 5],
    [9, 16],
    [33, 16]
  ]) px.ellipse(x, t + y, 3, 2, M.white.hi).p(x, t + y, M.white.mid)
  px.ellipse(22, t + 11, 4, 2, M.slate.hi).p(20, t + 10, '#ffd23f').p(22, t + 10, '#f4d03f').p(24, t + 10, '#ffe066')
  px.r(27, t + 6, 2, 5, M.glass.mid).p(27, t + 4, M.terracotta.hi).p(28, t + 3, M.terracotta.base).p(28, t + 5, M.leaf.base)
  finish(px, w, h)
  return canvas
}

// ── design studio ──────────────────────────────────────────────────

export function moodboard(): HTMLCanvasElement {
  const w = 32
  const h = 52
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, 30, 26, M.walnut.mid).r(2, 3, 28, 24, '#c9a27a')
  const R = rng(73)
  for (let i = 0; i < 40; i++) px.p(2 + Math.floor(R() * 28), 3 + Math.floor(R() * 24), '#b88f68')
  // pinned photos, swatches, sketches, a colour strip
  px.r(4, 5, 9, 7, M.white.hi).r(5, 6, 7, 5, mix('#7fb6ff', '#f39c6b', 0.5)).p(8, 4, '#e04f5f')
  px.r(15, 4, 6, 8, '#fbfbf7').h(16, 6, 4, M.slate.hi).h(16, 8, 3, M.slate.hi).p(18, 3, '#2b59c3')
  ;[M.terracotta.base, M.mustard.base, M.sage.base, M.slate.base].forEach((c, i) => px.r(23, 4 + i * 3, 5, 2, c))
  px.r(4, 15, 8, 8, '#2a2d36').r(5, 16, 6, 6, '#ff8fb1').p(8, 18, '#ffffff').p(7, 14, '#1fbf75')
  px.r(14, 15, 10, 9, '#f6f0df').h(15, 17, 7, '#9aa3b5').h(15, 19, 5, '#9aa3b5').h(15, 21, 6, '#9aa3b5').p(19, 14, '#e04f5f')
  px.r(25, 18, 4, 4, '#ffe066')
  px.h(1, 28, 30, M.walnut.lo)
  // easel legs
  px.v(5, 28, 22, M.walnut.base).v(26, 28, 22, M.walnut.base).v(16, 28, 18, M.walnut.mid)
  px.h(4, 40, 24, M.walnut.mid)
  finish(px, w, h)
  return canvas
}

export const LIGHT_TABLE = { x: 3, y: 10, w: 42, h: 18 }

/** Drafting light table: a lit translucent top with sketches, on steel legs. */
export function lightTable(): HTMLCanvasElement {
  const w = 48
  const h = 44
  const { canvas, px } = makeCanvas(w, h)
  const t = 8
  px.r(1, t, w - 2, 22, M.steel.lo).h(1, t, w - 2, M.steel.base)
  const L = LIGHT_TABLE
  px.r(L.x, L.y, L.w, L.h, '#f4fbff')
  for (let y = L.y; y < L.y + L.h; y += 2) px.h(L.x, y, L.w, '#eaf6fc')
  // translucent sketch sheets with wireframes
  px.alpha(0.85, () => px.r(7, 12, 14, 11, '#fffdf6'))
  px.outlineRect(9, 14, 10, 7, '#7d8aa0').h(9, 16, 10, '#b5bfcc').v(13, 14, 7, '#b5bfcc')
  px.alpha(0.85, () => px.r(25, 13, 14, 12, '#fffdf6'))
  px.ellipse(32, 18, 4, 3, '#9aa3b5').ellipse(32, 18, 3, 2, '#fffdf6').h(27, 23, 10, '#ff8fb1')
  px.r(40, 12, 2, 9, M.black.base).p(40, 11, '#e04f5f') // stylus
  px.r(1, t + 22, w - 2, 3, M.steel.mid).h(1, t + 24, w - 2, M.steel.lo)
  for (const x of [3, w - 5]) px.r(x, t + 25, 2, 10, M.black.base)
  px.h(3, t + 31, w - 6, M.black.mid)
  finish(px, w, h)
  return canvas
}

export function swatchShelf(): HTMLCanvasElement {
  const w = 64
  const { canvas, px } = makeCanvas(w, 32)
  block(px, 0, 12, w, 4, 14, M.white)
  for (let k = 1; k < 4; k++) px.v(k * 16, 17, 12, M.white.mid)
  for (let k = 0; k < 4; k++) px.r(k * 16 + 7, 21, 2, 1, M.black.base)
  px.r(0, 30, w, 2, M.black.base)
  // fabric rolls, paint chip fan, sample boxes, plant
  ;[M.terracotta.base, M.sage.base, M.mustard.base, M.slate.hi].forEach((c, i) => px.r(3 + i * 4, 4, 3, 9, c).h(3 + i * 4, 4, 3, shade(c, 0.25)))
  for (let i = 0; i < 6; i++) px.r(22 + i, 8 - (i % 3), 2, 5, [M.terracotta.hi, M.mustard.hi, M.sage.hi, M.slate.hi, '#ff8fb1', '#7fb6ff'][i])
  px.r(32, 7, 10, 6, M.black.base).h(32, 7, 10, M.black.hi).r(43, 8, 8, 5, '#e9e3d6').h(43, 8, 8, '#fbf8f2')
  plantPot(px, 55, 5, M.white, M.leaf)
  finish(px, w, 32)
  return canvas
}

// ── focus room ─────────────────────────────────────────────────────

/** TV screen rect on the rolling display stand (stand-texture coordinates). */
export const DISPLAY_SCREEN = { x: 3, y: 3, w: 26, h: 15 }

export function displayStand(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 50)
  px.r(1, 1, 30, 19, '#0e0f13').h(1, 1, 30, '#30323a')
  px.r(DISPLAY_SCREEN.x, DISPLAY_SCREEN.y, DISPLAY_SCREEN.w, DISPLAY_SCREEN.h, PAL_SCREEN)
  px.r(14, 20, 4, 22, M.black.base).v(14, 20, 22, M.black.hi)
  px.r(5, 42, 22, 3, M.black.base).h(5, 42, 22, M.black.hi)
  px.p(5, 46, M.black.lo).p(26, 46, M.black.lo).p(15, 46, M.black.lo)
  px.r(13, 30, 6, 4, M.black.mid) // camera/soundbar
  finish(px, 32, 50)
  return canvas
}
const PAL_SCREEN = '#11151d'

// ── print & supply room ────────────────────────────────────────────

export function printerStation(): HTMLCanvasElement {
  const w = 48
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  // multifunction printer: scanner lid, control panel, output tray, paper drawers
  block(px, 2, 6, 30, 6, 32, M.white)
  px.r(2, 4, 30, 4, M.slate.lo).h(2, 4, 30, M.slate.base)
  px.r(22, 7, 8, 4, '#11151d').p(23, 8, '#5ee6a8').h(24, 9, 4, '#5fb7ff')
  px.r(4, 14, 18, 3, M.black.lo).r(6, 13, 14, 2, M.white.hi)
  for (let k = 0; k < 3; k++) px.h(3, 22 + k * 7, 28, M.white.mid).r(13, 24 + k * 7, 8, 1, M.black.base)
  px.r(2, h - 2, 30, 2, M.black.base)
  // shredder and a paper stack
  px.r(35, 22, 11, 22, M.black.base).h(35, 22, 11, M.black.hi).r(37, 23, 7, 1, M.black.lo).p(44, 25, '#5ee6a8')
  px.r(35, 12, 11, 10, '#fbfbf7').h(35, 12, 11, '#ffffff')
  for (let y = 14; y < 22; y += 2) px.h(35, y, 11, M.white.mid)
  finish(px, w, h)
  return canvas
}

export function lockers(): HTMLCanvasElement {
  const w = 64
  const h = 58
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 8, w, 4, 44, M.sage)
  for (let k = 0; k < 4; k++) {
    const x = k * 16
    px.v(x, 12, 44, M.sage.lo).r(x + 4, 16, 8, 1, M.sage.lo).r(x + 4, 18, 8, 1, M.sage.lo).r(x + 4, 20, 8, 1, M.sage.lo)
    px.r(x + 12, 30, 2, 5, M.black.base).p(x + 4, 24, M.white.hi).p(x + 5, 24, M.white.hi)
  }
  px.r(20, 38, 6, 6, '#ff8fb1').p(22, 40, '#ffffff') // a sticker
  px.r(0, h - 2, w, 2, M.black.base)
  // boxes, a helmet and a plant on top
  px.r(4, 1, 12, 7, '#c8975c').h(4, 1, 12, '#ddb27a').h(4, 4, 12, '#b78450')
  px.ellipse(28, 5, 5, 3, M.terracotta.base).h(25, 3, 6, M.terracotta.hi)
  plantPot(px, 50, 1, M.white, M.leaf)
  finish(px, w, h)
  return canvas
}

/** Steel shelving running north-south, seen from above, stacked with labelled boxes. */
export function supplyShelf(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 62)
  px.r(1, 4, 14, 50, M.steel.mid).v(1, 4, 50, M.steel.hi).v(14, 4, 50, M.steel.lo)
  const R = rng(83)
  for (let y = 6; y < 50; y += 8) {
    const c = R() < 0.6 ? '#c8975c' : R() < 0.5 ? M.white.base : M.slate.hi
    px.r(3, y, 10, 6, c).h(3, y, 10, shade(c, 0.2)).r(6, y + 3, 4, 1, M.white.hi)
  }
  px.r(1, 54, 14, 6, M.steel.base).h(1, 54, 14, M.steel.hi).r(1, 60, 14, 2, M.black.base)
  finish(px, 16, 62)
  return canvas
}

export function paperBoxes(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 30)
  const box = (x: number, y: number) => {
    px.r(x, y, 14, 4, '#e8dcc2').h(x, y, 14, '#f4ecd9').r(x, y + 4, 14, 8, '#d9c8a5').h(x, y + 4, 14, '#c9b48d').r(x + 4, y + 7, 6, 2, M.slate.hi)
  }
  box(1, 16)
  box(16, 16)
  box(8, 4)
  finish(px, 32, 30)
  return canvas
}

// ── phone booths ───────────────────────────────────────────────────

/** Booth roof and lit felt interior with a bench; people sit between this and the glass front. */
export function phoneBoothBack(): HTMLCanvasElement {
  const w = 32
  const h = 64
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, 30, 24, M.black.base).h(1, 2, 30, M.black.hi)
  px.r(3, 4, 26, 20, M.forest.mid)
  for (let y = 6; y < 24; y += 3) px.h(4, y, 24, M.forest.base)
  px.r(1, 26, 30, 36, M.black.base)
  px.r(3, 27, 26, 34, '#2c3b33')
  for (let x = 4; x < 28; x += 3) px.v(x, 28, 16, '#33463c')
  px.alpha(0.5, () => px.r(3, 27, 26, 6, '#ffe2a0'))
  px.r(6, 48, 20, 4, M.walnut.hi).h(6, 48, 20, shade(M.walnut.hi, 0.15)).r(6, 52, 20, 3, M.walnut.mid) // bench
  px.r(22, 36, 5, 2, M.walnut.base) // shelf
  return canvas
}

export function phoneBoothFront(): HTMLCanvasElement {
  const w = 32
  const h = 64
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 24, 30, 3, M.black.hi)
  px.alpha(0.22, () => px.r(3, 27, 26, 34, M.glass.mid))
  px.alpha(0.55, () => {
    for (let i = 0; i < 12; i++) px.p(6 + i, 58 - i, '#ffffff').p(8 + i, 58 - i, M.glass.hi)
  })
  px.r(1, 26, 2, 36, M.black.base).r(29, 26, 2, 36, M.black.base).r(1, 60, 30, 3, M.black.base)
  px.r(25, 42, 2, 8, M.steel.base)
  return canvas
}

// ── game corner ────────────────────────────────────────────────────

export function gameShelf(): HTMLCanvasElement {
  const w = 48
  const { canvas, px } = makeCanvas(w, 40)
  px.r(1, 4, 46, 34, M.walnut.base).v(1, 4, 34, M.walnut.hi).h(1, 4, 46, M.walnut.hi)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 3 + c * 15
      const y = 6 + r * 15
      px.r(x, y, 13, 13, M.walnut.lo)
      if ((r + c) % 3 === 0) for (let k = 0; k < 4; k++) px.r(x + 1, y + 10 - k * 3, 11, 2, [M.terracotta.base, M.slate.hi, M.mustard.base, '#2b59c3'][k])
      else if ((r + c) % 3 === 1) px.r(x + 2, y + 7, 9, 5, M.black.base).p(x + 4, y + 9, '#e04f5f').p(x + 8, y + 9, '#5fb7ff')
      else plantPot(px, x + 4, y + 4, M.white, M.leaf)
    }
  }
  px.r(1, 38, 46, 2, M.black.base)
  finish(px, w, 40)
  return canvas
}

/** TV screen rect on the game-corner console (console-texture coordinates). */
export const TV_SCREEN = { x: 14, y: 3, w: 52, h: 24 }

export function tvConsole(): HTMLCanvasElement {
  const w = 80
  const h = 50
  const { canvas, px } = makeCanvas(w, h)
  px.r(12, 1, 56, 28, '#0e0f13').h(12, 1, 56, '#30323a')
  px.r(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.w, TV_SCREEN.h, PAL_SCREEN)
  px.r(36, 29, 8, 3, M.black.base)
  block(px, 2, 30, 76, 4, 13, M.walnut)
  for (let k = 0; k < 4; k++) px.r(4 + k * 19, 35, 17, 7, shade(M.walnut.base, 0.04)).v(4 + k * 19 + 17, 35, 7, M.walnut.lo)
  px.r(6, 29, 10, 3, M.black.base).p(14, 30, '#5ee6a8') // console
  px.r(62, 27, 8, 3, M.black.mid).p(64, 28, '#e04f5f').p(67, 28, '#5fb7ff') // controllers
  px.r(2, h - 2, 76, 2, M.black.base)
  finish(px, w, h)
  return canvas
}

// ── entrance details ───────────────────────────────────────────────

export function coatRack(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 48)
  px.v(8, 6, 38, M.black.base).h(4, 44, 9, M.black.base).p(3, 45, M.black.lo).p(13, 45, M.black.lo)
  px.round(2, 6, 7, 16, M.slate.base).h(3, 6, 5, M.slate.hi)
  px.round(8, 5, 6, 13, M.terracotta.mid).h(9, 5, 4, M.terracotta.hi)
  px.r(4, 20, 6, 8, '#e8dcc2').h(4, 20, 6, '#f4ecd9') // tote bag
  px.r(6, 2, 5, 3, M.black.hi)
  finish(px, 16, 48)
  return canvas
}

export function umbrellaStand(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 26)
  px.v(5, 2, 12, '#2b59c3').p(4, 1, '#2b59c3').v(9, 0, 14, M.terracotta.base).p(10, 0, M.terracotta.base).v(11, 4, 10, M.black.base)
  px.r(3, 12, 10, 12, M.black.base).h(3, 12, 10, M.black.hi).ellipse(8, 12, 5, 1, M.black.lo)
  finish(px, 16, 26)
  return canvas
}

/** Long planter with ornamental grasses and an oak bench along its front (6 × 1 tiles). */
export function planterBench(): HTMLCanvasElement {
  const w = 96
  const h = 40
  const { canvas, px } = makeCanvas(w, h)
  // planter box: matte black top rim, soil, dense planting
  px.r(2, 10, w - 4, 6, M.black.hi).r(4, 11, w - 8, 4, '#4b3a2c')
  const R = rng(91)
  for (let i = 0; i < 260; i++) {
    const x = 4 + Math.floor(R() * (w - 8))
    const y = 2 + Math.floor(R() * 12)
    const len = 2 + Math.floor(R() * 7)
    const c = [M.leaf.hi, M.leaf.base, M.leaf.mid, M.sage.hi, M.leafDeep.base][Math.floor(R() * 5)]
    for (let k = 0; k < len; k++) px.p(x + (k > len / 2 ? (R() < 0.5 ? -1 : 1) : 0), y + 12 - k, c)
  }
  for (const x of [14, 40, 70]) px.ellipse(x, 6, 2, 2, M.mustard.hi).p(x, 6, M.terracotta.base)
  px.r(2, 16, w - 4, 10, M.black.base).h(2, 16, w - 4, M.black.mid)
  // oak bench seat in front
  px.r(4, 24, w - 8, 5, M.oak.hi).h(4, 24, w - 8, shade(M.oak.hi, 0.12)).r(4, 29, w - 8, 3, M.oak.mid)
  for (const x of [8, w / 2 - 1, w - 10]) px.r(x, 32, 2, 6, M.black.base)
  finish(px, w, h)
  return canvas
}

/** Every static furniture factory by placement key. */
export const FACTORIES: Record<string, () => HTMLCanvasElement> = {
  'chair:office': () => officeChair(false),
  'chair:officeAway': () => officeChair(true),
  coffeeBar,
  planterBench,
  diningTable,
  drinksFridge,
  recycling,
  'chair:diningN': () => shellChair(true, M.sage),
  'chair:diningS': () => shellChair(false, M.sage),
  moodboard,
  lightTable,
  swatchShelf,
  focusTable: huddleTable,
  displayStand,
  printerStation,
  lockers,
  supplyShelf,
  paperBoxes,
  'phoneBooth:back': phoneBoothBack,
  'phoneBooth:front': phoneBoothFront,
  gameShelf,
  tvConsole,
  coatRack,
  umbrellaStand,
  deskDivider,
  storage,
  bookshelf,
  printer,
  kanbanBoard: kanbanFrame,
  huddleTable,
  'stool:N': stoolN,
  'stool:S': stoolS,
  cooler,
  bin,
  meetingTable,
  'chair:meetingN': meetingChairN,
  'chair:meetingS': meetingChairS,
  credenza,
  flipchart,
  kitchenRun,
  fridge,
  island,
  lowShelf,
  sofa,
  coffeeTable,
  armchairN,
  armchairS,
  floorLamp,
  sideTable,
  bookshelfTall,
  aquarium,
  recordConsole,
  receptionDesk,
  waitingSofa,
  planter,
  pingpong,
  foosball,
  arcade,
  phoneBooth,
  'beanbag:terracotta': () => beanbag(M.terracotta),
  'beanbag:slate': () => beanbag(M.slate),
  'beanbag:mustard': () => beanbag(M.mustard)
}
