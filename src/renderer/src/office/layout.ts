// The office floor plan: tile grid, rooms, walls, furniture placement and named spots.
// All coordinates are in tiles unless suffixed with Px. See docs/ART_DIRECTION.md.

import { COLS, ROWS, WALL_ROWS } from './grid'
import { startupLayout } from './offices/startup'

export { COLS, ROWS, TILE, WALL_ROWS, WORLD_H, WORLD_W } from './grid'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Every office type has the same functional rooms (so every behaviour works everywhere), each with its own architecture, furniture and name. */
export type ZoneId = 'workspace' | 'meeting' | 'kitchen' | 'corridor' | 'studio' | 'lounge' | 'reception' | 'focus' | 'supply' | 'booths' | 'play'

export type Facing = 'down' | 'up' | 'left' | 'right'
export type Pose = 'stand' | 'sitUp' | 'sitDown'

export interface Spot {
  tx: number
  ty: number
  facing: Facing
  pose: Pose
  /** Pixel offset applied while posed (e.g. to sit onto a sofa). */
  dx?: number
  dy?: number
}

export interface Placement {
  key: string
  /** Footprint top-left tile and size. The texture is anchored bottom-left to the footprint. */
  tx: number
  ty: number
  tw: number
  th: number
  blocks: boolean
  /** Added to the sprite's y-sort depth. */
  depthBias?: number
  dx?: number
  dy?: number
  /** Optional interactive id (see INTERACTIVES). */
  id?: string
  /** Stable id for decor the founder can rearrange (see office customization). */
  uid?: string
  /** Lies on the floor (a rug): under everything, and people walk over it. */
  flat?: boolean
}

/**
 * Interior walls. Horizontal walls occupy one tile row and are drawn as a south-facing face;
 * vertical walls occupy one tile column and are drawn as a thin cap. Doors are walkable gaps.
 */
export interface Wall {
  id: string
  kind: 'glass' | 'solid'
  axis: 'h' | 'v'
  x: number
  y: number
  len: number
  /** Door openings: start offset along the wall and width in tiles. Glass doors slide. */
  doors?: { at: number; w: number }[]
}

export type DeskVariant = 'pm' | 'dev' | 'design' | 'qa'

export type PosterKind = 'ship' | 'grid' | 'bloom' | 'wave'

export interface Interactive {
  id: string
  label: string
  rect: Rect
}


export interface WallDecor {
  windows: { x: number; w: number; tall: boolean }[]
  posters: { x: number; kind: PosterKind }[]
  clock: { x: number }
  roadmap: { x: number; w: number }
  meetingTv: { x: number; w: number }
  whiteboard: { x: number; w: number }
  upperCabinets: { x: number; w: number }[]
  coffeeMenu: { x: number; w: number }
  workspaceSlats: { x: number; w: number }
  boardFelt: { x: number; w: number }
  backsplash: { x: number; w: number }
}

/** Everything that defines one office's floor plan. The engine reads only this. */
export interface OfficeLayout {
  type: 'startup' | 'studio' | 'lab'
  ZONES: Record<ZoneId, Rect>
  ZONE_LABEL: Record<ZoneId, string>
  ZONE_PURPOSE: Record<ZoneId, string>
  WALLS: Wall[]
  FEATURE_WALL: Rect
  ENTRANCE: { x: number; w: number }
  DESKS: Record<string, { desk: Rect; seat: Spot; variant: DeskVariant; zone: ZoneId }>
  MEETING_SEATS: Record<string, Spot>
  SPARE_MEETING_SEATS: Spot[]
  FOCUS_SEATS: [Spot, Spot]
  IDLE_SPOTS: Record<string, Spot[]>
  PAIR_SPOTS: { kind: 'chat' | 'pingpong'; zone: ZoneId; a: Spot; b: Spot }[]
  PLACEMENTS: Placement[]
  WALL_DECOR: WallDecor
  INTERACTIVES: Interactive[]
  EMPTY_SLOT_DECOR: { desks: string[]; p: Placement }[]
  /** [deskA, deskB, tx, ty]: an acoustic divider between two paired desks. */
  DESK_DIVIDERS: [string, string, number, number][]
  ROOM_LIGHTS: { zone: ZoneId; x: number; y: number; r: number; a: number }[]
  RECEPTION: { seat: { tx: number; ty: number }; front: { tx: number; ty: number; key: string }; entry: { tx: number; ty: number }; name: string }
  /** The office dog's places, if this office has one. */
  DOG: { bed: { tx: number; ty: number }; bowl: { tx: number; ty: number }; ball: { tx: number; ty: number } } | null
}

// ── the active office (live bindings: every importer sees the office in view) ──

export let OFFICE: OfficeLayout['type'] = 'startup'
export let ZONES: OfficeLayout['ZONES']
export let ZONE_LABEL: OfficeLayout['ZONE_LABEL']
export let ZONE_PURPOSE: OfficeLayout['ZONE_PURPOSE']
export let WALLS: Wall[]
export let FEATURE_WALL: Rect
export let ENTRANCE: { x: number; w: number }
export let DESKS: OfficeLayout['DESKS']
export let MEETING_SEATS: Record<string, Spot>
export let SPARE_MEETING_SEATS: Spot[]
export let FOCUS_SEATS: [Spot, Spot]
export let IDLE_SPOTS: Record<string, Spot[]>
export let PAIR_SPOTS: OfficeLayout['PAIR_SPOTS']
export let PLACEMENTS: Placement[]
export let WALL_DECOR: WallDecor
export let INTERACTIVES: Interactive[]
export let ROOM_LIGHTS: OfficeLayout['ROOM_LIGHTS']
export let RECEPTION: OfficeLayout['RECEPTION']
export let DOG: OfficeLayout['DOG']
let EMPTY_SLOT_DECOR: OfficeLayout['EMPTY_SLOT_DECOR']
let DESK_DIVIDERS: OfficeLayout['DESK_DIVIDERS']

/** Switch the office every module reads (call before building a scene). */
export function useLayout(l: OfficeLayout): void {
  OFFICE = l.type
  ;({ ZONES, ZONE_LABEL, ZONE_PURPOSE, WALLS, FEATURE_WALL, ENTRANCE, DESKS, MEETING_SEATS, SPARE_MEETING_SEATS, FOCUS_SEATS, IDLE_SPOTS, PAIR_SPOTS, PLACEMENTS, WALL_DECOR, INTERACTIVES, ROOM_LIGHTS, RECEPTION, DOG, EMPTY_SLOT_DECOR, DESK_DIVIDERS } = l)
}

const chair = (key: string, tx: number, ty: number, depthBias: number, dy = 0): Placement => ({ key, tx, ty, tw: 1, th: 1, blocks: false, depthBias, dy })

export type Grid = boolean[][] // [y][x] true = walkable

/** Furniture only for workstations someone sits at: there are never empty desks. */
export function deskPlacements(occupied: Iterable<string>): Placement[] {
  const used = new Set(occupied)
  return Object.entries(DESKS)
    .filter(([id]) => used.has(id))
    .flatMap(([id, d]) => [
      { key: `desk:${id}`, tx: d.desk.x, ty: d.desk.y, tw: d.desk.w, th: d.desk.h, blocks: true, id: `desk:${id}` },
      chair(`chair:office:${id}`, d.seat.tx, d.seat.ty, 4, 1)
    ])
    .concat(
      // acoustic dividers between paired desks, once either side of a pair is furnished
      DESK_DIVIDERS.filter(([a, b]) => used.has(a) || used.has(b)).map(([, , x, y]) => ({ key: 'deskDivider', tx: x, ty: y, tw: 2, th: 2, blocks: false, depthBias: 1 }))
    )
    .concat(EMPTY_SLOT_DECOR.filter((f) => f.desks.every((d) => !used.has(d))).map((f) => f.p))
}

/**
 * There are never empty desks: a workstation exists only for someone who sits at it. Where a
 * desk will go when the team grows, the floor holds planting instead (removed on that hire).
 */
/** Tiles covered by walls (doors excluded). */
export function wallTiles(): Set<string> {
  const out = new Set<string>()
  for (const w of WALLS) {
    for (let i = 0; i < w.len; i++) {
      if (w.doors?.some((d) => i >= d.at && i < d.at + d.w)) continue
      out.add(w.axis === 'h' ? `${w.x + i},${w.y}` : `${w.x},${w.y + i}`)
    }
  }
  const f = FEATURE_WALL
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) out.add(`${x},${y}`)
  return out
}

export function buildWalkGrid(placements: Placement[]): Grid {
  const walls = wallTiles()
  const g: Grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => y >= WALL_ROWS && y < ROWS - 1 && x > 0 && x < COLS - 1 && !walls.has(`${x},${y}`))
  )
  for (const p of placements) {
    if (p.key === 'phoneBooth') {
      // the booth's back half is solid; its seat row is walkable so a caller can sit inside
      for (let x = p.tx; x < p.tx + p.tw; x++) g[p.ty][x] = false
      g[p.ty + 1][p.tx + 1] = false
      continue
    }
    if (!p.blocks) continue
    for (let y = p.ty; y < p.ty + p.th; y++) for (let x = p.tx; x < p.tx + p.tw; x++) if (g[y]) g[y][x] = false
  }
  return g
}

export function zoneAt(tx: number, ty: number): ZoneId | null {
  for (const [k, z] of Object.entries(ZONES)) {
    if (k === 'corridor') continue
    if (tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h) return k as ZoneId
  }
  const c = ZONES.corridor
  return tx >= c.x && tx < c.x + c.w && ty >= c.y && ty < c.y + c.h ? 'corridor' : null
}

/** Every spot people must be able to reach; used to validate rearranged decor. */
export function requiredSpots(): { x: number; y: number }[] {
  const spots: Spot[] = [
    ...Object.values(DESKS).map((d) => d.seat),
    ...Object.values(MEETING_SEATS),
    ...SPARE_MEETING_SEATS,
    ...FOCUS_SEATS,
    ...Object.values(IDLE_SPOTS).flat(),
    ...PAIR_SPOTS.flatMap((p) => [p.a, p.b])
  ]
  return spots.map((s) => ({ x: s.tx, y: s.ty }))
}

/** True when every required spot is reachable from the entrance on this grid. */
export function allReachable(g: Grid): boolean {
  const start = { x: ENTRANCE.x + 1, y: ROWS - 2 }
  const seen = new Set<string>([`${start.x},${start.y}`])
  const queue = [start]
  while (queue.length) {
    const p = queue.shift()!
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const x = p.x + dx
      const y = p.y + dy
      const k = `${x},${y}`
      if (seen.has(k) || !g[y]?.[x]) continue
      seen.add(k)
      queue.push({ x, y })
    }
  }
  return requiredSpots().every((s) => seen.has(`${s.x},${s.y}`))
}

/** Ceiling lights per room (x, y in px, radius, intensity) for the night lightmap. */

// the original office until a project's office is chosen
useLayout(startupLayout)
