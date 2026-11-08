// The AI Lab's art pack: bright, precise materials (warm white, ash wood, brushed aluminium, teal),
// its signature pieces (server racks, a GPU rig, a robot-arm experimentation bench, a moss wall, a
// data-viz board, …), a live metrics wall, and its floors and walls. Shared pieces are the original
// drawings recoloured through the lab's material map, so detail, light and anchor points are kept.
// Same projection, scale, light and outline rules as everything else (docs/ART_DIRECTION.md).

import { COLS, ENTRANCE, PLACEMENTS, ROWS, TILE, WALL_DECOR, WORLD_H, WORLD_W, ZONES, type Rect } from '../layout'
import { CAP_TOP, FACE_BOTTOM, FACE_TOP, carpetTiles, contactShadow, doorMat, hash, oakPlanks, paintPoster, polishedConcrete, px0, rug, stoneTiles, wallColumnFloors, windowSpan, type FeatureStyle } from './environment'
import { M, PAL, type Ramp } from './palette'
import { Px, block, drawText, makeCanvas, mix, rng, selout, shade } from './px'
import { ramp, recolor, type MaterialMap } from './recolor'
import { sideAndSouthWalls } from './studio'

const finish = (px: Px, w: number, h: number) => selout(px, 0, 0, w, h, 0.5)

// ── materials ──────────────────────────────────────────────────────

export const L = {
  ash: ramp('#efe4d2', '#e2d3bc', '#cfbea4', '#ad9b80'),
  ashFloor: ramp('#e8dcc8', '#dccdb4', '#cbbb9f', '#b09f83'),
  alu: ramp('#eef2f5', '#d4dbe1', '#b6c0c9', '#8c97a2'),
  teal: ramp('#7fd1cf', '#4fb3b1', '#3a9391', '#276c6b'),
  ink: ramp('#5b6b8a', '#46546f', '#384358', '#283041'),
  carpet: ramp('#a8b4bd', '#96a2ac', '#86929c', '#6e7983'),
  warmCarpet: ramp('#c9bfb3', '#b8ad9f', '#a89c8e', '#8c8174'),
  concrete: ramp('#e4e2dd', '#d6d3cc', '#c7c3ba', '#aaa59b'),
  terrazzo: ramp('#f6f4ef', '#ebe8e1', '#dcd8cf', '#c2bdb2'),
  raised: ramp('#cfd5da', '#bfc6cc', '#aeb6bd', '#929ba3'),
  plaster: ramp('#fbfaf7', '#f2f0ea', '#e6e3db', '#d1ccc1')
}

/** Status light colours (emissive, used on LEDs and screens only). */
export const LED = { teal: '#5ce1e6', green: '#5ee6a8', amber: '#f3b84a', blue: '#7fb6ff' }

export const LAB_MAP: MaterialMap = [
  [M.oak, L.ash],
  [M.oakFloor, L.ashFloor],
  [M.walnut, ramp('#b8a58a', '#a08d72', '#87765e', '#6b5c48')],
  [M.steel, L.alu],
  [M.forest, L.teal],
  [M.sage, ramp('#a6d8d6', '#86c3c1', '#6aa8a6', '#4f8886')],
  [M.carpet, L.carpet],
  [M.stone, L.terrazzo]
]

export const labRecolor = (c: HTMLCanvasElement) => recolor(c, LAB_MAP)

/** A lab workstation: the original desk in ash and aluminium, with a small status light. */
export function labDesk(base: HTMLCanvasElement): HTMLCanvasElement {
  const c = labRecolor(base)
  const px = new Px(c.getContext('2d')!)
  px.p(44, 17 + 2, LED.teal).p(44, 17 + 3, shade(LED.teal, -0.3))
  return c
}

/** A light mesh task chair (grey frame, teal seat). */
export function labChair(base: HTMLCanvasElement): HTMLCanvasElement {
  return recolor(base, [[M.black, ramp('#9aa4ae', '#7d8892', '#66707a', '#4c545d')]])
}

// ── signature pieces ───────────────────────────────────────────────

/** A living moss wall in an ash frame. 2×1 against the north wall. */
function plantWall(): HTMLCanvasElement {
  const w = 32
  const h = 46
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 2, w, 3, 39, L.ash)
  px.r(2, 6, w - 4, 34, '#2f5a3a')
  const R = rng(17)
  for (let y = 6; y < 40; y++) {
    for (let x = 2; x < w - 2; x++) {
      const n = R()
      if (n < 0.35) px.p(x, y, ['#4f8f4f', '#5ea24f', '#3f7d3f', '#8fcf6d', '#6fae5c'][Math.floor(R() * 5)])
      else if (n > 0.97) px.p(x, y, '#cfe8a8')
    }
  }
  px.h(2, 6, w - 4, L.ash.lo)
  finish(px, w, h)
  return canvas
}

/** A whiteboard on wheels covered in equations and a loss curve. 1×1. */
function whiteboardCart(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 40)
  px.v(3, 24, 13, L.alu.mid).v(12, 24, 13, L.alu.mid).h(2, 37, 12, L.alu.lo).p(2, 38, M.black.base).p(13, 38, M.black.base)
  px.r(0, 2, 16, 22, L.alu.lo).r(1, 3, 14, 20, '#fbfcfd')
  for (let i = 0; i < 3; i++) px.h(2, 5 + i * 2, 4 + i * 2, '#2b59c3')
  // a loss curve falling
  for (let x = 2; x < 14; x++) px.p(x, 11 + Math.round(8 * Math.exp(-(x - 2) / 4)), '#e04f5f')
  px.h(2, 20, 12, '#2b2e38').v(2, 11, 10, '#2b2e38')
  finish(px, 16, 40)
  return canvas
}

/** Robotics and sensor shelf: boards, a camera module, cable reels, labelled bins. 3×1. */
function sensorShelf(): HTMLCanvasElement {
  const w = 48
  const h = 40
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 4, w, 3, 32, L.alu)
  for (const sy of [16, 26]) px.h(1, sy, w - 2, L.alu.lo).h(1, sy + 1, w - 2, L.alu.hi)
  // circuit boards with chips
  for (let x = 3; x < 44; x += 9) px.r(x, 9, 7, 6, '#2f7a4a').r(x + 2, 11, 3, 2, M.black.base).p(x + 1, 10, M.mustard.hi)
  // a camera module and a lidar puck
  px.r(4, 20, 6, 5, M.black.base).ellipse(7, 22, 1, 1, LED.blue)
  px.ellipse(16, 23, 3, 2, '#2b2e38').h(14, 21, 5, LED.teal)
  // labelled bins
  for (let x = 23; x < 44; x += 7) {
    px.r(x, 19, 6, 6, '#e8eef2').h(x, 19, 6, '#ffffff').r(x + 1, 21, 4, 2, ['#5ee6a8', '#7fb6ff', '#f3b84a'][(x / 7) % 3 | 0])
  }
  // bottom: cable reels and a toolbox
  px.ellipse(6, 32, 3, 3, '#e8833a').p(6, 32, M.black.base).ellipse(14, 32, 3, 3, '#2b59c3').p(14, 32, M.black.base)
  px.r(24, 29, 14, 6, '#c0392b').h(24, 29, 14, '#e74c3c').h(29, 28, 4, M.black.base)
  finish(px, w, h)
  return canvas
}

/** An indoor olive tree in a wide planter: the atrium's centrepiece. 2×2. */
function lobbyTree(): HTMLCanvasElement {
  const w = 32
  const h = 56
  const { canvas, px } = makeCanvas(w, h)
  block(px, 3, 40, 26, 5, 9, L.ash)
  px.r(5, 41, 22, 3, '#4a3b2c')
  px.v(15, 18, 24, '#6b4a33').v(16, 20, 22, '#5a3d2a').p(14, 26, '#6b4a33').p(18, 24, '#6b4a33')
  const R = rng(3)
  for (let i = 0; i < 220; i++) {
    const a = R() * Math.PI * 2
    const r = Math.sqrt(R())
    const x = Math.round(16 + Math.cos(a) * r * 14)
    const y = Math.round(16 + Math.sin(a) * r * 12)
    px.p(x, y, ['#7f9a6c', '#6b8a5e', '#9db58a', '#566f4c'][Math.floor(R() * 4)])
  }
  for (let i = 0; i < 10; i++) px.p(6 + Math.floor(R() * 20), 6 + Math.floor(R() * 18), '#c9d8b0')
  finish(px, w, h)
  return canvas
}

/** An open-frame GPU rig: four cards with fans and status lights, on a low cart. 2×1. */
function gpuRig(): HTMLCanvasElement {
  const w = 32
  const h = 36
  const { canvas, px } = makeCanvas(w, h)
  block(px, 1, 22, 30, 4, 6, L.alu)
  px.r(3, 32, 2, 3, M.black.base).r(27, 32, 2, 3, M.black.base)
  px.r(2, 4, 28, 18, M.black.lo).outlineRect(2, 4, 28, 18, L.alu.mid)
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 7
    px.r(x, 6, 5, 14, '#24272e').h(x, 6, 5, '#3a3e48')
    px.ellipse(x + 2, 10, 2, 2, '#14161b').p(x + 2, 10, L.alu.mid).ellipse(x + 2, 16, 2, 2, '#14161b').p(x + 2, 16, L.alu.mid)
    px.p(x + 4, 7, LED.green)
  }
  px.h(4, 21, 24, LED.teal)
  finish(px, w, h)
  return canvas
}

/** A precision cooling unit with a vent grille and a temperature readout. 2×1. */
function coolingUnit(): HTMLCanvasElement {
  const w = 32
  const h = 34
  const { canvas, px } = makeCanvas(w, h)
  block(px, 1, 4, 30, 4, 26, L.plaster)
  for (let y = 12; y < 26; y += 2) px.h(4, y, 24, L.plaster.mid)
  px.r(20, 9, 8, 3, '#14161b')
  drawText(px, '18', 21, 9, LED.teal)
  px.p(5, 9, LED.green)
  finish(px, w, h)
  return canvas
}

/** A chess table mid-game. 2×1 (stools are separate). */
function chessTable(): HTMLCanvasElement {
  const w = 32
  const h = 24
  const { canvas, px } = makeCanvas(w, h)
  block(px, 2, 4, 28, 12, 3, L.ash)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) px.r(8 + x * 2, 5 + y * 2, 2, 2, (x + y) % 2 ? '#2b2e38' : '#f4efe4')
  for (const [x, y, c] of [
    [9, 5, '#ffffff'],
    [13, 7, '#ffffff'],
    [19, 9, '#1b1c22'],
    [21, 11, '#1b1c22'],
    [15, 9, '#ffffff']
  ] as const) px.r(x, y - 2, 1, 3, c).p(x, y - 3, c)
  px.r(14, 19, 4, 4, M.black.base)
  finish(px, w, h)
  return canvas
}

/** A friendly delivery robot at its charging kiosk. 1×1. */
function robotKiosk(): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(16, 32)
  px.r(2, 18, 12, 12, L.alu.base).h(2, 18, 12, L.alu.hi).r(4, 27, 2, 3, M.black.base).r(10, 27, 2, 3, M.black.base)
  px.round(3, 6, 10, 10, '#f4f6f8').r(5, 9, 6, 3, '#14161b').p(6, 10, LED.teal).p(9, 10, LED.teal)
  px.v(8, 2, 4, L.alu.mid).p(8, 1, LED.green)
  px.h(4, 22, 8, LED.teal)
  finish(px, 16, 32)
  return canvas
}

/** Server racks (the lockers' place in the lab): four racks with blinking status lights. 4×1. */
function serverRow(): HTMLCanvasElement {
  const w = 64
  const h = 58
  const { canvas, px } = makeCanvas(w, h)
  block(px, 0, 8, w, 4, 44, ramp('#3a3f4a', '#2b2f38', '#23262e', '#191b21'))
  const R = rng(9)
  for (let r = 0; r < 4; r++) {
    const x = r * 16
    px.v(x, 12, 44, '#14161b').v(x + 15, 12, 44, '#14161b')
    for (let y = 14; y < 52; y += 3) {
      px.h(x + 2, y, 12, '#1d2027')
      if (R() < 0.75) px.p(x + 3, y + 1, R() < 0.8 ? LED.green : LED.amber)
      if (R() < 0.5) px.p(x + 5, y + 1, LED.teal)
      px.h(x + 8, y + 1, 5, '#2e323c')
    }
    px.h(x + 2, 12, 12, LED.blue)
  }
  finish(px, w, h)
  return canvas
}

/** A data-visualisation board (the moodboard's place in the lab): charts and a cluster plot. 2×1. */
function vizBoard(): HTMLCanvasElement {
  const w = 32
  const h = 52
  const { canvas, px } = makeCanvas(w, h)
  px.r(1, 2, 30, 26, L.alu.lo).r(2, 3, 28, 24, '#f8fafb')
  // bar chart
  for (let i = 0; i < 5; i++) px.r(4 + i * 3, 13 - i * 1.5, 2, 3 + i * 1.5, ['#4fb3b1', '#7fb6ff', '#5ee6a8', '#f3b84a', '#e04f5f'][i])
  // scatter clusters
  const R = rng(4)
  for (let i = 0; i < 18; i++) px.p(19 + Math.floor(R() * 9), 5 + Math.floor(R() * 9), i % 3 === 0 ? '#e04f5f' : i % 3 === 1 ? '#2b59c3' : '#1fbf75')
  // a line chart
  for (let x = 4; x < 28; x++) px.p(x, 22 - Math.round(Math.sin(x / 3) * 2 + (x - 4) / 6), '#2b2e38')
  px.v(15, 28, 22, L.alu.mid).v(16, 28, 22, L.alu.lo).h(9, 50, 14, L.alu.mid)
  finish(px, w, h)
  return canvas
}

export const LAB_FACTORIES: Record<string, () => HTMLCanvasElement> = {
  'lab:plantWall': plantWall,
  'lab:whiteboardCart': whiteboardCart,
  'lab:sensorShelf': sensorShelf,
  'lab:lobbyTree': lobbyTree,
  'lab:gpuRig': gpuRig,
  'lab:coolingUnit': coolingUnit,
  'lab:chessTable': chessTable,
  'lab:robotKiosk': robotKiosk,
  lockers: serverRow,
  moodboard: vizBoard
}

export const LAB_KEEP = new Set(['arcade', 'beanbag:terracotta', 'beanbag:slate', 'beanbag:mustard'])

export const LAB_GLOW: Record<string, [number, number, string]> = {
  lockers: [30, 0.3, '90,225,230'],
  'lab:gpuRig': [18, 0.35, '94,230,168'],
  'lab:robotKiosk': [10, 0.3, '90,225,230'],
  'lab:coolingUnit': [10, 0.2, '90,225,230'],
  'lab:plantWall': [16, 0.18, '255,240,200']
}

export const LAB_WALL = L.plaster

export const LAB_FEATURE: FeatureStyle = {
  tag: 'AI LAB',
  glow: 0.32,
  slats: ramp('#2c4d53', '#214046', '#1a343a', '#12262b'),
  light: ramp('#e9ffff', '#7fe9ec', '#4fc9cc', '#2a8f92'),
  returnColor: '#1d4f52',
  tagColor: '#bff3f2'
}

/** The metrics wall over the research floor (tile x and width). */
export const LAB_WALL_SCREENS = [
  { x: 30, w: 4 },
  { x: 34, w: 4 }
]

/** Live metrics for the wall: training curves and throughput bars that move (decorative). */
export function drawData(px: Px, w: number, h: number, tick: number, seed: number): void {
  px.r(0, 0, w, h, '#0b1220')
  for (let y = 4; y < h; y += 6) px.h(1, y, w - 2, '#14203a')
  const t = tick * 0.15 + seed
  // a falling loss curve with noise, scrolling
  let prev = 0
  for (let x = 1; x < w - 1; x++) {
    const v = Math.round(4 + (h - 12) * Math.exp(-((x + t) % (w * 2)) / (w * 0.6)) + Math.sin(x * 1.7 + t) * 1.2)
    px.p(x, Math.min(h - 3, v), LED.teal)
    if (x > 1 && Math.abs(v - prev) > 1) px.v(x, Math.min(v, prev), Math.abs(v - prev), shade(LED.teal, -0.3))
    prev = v
  }
  // throughput bars along the bottom
  for (let i = 0; i < 6; i++) {
    const bh = 2 + Math.round((Math.sin(t * 0.7 + i * 1.3) + 1) * 2)
    px.r(2 + i * 4, h - 2 - bh, 3, bh, i % 2 ? LED.blue : LED.green)
  }
  px.p(w - 3, 2, tick % 6 < 3 ? LED.green : '#1d3b2c')
}

// ── floors & walls ─────────────────────────────────────────────────

/** Raised-floor tiles with perforations (server room). */
function raisedFloor(px: Px, r: Rect): void {
  stoneTiles(px, r, L.raised, 16)
  const { x0, y0, x1, y1 } = px0(r)
  for (let y = y0 + 4; y < y1; y += 16) for (let x = x0 + 4; x < x1; x += 16) for (let k = 0; k < 3; k++) px.h(x, y + k * 3, 8, L.raised.mid)
}

export function paintLabBackground(accent: Ramp): HTMLCanvasElement {
  const { canvas, px } = makeCanvas(WORLD_W, WORLD_H)
  px.r(0, 0, WORLD_W, WORLD_H, PAL.void)

  polishedConcrete(px, { x: 1, y: 4, w: COLS - 2, h: ROWS - 5 }, L.concrete)
  carpetTiles(px, ZONES.meeting, L.carpet)
  carpetTiles(px, ZONES.focus, L.carpet)
  oakPlanks(px, ZONES.kitchen, L.ashFloor, 6)
  stoneTiles(px, ZONES.reception, L.terrazzo, 32)
  oakPlanks(px, ZONES.studio, L.ashFloor, 2)
  carpetTiles(px, ZONES.lounge, L.warmCarpet)
  raisedFloor(px, ZONES.supply)
  carpetTiles(px, ZONES.booths, L.carpet)
  oakPlanks(px, ZONES.play, L.ashFloor, 9)
  wallColumnFloors(px, {
    meeting: (r) => carpetTiles(px, r, L.carpet),
    focus: (r) => carpetTiles(px, r, L.carpet),
    booths: (r) => carpetTiles(px, r, L.carpet),
    kitchen: (r) => oakPlanks(px, r, L.ashFloor, 6),
    reception: (r) => stoneTiles(px, r, L.terrazzo, 32),
    supply: (r) => raisedFloor(px, r),
    studio: (r) => oakPlanks(px, r, L.ashFloor, 2),
    lounge: (r) => carpetTiles(px, r, L.warmCarpet)
  })
  // terrazzo chips in the atrium
  const R = rng(31)
  const z = ZONES.reception
  for (let i = 0; i < 900; i++) px.p(z.x * TILE + Math.floor(R() * z.w * TILE), z.y * TILE + Math.floor(R() * z.h * TILE), ['#c9c3b8', '#a9b8bd', '#d8c9b4', '#9aa6aa'][Math.floor(R() * 4)])

  // research floor: a teal wayfinding line, a rug under the stand-up table
  px.alpha(0.5, () => px.h(13 * TILE + 4, 9 * TILE + 8, 25 * TILE, L.teal.base))
  rug(px, 30 * TILE + 4, 6 * TILE + 10, 5 * TILE - 8, 4 * TILE - 4, '#e3e7ea', L.ink.mid, L.teal.base)
  px.alpha(0.3, () => px.r(1 * TILE + 4, 5 * TILE + 10, 9 * TILE - 8, 5 * TILE - 4, L.carpet.lo))
  // library rug in the fabric accent, studio rug
  rug(px, 17 * TILE + 8, 28 * TILE + 8, 8 * TILE, 4 * TILE, '#eee6d8', accent.base, L.teal.mid)
  rug(px, 16 * TILE + 8, 21 * TILE + 8, 6 * TILE, 2 * TILE + 4, '#e9ecee', L.ink.hi, accent.hi)
  // recreation: a court mat under the table and a rug in front of the big screen
  const mat = { x: 40 * TILE - 4, y: 22 * TILE + 4, w: 7 * TILE + 8, h: 4 * TILE - 4 }
  px.r(mat.x, mat.y, mat.w, mat.h, L.ink.base)
  px.outlineRect(mat.x + 3, mat.y + 3, mat.w - 6, mat.h - 6, '#e9eef2')
  px.v(mat.x + mat.w / 2, mat.y + 3, mat.h - 6, '#e9eef2')
  rug(px, 47 * TILE + 8, 30 * TILE + 8, 6 * TILE, 3 * TILE + 4, '#dfe7ea', L.ink.base, accent.base)

  doorMat(px, ENTRANCE.x * TILE + 2, 33 * TILE + 4, ENTRANCE.w * TILE - 4, 26)
  doorMat(px, 5 * TILE + 2, 13 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 20 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  doorMat(px, 31 * TILE + 2, 17 * TILE + 2, 2 * TILE - 4, 12)
  px.alpha(0.12, () => px.r(1 * TILE, 15 * TILE + 6, (COLS - 2) * TILE, 2 * TILE - 12, '#5b6b7a'))
  px.h(40 * TILE, 15 * TILE, 15 * TILE, L.alu.mid)

  for (const p of PLACEMENTS) {
    if (p.key.startsWith('chair') || p.key.startsWith('stool') || p.key.startsWith('armchair') || p.key.startsWith('beanbag') || p.key === 'deskDivider' || p.uid) continue
    contactShadow(px, p.tx * TILE, (p.ty + p.th) * TILE, p.tw * TILE)
  }

  paintLabWall(px)
  sideAndSouthWalls(px)
  return canvas
}

function paintLabWall(px: Px): void {
  const D = WALL_DECOR
  px.r(0, 0, WORLD_W, FACE_TOP, PAL.void)
  px.r(0, CAP_TOP, WORLD_W, FACE_TOP - CAP_TOP, PAL.wallCap).h(0, FACE_TOP - 1, WORLD_W, PAL.wallCapHi)
  for (let y = FACE_TOP; y < FACE_BOTTOM; y++) px.h(TILE, y, WORLD_W - 2 * TILE, mix(L.plaster.hi, L.plaster.base, Math.min(1, (y - FACE_TOP) / 14)))
  // a hairline of teal light along the wall top
  px.h(TILE, FACE_TOP + 1, WORLD_W - 2 * TILE, L.teal.hi)
  px.alpha(0.25, () => px.h(TILE, FACE_TOP + 2, WORLD_W - 2 * TILE, L.teal.base))

  // review room: pale acoustic fabric panels
  const felt = D.boardFelt
  for (let x = felt.x * TILE; x < (felt.x + felt.w) * TILE; x++) px.v(x, FACE_TOP + 4, FACE_BOTTOM - FACE_TOP - 7, x % 16 === 0 ? L.carpet.mid : L.carpet.hi)
  // the metrics wall: bezels (the data moves live on them)
  for (const sc of LAB_WALL_SCREENS) {
    px.r(sc.x * TILE - 2, 20, sc.w * TILE + 4, 32, '#0e131c').h(sc.x * TILE - 2, 20, sc.w * TILE + 4, '#3a4352')
    px.alpha(0.18, () => px.r(sc.x * TILE - 1, 52, sc.w * TILE + 2, 3, '#000'))
  }
  // café: white tile backsplash, a clean menu, pale cabinets
  const bs = D.backsplash
  for (let y = 38; y < FACE_BOTTOM; y++) {
    for (let x = bs.x * TILE; x < (bs.x + bs.w) * TILE; x++) px.p(x, y, (y - 38) % 6 === 0 || x % 12 === 0 ? L.plaster.mid : L.plaster.hi)
  }
  const cm = D.coffeeMenu
  const mx = cm.x * TILE + 2
  px.r(mx - 2, 18, cm.w * TILE, 19, L.ash.mid).r(mx, 20, cm.w * TILE - 4, 15, '#fdfcf9')
  const R0 = rng(14)
  for (let i = 0; i < 4; i++) px.h(mx + 3, 23 + i * 3, 10 + Math.floor(R0() * 10), L.ink.base).h(mx + cm.w * TILE - 12, 23 + i * 3, 5, L.teal.base)
  for (const c of D.upperCabinets) {
    const x = c.x * TILE
    const w = c.w * TILE
    px.r(x, 18, w, 18, L.ash.base).h(x, 18, w, L.ash.hi).h(x, 35, w, L.ash.lo)
    for (let k = 1; k < c.w * 2; k++) px.v(x + k * 8, 19, 16, L.ash.mid)
    px.alpha(0.35, () => px.r(x + 2, 36, w - 4, 4, '#fff6dd'))
  }
  // big windows
  for (const w of D.windows) {
    const x = w.x * TILE
    const { top, bottom } = windowSpan(w.tall)
    px.r(x - 2, top - 2, w.w * TILE + 4, bottom - top + 4, L.alu.lo)
    if (w.tall) px.r(x - 3, bottom, w.w * TILE + 6, 3, L.alu.mid).h(x - 3, bottom, w.w * TILE + 6, L.alu.hi)
  }
  // milestone board, review screen bezel, review whiteboard with a system diagram
  const rm = D.roadmap
  px.r(rm.x * TILE + 1, 19, rm.w * TILE - 2, 33, L.alu.lo).h(rm.x * TILE + 1, 19, rm.w * TILE - 2, L.alu.hi)
  const tv = D.meetingTv
  px.r(tv.x * TILE - 2, 20, tv.w * TILE + 4, 34, '#0e0f13').h(tv.x * TILE - 2, 20, tv.w * TILE + 4, '#30323a')
  const wb = D.whiteboard
  const wx = wb.x * TILE + 2
  px.r(wx, 22, wb.w * TILE - 4, 28, L.alu.lo).r(wx + 1, 23, wb.w * TILE - 6, 26, '#fbfcfd')
  // data → model → eval, with arrows
  px.outlineRect(wx + 3, 26, 9, 6, '#2b59c3').outlineRect(wx + 16, 26, 9, 6, '#1fbf75').outlineRect(wx + 29, 26, 9, 6, '#e04f5f')
  px.h(wx + 12, 29, 4, '#2b2e38').h(wx + 25, 29, 4, '#2b2e38')
  for (let i = 0; i < 3; i++) px.h(wx + 4, 36 + i * 3, 12 + i * 6, '#9aa3b5')
  // a framed paper print (the lab's first paper)
  for (const p of D.posters) paintPoster(px, p.x * TILE + 4, 24, p.kind)

  px.r(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, 3, L.alu.mid).h(TILE, FACE_BOTTOM - 3, WORLD_W - 2 * TILE, L.alu.hi)
  px.alpha(0.12, () => px.r(TILE, FACE_BOTTOM, WORLD_W - 2 * TILE, 3, '#000'))
  void hash
  void drawText
}
