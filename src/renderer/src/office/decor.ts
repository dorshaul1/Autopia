// Where personal touches can go in the office in view. Pure: it reads the floor plan and a saved
// customization and answers "may this stand here?", so the same rules hold for dragging, for loading a
// saved office, and for an office whose plan or team has changed since it was arranged.

import { decorDef, wallDef, type DecorDef, type OfficeConfig } from '@shared/officeDecor'
import { COLS, DESKS, DOG, ENTRANCE, INTERACTIVES, PLACEMENTS, RECEPTION, ROWS, WALLS, WALL_DECOR, allReachable, buildWalkGrid, deskPlacements, requiredSpots, wallTiles, zoneAt, type Grid, type Placement } from './layout'

/** Can this piece be changed? Seats stay with the spot people sit on, so nobody ends up sitting on air. */
export const canMove = (p: Placement): boolean => !!p.uid && !p.key.startsWith('beanbag:')

/** A placement for a catalog piece. */
export function decorPlacement(def: DecorDef, uid: string, tx: number, ty: number): Placement {
  return { key: def.key, tx, ty, tw: def.tw, th: def.th, blocks: !def.flat, flat: def.flat, uid }
}

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/** Floor tiles beside a doorway or the front door: always left open. */
export function doorClearance(): Set<string> {
  const out = new Set<string>()
  for (const w of WALLS) {
    for (const d of w.doors ?? []) {
      for (let i = d.at; i < d.at + d.w; i++) {
        const [x, y] = w.axis === 'h' ? [w.x + i, w.y] : [w.x, w.y + i]
        for (let k = -2; k <= 2; k++) out.add(w.axis === 'h' ? `${x},${y + k}` : `${x + k},${y}`)
      }
    }
  }
  for (let x = ENTRANCE.x - 1; x <= ENTRANCE.x + ENTRANCE.w; x++) for (let y = ROWS - 5; y < ROWS; y++) out.add(`${x},${y}`)
  return out
}

/** Tiles people need: every seat and standing spot, the front desk, every workstation (even one nobody has yet). */
export function neededTiles(): Set<string> {
  const out = new Set(requiredSpots().map((s) => `${s.x},${s.y}`))
  for (const d of Object.values(DESKS)) {
    for (let y = d.desk.y; y < d.desk.y + d.desk.h; y++) for (let x = d.desk.x; x < d.desk.x + d.desk.w; x++) out.add(`${x},${y}`)
    out.add(`${d.seat.tx},${d.seat.ty}`)
  }
  for (const t of [RECEPTION.seat, RECEPTION.front, RECEPTION.entry]) out.add(`${t.tx},${t.ty}`)
  // the front desk carries the AUTOPIA name: nothing tall stands in front of it
  const desk = PLACEMENTS.find((p) => p.id === 'reception')
  if (desk) for (let y = desk.ty + desk.th; y < desk.ty + desk.th + 3; y++) for (let x = desk.tx - 1; x < desk.tx + desk.tw + 1; x++) out.add(`${x},${y}`)
  return out
}

/** Things you click in the room that have a footprint of their own. */
function propTiles(): Set<string> {
  const out = new Set<string>()
  for (const i of INTERACTIVES) {
    if (i.id.startsWith('room:') || i.id.startsWith('desk:') || i.rect.y < 4) continue
    for (let y = Math.floor(i.rect.y); y < i.rect.y + i.rect.h; y++) for (let x = Math.floor(i.rect.x); x < i.rect.x + i.rect.w; x++) out.add(`${x},${y}`)
  }
  return out
}

export interface PlaceContext {
  walls: Set<string>
  doors: Set<string>
  needed: Set<string>
  props: Set<string>
}

/** The rules for this office. Its dog's corner counts as needed, wherever it has been moved to. */
export function placeContext(cfg?: OfficeConfig): PlaceContext {
  const needed = neededTiles()
  if (DOG) {
    const bed = cfg?.dog.bed ?? DOG.bed
    for (const [x, y] of [
      [bed.tx, bed.ty],
      [bed.tx + 1, bed.ty],
      [bed.tx + 2, bed.ty],
      [DOG.ball.tx, DOG.ball.ty]
    ]) needed.add(`${x},${y}`)
  }
  return { walls: wallTiles(), doors: doorClearance(), needed, props: propTiles() }
}

/** Why one tile can't take a piece, in the words the office shows; null when it can. */
export function tileProblem(ctx: PlaceContext, grid: Grid, x: number, y: number, flat: boolean, walkableToo = false): string | null {
  if (x < 1 || y < 4 || x >= COLS - 1 || y >= ROWS - 1 || ctx.walls.has(`${x},${y}`)) return 'That’s a wall.'
  const zone = zoneAt(x, y)
  if (!zone) return 'That’s a doorway. Doors stay clear.'
  if (ctx.doors.has(`${x},${y}`)) return flat && !walkableToo ? null : 'Doors stay clear.'
  if (flat && !walkableToo) return null
  if (!grid[y]?.[x]) return 'Something’s already there.'
  if (zone === 'corridor') return 'The corridor stays clear.'
  if (ctx.needed.has(`${x},${y}`)) return 'Someone needs that spot.'
  if (!flat && ctx.props.has(`${x},${y}`)) return 'That would get in the way of something people use.'
  return null
}

/**
 * Why a piece can't stand here; null when it can. `others` is the office without the piece itself.
 * A rug lies on the floor and stays in one room, and only one rug per spot. Anything solid must also leave
 * every seat, desk and standing spot reachable from the front door.
 */
export function spotProblem(ctx: PlaceContext, others: Placement[], def: { tw: number; th: number; flat?: boolean; walkableToo?: boolean }, tx: number, ty: number): string | null {
  const grid = buildWalkGrid(others)
  const flat = !!def.flat
  const room = zoneAt(tx, ty)
  for (let y = ty; y < ty + def.th; y++) {
    for (let x = tx; x < tx + def.tw; x++) {
      const why = tileProblem(ctx, grid, x, y, flat, def.walkableToo)
      if (why) return why
      if (flat && zoneAt(x, y) !== room) return 'A rug stays inside one room.'
      if (flat && !def.walkableToo && others.some((p) => p.flat && inRect(x, y, { x: p.tx, y: p.ty, w: p.tw, h: p.th }))) return 'There’s already a rug there.'
    }
  }
  if (flat) return null
  const test = buildWalkGrid([...others, { key: 'test', tx, ty, tw: def.tw, th: def.th, blocks: true }])
  return allReachable(test) ? null : 'That would block a way through the office.'
}

/**
 * The office as saved: what it came with (moved, swapped or taken away), plus what was added. Anything that
 * no longer fits falls back quietly: a moved piece goes home, an added one stays out of sight. Saved data is
 * left alone, so it comes back if the office changes again.
 */
export function resolveDecor(cfg: OfficeConfig, occupiedDesks: Iterable<string>): Placement[] {
  const ctx = placeContext(cfg)
  const fixed = [...PLACEMENTS.filter((p) => !p.uid), ...deskPlacements(occupiedDesks)]
  const placed = [...fixed]
  const defaults = PLACEMENTS.filter((p) => p.uid && !(canMove(p) && cfg.removed.includes(p.uid)))
  // what stays home goes down first, so anything moved has to fit around it
  const stayHome = defaults.filter((p) => !(cfg.moves[p.uid!] && canMove(p)))
  for (const p of stayHome) placed.push(swapped(p, cfg))
  for (const p of defaults) {
    const to = cfg.moves[p.uid!]
    if (!to || !canMove(p)) continue
    const q = swapped(p, cfg)
    const ok = !spotProblem(ctx, placed, q, to.tx, to.ty)
    placed.push(ok ? { ...q, tx: to.tx, ty: to.ty } : q)
  }
  for (const item of cfg.items) {
    const def = decorDef(item.key)
    if (!def) continue
    if (!spotProblem(ctx, placed, def, item.tx, item.ty)) placed.push(decorPlacement(def, item.id, item.tx, item.ty))
  }
  return placed
}

function swapped(p: Placement, cfg: OfficeConfig): Placement {
  const key = cfg.swaps[p.uid!]
  return key && canMove(p) && decorDef(key) && !decorDef(key)!.flat ? { ...p, key } : p
}

// ── walls ────────────────────────────────────────────────────

/** Wall tiles already taken on the north wall: windows, boards, screens, and furniture tall enough to reach. */
export function takenWall(placements: Placement[], heightOf: (p: Placement) => number, screens: { x: number; w: number }[] = []): Set<number> {
  const out = new Set<number>()
  const mark = (x: number, w: number) => {
    for (let i = x; i < x + w; i++) out.add(i)
  }
  const D = WALL_DECOR
  for (const w of D.windows) mark(w.x, w.w)
  for (const p of D.posters) mark(p.x, 2)
  mark(D.clock.x, 1)
  for (const c of screens) mark(c.x, c.w)
  mark(D.roadmap.x, D.roadmap.w)
  mark(D.meetingTv.x, D.meetingTv.w)
  mark(D.whiteboard.x, D.whiteboard.w)
  for (const c of D.upperCabinets) mark(c.x, c.w)
  mark(D.coffeeMenu.x, D.coffeeMenu.w)
  for (const i of INTERACTIVES) if (!i.id.startsWith('room:') && i.rect.y < 4) mark(Math.floor(i.rect.x), Math.ceil(i.rect.w))
  for (const w of WALLS) if (w.axis === 'v' && w.y === 4) out.add(w.x)
  // what stands against the wall hides it once it's taller than the art's lower edge
  for (const p of placements) if (p.ty <= 5 && p.ty + p.th >= 5 && heightOf(p) > (p.ty + p.th - 4) * 16 + 18) mark(p.tx, p.tw)
  return out
}

/** Why a wall piece can't hang here; null when it can. */
export function wallProblem(taken: Set<number>, hung: { id: string; key: string; x: number }[], self: string | null, key: string, x: number): string | null {
  const w = wallDef(key)?.w ?? 2
  if (x < 1 || x + w > COLS - 1) return 'That’s the end of the wall.'
  for (let i = x; i < x + w; i++) if (taken.has(i)) return 'There’s no room on that bit of wall.'
  for (const h of hung) {
    if (h.id === self) continue
    const hw = wallDef(h.key)?.w ?? 2
    if (x < h.x + hw && h.x < x + w) return 'Something’s already hanging there.'
  }
  return null
}

export const DOG_BED_SIZE = { tw: 2, th: 1, flat: true, walkableToo: true }

/** The dog's corner: the bed's tiles, wherever you put it (or where this office puts it). */
export function dogBedAt(cfg: OfficeConfig, placements: Placement[]): { tx: number; ty: number } | null {
  if (!DOG) return null
  const to = cfg.dog.bed
  if (to && !spotProblem(placeContext(), placements, DOG_BED_SIZE, to.tx, to.ty)) return to
  return DOG.bed
}
