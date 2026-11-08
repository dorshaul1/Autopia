// The Game Studio's art pack: its own materials (night walnut, graphite, plum fabric, neon), its own
// signature pieces (pinball, claw machine, mascot statue, trophy case, rhythm game, devkit bench, …),
// and its floors and north wall. Shared pieces are the original drawings recoloured through the
// studio's material map, so their detail, light and the scene's anchor points are unchanged.
// Same projection, scale, light and outline rules as everything else (docs/ART_DIRECTION.md).

import { COLS, ENTRANCE, FEATURE_WALL, PLACEMENTS, ROWS, TILE, WALL_DECOR, WALLS, WORLD_H, WORLD_W, ZONES, type Rect } from '../layout'
import { CAP_TOP, FACE_BOTTOM, FACE_TOP, carpetTiles, chevron, contactShadow, doorMat, hash, oakPlanks, paintPoster, polishedConcrete, px0, rug, stoneTiles, wallColumnFloors, windowSpan, type FeatureStyle } from './environment'
import { M, PAL, type Ramp } from './palette'
import { Px, block, drawText, makeCanvas, mix, rng, selout, shade } from './px'
import { ramp, recolor, type MaterialMap } from './recolor'

const finish = (px: Px, w: number, h: number) => selout(px, 0, 0, w, h, 0.5)

// ── materials ──────────────────────────────────────────────────────

export const S = {
  /** Deep walnut for floors and desk tops. */
  night: ramp('#6b4a3c', '#583b30', '#472f27', '#33211b'),
  /** Graphite for cabinets and fronts (the studio's "white"). */
  graphite: ramp('#4d4a5c', '#3d3a4a', '#302d3b', '#221f2a'),
  /** Plum fabric and felt. */
  plum: ramp('#a067ad', '#81498c', '#663872', '#482653'),
  /** Teal-ink fabric. */
  ink: ramp('#3f7d8c', '#2f6270', '#244d59', '#183740'),
  /** Brushed gunmetal frames. */
  gun: ramp('#8a8f9c', '#6c7180', '#565a67', '#3c3f4a'),
  carpet: ramp('#3b3450', '#2f2943', '#262138', '#1b1729'),
  tile: ramp('#4a4756', '#3a3745', '#2f2c39', '#22202a'),
  wall: ramp('#3a3446', '#302b3b', '#28232f', '#1e1a24')
}

/** Neon accents: emissive, used sparingly on signs, LEDs and screens. */
export const NEON = { pink: '#ff4fa3', cyan: '#4fe3ff', lime: '#b6ff5a', violet: '#9b7bff', amber: '#ffb347' }

/** How shared pieces become studio pieces. */
export const STUDIO_MAP: MaterialMap = [
  [M.oak, S.night],
  [M.oakFloor, S.night],
  [M.birch, ramp('#8a6450', '#73513f', '#5e4133', '#433026')],
  [M.white, S.graphite],
  [M.plaster, S.graphite],
  [M.stone, S.tile],
  [M.steel, S.gun],
  [M.forest, S.plum],
  [M.sage, S.ink]
]

export const studioRecolor = (c: HTMLCanvasElement) => recolor(c, STUDIO_MAP)

/** The arcade's table: deep violet top with glowing cyan lines (same drawing and paddle anchors). */
const GLOW_TABLE: MaterialMap = [
  [ramp('#4b7cc4', '#2f5fa8', '#244a85', '#1b3766'), ramp('#5a3f8f', '#3f2b6e', '#322257', '#231842')],
  [ramp('#f4f6f9', '#eef1f5', '#dfe6ef', '#c9d1dc'), ramp('#c9fbff', '#7ff0ff', '#4fe3ff', '#2bb5cc')]
]
export const glowTable = (c: HTMLCanvasElement) => recolor(recolor(c, GLOW_TABLE, 30), STUDIO_MAP)

// ── workstation: the studio rig ────────────────────────────────────

/** The studio's desk: the original desk in studio materials, with an RGB underglow and a controller. */
export function rigDesk(base: HTMLCanvasElement): HTMLCanvasElement {
  const c = studioRecolor(base)
  const px = new Px(c.getContext('2d')!)
  const top = 17
  // RGB underglow along the front edge
  const glow = [NEON.pink, NEON.violet, NEON.cyan]
  for (let x = 3; x < 45; x++) px.p(x, top + 23, glow[Math.floor((x - 3) / 14) % 3])
  px.alpha(0.35, () => {
    for (let x = 3; x < 45; x++) px.p(x, top + 24, glow[Math.floor((x - 3) / 14) % 3])
  })
  // a controller beside the keyboard
  px.r(5, top + 12, 6, 3, '#26232e').p(5, top + 12, '#3a3646').p(10, top + 12, '#3a3646')
  px.p(6, top + 13, NEON.cyan).p(9, top + 13, NEON.pink)
  return c
}

/** A gaming chair: high bucket back with a coloured stripe, seen from behind. */
export function gamingChair(away: boolean, base: HTMLCanvasElement): HTMLCanvasElement {
  const c = studioRecolor(base)
  const px = new Px(c.getContext('2d')!)
  const y0 = away ? 11 : 12
  // taller headrest and racing stripes
  px.round(5, y0 - 4, 6, 5, M.black.base).h(6, y0 - 4, 4, M.black.hi)
  px.v(6, y0 - 3, 8, NEON.pink).v(9, y0 - 3, 8, NEON.pink)
  px.alpha(0.6, () => px.v(7, y0 - 3, 8, shade(NEON.pink, -0.4)))
  return c
}

// ── signature pieces ───────────────────────────────────────────────

/** A tall speaker tower with a glowing ring. 1×1. */
function speaker(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(14, 36)
  block(px, 1, 2, 12, 3, 30, M.black)
  for (const [cy, r] of [
    [12, 4],
    [24, 5]
  ] as const) {
    px.ellipse(7, cy, r, r, M.black.lo).ellipse(7, cy, r - 1, r - 1, '#1b1c22').p(7, cy, M.black.hi)
    px.alpha(0.8, () => px.ellipse(7, cy, r, r, NEON.violet).ellipse(7, cy, r - 1, r - 1, '#1b1c22'))
  }
  px.p(7, 5, NEON.cyan)
  finish(px, 14, 36)
  return canvas
}

/** Merch and collectibles shelf: plushies, boxed games, an artbook stack. 3×1. */
function merchShelf(): HTMLCanvasElement {
  const w = 48
  const h = 42
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 4, w, 3, 34, S.graphite)
  for (const sy of [16, 27]) px.h(1, sy, w - 2, S.graphite.lo).h(1, sy + 1, w - 2, S.graphite.hi)
  const R = rng(7)
  // top: boxed games
  for (let x = 3; x < 44; x += 6) {
    const c = [NEON.pink, '#3a6fe0', '#e8833a', '#1fa3a3', NEON.violet, '#e04f5f', '#ffd23f'][Math.floor(R() * 7)]
    px.r(x, 9, 5, 7, c).h(x, 9, 5, shade(c, 0.25)).r(x + 1, 11, 3, 2, shade(c, -0.35))
  }
  // middle: plushies (blob heroes with eyes)
  for (const [x, c] of [
    [4, '#7bd389'],
    [14, NEON.pink],
    [25, '#5fb7ff'],
    [36, '#ffd166']
  ] as const) {
    px.ellipse(x + 4, 23, 4, 4, c).ellipse(x + 4, 21, 3, 2, shade(c, 0.2))
    px.p(x + 3, 22, '#1b1c22').p(x + 5, 22, '#1b1c22')
  }
  // bottom: artbooks
  for (let x = 3; x < 45; ) {
    const bw = 2 + Math.floor(R() * 3)
    const c = [S.plum.base, S.ink.base, M.mustard.base, '#2b2e38', M.terracotta.base][Math.floor(R() * 5)]
    px.r(x, 30, bw, 7, c).v(x, 30, 7, shade(c, 0.2))
    x += bw + 1
  }
  finish(px, w, h)
  return canvas
}

/** A glass display case with a hero figurine. 1×1 (rearrangeable). */
function figureStand(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 30)
  block(px, 2, 20, 12, 2, 7, S.graphite)
  px.alpha(0.3, () => px.r(3, 4, 10, 16, M.glass.base))
  px.outlineRect(2, 3, 12, 18, S.gun.mid)
  // the figure: a caped hero with a sword
  px.r(7, 9, 3, 4, '#5fb7ff').r(7, 7, 3, 2, '#f1c9a5').r(6, 9, 1, 6, NEON.pink).r(10, 9, 1, 6, NEON.pink)
  px.r(7, 13, 1, 4, '#2b2e38').r(9, 13, 1, 4, '#2b2e38').v(11, 6, 6, M.steel.hi)
  px.alpha(0.5, () => px.v(4, 5, 12, '#ffffff'))
  px.h(4, 19, 8, NEON.amber)
  finish(px, 16, 30)
  return canvas
}

/** A claw machine: glass box of plushies, gantry claw, marquee lights. 2×1. */
function clawMachine(): HTMLCanvasElement {
  const w = 30
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, w - 2, 6, NEON.pink).h(1, 2, w - 2, shade(NEON.pink, 0.35))
  for (let x = 3; x < w - 3; x += 3) px.p(x, 5, '#fff4d9')
  drawText(px, 'CLAW', 7, 3, '#2a1f3d')
  px.r(1, 8, w - 2, 22, '#2a1f3d')
  px.alpha(0.28, () => px.r(3, 9, w - 6, 20, M.glass.base))
  // gantry and claw
  px.h(3, 10, w - 6, S.gun.base).v(16, 10, 6, S.gun.mid).p(15, 16, M.steel.hi).p(17, 16, M.steel.hi).p(14, 17, M.steel.hi).p(18, 17, M.steel.hi)
  // plush pile
  for (const [x, y, c] of [
    [5, 25, '#ffd166'],
    [10, 24, '#7bd389'],
    [16, 25, '#5fb7ff'],
    [21, 24, NEON.pink],
    [8, 22, NEON.violet],
    [19, 21, '#e8833a']
  ] as const) {
    px.ellipse(x, y, 3, 3, c).p(x - 1, y - 1, '#1b1c22').p(x + 1, y - 1, '#1b1c22')
  }
  px.alpha(0.55, () => {
    for (let i = 0; i < 9; i++) px.p(5 + i, 27 - i, '#ffffff')
  })
  // control deck and prize door
  block(px, 1, 30, w - 2, 4, 12, M.black)
  px.r(6, 32, 2, 2, NEON.lime).p(7, 31, '#fff').r(19, 32, 4, 2, '#e04f5f')
  px.r(10, 38, 10, 4, '#1b1c22').h(10, 38, 10, S.gun.base)
  finish(px, w, h)
  return canvas
}

/** An easel holding a concept painting (a moonlit castle). 1×1. */
function easel(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 38)
  px.v(3, 6, 30, S.night.base).v(12, 6, 30, S.night.base).v(8, 2, 34, S.night.mid)
  px.h(3, 26, 10, S.night.hi)
  px.r(1, 6, 14, 18, '#f4ecdf')
  px.r(2, 7, 12, 16, '#2a3a66')
  px.r(2, 15, 12, 8, '#3b4e86').r(2, 19, 12, 4, '#1f3a2e')
  px.r(6, 12, 3, 7, '#151d33').p(6, 11, '#151d33').p(8, 11, '#151d33').r(9, 14, 2, 5, '#151d33')
  px.ellipse(11, 9, 1, 1, '#fff4d9').p(4, 9, '#cfe3ff').p(7, 8, '#cfe3ff')
  px.p(7, 14, NEON.amber)
  px.r(4, 25, 3, 2, NEON.pink).r(9, 25, 2, 2, '#5fb7ff')
  finish(px, 16, 38)
  return canvas
}

/** Devkit workbench: dev consoles, controllers, a soldering station and cable reels. 3×1. */
function devkitBench(): HTMLCanvasElement {
  const w = 48
  const h = 32
  const { canvas, px } = makeCanvas(w, h)
  block(px, 1, 8, w - 2, 12, 4, S.night)
  px.r(3, 24, 2, 6, M.black.base).r(w - 5, 24, 2, 6, M.black.base).h(5, 27, w - 10, M.black.mid)
  // two devkits with status LEDs
  for (const x of [4, 16]) {
    px.r(x, 9, 10, 5, '#1b1c22').h(x, 9, 10, '#2b2c34').p(x + 8, 11, NEON.lime).p(x + 6, 11, x === 4 ? NEON.cyan : NEON.amber)
  }
  // controllers
  for (const [x, c] of [
    [6, '#e8e8ea'],
    [18, '#2b2e38']
  ] as const) px.r(x, 16, 6, 3, c).p(x + 1, 17, NEON.pink).p(x + 4, 17, NEON.cyan)
  // soldering station and a spool
  px.r(30, 11, 7, 6, '#2a2c33').r(31, 12, 4, 2, '#e04f5f').v(38, 9, 7, M.steel.mid).p(38, 8, '#ffd166')
  px.ellipse(42, 15, 3, 3, '#e8833a').p(42, 15, M.black.base)
  // a dangling cable
  for (let x = 12; x < 30; x++) px.p(x, 20 + Math.round(Math.sin(x / 3)), M.black.lo)
  finish(px, w, h)
  return canvas
}

/** Trophy case: gold cups, a crystal award and framed plaques behind glass. 2×1. */
function trophyCase(): HTMLCanvasElement {
  const w = 32
  const h = 44
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 4, w, 3, 37, S.night)
  px.r(2, 8, w - 4, 30, '#1f1a24')
  for (const sy of [19, 29]) px.h(2, sy, w - 4, S.gun.mid)
  // top shelf: cups
  for (const [x, c] of [
    [5, M.mustard],
    [14, M.mustard],
    [23, ramp('#e9eef2', '#c2c8cf', '#9ea5ae', '#727982')]
  ] as const) {
    px.r(x, 11, 5, 4, c.base).h(x, 11, 5, c.hi).p(x - 1, 12, c.mid).p(x + 5, 12, c.mid).r(x + 2, 15, 1, 2, c.mid).r(x + 1, 17, 3, 1, c.lo)
  }
  // middle: a crystal award and a plaque
  px.r(6, 21, 4, 6, '#bfe6f5').p(7, 21, '#ffffff').r(5, 27, 6, 1, S.gun.base)
  px.r(15, 21, 11, 7, S.night.mid).r(16, 22, 9, 5, M.mustard.mid).h(17, 24, 7, S.night.lo)
  // bottom: framed game-of-the-year poster
  px.r(6, 31, 20, 6, '#2a1f3d').r(7, 32, 18, 4, '#3a6fe0').p(12, 33, NEON.pink).p(19, 34, '#ffd166')
  px.alpha(0.25, () => px.r(2, 8, w - 4, 30, M.glass.base))
  px.alpha(0.5, () => {
    for (let i = 0; i < 14; i++) px.p(5 + i, 36 - i * 2, '#ffffff')
  })
  finish(px, w, h)
  return canvas
}

/** The studio mascot: a round pixel hero with a little sword, on a plinth with a neon ring. 2×2. */
function mascot(): HTMLCanvasElement {
  const w = 32
  const h = 50
  const { canvas, px } = makeCanvas(w, h)
  // plinth
  block(px, 4, 34, 24, 4, 9, S.graphite)
  px.h(4, 42, 24, NEON.cyan)
  px.alpha(0.4, () => px.h(4, 43, 24, NEON.cyan))
  drawText(px, 'HERO', 5, 37, '#cfd3dc')
  // body: a bean with a hood, big eyes, a scarf
  px.ellipse(16, 22, 10, 11, '#7bd389').ellipse(15, 19, 8, 7, '#9be3a6')
  px.ellipse(16, 31, 9, 3, '#5aa86a')
  px.r(11, 19, 3, 4, '#1b1c22').r(18, 19, 3, 4, '#1b1c22').p(12, 19, '#ffffff').p(19, 19, '#ffffff')
  px.h(8, 26, 16, NEON.pink).h(8, 27, 16, shade(NEON.pink, -0.3)).r(20, 27, 3, 4, NEON.pink)
  // sword raised
  px.v(27, 8, 16, M.steel.hi).v(28, 8, 16, M.steel.mid).h(25, 22, 6, M.mustard.base).r(27, 23, 2, 4, S.night.base)
  px.p(27, 7, '#ffffff')
  finish(px, w, h)
  return canvas
}

/** A standing neon sign: a pink "PLAY" arrow on a black stand. 1×1. */
function neonPlay(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 42)
  px.v(7, 18, 22, M.black.base).h(3, 40, 10, M.black.base)
  px.r(1, 2, 14, 16, '#16141b')
  for (let i = 0; i < 6; i++) px.v(4 + i, 5 + i, 10 - i * 2, NEON.pink)
  px.alpha(0.5, () => {
    for (let i = 0; i < 6; i++) px.v(4 + i, 4 + i, 12 - i * 2, shade(NEON.pink, 0.4))
  })
  px.outlineRect(1, 2, 14, 16, NEON.violet)
  return canvas
}

/** A second arcade cabinet: cyan sci-fi shooter. 1×2. */
function arcadeB(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 48)
  px.r(1, 2, 14, 44, '#14243a').v(1, 2, 44, '#1e3656').v(14, 2, 44, '#0d1726')
  px.r(2, 3, 12, 5, NEON.cyan).h(2, 3, 12, '#aef3ff')
  drawText(px, 'R', 6, 3, '#0d1726')
  px.r(3, 10, 10, 9, '#060a14')
  for (let i = 0; i < 5; i++) px.p(4 + i * 2, 11 + ((i * 3) % 6), '#ffffff')
  px.r(7, 16, 2, 2, NEON.lime).p(8, 15, NEON.lime).p(5, 12, '#e04f5f')
  px.r(2, 20, 12, 4, '#1e3656').p(4, 21, NEON.pink).p(9, 21, '#ffd23f').v(6, 20, 2, M.black.base)
  px.r(2, 25, 12, 19, '#14243a').r(6, 32, 4, 3, M.black.base).p(7, 33, NEON.cyan)
  px.r(1, 44, 14, 2, M.black.base)
  finish(px, 16, 48)
  return canvas
}

/** A pinball machine: lit backbox and a sloped playfield with flippers and bumpers. 1×2. */
function pinball(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 44)
  // backbox
  px.r(1, 1, 14, 13, '#2a1f3d').r(2, 2, 12, 10, '#3b1e5a')
  px.ellipse(8, 7, 4, 3, NEON.violet).p(8, 6, '#ffffff')
  drawText(px, 'P', 6, 4, '#fff4d9')
  px.v(7, 14, 4, M.black.base).v(8, 14, 4, M.black.base)
  // playfield (lit top plane) with rails
  px.r(1, 18, 14, 18, '#20203a').outlineRect(1, 18, 14, 18, S.gun.mid)
  px.ellipse(5, 22, 2, 2, NEON.pink).ellipse(11, 23, 2, 2, NEON.cyan).ellipse(8, 27, 1, 1, '#ffd166')
  px.h(4, 33, 3, M.white.hi).h(9, 33, 3, M.white.hi).p(8, 30, M.steel.hi)
  px.alpha(0.25, () => px.r(2, 19, 12, 16, M.glass.base))
  // cabinet front and legs
  px.r(1, 36, 14, 4, '#2a1f3d').h(1, 36, 14, '#3b2d55')
  px.r(2, 40, 2, 4, M.black.base).r(12, 40, 2, 4, M.black.base)
  finish(px, 16, 44)
  return canvas
}

/** A VR headset on a stand, with two controllers. 1×1. */
function vrStand(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 36)
  px.v(7, 14, 20, M.black.base).v(8, 14, 20, M.black.mid).h(3, 34, 10, M.black.base)
  px.round(2, 8, 12, 7, '#e8e8ea').h(3, 8, 10, '#ffffff').r(3, 10, 10, 3, '#26232e')
  px.p(5, 11, NEON.cyan).p(10, 11, NEON.cyan)
  px.h(2, 7, 12, M.black.base)
  px.r(2, 20, 3, 5, '#2b2e38').p(3, 19, NEON.pink).r(11, 20, 3, 5, '#2b2e38').p(12, 19, NEON.pink)
  finish(px, 16, 36)
  return canvas
}

/** A rhythm game: tall screen cabinet behind a glowing four-arrow dance pad. 3×2. */
function danceMachine(): HTMLCanvasElement {
  const w = 48
  const h = 52
  const { canvas, px } = makeCanvas(w, h)
  // cabinet with speakers and a marquee
  px.r(8, 1, 32, 9, NEON.violet).h(8, 1, 32, shade(NEON.violet, 0.35))
  drawText(px, 'STEP', 13, 2, '#16141b')
  px.r(8, 10, 32, 20, '#16141b').r(10, 12, 28, 13, '#070912')
  for (const [x, c] of [
    [13, NEON.pink],
    [19, NEON.cyan],
    [25, NEON.lime],
    [31, NEON.amber]
  ] as const) {
    px.r(x, 12, 3, 3, c)
    px.alpha(0.5, () => px.r(x, 18, 3, 3, c))
  }
  px.r(2, 8, 6, 22, '#26232e').r(40, 8, 6, 22, '#26232e')
  px.ellipse(5, 16, 2, 2, '#121117').ellipse(43, 16, 2, 2, '#121117')
  // the pad: lit top plane with four arrows
  block(px, 4, 32, 40, 16, 3, ramp('#3a3646', '#2e2a38', '#26232e', '#1b1923'))
  const arrow = (cx: number, cy: number, dx: number, dy: number, c: string) => {
    for (let i = 0; i < 4; i++) px.h(cx - i * Math.abs(dy) - (dx ? 0 : 0), cy + i * dy, 1 + 2 * i * Math.abs(dy), c)
    for (let i = 0; i < 4; i++) px.v(cx + i * dx, cy - i * Math.abs(dx), 1 + 2 * i * Math.abs(dx), c)
  }
  arrow(24, 34, 0, 1, NEON.pink)
  arrow(24, 46, 0, -1, NEON.cyan)
  arrow(10, 40, 1, 0, NEON.lime)
  arrow(38, 40, -1, 0, NEON.amber)
  px.outlineRect(4, 32, 40, 16, NEON.violet)
  finish(px, w, h)
  return canvas
}

export const STUDIO_FACTORIES: Record<string, () => HTMLCanvasElement> = {
  'gs:speaker': speaker,
  'gs:merchShelf': merchShelf,
  'gs:figureStand': figureStand,
  'gs:clawMachine': clawMachine,
  'gs:easel': easel,
  'gs:devkitBench': devkitBench,
  'gs:trophyCase': trophyCase,
  'gs:mascot': mascot,
  'gs:neonPlay': neonPlay,
  'gs:arcadeB': arcadeB,
  'gs:pinball': pinball,
  'gs:vrStand': vrStand,
  'gs:danceMachine': danceMachine
}

/** Shared pieces that keep their original colours in the studio (already playful, or plants). */
export const STUDIO_KEEP = new Set(['arcade', 'beanbag:terracotta', 'beanbag:slate', 'beanbag:mustard'])

/** Neon glow the scene adds (ADD layer) behind studio pieces: [radius, intensity, rgb]. */
export const STUDIO_GLOW: Record<string, [number, number, string]> = {
  'gs:clawMachine': [18, 0.4, '255,90,170'],
  'gs:pinball': [14, 0.35, '160,120,255'],
  'gs:arcadeB': [14, 0.35, '80,220,255'],
  'gs:neonPlay': [20, 0.55, '255,80,165'],
  'gs:danceMachine': [26, 0.4, '160,120,255'],
  'gs:trophyCase': [16, 0.25, '255,200,120'],
  'gs:mascot': [18, 0.35, '80,220,255'],
  'gs:speaker': [10, 0.3, '160,120,255'],
  'gs:figureStand': [8, 0.25, '255,190,110']
}

export const STUDIO_WALL = S.graphite

export const STUDIO_FEATURE: FeatureStyle = {
  tag: 'GAME STUDIO',
  plate: S.graphite,
  glow: 0.3,
  slats: ramp('#35323f', '#2a2733', '#211f29', '#17151d'),
  light: ramp('#ffd6ee', '#ff6fb5', '#e0458f', '#9c2a63'),
  returnColor: '#3a1029',
  tagColor: '#b9f3ff'
}

// ── floors & walls ─────────────────────────────────────────────────

/** Classic arcade carpet: dark ground with neon confetti, triangles and squiggles. */
function arcadeCarpet(px: Px, r: Rect): void {
  const { x0, y0, x1, y1 } = px0(r)
  px.r(x0, y0, x1 - x0, y1 - y0, '#1a1726')
  const R = rng(21)
  const colors = [NEON.pink, NEON.cyan, NEON.lime, NEON.violet, NEON.amber]
  for (let y = y0; y < y1; y += 2) for (let x = x0 + ((y >> 1) & 1); x < x1; x += 2) if (hash(x, y) < 0.12) px.p(x, y, '#221e33')
  for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / 170; i++) {
    const x = x0 + Math.floor(R() * (x1 - x0 - 4))
    const y = y0 + Math.floor(R() * (y1 - y0 - 4))
    const c = colors[Math.floor(R() * colors.length)]
    const k = R()
    px.alpha(0.38, () => {
      if (k < 0.3) px.p(x, y, c).p(x + 1, y + 1, c).p(x + 2, y, c)
      else if (k < 0.55) px.p(x, y, c).p(x + 1, y, c).p(x, y + 1, c)
      else if (k < 0.75) px.p(x, y, c).p(x + 1, y - 1, c).p(x + 2, y, c).p(x + 3, y - 1, c)
      else px.p(x, y, c)
    })
  }
}

/** A muted checker for the snack bar, with a subtle sheen. */
function checker(px: Px, r: Rect): void {
  const { x0, y0, x1, y1 } = px0(r)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dark = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 1
      // a low-contrast diner check: the room should read as a floor, not the loudest thing in the office
      let c = dark ? '#34313f' : '#6f6a7c'
      if ((x % 8 === 0 || y % 8 === 0) && !dark) c = '#625d6f'
      if (hash(x, y) < 0.03) c = shade(c, dark ? 0.08 : -0.05)
      px.p(x, y, c)
    }
  }
}

/** The concept room's floor: lighter than the dev pit so artists can see, still at home in a dark studio. */
const CONCEPT_FLOOR = ramp('#a58a6e', '#927760', '#7f6650', '#65503e')

export function paintStudioBackground(accent: Ramp): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(WORLD_W, WORLD_H)
  px.r(0, 0, WORLD_W, WORLD_H, PAL.void)

  oakPlanks(px, { x: 1, y: 4, w: COLS - 2, h: ROWS - 5 }, S.night, 3)
  carpetTiles(px, ZONES.meeting, S.carpet)
  carpetTiles(px, ZONES.focus, ramp('#34405a', '#2a344b', '#232b3f', '#19202f'))
  checker(px, ZONES.kitchen)
  oakPlanks(px, ZONES.studio, CONCEPT_FLOOR, 4)
  chevron(px, ZONES.lounge, ramp('#6b4a3c', '#583b30', '#472f27', '#33211b'))
  polishedConcrete(px, ZONES.reception, ramp('#4a4754', '#3d3a47', '#33303c', '#28252f'))
  stoneTiles(px, ZONES.supply, S.tile, 8)
  carpetTiles(px, ZONES.booths, S.carpet)
  arcadeCarpet(px, ZONES.play)
  wallColumnFloors(px, {
    meeting: (r) => carpetTiles(px, r, S.carpet),
    focus: (r) => carpetTiles(px, r, ramp('#34405a', '#2a344b', '#232b3f', '#19202f')),
    booths: (r) => carpetTiles(px, r, S.carpet),
    kitchen: (r) => checker(px, r),
    reception: (r) => polishedConcrete(px, r, ramp('#4a4754', '#3d3a47', '#33303c', '#28252f')),
    supply: (r) => stoneTiles(px, r, S.tile, 8),
    studio: (r) => oakPlanks(px, r, CONCEPT_FLOOR, 4),
    lounge: (r) => chevron(px, r, ramp('#6b4a3c', '#583b30', '#472f27', '#33211b'))
  })

  // dev pit: a neon guide line along the main aisle and a rug under the huddle
  px.alpha(0.55, () => px.h(14 * TILE + 4, 9 * TILE + 8, 22 * TILE, NEON.violet))
  px.alpha(0.25, () => px.h(14 * TILE + 4, 9 * TILE + 9, 22 * TILE, NEON.violet))
  rug(px, 30 * TILE + 4, 6 * TILE + 10, 5 * TILE - 8, 4 * TILE - 4, '#2b2638', S.plum.mid, NEON.cyan)
  // greenlight room rug, lounge rug in the fabric accent, concept studio rug
  px.alpha(0.4, () => px.r(2 * TILE + 4, 5 * TILE + 10, 9 * TILE - 8, 5 * TILE - 4, S.carpet.lo))
  rug(px, 1 * TILE + 8, 30 * TILE + 4, 7 * TILE, 3 * TILE + 8, '#2b2638', accent.base, NEON.cyan)
  rug(px, 1 * TILE + 8, 22 * TILE + 8, 7 * TILE, 3 * TILE, '#3a3546', S.plum.hi, accent.hi)
  // lobby: a neon ring inlaid around the mascot and a runner to the desk
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    const x = Math.round(27 * TILE + Math.cos(a) * 30)
    const y = Math.round(23 * TILE + 8 + Math.sin(a) * 18)
    px.alpha(0.7, () => px.p(x, y, NEON.cyan))
  }
  px.alpha(0.35, () => px.r(31 * TILE, 27 * TILE, 4 * TILE, 7 * TILE, S.plum.lo))
  // arcade: a court mat under the table and a VR play-space outline
  const mat = { x: 43 * TILE - 4, y: 22 * TILE + 4, w: 7 * TILE + 8, h: 4 * TILE - 4 }
  px.r(mat.x, mat.y, mat.w, mat.h, '#221e33')
  px.outlineRect(mat.x + 3, mat.y + 3, mat.w - 6, mat.h - 6, NEON.cyan)
  px.alpha(0.6, () => px.outlineRect(41 * TILE + 6, 27 * TILE + 4, 4 * TILE, 5 * TILE, NEON.lime))
  for (let x = 41 * TILE + 8; x < 45 * TILE + 4; x += 6) px.alpha(0.4, () => px.p(x, 32 * TILE + 4, NEON.lime))
  drawText(px, 'VR', 42 * TILE + 6, 31 * TILE, NEON.lime)

  // thresholds and door mats
  doorMat(px, ENTRANCE.x * TILE + 2, 33 * TILE + 4, ENTRANCE.w * TILE - 4, 26)
  doorMat(px, 10 * TILE + 2, 14 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 9 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 18 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  px.alpha(0.2, () => px.r(1 * TILE, 15 * TILE + 6, (COLS - 2) * TILE, 2 * TILE - 12, '#000'))
  px.h(39 * TILE, 15 * TILE, 16 * TILE, S.gun.mid)

  for (const p of PLACEMENTS) {
    if (p.key.startsWith('chair') || p.key.startsWith('stool') || p.key.startsWith('armchair') || p.key.startsWith('beanbag') || p.key === 'deskDivider' || p.uid) continue
    contactShadow(px, p.tx * TILE, (p.ty + p.th) * TILE, p.tw * TILE)
  }

  paintStudioWall(px)
  sideAndSouthWalls(px)
  return canvas
}

function paintStudioWall(px: Px): void {
  const D = WALL_DECOR
  px.r(0, 0, WORLD_W, FACE_TOP, PAL.void)
  px.r(0, CAP_TOP, WORLD_W, FACE_TOP - CAP_TOP, PAL.wallCap).h(0, FACE_TOP - 1, WORLD_W, PAL.wallCapHi)
  for (let y = FACE_TOP; y < FACE_BOTTOM; y++) px.h(TILE, y, WORLD_W - 2 * TILE, mix(S.wall.hi, S.wall.base, Math.min(1, (y - FACE_TOP) / 18)))
  // a neon strip along the top of the wall: pink over the pit, cyan over the snack bar
  px.h(TILE, FACE_TOP + 1, 37 * TILE, NEON.pink)
  px.alpha(0.3, () => px.h(TILE, FACE_TOP + 2, 37 * TILE, NEON.pink))
  px.h(39 * TILE, FACE_TOP + 1, 15 * TILE, NEON.cyan)
  px.alpha(0.3, () => px.h(39 * TILE, FACE_TOP + 2, 15 * TILE, NEON.cyan))

  // greenlight room: acoustic hexagon felt
  const felt = D.boardFelt
  for (let y = FACE_TOP + 4; y < FACE_BOTTOM - 4; y += 6) {
    for (let x = felt.x * TILE + ((y / 6) & 1) * 4; x < (felt.x + felt.w) * TILE - 6; x += 8) {
      px.r(x, y, 6, 4, S.plum.mid).h(x, y, 6, S.plum.hi).h(x, y + 3, 6, S.plum.lo)
    }
  }
  // dev pit: black acoustic slats behind the director's corner
  const s = D.workspaceSlats
  for (let x = s.x * TILE; x < (s.x + s.w) * TILE; x++) px.v(x, FACE_TOP + 4, FACE_BOTTOM - FACE_TOP - 4, x % 3 === 0 ? M.black.lo : M.black.base)

  // the playtest wall: big bezels (the game plays live on them)
  for (const sc of STUDIO_WALL_SCREENS) {
    px.r(sc.x * TILE - 2, 20, sc.w * TILE + 4, 32, '#0b0a10').h(sc.x * TILE - 2, 20, sc.w * TILE + 4, '#2e2a38')
    px.alpha(0.25, () => px.r(sc.x * TILE - 1, 52, sc.w * TILE + 2, 3, '#000'))
  }

  // snack bar: dark subway tile and a neon menu
  const bs = D.backsplash
  for (let y = 38; y < FACE_BOTTOM; y++) {
    for (let x = bs.x * TILE; x < (bs.x + bs.w) * TILE; x++) {
      const row = Math.floor((y - 38) / 4)
      const lx = (x + (row % 2) * 4) % 8
      px.p(x, y, (y - 38) % 4 === 0 || lx === 0 ? S.tile.lo : S.tile.base)
    }
  }
  const cm = D.coffeeMenu
  const mx = cm.x * TILE + 2
  px.r(mx - 2, 18, cm.w * TILE, 19, '#16141b').outlineRect(mx - 2, 18, cm.w * TILE, 19, NEON.cyan)
  const R0 = rng(12)
  for (let i = 0; i < 4; i++) px.h(mx + 3, 23 + i * 3, 10 + Math.floor(R0() * 10), i % 2 ? NEON.pink : '#e8e4f0').h(mx + cm.w * TILE - 12, 23 + i * 3, 5, NEON.lime)
  for (const c of D.upperCabinets) {
    const x = c.x * TILE
    const w = c.w * TILE
    px.r(x, 18, w, 18, S.graphite.base).h(x, 18, w, S.graphite.hi).h(x, 35, w, S.graphite.lo)
    for (let k = 1; k < c.w * 2; k++) px.v(x + k * 8, 19, 16, S.graphite.mid)
    px.alpha(0.4, () => px.r(x + 2, 36, w - 4, 4, '#b9f3ff'))
  }

  // windows (glass is animated separately)
  for (const w of D.windows) {
    const x = w.x * TILE
    const { top, bottom } = windowSpan(w.tall)
    px.r(x - 2, top - 2, w.w * TILE + 4, bottom - top + 4, M.black.lo)
  }
  // milestone board frame, greenlight pitch screen bezel, storyboard
  const rm = D.roadmap
  px.r(rm.x * TILE + 1, 19, rm.w * TILE - 2, 33, S.gun.lo).h(rm.x * TILE + 1, 19, rm.w * TILE - 2, S.gun.hi)
  const tv = D.meetingTv
  px.r(tv.x * TILE - 2, 20, tv.w * TILE + 4, 34, '#0e0f13').h(tv.x * TILE - 2, 20, tv.w * TILE + 4, '#30323a')
  const wb = D.whiteboard
  const wx = wb.x * TILE + 2
  px.r(wx, 22, wb.w * TILE - 4, 28, S.gun.lo).r(wx + 1, 23, wb.w * TILE - 6, 26, '#f4f1ea')
  // storyboard: six panels with little scenes
  for (let i = 0; i < 6; i++) {
    const bx = wx + 3 + (i % 3) * 14
    const by = 25 + Math.floor(i / 3) * 12
    px.outlineRect(bx, by, 12, 9, '#2b2e38')
    px.r(bx + 2, by + 5, 3, 3, ['#3a6fe0', '#e04f5f', '#1fa3a3'][i % 3]).h(bx + 1, by + 7, 10, '#9aa3b5')
  }
  // posters: game key art
  for (const p of D.posters) paintPoster(px, p.x * TILE + 4, 24, p.kind)

  // skirting and wall shadow
  px.r(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, 3, M.black.base).h(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, M.black.hi)
  px.alpha(0.22, () => px.r(TILE, FACE_BOTTOM, WORLD_W - 2 * TILE, 3, '#000'))
}

/** Side walls and the south wall with its glass entrance (shared shape, studio entrance position). */
export function sideAndSouthWalls(px: Px): void {
  for (const x of [0, WORLD_W - TILE]) {
    px.r(x, 0, TILE, WORLD_H, PAL.void)
    const edge = x === 0 ? TILE - 6 : x
    px.r(edge, CAP_TOP, 6, WORLD_H - CAP_TOP, PAL.wallCap)
    px.v(x === 0 ? edge + 5 : edge, CAP_TOP, WORLD_H - CAP_TOP, PAL.wallCapHi)
  }
  px.alpha(0.12, () => px.r(TILE, FACE_BOTTOM, 3, WORLD_H - FACE_BOTTOM - TILE, '#000'))
  const sy = (ROWS - 1) * TILE
  px.r(0, sy, WORLD_W, TILE, PAL.void)
  px.r(TILE - 6, sy, WORLD_W - 2 * TILE + 12, 6, PAL.wallCap).h(TILE - 6, sy, WORLD_W - 2 * TILE + 12, PAL.wallCapHi)
  const ex = ENTRANCE.x * TILE
  px.r(ex, sy, ENTRANCE.w * TILE, 6, '#7d8894')
  px.alpha(0.55, () => px.r(ex + 2, sy + 1, ENTRANCE.w * TILE - 4, 4, M.glass.base))
  for (const x of [ex, ex + (ENTRANCE.w * TILE) / 2 - 1, ex + ENTRANCE.w * TILE - 2]) px.r(x, sy - 2, 2, 8, M.black.base)
  // keep the imports honest for packs that don't use every helper
  void WALLS
  void FEATURE_WALL
}

/** The playtest wall over the dev pit (tile x and width). */
export const STUDIO_WALL_SCREENS = [
  { x: 15, w: 4 },
  { x: 22, w: 4 }
]
