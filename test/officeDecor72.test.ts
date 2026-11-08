// Phase 72: personal touches. Every office is checked: what the rules allow can never strand anyone.
import { describe, expect, it } from 'vitest'
import { CATALOG, DEFAULT_OFFICE, FLOOR_DECOR, MAX_ITEMS, PICTURE_H, PICTURE_W, SIGN_MAX, WALL_ITEMS, changesIn, cleanSign, encodePicture, layoutReset, sanitizeOffice, signFor, validPicture, type OfficeConfig } from '../src/shared/officeDecor'
import { COLS, DESKS, PLACEMENTS, ROWS, allReachable, buildWalkGrid, deskPlacements, requiredSpots, useLayout, type Placement } from '../src/renderer/src/office/layout'
import { LAYOUTS } from '../src/renderer/src/office/offices'
import { canMove, decorPlacement, doorClearance, dogBedAt, neededTiles, placeContext, resolveDecor, spotProblem, takenWall, wallProblem } from '../src/renderer/src/office/decor'

const cfg = (p: Partial<OfficeConfig> = {}): OfficeConfig => ({ ...DEFAULT_OFFICE, ...p })
const TYPES = ['startup', 'studio', 'lab'] as const

describe.each(TYPES)('placing things in the %s', (type) => {
  const setup = () => {
    useLayout(LAYOUTS[type])
    const desks = Object.keys(DESKS)
    const base = [...PLACEMENTS, ...deskPlacements(desks)]
    return { desks, base, ctx: placeContext() }
  }

  it('an untouched office is exactly the office as it came', () => {
    const { desks, base } = setup()
    const out = resolveDecor(cfg(), desks)
    expect(new Set(out.map((p) => `${p.key}@${p.tx},${p.ty}`))).toEqual(new Set(base.map((p) => `${p.key}@${p.tx},${p.ty}`)))
  })

  it('every spot the rules allow keeps every seat, desk and standing spot reachable', () => {
    const { base, ctx } = setup()
    const needed = neededTiles()
    let allowed = 0
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (spotProblem(ctx, base, { tw: 1, th: 1 }, x, y)) continue
        allowed++
        const g = buildWalkGrid([...base, { key: 'x', tx: x, ty: y, tw: 1, th: 1, blocks: true }])
        expect(allReachable(g)).toBe(true)
        expect(needed.has(`${x},${y}`)).toBe(false)
      }
    }
    // and there's real room to play with
    expect(allowed).toBeGreaterThan(60)
  })

  it('refuses walls, doors, seats, desks (even ones nobody has yet), furniture and the corridor', () => {
    const { base, ctx } = setup()
    const one = { tw: 1, th: 1 }
    expect(spotProblem(ctx, base, one, 0, 10)).toBeTruthy()
    expect(spotProblem(ctx, base, one, 10, 2)).toBeTruthy()
    for (const k of [...doorClearance()].slice(0, 30)) {
      const [x, y] = k.split(',').map(Number)
      expect(spotProblem(ctx, base, one, x, y)).toBeTruthy()
    }
    for (const s of requiredSpots().slice(0, 40)) expect(spotProblem(ctx, base, one, s.x, s.y)).toBeTruthy()
    for (const d of Object.values(DESKS)) expect(spotProblem(ctx, [], one, d.desk.x, d.desk.y)).toBeTruthy()
    const solid = base.find((p) => p.blocks && !p.uid)!
    expect(spotProblem(ctx, base, one, solid.tx, solid.ty)).toBeTruthy()
  })

  it('a rug lies on the floor: people walk over it, it stays in one room, and only one rug per spot', () => {
    const { desks, ctx, base } = setup()
    const rug = FLOOR_DECOR.find((d) => d.key === 'rug:check')!
    let spot: { tx: number; ty: number } | null = null
    for (let y = 5; y < ROWS && !spot; y++) for (let x = 2; x < COLS && !spot; x++) if (!spotProblem(ctx, base, rug, x, y)) spot = { tx: x, ty: y }
    expect(spot).toBeTruthy()
    const placed = decorPlacement(rug, 'r1', spot!.tx, spot!.ty)
    expect(placed.blocks).toBe(false)
    expect(allReachable(buildWalkGrid([...base, placed]))).toBe(true)
    expect(spotProblem(ctx, [...base, placed], rug, spot!.tx, spot!.ty)).toMatch(/rug/)
    expect(resolveDecor(cfg({ items: [{ id: 'r1', key: 'rug:check', tx: spot!.tx, ty: spot!.ty }] }), desks).some((p) => p.uid === 'r1')).toBe(true)
  })

  it('a saved office that no longer fits falls back quietly, piece by piece', () => {
    const { desks } = setup()
    const movable = PLACEMENTS.find((p) => p.uid && canMove(p))!
    const out = resolveDecor(
      cfg({
        moves: { [movable.uid!]: { tx: 0, ty: 0 }, ghost: { tx: 10, ty: 10 } },
        items: [
          { id: 'onWall', key: 'plant:fig', tx: 0, ty: 0 },
          { id: 'gone', key: 'plant:fig', tx: 9999, ty: 5 }
        ]
      }),
      desks
    )
    const home = out.find((p) => p.uid === movable.uid)!
    expect([home.tx, home.ty]).toEqual([movable.tx, movable.ty])
    expect(out.some((p) => p.uid === 'onWall' || p.uid === 'gone')).toBe(false)
    expect(allReachable(buildWalkGrid(out))).toBe(true)
  })

  it('seats stay with the spot people sit on, even if an old save moved them', () => {
    const { desks } = setup()
    const seat = PLACEMENTS.find((p) => p.key.startsWith('beanbag:'))!
    const out = resolveDecor(cfg({ moves: { [seat.uid!]: { tx: seat.tx + 3, ty: seat.ty } }, removed: [seat.uid!] }), desks)
    const kept = out.find((p) => p.uid === seat.uid)!
    expect([kept.tx, kept.ty]).toEqual([seat.tx, seat.ty])
  })

  it('swaps and removals change only the piece they name', () => {
    const { desks } = setup()
    const [a, b] = PLACEMENTS.filter((p) => p.uid && canMove(p))
    const out = resolveDecor(cfg({ swaps: { [a.uid!]: 'plant:palm' }, removed: [b.uid!] }), desks)
    expect(out.find((p) => p.uid === a.uid)!.key).toBe('plant:palm')
    expect(out.some((p) => p.uid === b.uid)).toBe(false)
  })

  it('the wall takes pieces only where there is room', () => {
    setup()
    const taken = takenWall(PLACEMENTS, () => 60)
    const free = WALL_ITEMS.some((w) => {
      for (let x = 1; x < COLS - 1; x++) if (!wallProblem(taken, [], null, w.key, x)) return true
      return false
    })
    expect(free).toBe(true)
    const hung = [{ id: 'a', key: 'wall:neon', x: 5 }]
    expect(wallProblem(new Set(), hung, null, 'wall:shelf', 5)).toBeTruthy()
    expect(wallProblem(new Set(), hung, 'a', 'wall:neon', 5)).toBeNull()
    expect(wallProblem(new Set([9]), [], null, 'wall:shelf', 8)).toBeTruthy()
    expect(wallProblem(new Set(), [], null, 'wall:shelf', 0)).toBeTruthy()
  })
})

describe('the catalog stays small and curated', () => {
  it('shows every piece exactly once, under a real category', () => {
    const listed = CATALOG.flatMap((c) => c.sections.flatMap((s) => s.keys))
    expect(new Set(listed).size).toBe(listed.length)
    expect(new Set(listed)).toEqual(new Set([...FLOOR_DECOR.map((d) => d.key), ...WALL_ITEMS.map((w) => w.key)]))
    expect(CATALOG.map((c) => c.label)).toEqual(['Furniture', 'Decor', 'Walls', 'Floors', 'Lighting'])
  })
  it('has a modest number of pieces, each with a known kind and size', () => {
    expect(FLOOR_DECOR.length).toBeLessThanOrEqual(24)
    expect(WALL_ITEMS.length).toBeLessThanOrEqual(12)
    expect(new Set(FLOOR_DECOR.map((d) => d.key)).size).toBe(FLOOR_DECOR.length)
  })
  it.each(TYPES)('the %s has room for its own sign and easel on the floor, whatever its wall is like', (type) => {
    useLayout(LAYOUTS[type])
    const ctx = placeContext()
    const base = [...PLACEMENTS, ...deskPlacements(Object.keys(DESKS))]
    const sign = FLOOR_DECOR.find((d) => d.key === 'decor:sign')!
    let spots = 0
    for (let y = 5; y < ROWS; y++) for (let x = 1; x < COLS; x++) if (!spotProblem(ctx, base, sign, x, y)) spots++
    expect(spots).toBeGreaterThan(3)
    useLayout(LAYOUTS.startup)
  })
})

describe('the dog’s corner', () => {
  it('the bed goes where you put it, and home if that spot stops working', () => {
    useLayout(LAYOUTS.startup)
    const base = [...PLACEMENTS, ...deskPlacements(['desk-pm'])]
    const home = LAYOUTS.startup.DOG!.bed
    expect(dogBedAt(cfg(), base)).toEqual(home)
    expect(dogBedAt(cfg({ dog: { ...DEFAULT_OFFICE.dog, bed: { tx: 20, ty: 29 } } }), base)).toEqual({ tx: 20, ty: 29 })
    // a wall tile isn't a bed
    expect(dogBedAt(cfg({ dog: { ...DEFAULT_OFFICE.dog, bed: { tx: 0, ty: 0 } } }), base)).toEqual(home)
  })
  it('offices without a dog have no corner', () => {
    useLayout(LAYOUTS.studio)
    expect(dogBedAt(cfg({ dog: { ...DEFAULT_OFFICE.dog, bed: { tx: 20, ty: 29 } } }), [])).toBeNull()
    useLayout(LAYOUTS.startup)
  })
  it('nothing solid goes on his corner, wherever it is', () => {
    useLayout(LAYOUTS.startup)
    const bed = { tx: 20, ty: 29 }
    const ctx = placeContext(cfg({ dog: { ...DEFAULT_OFFICE.dog, bed } }))
    expect(spotProblem(ctx, PLACEMENTS as Placement[], { tw: 1, th: 1 }, bed.tx + 1, bed.ty)).toBeTruthy()
  })
})

describe('what a saved customization may contain', () => {
  it('an old record keeps its look and gains the defaults', () => {
    const c = sanitizeOffice({ accent: 'sage', art: 'wave', moves: { 'eng-plant-1': { tx: 3, ty: 9 } } })
    expect(c.accent).toBe('sage')
    expect(c.art).toBe('wave')
    expect(c.moves['eng-plant-1']).toEqual({ tx: 3, ty: 9 })
    expect(c.items).toEqual([])
    expect(c.dog.toy).toBe('ball')
  })

  it('anything unknown or damaged is dropped, not trusted', () => {
    for (const bad of [null, 42, 'x', [], { accent: '<script>', art: 1, moves: 5, items: 'no', wall: {}, light: 'blink', dog: 7, picture: 'javascript:alert(1)', sign: 9 }]) {
      const c = sanitizeOffice(bad)
      expect(c.accent).toBe('terracotta')
      expect(c.items).toEqual([])
      expect(c.picture).toBe('')
    }
    const c = sanitizeOffice({
      items: [
        { id: 'a', key: 'removed:from:catalog', tx: 1, ty: 1 },
        { id: 'b', key: 'plant:fig', tx: 'x', ty: 1 },
        { id: '<img>', key: 'plant:fig', tx: 1, ty: 1 },
        { id: 'c', key: 'plant:fig', tx: 1, ty: 1 },
        { id: 'c', key: 'plant:fig', tx: 2, ty: 1 }
      ],
      wall: [{ id: 'w', key: 'wall:video', x: 1 }],
      swaps: { u: 'exe:thing' },
      moves: { ['x'.repeat(99)]: { tx: 1, ty: 1 } }
    })
    expect(c.items).toEqual([{ id: 'c', key: 'plant:fig', tx: 1, ty: 1 }])
    expect(c.wall).toEqual([])
    expect(c.swaps).toEqual({})
    expect(c.moves).toEqual({})
  })

  it('there is a limit to how much can be saved', () => {
    const items = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ id: `i${i}`, key: 'plant:small', tx: 1, ty: 1 }))
    expect(sanitizeOffice({ items }).items).toHaveLength(MAX_ITEMS)
  })

  it('a sign is only ever the pixel font’s letters and digits', () => {
    expect(cleanSign('<b>hi</b>').trim()).toBe('B HI B')
    expect(cleanSign('Café 42!').trim()).toBe('CAFE 42')
    expect(cleanSign('x'.repeat(50))).toHaveLength(SIGN_MAX)
    expect(cleanSign(null)).toBe('')
    expect(sanitizeOffice({ sign: 'hello<>' }).sign).toBe('HELLO')
  })

  it('a project’s sign defaults to its name, in whole words when it’s long', () => {
    expect(signFor('coffee shop')).toBe('COFFEE')
    expect(signFor('Tiny')).toBe('TINY')
    expect(signFor('TinyPark Polished Playable')).toBe('TINYPARK')
    expect(signFor('Supercalifragilistic').length).toBeLessThanOrEqual(SIGN_MAX)
  })

  it('a picture is reduced to palette numbers: nothing of the file is kept', () => {
    const rgba = new Uint8ClampedArray(PICTURE_W * PICTURE_H * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200
      rgba[i + 1] = 80
      rgba[i + 2] = 40
      rgba[i + 3] = 255
    }
    const p = encodePicture(rgba)
    expect(p).toHaveLength(PICTURE_W * PICTURE_H)
    expect(validPicture(p)).toBe(true)
    expect(sanitizeOffice({ picture: p }).picture).toBe(p)
    expect(validPicture(`${p}0`)).toBe(false)
    expect(validPicture('<svg onload=alert(1)>')).toBe(false)
  })

  it('reset puts the layout back and keeps your words and picture; changes are counted', () => {
    const c = cfg({ items: [{ id: 'a', key: 'plant:fig', tx: 1, ty: 1 }], wall: [{ id: 'w', key: 'wall:neon', x: 3 }], moves: { m: { tx: 1, ty: 1 } }, removed: ['r'], swaps: { s: 'bin' }, sign: 'HELLO', picture: 'x', light: 'rose', dog: { bed: { tx: 1, ty: 1 }, bedStyle: 'plum', toy: 'duck' } })
    expect(changesIn(c)).toBe(6)
    const r = layoutReset(c)
    expect(changesIn(r)).toBe(0)
    expect([r.sign, r.picture, r.light, r.dog.bedStyle, r.dog.toy]).toEqual(['HELLO', 'x', 'rose', 'plum', 'duck'])
  })
})
