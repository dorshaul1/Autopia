// The office corgi: a Pembroke Welsh Corgi (red-and-white) drawn in the office's 3/4 top-down style.
// Long low body, short legs with white socks, tall pointed ears, white blaze, cheek and chest fluff,
// and the famous fluffy white rump. Left-facing rows are drawn;
// right-facing rows are mirrored copies, like the team's sheets.

import { makeCanvas, selout, shade, type Px } from './px'

export const DOG_W = 26
export const DOG_H = 26
export const DOG_COLS = 4
/** Feet rest on this row of the cell. */
export const DOG_FEET = 24
/** Drawing origin inside a cell: room above for the tall ears, even mid-hop (ears -5, hop -3). */
const OY = 10

export const DOG_ROW = {
  walkL: 0,
  walkR: 1,
  walkDown: 2,
  walkUp: 3,
  runL: 4,
  runR: 5,
  sit: 6, // front: idle, head tilt, paw, blink
  lieL: 7, // lie, sleep, sleep (breath), on its back
  lieR: 8,
  actL: 9, // sniff, sniff (twitch), play bow, wiggle
  actR: 10,
  happy: 11 // front: hop, happy (tongue), look left, look right
} as const
const ROWS = 12

const F = { hi: '#f7bd6c', light: '#eda04b', base: '#d9822f', saddle: '#c66f27', shade: '#b05f21', deep: '#8a4719' }
const W = { hi: '#fdfaf3', base: '#f1e9dc', shade: '#d8cbb8' }
const C = { dark: '#22160f', nose: '#1a120e', shine: '#5a4a42', ear: '#eaa3a0', earLo: '#c27a78', tongue: '#ec6f7a', mouth: '#7a4a3a' }

type Pen = { p: (x: number, y: number, c: string) => void; r: (x: number, y: number, w: number, h: number, c: string) => void }
const pen = (px: Px, ox: number, oy: number): Pen => ({
  p: (x, y, c) => void px.p(ox + x, oy + y, c),
  r: (x, y, w, h, c) => void px.r(ox + x, oy + y, w, h, c)
})

/** A side-view leg: `furRows` rows of coat, then a white sock with a toe line. */
function leg(d: Pen, x: number, top: number, bottom: number, near: boolean, furRows: number, lifted = 0): void {
  const y0 = top - lifted
  const y1 = bottom - lifted
  for (let y = y0; y <= y1; y++) {
    const furry = y - y0 < furRows
    d.r(x, y, 2, 1, furry ? (near ? F.base : F.shade) : near ? W.base : W.shade)
  }
  d.p(x + 1, y1, near ? W.shade : F.deep)
}

interface SideOpts {
  step?: number
  run?: boolean
  sniff?: 0 | 1
  bow?: boolean
  wag?: -1 | 0 | 1
  bob?: number
}

/** Standing / walking / acting, facing left. Ground at y = 14. */
function side(px: Px, ox: number, oy: number, o: SideOpts = {}): void {
  const d = pen(px, ox, oy + (o.bob ?? 0))
  const bow = o.bow ? 1 : 0
  const wag = o.wag ?? 0
  const s = (o.step ?? 0) % 4
  const reach = o.run ? 2 : 1
  // leg swing: front and back pairs in opposite phase; running stretches them out
  const sw = [0, reach, 0, -reach][s]
  const lift = o.run ? [0, 1, 0, 1][s] : 0
  // far legs (behind the body) first
  leg(d, 6 - sw, 12 + bow, 14, false, 0, lift)
  leg(d, 17 + sw, 11 - bow, 14, false, 2)
  // body: long low loaf with a darker saddle and a soft belly shadow
  d.r(8, 6 + bow, 13, 6 - bow, F.base)
  d.r(9, 5 + bow, 11, 1, F.light)
  d.r(10, 5 + bow, 7, 1, F.hi)
  d.r(11, 6 + bow, 8, 2, F.saddle)
  d.r(12, 6 + bow, 5, 1, F.shade)
  d.r(9, 10, 10, 1, F.shade)
  // haunch: rounded thigh shading, then the white "pants" fluff on the rump
  d.r(18 + wag, 5 - bow, 4, 6, F.base)
  d.r(19 + wag, 5 - bow, 2, 1, F.light)
  d.p(18 + wag, 8 - bow, F.shade)
  d.p(18 + wag, 9 - bow, F.shade)
  d.r(20 + wag, 8 - bow, 3, 3, W.base)
  d.p(22 + wag, 8 - bow, W.hi)
  d.p(21 + wag, 11 - bow, W.shade)
  // little tail nub with a white tip
  d.p(22 + wag, 6 - bow, F.light)
  d.p(23 + wag, 5 - bow, W.hi)
  d.p(23 + wag, 6 - bow, W.base)
  // white belly line and tufted chest bib
  d.r(10, 11, 8, 1, W.base)
  d.p(11, 12, W.shade)
  d.p(14, 12, W.shade)
  d.r(5, 7 + bow, 4, 4, W.base)
  d.r(5, 7 + bow, 2, 2, W.hi)
  d.p(5, 11 + bow, W.base)
  d.p(7, 11, W.shade)
  d.p(4, 9 + bow, W.base)
  // near legs over the body
  leg(d, 8 + sw, 12, 14, true, 0, o.run ? 1 - lift : 0)
  leg(d, 19 - sw, 11 - bow, 14, true, 2)

  // head: lowered when sniffing or bowing
  const hy = (o.sniff !== undefined ? 3 : 0) + bow * 2
  const hx = o.sniff === 1 ? -1 : 0
  const h = pen(px, ox + hx, oy + (o.bob ?? 0) + hy)
  // neck: fur blending into the white chest
  h.r(7, 3, 2, 4, F.base)
  h.p(8, 3, F.shade)
  h.r(7, 6, 1, 2, W.base)
  // skull and cheek
  h.r(2, 1, 6, 6, F.base)
  h.r(3, 0, 4, 1, F.light)
  h.r(4, 1, 3, 1, F.hi)
  h.p(7, 2, F.shade)
  h.p(7, 3, F.shade)
  // white blaze on the forehead, white muzzle and cheek fluff
  h.r(2, 1, 1, 3, W.base)
  h.p(3, 2, W.hi)
  h.r(0, 4, 4, 3, W.base)
  h.r(0, 4, 2, 1, W.hi)
  h.r(4, 5, 3, 2, W.base)
  h.p(6, 6, W.shade)
  h.p(5, 7, W.base)
  // nose with a shine, mouth line, eye with a catchlight and a brow
  h.p(-1, 4, C.nose)
  h.p(0, 4, C.nose)
  h.p(-1, 3, C.shine)
  h.p(1, 6, C.mouth)
  h.p(2, 6, C.mouth)
  h.p(3, 3, C.dark)
  h.p(4, 3, C.dark)
  h.p(3, 2, W.hi)
  h.p(4, 2, F.shade)
  // tall pointed ears: near ear with a pink inside, far ear darker; swept back when running
  const back = o.run ? 1 : 0
  h.r(5 + back, -1, 3, 2, F.base)
  h.r(5 + back, -2, 2, 1, F.base)
  h.p(5 + back, -3, F.light)
  h.p(6 + back, -1, C.ear)
  h.p(6 + back, 0, C.earLo)
  h.r(7 + back, -1, 2, 2, F.shade)
  h.p(8 + back, -2, F.deep)
}

/** Lying down facing left: resting, asleep (two breathing frames), or rolled onto its back. */
function lie(px: Px, ox: number, oy: number, mode: 'rest' | 'sleep' | 'breath' | 'belly'): void {
  const d = pen(px, ox, oy)
  if (mode === 'belly') {
    // on its back: white belly up, folded legs with white paws, head on its side, ears flopped
    d.r(6, 9, 15, 5, F.base)
    d.r(7, 13, 13, 1, F.shade)
    d.r(7, 9, 13, 3, W.base)
    d.r(8, 9, 8, 1, W.hi)
    for (const [x, lean] of [[7, -1], [10, -1], [16, 0], [19, 0]] as const) {
      d.r(x, 7, 2, 2, F.base)
      d.p(x + 1, 8, F.shade)
      d.r(x + lean, 6, 2, 1, W.base)
    }
    d.r(21, 10, 2, 2, W.base)
    d.r(0, 10, 7, 5, F.base)
    d.r(0, 13, 5, 2, W.base)
    d.p(-1, 13, C.nose)
    d.p(2, 11, C.dark)
    d.p(1, 14, C.tongue)
    d.r(2, 15, 3, 1, F.shade)
    d.r(5, 15, 2, 1, C.ear)
    d.r(6, 9, 1, 3, F.base)
    return
  }
  const br = mode === 'breath' ? 1 : 0
  // a long loaf on the floor, white paws stretched forward
  d.r(7, 9 - br, 14, 5 + br, F.base)
  d.r(8, 8 - br, 12, 1, F.light)
  d.r(10, 9 - br, 8, 1, F.saddle)
  d.r(8, 13, 11, 1, F.shade)
  d.r(18, 10, 4, 4, W.base)
  d.p(21, 10, W.hi)
  d.p(22, 9 - br, W.base)
  d.r(-1, 13, 7, 2, W.base)
  d.p(2, 14, W.shade)
  d.p(5, 14, W.shade)
  // head resting low on the paws
  d.r(6, 8, 2, 4, F.base)
  d.p(7, 8, F.light)
  d.r(1, 7, 6, 6, F.base)
  d.r(2, 6, 4, 1, F.light)
  d.r(0, 10, 4, 3, W.base)
  d.r(3, 11, 3, 2, W.base)
  d.p(1, 7, W.base)
  d.p(-1, 10, C.nose)
  d.p(-1, 9, C.shine)
  if (mode === 'rest') {
    d.p(2, 8, C.dark)
    d.p(3, 8, C.dark)
    d.p(2, 7, W.hi)
  } else d.r(2, 9, 2, 1, F.deep) // closed eye
  d.r(4, 4, 3, 2, F.base)
  d.p(4, 3, F.light)
  d.p(5, 5, C.ear)
  d.r(6, 4, 2, 2, F.shade)
}

interface FrontOpts {
  sit?: boolean
  step?: number
  tilt?: boolean
  paw?: boolean
  blink?: boolean
  tongue?: boolean
  look?: -1 | 1
  hop?: boolean
}

/** Facing the viewer: walking down, sitting, and happy reactions. Centre x = 13. */
function front(px: Px, ox: number, oy: number, o: FrontOpts = {}): void {
  const d = pen(px, ox, oy + (o.hop ? -3 : 0))
  const s = (o.step ?? 0) % 4
  // body and chest
  if (o.sit) {
    d.r(7, 11, 3, 3, F.base) // haunches
    d.r(16, 11, 3, 3, F.base)
    d.p(7, 13, F.shade)
    d.p(18, 13, F.shade)
    d.r(7, 14, 3, 1, W.base) // back paws
    d.r(16, 14, 3, 1, W.base)
  }
  d.r(9, 8, 8, 6, F.base)
  d.p(9, 9, F.light)
  d.p(16, 10, F.shade)
  d.r(10, 8, 6, 6, W.base)
  d.r(11, 8, 3, 3, W.hi)
  // chest tufts
  d.p(10, 13, W.shade)
  d.p(15, 13, W.shade)
  d.p(12, 13, W.shade)
  // front legs: short white columns with toe lines (one raised for a paw)
  const la = o.sit ? 0 : [0, -1, 0, 0][s]
  const lb = o.sit ? 0 : [0, 0, 0, -1][s]
  const legH = o.hop ? 2 : 3
  d.r(10, 12 + la, 2, legH, W.base)
  d.p(10, 11 + legH + la, W.shade)
  if (o.paw) {
    d.r(14, 9, 2, 3, W.base)
    d.p(14, 9, W.hi)
  } else {
    d.r(14, 12 + lb, 2, legH, W.base)
    d.p(15, 11 + legH + lb, W.shade)
  }
  // neck: white ruff under the chin
  d.r(9, 7, 8, 1, F.base)
  d.r(11, 7, 4, 1, W.base)
  // head (tilted: one pixel lower, one ear dropping)
  const t = o.tilt ? 1 : 0
  const h = pen(px, ox, oy + (o.hop ? -3 : 0) + t)
  h.r(8, 0, 10, 7, F.base)
  h.r(9, -1, 8, 1, F.light)
  h.r(10, 0, 2, 1, F.hi)
  h.p(8, 5, F.shade)
  h.p(17, 5, F.shade)
  // white blaze widening into the muzzle; white cheeks
  h.r(12, -1, 2, 4, W.base)
  h.p(12, 0, W.hi)
  h.r(10, 4, 6, 3, W.base)
  h.r(11, 4, 4, 1, W.hi)
  h.p(8, 6, W.base)
  h.p(17, 6, W.base)
  // nose and mouth
  h.r(12, 4, 2, 1, C.nose)
  h.p(12, 4, C.shine)
  h.p(12, 6, C.mouth)
  h.p(13, 6, C.mouth)
  if (o.tongue) {
    h.r(12, 6, 2, 2, C.tongue)
    h.p(13, 7, '#c9545e')
  }
  // eyes: 2×2 with a catchlight, or closed
  const ex = o.look ?? 0
  for (const x of [9, 15]) {
    if (o.blink) h.r(x, 3, 2, 1, F.deep)
    else {
      h.r(x, 2, 2, 2, C.dark)
      h.p(x + (ex > 0 ? 1 : 0), 2, W.hi)
    }
  }
  // tall ears with pink insides
  const drop = o.tilt ? 1 : 0
  h.r(8, -3 + drop, 3, 3, F.base)
  h.p(8, -4 + drop, F.base)
  h.p(9, -2 + drop, C.ear)
  h.p(9, -1 + drop, C.earLo)
  h.r(15, -3, 3, 3, F.base)
  h.p(17, -4, F.base)
  h.p(16, -2, C.ear)
  h.p(16, -1, C.earLo)
}

/** Walking away from the viewer: the fluffy white heart-shaped rump. */
function back(px: Px, ox: number, oy: number, step: number): void {
  const d = pen(px, ox, oy)
  const la = [0, -1, 0, 0][step % 4]
  const lb = [0, 0, 0, -1][step % 4]
  d.r(9, 12 + la, 2, 3, W.base)
  d.p(10, 14 + la, W.shade)
  d.r(15, 12 + lb, 2, 3, W.base)
  d.p(15, 14 + lb, W.shade)
  d.r(8, 5, 10, 8, F.base)
  d.r(9, 4, 8, 1, F.light)
  d.r(11, 5, 4, 3, F.saddle)
  d.r(10, 5, 1, 2, F.shade)
  d.r(15, 5, 1, 2, F.shade)
  // the heart: two white lobes with a crease, tail nub on top
  d.r(9, 9, 4, 4, W.base)
  d.r(13, 9, 4, 4, W.base)
  d.p(9, 9, F.base)
  d.p(16, 9, F.base)
  d.p(13, 12, W.shade)
  d.p(12, 12, W.shade)
  d.r(10, 9, 2, 1, W.hi)
  d.r(12, 8, 2, 1, F.light)
  d.p(12, 7, W.hi)
  // the back of the head with its ears
  d.r(9, 3, 8, 1, F.base)
  d.r(9, -1, 8, 4, F.base)
  d.r(10, -2, 6, 1, F.light)
  d.r(8, -4, 3, 3, F.base)
  d.p(8, -5, F.base)
  d.p(10, -3, F.shade)
  d.r(15, -4, 3, 3, F.base)
  d.p(17, -5, F.base)
  d.p(15, -3, F.shade)
}

/** The corgi's full sheet. */
export function corgiSheet(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(DOG_W * DOG_COLS, DOG_H * ROWS)
  const at = (col: number, row: number) => [col * DOG_W + 1, row * DOG_H + OY] as const
  for (let i = 0; i < 4; i++) side(px, ...at(i, DOG_ROW.walkL), { step: i, bob: i % 2 })
  for (let i = 0; i < 4; i++) front(px, ...at(i, DOG_ROW.walkDown), { step: i })
  for (let i = 0; i < 4; i++) back(px, ...at(i, DOG_ROW.walkUp), i)
  for (let i = 0; i < 4; i++) side(px, ...at(i, DOG_ROW.runL), { step: i, run: true, bob: i % 2 ? -1 : 0 })
  ;[{}, { tilt: true }, { paw: true }, { blink: true }].forEach((o, i) => front(px, ...at(i, DOG_ROW.sit), { sit: true, ...o }))
  ;(['rest', 'sleep', 'breath', 'belly'] as const).forEach((m, i) => lie(px, ...at(i, DOG_ROW.lieL), m))
  ;[{ sniff: 0 as const }, { sniff: 1 as const }, { bow: true, wag: 1 as const }, { wag: -1 as const }].forEach((o, i) => side(px, ...at(i, DOG_ROW.actL), o))
  ;[{ hop: true, tongue: true }, { sit: true, tongue: true }, { sit: true, look: -1 as const }, { sit: true, look: 1 as const }].forEach((o, i) =>
    front(px, ...at(i, DOG_ROW.happy), o)
  )
  for (const row of [DOG_ROW.walkL, DOG_ROW.walkDown, DOG_ROW.walkUp, DOG_ROW.runL, DOG_ROW.sit, DOG_ROW.lieL, DOG_ROW.actL, DOG_ROW.happy]) {
    for (let col = 0; col < DOG_COLS; col++) selout(px, col * DOG_W, row * DOG_H, DOG_W, DOG_H, 0.5)
  }
  // right-facing rows are mirrors of the left-facing ones
  const ctx = px.ctx
  for (const [from, to] of [
    [DOG_ROW.walkL, DOG_ROW.walkR],
    [DOG_ROW.runL, DOG_ROW.runR],
    [DOG_ROW.lieL, DOG_ROW.lieR],
    [DOG_ROW.actL, DOG_ROW.actR]
  ]) {
    for (let col = 0; col < DOG_COLS; col++) {
      ctx.save()
      ctx.translate((col + 1) * DOG_W, to * DOG_H)
      ctx.scale(-1, 1)
      ctx.drawImage(canvas, col * DOG_W, from * DOG_H, DOG_W, DOG_H, 0, 0, DOG_W, DOG_H)
      ctx.restore()
    }
  }
  return canvas
}

export const dogFrame = (row: number, col: number) => row * DOG_COLS + col

/** A round dog bed: plush rim, soft cushion with a little paw print. */
export function dogBed(rim = '#6f7ea2'): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(32, 16)
  px.ellipse(16, 9, 15, 6, shade(rim, -0.28))
  px.ellipse(16, 8, 14, 5, rim)
  px.h(6, 4, 20, shade(rim, 0.22))
  px.ellipse(16, 9, 11, 3, '#c9bfae')
  px.ellipse(16, 9, 10, 2, '#ddd4c6')
  px.p(15, 9, '#c9bfae').p(17, 9, '#c9bfae').p(16, 10, '#c9bfae')
  selout(px, 0, 0, 32, 16, 0.5)
  return canvas
}

export function waterBowl(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(10, 6)
  px.ellipse(5, 3, 4, 2, '#3f7fd0')
  px.ellipse(5, 2, 3, 1, '#9fd3f5')
  px.p(4, 2, '#e8f6ff')
  px.h(2, 5, 6, '#2d5e9e')
  selout(px, 0, 0, 10, 6, 0.5)
  return canvas
}

/** A red rubber ball with a white stripe. */
export function toyBall(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(5, 5)
  px.ellipse(2, 2, 2, 2, '#e04f5f')
  px.h(0, 2, 5, '#f8f2e8')
  px.p(1, 1, '#f59aa2')
  return canvas
}

/** A chew bone. */
export function toyBone(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(9, 5)
  px.r(2, 1, 5, 3, '#f3ecdc').h(2, 3, 5, '#cfc4ad')
  for (const x of [0, 7]) px.r(x, 0, 2, 2, '#f3ecdc').r(x, 3, 2, 2, '#e0d6c1')
  px.p(0, 0, '#fffaf0').p(7, 0, '#fffaf0')
  return canvas
}

/** A rubber duck: the debugging kind, slightly chewed. */
export function toyDuck(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(7, 6)
  px.r(1, 3, 6, 3, '#ffd23f').h(1, 5, 6, '#e8b21f').r(2, 0, 3, 3, '#ffd23f').p(3, 1, '#251a18').p(0, 1, '#f28c28').p(1, 1, '#f28c28').p(6, 3, '#fff1a8')
  return canvas
}

/** A knotted rope. */
export function toyRope(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(10, 5)
  for (let x = 2; x < 8; x++) px.p(x, 2, x % 2 ? '#c9a06a' : '#e6c795').p(x, 3, x % 2 ? '#a97f4b' : '#c9a06a')
  for (const x of [0, 8]) px.r(x, 1, 2, 3, '#d9534f').p(x, 1, '#f08a84').p(x + 1, 3, '#a93c39')
  return canvas
}

export const TOY_ART = { ball: toyBall, bone: toyBone, duck: toyDuck, rope: toyRope }
