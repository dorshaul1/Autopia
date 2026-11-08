import Phaser from 'phaser'
import { CELL_H, CELL_W, FEET_ROW, RECEPTION_ROW, ROW, SHEET_COLS, frameIndex, receptionistSheet } from './art/characters'
import type { BubbleKind } from './art/furniture'
import * as F from './art/furniture'
import { IDLE_SPOTS, TILE, type Grid } from './layout'
import { findPath, type Pt } from './pathfinding'
import { RECEPTION_SEAT, RECEPTIONIST, nextRoutine, seeded, type Routine } from './reception'

const FEET_Y = 13
const SPEED = 50
/** Seated a little higher than a workstation chair, so her shoulders clear the counter. */
const SEAT_DY = -4
/** In the gap between the desk's vase and its monitor, so the screen never hides her face or hands. */
const SEAT_DX = -10

/** What the receptionist needs from the scene: walking space and the shared tile reservations. */
export interface ReceptionHost {
  grid: Grid
  reserveTile(x: number, y: number, id: string): boolean
  releaseTile(x: number, y: number, id: string): void
  claimSpot(key: string, id: string): boolean
  releaseSpot(key: string, id: string): void
  blockedByOthers(id: string): Set<string>
  reducedMotion(): boolean
}

type Mode = 'desk' | 'leaving' | 'away' | 'returning'

/**
 * The front-desk receptionist. Not an employee: she has no status, no runs and no place in the team
 * or orchestration; she never reports presence. Her routines are local timers on a seeded generator.
 * Reactions (`greet`, `acknowledge`, `setNeedsYou`) are called by the scene only for real events.
 */
export class Receptionist {
  readonly id = RECEPTIONIST.id
  readonly sprite: Phaser.GameObjects.Sprite
  private shadow: Phaser.GameObjects.Image
  private chair: Phaser.GameObjects.Image
  private bubble: Phaser.GameObjects.Image | null = null
  private bubbleUntil = 0
  private needsYou = false
  private rand = seeded(Date.now() & 0xffff)
  private routine: Routine | null = null
  private routineEnds = 0
  private lastStarted: Partial<Record<Routine, number>> = {}
  /** A short reaction (wave, glance) that pauses the routine underneath. */
  private reactionEnds = 0
  private mode: Mode = 'desk'
  private path: Pt[] = []
  private tile: Pt
  private x: number
  private y: number
  private awayUntil = 0
  private breakSpot: string | null = null
  private bornAt: number
  private waited = 0

  constructor(
    private scene: Phaser.Scene,
    private host: ReceptionHost
  ) {
    const key = 'emp:reception'
    if (scene.textures.exists(key)) scene.textures.remove(key)
    const sheet = receptionistSheet(RECEPTIONIST.appearance)
    const tex = scene.textures.addCanvas(key, sheet)!
    for (let i = 0; i < (sheet.height / CELL_H) * SHEET_COLS; i++) tex.add(i, 0, (i % SHEET_COLS) * CELL_W, Math.floor(i / SHEET_COLS) * CELL_H, CELL_W, CELL_H)
    this.createAnims(key)

    this.tile = { x: RECEPTION_SEAT.tx, y: RECEPTION_SEAT.ty }
    this.x = this.tile.x * TILE + 8
    this.y = this.tile.y * TILE + FEET_Y
    host.reserveTile(this.tile.x, this.tile.y, this.id)
    if (!scene.textures.exists('chair:reception')) scene.textures.addCanvas('chair:reception', F.officeChair(false))
    // her chair stands behind her; she sits in front of its back
    this.chair = scene.add.image(this.x + SEAT_DX, this.y + 3, 'chair:reception').setOrigin(0.5, 1).setDepth(this.y - 1)
    this.shadow = scene.add.image(this.x, this.y, 'shadow:char').setDepth(1).setVisible(false)
    this.sprite = scene.add
      .sprite(this.x + SEAT_DX, this.y + SEAT_DY, key, frameIndex(ROW.sitDown, 0))
      .setOrigin(0.5, (FEET_ROW + 1) / CELL_H)
      .setDepth(this.y)
      .setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 })
    this.bornAt = scene.time.now
    this.startRoutine(scene.time.now, 'typing')
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y }
  }

  get atDesk(): boolean {
    return this.mode === 'desk'
  }

  private createAnims(key: string): void {
    const a = this.scene.anims
    const mk = (name: string, frames: [number, number][], fps: number, repeat = -1) => {
      const full = `reception:${name}`
      if (a.exists(full)) a.remove(full)
      a.create({ key: full, frames: frames.map(([row, col]) => ({ key, frame: frameIndex(row, col) })), frameRate: fps, repeat })
    }
    const W = RECEPTION_ROW.work
    const H = RECEPTION_ROW.hands
    const L = RECEPTION_ROW.look
    const M = RECEPTION_ROW.more
    const S = ROW.sitDown
    mk('typing', [[W, 0], [W, 1], [W, 0], [W, 1], [W, 0], [W, 0], [W, 1], [W, 3], [W, 0], [W, 1]], 6)
    mk('idle', [[S, 0], [S, 0], [S, 0], [S, 2], [S, 0], [S, 0], [L, 0], [S, 0], [S, 0], [L, 1], [S, 0]], 2)
    mk('paperwork', [[H, 3], [H, 3], [M, 1], [H, 3], [M, 1], [M, 1], [M, 2], [H, 3]], 1.4)
    mk('phone', [[H, 0], [H, 1], [H, 1], [H, 0], [H, 1], [H, 0], [H, 0], [H, 1]], 3)
    mk('coffee', [[H, 2], [H, 2], [H, 2], [S, 0], [S, 0], [S, 2], [S, 0]], 1.2)
    mk('tidy', [[W, 3], [W, 0], [L, 1], [W, 0], [L, 0], [S, 0]], 2)
    mk('stretch', [[M, 0]], 1)
    mk('wave', [[L, 2], [L, 3], [L, 2], [L, 3], [L, 2], [S, 0]], 5, 0)
    mk('talk', [[M, 3], [S, 0], [S, 1], [S, 0], [M, 3], [S, 2]], 4)
    for (const [dir, row] of [['down', ROW.down], ['up', ROW.up], ['left', ROW.left], ['right', ROW.right]] as const) {
      mk(`walk-${dir}`, [0, 1, 2, 3].map((c) => [row, c] as [number, number]), 8)
    }
  }

  // ── reactions (real events only) ────────────────────────────

  /** You need to decide something: a small, steady "!" over the desk until it's handled. */
  setNeedsYou(on: boolean): void {
    if (this.needsYou === on) return
    this.needsYou = on
    if (on) this.showBubble('alert', Infinity)
    else if (this.bubble?.texture.key === 'bubble:alert') this.hideBubble()
  }

  /** A short wave, e.g. when you open the office or a teammate walks past. Only at the desk. */
  greet(toward: -1 | 0 | 1 = 0, withBubble = false): boolean {
    if (this.mode !== 'desk' || this.scene.time.now < this.reactionEnds) return false
    const now = this.scene.time.now
    if (this.host.reducedMotion()) {
      // no gestures: a glance and (optionally) the greeting bubble
      this.sprite.stop().setFrame(toward ? frameIndex(RECEPTION_ROW.look, toward < 0 ? 0 : 1) : frameIndex(ROW.sitDown, 0))
      this.reactionEnds = now + 1500
    } else {
      if (toward) {
        this.sprite.stop().setFrame(frameIndex(RECEPTION_ROW.look, toward < 0 ? 0 : 1))
        this.scene.time.delayedCall(350, () => this.mode === 'desk' && this.sprite.play('reception:wave'))
      } else this.sprite.play('reception:wave')
      this.reactionEnds = now + 1900
    }
    if (withBubble && !this.needsYou) this.showBubble('hi', 1800)
    return true
  }

  /** A result just became ready for you: a quiet check mark. */
  acknowledge(): void {
    if (this.needsYou) return
    this.showBubble('check', 2600)
    if (this.mode === 'desk' && !this.host.reducedMotion() && this.scene.time.now >= this.reactionEnds) {
      this.sprite.stop().setFrame(frameIndex(RECEPTION_ROW.more, 3))
      this.reactionEnds = this.scene.time.now + 900
    }
  }

  /** A visitor is at the desk: she talks with them for a moment. */
  attend(ms: number): void {
    if (this.mode !== 'desk') return
    this.sprite.play('reception:talk')
    this.reactionEnds = this.scene.time.now + ms
  }

  // ── routines ────────────────────────────────────────────────

  private startRoutine(now: number, forced?: Routine): void {
    // never leave the desk while you have something to decide, or in the first few minutes
    const canLeave = !this.needsYou && now - this.bornAt > 3 * 60_000
    const next = forced ? { kind: forced, ms: 12_000 } : nextRoutine(this.rand, now, this.lastStarted, this.routine, canLeave)
    this.routine = next.kind
    this.lastStarted[next.kind] = now
    this.routineEnds = now + next.ms
    if (next.kind === 'break') return this.leave(now, next.ms)
    if (this.host.reducedMotion()) {
      // a still pose that says what she's doing, without motion
      const still: Record<Exclude<Routine, 'break'>, [number, number]> = {
        typing: [RECEPTION_ROW.work, 0],
        idle: [ROW.sitDown, 0],
        paperwork: [RECEPTION_ROW.hands, 3],
        phone: [RECEPTION_ROW.hands, 0],
        coffee: [RECEPTION_ROW.hands, 2],
        tidy: [RECEPTION_ROW.work, 3],
        stretch: [ROW.sitDown, 0]
      }
      const [row, col] = still[next.kind]
      this.sprite.stop().setFrame(frameIndex(row, col))
    } else this.sprite.play(`reception:${next.kind}`, true)
    if (next.kind === 'phone' && !this.needsYou) this.showBubble('phone', 1400)
    if (next.kind === 'coffee' && !this.needsYou) this.showBubble('coffee', 1400)
  }

  update(_time: number, delta: number): void {
    // one clock for everything she schedules (the scene clock, which pauses with the office)
    const time = this.scene.time.now
    // keep her chair tile hers even if someone squeezed a reservation loose
    if (this.mode === 'desk') this.host.reserveTile(RECEPTION_SEAT.tx, RECEPTION_SEAT.ty, this.id)
    if (this.mode === 'desk') {
      if (time >= this.reactionEnds && this.reactionEnds) {
        this.reactionEnds = 0
        this.sprite.play(`reception:${this.routine === 'break' || !this.routine ? 'idle' : this.routine}`, true)
      }
      if (time >= this.routineEnds && !this.reactionEnds) this.startRoutine(time)
    } else if (this.mode === 'away') {
      if (time >= this.awayUntil || this.needsYou) this.returnToDesk()
    } else this.walk(delta)
    if (this.bubble) {
      if (time >= this.bubbleUntil) this.hideBubble()
      else this.bubble.setPosition(Math.round(this.sprite.x + 7), Math.round(this.sprite.y - 28 + (this.host.reducedMotion() ? 0 : Math.sin(time / 250))))
    }
  }

  // ── short breaks: to the coffee bar and back ────────────────

  private leave(now: number, ms: number): void {
    const spots = IDLE_SPOTS.coffee.map((s, i) => ({ s, key: `coffee:${i}` }))
    const free = spots.find(({ key }) => this.host.claimSpot(key, this.id))
    if (!free) {
      this.routine = 'idle'
      this.routineEnds = now + 5000
      this.sprite.play('reception:idle', true)
      return
    }
    this.breakSpot = free.key
    this.awayUntil = now + ms
    this.mode = 'leaving'
    // stand up: step out from behind the desk first
    this.sprite.setPosition(this.x, this.y)
    this.shadow.setVisible(true)
    this.route({ x: free.s.tx, y: free.s.ty })
  }

  private returnToDesk(): void {
    this.mode = 'returning'
    this.route({ x: RECEPTION_SEAT.tx, y: RECEPTION_SEAT.ty })
  }

  private route(to: Pt): void {
    // route around people standing still where possible; fall back to the plain grid
    const avoid = this.host.blockedByOthers(this.id)
    const grid = this.host.grid.map((row, y) => row.map((ok, x) => ok && !(avoid.has(`${x},${y}`) && !(x === to.x && y === to.y))))
    const path = findPath(grid, this.tile, to) ?? findPath(this.host.grid, this.tile, to)
    this.path = path ? path.slice(1) : []
    if (!path) this.arrive()
  }

  private walk(delta: number): void {
    const next = this.path[0]
    if (!next) return this.arrive()
    const atCentre = Math.abs(this.x - (this.tile.x * TILE + 8)) < 0.01 && Math.abs(this.y - (this.tile.y * TILE + FEET_Y)) < 0.01
    if (atCentre && (next.x !== this.tile.x || next.y !== this.tile.y)) {
      if (!this.host.reserveTile(next.x, next.y, this.id)) {
        this.waited += delta
        this.sprite.stop()
        if (this.waited > 1500) {
          this.waited = 0
          this.route(this.path[this.path.length - 1])
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
    const move = (SPEED * delta) / 1000
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (dist > 0.01) this.sprite.play(`reception:walk-${dir}`, true)
    if (dist <= move) {
      this.x = tx
      this.y = ty
      if (next.x !== this.tile.x || next.y !== this.tile.y) this.host.releaseTile(this.tile.x, this.tile.y, this.id)
      this.tile = next
      this.path.shift()
    } else {
      this.x += (dx / dist) * move
      this.y += (dy / dist) * move
    }
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y)).setDepth(this.y)
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y))
  }

  private arrive(): void {
    this.path = []
    if (this.mode === 'leaving') {
      this.mode = 'away'
      this.sprite.stop().setFrame(frameIndex(ROW.up, 0))
      if (!this.needsYou) this.showBubble('coffee', 2200)
      return
    }
    if (this.mode === 'returning') {
      if (this.breakSpot) this.host.releaseSpot(this.breakSpot, this.id)
      this.breakSpot = null
      // back in her chair, facing the lobby
      this.x = RECEPTION_SEAT.tx * TILE + 8
      this.y = RECEPTION_SEAT.ty * TILE + FEET_Y
      this.tile = { x: RECEPTION_SEAT.tx, y: RECEPTION_SEAT.ty }
      this.sprite.setPosition(this.x + SEAT_DX, this.y + SEAT_DY).setDepth(this.y)
      this.shadow.setVisible(false)
      this.mode = 'desk'
      this.startRoutine(this.scene.time.now, 'typing')
    }
  }

  // ── bubbles ─────────────────────────────────────────────────

  private showBubble(kind: BubbleKind, ms: number): void {
    this.bubble?.destroy()
    this.bubble = this.scene.add.image(Math.round(this.sprite.x + 7), Math.round(this.sprite.y - 28), `bubble:${kind}`).setOrigin(0, 1).setDepth(100000)
    this.bubbleUntil = this.scene.time.now + ms
  }

  private hideBubble(): void {
    this.bubble?.destroy()
    this.bubble = null
    // the "you're needed" marker comes back after any other bubble
    if (this.needsYou && this.bubbleUntil !== Infinity) {
      this.bubble = this.scene.add.image(Math.round(this.sprite.x + 7), Math.round(this.sprite.y - 28), 'bubble:alert').setOrigin(0, 1).setDepth(100000)
      this.bubbleUntil = Infinity
    }
  }

  destroy(): void {
    if (this.breakSpot) this.host.releaseSpot(this.breakSpot, this.id)
    this.host.releaseTile(this.tile.x, this.tile.y, this.id)
    this.bubble?.destroy()
    this.sprite.destroy()
    this.shadow.destroy()
    this.chair.destroy()
  }
}
