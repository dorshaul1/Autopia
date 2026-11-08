import type { WorkDoing } from '@shared/workActivity'
import type { WorkPlace } from './workPlace'
import Phaser from 'phaser'
import type { Employee, EmployeeActivity, OfficeLocation } from '@shared/types'
import { CELL_H, FEET_ROW, ROW, frameIndex } from './art/characters'
import type { BubbleKind } from './art/furniture'
import { activity as activityDef, freshNeeds, growNeeds, personaFor, pickActivity, satisfy, type ActivityDef, type Needs, type Persona } from './behavior'
import { DESKS, FOCUS_SEATS, IDLE_SPOTS, MEETING_SEATS, SPARE_MEETING_SEATS, TILE, type Facing, type Grid, type Spot } from './layout'
import { findPath, type Pt } from './pathfinding'
import { Recent, personalityWeight, profileFor, seeded, stayScale, type Context, type Profile } from './personality'
import { followUp, intend, type Intention } from './awareness'
import { styleFor, type ExpressionStyle, type Pose } from './expression'

/** What a person can express with their body (poses from expression.ts plus conversation states). */
export type Expression = Pose | 'speak' | 'explain' | 'listen' | 'pet' | 'wave'

const SPEED = 58 // world pixels per second
const FEET_Y = 13 // feet position inside a tile
const WAIT_REPATH_MS = 650
const WAIT_PASS_MS = 2600

export type GoalKind = 'desk' | 'meeting' | 'focus' | 'idle' | 'pair' | 'station'
export interface Goal {
  kind: GoalKind
  spot: Spot
  key: string
  activity?: 'chat' | 'pingpong'
}

export interface CharacterHost {
  grid: Grid
  claimSpot(key: string, employeeId: string): boolean
  releaseSpot(key: string, employeeId: string): void
  reportPresence(employeeId: string, location: OfficeLocation): void
  /** Tile reservations so people never stand on each other. */
  reserveTile(x: number, y: number, id: string): boolean
  releaseTile(x: number, y: number, id: string): void
  blockedByOthers(id: string): Set<string>
  /** Ask the scene to start a two-person activity; returns true if a partner was found. */
  requestPair(initiator: Character, kind: 'chat' | 'pingpong'): boolean
  onArrive(c: Character, goal: Goal): void
  /** The employee sat down at (or got up from) their workstation chair. */
  onSeat(c: Character, seated: boolean): void
  /** The viewer asked the system for reduced motion: no gestures, no bobbing bubbles. */
  reducedMotion(): boolean
  /** A footfall at this position (for optional sound). */
  footstep(x: number, y: number): void
  /** What's around for this person's choice right now (crowds, a rally, the dog, a joinable chat). */
  context(c: Character, activityId: string): Context
  /** Join an ongoing conversation as a third person; false if none fits. */
  joinChat(c: Character): boolean
  /** Walk up to the office dog; false if she isn't reachable. */
  petDog(c: Character): boolean
  /** Ask a favourite colleague along to an activity (they may say no). */
  invite(c: Character, activityId: string): void
}

/**
 * A purely visual employee. Where it goes is derived from the real EmployeeStatus; idle time is
 * filled with local, token-free routines (coffee, sofa, conversations, ping-pong…).
 */
export class Character {
  readonly sprite: Phaser.GameObjects.Sprite
  private shadow: Phaser.GameObjects.Image
  private ring: Phaser.GameObjects.Image
  private bubbleImg: Phaser.GameObjects.Image | null = null
  private bubbleKind: BubbleKind | null = null
  private bubbleTimer: Phaser.Time.TimerEvent | null = null

  private x: number
  private y: number
  tile: Pt
  private path: Pt[] = []
  goal: Goal | null = null
  posed: Spot | null = null
  private facing: Facing = 'up'
  activity: EmployeeActivity = 'idle'
  private idleUntil = 0
  private nextBlink = 0
  private nextFidget = 0
  private waited = 0
  private hover = false
  readonly persona: Persona
  readonly needs: Needs = freshNeeds()
  private cooldowns: Record<string, number> = {}
  private current: ActivityDef | null = null
  /** Set by the scene during a real teammate consultation. */
  private focusRole: 0 | 1 | null = null
  /** Stable personality (traits + signature habits) and bounded recent memory. */
  readonly profile: Profile
  readonly recent = new Recent()
  /** Per-person generator: seeded, so nobody moves in step with anyone else. */
  private rand: () => number
  /** What they mean to do next ("go watch that", "coffee after this"); expires if it stops making sense. */
  intent: Intention | null = null
  /** Set by the scene when a partner leaves for real work: stay put this long before moving on. */
  lingerAfter = 0
  /** Body-language identity from their traits: how they gesture, nod, laugh and walk. */
  readonly style: ExpressionStyle
  /** A small expression to play when they next arrive somewhere (e.g. a shrug after a "no thanks"). */
  private onArrival: (() => void) | null = null
  /** The expression being played (cleared when it ends). */
  expressing: Expression | null = null
  private expressionEnds = 0
  private nextIdleGesture = 0

  constructor(
    private scene: Phaser.Scene,
    readonly employee: Employee,
    private host: CharacterHost
  ) {
    const seat = DESKS[employee.deskId].seat
    this.tile = { x: seat.tx, y: seat.ty }
    this.x = seat.tx * TILE + 8
    this.y = seat.ty * TILE + FEET_Y
    host.reserveTile(seat.tx, seat.ty, employee.id)
    this.persona = personaFor(employee)
    this.profile = profileFor(employee)
    this.style = styleFor(this.profile.traits)
    // energetic people walk a little quicker and bouncier
    this.persona.pace = this.style.pace
    this.rand = seeded((Date.now() ^ [...employee.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261)) >>> 0)
    this.shadow = scene.add.image(this.x, this.y, 'shadow:char').setDepth(1)
    this.ring = scene.add.image(this.x, this.y + 1, 'ring').setDepth(2).setVisible(false)
    this.sprite = scene.add
      .sprite(this.x, this.y, `emp:${employee.id}`, frameIndex(ROW.sitUp, 0))
      .setOrigin(0.5, (FEET_ROW + 1) / CELL_H)
      .setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 })
    this.sprite.on('pointerover', () => (this.hover = true))
    this.sprite.on('pointerout', () => (this.hover = false))
    this.createAnims()
    host.claimSpot(`desk:${employee.deskId}`, employee.id)
    this.goal = { kind: 'desk', spot: seat, key: `desk:${employee.deskId}` }
    this.arrive()
  }

  /** The break they're on, if they're on one. Null whenever they have real work. */
  get onBreak(): string | null {
    return this.activity === 'idle' ? (this.current?.id ?? null) : null
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y }
  }

  get isWalking(): boolean {
    return this.path.length > 0
  }

  /** Free to be pulled into a cosmetic activity. */
  get available(): boolean {
    return this.activity === 'idle' && !this.path.length && !!this.posed && this.goal?.kind !== 'pair' && !this.inStory
  }

  /** The office story they're part of right now (the scene's story director owns their idle time). */
  inStory: string | null = null

  /** Join a story: walk to its place; the director decides when it's over. */
  joinStory(storyId: string, spot: Spot, key: string, activityId: string): void {
    this.inStory = storyId
    this.intent = null
    this.goTo(spot, key, activityId)
  }

  /** The story is over for them: back to their own idle life after a moment. */
  leaveStory(afterMs = 800): void {
    this.inStory = null
    this.idleUntil = this.scene.time.now + afterMs
  }

  setSelected(on: boolean): void {
    this.ring.setVisible(on)
  }

  private createAnims(): void {
    const key = `emp:${this.employee.id}`
    const a = this.scene.anims
    const mk = (name: string, row: number, cols: number[], fps: number, repeat = -1) => {
      const full = `${this.employee.id}:${name}`
      if (a.exists(full)) a.remove(full)
      a.create({ key: full, frames: cols.map((c) => ({ key, frame: frameIndex(row, c) })), frameRate: fps, repeat })
    }
    // frames drawn from several rows (row, col)
    const mkFrames = (name: string, frames: [number, number][], fps: number, repeat = -1) => {
      const full = `${this.employee.id}:${name}`
      if (a.exists(full)) a.remove(full)
      a.create({ key: full, frames: frames.map(([row, col]) => ({ key, frame: frameIndex(row, col) })), frameRate: fps, repeat })
    }
    const wf = this.style.walkFps
    mk('walk-down', ROW.down, [0, 1, 2, 3], wf)
    mk('walk-up', ROW.up, [0, 1, 2, 3], wf)
    mk('walk-left', ROW.left, [0, 1, 2, 3], wf)
    mk('walk-right', ROW.right, [0, 1, 2, 3], wf)
    // expression (Phase 31): speaking style follows their liveliness
    const speak = { lively: [1, 3, 1, 0, 3, 1], moderate: [1, 0, 1, 2, 1, 0], subtle: [1, 0, 0, 1, 0, 0] }[this.style.amplitude]
    const speakFps = this.style.amplitude === 'lively' ? 6 : this.style.amplitude === 'moderate' ? 5 : 4
    for (const [dir, talk, gest, more] of [
      ['left', ROW.talkLeft, ROW.gestLeft, ROW.moreLeft],
      ['right', ROW.talkRight, ROW.gestRight, ROW.moreRight]
    ] as const) {
      mk(`speak-${dir}`, talk, speak, speakFps)
      mkFrames(`explain-${dir}`, [[more, 3], [talk, 1], [gest, 3], [talk, 0], [more, 3]], speakFps - 1)
      mk(`listen-${dir}`, talk, [0, 0, 0, 0, 2, 0, 0], 2)
      mk(`nod-${dir}`, gest, [0], 1)
      mk(`laugh-${dir}`, gest, [1, 2, 1, 2, 1], 6, 0)
      mk(`lean-${dir}`, more, [2], 1)
      mk(`pet-${dir}`, more, [0, 1], 3)
    }
    mk('speak-up', ROW.backTalk, [2, 0, 3, 0], speakFps - 1)
    mk('listen-up', ROW.backTalk, [0], 1)
    mk('nod-up', ROW.backTalk, [1], 1)
    mkFrames('nod-down', [[ROW.extra, 0]], 1)
    for (const [name, col] of [['cheer', 0], ['shrug', 1], ['think', 2], ['surprise', 3]] as const) mk(name, ROW.expr, [col], 1)
    mk('type', ROW.sitUp, [1, 2, 1, 0, 2, 1, 3, 2], 7)
    mk('talk', ROW.sitDown, [1, 0, 3, 0, 1, 2, 0], 5)
    mk('chat-left', ROW.talkLeft, [1, 0, 3, 0, 0, 2, 0], 4)
    mk('chat-right', ROW.talkRight, [1, 0, 3, 0, 0, 2, 0], 4)
    mk('listen-left', ROW.talkLeft, [0, 0, 0, 2, 0, 0, 1], 3)
    mk('listen-right', ROW.talkRight, [0, 0, 0, 2, 0, 0, 1], 3)
    mk('wave', ROW.extra, [2, 3, 2, 3, 2], 6, 0)
    mk('swing-left', ROW.talkLeft, [0, 3, 0, 1], 6)
    mk('swing-right', ROW.talkRight, [0, 3, 0, 1], 6)
  }

  // ── expression ──────────────────────────────────────────────

  /**
   * Play an expression for `ms` while standing (never during real work, never mid-walk). Side poses
   * use the facing direction; seen from behind, talk and nods use the back rows; cheer, shrug, think
   * and surprise turn to the viewer for a moment. With reduced motion, loops become a single frame.
   */
  express(what: Expression, ms: number): boolean {
    const s = this.posed
    if ((this.activity !== 'idle' && this.goal?.kind !== 'station') || !s || s.pose !== 'stand' || this.path.length) return false
    if (what === 'still') return true
    const id = this.employee.id
    const side = this.facing === 'left' || this.facing === 'right' ? this.facing : null
    let key: string | null = null
    if (what === 'cheer' || what === 'shrug' || what === 'think' || what === 'surprise') key = what
    else if (what === 'wave') key = this.facing === 'down' ? 'wave' : side ? `nod-${side}` : 'nod-up'
    else if (side) key = `${what === 'lean' ? 'lean' : what}-${side}`
    else if (this.facing === 'up') key = what === 'speak' || what === 'explain' ? 'speak-up' : what === 'listen' ? 'listen-up' : what === 'nod' || what === 'laugh' ? 'nod-up' : null
    else if (this.facing === 'down') key = what === 'nod' || what === 'laugh' ? 'nod-down' : null
    if (!key) return false
    const full = `${id}:${key}`
    if (this.host.reducedMotion()) {
      const anim = this.scene.anims.get(full)
      this.sprite.stop()
      if (anim) this.sprite.setFrame(anim.frames[0].frame.name)
    } else this.sprite.play(full, true)
    this.expressing = what
    this.expressionEnds = this.scene.time.now + ms
    return true
  }

  /** End the current expression now (the scene's conversation moves on to the next turn). */
  private endExpression(): void {
    this.expressing = null
    if (this.posed && !this.path.length) this.applyPose()
  }

  /** Something to do on the next arrival (used for a small shrug after an invitation was declined). */
  afterArriving(fn: () => void): void {
    this.onArrival = fn
  }

  // ── workflow-driven behaviour ───────────────────────────────

  setActivity(activity: EmployeeActivity): void {
    const prev = this.activity
    this.activity = activity
    // real work always wins: any ambient plan (or story) is dropped the moment work arrives
    if (activity !== 'idle') {
      this.intent = null
      this.inStory = null
    }
    // after a stretch of real work, what comes next depends on who they are (a coffee, a walk…)
    else if (prev === 'working' || prev === 'testing' || prev === 'reviewing') {
      const next = followUp('work', this.profile, this.rand)
      if (next) this.intent = intend(next, 'after work', this.scene.time.now, 3000)
    }
    switch (activity) {
      case 'working':
      case 'testing':
      case 'waiting':
      case 'error':
        // assigned real work while standing around: lively people nod ("on it"), then go; nobody dawdles
        if (prev === 'idle' && this.posed?.pose === 'stand' && !this.path.length && this.style.amplitude === 'lively' && !this.host.reducedMotion()) {
          this.activity = 'idle'
          this.express('nod', 350)
          this.activity = activity
          this.scene.time.delayedCall(350, () => this.activity === activity && this.goToWork())
        } else this.goToWork()
        break
      case 'reviewing':
        if (this.focusRole !== null) this.goToFocus()
        else this.goToDesk()
        break
      case 'meeting':
        if (this.workPlace === 'whiteboard') this.goToWork()
        else this.goToMeeting()
        break
      case 'idle':
        if (prev !== 'idle') {
          this.idleUntil = this.scene.time.now + 4000 + Math.random() * 5000
          // no ✓ here: a session ending says nothing about the outcome (verified completions are
          // staged by the scene from the task's real check results)
          this.workPlace = 'desk'
          if (prev === 'meeting' || prev === 'reviewing' || this.goal?.kind === 'station') this.goToDesk()
        }
        if (this.focusRole !== null) this.goToFocus()
        break
    }
    this.refreshBubble()
    this.applyPose()
  }

  /** Set from the real work (workPlace.ts). */
  workPlace: WorkPlace = 'desk'
  private doing: WorkDoing | null = null
  private needsYou = false
  private nextStationGesture = 0

  /** Where the work is right now: their desk, or the place in this office that it belongs. */
  private goToWork(): void {
    const spots = this.workPlace === 'desk' ? null : IDLE_SPOTS[this.workPlace]
    if (!spots?.length) return this.goToDesk()
    const i = this.employee.hiredAt % spots.length
    const key = `station:${this.workPlace}:${i}`
    if (this.goal?.key !== key) this.setGoal({ kind: 'station', spot: spots[i], key })
  }

  setWorkPlace(place: WorkPlace): void {
    if (place === this.workPlace) return
    this.workPlace = place
    if (this.activity !== 'idle' && this.activity !== 'reviewing') {
      if (place === 'desk' && this.activity === 'meeting') this.goToMeeting()
      else this.goToWork()
    }
  }

  /** Their pace at the keyboard follows the real work; a change of screen needs no walking. */
  setDoing(doing: WorkDoing | null): void {
    if (doing === this.doing) return
    this.doing = doing
    if (!this.path.length && this.goal?.kind === 'desk') this.applyPose()
  }

  /** Only something really waiting on you raises the alert; being queued behind a teammate doesn't. */
  setNeedsYou(needed: boolean): void {
    if (needed === this.needsYou) return
    this.needsYou = needed
    this.refreshBubble()
  }

  goToDesk(): void {
    const key = `desk:${this.employee.deskId}`
    if (this.goal?.key === key) return
    this.setGoal({ kind: 'desk', spot: DESKS[this.employee.deskId].seat, key })
  }

  private goToMeeting(): void {
    const key = `meeting:${this.employee.role}`
    if (this.goal?.key === key) return
    const seat = MEETING_SEATS[this.employee.role] ?? SPARE_MEETING_SEATS[this.employee.hiredAt % SPARE_MEETING_SEATS.length]
    this.setGoal({ kind: 'meeting', spot: seat, key })
  }

  /** A real consultation is in progress: 0 = the teammate answering, 1 = the one who asked. */
  setFocusRole(role: 0 | 1 | null): void {
    if (this.focusRole === role) return
    this.focusRole = role
    if (role !== null && (this.activity === 'idle' || this.activity === 'reviewing')) this.goToFocus()
    else if (role === null && this.goal?.kind === 'focus') {
      if (this.activity === 'idle') {
        this.idleUntil = 0
        this.goToDesk()
      } else this.setActivity(this.activity)
    }
  }

  private goToFocus(): void {
    if (this.focusRole === null) return
    const key = `focus:${this.focusRole}`
    if (this.goal?.key === key) return
    this.setGoal({ kind: 'focus', spot: FOCUS_SEATS[this.focusRole], key })
  }

  /** Called by the scene to start a cosmetic paired activity. */
  joinPair(key: string, spot: Spot, activity: 'chat' | 'pingpong'): void {
    this.setGoal({ kind: 'pair', spot, key, activity })
  }

  /** Both players are at the table: swing along with the rally. */
  startSwing(): void {
    const s = this.posed
    if (this.goal?.kind !== 'pair' || !s || (s.facing !== 'left' && s.facing !== 'right')) return
    this.sprite.play({ key: `${this.employee.id}:swing-${s.facing}`, startFrame: Math.floor(Math.random() * 4) }, true)
  }

  /** Pair finished or was interrupted: drift back to normal idle life. */
  /**
   * Pair finished or was interrupted. `lingerMs` keeps them standing where they are for a moment
   * (e.g. after their partner was called away to real work) before drifting back to idle life.
   */
  endPair(lingerMs = 0): void {
    if (this.goal?.kind !== 'pair') return
    const was = this.goal.activity
    if (was === 'pingpong' && this.activity === 'idle') {
      const next = followUp('pingpong', this.profile, this.rand)
      if (next) this.intent = intend(next, 'after a game', this.scene.time.now)
    }
    if (lingerMs > 0 && this.activity === 'idle') {
      this.goal = { ...this.goal, kind: 'idle' }
      this.idleUntil = this.scene.time.now + lingerMs
      return
    }
    this.idleUntil = 0
    if (this.activity === 'idle') this.pickIdleGoal()
  }

  /** A fresh intention should be acted on soon, not after a long idle stretch at the current spot. */
  wakeFromIdle(): void {
    if (this.activity !== 'idle' || !this.intent) return
    this.idleUntil = Math.min(this.idleUntil, this.intent.notBefore)
  }

  /** Turn to look at something for a moment (only while standing idle; never during real work). */
  glanceAt(x: number, y: number, ms: number): boolean {
    const s = this.posed
    if (this.activity !== 'idle' || !s || s.pose !== 'stand' || this.path.length || this.goal?.kind === 'pair' || this.sprite.anims.isPlaying) return false
    const dx = x - this.x
    const dy = y - this.y
    const dir: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (dir === this.facing) return true
    this.sprite.setFrame(frameIndex(ROW[dir], 0))
    this.scene.time.delayedCall(ms, () => this.posed === s && !this.path.length && !this.sprite.anims.isPlaying && this.applyPose())
    return true
  }

  setGoal(goal: Goal): void {
    if (this.goal) this.host.releaseSpot(this.goal.key, this.employee.id)
    if (this.goal?.kind === 'desk' && this.posed) {
      this.host.reportPresence(this.employee.id, 'elsewhere')
      this.host.onSeat(this, false)
    }
    this.host.claimSpot(goal.key, this.employee.id)
    this.goal = goal
    this.posed = null
    this.routeTo({ x: goal.spot.tx, y: goal.spot.ty }, new Set())
  }

  /** The floor changed (decor was moved): anyone heading through it finds another way. */
  gridChanged(): void {
    if (this.goal && this.path.slice(1).some((t) => !this.host.grid[t.y]?.[t.x])) this.routeTo({ x: this.goal.spot.tx, y: this.goal.spot.ty }, new Set())
  }

  private routeTo(target: Pt, avoid: Set<string>): void {
    // Start from the tile we are about to stand on so we never snap backwards.
    const from = this.path.length ? this.path[0] : this.tile
    let grid = this.host.grid
    if (avoid.size) {
      grid = grid.map((row, y) => row.map((ok, x) => ok && !(avoid.has(`${x},${y}`) && !(x === target.x && y === target.y))))
    }
    const route = findPath(grid, from, target) ?? (avoid.size ? findPath(this.host.grid, from, target) : null)
    if (!route) {
      this.path = []
      this.idleUntil = this.scene.time.now + 2000
      return
    }
    const keep = this.path.length ? [this.path[0]] : []
    const rest = route[0].x === from.x && route[0].y === from.y ? route.slice(1) : route
    this.path = [...keep, ...rest]
    if (!this.path.length) this.arrive()
  }

  private arrive(): void {
    const g = this.goal
    if (!g) return
    this.posed = g.spot
    this.facing = g.spot.facing
    this.waited = 0
    if (g.kind === 'desk') {
      this.host.reportPresence(this.employee.id, 'desk')
      this.host.onSeat(this, true)
    } else if (g.kind === 'meeting') this.host.reportPresence(this.employee.id, 'meeting')
    const act = this.current
    if (g.kind === 'idle' && act) {
      // patient people linger, restless ones move on sooner
      const scale = stayScale(this.profile.traits)
      const [lo, hi] = act.stayMs
      this.idleUntil = this.scene.time.now + (lo + this.rand() * (hi - lo)) * scale
      satisfy(this.needs, act)
      if (act.bubble) this.flashBubble(act.bubble, Math.min(3200, hi / 2))
    } else if (g.kind === 'desk' && this.activity === 'idle') {
      const desk = activityDef('desk')!
      const heads = this.profile.habits.includes('deepFocus') ? 1.7 : 0.8 + this.profile.traits.focus * 0.4
      this.idleUntil = this.scene.time.now + (desk.stayMs[0] + this.rand() * (desk.stayMs[1] - desk.stayMs[0])) * heads
    }
    this.host.onArrive(this, g)
    this.applyPose()
    const after = this.onArrival
    this.onArrival = null
    if (after && this.activity === 'idle') this.scene.time.delayedCall(250, after)
  }

  applyPose(): void {
    if (!this.posed) return
    const id = this.employee.id
    const s = this.posed
    this.sprite.setPosition(Math.round(this.x + (s.dx ?? 0)), Math.round(this.y + (s.dy ?? 0)))
    if (s.pose === 'sitUp') {
      const typing = this.goal?.kind === 'desk' && (this.activity === 'working' || this.activity === 'testing' || this.activity === 'reviewing')
      if (typing) this.sprite.play({ key: `${id}:type`, frameRate: this.doing === 'researching' || this.doing === 'reviewing' ? 2 : this.activity === 'testing' || this.doing === 'testing' ? 5 : 8 }, true)
      else this.sprite.stop().setFrame(frameIndex(ROW.sitUp, 0))
    } else if (s.pose === 'sitDown') {
      const presenting = (this.goal?.kind === 'meeting' && this.employee.role === 'pm') || this.goal?.key === 'focus:0'
      if (presenting) this.sprite.play(`${id}:talk`, true)
      else this.sprite.stop().setFrame(frameIndex(ROW.sitDown, 0))
    } else if (this.goal?.kind === 'pair' && this.goal.activity === 'pingpong') {
      // ready stance until the partner is at the table too; the scene starts the rally (startSwing)
      this.sprite.stop().setFrame(frameIndex(ROW[s.facing === 'right' ? 'talkRight' : 'talkLeft'], 0))
    } else if (this.goal?.kind === 'pair' && (s.facing === 'left' || s.facing === 'right')) {
      // in a conversation the resting state is listening; the scene gives each person their turn to speak
      this.sprite.play({ key: `${id}:listen-${s.facing}`, startFrame: Math.floor(this.rand() * 4) }, true)
    } else if (this.goal?.key.startsWith('coffee')) {
      this.sprite.stop().setFrame(frameIndex(ROW.up, 0))
      this.scene.time.delayedCall(2600, () => {
        if (this.posed === s) this.sprite.setFrame(frameIndex(ROW.extra, 1))
      })
    } else {
      this.sprite.stop().setFrame(frameIndex(ROW[this.facing], 0))
    }
  }

  // ── idle life ───────────────────────────────────────────────

  /** Needs, persona, time of day and cooldowns decide the next break. Never runs during real work. */
  private pickIdleGoal(): void {
    const now = this.scene.time.now
    const d = new Date()
    const hour = d.getHours() + d.getMinutes() / 60
    const here = this.tile
    const far = (a: ActivityDef) => {
      const spots = a.spots === 'desk' ? [DESKS[this.employee.deskId].seat] : IDLE_SPOTS[a.spots] ?? []
      return spots.length ? Math.min(...spots.map((sp) => Math.abs(sp.tx - here.x) + Math.abs(sp.ty - here.y))) : 10
    }
    // a live intention comes first (if it's time, and still makes sense); otherwise choose freely
    const intent = this.intent
    if (intent && now < intent.notBefore) {
      this.idleUntil = intent.notBefore
      return
    }
    this.intent = null
    const planned = intent && now <= intent.until ? activityDef(intent.activity) : undefined
    const act = planned ?? pickActivity(
      this.needs,
      this.persona,
      this.employee,
      hour,
      this.cooldowns,
      now,
      this.rand,
      (a) => !!this.goal && a.spots === this.goal.key.split(':')[0],
      far,
      // personality, recent memory and what's happening around them
      (a) => personalityWeight(a.id, this.profile, this.recent, this.host.context(this, a.id))
    )
    this.cooldowns[act.id] = now + act.cooldownMs
    this.current = act
    this.recent.did(act.id)
    if (act.id === 'joinChat') {
      if (this.host.joinChat(this)) return
    } else if (act.id === 'petDog') {
      if (this.host.petDog(this)) return
    } else if (act.id === 'watchPong') {
      if (this.tryIdleSpot('pongWatch')) return
    } else if (act.pair) {
      if (this.host.requestPair(this, act.pair)) return
    } else if (act.spots === 'desk') {
      this.goToDesk()
      if (this.posed) this.idleUntil = now + act.stayMs[0] + Math.random() * (act.stayMs[1] - act.stayMs[0])
      return
    } else if (this.tryIdleSpot(act.spots)) {
      // inviters (and anyone with initiative) sometimes bring a favourite colleague along
      const t = this.profile.traits
      const inviteOdds = (this.profile.habits.includes('inviter') ? 0.55 : 0.08 + t.initiative * 0.12) * (act.id === 'beanbag' && this.profile.habits.includes('gamer') ? 1.6 : 1)
      if ((act.id === 'coffee' || act.id === 'beanbag' || act.id === 'watchPong') && this.rand() < inviteOdds) this.host.invite(this, act.id)
      return
    }
    this.idleUntil = now + 2500
  }

  /** An invitation was accepted: head to the same kind of place (if a spot is free there). */
  acceptInvite(activityId: string): boolean {
    if (!this.available) return false
    const act = activityDef(activityId)
    if (!act || act.spots === 'pair' || act.spots === 'dog') return false
    this.current = act
    this.recent.did(act.id)
    this.cooldowns[act.id] = this.scene.time.now + act.cooldownMs
    return this.tryIdleSpot(activityId === 'watchPong' ? 'pongWatch' : act.spots)
  }

  /** Walk somewhere for a cosmetic moment chosen by the scene (e.g. next to the dog). */
  goTo(spot: Spot, key: string, activityId: string): void {
    this.current = activityDef(activityId) ?? null
    this.setGoal({ kind: 'idle', spot, key })
  }

  /** A small win: arms up (a single frame with reduced motion). */
  celebrate(): void {
    this.flashBubble('check', 1800)
    this.express('cheer', 1300)
  }

  private tryIdleSpot(kind: string): boolean {
    const spots = IDLE_SPOTS[kind]
    const order = [...spots.keys()].sort(() => Math.random() - 0.5)
    for (const i of order) {
      const key = `${kind}:${i}`
      if (this.host.claimSpot(key, this.employee.id)) {
        this.host.releaseSpot(key, this.employee.id)
        this.setGoal({ kind: 'idle', spot: spots[i], key })
        return true
      }
    }
    return false
  }

  /** Cosmetic coffee run requested from the world (clicking the coffee bar). */
  fetchCoffee(): boolean {
    if (this.activity !== 'idle' || this.path.length || this.goal?.kind === 'pair' || this.focusRole !== null) return false
    this.current = activityDef('coffee')!
    return this.tryIdleSpot('coffee')
  }

  /** A quick hello to a teammate passing by (cosmetic). */
  greet(): void {
    if (!this.bubbleImg) this.flashBubble('hi', 1600)
    // a wave toward the viewer, or a nod when facing sideways (reserved people just nod)
    this.express(this.style.amplitude === 'subtle' ? 'nod' : 'wave', 900)
  }

  // ── per-frame ───────────────────────────────────────────────

  update(time: number, delta: number): void {
    growNeeds(this.needs, delta, this.persona, this.activity !== 'idle' && this.activity !== 'meeting')
    if (this.expressing && time >= this.expressionEnds) this.endExpression()
    // idle habits while standing around: curious people ponder boards and windows, lively ones look about
    if (this.activity === 'idle' && !this.expressing && !this.path.length && this.posed?.pose === 'stand' && this.goal?.kind === 'idle' && time > this.nextIdleGesture) {
      this.nextIdleGesture = time + 6000 + this.rand() * 9000
      const k = this.goal.key.split(':')[0]
      if (this.style.idle === 'think' && ['kanban', 'roadmap', 'moodboard', 'lightTable', 'window', 'bookshelf'].includes(k)) this.express('think', 1800 + this.rand() * 1200)
      else if (this.style.idle === 'lookAround' && this.rand() < 0.6) {
        const dirs: Facing[] = ['left', 'right', 'down']
        const d = dirs[Math.floor(this.rand() * dirs.length)]
        this.glanceAt(this.x + (d === 'left' ? -20 : d === 'right' ? 20 : 0), this.y + (d === 'down' ? 20 : 0), 1000)
      }
    }
    // at the whiteboard or the test area: working it through, not standing still
    if (this.goal?.kind === 'station' && !this.path.length && this.posed && !this.expressing && time > this.nextStationGesture) {
      this.nextStationGesture = time + 5000 + this.rand() * 5000
      this.express(this.workPlace === 'whiteboard' ? 'explain' : 'think', 1500)
    }
    if (this.path.length) this.step(delta)
    else if (this.activity === 'idle' && !this.inStory && this.focusRole === null && time > this.idleUntil && this.posed && this.goal?.kind !== 'pair') {
      // after a coffee, often sit down somewhere to drink it
      if (this.goal?.key.startsWith('coffee') && Math.random() < 0.55) {
        this.current = activityDef('island')!
        if (this.tryIdleSpot(Math.random() < 0.6 ? 'island' : 'dining')) return
      }
      this.pickIdleGoal()
    }

    if (this.posed && time > this.nextBlink && !this.sprite.anims.isPlaying) {
      this.nextBlink = time + 2500 + Math.random() * 4000
      const s = this.posed
      if (s.pose === 'sitDown') {
        this.sprite.setFrame(frameIndex(ROW.sitDown, 2))
        this.scene.time.delayedCall(140, () => this.posed === s && !this.sprite.anims.isPlaying && this.sprite.setFrame(frameIndex(ROW.sitDown, 0)))
      } else if (s.pose === 'stand' && this.facing === 'down') {
        this.sprite.setFrame(frameIndex(ROW.extra, 0))
        this.scene.time.delayedCall(140, () => this.posed === s && this.sprite.setFrame(frameIndex(ROW.down, 0)))
      }
    }
    if (this.posed?.pose === 'sitUp' && this.activity === 'idle' && time > this.nextFidget && !this.sprite.anims.isPlaying) {
      this.nextFidget = time + 3000 + Math.random() * 5000
      const s = this.posed
      const typeOdds = this.persona.fidget === 'type' ? 0.75 : this.persona.fidget === 'look' ? 0.25 : 0.5
      if (this.goal?.kind === 'desk' && Math.random() < typeOdds) {
        this.sprite.play(`${this.employee.id}:type`)
        this.scene.time.delayedCall(900 + Math.random() * 1200, () => {
          if (this.posed === s && this.activity === 'idle') this.sprite.stop().setFrame(frameIndex(ROW.sitUp, 0))
        })
      } else {
        this.sprite.setFrame(frameIndex(ROW.sitUp, 3))
        this.scene.time.delayedCall(700, () => this.posed === s && !this.sprite.anims.isPlaying && this.sprite.setFrame(frameIndex(ROW.sitUp, 0)))
      }
    }

    this.sprite.setDepth(this.y)
    if (!this.posed) this.sprite.setPosition(Math.round(this.x), Math.round(this.y))
    const dx = this.posed?.dx ?? 0
    this.shadow.setPosition(Math.round(this.x + dx), Math.round(this.y)).setVisible(!this.posed || this.posed.pose === 'stand')
    this.ring.setPosition(Math.round(this.x + dx), Math.round(this.y + 1))
    this.sprite.setTint(this.hover ? 0xfff2d6 : 0xffffff)
    if (this.bubbleImg) this.bubbleImg.setPosition(Math.round(this.sprite.x + 7), Math.round(this.sprite.y - 30 + (this.host.reducedMotion() ? 0 : Math.sin(time / 250))))
  }

  private step(delta: number): void {
    const next = this.path[0]
    const atTileCenter = Math.abs(this.x - (this.tile.x * TILE + 8)) < 0.01 && Math.abs(this.y - (this.tile.y * TILE + FEET_Y)) < 0.01
    if (atTileCenter && (next.x !== this.tile.x || next.y !== this.tile.y)) {
      // entering a new tile: it must be free of other people
      if (!this.host.reserveTile(next.x, next.y, this.employee.id)) {
        const before = this.waited
        this.waited += delta
        this.sprite.stop().setFrame(frameIndex(ROW[this.facing], 0))
        if (this.waited > WAIT_PASS_MS) {
          // last resort: squeeze past rather than deadlock
          this.waited = 0
          this.host.releaseTile(next.x, next.y, '*')
        } else if (before <= WAIT_REPATH_MS && this.waited > WAIT_REPATH_MS && this.goal) {
          const target = { x: this.goal.spot.tx, y: this.goal.spot.ty }
          this.path = []
          this.routeTo(target, this.host.blockedByOthers(this.employee.id))
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
    const move = (SPEED * this.persona.pace * delta) / 1000
    const dir: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (dist > 0.01) {
      this.facing = dir
      this.sprite.play(`${this.employee.id}:walk-${dir}`, true)
    }
    if (dist <= move) {
      this.x = tx
      this.y = ty
      if (next.x !== this.tile.x || next.y !== this.tile.y) this.host.releaseTile(this.tile.x, this.tile.y, this.employee.id)
      this.tile = next
      this.host.footstep(this.x, this.y)
      this.path.shift()
      if (!this.path.length) this.arrive()
    } else {
      this.x += (dx / dist) * move
      this.y += (dy / dist) * move
    }
  }

  // ── emotes ──────────────────────────────────────────────────

  private refreshBubble(): void {
    const want: BubbleKind | null = this.needsYou ? 'alert' : this.activity === 'error' ? 'error' : null
    if (want) this.showBubble(want)
    else if (this.bubbleKind === 'alert' || this.bubbleKind === 'error') this.hideBubble()
  }

  /**
   * A brief acknowledgement of a real event: the bubble, plus a small lean back when seated and not
   * busy animating (skipped with reduced motion).
   */
  acknowledge(kind: BubbleKind, ms: number): void {
    this.flashBubble(kind, ms)
    const s = this.posed
    if (this.host.reducedMotion() || s?.pose !== 'sitUp' || this.sprite.anims.isPlaying) return
    this.sprite.setFrame(frameIndex(ROW.sitUp, 3))
    this.scene.time.delayedCall(800, () => this.posed === s && !this.sprite.anims.isPlaying && this.sprite.setFrame(frameIndex(ROW.sitUp, 0)))
  }

  flashBubble(kind: BubbleKind, ms: number): void {
    if (this.activity === 'waiting' || this.activity === 'error') return
    this.showBubble(kind)
    this.bubbleTimer?.remove()
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => this.bubbleKind === kind && this.hideBubble())
  }

  private showBubble(kind: BubbleKind): void {
    if (this.bubbleKind === kind && this.bubbleImg) return
    this.bubbleImg?.destroy()
    this.bubbleKind = kind
    this.bubbleImg = this.scene.add.image(this.sprite.x + 7, this.sprite.y - 30, `bubble:${kind}`).setOrigin(0, 1).setDepth(100000)
  }

  private hideBubble(): void {
    this.bubbleImg?.destroy()
    this.bubbleImg = null
    this.bubbleKind = null
  }
}
