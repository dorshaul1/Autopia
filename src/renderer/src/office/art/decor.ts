// Personal touches: the pieces a project's office can be dressed with. Same scale, light and ramps as the
// furniture (light from the top left, a soft contact shadow, the selout edge). Wall pieces hang on the north wall.

import { PICTURE_H, PICTURE_PALETTE, PICTURE_W } from '@shared/officeDecor'
import { paintPoster } from './environment'
import { fabricAccent } from './furniture'
import { M, PAL, type Ramp } from './palette'
import { drawText, makeCanvas, mix, selout, shade, textWidth, type Px } from './px'
import type { PosterKind } from '../layout'

const TILE = 16
const finish = (px: Px, w: number, h: number) => selout(px, 0, 0, w, h, 0.5)
const groundShadow = (px: Px, cx: number, y: number, rx: number) => px.alpha(0.22, () => px.ellipse(cx, y, rx, 1, '#000000'))

// ── lamps ────────────────────────────────────────────────────

function paperLantern(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 48)
  groundShadow(px, 8, 46, 5)
  px.v(8, 16, 26, M.black.mid).v(9, 16, 26, M.black.lo)
  px.r(4, 42, 9, 2, M.black.base).h(4, 42, 9, M.black.hi).h(4, 44, 9, M.black.lo)
  px.ellipse(8, 9, 7, 7, '#efe2c4')
  px.ellipse(8, 8, 6, 5, '#fff3d4')
  px.ellipse(7, 7, 3, 2, '#fffbea')
  for (const y of [4, 7, 10, 13]) px.alpha(0.3, () => px.h(2, y, 13, '#c9b48a'))
  px.h(5, 1, 7, '#fffbea')
  finish(px, 16, 48)
  return canvas
}

function arcLamp(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(24, 50)
  groundShadow(px, 18, 48, 5)
  px.r(13, 45, 10, 3, M.stone.base).h(13, 45, 10, M.stone.hi).h(13, 47, 10, M.stone.lo)
  const brass = M.mustard
  for (let y = 8; y < 45; y++) {
    const t = (45 - y) / 37
    const x = Math.round(18 - 12 * t * t)
    px.p(x, y, brass.base).p(x + 1, y, brass.mid)
  }
  px.h(6, 7, 6, brass.hi)
  // a dome shade, lit from below
  px.r(1, 9, 10, 4, brass.base).h(1, 9, 10, brass.hi).h(2, 8, 8, brass.hi).v(10, 9, 4, brass.mid)
  px.h(1, 13, 10, '#fff3d4').h(3, 14, 6, '#ffe2a0')
  finish(px, 24, 50)
  return canvas
}

function mushroomLamp(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 30)
  groundShadow(px, 8, 28, 6)
  // a small plinth to stand on
  px.r(3, 17, 10, 11, M.birch.mid).r(3, 15, 10, 3, M.birch.hi).h(3, 15, 10, shade(M.birch.hi, 0.3)).v(12, 18, 10, M.birch.lo)
  px.r(7, 9, 3, 6, '#f3e6c6').v(9, 9, 6, '#d9c7a1')
  px.ellipse(8, 7, 6, 4, M.terracotta.base)
  px.h(3, 4, 10, M.terracotta.hi).h(2, 9, 12, '#ffe2a0')
  px.p(5, 5, '#fff3d4').p(10, 6, '#fff3d4').p(7, 4, '#fff3d4')
  finish(px, 16, 30)
  return canvas
}

// ── small things ─────────────────────────────────────────────

function globe(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 28)
  groundShadow(px, 8, 26, 5)
  px.r(3, 23, 10, 3, M.walnut.base).h(3, 23, 10, M.walnut.hi).h(3, 25, 10, M.walnut.lo)
  px.v(8, 17, 6, M.walnut.mid).v(9, 17, 6, M.walnut.lo)
  px.ellipse(8, 10, 7, 7, '#3f7fb0')
  px.ellipse(7, 9, 5, 5, '#5a9cc8')
  // land, in chunky pixels
  for (const [x, y, w] of [
    [4, 5, 4],
    [3, 6, 5],
    [4, 7, 3],
    [10, 8, 3],
    [9, 9, 5],
    [10, 10, 3],
    [5, 12, 3],
    [6, 13, 2]
  ]) px.h(x, y, w, M.leaf.mid)
  px.p(5, 5, M.leaf.hi).p(10, 9, M.leaf.hi)
  px.p(5, 6, '#a9d6ee').p(4, 8, '#a9d6ee')
  // the brass meridian
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI
    px.p(Math.round(8 + Math.cos(a - Math.PI / 2) * 8), Math.round(10 + Math.sin(a - Math.PI / 2) * 8), M.mustard.mid)
  }
  finish(px, 16, 28)
  return canvas
}

function bookStack(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 22)
  groundShadow(px, 8, 20, 7)
  const stack: [number, number, Ramp][] = [
    [1, 14, M.slate],
    [2, 10, M.terracotta],
    [1, 12, M.sage],
    [3, 9, M.mustard],
    [2, 11, M.walnut]
  ]
  let y = 20
  for (const [x, w, r] of stack) {
    y -= 3
    px.r(x, y, w, 3, r.base).h(x, y, w, r.hi).h(x, y + 2, w, r.mid)
    px.r(x + w - 2, y + 1, 2, 1, M.white.base)
  }
  // a mug somebody forgot about
  px.r(6, y - 5, 5, 5, M.white.base).h(6, y - 5, 5, M.white.hi).h(7, y - 5, 3, '#5a3a24').v(10, y - 4, 4, M.white.mid).p(11, y - 3, M.white.mid)
  finish(px, 16, 22)
  return canvas
}

function recordCrate(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 22)
  groundShadow(px, 8, 20, 7)
  // sleeves standing in the crate
  const sleeves = ['#e85d4a', '#5f6b80', '#f0c264', '#46705a', '#efe2c4', '#8a5c8f']
  sleeves.forEach((c, i) => {
    px.r(2 + i * 2, 3 + (i % 2), 2, 11, c).v(2 + i * 2, 3 + (i % 2), 11, shade(c, 0.18))
  })
  px.ellipse(10, 6, 2, 2, '#17181c')
  px.r(1, 11, 14, 8, M.oak.base).h(1, 11, 14, M.oak.hi).h(1, 14, 14, M.oak.mid).h(1, 18, 14, M.oak.lo)
  px.r(5, 12, 6, 1, M.oak.lo)
  px.v(1, 11, 8, M.oak.mid).v(14, 11, 8, M.oak.mid)
  finish(px, 16, 22)
  return canvas
}

function pouf(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 16)
  const c = fabricAccent()
  groundShadow(px, 8, 14, 7)
  px.ellipse(8, 8, 7, 5, c.mid)
  px.ellipse(8, 7, 7, 4, c.base)
  px.ellipse(7, 6, 4, 2, c.hi)
  // a seam round the middle and a button on top, so it reads as a cushion
  px.alpha(0.35, () => px.h(2, 9, 13, c.lo))
  px.p(8, 6, c.lo).p(7, 6, c.mid)
  finish(px, 16, 16)
  return canvas
}

// ── yours: the two floor pieces that carry this project's words and picture ──

let personal = { sign: '', picture: '', light: '#ffc979' }
/** What this project's own pieces show, set before they are drawn. */
export function setPersonal(p: typeof personal): void {
  personal = p
}
/** Drawn from this project's words and picture: never recoloured, and redrawn when those change. */
export const PERSONAL_KEYS = ['decor:sign', 'decor:easel'] as const

function standingSign(): HTMLCanvasElement {
  const w = 4 * TILE
  const { canvas, px } = makeCanvas(w, 38)
  groundShadow(px, 8, 36, 4)
  groundShadow(px, w - 8, 36, 4)
  for (const x of [7, w - 9]) {
    px.v(x, 20, 15, M.black.mid).v(x + 1, 20, 15, M.black.lo)
    px.r(x - 3, 35, 8, 2, M.black.base).h(x - 3, 35, 8, M.black.hi)
  }
  px.drawImage(sign(personal.sign, personal.light), 0, 2)
  finish(px, w, 38)
  return canvas
}

function easel(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(26, 46)
  groundShadow(px, 13, 44, 8)
  const wood = M.oak
  for (let y = 0; y < 44; y++) {
    px.p(13 - Math.round(y / 5), y, wood.base).p(13 + Math.round(y / 5), y, wood.mid)
  }
  px.v(13, 24, 20, wood.lo)
  px.drawImage(picture(personal.picture), 1, 1)
  px.r(1, 30, 24, 2, wood.base).h(1, 30, 24, wood.hi)
  finish(px, 26, 46)
  return canvas
}

// ── rugs: flat on the floor, with the fabric colour the office has chosen ──

function fringe(px: Px, w: number, h: number): void {
  for (let x = 1; x < w - 1; x += 2) px.v(x, 0, 2, '#efe6d3').v(x, h - 2, 2, '#efe6d3')
}

function wovenRug(): HTMLCanvasElement {
  const w = 4 * TILE
  const h = 3 * TILE
  const { canvas, px } = makeCanvas(w, h)
  const c = fabricAccent()
  fringe(px, w, h)
  px.r(2, 2, w - 4, h - 4, c.base)
  px.outlineRect(4, 4, w - 8, h - 8, '#efe6d3')
  px.outlineRect(6, 6, w - 12, h - 12, c.lo)
  // diamonds down the middle
  for (const cx of [w / 2 - 15, w / 2, w / 2 + 15]) {
    for (let i = 0; i <= 8; i++) {
      for (let k = -i; k <= i; k++) {
        const col = (i + Math.abs(k)) % 3 === 0 ? '#efe6d3' : (i + Math.abs(k)) % 3 === 1 ? c.hi : M.black.mid
        px.p(cx + k, h / 2 - 8 + i, col).p(cx + k, h / 2 + 8 - i, col)
      }
    }
  }
  for (let y = 3; y < h - 3; y += 2) px.alpha(0.08, () => px.h(2, y, w - 4, '#000000'))
  return canvas
}

function roundRug(): HTMLCanvasElement {
  const s = 3 * TILE
  const { canvas, px } = makeCanvas(s, s)
  const c = fabricAccent()
  const mid = s / 2
  px.alpha(0.2, () => px.ellipse(mid, mid + 1, mid - 1, mid - 1, '#000000'))
  const rings = [c.lo, c.base, '#efe6d3', c.mid, c.hi, c.base, '#efe6d3', c.lo]
  rings.forEach((col, i) => px.ellipse(mid, mid, mid - 1 - i * 3, mid - 1 - i * 3, col))
  px.ellipse(mid, mid, 1, 1, c.hi)
  return canvas
}

function stripeRug(): HTMLCanvasElement {
  const w = 5 * TILE
  const h = 2 * TILE
  const { canvas, px } = makeCanvas(w, h)
  const c = fabricAccent()
  fringe(px, w, h)
  const bands = [c.base, '#efe6d3', M.black.mid, c.hi, c.lo, '#efe6d3', c.base]
  let x = 2
  const each = Math.floor((w - 4) / 12)
  for (let i = 0; i < 12; i++) {
    px.r(x, 2, i === 11 ? w - 2 - x : each, h - 4, bands[i % bands.length])
    x += each
  }
  for (let y = 3; y < h - 3; y += 2) px.alpha(0.1, () => px.h(2, y, w - 4, '#000000'))
  return canvas
}

function checkRug(): HTMLCanvasElement {
  const w = 3 * TILE
  const h = 2 * TILE
  const { canvas, px } = makeCanvas(w, h)
  const c = fabricAccent()
  px.r(0, 0, w, h, c.lo)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) px.r(2 + x * 7.33, 2 + y * 7, 7.33, 7, (x + y) % 2 ? '#efe6d3' : c.base)
  for (let y = 3; y < h - 3; y += 2) px.alpha(0.07, () => px.h(2, y, w - 4, '#000000'))
  return canvas
}

export const DECOR_FACTORIES: Record<string, () => HTMLCanvasElement> = {
  'lamp:lantern': paperLantern,
  'lamp:arc': arcLamp,
  'lamp:mushroom': mushroomLamp,
  'decor:globe': globe,
  'decor:books': bookStack,
  'decor:crate': recordCrate,
  'decor:pouf': pouf,
  'decor:sign': standingSign,
  'decor:easel': easel,
  'rug:woven': wovenRug,
  'rug:round': roundRug,
  'rug:stripe': stripeRug,
  'rug:check': checkRug
}

// ── on the wall ──────────────────────────────────────────────

/** Where wall pieces hang: their top edge, in world pixels. */
export const WALL_TOP = 20

function frames(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(48, 34)
  const frame = (x: number, y: number, w: number, h: number, wood: Ramp, draw: (ix: number, iy: number, iw: number, ih: number) => void) => {
    px.alpha(0.22, () => px.r(x + 1, y + 1, w, h, '#000000'))
    px.r(x, y, w, h, wood.base).h(x, y, w, wood.hi).v(x, y, h, wood.hi).h(x, y + h - 1, w, wood.lo).v(x + w - 1, y, h, wood.lo)
    px.r(x + 2, y + 2, w - 4, h - 4, M.white.hi)
    draw(x + 3, y + 3, w - 6, h - 6)
  }
  frame(1, 2, 15, 19, M.walnut, (x, y, w, h) => {
    for (let k = 0; k < h; k++) px.h(x, y + k, w, mix('#f39c6b', '#1f3b5a', k / h))
    px.ellipse(x + 4, y + 7, 2, 2, '#ffe2a0')
    for (let i = 0; i < w; i++) px.v(x + i, y + h - 3 - (i % 3), 3 + i % 3, '#17181c')
  })
  frame(18, 8, 13, 13, M.black, (x, y, w, h) => {
    px.r(x, y, w, h, '#f3ede2')
    px.ellipse(x + 3, y + 3, 2, 2, M.terracotta.base)
    px.r(x + 3, y + 3, 4, 4, M.mustard.base)
    px.h(x, y + h - 1, w, M.slate.base)
  })
  frame(33, 3, 14, 11, M.oak, (x, y, w, h) => {
    px.r(x, y, w, h, '#cfe7ef')
    for (let i = 0; i < w; i++) px.v(x + i, y + 3 + Math.abs((i % 6) - 3), h, M.leaf.mid)
  })
  frame(33, 16, 9, 11, M.black, (x, y, w, h) => {
    px.r(x, y, w, h, '#fbfaf7')
    px.v(x + 1, y + 1, h - 2, M.leaf.mid)
    px.p(x, y + 1, M.leaf.hi).p(x + 2, y + 2, M.leaf.hi)
  })
  return canvas
}

function shelf(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 36)
  px.alpha(0.22, () => px.r(2, 22, 29, 3, '#000000'))
  px.r(1, 19, 30, 3, M.oak.base).h(1, 19, 30, M.oak.hi).h(1, 21, 30, M.oak.lo)
  for (const x of [5, 26]) px.v(x, 22, 3, M.black.mid)
  // books, a pot, a trailing vine
  const bk: [number, number, string][] = [
    [3, 12, M.slate.base],
    [5, 10, M.terracotta.base],
    [7, 13, M.mustard.base],
    [9, 11, M.sage.base]
  ]
  for (const [x, h, c] of bk) px.r(x, 19 - h, 2, h, c).v(x, 19 - h, h, shade(c, 0.2))
  px.r(21, 13, 7, 6, M.white.base).h(21, 13, 7, M.white.hi).v(27, 13, 6, M.white.lo)
  for (const [x, y, c] of [
    [22, 11, M.leaf.base],
    [24, 10, M.leaf.hi],
    [26, 11, M.leafDeep.base],
    [23, 12, M.leaf.mid],
    [25, 12, M.leaf.mid],
    [27, 13, M.leaf.base],
    [28, 15, M.leaf.mid],
    [29, 17, M.leaf.base],
    [29, 19, M.leafDeep.base],
    [30, 22, M.leaf.base],
    [29, 24, M.leaf.mid],
    [30, 27, M.leafDeep.base]
  ] as [number, number, string][]) px.r(x, y, 2, 2, c)
  px.r(14, 14, 5, 5, M.terracotta.mid).h(14, 14, 5, M.terracotta.hi)
  return canvas
}

function pennants(): HTMLCanvasElement {
  const w = 48
  const { canvas, px } = makeCanvas(w, 18)
  const c = fabricAccent()
  const sag = (x: number) => 2 + Math.round(Math.sin((x / (w - 1)) * Math.PI) * 4)
  const colors = [c.base, '#efe6d3', M.slate.base, c.hi, '#efe6d3', M.mustard.base]
  for (let i = 0; i < 6; i++) {
    const x0 = 2 + i * 8
    const top = sag(x0 + 3) + 1
    for (let y = 0; y < 8; y++) {
      const half = Math.max(0, 3 - Math.floor(y / 2.4))
      px.h(x0 + 3 - half, top + y, half * 2 + 1, y < 1 ? shade(colors[i], 0.14) : colors[i])
    }
  }
  for (let x = 0; x < w; x++) px.p(x, sag(x), M.walnut.lo)
  return canvas
}

function neon(color: string): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 34)
  const bolt: [number, number][] = [
    [19, 3],
    [11, 15],
    [17, 15],
    [12, 28],
    [23, 12],
    [17, 12],
    [22, 3]
  ]
  const trace = (r: number, c: string, a: number) =>
    px.alpha(a, () => {
      for (let i = 0; i < bolt.length; i++) {
        const [x0, y0] = bolt[i]
        const [x1, y1] = bolt[(i + 1) % bolt.length]
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
        for (let k = 0; k <= n; k++) {
          const x = Math.round(x0 + ((x1 - x0) * k) / n)
          const y = Math.round(y0 + ((y1 - y0) * k) / n)
          px.r(x - r, y - r, r * 2 + 1, r * 2 + 1, c)
        }
      }
    })
  trace(2, color, 0.18)
  trace(1, color, 0.55)
  trace(0, mix(color, '#ffffff', 0.72), 1)
  return canvas
}

function stringLights(color: string): HTMLCanvasElement {
  const w = 48
  const { canvas, px } = makeCanvas(w, 16)
  const sag = (x: number) => 2 + Math.round(Math.abs(Math.sin((x / (w - 1)) * Math.PI * 2)) * 4)
  for (let x = 0; x < w; x++) px.p(x, sag(x), M.black.mid)
  for (let i = 0; i < 8; i++) {
    const x = 3 + i * 6
    const y = sag(x) + 1
    px.p(x, y, M.black.base)
    px.alpha(0.3, () => px.r(x - 2, y + 1, 5, 5, color))
    px.r(x - 1, y + 1, 3, 3, color).p(x, y + 2, mix(color, '#ffffff', 0.75))
  }
  return canvas
}

function poster(kind: PosterKind): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(24, 31)
  paintPoster(px, 0, 0, kind)
  return canvas
}

/** Your picture, redrawn in the office's palette. Blank until you choose one. */
function picture(data: string): HTMLCanvasElement {
  const w = PICTURE_W + 4
  const h = PICTURE_H + 4
  const { canvas, px } = makeCanvas(w, h + 1)
  px.alpha(0.25, () => px.r(1, 1, w, h, '#000000'))
  px.r(0, 0, w, h, M.walnut.base).h(0, 0, w, M.walnut.hi).v(0, 0, h, M.walnut.hi).h(0, h - 1, w, M.walnut.lo).v(w - 1, 0, h, M.walnut.lo)
  if (data) {
    for (let y = 0; y < PICTURE_H; y++) {
      for (let x = 0; x < PICTURE_W; x++) px.p(2 + x, 2 + y, PICTURE_PALETTE[parseInt(data[y * PICTURE_W + x], 16)] ?? M.white.base)
    }
  } else {
    // an empty canvas on the wall, waiting
    px.r(2, 2, PICTURE_W, PICTURE_H, M.white.hi)
    px.ellipse(15, 8, 2, 2, M.mustard.hi)
    for (let i = 0; i < 12; i++) px.v(4 + i, 21 - Math.min(i, 11 - i), 3 + Math.min(i, 11 - i), M.sage.base)
  }
  return canvas
}

/** Your sign: a dark board with the words in the office's light. Stays narrower than the AUTOPIA wall on purpose. */
function sign(text: string, color: string): HTMLCanvasElement {
  const w = 4 * TILE
  const h = 20
  const { canvas, px } = makeCanvas(w, h + 1)
  px.alpha(0.25, () => px.r(1, 1, w - 1, h, '#000000'))
  px.r(0, 0, w - 1, h, PAL.void).outlineRect(0, 0, w - 1, h, M.walnut.mid)
  px.h(1, 1, w - 3, M.black.base)
  const words = text.trim() || 'AUTOPIA'
  const x = Math.round((w - 1 - textWidth(words)) / 2)
  px.alpha(0.3, () => drawText(px, words, x, 7, color))
  drawText(px, words, x, 6, mix(color, '#ffffff', 0.35))
  return canvas
}

export interface WallArtOptions {
  light: string
  picture: string
  sign: string
}

export function wallArt(key: string, o: WallArtOptions): HTMLCanvasElement {
  if (key === 'wall:frames') return frames()
  if (key === 'wall:shelf') return shelf()
  if (key === 'wall:pennants') return pennants()
  if (key === 'wall:neon') return neon(o.light)
  if (key === 'wall:string') return stringLights(o.light)
  if (key === 'wall:picture') return picture(o.picture)
  if (key === 'wall:sign') return sign(o.sign, o.light)
  return poster((key.split(':')[2] ?? 'grid') as PosterKind)
}
