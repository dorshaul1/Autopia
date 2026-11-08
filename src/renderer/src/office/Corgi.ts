import Phaser from 'phaser'
import { DOG_COLS, DOG_FEET, DOG_H, DOG_ROW, DOG_W, corgiSheet, dogFrame, waterBowl } from './art/corgi'
import { TILE, type Grid } from './layout'
import { findPath, type Pt } from './pathfinding'
import { BALL_HOME, DOG, DOG_BED, DOG_BOWL, cooled, dogRandom, nextDogBehavior, nextReaction, spendEnergy, type DogBehavior, type DogReaction } from './dog'

const FEET_Y = 12
const WALK = 44 // px/s: short legs, busy trot
const RUN = 100

type Side = 'left' | 'right'
type Facing = Side | 'up' | 'down'

/** A teammate as the dog sees them (positions only; nothing about their work beyond "busy"). */
export interface DogPerson {
  id: string
  x: number
  y: number
  walking: boolean
  /** Not on real work and free for a cosmetic moment. */
  idle: boolean
  /** Standing or sitting still somewhere (not walking). */
  settled: boolean
  /** Seat tile of someone working at their desk right now, if they are. */
  workingSeat: Pt | null
  /** How much this person and the dog like each other (their love of dogs + familiarity). */
  affinity: number
}

export interface DogHost {
  grid: Grid
  reserveTile(x: number, y: number, id: string): boolean
  releaseTile(x: number, y: number, id: string): void
  blockedByOthers(id: string): Set<string>
  reducedMotion(): boolean
  people(): DogPerson[]
  /** Blocking furniture footprints (for sniffing). */
  furniture(): { tx: number; ty: number; tw: number; th: number }[]
  /** A teammate gives the dog a quick pat (a heart over them). */
  pat(id: string): void
  /** Line of sight within a radius (tiles): she doesn't notice people through walls. */
  canSee(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean
  /** Rugs someone has laid down: soft places to nap. */
  rugs(): { tx: number; ty: number; tw: number; th: number }[]
  /** The bed's colour and his favourite toy, as this project has them. */
  bedTexture: string
  toyTexture: string
}

type Step =
  | { kind: 'walk'; to: Pt; run?: boolean; offset?: Pt }
  | { kind: 'pose'; anim: string; ms: number; face?: Facing; sleeping?: boolean }
  | { kind: 'follow'; id: string; ms: number }
  | { kind: 'call'; fn: () => void }

/**
 * Puffy, the office corgi. Atmospheric only: not an employee, not an agent, no stats. Wanders, sniffs,
 * follows and visits idle teammates, naps in her bed or beside someone working, plays with her ball,
 * and reacts when you click her. All local timers and a seeded generator.
 */
export class Corgi {
  readonly id = DOG.id
  readonly sprite: Phaser.GameObjects.Sprite
  private shadow: Phaser.GameObjects.Image
  private ball: Phaser.GameObjects.Image
  private bubble: Phaser.GameObjects.Image | null = null
  private bubbleUntil = 0
  private rand = dogRandom((Date.now() >>> 3) & 0xffff)
  private behavior: DogBehavior | null = null
  private lastStarted: Partial<Record<DogBehavior, number>> = {}
  private energy = 0.6
  private steps: Step[] = []
  private step: Step | null = null
  private stepEnds = 0
  private path: Pt[] = []
  private running = false
  private offset: Pt = { x: 0, y: 0 }
  private tile: Pt
  private x: number
  private y: number
  private facing: Facing = 'left'
  private waited = 0
  private stuck = 0
  private carrying = false
  private followNext = 0
  private lastReaction: DogReaction | null = null
  private lastLook = -Infinity
  private patted = new Map<string, number>()
  private nextWatch = 0
  private props: Phaser.GameObjects.Image[] = []

  constructor(
    private scene: Phaser.Scene,
    private host: DogHost
  ) {
    const key = 'dog:sheet'
    if (scene.textures.exists(key)) scene.textures.remove(key)
    const sheet = corgiSheet()
    const tex = scene.textures.addCanvas(key, sheet)!
    for (let i = 0; i < (sheet.height / DOG_H) * DOG_COLS; i++) tex.add(i, 0, (i % DOG_COLS) * DOG_W, Math.floor(i / DOG_COLS) * DOG_H, DOG_W, DOG_H)
    this.createAnims(key)
    if (!scene.textures.exists('dog:bowl')) scene.textures.addCanvas('dog:bowl', waterBowl())
    // her corner by the front desk: bed and water bowl lie on the floor (they block nothing)
    this.props = [
      scene.add.image(0, 0, host.bedTexture).setOrigin(0.5, 1),
      scene.add.image(0, 0, 'dog:bowl').setOrigin(0.5, 1)
    ]
    this.placeCorner()
    this.ball = scene.add.image(BALL_HOME.tx * TILE + 8, BALL_HOME.ty * TILE + 12, host.toyTexture).setOrigin(0.5, 1).setDepth(BALL_HOME.ty * TILE + 4)

    // starts asleep in her bed
    this.tile = { x: DOG_BED.tx, y: DOG_BED.ty }
    this.x = this.tile.x * TILE + 8
    this.y = this.tile.y * TILE + FEET_Y
    this.offset = { x: 8, y: 0 }
    host.reserveTile(this.tile.x, this.tile.y, this.id)
    this.shadow = scene.add.image(this.x, this.y, 'shadow:char').setDepth(1).setScale(1.4, 1)
    this.sprite = scene.add
      .sprite(this.x, this.y, key, dogFrame(DOG_ROW.lieL, 1))
      .setOrigin(0.5, (DOG_FEET + 0.5) / DOG_H)
      .setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 })
    this.place()
    this.steps = [{ kind: 'pose', anim: 'sleep-left', ms: 8000 + this.rand() * 10_000, sleeping: true }, ...this.wakeUp('left')]
  }

  private placeCorner(): void {
    const [bed, bowl] = this.props
    bed.setPosition((DOG_BED.tx + 1) * TILE, (DOG_BED.ty + 1) * TILE - 2).setDepth((DOG_BED.ty + 1) * TILE - 14)
    bowl.setPosition(DOG_BOWL.tx * TILE + 9, (DOG_BOWL.ty + 1) * TILE - 3).setDepth((DOG_BOWL.ty + 1) * TILE - 12)
  }

  /** The bed itself, for moving it about. */
  get bedSprite(): Phaser.GameObjects.Image {
    return this.props[0]
  }

  private drop(steps: Step[]): void {
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = steps
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** His bed has been moved: he goes straight over, gives it a thorough sniff, and tries it out. */
  bedMoved(): void {
    this.placeCorner()
    const wake = this.asleep ? this.wakeUp(this.side()) : []
    this.offset = { x: 0, y: 0 }
    this.drop([
      ...wake,
      { kind: 'walk', to: { x: DOG_BED.tx, y: DOG_BED.ty }, offset: { x: 8, y: 0 } },
      { kind: 'pose', anim: 'sniff-left', ms: 1600, face: 'left' },
      { kind: 'call', fn: () => this.showBubble('heart', 1400) },
      { kind: 'pose', anim: 'lie-left', ms: 3200, face: 'left' },
      ...this.wakeUp('left').slice(1)
    ])
  }

  /** The bed in a new colour. He notices, but not enough to get up. */
  setBed(texture: string): void {
    this.props[0].setTexture(texture)
  }

  /** A different favourite toy: worth getting up for. He runs over and plays with it. */
  setToy(texture: string): void {
    this.ball.setTexture(texture)
    this.ball.removeInteractive()
    this.ball.setInteractive({ useHandCursor: true })
    const wake = this.asleep ? this.wakeUp(this.side()) : []
    this.drop([...wake, ...this.toySteps(true)])
  }

  /** Something new has appeared: if he's up, he has to go and check it out. */
  noticeNew(t: Pt): void {
    if (this.asleep) return
    const at = this.besideTile(t)
    if (!at) return
    const face: Side = t.x < at.x ? 'left' : 'right'
    this.drop([{ kind: 'walk', to: at }, { kind: 'pose', anim: `sniff-${face}`, ms: 1900, face }, { kind: 'call', fn: () => this.showBubble('heart', 1100) }, { kind: 'pose', anim: 'sit', ms: 1200 }])
  }

  /** The floor changed: a route through something solid is no route at all. */
  gridChanged(): void {
    if (this.path.some((t) => !this.host.grid[t.y]?.[t.x])) {
      this.path = []
      this.steps = []
      this.step = null
    }
  }

  private toySteps(run = false): Step[] {
    const ballTile = { x: Math.floor(this.ball.x / TILE), y: Math.floor((this.ball.y - 1) / TILE) }
    const drop = this.randomTileNear(ballTile.x, ballTile.y, 7, 3)
    if (!drop || !this.host.grid[ballTile.y]?.[ballTile.x]) return []
    return [
      { kind: 'walk', to: ballTile, run },
      { kind: 'pose', anim: `bow-${this.side()}`, ms: 900 },
      { kind: 'call', fn: () => (this.carrying = true) },
      { kind: 'walk', to: drop },
      { kind: 'call', fn: () => this.dropBall() },
      { kind: 'pose', anim: `bow-${this.side()}`, ms: 1200 },
      { kind: 'pose', anim: `wiggle-${this.side()}`, ms: 1100 }
    ]
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y }
  }

  /** Tearing about with the zoomies. */
  get zooming(): boolean {
    return this.running && this.path.length > 0
  }

  /** Walking or running right now (trotting past is worth a look). */
  get moving(): boolean {
    return this.path.length > 0
  }

  get asleep(): boolean {
    return this.step?.kind === 'pose' && !!this.step.sleeping
  }

  private createAnims(key: string): void {
    const a = this.scene.anims
    const mk = (name: string, frames: [number, number][], fps: number, repeat = -1) => {
      const full = `dog:${name}`
      if (a.exists(full)) a.remove(full)
      a.create({ key: full, frames: frames.map(([row, col]) => ({ key, frame: dogFrame(row, col) })), frameRate: fps, repeat })
    }
    const four = (row: number): [number, number][] => [0, 1, 2, 3].map((c) => [row, c])
    const R = DOG_ROW
    mk('walk-left', four(R.walkL), 9)
    mk('walk-right', four(R.walkR), 9)
    mk('walk-down', four(R.walkDown), 8)
    mk('walk-up', four(R.walkUp), 8)
    mk('run-left', four(R.runL), 15)
    mk('run-right', four(R.runR), 15)
    mk('run-down', four(R.walkDown), 14)
    mk('run-up', four(R.walkUp), 14)
    mk('sit', [[R.sit, 0], [R.sit, 0], [R.sit, 0], [R.sit, 0], [R.sit, 3], [R.sit, 0], [R.sit, 0], [R.happy, 2], [R.sit, 0], [R.sit, 0], [R.happy, 3]], 2)
    mk('tilt', [[R.sit, 1]], 1)
    mk('paw', [[R.sit, 2]], 1)
    mk('pant', [[R.happy, 1], [R.sit, 0], [R.happy, 1], [R.happy, 1], [R.sit, 3]], 4)
    mk('hop', [[R.happy, 0], [R.sit, 0], [R.happy, 0], [R.sit, 0]], 5, 0)
    for (const [s, lie, act, walk] of [
      ['left', R.lieL, R.actL, R.walkL],
      ['right', R.lieR, R.actR, R.walkR]
    ] as const) {
      mk(`lie-${s}`, [[lie, 0], [lie, 0], [lie, 0], [lie, 1], [lie, 0]], 1.5)
      mk(`sleep-${s}`, [[lie, 1], [lie, 1], [lie, 2], [lie, 2]], 1.2)
      mk(`belly-${s}`, [[lie, 3]], 1)
      mk(`sniff-${s}`, [[act, 0], [act, 1], [act, 0], [act, 0], [act, 1], [act, 1]], 4)
      mk(`bow-${s}`, [[act, 2]], 1)
      mk(`wiggle-${s}`, [[act, 3], [walk, 0], [act, 3], [walk, 0]], 9)
    }
    mk('look-left', [[R.happy, 2]], 1)
    mk('look-right', [[R.happy, 3]], 1)
  }

  // ── behaviour scripts ───────────────────────────────────────

  private side(): Side {
    return this.facing === 'right' ? 'right' : 'left'
  }

  private wakeUp(side: Side): Step[] {
    // blink awake, a big play-bow stretch, a happy wiggle
    return [
      { kind: 'pose', anim: `lie-${side}`, ms: 1500 },
      { kind: 'pose', anim: `bow-${side}`, ms: 1300 },
      { kind: 'pose', anim: `wiggle-${side}`, ms: 900 }
    ]
  }

  private sleep(ms: number, side: Side): Step[] {
    const reduced = this.host.reducedMotion()
    const nap: Step[] = [
      { kind: 'pose', anim: `lie-${side}`, ms: 2500 },
      { kind: 'pose', anim: reduced ? `lie-${side}` : `sleep-${side}`, ms: ms * 0.55, sleeping: true }
    ]
    // sometimes she rolls onto her back for a while
    if (this.rand() < 0.45) nap.push({ kind: 'pose', anim: `belly-${side}`, ms: 4000 + this.rand() * 5000, sleeping: true })
    nap.push({ kind: 'pose', anim: reduced ? `lie-${side}` : `sleep-${side}`, ms: ms * 0.45, sleeping: true })
    return [...nap, ...this.wakeUp(side)]
  }

  private randomTileNear(cx: number, cy: number, radius: number, min = 2): Pt | null {
    const blocked = this.host.blockedByOthers(this.id)
    for (let i = 0; i < 24; i++) {
      const x = Math.round(cx + (this.rand() * 2 - 1) * radius)
      const y = Math.round(cy + (this.rand() * 2 - 1) * radius)
      if (Math.abs(x - cx) + Math.abs(y - cy) < min) continue
      if (this.host.grid[y]?.[x] && !blocked.has(`${x},${y}`) && y > 4) return { x, y }
    }
    return null
  }

  /** A free walkable tile next to a target tile, nearest to the dog. */
  private besideTile(t: Pt): Pt | null {
    const blocked = this.host.blockedByOthers(this.id)
    const options = [
      { x: t.x - 1, y: t.y },
      { x: t.x + 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 }
    ].filter((p) => this.host.grid[p.y]?.[p.x] && !blocked.has(`${p.x},${p.y}`))
    options.sort((a, b) => Math.hypot(a.x - this.tile.x, a.y - this.tile.y) - Math.hypot(b.x - this.tile.x, b.y - this.tile.y))
    return options[0] ?? null
  }

  private plan(kind: DogBehavior): Step[] {
    const here = this.tile
    const r = () => this.rand()
    const people = this.host.people()
    const near = (p: DogPerson) => Math.hypot(p.x / TILE - here.x, p.y / TILE - here.y)
    switch (kind) {
      case 'wander': {
        const to = this.randomTileNear(here.x, here.y, 9, 3)
        if (!to) return []
        return [{ kind: 'walk', to }, r() < 0.5 ? { kind: 'pose', anim: 'sit', ms: 2500 + r() * 3500 } : { kind: 'pose', anim: 'sniff-left', ms: 1800 + r() * 1600 }]
      }
      case 'sit':
        return [{ kind: 'pose', anim: 'sit', ms: 4000 + r() * 6000 }, ...(r() < 0.4 ? [{ kind: 'pose' as const, anim: 'tilt', ms: 1200 }] : [])]
      case 'sniff': {
        const pieces = this.host.furniture().filter((f) => Math.hypot(f.tx - here.x, f.ty - here.y) < 14)
        const f = pieces[Math.floor(r() * pieces.length)]
        if (!f) return []
        const target = { x: f.tx + Math.floor(r() * f.tw), y: f.ty + f.th - 1 }
        const at = this.besideTile(target)
        if (!at) return []
        const face: Facing = target.x < at.x ? 'left' : 'right'
        return [{ kind: 'walk', to: at }, { kind: 'pose', anim: `sniff-${face}`, ms: 2200 + r() * 2400, face }]
      }
      case 'follow': {
        // she follows the people she likes, if they're close
        const p = people.filter((x) => x.idle && x.walking && near(x) < 12).sort((a, b) => near(a) / (0.3 + a.affinity) - near(b) / (0.3 + b.affinity))[0]
        return p ? [{ kind: 'follow', id: p.id, ms: 8000 + r() * 8000 }, { kind: 'pose', anim: 'sit', ms: 2500 }] : []
      }
      case 'visit': {
        // favourites first: people who love dogs and have been kind to her
        const p = people.filter((x) => x.idle && x.settled && near(x) < 18).sort((a, b) => near(a) / (0.3 + a.affinity) - near(b) / (0.3 + b.affinity))[0]
        if (!p) return []
        const pt = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }
        const at = this.besideTile(pt)
        if (!at) return []
        return [
          { kind: 'walk', to: at },
          { kind: 'pose', anim: 'pant', ms: 1400 },
          { kind: 'call', fn: () => this.host.pat(p.id) },
          { kind: 'pose', anim: `wiggle-${pt.x < at.x ? 'left' : 'right'}`, ms: 1400 },
          { kind: 'pose', anim: 'sit', ms: 2000 }
        ]
      }
      case 'drink':
        return [
          { kind: 'walk', to: { x: DOG_BOWL.tx - 1, y: DOG_BOWL.ty } },
          { kind: 'pose', anim: 'sniff-right', ms: 2600, face: 'right' },
          { kind: 'pose', anim: 'sit', ms: 1800 }
        ]
      case 'toy':
        return this.toySteps()
      case 'zoomies': {
        const steps: Step[] = []
        let from = here
        for (let i = 0; i < 5; i++) {
          const to = this.randomTileNear(from.x, from.y, 6, 3)
          if (!to) break
          steps.push({ kind: 'walk', to, run: true })
          from = to
        }
        return steps.length ? [...steps, { kind: 'pose', anim: 'pant', ms: 3200 }] : []
      }
      case 'nap': {
        // a rug is as good as a bed, some of the time
        const rug = this.host.rugs().filter((g) => Math.hypot(g.tx - here.x, g.ty - here.y) < 22)[0]
        if (rug && r() < 0.4) {
          const spot = this.randomTileNear(rug.tx + (rug.tw - 1) / 2, rug.ty + (rug.th - 1) / 2, Math.max(1, Math.min(rug.tw, rug.th) / 2 - 1), 0)
          if (spot) return [{ kind: 'walk', to: spot }, { kind: 'pose', anim: 'sniff-left', ms: 900 }, ...this.sleep(26_000 + r() * 40_000, 'left')]
        }
        return [{ kind: 'walk', to: { x: DOG_BED.tx, y: DOG_BED.ty }, offset: { x: 8, y: 0 } }, ...this.sleep(30_000 + r() * 60_000, 'left')]
      }
      case 'napDesk': {
        const p = people.find((x) => x.workingSeat)
        if (!p?.workingSeat) return []
        const at = this.besideTile(p.workingSeat)
        if (!at) return []
        const side: Side = p.workingSeat.x < at.x ? 'left' : 'right'
        return [{ kind: 'walk', to: at }, ...this.sleep(25_000 + r() * 35_000, side)]
      }
    }
  }

  private nextBehavior(now: number): void {
    const people = this.host.people()
    for (let tries = 0; tries < 4; tries++) {
      const kind = nextDogBehavior(this.rand, now, this.lastStarted, this.behavior, {
        reduced: this.host.reducedMotion(),
        energy: this.energy,
        someoneWorking: people.some((p) => p.workingSeat),
        someoneIdle: people.some((p) => p.idle)
      })
      const steps = this.plan(kind)
      this.behavior = kind
      this.lastStarted[kind] = now
      if (!steps.length) continue
      this.energy = spendEnergy(this.energy, kind)
      this.steps = steps
      return
    }
    this.steps = [{ kind: 'pose', anim: 'sit', ms: 3000 }]
  }

  // ── reactions ───────────────────────────────────────────────

  /** You clicked her: a small happy reaction, then she carries on. Waking her gets a stretch first. */
  react(): void {
    const now = this.scene.time.now
    const side = this.side()
    const wasAsleep = this.asleep
    this.path = []
    this.running = false
    const reaction = nextReaction(this.rand, this.lastReaction, this.host.reducedMotion())
    this.lastReaction = reaction
    const show: Record<DogReaction, Step[]> = {
      pet: [
        { kind: 'call', fn: () => this.showBubble('heart', 1600) },
        { kind: 'pose', anim: `wiggle-${side}`, ms: 1200 },
        { kind: 'pose', anim: 'pant', ms: 1400 }
      ],
      paw: [
        { kind: 'pose', anim: 'sit', ms: 400 },
        { kind: 'pose', anim: 'paw', ms: 1500 },
        { kind: 'pose', anim: 'pant', ms: 900 }
      ],
      tilt: [
        { kind: 'pose', anim: 'tilt', ms: 1400 },
        { kind: 'pose', anim: 'sit', ms: 800 }
      ],
      hop: [
        { kind: 'pose', anim: 'hop', ms: 850 },
        { kind: 'call', fn: () => this.showBubble('heart', 1300) },
        { kind: 'pose', anim: 'pant', ms: 1300 }
      ]
    }
    this.steps = [...(wasAsleep ? this.wakeUp(side).slice(0, 2) : []), ...show[reaction]]
    this.step = null
    this.stepEnds = now
    this.dropBall()
  }

  /** People gathered round her: she stays and enjoys it for a while (unless she's asleep). */
  stayFor(ms: number): void {
    if (this.asleep) return
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = [
      { kind: 'pose', anim: 'pant', ms: Math.min(ms, 4000) },
      { kind: 'pose', anim: 'sit', ms: Math.max(1000, ms - 4000) }
    ]
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** Someone threw the ball: he's off after it, brings it back near you, and wants to go again. Wakes him if he's asleep. */
  fetch(to: Pt, thrownFrom: Pt): void {
    const wake = this.asleep ? this.wakeUp(this.side()) : []
    this.path = []
    this.running = false
    this.carrying = false
    const back = this.randomTileNear(thrownFrom.x, thrownFrom.y, 3, 1) ?? thrownFrom
    this.steps = [
      ...wake,
      { kind: 'pose', anim: `bow-${this.side()}`, ms: 450 },
      { kind: 'walk', to, run: true },
      { kind: 'call', fn: () => (this.carrying = true) },
      { kind: 'pose', anim: 'pant', ms: 350 },
      { kind: 'walk', to: back, run: true },
      { kind: 'call', fn: () => this.dropBall() },
      { kind: 'pose', anim: `wiggle-${this.side()}`, ms: 1300 },
      { kind: 'pose', anim: 'pant', ms: 1500 }
    ]
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** Too much excitement: he has to run it off. Nobody has ever explained why. */
  zoomies(): void {
    if (this.asleep) return
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = this.plan('zoomies')
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** He comes and sits to watch. Nobody asked him to. */
  watch(near: Pt): void {
    if (this.asleep) return
    const to = this.besideTile(near)
    if (!to) return
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = [{ kind: 'walk', to }, { kind: 'pose', anim: 'sit', ms: 14_000 }, { kind: 'pose', anim: 'tilt', ms: 1200 }]
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** There's music on. He has views. */
  dance(): void {
    if (this.asleep) return
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = [{ kind: 'pose', anim: 'wiggle-left', ms: 500 }, { kind: 'pose', anim: 'wiggle-right', ms: 500 }, { kind: 'pose', anim: 'wiggle-left', ms: 500 }, { kind: 'pose', anim: 'wiggle-right', ms: 500 }, { kind: 'pose', anim: 'pant', ms: 1200 }]
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** The ball, in the world: where it is now, and whether he can run to it. */
  get ballSprite(): Phaser.GameObjects.Image {
    return this.ball
  }

  /** A real tile a thrown ball can land on, some way from here. */
  landingFor(from: Pt): Pt | null {
    return this.randomTileNear(from.x, from.y, 8, 4)
  }

  /** A teammate came over to pet her: a happy wiggle toward them (left alone if she's napping). */
  patBy(fromX: number): void {
    if (this.asleep) return
    const side: Side = fromX < this.x ? 'left' : 'right'
    this.path = []
    this.running = false
    this.dropBall()
    this.steps = [
      { kind: 'pose', anim: `wiggle-${side}`, ms: 1300 },
      { kind: 'pose', anim: 'pant', ms: 1600 }
    ]
    this.step = null
    this.stepEnds = this.scene.time.now
  }

  /** Someone is walking past: glance at them (and sometimes tilt her head). */
  private watchPassers(now: number): void {
    if (this.step?.kind !== 'pose' || this.step.sleeping || !this.step.anim.startsWith('sit') || now - this.lastLook < 8000) return
    const p = this.host.people().find((x) => x.walking && Math.hypot(x.x - this.x, x.y - this.y) < TILE * 3 && this.host.canSee({ x: this.x, y: this.y }, x, 3))
    if (!p) return
    this.lastLook = now
    const look: Side = p.x < this.x ? 'left' : 'right'
    const pose = this.step
    this.sprite.play(this.rand() < 0.3 ? 'dog:tilt' : `dog:look-${look}`, true)
    this.scene.time.delayedCall(1300, () => this.step === pose && this.sprite.play(`dog:${pose.anim}`, true))
    // an idle teammate passing close by gives her a pat now and then
    if (p.idle && Math.hypot(p.x - this.x, p.y - this.y) < TILE * 1.6 && this.rand() < 0.35 && cooled(this.patted, p.id, now, 90_000)) {
      this.patted.set(p.id, now)
      this.host.pat(p.id)
    }
  }

  // ── frame update ────────────────────────────────────────────

  update(delta: number): void {
    const now = this.scene.time.now
    this.host.reserveTile(this.tile.x, this.tile.y, this.id)
    if (!this.step || (this.step.kind !== 'walk' && this.step.kind !== 'follow' && now >= this.stepEnds)) this.advance(now)
    const s = this.step
    if (s?.kind === 'walk') this.walk(delta, now)
    else if (s?.kind === 'follow') this.follow(delta, now)
    if (now >= this.nextWatch) {
      this.nextWatch = now + 400
      this.watchPassers(now)
    }
    if (this.bubble) {
      if (now >= this.bubbleUntil) {
        this.bubble.destroy()
        this.bubble = null
      } else this.bubble.setPosition(Math.round(this.sprite.x + 5), Math.round(this.sprite.y - 18))
    }
    if (this.carrying) {
      const dx = this.facing === 'left' ? -11 : this.facing === 'right' ? 11 : 0
      const dy = this.facing === 'down' ? -3 : this.facing === 'up' ? -10 : -6
      this.ball.setPosition(Math.round(this.sprite.x + dx), Math.round(this.sprite.y + dy)).setDepth(this.facing === 'up' ? this.y - 1 : this.y + 1)
    }
  }

  private advance(now: number): void {
    const next = this.steps.shift()
    if (!next) {
      this.step = null
      this.nextBehavior(now)
      return this.advance(now)
    }
    this.step = next
    this.offset = { x: 0, y: 0 }
    if (next.kind === 'call') {
      next.fn()
      return this.advance(now)
    }
    if (next.kind === 'pose') {
      if (next.face) this.facing = next.face
      this.sprite.play(`dog:${next.anim}`, true)
      this.stepEnds = now + next.ms
      // in her bed she lies in the middle of it
      if (this.tile.x === DOG_BED.tx && this.tile.y === DOG_BED.ty && (next.anim.startsWith('lie') || next.anim.startsWith('sleep') || next.anim.startsWith('belly'))) this.offset = { x: 8, y: 0 }
      this.place()
      return
    }
    if (next.kind === 'walk') {
      this.running = !!next.run
      this.stuck = 0
      if (!this.route(next.to)) {
        // unreachable or taken: give up on this plan quietly and pick something else
        this.steps = []
        this.step = null
      }
      return
    }
    this.stepEnds = now + next.ms
    this.followNext = 0
  }

  private route(to: Pt): boolean {
    if (to.x === this.tile.x && to.y === this.tile.y) {
      this.path = []
      return true
    }
    const avoid = this.host.blockedByOthers(this.id)
    const grid = this.host.grid.map((row, y) => row.map((ok, x) => ok && !(avoid.has(`${x},${y}`) && !(x === to.x && y === to.y))))
    const path = findPath(grid, this.tile, to) ?? findPath(this.host.grid, this.tile, to)
    if (!path) return false
    this.path = path.slice(1)
    return true
  }

  private follow(delta: number, now: number): void {
    const s = this.step as Extract<Step, { kind: 'follow' }>
    const p = this.host.people().find((x) => x.id === s.id)
    // stop following anyone who went back to real work, or after a while
    if (!p || !p.idle || now >= this.stepEnds) {
      this.path = []
      this.step = null
      return
    }
    if (now >= this.followNext && !this.path.length) {
      this.followNext = now + 700
      const pt = { x: Math.floor(p.x / TILE), y: Math.floor((p.y - 2) / TILE) }
      if (Math.abs(pt.x - this.tile.x) + Math.abs(pt.y - this.tile.y) > 2) {
        const at = this.besideTile(pt)
        if (at) this.route(at)
      } else this.sprite.play('dog:sit', true)
    }
    if (this.path.length) this.move(delta)
  }

  private walk(delta: number, now: number): void {
    if (!this.path.length) {
      // arrived
      const s = this.step as Extract<Step, { kind: 'walk' }>
      this.running = false
      this.step = null
      this.stepEnds = now
      if (s.offset) this.offset = s.offset
      return
    }
    this.move(delta)
  }

  private move(delta: number): void {
    const next = this.path[0]
    const atCentre = Math.abs(this.x - (this.tile.x * TILE + 8)) < 0.01 && Math.abs(this.y - (this.tile.y * TILE + FEET_Y)) < 0.01
    if (atCentre && (next.x !== this.tile.x || next.y !== this.tile.y)) {
      if (!this.host.reserveTile(next.x, next.y, this.id)) {
        // someone is in the way: wait a moment, then go around, then give up gracefully
        this.waited += delta
        this.sprite.stop()
        if (this.waited > 700) {
          this.waited = 0
          this.stuck++
          const goal = this.path[this.path.length - 1]
          if (this.stuck > 3 || !this.route(goal)) {
            this.path = []
            this.steps = []
          }
        }
        return
      }
      this.waited = 0
    }
    const tx = next.x * TILE + 8
    const ty = next.y * TILE + FEET_Y
    const dx = tx - this.x
    const dy = ty - this.y
    const dist = Math.hypot(dx, dy)
    const speed = this.running && !this.host.reducedMotion() ? RUN : WALK
    const step = (speed * delta) / 1000
    const dir: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (dist > 0.01) {
      this.facing = dir
      this.sprite.play(`dog:${this.running ? 'run' : 'walk'}-${dir}`, true)
    }
    if (dist <= step) {
      this.x = tx
      this.y = ty
      if (next.x !== this.tile.x || next.y !== this.tile.y) this.host.releaseTile(this.tile.x, this.tile.y, this.id)
      this.tile = next
      this.path.shift()
    } else {
      this.x += (dx / dist) * step
      this.y += (dy / dist) * step
    }
    this.place()
  }

  private place(): void {
    const x = Math.round(this.x + this.offset.x)
    const y = Math.round(this.y + this.offset.y)
    this.sprite.setPosition(x, y).setDepth(this.y)
    this.shadow.setPosition(x, y + 1)
  }

  private dropBall(): void {
    if (!this.carrying) return
    this.carrying = false
    this.ball.setPosition(Math.round(this.sprite.x + (this.facing === 'left' ? -9 : 9)), Math.round(this.sprite.y)).setDepth(this.y - 1)
  }

  private showBubble(kind: 'heart', ms: number): void {
    this.bubble?.destroy()
    this.bubble = this.scene.add.image(Math.round(this.sprite.x + 5), Math.round(this.sprite.y - 18), `bubble:${kind}`).setOrigin(0, 1).setDepth(100000)
    this.bubbleUntil = this.scene.time.now + ms
  }

  destroy(): void {
    this.host.releaseTile(this.tile.x, this.tile.y, this.id)
    this.bubble?.destroy()
    this.sprite.destroy()
    this.shadow.destroy()
    this.ball.destroy()
    for (const p of this.props) p.destroy()
  }
}
