import { decorArt, signGlowStrength, wallPlaster, artFor, backgroundArt, chairArt, deskArt, featureArt, glowFor } from './art/packs'
import { STUDIO_WALL_SCREENS } from './art/studio'
import { LAB_WALL_SCREENS, drawData } from './art/lab'
import Phaser from 'phaser'
import type { Employee, EmployeeStatus, OfficeConfig, OfficeLocation } from '@shared/types'
import { actions, store, type AppState } from '../store'
import { CELL_H, CELL_W, SHEET_COLS, characterSheet } from './art/characters'
import {
  DRAG_SLOP_CSS,
  PINCH_STEP,
  anchoredCenter,
  clampCenter,
  easeInOutSine,
  easeOutCubic,
  followFactor,
  placeCard,
  snapZoom,
  stepZoom,
  wheelIntent,
  type View
} from './camera'
import {
  FEATURE_CAP,
  FEATURE_FACE,
  clockFace,
  daylight,
  doorJamb,
  glassDoor,
  glassEdge,
  glassFace,
  paintPoster,
  partition,
  solidFace,
  windowGlass,
  windowSpan
} from './art/environment'
import * as F from './art/furniture'
import { M, type Ramp } from './art/palette'
import { makeCanvas, type Px } from './art/px'
import { activity as activityDef, personaFor } from './behavior'
import { emotionFor, planConversation, poseFor, type ConversationPlan } from './expression'
import { NOTICE, ReactionCooldowns, canNotice, glanceMs, intend, partingWords, reactTo, type Happening } from './awareness'
import { relationships, saveRelationships } from './social'
import { SUGGESTIONS, answerLine, answerSuggestion, type SuggestionId } from './people'
import { STORIES, StoryPacer, hostAppeal, leavesEarly, storyAppeal, storyLength, wantsToJoin, weightedPick, type StoryKind } from './stories'
import { acceptsInvite, choosePartner, dogResponse, gameWinner, reactToGame, seeded, type Context } from './personality'
import { Character, type CharacterHost, type Goal } from './Character'
import {
  COLS,
  DESKS,
  FEATURE_WALL,
  IDLE_SPOTS,
  INTERACTIVES,
  PAIR_SPOTS,
  PLACEMENTS,
  ROOM_LIGHTS,
  TILE,
  WALLS,
  WALL_DECOR,
  WORLD_H,
  WORLD_W,
  ZONES,
  buildWalkGrid,
  wallTiles,
  zoneAt,
  type DeskVariant,
  type Grid,
  type Interactive,
  type Placement,
  type Spot,
  type ZoneId,
  OFFICE,
  DOG as DOG_SPOTS
} from './layout'
import { detectMoments, MomentQueue, visitSpot, type Moment } from './moments'
import { doingOf, type WorkDoing } from '@shared/workActivity'
import { PlaceMachine, placeFor } from './workPlace'
import { findPath, type Pt } from './pathfinding'
import { officeSound } from './sound'
import { floatyArt, gameFor, pick, playfulLabel, propReaction, type Floaty } from './games/playful'
import { clickLine, nextRareEvent, paintWeather, rareGapMs, weatherAt, type RareEvent, type Weather } from './life'
import { Receptionist } from './Receptionist'
import { Corgi } from './Corgi'
import { TOY_ART, dogBed } from './art/corgi'
import { PERSONAL_KEYS, WALL_TOP, setPersonal, wallArt } from './art/decor'
import { DOG_BED_SIZE, canMove, dogBedAt, placeContext, resolveDecor, spotProblem, takenWall, tileProblem, wallProblem, type PlaceContext } from './decor'
import { DOG, DOG_BED, setDogCorner } from './dog'
import { DOG_BEDS, LIGHTS, cleanSign, decorDef, signFor, wallDef } from '@shared/officeDecor'
import { passingDesk, receptionEvents, shouldGreet } from './reception'
import {
  drawFocus,
  drawGame,
  drawKanban,
  drawMicrowave,
  drawPrimary,
  drawRoadmap,
  drawSecondary,
  drawSkyline,
  drawTeamBoard,
  drawTv,
  type LoungeChannel,
  type MonitorState,
  type RoadmapRow
} from './screens'

interface LiveCanvas {
  tex: Phaser.Textures.CanvasTexture
  px: Px
  w: number
  h: number
}

interface DeskScreens {
  deskId: string
  employeeId: string
  screens: LiveCanvas[]
  glow: Phaser.GameObjects.Image
  x: number
  y: number
}

interface ActivePair {
  index: number
  ids: [string, string]
  /** A third colleague who joined the conversation. */
  extra?: string[]
  arrived: Set<string>
  endsAt: number
  ball?: Phaser.GameObjects.Image
  /** The conversation's turn-by-turn plan (chat pairs only). */
  talk?: { plan: ConversationPlan; ids: string[]; i: number; turnEnds: number; closed: boolean }
  /** Paddles in the players' hands during a rally (the table's own paddles are hidden meanwhile). */
  held?: Phaser.GameObjects.Image[]
}

interface Door {
  cx: number
  cy: number
  open: number
  leaves: { img: Phaser.GameObjects.Image; closedX: number; dir: -1 | 1 }[]
}

interface Movable {
  p: Placement
  img: Phaser.GameObjects.Image
  kind: 'floor' | 'wall' | 'bed'
}

/** Pieces on the floor drag; the bed and what hangs on the wall do too. */
const canDrag = (m: Movable) => m.kind !== 'floor' || canMove(m.p)

const MIN_ZOOM = 1
const FIT_MIN_ZOOM = 0.6
const MAX_ZOOM = 6
const ACCENTS: Record<OfficeConfig['accent'], Ramp> = { terracotta: M.terracotta, sage: M.sage, slate: M.slate, mustard: M.mustard }
/** Hover and selection outline: the UI accent. */
const OUTLINE = 0x56d4ef
/** The piece selected while customizing: Autopia's verdigris. */
const ACTIVE = 0x5ec4c9
const ROLE_TINT: Record<string, string> = { pm: '#f7c66b', lead_dev: '#5fb7ff', designer: '#ff8fb1', qa: '#5ee6a8', engineer: '#b98cff' }

/**
 * The framing you chose, kept across office rebuilds (a new hire, a decor change, moving the window
 * to a display with a different density). Zoom is stored in CSS pixels per art pixel so it survives
 * a density change. In memory only: a fresh launch starts on the overview.
 */
/** When she last greeted you, kept across office rebuilds so a rebuild never repeats the hello. */
let lastUserGreeting = -Infinity

/** Per office (project): each company keeps its own camera framing when you switch between them. */
const keptViews = new Map<string, { cx: number; cy: number; cssZoom: number; followId: string | null }>()
const viewKey = () => store.getState().activeProjectId ?? '-'

/** One status icon per activity (12×12 paths): typing, testing, waiting, problem, meeting, reviewing. */
const STATUS_ICON: Record<string, string> = {
  working: 'M1 3h10v6H1zM2 4v4h8V4zM3 5h1v1H3zm2 0h1v1H5zm2 0h1v1H7zM3 7h6v1H3z',
  testing: 'M4.5 8.2 2.3 6l-1 1 3.2 3.2L10.7 4l-1-1z',
  waiting: 'M3 1h6v1H8v2.5L6.7 6 8 7.5V10h1v1H3v-1h1V7.5L5.3 6 4 4.5V2H3zm2 1v2.1L6 5.2l1-1.1V2z',
  error: 'M5 1h2v6H5zm0 8h2v2H5z',
  meeting: 'M1 2h10v6H6l-3 3V8H1z',
  reviewing: 'M6 3C3.2 3 1 6 1 6s2.2 3 5 3 5-3 5-3-2.2-3-5-3zm0 1.5A1.5 1.5 0 1 1 6 7.5a1.5 1.5 0 0 1 0-3z'
}

/** What the real tools say beats the plain state, where there's a shape for it. */
const DOING_ICON: Partial<Record<WorkDoing, string>> = {
  coding: STATUS_ICON.working,
  researching: 'M5 1a4 4 0 1 0 2.4 7.2L10 10.8l.9-.9-2.6-2.6A4 4 0 0 0 5 1zm0 1.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z',
  testing: STATUS_ICON.testing,
  debugging: 'M4 2h4v1h1v1h1v1H9v1h2v1H9v1h1v1H9v1H3V9H2V8h1V7H1V6h2V5H2V4h1V3h1zm1 2v5h2V4z',
  planning: STATUS_ICON.meeting,
  reviewing: STATUS_ICON.reviewing,
  collaborating: STATUS_ICON.meeting
}

/** The attention indicator over a teammate (distinct shapes, not just colors). */
const ATTN_GLYPH: Record<string, string> = { approval: '?', question: '?', blocked: '!', failure: '!', usage: '‖', interrupted: '‖', review: '✓' }

/** Room the team dock takes along the bottom of the stage, in CSS pixels. */
const DOCK_INSET = 72

export class OfficeScene extends Phaser.Scene {
  private grid!: Grid
  private placements: Placement[] = []
  private characters = new Map<string, Character>()
  private spots = new Map<string, string>()
  private tiles = new Map<string, string>()
  private pairs: ActivePair[] = []
  private desks: DeskScreens[] = []
  private chairs = new Map<string, Phaser.GameObjects.Image>()
  private tv!: LiveCanvas
  private kanban!: LiveCanvas
  private roadmap!: LiveCanvas
  private focusScreen!: LiveCanvas
  private gameTv!: LiveCanvas
  private tvChannel: LoungeChannel = 'auto'
  private tvSwitchedAt = -Infinity
  private microwave: { screen: LiveCanvas; img: Phaser.GameObjects.Image; until: number } | null = null
  /** Lights the founder switched by hand, per room, for this session; others follow occupancy. */
  private lightOverride = new Map<ZoneId, 'on' | 'off'>()
  private plants: { img: Phaser.GameObjects.Image; kind: string; frame: 0 | 1; next: number }[] = []
  private windows: { tex: Phaser.Textures.CanvasTexture; w: number; h: number; seed: number }[] = []
  private doors: Door[] = []
  private boothFronts: Phaser.GameObjects.Image[] = []
  private movables = new Map<string, Movable>()
  private clock!: Phaser.GameObjects.Image
  private lightTex!: Phaser.Textures.CanvasTexture
  private glowLayer!: Phaser.GameObjects.Image
  private signGlow!: Phaser.GameObjects.Image
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter
  private steamUntil = 0
  private brewLed!: Phaser.GameObjects.Image
  private brewCup!: Phaser.GameObjects.Image
  private printOut!: Phaser.GameObjects.Image
  private fish: Phaser.GameObjects.Image[] = []
  private roomba!: { img: Phaser.GameObjects.Image; path: Pt[]; x: number; y: number; wait: number }
  private highlight!: Phaser.GameObjects.Graphics
  private editLayer!: Phaser.GameObjects.Graphics
  private hovered: Interactive | null = null
  private tick = 0
  private light = 1
  private lastLightKey = ''
  private greeted = new Map<string, number>()
  private unsub: (() => void)[] = []
  private overlay!: HTMLElement
  private weather: Weather = 'clear'
  private weatherTick = 0
  private recentEvents: RareEvent[] = []
  private clickCounts = new Map<string, number>()
  private musicUntil = 0
  private feeds = 0
  private sayings: { el: HTMLElement; x: number; y: number }[] = []
  private placementImg = new Map<Placement, Phaser.GameObjects.Image>()
  private tapCounts = new Map<string, number>()
  private dogTaps: number[] = []
  private labels = new Map<string, HTMLElement>()
  private bgImage: Phaser.GameObjects.Image | null = null
  private wallScreens: LiveCanvas[] = []
  private posters: Phaser.GameObjects.Image[] = []
  private byKey = new Map<string, Phaser.GameObjects.Image[]>()
  private styled: { accent: OfficeConfig['accent']; art: OfficeConfig['art'] } = { accent: 'terracotta', art: 'grid' }
  /** Which project's office this scene is (its camera framing is kept per office). */
  private viewOf = '-'
  private meetingPanel!: HTMLElement
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean; button: number } | null = null
  private decorDrag: { m: Movable; tx: number; ty: number; gx: number; gy: number; moved: boolean; placing: boolean; why: string | null; others: Placement[]; ctx: PlaceContext; grid: Grid; taken: Set<number> } | null = null
  private hung = new Map<string, { m: Movable; sig: string }>()
  private hoverUid: string | null = null
  private _follow: string | null = null
  /** Who the camera follows; mirrored into the store so the employee sheet can show a Follow toggle. */
  private get followId(): string | null {
    return this._follow
  }
  private set followId(v: string | null) {
    if (v === this._follow) return
    this._follow = v
    store.setState({ followingId: v })
  }
  private userMoved = false

  private onReady?: () => void

  constructor() {
    super('office')
  }

  init(data: { overlay: HTMLElement; onReady?: () => void }): void {
    this.overlay = data.overlay
    this.onReady = data.onReady
  }

  create(): void {
    if (import.meta.env.DEV) Object.assign(window, { __scene: this })
    this.viewOf = viewKey()
    const s = store.getState()
    const employees = s.employees
    // the office as this project has made it: anything that no longer fits quietly falls back (decor.ts)
    this.placements = resolveDecor(s.office, employees.map((e) => e.deskId))
    this.grid = buildWalkGrid(this.placements)
    setDogCorner(null)
    setDogCorner(dogBedAt(s.office, this.placements))
    this.setPersonalArt(s.office)
    // a rebuild (a new hire) ends whatever was being placed; its ghost went with the old scene
    if (s.placing) store.setState({ placing: null })
    const accent = ACCENTS[s.office.accent] ?? M.terracotta
    F.setFabricAccent(accent)
    this.bgImage = this.add.image(0, 0, this.canvasTex('bg', backgroundArt(accent))).setOrigin(0).setDepth(0)
    this.styled = { accent: s.office.accent, art: s.office.art }
    this.createTextures()
    this.createWall(s.office.art)
    this.createArchitecture()
    this.createFurniture()
    this.syncWall(s.office)
    this.createAmbient()
    this.createLighting()
    this.createCharacters(employees)
    this.createReceptionist()
    // only offices with a dog have one (Puffy lives at the Tech Startup)
    if (DOG_SPOTS) this.createCorgi()
    this.createOverlay()
    this.setupCamera()
    const k = keptViews.get(viewKey())
    if (k) {
      this.userMoved = true
      this.setView({ cx: k.cx, cy: k.cy, zoom: Phaser.Math.Clamp(snapZoom(k.cssZoom * this.ds, this.ds), MIN_ZOOM * this.ds, MAX_ZOOM * this.ds) })
      if (k.followId && this.characters.has(k.followId)) this.followId = k.followId
    }
    this.setupInteractions()
    this.scheduleRareEvent()
    // a rebuild takes its timers with it: nothing it was saying stays on screen
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.sayings.forEach((q) => q.el.remove()))
    this.bindStore()

    this.time.addEvent({ delay: 280, loop: true, callback: () => this.animateScreens() })
    this.time.addEvent({ delay: 30_000, loop: true, callback: () => this.refreshTimeOfDay() })
    // only falling weather moves, only a few times a second, and only with the office on screen
    this.time.addEvent({
      delay: 220,
      loop: true,
      callback: () => {
        if ((this.weather !== 'rain' && this.weather !== 'snow') || store.getState().view !== 'office' || this.reducedMotionNow()) return
        this.weatherTick++
        this.paintWindows()
      }
    })
    this.time.addEvent({ delay: 2_000, loop: true, callback: () => this.refreshOccupancy() })
    this.time.addEvent({ delay: 700, loop: true, callback: () => this.checkGreetings() })
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.checkReception() })
    this.time.addEvent({ delay: 45_000, loop: true, callback: () => saveRelationships() })
    this.time.addEvent({ delay: 700, loop: true, callback: () => this.perceive() })
    this.time.addEvent({ delay: 2000, loop: true, callback: () => this.tickStories() })
    this.refreshTimeOfDay()
    this.animateScreens()

    // game.destroy() emits DESTROY (not SHUTDOWN); release store subscriptions on either.
    // Phaser destroys asynchronously, possibly after a replacement scene built its overlay, so each
    // scene removes only the elements it created.
    const teardown = () => {
      saveRelationships()
      if (this.cameras?.main) {
        const v = this.view
        if (this.userMoved) keptViews.set(this.viewOf, { cx: v.cx, cy: v.cy, cssZoom: v.zoom / this.ds, followId: this.followId })
        else keptViews.delete(this.viewOf)
      }
      this.visits = []
      this.game.canvas.style.cursor = ''
      this.unsub.forEach((u) => u())
      this.unsub = []
      for (const el of this.labels.values()) el.remove()
      this.receptionist?.destroy()
      this.corgi?.destroy()
      this.meetingPanel?.remove()
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown)
    this.onReady?.()
  }

  // ── texture helpers ─────────────────────────────────────────

  private canvasTex(key: string, canvas: HTMLCanvasElement): string {
    if (this.textures.exists(key)) this.textures.remove(key)
    this.textures.addCanvas(key, canvas)
    return key
  }

  private live(key: string, w: number, h: number): LiveCanvas {
    if (this.textures.exists(key)) this.textures.remove(key)
    const tex = this.textures.createCanvas(key, w, h)!
    const ctx = tex.getContext()
    ctx.imageSmoothingEnabled = false
    const { px } = makeCanvas(1, 1)
    px.ctx = ctx
    return { tex, px, w, h }
  }

  private createTextures(): void {
    this.canvasTex('shadow:char', F.shadowBlob(14, 5))
    this.canvasTex('ring', F.selectionRing())
    for (const b of ['alert', 'error', 'check', 'dots', 'coffee', 'idea', 'chat', 'music', 'heart', 'phone', 'book', 'food', 'hi'] as const) this.canvasTex(`bubble:${b}`, F.bubble(b))
    this.canvasTex('mote', F.dot('#fff6d8', 1))
    this.canvasTex('steam', F.dot('#ffffff', 2))
    this.canvasTex('flake', F.dot('#f2c35b', 1))
    this.canvasTex('ball', F.dot('#ffffff', 2))
    this.canvasTex('led:on', F.dot('#5ee6a8', 1))
    this.canvasTex('paper', F.dot('#fbfbf7', 4))
    this.canvasTex('cup', (() => {
      const { canvas, px } = makeCanvas(4, 4)
      px.r(0, 1, 3, 3, '#fbfaf7').p(3, 2, '#fbfaf7').h(1, 1, 1, '#5a3a24')
      return canvas
    })())
  }

  // ── north wall: windows, clock, TV, milestone board ─────────

  private createWall(art: OfficeConfig['art']): void {
    WALL_DECOR.windows.forEach((w, i) => {
      const key = `window:${i}`
      const { top, bottom } = windowSpan(w.tall)
      if (this.textures.exists(key)) this.textures.remove(key)
      const tex = this.textures.createCanvas(key, w.w * TILE, bottom - top)!
      this.windows.push({ tex, w: w.w, h: bottom - top, seed: 31 + i * 17 })
      this.add.image(w.x * TILE, top, key).setOrigin(0).setDepth(4)
    })
    this.clock = this.add.image(WALL_DECOR.clock.x * TILE + 8, 30, this.canvasTex('clock', clockFace(new Date()))).setDepth(6)
    const tv = WALL_DECOR.meetingTv
    this.tv = this.live('tv', tv.w * TILE, 30)
    this.add.image(tv.x * TILE, 22, 'tv').setOrigin(0).setDepth(6)
    const rm = WALL_DECOR.roadmap
    this.roadmap = this.live('roadmap', rm.w * TILE - 6, 29)
    this.add.image(rm.x * TILE + 3, 21, 'roadmap').setOrigin(0).setDepth(6)
    // the founder's choice of artwork for the engineering wall
    const { canvas, px } = makeCanvas(24, 31)
    paintPoster(px, 0, 0, art)
    this.canvasTex('poster', canvas)
    for (const p of WALL_DECOR.posters) this.posters.push(this.add.image(p.x * TILE + 4, 24, 'poster').setOrigin(0).setDepth(6))
    // the studio's playtest wall: the team's game loop plays on big screens over the dev pit
    if (OFFICE === 'studio' || OFFICE === 'lab') {
      this.wallScreens = (OFFICE === 'studio' ? STUDIO_WALL_SCREENS : LAB_WALL_SCREENS).map((sc, i) => {
        const c = this.live(`wallScreen:${i}`, sc.w * TILE, 30)
        this.add.image(sc.x * TILE, 21, c.tex.key).setOrigin(0).setDepth(6)
        return c
      })
    }
  }

  /**
   * Fabrics and artwork change in place: only the affected textures are repainted (no rebuild, so the
   * camera, people and everything else stay exactly where they are), then what changed glows briefly.
   */
  private applyStyle(office: OfficeConfig): void {
    const changed: Phaser.GameObjects.Image[] = []
    if (office.accent !== this.styled.accent) {
      const accent = ACCENTS[office.accent] ?? M.terracotta
      F.setFabricAccent(accent)
      this.canvasTex('bg', backgroundArt(accent))
      this.bgImage?.setTexture('bg')
      for (const key of F.FABRIC_KEYS) {
        const imgs = this.byKey.get(key) ?? []
        if (!imgs.length) {
          // next time one is put down, it comes in the new fabric
          if (this.textures.exists(key)) this.textures.remove(key)
          continue
        }
        this.canvasTex(key, artFor(key)())
        for (const img of imgs) img.setTexture(key)
        changed.push(...imgs)
      }
    }
    if (office.art !== this.styled.art) {
      const { canvas, px } = makeCanvas(24, 31)
      paintPoster(px, 0, 0, office.art)
      this.canvasTex('poster', canvas)
      for (const img of this.posters) img.setTexture('poster')
      changed.push(...this.posters)
    }
    this.styled = { accent: office.accent, art: office.art }
    // a soft pulse on what changed, so you can see it
    for (const img of changed) {
      this.tweens.killTweensOf(img)
      img.setAlpha(0.35)
      this.tweens.add({ targets: img, alpha: 1, duration: 520, ease: 'Sine.easeOut' })
    }
  }

  private refreshTimeOfDay(): void {
    const now = new Date()
    const weather = weatherAt(now)
    this.weather = weather
    // a grey day is a darker day indoors, and the lights know it
    const light = daylight(now) * (weather === 'rain' || weather === 'snow' ? 0.82 : weather === 'cloudy' ? 0.92 : 1)
    this.light = light
    this.canvasTex('clock', clockFace(now))
    this.clock.setTexture('clock')
    const key = `${light.toFixed(2)}:${weather}`
    if (key === this.lastLightKey) return
    this.lastLightKey = key
    this.paintWindows()
    this.paintLighting()
  }

  private paintWindows(): void {
    for (const w of this.windows) {
      const ctx = w.tex.getContext()
      ctx.clearRect(0, 0, w.tex.width, w.tex.height)
      ctx.drawImage(windowGlass(w.w, w.h, w.seed, this.light), 0, 0)
      paintWeather(ctx, w.tex.width, w.tex.height, this.weather, this.weatherTick, w.seed)
      w.tex.refresh()
    }
  }

  // ── architecture: glass, solid walls, doors, feature wall ───

  private createArchitecture(): void {
    for (const w of WALLS) {
      const gaps = (w.doors ?? []).map((d) => [d.at, d.at + d.w])
      const segs: [number, number][] = []
      let from = 0
      for (const [a, b] of gaps) {
        if (a > from) segs.push([from, a])
        from = b
      }
      if (from < w.len) segs.push([from, w.len])

      if (w.axis === 'h') {
        const bottom = (w.y + 1) * TILE
        segs.forEach(([a, b], i) => {
          const key = `${w.id}:${i}`
          this.canvasTex(key, w.kind === 'glass' ? glassFace((b - a) * TILE) : solidFace((b - a) * TILE, wallPlaster()))
          this.add.image((w.x + a) * TILE, bottom, key).setOrigin(0, 1).setDepth(bottom)
        })
        for (const d of w.doors ?? []) {
          const x0 = (w.x + d.at) * TILE
          if (w.kind === 'glass') {
            if (!this.textures.exists('glassDoor')) this.canvasTex('glassDoor', glassDoor(TILE))
            const door: Door = { cx: x0 + (d.w * TILE) / 2, cy: w.y * TILE + 8, open: 0, leaves: [] }
            for (let i = 0; i < d.w; i++) {
              const x = x0 + i * TILE
              door.leaves.push({ img: this.add.image(x, bottom, 'glassDoor').setOrigin(0, 1).setDepth(bottom + 0.2), closedX: x, dir: i < d.w / 2 ? -1 : 1 })
            }
            this.doors.push(door)
          } else {
            if (!this.textures.exists('jamb')) this.canvasTex('jamb', doorJamb())
            this.add.image(x0, bottom, 'jamb').setOrigin(0, 1).setDepth(bottom + 0.1)
            this.add.image(x0 + d.w * TILE - 3, bottom, 'jamb').setOrigin(0, 1).setDepth(bottom + 0.1)
          }
        }
      } else {
        segs.forEach(([a, b], i) => {
          const top = (w.y + a) * TILE - 6
          const bottom = (w.y + b) * TILE
          const key = `${w.id}:${i}`
          if (w.kind === 'glass') {
            this.canvasTex(key, glassEdge(bottom - top))
            this.add.image(w.x * TILE + 5, top, key).setOrigin(0).setDepth(bottom - 1)
          } else {
            this.canvasTex(key, partition(bottom - top, wallPlaster()))
            this.add.image(w.x * TILE + 3, top, key).setOrigin(0).setDepth(bottom)
          }
        })
      }
    }

    const fw = FEATURE_WALL
    const fBottom = (fw.y + fw.h) * TILE
    const { wall, glow } = featureArt()
    this.canvasTex('featureWall', wall)
    this.canvasTex('featureGlow', glow)
    this.add.image(fw.x * TILE, fBottom, 'featureWall').setOrigin(0, 1).setDepth(fBottom)
    this.signGlow = this.add
      .image(fw.x * TILE - 20, fBottom - FEATURE_CAP - FEATURE_FACE - 20, 'featureGlow')
      .setOrigin(0)
      .setDepth(fBottom + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.6)
    this.tweens.add({ targets: this.signGlow, alpha: { from: signGlowStrength(), to: signGlowStrength() * 1.44 }, duration: 2800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  // ── furniture ───────────────────────────────────────────────

  /** One piece of furniture in the world, standing on its footprint. */
  private placeImage(p: Placement, as?: string): Phaser.GameObjects.Image {
    const isPlant = p.key.startsWith('plant:')
    const key = as ?? (isPlant ? `${p.key}:0` : p.key)
    if (!this.textures.exists(key)) this.canvasTex(key, artFor(p.key)())
    const tex = this.textures.get(key).getSourceImage() as HTMLCanvasElement
    const bottom = (p.ty + p.th) * TILE + (p.dy ?? 0)
    const x = Math.round(p.tx * TILE + (p.dx ?? 0) + (p.tw * TILE - tex.width) / 2)
    const img = this.add.image(x, bottom, key).setOrigin(0, 1).setDepth(p.flat ? 0.5 : bottom + (p.depthBias ?? 0))
    this.byKey.set(key, [...(this.byKey.get(key) ?? []), img])
    this.placementImg.set(p, img)
    if (isPlant) this.plants.push({ img, kind: p.key.slice(6), frame: 0, next: 1000 + Math.random() * 3000 })
    if (p.uid && canMove(p)) this.movables.set(p.uid, { p, img, kind: 'floor' })
    return img
  }

  private dropImage(p: Placement): void {
    const img = this.placementImg.get(p)
    if (!img) return
    this.placementImg.delete(p)
    this.movables.delete(p.uid ?? '')
    this.plants = this.plants.filter((x) => x.img !== img)
    for (const [k, list] of this.byKey) if (list.includes(img)) this.byKey.set(k, list.filter((x) => x !== img))
    img.destroy()
  }

  private createFurniture(): void {
    for (const kind of ['monstera', 'fig', 'snake', 'small', 'cactus', 'palm'] as const) {
      this.canvasTex(`plant:${kind}:0`, F.plant(kind, 0))
      this.canvasTex(`plant:${kind}:1`, F.plant(kind, 1))
    }
    this.canvasTex('chair:office', chairArt(false))
    this.canvasTex('chair:officeAway', chairArt(true))
    const team = store.getState().employees
    for (const [id, d] of Object.entries(DESKS)) {
      // a workstation is styled for whoever sits there, down to their mug
      const owner = team.find((e) => e.deskId === id)
      this.canvasTex(`desk:${id}`, deskArt(owner ? variantFor(owner) : d.variant, owner ? personalFor(owner) : undefined))
    }

    for (const p of this.placements) {
      if (p.key === 'phoneBooth') {
        this.createBooth(p)
        continue
      }
      const deskChair = p.key.startsWith('chair:office:') ? p.key.slice('chair:office:'.length) : null
      const img = this.placeImage(p, deskChair ? 'chair:officeAway' : undefined)
      const tex = img.texture.getSourceImage() as HTMLCanvasElement
      const x = img.x
      const bottom = img.y
      if (deskChair) this.chairs.set(deskChair, img)
      const top = bottom - tex.height
      if (p.key === 'kanbanBoard') {
        this.kanban = this.live('kanban', F.KANBAN_BOARD.w, F.KANBAN_BOARD.h)
        this.add.image(x + F.KANBAN_BOARD.x, top + F.KANBAN_BOARD.y, 'kanban').setOrigin(0).setDepth(bottom + 1)
      }
      if (p.key === 'aquarium') this.createFish(x, top, bottom)
      if (p.key === 'pingpong') {
        this.tablePaddles = F.PINGPONG_PADDLES.map((pd, i) =>
          this.add.image(x + pd.x, top + pd.y, this.canvasTex(`paddle:${i}`, F.paddle(pd.color, pd.handle))).setOrigin(0).setDepth(bottom + 0.5)
        )
        // the resting ball: the rally uses its own ball, so this one is picked up too
        this.tablePaddles.push(this.add.image(x + F.PINGPONG_BALL.x, top + F.PINGPONG_BALL.y, this.canvasTex('ball:rest', F.dot('#ffffff', 1))).setOrigin(0).setDepth(bottom + 0.5))
      }
      if (p.key === 'coffeeBar') this.createCoffeeBar(x, top, bottom)
      if (p.key === 'displayStand') {
        const r = F.DISPLAY_SCREEN
        this.focusScreen = this.live('focusScreen', r.w, r.h)
        this.add.image(x + r.x, top + r.y, 'focusScreen').setOrigin(0).setDepth(bottom + 1)
      }
      if (p.key === 'tvConsole') {
        const r = F.TV_SCREEN
        this.gameTv = this.live('gameTv', r.w, r.h)
        this.add.image(x + r.x, top + r.y, 'gameTv').setOrigin(0).setDepth(bottom + 1)
      }
      if (p.key === 'kitchenRun') {
        const screen = this.live('microwave', 16, 9)
        const img = this.add.image(x + 100, top + 4, 'microwave').setOrigin(0).setDepth(bottom + 1).setVisible(false)
        this.microwave = { screen, img, until: 0 }
      }
      if (p.key === 'printerStation') {
        this.printOut = this.add.image(x + 12, top + 18, 'paper').setOrigin(0).setDepth(bottom + 1).setVisible(false)
      }
      if (p.key === 'lightTable') {
        const L = F.LIGHT_TABLE
        this.add
          .image(x + L.x + L.w / 2, top + L.y + L.h / 2, this.canvasTex('lightTableGlow', glowBlob(L.w + 24, L.h + 20, '#e6f6ff')))
          .setDepth(bottom + 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setAlpha(0.35)
      }
    }

    const furnished = new Set(this.placements.filter((p) => p.id?.startsWith('desk:')).map((p) => p.id!.slice(5)))
    const employees = store.getState().employees
    for (const deskId of furnished) {
      const d = DESKS[deskId]
      const left = d.desk.x * TILE
      const top = (d.desk.y + d.desk.h) * TILE - F.DESK_H
      const depth = (d.desk.y + d.desk.h) * TILE + 0.5
      const screens = F.DESK_SCREENS.map((sc, i) => {
        const c = this.live(`screen:${deskId}:${i}`, sc.w, sc.h)
        this.add.image(left + sc.x, top + sc.y, c.tex.key).setOrigin(0).setDepth(depth)
        return c
      })
      const glow = this.add
        .image(left + 24, top + 14, this.canvasTex(`screenGlow:${deskId}`, glowBlob(60, 34, '#9fc8ff')))
        .setDepth(depth + 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0)
      const emp = employees.find((e) => e.deskId === deskId)
      this.desks.push({ deskId, employeeId: emp?.id ?? '', screens, glow, x: left, y: top })
    }
  }

  private createBooth(p: Placement): void {
    if (!this.textures.exists('phoneBooth:back')) {
      this.canvasTex('phoneBooth:back', F.phoneBoothBack())
      this.canvasTex('phoneBooth:front', F.phoneBoothFront())
    }
    const x = p.tx * TILE
    const bottom = (p.ty + 2) * TILE
    this.add.image(x, bottom, 'phoneBooth:back').setOrigin(0, 1).setDepth((p.ty + 1) * TILE)
    this.boothFronts.push(this.add.image(x, bottom, 'phoneBooth:front').setOrigin(0, 1).setDepth(bottom + 2))
  }

  private createCoffeeBar(x: number, top: number, bottom: number): void {
    const B = F.COFFEE_BAR
    this.brewLed = this.add.image(x + B.led.x, top + B.led.y, 'led:on').setOrigin(0).setDepth(bottom + 1).setVisible(false)
    this.brewCup = this.add.image(x + B.spouts[0] - 1, top + B.spoutY - 3, 'cup').setOrigin(0).setDepth(bottom + 1).setVisible(false)
    this.steam = this.add
      .particles(x + B.spouts[0], top + 2, 'steam', {
        lifespan: 1500,
        speedY: { min: -12, max: -7 },
        speedX: { min: -2, max: 2 },
        alpha: { start: 0.5, end: 0 },
        scale: { start: 0.6, end: 1.6 },
        frequency: 160,
        emitting: false
      })
      .setDepth(30_000)
  }

  private createFish(x: number, top: number, bottom: number): void {
    const water = F.AQUARIUM_WATER
    // hidden detail: a rubber duck bobbing at the surface, drifting slowly across
    const duck = this.add.image(x + water.x + 8, top + water.y - 2, this.canvasTex('rubberDuck', F.rubberDuck())).setOrigin(0).setDepth(bottom + 1.5).setFlipX(true)
    if (!this.reduced) this.tweens.add({ targets: duck, x: x + water.x + water.w - 14, duration: 26_000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onYoyo: () => duck.toggleFlipX(), onRepeat: () => duck.toggleFlipX() })
    ;['#ff8c42', '#ffd23f', '#5fb7ff', '#ff5ea8'].forEach((c, i) => {
      const key = this.canvasTex(`fish:${i}`, F.fish(c))
      const fy = top + water.y + 3 + (i % 3) * 4
      const f = this.add.image(x + water.x + 6 + i * 9, fy, key).setDepth(bottom + 1)
      this.fish.push(f)
      const swim = () => {
        const tx = x + water.x + 4 + Math.random() * (water.w - 8)
        f.setFlipX(tx > f.x)
        this.tweens.add({
          targets: f,
          x: tx,
          y: top + water.y + 3 + Math.random() * (water.h - 8),
          duration: 1800 + Math.random() * 2600,
          ease: 'Sine.easeInOut',
          onComplete: () => this.time.delayedCall(300 + Math.random() * 1500, swim)
        })
      }
      swim()
    })
  }

  // ── ambient life ────────────────────────────────────────────

  private createAmbient(): void {
    const ws = WALL_DECOR.windows[0]
    this.add
      .particles(0, 0, 'mote', {
        x: { min: ws.x * TILE, max: (WALL_DECOR.windows[1].x + WALL_DECOR.windows[1].w) * TILE + 20 },
        y: { min: 4 * TILE + 4, max: 8 * TILE },
        lifespan: 6000,
        speedX: { min: -3, max: 3 },
        speedY: { min: -2, max: 2 },
        alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) },
        frequency: 700,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(20_000)

    this.canvasTex('roomba', F.roomba())
    const start = { x: 12, y: 16 }
    this.roomba = {
      img: this.add.image(start.x * TILE + 8, start.y * TILE + 10, 'roomba').setOrigin(0.5, 1),
      path: [],
      x: start.x * TILE + 8,
      y: start.y * TILE + 10,
      wait: 0
    }
  }

  // ── playing around (all of it local, none of it touching real work) ───────────

  /** Someone free comes over to play you. Busy people are left alone: nobody leaves real work for a game. */
  startMatch(game: 'pong' | 'foosball' | 'hotfix'): string | null {
    if (game === 'hotfix') return null
    const key = game === 'pong' ? 'pingpong' : 'foosball'
    const table = this.placements.find((p) => p.key === key)
    if (!table) return null
    const free = [...this.characters.values()].filter((c) => c.activity === 'idle')
    const cx = (table.tx + table.tw / 2) * TILE
    const cy = (table.ty + table.th) * TILE
    free.sort((a, b) => Math.hypot(a.position.x - cx, a.position.y - cy) - Math.hypot(b.position.x - cx, b.position.y - cy))
    const c = free[0]
    if (!c) return null
    const spot: Spot = game === 'pong' ? PAIR_SPOTS.find((q) => q.kind === 'pingpong')?.b ?? { tx: table.tx, ty: table.ty + table.th, facing: 'up', pose: 'stand' } : { tx: table.tx + 1, ty: table.ty + table.th, facing: 'up', pose: 'stand' }
    c.goTo(spot, `play:${game}`, 'watchPong')
    // word gets around: someone free may come and watch, and so will the dog
    const watcher = game === 'pong' ? free[1] : undefined
    const seat = IDLE_SPOTS.pongWatch?.[0]
    if (watcher && seat && Math.random() < 0.6) watcher.goTo(seat, 'play:watch', 'watchPong')
    if (this.corgi && Math.random() < 0.5) this.corgi.watch({ x: table.tx + table.tw + 1, y: table.ty + table.th })
    return c.employee.id
  }

  /** How it went: your opponent takes it well or badly, and anyone free nearby notices. Then everyone goes back to what they were doing. */
  endMatch(id: string | null, youWon: boolean): string | null {
    if (this.corgi && youWon && !this.reducedMotionNow()) this.corgi.patBy(this.corgi.position.x)
    const c = id ? this.characters.get(id) : null
    if (!c || c.activity !== 'idle') return null
    const line = youWon ? pick(['Rematch?', 'Lucky.', 'I let you win.', 'My paddle is broken.']) : pick(['Good game!', 'Back to work, champ.', 'Too easy.', 'Again?'])
    if (youWon) c.express('shrug', 1500)
    else c.celebrate()
    this.say(c.position.x, c.position.y - 26, line)
    return `${c.employee.name.split(' ')[0]}: “${line}”`
  }

  private reducedMotionNow(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /** A few words over something in the world, gone in a moment. */
  private say(x: number, y: number, text: string, ms = 2200): void {
    const el = document.createElement('div')
    el.className = 'office-say'
    el.textContent = text
    this.overlay.appendChild(el)
    const said = { el, x, y }
    this.sayings.push(said)
    this.placeSaying(said)
    this.time.delayedCall(ms, () => {
      el.remove()
      this.sayings = this.sayings.filter((q) => q !== said)
    })
  }

  private placeSaying(q: { el: HTMLElement; x: number; y: number }): void {
    const at = this.toScreen(q.x, q.y)
    // near the edge of the office it stays readable rather than running off it
    const half = q.el.offsetWidth / 2
    const x = Math.max(half + 6, Math.min(this.overlay.clientWidth - half - 6, at.x))
    q.el.style.transform = `translate(calc(${Math.round(x)}px - 50%), calc(${Math.round(at.y)}px - 100%))`
  }

  /** A small pixel floating up from something: a can, a note, a leaf, a spark. */
  private floatUp(x: number, y: number, what: Floaty): void {
    const key = `fun:${what}`
    if (!this.textures.exists(key)) this.canvasTex(key, floatyArt(what))
    const img = this.add.image(Math.round(x), Math.round(y), key).setDepth(60_000)
    if (this.reducedMotionNow()) return void this.time.delayedCall(900, () => img.destroy())
    this.tweens.add({ targets: img, y: y - 14, alpha: 0, duration: 1100, ease: 'Sine.easeOut', onComplete: () => img.destroy() })
  }

  /** The thing itself gives a little: a squash, a shake, a hop. */
  private jiggle(img: Phaser.GameObjects.Image | undefined, how: 'squash' | 'shake' | 'hop'): void {
    if (!img || this.reducedMotionNow()) return
    if (how === 'squash') this.tweens.add({ targets: img, scaleY: 0.82, scaleX: 1.12, yoyo: true, duration: 110, ease: 'Sine.easeInOut' })
    else if (how === 'hop') this.tweens.add({ targets: img, y: img.y - 3, yoyo: true, duration: 120, ease: 'Sine.easeOut' })
    else this.tweens.add({ targets: img, x: img.x + 1, yoyo: true, repeat: 3, duration: 45 })
  }

  /** A click on something that's just there to be clicked. */
  private tapProp(id: string): void {
    if (id === 'fun:clock') {
      const n = (this.tapCounts.get('clock') ?? 0) + 1
      this.tapCounts.set('clock', n)
      if (n % 3) return
      if (!this.reducedMotionNow()) this.tweens.add({ targets: this.clock, angle: 360, duration: 900, ease: 'Cubic.easeInOut', onComplete: () => this.clock.setAngle(0) })
      this.say(this.clock.x, this.clock.y + 16, pick(['It’s always three o’clock somewhere.', 'Nobody’s sure who winds it.', 'Time is a suggestion.']))
      for (const c of this.characters.values()) if (c.activity === 'idle' && Math.random() < 0.4) c.express('think', 1000)
      return
    }
    const p = this.playfulPlacements().find((x) => x.id === id)?.p
    if (!p) return
    const img = this.placementImg.get(p)
    const x = (p.tx + p.tw / 2) * TILE
    const y = p.ty * TILE
    const n = (this.tapCounts.get(p.key) ?? 0) + 1
    this.tapCounts.set(p.key, n)
    const r = propReaction(p.key, n, Math.random)
    if (!r) return
    if (p.key === 'recordConsole') this.musicUntil = this.time.now + 30_000
    // the twelfth time, the plant gives up and flowers
    if (p.key.startsWith('plant:') && n === 12 && img) {
      if (!this.textures.exists('fun:flower')) this.canvasTex('fun:flower', floatyArt('flower'))
      this.add.image(x, img.y - img.height + 2, 'fun:flower').setDepth(img.depth + 1)
    }
    this.jiggle(img, r.move)
    if (r.icon) this.floatUp(x, y, r.icon)
    if (r.text) this.say(x, y - 6, r.text)
    if (r.crowd) {
      const near = [...this.characters.values()].find((c) => c.activity === 'idle' && Math.hypot(c.position.x - x, c.position.y - y) < 12 * TILE)
      if (near) near.express(r.crowd, 1300)
    }
  }

  /** What in this office can be played with, wherever the decor has been moved to. */
  private playfulPlacements(): { id: string; p: Placement; label: string }[] {
    return this.placements.flatMap((p, i) => {
      const label = playfulLabel(p.key)
      return label ? [{ id: `${gameFor(p.key) ? 'play' : 'fun'}:${p.key}:${i}`, p, label }] : []
    })
  }

  /** Every so often, something happens. Only with the office on screen, and only ever to people who aren't working. */
  private scheduleRareEvent(): void {
    this.time.delayedCall(rareGapMs(Math.random), () => {
      this.scheduleRareEvent()
      if (store.getState().view === 'office' && !store.getState().playing) this.playRareEvent()
    })
  }

  private playRareEvent(force?: RareEvent): RareEvent | null {
    const free = [...this.characters.values()].filter((c) => c.activity === 'idle').sort(() => Math.random() - 0.5)
    const resting = free.find((c) => ['sofa', 'armchair', 'beanbag', 'read'].includes(c.onBreak ?? ''))
    const kind = force ?? nextRareEvent(Math.random, this.recentEvents, { idle: free.length, someoneResting: !!resting, hasDog: !!this.corgi, reducedMotion: this.reducedMotionNow() })
    if (!kind) return null
    this.recentEvents = [...this.recentEvents, kind].slice(-4)
    const over = (c: Character, text: string) => this.say(c.position.x, c.position.y - 26, text, 2600)
    switch (kind) {
      case 'plane': {
        if (!this.textures.exists('fun:plane')) this.canvasTex('fun:plane', floatyArt('plane'))
        const z = ZONES.workspace
        const y = (z.y + 2 + Math.random() * Math.max(1, z.h - 4)) * TILE
        const plane = this.add.image(-12, y, 'fun:plane').setDepth(60_000)
        this.tweens.add({ targets: plane, x: WORLD_W + 12, y: y + 30, duration: 9000, ease: 'Sine.easeInOut', onComplete: () => plane.destroy() })
        free.filter(() => Math.random() < 0.35).forEach((c) => c.express('surprise', 1200))
        break
      }
      case 'coffeeMishap': {
        const bar = this.placements.find((p) => p.key === 'coffeeBar')
        if (!bar) return null
        this.startBrew()
        const x = (bar.tx + bar.tw / 2) * TILE
        this.say(x, bar.ty * TILE - 4, pick(['The machine has opinions today.', 'That is not supposed to do that.', 'Someone asked it for decaf.']), 3000)
        for (let i = 0; i < 5; i++) this.time.delayedCall(i * 180, () => this.floatUp(x + (i - 2) * 3, bar.ty * TILE, 'bubble'))
        if (free[0]) free[0].express('surprise', 1400)
        break
      }
      case 'nap': {
        if (!resting) return null
        over(resting, 'Zzz…')
        resting.flashBubble('dots', 5000)
        this.time.delayedCall(5200, () => resting.activity === 'idle' && resting.express('surprise', 700))
        break
      }
      case 'puffySteal': {
        const d = this.corgi
        if (!d) return null
        const ball = d.ballSprite
        const from = { x: Math.floor(ball.x / TILE), y: Math.floor((ball.y - 1) / TILE) }
        const to = d.landingFor(from)
        if (!to) return null
        d.fetch(from, to)
        this.say(d.position.x, d.position.y - 18, 'Puffy has borrowed something. Again.', 2600)
        break
      }
      case 'birthday': {
        // cake, not a finished job: this has nothing to do with the work
        const party = free.slice(0, 3)
        party.forEach((c, i) =>
          this.time.delayedCall(i * 260, () => {
            if (c.activity !== 'idle') return
            c.express('cheer', 1400)
            c.flashBubble('heart', 1600)
            this.floatUp(c.position.x, c.position.y - 22, 'spark')
          })
        )
        if (party[0]) over(party[0], 'Is it someone’s birthday? It’s someone’s birthday.')
        break
      }
      case 'foosRivalry': {
        const spots = IDLE_SPOTS.foosball
        if (!spots || free.length < 2) return null
        const [a, b] = free
        a.goTo(spots[0], 'play:foos:0', 'foosball')
        b.goTo(spots[1], 'play:foos:1', 'foosball')
        this.time.delayedCall(12_000, () => {
          if (a.activity !== 'idle' || b.activity !== 'idle') return
          const w = gameWinner({ id: a.employee.id, traits: a.profile.traits }, { id: b.employee.id, traits: b.profile.traits }, Math.random)
          const [won, lost] = w === a.employee.id ? [a, b] : [b, a]
          won.express('cheer', 1400)
          lost.express('shrug', 1400)
          over(won, pick(['GOAL!', 'And that’s the match.', 'Best of nine?']))
        })
        break
      }
    }
    return kind
  }

  /** Cosmetic: the machine brews and, if someone is free, they come for a cup. Never touches real work. */
  brewCoffee(): string | null {
    this.startBrew()
    const bar = this.placements.find((p) => p.key === 'coffeeBar')!
    const bx = (bar.tx + 1) * TILE
    const by = (bar.ty + 1) * TILE
    const free = [...this.characters.values()].filter((c) => c.activity === 'idle')
    free.sort((a, b) => Math.hypot(a.position.x - bx, a.position.y - by) - Math.hypot(b.position.x - bx, b.position.y - by))
    for (const c of free) if (c.fetchCoffee()) return c.employee.name.split(' ')[0]
    return null
  }

  private startBrew(): void {
    this.steamUntil = this.time.now + 3500
    this.brewLed?.setVisible(true)
    this.brewCup?.setVisible(true)
    officeSound.brew()
    this.time.delayedCall(3600, () => {
      this.brewLed?.setVisible(false)
      this.brewCup?.setVisible(false)
    })
  }

  /** Cosmetic: sprinkle flakes and let the fish dart up. */
  feedFish(): void {
    if (++this.feeds === 5) {
      const q = this.placements.find((x) => x.key === 'aquarium')!
      this.time.delayedCall(1400, () => this.say((q.tx + q.tw / 2) * TILE, q.ty * TILE - 6, 'Something large just ate all of that.'))
    }
    const p = this.placements.find((x) => x.key === 'aquarium')!
    const x0 = p.tx * TILE + 6
    const top = (p.ty + p.th) * TILE - 38 + F.AQUARIUM_WATER.y
    const em = this.add
      .particles(0, 0, 'flake', { x: { min: x0, max: x0 + 36 }, y: top, speedY: { min: 4, max: 9 }, lifespan: 2600, quantity: 2, frequency: 90 })
      .setDepth((p.ty + p.th) * TILE + 2)
    this.time.delayedCall(700, () => em.stop())
    this.time.delayedCall(3500, () => em.destroy())
    for (const f of this.fish) {
      this.tweens.killTweensOf(f)
      this.tweens.add({ targets: f, y: top + 2 + Math.random() * 3, x: x0 + Math.random() * 36, duration: 700, ease: 'Sine.easeOut' })
    }
  }

  /** Cosmetic: a sheet slides out of the printer. */
  printSheet(): void {
    if (!this.printOut || this.printOut.visible) return
    officeSound.printer()
    const y0 = this.printOut.y
    this.printOut.setVisible(true).setAlpha(1)
    this.tweens.add({
      targets: this.printOut,
      y: y0 + 3,
      duration: 1400,
      onComplete: () => {
        this.printOut.setVisible(false)
        this.printOut.y = y0
      }
    })
  }

  /** Cosmetic: the microwave runs for a few seconds, then dings. Returns false if it's already running. */
  heatLunch(): boolean {
    const m = this.microwave
    if (!m || this.time.now < m.until) return false
    const ms = 6000
    m.until = this.time.now + ms
    m.img.setVisible(true)
    officeSound.click()
    officeSound.hum(ms / 1000)
    this.time.delayedCall(ms, () => {
      m.img.setVisible(false)
      officeSound.ding()
    })
    return true
  }

  get loungeChannel(): LoungeChannel {
    return this.tvChannel
  }

  setLoungeChannel(c: LoungeChannel): void {
    if (c === this.tvChannel) return
    this.tvChannel = c
    this.tvSwitchedAt = this.time.now
    officeSound.click()
    this.animateScreens()
  }

  lightsIn(zone: ZoneId): 'auto' | 'on' | 'off' {
    return this.lightOverride.get(zone) ?? 'auto'
  }

  setLights(zone: ZoneId, mode: 'auto' | 'on' | 'off'): void {
    if (mode === 'auto') this.lightOverride.delete(zone)
    else this.lightOverride.set(zone, mode)
    officeSound.click()
    this.paintLighting()
  }

  /** Footfalls are heard only for people in view, louder near the centre and when zoomed in. */
  private footstep(x: number, y: number): void {
    if (!officeSound.prefs.enabled) return
    const view = this.cameras.main.worldView
    if (!view.contains(x, y)) return
    const d = Math.hypot(x - view.centerX, y - view.centerY) / Math.hypot(view.width / 2, view.height / 2)
    const zoom = Math.min(1, this.cameras.main.zoom / this.ds / 4)
    officeSound.step((1 - d) * zoom)
  }

  private updateRoomba(delta: number): void {
    const r = this.roomba
    if (r.wait > 0) {
      r.wait -= delta
      return
    }
    if (!r.path.length) {
      const from = { x: Math.floor(r.x / TILE), y: Math.floor(r.y / TILE) }
      for (let i = 0; i < 20; i++) {
        const to = { x: 1 + Math.floor(Math.random() * 53), y: 5 + Math.floor(Math.random() * 29) }
        const path = findPath(this.grid, from, to)
        if (path && path.length > 3) {
          r.path = path.slice(1)
          break
        }
      }
      r.wait = 2500 + Math.random() * 6000
      return
    }
    const n = r.path[0]
    const tx = n.x * TILE + 8
    const ty = n.y * TILE + 10
    const d = Math.hypot(tx - r.x, ty - r.y)
    const step = (14 * delta) / 1000
    if (d <= step) {
      r.x = tx
      r.y = ty
      r.path.shift()
    } else {
      r.x += ((tx - r.x) / d) * step
      r.y += ((ty - r.y) / d) * step
    }
    r.img.setPosition(Math.round(r.x), Math.round(r.y)).setDepth(r.y - 4)
  }

  // ── lighting ────────────────────────────────────────────────

  private createLighting(): void {
    if (this.textures.exists('lightmap')) this.textures.remove('lightmap')
    this.lightTex = this.textures.createCanvas('lightmap', WORLD_W, WORLD_H)!
    this.add.image(0, 0, 'lightmap').setOrigin(0).setDepth(50_000).setBlendMode(Phaser.BlendModes.MULTIPLY)
    this.canvasTex('lampGlow', lampGlowMap(this.placements, this.lightRgb(), this.litWallSpots()))
    this.glowLayer = this.add.image(0, 0, 'lampGlow').setOrigin(0).setDepth(50_001).setBlendMode(Phaser.BlendModes.ADD)
  }

  /** This project's lighting colour, as 'r,g,b'. */
  private lightRgb(): string {
    const c = LIGHTS[store.getState().office.light]?.color ?? LIGHTS.warm.color
    return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',')
  }

  private litWallSpots(): { x: number; y: number }[] {
    return store.getState().office.wall.filter((h) => wallDef(h.key)?.lit).map((h) => ({ x: (h.x + (wallDef(h.key)!.w ?? 2) / 2) * TILE, y: WALL_TOP + 14 }))
  }

  private addedLights(): { x: number; y: number; r: number }[] {
    const added = new Set(store.getState().office.items.map((i) => i.id))
    const lamps = this.placements.filter((p) => p.uid && added.has(p.uid) && decorDef(p.key)?.glow)
    return [...lamps.map((p) => ({ x: (p.tx + 0.5) * TILE, y: (p.ty + 1) * TILE, r: 56 })), ...this.litWallSpots().map((w) => ({ x: w.x, y: 5 * TILE, r: 64 }))]
  }

  private occupied = new Set<ZoneId>()

  /** Rooms with people in them keep their lights up after dark; empty rooms dim (lights on sensors). */
  private refreshOccupancy(): void {
    const now = new Set<ZoneId>()
    for (const c of this.characters.values()) {
      const z = zoneAt(Math.floor(c.position.x / TILE), Math.floor((c.position.y - 2) / TILE))
      if (z) now.add(z)
    }
    const key = [...now].sort().join(',')
    if (key === [...this.occupied].sort().join(',')) return
    this.occupied = now
    if (this.light < 0.95) this.paintLighting()
  }

  private paintLighting(): void {
    const light = this.light
    const ctx = this.lightTex.getContext()
    ctx.globalCompositeOperation = 'source-over'
    const r = Math.round(118 + 137 * light)
    const g = Math.round(124 + 128 * light)
    const b = Math.round(176 + 72 * light)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, WORLD_W, WORLD_H)
    // rooms switched off by hand are dimmer than the rest of the office, day or night
    for (const [zone, mode] of this.lightOverride) {
      if (mode !== 'off') continue
      const z = ZONES[zone]
      ctx.fillStyle = `rgb(${Math.round(r * 0.74)},${Math.round(g * 0.76)},${Math.round(b * 0.84)})`
      ctx.fillRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE)
    }
    ctx.globalCompositeOperation = 'lighter'
    for (const L of ROOM_LIGHTS) {
      const mode = this.lightOverride.get(L.zone)
      const on = mode === 'off' ? 0 : mode === 'on' || this.occupied.has(L.zone) || L.zone === 'reception' ? 1 : 0.35
      const grad = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r)
      const k = L.a * on * (1 - light * 0.85)
      grad.addColorStop(0, `rgba(255,236,200,${k})`)
      grad.addColorStop(1, 'rgba(255,236,200,0)')
      ctx.fillStyle = grad
      ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2)
    }
    // lamps and lights you added fill their corner after dark, in the colour you chose
    const [lr, lg, lb] = this.lightRgb().split(',')
    for (const L of this.addedLights()) {
      const grad = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r)
      const k = 0.62 * (1 - light * 0.85)
      grad.addColorStop(0, `rgba(${lr},${lg},${lb},${k})`)
      grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`)
      ctx.fillStyle = grad
      ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2)
    }
    if (light > 0.05) {
      for (const w of WALL_DECOR.windows) {
        const x0 = w.x * TILE
        const depth = w.tall ? 6 : 3
        const grad = ctx.createLinearGradient(0, 4 * TILE, 0, (4 + depth) * TILE)
        grad.addColorStop(0, `rgba(255,248,225,${0.32 * light})`)
        grad.addColorStop(1, 'rgba(255,248,225,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x0, 4 * TILE)
        ctx.lineTo(x0 + w.w * TILE, 4 * TILE)
        ctx.lineTo(x0 + w.w * TILE + 34, (4 + depth) * TILE)
        ctx.lineTo(x0 + 20, (4 + depth) * TILE)
        ctx.closePath()
        ctx.fill()
      }
    }
    this.lightTex.refresh()
    this.glowLayer.setAlpha(0.22 + (1 - light) * 0.55)
  }

  // ── characters & coordination ───────────────────────────────

  private createCharacters(employees: Employee[]): void {
    const host: CharacterHost = {
      grid: this.grid,
      claimSpot: (key, id) => {
        const owner = this.spots.get(key)
        if (owner && owner !== id) return false
        this.spots.set(key, id)
        return true
      },
      releaseSpot: (key, id) => {
        if (this.spots.get(key) === id) this.spots.delete(key)
      },
      reportPresence: (id: string, loc: OfficeLocation) => window.autopia.reportPresence(id, loc),
      reserveTile: (x, y, id) => {
        const k = `${x},${y}`
        const owner = this.tiles.get(k)
        if (owner && owner !== id) return false
        this.tiles.set(k, id)
        return true
      },
      releaseTile: (x, y, id) => {
        const k = `${x},${y}`
        if (id === '*' || this.tiles.get(k) === id) this.tiles.delete(k)
      },
      blockedByOthers: (id) => new Set([...this.tiles].filter(([, owner]) => owner !== id).map(([k]) => k)),
      requestPair: (c, kind) => this.startPair(c, kind),
      onArrive: (c, goal) => this.onArrive(c, goal),
      onSeat: (c, seated) => this.onSeat(c, seated),
      reducedMotion: () => this.reduced,
      footstep: (x, y) => this.footstep(x, y),
      context: (c, id) => this.socialContext(c, id),
      joinChat: (c) => this.joinChat(c),
      petDog: (c) => this.goPetDog(c),
      invite: (c, id) => this.invite(c, id)
    }
    for (const e of employees) {
      const key = `emp:${e.id}`
      const sheet = characterSheet(e.appearance)
      if (this.textures.exists(key)) this.textures.remove(key)
      const tex = this.textures.addCanvas(key, sheet)!
      for (let i = 0; i < (sheet.height / CELL_H) * SHEET_COLS; i++) {
        tex.add(i, 0, (i % SHEET_COLS) * CELL_W, Math.floor(i / SHEET_COLS) * CELL_H, CELL_W, CELL_H)
      }
      const c = new Character(this, e, host)
      c.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.button === 0 && !this.drag?.moved && !store.getState().editOffice) {
          store.setState({ inspect: null })
          actions.select(e.id)
          // on a break they answer you; at work they stay at it, and nothing here says otherwise
          if (c.activity === 'idle') {
            const n = (this.clickCounts.get(e.id) ?? 0) + 1
            this.clickCounts.set(e.id, n)
            const r = clickLine(c.profile, n, Math.random)
            c.express(r.gesture, 1200)
            this.say(c.position.x, c.position.y - 26, r.line)
          }
        }
      })
      this.characters.set(e.id, c)
    }
  }

  /** Chairs respond: pulled in under someone sitting, pushed back and turned once they leave. */
  private onSeat(c: Character, seated: boolean): void {
    const img = this.chairs.get(c.employee.deskId)
    if (!img) return
    img.setTexture(seated ? 'chair:office' : 'chair:officeAway')
    if (seated) this.tweens.add({ targets: img, y: img.y + 1, duration: 90, yoyo: true })
  }

  private startPair(initiator: Character, kind: 'chat' | 'pingpong', agreed?: Character): boolean {
    const me = initiator.position
    // someone they like who is free, asked first; they may say no, then one more try
    const pool = [...this.characters.values()].filter((c) => c !== initiator && c.available)
    let partner: Character | null = agreed ?? null
    for (let tries = 0; tries < 2 && !partner && pool.length; tries++) {
      const pick = choosePartner(
        initiator.employee.id,
        pool.map((c) => ({ id: c.employee.id, profile: c.profile, distance: Math.hypot(c.position.x - me.x, c.position.y - me.y) / TILE })),
        relationships,
        this.rand,
        initiator.recent.partners
      )
      const cand = pick && this.characters.get(pick.id)
      if (!cand) break
      if (acceptsInvite(cand.profile, initiator.employee.id, cand.employee.id, kind, relationships, this.rand)) partner = cand
      else pool.splice(pool.indexOf(cand), 1)
    }
    if (!partner) return false
    initiator.recent.met(partner.employee.id)
    partner.recent.met(initiator.employee.id)
    const options = PAIR_SPOTS.map((p, i) => ({ p, i })).filter(({ p, i }) => p.kind === kind && !this.pairs.some((x) => x.index === i))
    options.sort((a, b) => dist(a.p.a, me) - dist(b.p.a, me))
    const pick = options[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * options.length)]
    if (!pick) return false
    const keyA = `pair:${pick.i}:a`
    const keyB = `pair:${pick.i}:b`
    if (this.spots.has(keyA) || this.spots.has(keyB)) return false
    initiator.joinPair(keyA, pick.p.a, pick.p.kind)
    partner.joinPair(keyB, pick.p.b, pick.p.kind)
    this.pairs.push({
      index: pick.i,
      ids: [initiator.employee.id, partner.employee.id],
      arrived: new Set(),
      endsAt: this.time.now + 14_000 + Math.random() * 10_000
    })
    return true
  }

  // ── meaningful moments (real events only) ───────────────────

  private moments = new MomentQueue()
  private visits: { visitorId: string; hostId: string; key: string; endsAt: number; arrived: boolean }[] = []
  /** The system's reduced-motion setting, read live (a media query's `matches` is always current). */
  private motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  private get reduced(): boolean {
    return this.motionQuery.matches
  }

  /** Real task and result changes become brief, staged moments; real work always takes priority. */
  private playMoments(prev: AppState, s: AppState): void {
    // a hidden window plays nothing: moments are about now, not a replay later
    if (document.hidden) return
    const found = detectMoments({ tasks: prev.tasks, deliveries: prev.deliveries }, { tasks: s.tasks, deliveries: s.deliveries }, Date.now())
    if (!found.length) return
    const admitted = this.moments.admit(found, Date.now(), (m) => this.canStage(m))
    let stagger = 0
    const celebrants: Character[] = []
    for (const m of admitted) {
      const c = this.characters.get(m.employeeId)!
      if (m.kind === 'verified' || m.kind === 'accepted') this.broadcast('success', c.position.x, c.position.y, c.employee.id)
      else if (m.kind === 'setback') this.broadcast('setback', c.position.x, c.position.y, c.employee.id)
      if (m.kind === 'verified') {
        c.acknowledge('check', 3500)
        const e = emotionFor('verified', c.profile.traits, this.rand)
        if (e) c.express(poseFor(e, c.style.amplitude), 1300)
      } else if (m.kind === 'setback') c.acknowledge('error', 2500)
      else if (m.kind === 'finished') c.express('nod', 700)
      else if (m.kind === 'accepted') this.time.delayedCall((stagger += 350), () => c.activity === 'idle' && c.acknowledge('heart', 3000))
      if (m.kind === 'accepted') celebrants.push(c)
      else if (m.kind === 'handoff') this.startVisit(c, this.characters.get(m.partnerId!)!)
    }
    // the people behind an accepted result, if free, get together for a moment after it lands
    if (celebrants.length >= 2) this.time.delayedCall(3500, () => this.celebrate(celebrants))
  }

  /** Whether a moment fits what the people involved are really doing right now. */
  private canStage(m: Moment): boolean {
    const c = this.characters.get(m.employeeId)
    if (!c || c.activity === 'waiting' || c.activity === 'error') return false
    if (m.kind === 'setback') return c.activity === 'working' || c.activity === 'testing'
    if (m.kind === 'accepted') return c.activity === 'idle'
    if (m.kind === 'handoff') {
      const host = this.characters.get(m.partnerId ?? '')
      return !!host && c.activity === 'idle' && c.goal?.kind !== 'pair' && !this.visits.some((v) => v.visitorId === c.employee.id || v.hostId === host.employee.id)
    }
    return true
  }

  /**
   * Handoff: the teammate who just finished walks over to the one who picked the work up, they talk
   * briefly, and the visitor returns. With reduced motion, or no free spot beside the desk, the moment
   * is just the two bubbles. The host keeps working throughout.
   */
  private startVisit(visitor: Character, host: Character): void {
    const seat = DESKS[host.employee.deskId]?.seat
    const spot = !this.reduced && seat ? visitSpot(seat, (x, y) => !!this.grid[y]?.[x] && !this.tiles.has(`${x},${y}`)) : null
    if (!spot) {
      visitor.flashBubble('chat', 2500)
      this.time.delayedCall(800, () => host.flashBubble('idea', 2000))
      return
    }
    const key = `visit:${host.employee.id}`
    visitor.joinPair(key, spot, 'chat')
    this.visits.push({ visitorId: visitor.employee.id, hostId: host.employee.id, key, endsAt: this.time.now + 25_000, arrived: false })
  }

  private updateVisits(time: number): void {
    for (const v of [...this.visits]) {
      const visitor = this.characters.get(v.visitorId)
      const host = this.characters.get(v.hostId)
      // real work took over (either one's status changed), it's over, or the walk didn't succeed
      const cancelled = !visitor || !host || visitor.goal?.key !== v.key || visitor.activity !== 'idle' || (v.arrived && host.activity !== 'working' && host.activity !== 'testing')
      if (cancelled || time > v.endsAt) {
        this.visits = this.visits.filter((x) => x !== v)
        if (visitor?.goal?.key === v.key) visitor.endPair()
      }
    }
  }

  private onArrive(c: Character, goal: Goal): void {
    const visit = goal.key.startsWith('visit:') ? this.visits.find((v) => v.visitorId === c.employee.id && v.key === goal.key) : null
    if (visit && !visit.arrived) {
      visit.arrived = true
      visit.endsAt = this.time.now + 6500
      c.flashBubble('chat', 2600)
      this.time.delayedCall(1100, () => this.characters.get(visit.hostId)?.flashBubble('idea', 2200))
      return
    }
    if (goal.kind === 'idle' && goal.key.startsWith('coffee')) this.startBrew()
    if (goal.kind === 'idle' && goal.key.startsWith('printer')) this.printSheet()
    if (goal.key.startsWith('dog:pet')) {
      // the dog gets a fuss (if she's awake) and remembers who was kind
      this.corgi?.patBy(c.position.x)
      relationships.withDog(c.employee.id, 0.1)
      c.express('pet', 3200)
      return
    }
    if (goal.kind !== 'pair') return
    const pair = this.pairs.find((p) => p.ids.includes(c.employee.id) || p.extra?.includes(c.employee.id))
    if (!pair) return
    if (pair.extra?.includes(c.employee.id)) {
      // the newcomer joins in: the two nod them in, and the conversation re-plans with three voices
      c.flashBubble('chat', 2000)
      for (const id of pair.ids) this.time.delayedCall(300 + this.rand() * 400, () => this.characters.get(id)?.express('nod', 600))
      this.time.delayedCall(1100, () => this.pairs.includes(pair) && this.startTalk(pair))
      return
    }
    pair.arrived.add(c.employee.id)
    if (pair.arrived.size === 2) {
      pair.endsAt = Math.max(pair.endsAt, this.time.now + 9000)
      if (PAIR_SPOTS[pair.index].kind === 'pingpong') this.startRally(pair)
      else this.startTalk(pair)
    }
  }

  private tablePaddles: Phaser.GameObjects.Image[] = []

  private startRally(pair: ActivePair): void {
    const p = PAIR_SPOTS[pair.index]
    // they pick the paddles up off the table and play with them
    for (const t of this.tablePaddles) t.setVisible(false)
    const players = pair.ids.map((id) => this.characters.get(id)!)
    pair.held = players.map((c, i) => this.add.image(c.position.x, c.position.y, `paddle:${i}`).setOrigin(0.5))
    // the second player's arrival pose is applied right after this; start both swings once it has
    this.time.delayedCall(0, () => {
      if (this.pairs.includes(pair)) for (const c of players) c.startSwing()
    })
    const y = p.a.ty * TILE + 2
    const ax = p.a.tx * TILE + 14
    const bx = p.b.tx * TILE + 2
    const ball = this.add.image(ax, y, 'ball').setDepth(p.a.ty * TILE + 20)
    pair.ball = ball
    this.tweens.add({ targets: ball, x: bx, duration: 520, yoyo: true, repeat: -1, ease: 'Linear', onYoyo: () => officeSound.pong(), onRepeat: () => officeSound.pong() })
    this.tweens.add({ targets: ball, y: y - 6, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.easeOut' })
  }

  private updatePairs(time: number): void {
    for (const pair of [...this.pairs]) {
      const members = pair.ids.map((id) => this.characters.get(id)!)
      const broken = members.some((m) => m.goal?.kind !== 'pair')
      if (!broken) this.updateTalk(pair, time)
      // a third person who wandered off just leaves the group
      if (pair.extra) pair.extra = pair.extra.filter((id) => this.characters.get(id)?.goal?.kind === 'pair')
      if (pair.held) {
        // each paddle stays in its player's front hand, rising and falling with the swing
        pair.held.forEach((img, i) => {
          const c = members[i]
          // player a stands left of the net facing right, b the other way; the handle points at the player
          const side = i === 0 ? 1 : -1
          const swing = this.reduced ? 0 : Math.sin(time / 130 + i * Math.PI) * 2
          img.setPosition(Math.round(c.position.x + side * 7), Math.round(c.position.y - 14 + swing)).setFlipX(true).setDepth(c.position.y + 1)
        })
      }
      if (broken || time > pair.endsAt) {
        const played = !!pair.ball
        const extras = (pair.extra ?? []).map((id) => this.characters.get(id)!).filter(Boolean)
        // called away to real work: they say bye (if that's them), the other answers and lingers a moment
        const leaver = broken ? members.find((m) => m.goal?.kind !== 'pair' && m.activity !== 'idle') : undefined
        const stayers = leaver ? [...members, ...extras].filter((m) => m !== leaver) : []
        if (leaver) {
          for (const s of stayers) {
            const words = partingWords(leaver.profile.traits, s.profile.traits)
            if (words.leaverWaves) leaver.flashBubble('hi', 1200)
            if (words.stayerWaves) this.time.delayedCall(450, () => s.activity === 'idle' && s.flashBubble('hi', 1200))
            s.lingerAfter = words.stayerLingers ? 2500 + this.rand() * 2000 : 0
          }
        }
        if (pair.arrived.size >= 2) this.afterTogether(members, extras, played && !broken)
        for (const x of extras) x.endPair(x.lingerAfter)
        pair.ball?.destroy()
        // the paddles go back on the table
        pair.held?.forEach((img) => img.destroy())
        if (pair.held) for (const t of this.tablePaddles) t.setVisible(true)
        this.pairs = this.pairs.filter((p) => p !== pair)
        for (const m of members) m.endPair(m.lingerAfter)
        for (const m of [...members, ...extras]) m.lingerAfter = 0
      }
    }
  }

  // ── office stories ──────────────────────────────────────────

  private story: {
    id: string
    kind: StoryKind
    host: string
    members: Set<string>
    phase: 'gathering' | 'active' | 'ending'
    startedAt: number
    activeUntil: number
    nextBeat: number
    nextChurn: number
  } | null = null
  private pacer = new StoryPacer(45_000 + Math.random() * 45_000)
  private storySeq = 0

  private freeSpots(kind: string): { spot: Spot; key: string }[] {
    return (IDLE_SPOTS[kind] ?? []).map((spot, i) => ({ spot, key: `${kind}:${i}` })).filter(({ key }) => !this.spots.has(key))
  }

  /** Free places to stand around the dog (her sides and front), for a gathering. */
  private dogSpots(): { spot: Spot; key: string }[] {
    const dog = this.corgi
    if (!dog || dog.asleep) return []
    const dx = Math.floor(dog.position.x / TILE)
    const dy = Math.floor((dog.position.y - 2) / TILE)
    const blocked = new Set(this.tiles.keys())
    const options: Spot[] = [
      { tx: dx + 1, ty: dy, facing: 'left', pose: 'stand' },
      { tx: dx - 1, ty: dy, facing: 'right', pose: 'stand' },
      { tx: dx, ty: dy + 1, facing: 'up', pose: 'stand' }
    ]
    return options.filter((s) => this.grid[s.ty]?.[s.tx] && !blocked.has(`${s.tx},${s.ty}`)).map((spot, i) => ({ spot, key: `dog:pet:${i}` }))
  }

  /** How many people a story could hold right now (0 = can't happen). */
  private storyRoom(kind: StoryKind): number {
    const d = STORIES[kind]
    if (kind === 'pongMatch') return this.pairs.some((p) => PAIR_SPOTS[p.index].kind === 'pingpong') ? 0 : 2 + this.freeSpots('pongWatch').length
    if (kind === 'dogGathering') return [...this.characters.values()].some((c) => c.goal?.key.startsWith('dog:pet')) ? 0 : this.dogSpots().length
    return Math.min(d.max, this.freeSpots(d.place).length)
  }

  /**
   * Every couple of seconds: run the current story, or (rarely, after a quiet stretch) let someone with
   * initiative start one that suits them, with colleagues they like. Only idle people are involved.
   */
  private tickStories(): void {
    const now = this.time.now
    if (this.story) return this.advanceStory(now)
    if (!this.pacer.canStart(now) || this.pairs.length >= 2 || this.rand() > 0.3) return
    const free = [...this.characters.values()].filter((c) => c.available && !c.intent && this.pacer.personRested(c.employee.id, now))
    if (free.length < 2) return
    const host = weightedPick(free, (c) => hostAppeal(c.profile), this.rand)
    if (!host) return
    const kinds = (Object.keys(STORIES) as StoryKind[]).filter((k) => k !== 'celebration' && this.pacer.kindReady(k, now) && this.storyRoom(k) >= STORIES[k].min)
    const kind = weightedPick(kinds, (k) => storyAppeal(k, host.profile) * this.pacer.freshness(k), this.rand)
    if (kind) this.startStory(kind, host, free.filter((c) => c !== host))
  }

  private startStory(kind: StoryKind, host: Character, pool: Character[], invited?: Character[]): void {
    const now = this.time.now
    const def = STORIES[kind]
    const room = Math.min(def.max, this.storyRoom(kind))
    // the host asks people they know; each answers in character (a "no" gets a small shrug)
    const yes: Character[] = []
    const candidates = [...pool]
    if (invited) yes.push(...invited.slice(0, room - 1))
    while (!invited && yes.length < room - 1 && candidates.length) {
      const pick = choosePartner(
        host.employee.id,
        candidates.map((x) => ({ id: x.employee.id, profile: x.profile, distance: Math.hypot(x.position.x - host.position.x, x.position.y - host.position.y) / TILE })),
        relationships,
        this.rand,
        host.recent.partners
      )
      const cand = pick && this.characters.get(pick.id)
      if (!cand) break
      candidates.splice(candidates.indexOf(cand), 1)
      if (acceptsInvite(cand.profile, host.employee.id, cand.employee.id, kind === 'gameSession' ? 'beanbag' : kind === 'coffeeRound' ? 'coffee' : kind === 'pongMatch' ? 'pingpong' : 'chat', relationships, this.rand)) yes.push(cand)
      else cand.express('shrug', 900)
    }
    if (yes.length + 1 < def.min) {
      host.express('shrug', 900)
      this.pacer.ended([host.employee.id], now, this.rand, true)
      return
    }
    const id = `story:${++this.storySeq}`
    const people = [host, ...yes]
    host.flashBubble(kind === 'coffeeRound' ? 'coffee' : kind === 'gameSession' ? 'music' : kind === 'dogGathering' || kind === 'celebration' ? 'heart' : 'chat', 1800)
    for (const c of yes) this.time.delayedCall(500 + this.rand() * 600, () => c.flashBubble('hi', 1200))
    if (kind === 'pongMatch') {
      // the two players use the existing match; any others go to watch
      if (!this.startPair(host, 'pingpong', yes[0])) return this.pacer.ended([host.employee.id], now, this.rand, true)
      for (const s of yes.slice(1)) {
        const spot = this.freeSpots('pongWatch')[0]
        if (spot) s.joinStory(id, spot.spot, spot.key, 'watchPong')
      }
    } else {
      const spots = kind === 'dogGathering' ? this.dogSpots() : this.freeSpots(def.place)
      const act = kind === 'gameSession' ? 'beanbag' : kind === 'dogGathering' ? 'petDog' : kind === 'huddle' ? 'huddle' : 'island'
      people.forEach((c, i) => spots[i] && c.joinStory(id, spots[i].spot, spots[i].key, act))
      if (kind === 'dogGathering') this.corgi?.stayFor(30_000)
    }
    this.story = { id, kind, host: host.employee.id, members: new Set(people.map((c) => c.employee.id)), phase: 'gathering', startedAt: now, activeUntil: 0, nextBeat: 0, nextChurn: now + 6000 }
    this.pacer.started(kind, now)
  }

  /** A story in motion: gather, share the moment (with joins and early leavers), then end naturally. */
  private advanceStory(now: number): void {
    const st = this.story!
    const ids = [...st.members]
    // anyone called away to real work, or who wandered off, is no longer in it
    for (const id of ids) {
      const c = this.characters.get(id)
      const stillIn = c && c.activity === 'idle' && (st.kind === 'pongMatch' ? c.inStory === st.id || c.goal?.kind === 'pair' : c.inStory === st.id)
      if (!stillIn) {
        st.members.delete(id)
        if (c && c.activity !== 'idle') for (const o of st.members) this.characters.get(o)?.flashBubble('hi', 1000) // "see you"
      }
    }
    const members = [...st.members].map((id) => this.characters.get(id)!).filter(Boolean)
    const pongOn = st.kind === 'pongMatch' && this.pairs.some((p) => PAIR_SPOTS[p.index].kind === 'pingpong')
    if (members.length < 2 && !pongOn) return this.endStory(members, st.phase === 'gathering')
    if (st.phase === 'gathering') {
      const arrived = members.filter((c) => c.posed && !c.isWalking).length
      if (st.kind === 'pongMatch' ? pongOn : arrived === members.length || now - st.startedAt > 40_000) {
        if (st.kind !== 'pongMatch' && arrived < 2) return this.endStory(members, true)
        st.phase = 'active'
        st.activeUntil = now + storyLength(st.kind, members.map((m) => m.profile), this.rand)
        st.nextBeat = now + 1500
      }
      return
    }
    if (st.phase === 'active') {
      if (st.kind === 'pongMatch') {
        if (!pongOn) return this.endStory(members, false)
        return
      }
      // a beat: someone does something in character (seated people show it with a bubble)
      if (now >= st.nextBeat) {
        st.nextBeat = now + 2800 + this.rand() * 2400
        const c = weightedPick(members, (m) => 0.3 + m.style.liveliness, this.rand)
        if (c) this.storyBeat(st.kind, c)
      }
      // churn: someone nearby may join if there's room; a restless member may drift off
      if (now >= st.nextChurn) {
        st.nextChurn = now + 6000
        const frac = (now - (st.activeUntil - storyLength(st.kind, members.map((m) => m.profile), () => 0.5))) / 30_000
        for (const m of members) {
          if (members.length > 2 && leavesEarly(m.profile, Math.min(1, frac), this.rand)) {
            m.flashBubble('hi', 1000)
            m.leaveStory()
            st.members.delete(m.employee.id)
            return
          }
        }
        this.maybeJoin(st, members)
      }
      if (now >= st.activeUntil) {
        // a natural ending: the one with the most initiative calls it, everyone heads off
        st.phase = 'ending'
        const closer = members.reduce((a, b) => (b.profile.traits.initiative > a.profile.traits.initiative ? b : a))
        closer.flashBubble('hi', 1200)
        closer.express('wave', 900)
        this.time.delayedCall(1300, () => this.story === st && this.endStory(members, false))
      }
    }
  }

  private storyBeat(kind: StoryKind, c: Character): void {
    const t = c.profile.traits
    switch (kind) {
      case 'coffeeRound':
      case 'huddle':
        c.flashBubble(this.rand() < 0.7 ? 'chat' : this.rand() < 0.5 && kind === 'coffeeRound' ? 'coffee' : 'heart', 1600)
        break
      case 'gameSession':
        c.flashBubble(this.rand() < 0.5 + t.competitiveness * 0.3 ? 'music' : 'heart', 1400)
        break
      case 'dogGathering':
        if (!c.express('pet', 2200)) c.flashBubble('heart', 1400)
        this.corgi?.patBy(c.position.x)
        relationships.withDog(c.employee.id, 0.04)
        break
      case 'celebration':
        c.flashBubble(this.rand() < 0.6 ? 'heart' : 'check', 1500)
        break
      default:
    }
  }

  /** Someone nearby who can see the story and likes the people in it may join while there's room. */
  private maybeJoin(st: NonNullable<OfficeScene['story']>, members: Character[]): void {
    if (st.kind === 'pongMatch' || st.kind === 'celebration' || members.length >= STORIES[st.kind].max) return
    const spots = st.kind === 'dogGathering' ? this.dogSpots() : this.freeSpots(STORIES[st.kind].place)
    if (!spots.length) return
    const centre = members[0].position
    const now = this.time.now
    const c = [...this.characters.values()].find((x) => x.available && !x.intent && this.pacer.personRested(x.employee.id, now) && this.sees(x.position, centre, NOTICE.social))
    if (!c || !wantsToJoin(c.profile, relationships.familiarity(c.employee.id, st.host), st.kind, this.rand)) return
    const act = st.kind === 'gameSession' ? 'beanbag' : st.kind === 'dogGathering' ? 'petDog' : st.kind === 'huddle' ? 'huddle' : 'island'
    c.joinStory(st.id, spots[0].spot, spots[0].key, act)
    st.members.add(c.employee.id)
    for (const m of members) this.time.delayedCall(400, () => m.flashBubble('hi', 900))
  }

  private endStory(members: Character[], fizzled: boolean): void {
    const st = this.story
    if (!st) return
    this.story = null
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) relationships.together(members[i].employee.id, members[j].employee.id, fizzled ? 0.01 : 0.05)
    members.forEach((m, i) => m.inStory === st.id && m.leaveStory(400 + i * 500))
    this.pacer.ended([...members.map((m) => m.employee.id), st.host], this.time.now, this.rand, fizzled)
  }

  /** A real result was accepted: free contributors get together for a moment (never people at work). */
  private celebrate(contributors: Character[]): void {
    const now = this.time.now
    const free = contributors.filter((c) => c.available)
    if (this.story || free.length < 2 || !this.pacer.kindReady('celebration', now) || this.storyRoom('celebration') < 2) return
    const host = free.reduce((a, b) => (b.profile.traits.initiative > a.profile.traits.initiative ? b : a))
    this.startStory('celebration', host, [], free.filter((c) => c !== host))
  }

  // ── suggestions from you (the employee sheet) ───────────────

  /** What you can suggest to someone right now, and why not when you can't. Real work blocks all. */
  suggestionOptions(id: string): { id: SuggestionId; label: string; icon: string; ok: boolean; why?: string }[] {
    const c = this.characters.get(id)
    const work = c && c.activity !== 'idle'
    const free = (kind: string) => (IDLE_SPOTS[kind] ?? []).some((_, i) => !this.spots.has(`${kind}:${i}`))
    const partners = c ? [...this.characters.values()].filter((x) => x !== c && x.available) : []
    const tableFree = !this.pairs.some((p) => PAIR_SPOTS[p.index].kind === 'pingpong')
    const chatFree = PAIR_SPOTS.some((p, i) => p.kind === 'chat' && !this.pairs.some((x) => x.index === i))
    const dog = this.corgi
    const why: Record<SuggestionId, string | undefined> = {
      coffee: free('coffee') ? undefined : 'Both coffee spots are taken right now.',
      pingpong: !tableFree ? 'The table is in use.' : partners.length ? undefined : 'Nobody is free to play.',
      beanbag: free('beanbag') ? undefined : 'The beanbags are all taken.',
      chat: !chatFree ? 'Every chat spot is in use.' : partners.length ? undefined : 'Nobody else is free to chat.',
      petDog: !dog ? 'Puffy isn’t here.' : dog.asleep ? 'Puffy is napping; let him rest.' : [...this.characters.values()].some((x) => x.goal?.key === 'dog:pet') ? 'Someone is already with Puffy.' : undefined,
      sofa: free('sofa') ? undefined : 'The sofa is taken.'
    }
    return SUGGESTIONS.map((s) => {
      const reason = !c ? 'Not in the office.' : work ? 'Busy with real work; it always comes first.' : why[s.id]
      return { ...s, ok: !reason, why: reason }
    })
  }

  /**
   * You suggested a break: they answer in character (yes, after this, or no thanks). A yes uses the
   * same activities, spots and partners as their own choices; nothing here can touch real work.
   */
  suggest(id: string, what: SuggestionId, partnerId?: string): { answer: 'accept' | 'later' | 'decline' | 'unavailable'; text: string } {
    const c = this.characters.get(id)
    const option = this.suggestionOptions(id).find((o) => o.id === what)
    const first = c?.employee.name.split(' ')[0] ?? 'They'
    if (!c || !option?.ok) return { answer: 'unavailable', text: option?.why ?? 'Not possible right now.' }
    const busyAmbient = !c.available
    const answer = answerSuggestion(c.profile, what, busyAmbient, this.rand)
    const now = this.time.now
    if (answer === 'decline') {
      c.express('shrug', 900)
      return { answer, text: answerLine(first, what, answer) }
    }
    const activity = what === 'chat' ? 'chat' : what
    if (answer === 'later' || busyAmbient) {
      c.intent = intend(activity, 'you suggested it', now, 6000, 60_000)
      c.flashBubble('dots', 1200)
      return { answer: 'later', text: answerLine(first, what, 'later') }
    }
    c.flashBubble('hi', 1200)
    c.express('nod', 500)
    if (what === 'pingpong' || what === 'chat') {
      // the partner has a say too: someone they know, or the colleague you picked
      const pool = [...this.characters.values()].filter((x) => x !== c && x.available)
      const picked = partnerId ? pool.find((x) => x.employee.id === partnerId) : null
      const choice =
        picked ??
        (() => {
          const p = choosePartner(c.employee.id, pool.map((x) => ({ id: x.employee.id, profile: x.profile, distance: Math.hypot(x.position.x - c.position.x, x.position.y - c.position.y) / TILE })), relationships, this.rand, c.recent.partners)
          return p ? this.characters.get(p.id) ?? null : null
        })()
      if (!choice) return { answer: 'unavailable', text: 'Nobody is free to join right now.' }
      const partnerName = choice.employee.name.split(' ')[0]
      if (!acceptsInvite(choice.profile, c.employee.id, choice.employee.id, what, relationships, this.rand)) {
        c.express('shrug', 900)
        return { answer: 'decline', text: `${first} asked ${partnerName}, who would rather not right now.` }
      }
      if (!this.startPair(c, what, choice)) return { answer: 'unavailable', text: 'The spot was taken a moment ago.' }
      return { answer, text: answerLine(first, what, answer, partnerName) }
    }
    if (what === 'petDog') return this.goPetDog(c) ? { answer, text: answerLine(first, what, answer) } : { answer: 'unavailable', text: 'Puffy wandered off; try again in a moment.' }
    return c.acceptInvite(activity) ? { answer, text: answerLine(first, what, answer) } : { answer: 'unavailable', text: 'That spot was taken a moment ago.' }
  }

  /** Stop following (the camera stays where it is). */
  stopFollowing(): void {
    this.followId = null
  }

  // ── conversations ───────────────────────────────────────────

  /** Plan the conversation turn by turn for everyone in it (re-planned when someone joins). */
  private startTalk(pair: ActivePair): void {
    const ids = [...pair.ids, ...(pair.extra ?? [])].filter((id) => this.characters.get(id)?.goal?.kind === 'pair')
    const members = ids.map((id) => ({ id, traits: this.characters.get(id)!.profile.traits }))
    const plan = planConversation(members, Math.max(4000, pair.endsAt - this.time.now - 1400), this.rand)
    pair.talk = { plan, ids, i: -1, turnEnds: this.time.now, closed: false }
    // the first speaker's bubble says a conversation has started (no words: it's ambient)
    const first = plan.turns[0] && this.characters.get(ids[plan.turns[0].speaker])
    first?.flashBubble('chat', 2200)
  }

  /** Advance the turns: one speaks (sometimes explaining), the others listen, nod and laugh on cue. */
  private updateTalk(pair: ActivePair, now: number): void {
    const t = pair.talk
    if (!t || now < t.turnEnds) return
    const people = t.ids.map((id) => this.characters.get(id)).filter((c): c is Character => !!c && c.goal?.kind === 'pair')
    if (people.length < 2) return
    t.i++
    const turn = t.plan.turns[t.i]
    if (!turn) {
      if (t.closed) return
      // a natural ending: the one with the most initiative says goodbye, the others nod
      t.closed = true
      const closer = this.characters.get(t.ids[t.plan.closer])
      closer?.express('wave', 900)
      closer?.flashBubble('hi', 1200)
      for (const c of people) if (c !== closer) this.time.delayedCall(350, () => c.express('nod', 600))
      pair.endsAt = Math.min(pair.endsAt, now + 1300)
      return
    }
    const speaker = this.characters.get(t.ids[turn.speaker])
    speaker?.express(turn.gesture ? 'explain' : 'speak', turn.ms)
    for (const c of people) if (c !== speaker) c.express('listen', turn.ms)
    const index = t.i
    for (const cue of turn.cues) {
      const who = this.characters.get(t.ids[cue.who])
      this.time.delayedCall(cue.at, () => {
        if (pair.talk !== t || t.i !== index || !who) return
        const left = t.turnEnds - this.time.now
        who.express(cue.cue, Math.min(cue.cue === 'laugh' ? 900 : 550, left))
        if (cue.cue === 'laugh' && this.rand() < 0.3) who.flashBubble('heart', 900)
      })
    }
    t.turnEnds = now + turn.ms
  }

  // ── awareness ───────────────────────────────────────────────

  /** Wall tiles (glass included): nobody sees or reacts through them. */
  private walls = wallTiles()
  private reacted = new ReactionCooldowns()

  private sees(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
    return canNotice(this.walls, a, b, radius)
  }

  private pairCenter(p: ActivePair): { x: number; y: number } {
    const { a, b } = PAIR_SPOTS[p.index]
    return { x: ((a.tx + b.tx) / 2) * TILE + 8, y: a.ty * TILE + 13 }
  }

  /**
   * Every idle person looks around: a rally, a conversation they could join, the dog trotting past.
   * Each kind of thing is considered at most once in a while per person (whatever they decided),
   * so nobody reacts to the same thing over and over.
   */
  private perceive(): void {
    const now = this.time.now
    const rallies = this.pairs.filter((p) => !!p.ball)
    const dog = this.corgi
    for (const c of this.characters.values()) {
      if (c.activity !== 'idle' || c.intent || c.inStory || c.goal?.kind === 'pair' || c.isWalking) continue
      const id = c.employee.id
      const busyWatching = c.goal?.key.startsWith('pongWatch') || c.goal?.key === 'dog:pet'
      // watching a rally: now and then a reaction to a good point, in their own style
      if (c.goal?.key.startsWith('pongWatch') && rallies.length && !c.expressing && this.rand() < 0.1) {
        const e = emotionFor('watching', c.profile.traits, this.rand)
        if (e) {
          const pose = poseFor(e, c.style.amplitude)
          c.express(pose === 'lean' ? 'think' : pose, 1200)
        }
      }
      if (dog?.zooming && this.sees(c.position, dog.position, NOTICE.glance) && this.reacted.ready(id, 'zoomies', now, 30_000)) {
        this.reacted.mark(id, 'zoomies', now)
        const e = emotionFor('zoomies', c.profile.traits, this.rand)
        if (e && c.glanceAt(dog.position.x, dog.position.y, 900)) this.time.delayedCall(250, () => c.express(poseFor(e, c.style.amplitude), 900))
      }
      for (const r of rallies) {
        const at = this.pairCenter(r)
        if (busyWatching || r.ids.includes(id) || !this.sees(c.position, at, NOTICE.social) || !this.reacted.ready(id, 'rally', now, 40_000)) continue
        this.reacted.mark(id, 'rally', now)
        const fam = Math.max(...r.ids.map((x) => relationships.familiarity(id, x)))
        this.respond(c, reactTo('rally', c.profile, fam, this.rand), at, 'watchPong')
      }
      const chat = this.joinableChat(c, true)
      if (chat && !busyWatching && this.reacted.ready(id, 'conversation', now, 45_000)) {
        this.reacted.mark(id, 'conversation', now)
        const fam = Math.max(...chat.pair.ids.map((x) => relationships.familiarity(id, x)))
        this.respond(c, reactTo('conversation', c.profile, fam, this.rand), this.pairCenter(chat.pair), 'joinChat')
      }
      if (dog && !dog.asleep && dog.moving && this.sees(c.position, dog.position, NOTICE.glance) && this.reacted.ready(id, 'dog', now, 40_000)) {
        this.reacted.mark(id, 'dog', now)
        this.respond(c, reactTo('dog', c.profile, relationships.dogFamiliarity(id), this.rand), dog.position, 'petDog')
      }
    }
  }

  /** Turn a reaction into behaviour: a glance, a small cheer, or an intention to go over. */
  private respond(c: Character, r: ReturnType<typeof reactTo>, at: { x: number; y: number }, go?: string): void {
    const now = this.time.now
    if (r === 'ignore') return
    c.glanceAt(at.x, at.y, glanceMs(c.profile.traits))
    if (r === 'cheer') c.flashBubble('heart', 1300)
    if (go && (r === 'approach' || r === 'observe')) c.intent = intend(go, r, now, r === 'observe' ? 2500 + this.rand() * 2000 : 300)
    if (go && r !== 'glance') c.wakeFromIdle()
  }

  /**
   * Something real happened to someone (their check passed, a result was accepted, a check failed):
   * teammates who can see them react in their own way. Never through walls, never from far away.
   */
  private broadcast(what: Happening, x: number, y: number, subject: string): void {
    const now = this.time.now
    for (const c of this.characters.values()) {
      const id = c.employee.id
      if (id === subject || c.activity !== 'idle' || !this.sees(c.position, { x, y }, what === 'celebration' ? NOTICE.social : NOTICE.event)) continue
      if (!this.reacted.ready(id, what, now, 20_000)) continue
      this.reacted.mark(id, what, now)
      // a setback only ever gets a look of concern: nobody cheers, nobody crowds round
      const r = reactTo(what, c.profile, relationships.familiarity(id, subject), this.rand)
      this.respond(c, what === 'setback' && r === 'cheer' ? 'glance' : r, { x, y })
      if (r === 'cheer') relationships.together(id, subject, 0.02)
    }
  }

  // ── personality & social life ───────────────────────────────

  private rand = seeded((Date.now() >>> 2) & 0x7fffffff)

  /** What a person sees around them when choosing a break. */
  private socialContext(c: Character, id: string): Context {
    const kind = activityDef(id)?.spots
    const crowd = kind && kind !== 'pair' && kind !== 'dog' && kind !== 'desk' ? [...this.spots.keys()].filter((k) => k.startsWith(`${kind}:`)).length : 0
    const dog = this.corgi
    // only what they can actually see: a rally behind a wall or across the office isn't "happening"
    return {
      crowd,
      rally: this.pairs.some((p) => !!p.ball && this.sees(c.position, this.pairCenter(p), NOTICE.social)),
      dogDistance: dog && !dog.asleep && this.sees(c.position, dog.position, 12) ? Math.hypot(dog.position.x - c.position.x, dog.position.y - c.position.y) / TILE : Infinity,
      joinable: !!this.joinableChat(c, true)
    }
  }

  /** A conversation with room for one more, and a free place to stand beside it. */
  private joinableChat(c: Character, inSight = false): { pair: ActivePair; spot: Spot } | null {
    const now = this.time.now
    const blocked = new Set(this.tiles.keys())
    const chats = this.pairs
      .filter((p) => PAIR_SPOTS[p.index].kind === 'chat' && p.arrived.size >= 2 && !p.extra?.length && p.endsAt - now > 7000 && !p.ids.includes(c.employee.id))
      .filter((p) => !inSight || this.sees(c.position, this.pairCenter(p), NOTICE.social))
      .sort((x, y) => Math.max(...y.ids.map((id) => relationships.familiarity(c.employee.id, id))) - Math.max(...x.ids.map((id) => relationships.familiarity(c.employee.id, id))))
    for (const pair of chats) {
      const { a, b } = PAIR_SPOTS[pair.index]
      // the newcomer stands centred between the two (half a tile over), facing them: a small circle
      const options: Spot[] = [
        { tx: a.tx, ty: a.ty + 1, dx: 8, facing: 'up', pose: 'stand' },
        { tx: b.tx, ty: b.ty + 1, dx: -8, facing: 'up', pose: 'stand' },
        { tx: a.tx, ty: a.ty - 1, dx: 8, facing: 'down', pose: 'stand' }
      ]
      // a spot needs open floor around it too, so nobody stands pressed against a wall or glass
      const roomy = (s: Spot) => {
        const by = s.ty + (s.facing === 'up' ? 1 : -1)
        return !!(this.grid[by]?.[s.tx] && this.grid[by]?.[s.tx - 1] && this.grid[by]?.[s.tx + 1])
      }
      const spot = options.find((s) => this.grid[s.ty]?.[s.tx] && roomy(s) && !blocked.has(`${s.tx},${s.ty}`))
      if (spot) return { pair, spot }
    }
    return null
  }

  private joinChat(c: Character): boolean {
    const j = this.joinableChat(c, true)
    if (!j) return false
    j.pair.extra = [c.employee.id]
    j.pair.endsAt = Math.max(j.pair.endsAt, this.time.now + 9000)
    // observers hang back for a moment before stepping in
    if (c.profile.habits.includes('observer')) c.flashBubble('dots', 1500)
    c.joinPair(`pair:${j.pair.index}:c`, j.spot, 'chat')
    for (const id of j.pair.ids) c.recent.met(id)
    return true
  }

  /** Walk up to the dog and give her a fuss. */
  private goPetDog(c: Character): boolean {
    const dog = this.corgi
    if (!dog || dog.asleep) return false
    // one fuss at a time: nobody queues up around the dog
    if ([...this.characters.values()].some((x) => x !== c && x.goal?.key.startsWith('dog:pet'))) return false
    const dx = Math.floor(dog.position.x / TILE)
    const dy = Math.floor((dog.position.y - 2) / TILE)
    const blocked = new Set([...this.tiles].filter(([, o]) => o !== c.employee.id).map(([k]) => k))
    const options: Spot[] = [
      { tx: dx + 1, ty: dy, facing: 'left', pose: 'stand' },
      { tx: dx - 1, ty: dy, facing: 'right', pose: 'stand' },
      { tx: dx, ty: dy + 1, facing: 'up', pose: 'stand' },
      { tx: dx, ty: dy - 1, facing: 'down', pose: 'stand' }
    ]
    const spot = options.find((s) => this.grid[s.ty]?.[s.tx] && !blocked.has(`${s.tx},${s.ty}`))
    if (!spot) return false
    c.goTo(spot, 'dog:pet', 'petDog')
    return true
  }

  /** Ask a favourite free colleague along. A yes sends them to the same kind of place; a no is quiet. */
  private invite(c: Character, activityId: string): void {
    const me = c.position
    // only people in earshot: same room, no wall between them
    const pool = [...this.characters.values()].filter((x) => x !== c && x.available && this.sees(me, x.position, NOTICE.invite))
    const pick = choosePartner(
      c.employee.id,
      pool.map((x) => ({ id: x.employee.id, profile: x.profile, distance: Math.hypot(x.position.x - me.x, x.position.y - me.y) / TILE })),
      relationships,
      this.rand,
      c.recent.partners
    )
    const friend = pick && this.characters.get(pick.id)
    if (!friend) return
    c.flashBubble('chat', 1500)
    if (!acceptsInvite(friend.profile, c.employee.id, friend.employee.id, activityId, relationships, this.rand)) {
      const e = emotionFor('declined', c.profile.traits, this.rand)
      if (e) c.afterArriving(() => c.express(poseFor(e, c.style.amplitude), 1100))
      return
    }
    this.time.delayedCall(700, () => {
      if (!friend.acceptInvite(activityId)) return
      friend.flashBubble('hi', 1300)
      relationships.together(c.employee.id, friend.employee.id, 0.03)
      friend.recent.met(c.employee.id)
      c.recent.met(friend.employee.id)
    })
  }

  /**
   * After a chat or a game: everyone involved knows each other a little better; after a finished
   * rally there's a winner, and people take it in their own way.
   */
  private afterTogether(members: Character[], extras: Character[], rally: boolean): void {
    const all = [...members, ...extras]
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) relationships.together(all[i].employee.id, all[j].employee.id, rally ? 0.1 : i < 2 && j < 2 ? 0.06 : 0.04)
    if (!rally) return
    const [a, b] = members
    const winner = gameWinner({ id: a.employee.id, traits: a.profile.traits }, { id: b.employee.id, traits: b.profile.traits }, this.rand)
    for (const m of members) {
      const won = m.employee.id === winner
      const r = reactToGame(m.profile.traits, won)
      // they stay a moment so the reaction can be seen, then wander off
      m.lingerAfter = Math.max(m.lingerAfter, 1600)
      if (r === 'celebrate') {
        m.celebrate()
        this.broadcast('celebration', m.position.x, m.position.y, m.employee.id)
      } else if (r === 'smile') {
        m.flashBubble('heart', 1400)
        m.express('nod', 700)
      } else if (r === 'groan') {
        m.flashBubble('dots', 1600)
        m.express('shrug', 1100)
      } else if (r === 'shrug') m.express('shrug', 900)
      else m.express('nod', 600)
    }
    // whoever was watching: friendly spectators cheer, and get to know the players a little
    for (const w of [...this.characters.values()].filter((x) => x.goal?.key.startsWith('pongWatch'))) {
      if (w.profile.traits.friendliness > 0.55) this.time.delayedCall(400 + this.rand() * 500, () => w.flashBubble('heart', 1200))
      for (const m of members) relationships.together(w.employee.id, m.employee.id, 0.03)
    }
  }

  /** Spontaneous hellos when idle teammates pass each other (cosmetic, per-pair cooldown). */
  // ── reception ───────────────────────────────────────────────

  private receptionist: Receptionist | null = null
  private receptionGreeted = new Map<string, number>()
  private receptionLastGreet = -Infinity

  /** The front-desk receptionist: atmospheric, kept apart from the team (not in `characters`). */
  private createReceptionist(): void {
    this.receptionist = new Receptionist(this, {
      grid: this.grid,
      reserveTile: (x, y, id) => {
        const k = `${x},${y}`
        const owner = this.tiles.get(k)
        if (owner && owner !== id) return false
        this.tiles.set(k, id)
        return true
      },
      releaseTile: (x, y, id) => {
        const k = `${x},${y}`
        if (this.tiles.get(k) === id) this.tiles.delete(k)
      },
      claimSpot: (key, id) => {
        const owner = this.spots.get(key)
        if (owner && owner !== id) return false
        this.spots.set(key, id)
        return true
      },
      releaseSpot: (key, id) => {
        if (this.spots.get(key) === id) this.spots.delete(key)
      },
      blockedByOthers: (id) => new Set([...this.tiles].filter(([, owner]) => owner !== id).map(([k]) => k)),
      reducedMotion: () => this.reduced
    })
    this.receptionist.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button === 0 && !this.drag?.moved && !store.getState().editOffice) store.setState({ inspect: 'receptionist' })
    })
    this.receptionist.setNeedsYou(receptionEvents({ deliveries: [], attention: {} }, store.getState()).needsYou)
    this.time.delayedCall(1200, () => this.greetUser())
  }

  // ── the office dog ──────────────────────────────────────────

  private corgi: Corgi | null = null
  private dogGreetedAt = -Infinity

  private bedTexture(o: OfficeConfig): string {
    const key = `dog:bed:${o.dog.bedStyle}`
    if (!this.textures.exists(key)) this.canvasTex(key, dogBed(DOG_BEDS[o.dog.bedStyle].rim))
    return key
  }

  private toyTexture(o: OfficeConfig): string {
    const key = `dog:toy:${o.dog.toy}`
    if (!this.textures.exists(key)) this.canvasTex(key, TOY_ART[o.dog.toy]())
    return key
  }

  /** Puffy the corgi: atmospheric, kept apart from the team and from orchestration. */
  private createCorgi(): void {
    this.corgi = new Corgi(this, {
      grid: this.grid,
      reserveTile: (x, y, id) => {
        const k = `${x},${y}`
        const owner = this.tiles.get(k)
        if (owner && owner !== id) return false
        this.tiles.set(k, id)
        return true
      },
      releaseTile: (x, y, id) => {
        const k = `${x},${y}`
        if (this.tiles.get(k) === id) this.tiles.delete(k)
      },
      blockedByOthers: (id) => new Set([...this.tiles].filter(([, owner]) => owner !== id).map(([k]) => k)),
      reducedMotion: () => this.reduced,
      people: () =>
        [...this.characters.values()].map((c) => {
          const affinity = c.profile.traits.dogLove * 0.7 + relationships.dogFamiliarity(c.employee.id) * 0.3
          const seated = c.goal?.kind === 'desk' && !!c.posed
          const working = c.activity === 'working' || c.activity === 'testing' || c.activity === 'reviewing'
          const seat = DESKS[c.employee.deskId]?.seat
          return {
            id: c.employee.id,
            x: c.position.x,
            y: c.position.y,
            walking: c.isWalking,
            idle: c.activity === 'idle',
            settled: !c.isWalking && !!c.posed,
            affinity,
            workingSeat: seated && working && seat ? { x: seat.tx, y: seat.ty } : null
          }
        }),
      furniture: () => this.placements.filter((p) => p.blocks),
      canSee: (a, b, radius) => this.sees(a, b, radius),
      rugs: () => this.placements.filter((p) => p.flat),
      bedTexture: this.bedTexture(store.getState().office),
      toyTexture: this.toyTexture(store.getState().office),
      // a cosmetic pat: the teammate's existing heart bubble, only while they're idle
      pat: (id) => {
        const c = this.characters.get(id)
        if (c?.activity !== 'idle') return
        // dog lovers stop for a fuss, others say hi, some just carry on
        const r = dogResponse(c.profile.traits, relationships.dogFamiliarity(id), this.rand)
        if (r === 'pet') {
          c.flashBubble('heart', 1800)
          relationships.withDog(id, 0.08)
        } else if (r === 'greet') {
          c.flashBubble('hi', 1200)
          relationships.withDog(id, 0.03)
        }
      }
    })
    this.corgi.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0 || this.drag?.moved || store.getState().editOffice) return
      // pet him enough and it all gets too much
      const now = this.time.now
      if (now < this.musicUntil && !this.corgi!.asleep) {
        this.musicUntil = 0
        this.corgi!.dance()
        this.say(this.corgi!.position.x, this.corgi!.position.y - 18, 'Puffy has rhythm.')
        return
      }
      this.dogTaps = [...this.dogTaps.filter((t) => now - t < 3500), now]
      if (this.dogTaps.length >= 5) {
        this.dogTaps = []
        const d = this.corgi!
        d.zoomies()
        this.say(d.position.x, d.position.y - 18, 'WOOF!', 1400)
        return
      }
      this.corgi?.react()
      if (Math.random() < 0.3 && this.corgi && !this.corgi.asleep) this.say(this.corgi.position.x, this.corgi.position.y - 18, 'Woof!', 1100)
    })
    // click his ball and it goes flying; he'll be right back with it
    const ball = this.corgi.ballSprite
    ball.setInteractive({ useHandCursor: true })
    ball.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.corgi
      if (!d || p.button !== 0 || this.drag?.moved || store.getState().editOffice) return
      const from = { x: Math.floor(ball.x / TILE), y: Math.floor((ball.y - 1) / TILE) }
      const to = d.landingFor(from)
      if (!to) return
      const lands = { x: to.x * TILE + 8, y: to.y * TILE + 12 }
      if (this.reducedMotionNow()) ball.setPosition(lands.x, lands.y)
      else {
        this.tweens.add({ targets: ball, x: lands.x, duration: 480, ease: 'Linear' })
        this.tweens.add({ targets: ball, y: { from: ball.y, to: lands.y }, duration: 480, ease: 'Quad.easeIn' })
      }
      d.fetch(to, from)
    })
  }

  /** The dock's Puffy chip: glide to her, and she's happy to see you. */
  focusCorgi(): void {
    const d = this.corgi
    if (!d) return
    this.followId = null
    this.userMoved = true
    const zoom = Math.max(this.cameras.main.zoom, snapZoom(4 * this.ds, this.ds))
    this.glideTo({ cx: d.position.x, cy: d.position.y - 8, zoom }, 450)
    d.react()
  }

  /** Hello when you open the office; at most once every ten minutes, never on a rebuild. */
  private greetUser(): void {
    const now = Date.now()
    if (now - lastUserGreeting < 10 * 60_000 || store.getState().view !== 'office') return
    if (this.receptionist?.greet(0, true)) lastUserGreeting = now
  }

  /** Real events only: a result ready for you, or a decision waiting on you. */
  private reactAtReception(prev: AppState, s: AppState): void {
    const r = this.receptionist
    if (!r) return
    const e = receptionEvents(prev, s)
    r.setNeedsYou(e.needsYou)
    if (e.resultsReady.length) r.acknowledge()
  }

  /** Teammates walking past the desk get a small wave now and then, and usually wave back. */
  private checkReception(): void {
    const r = this.receptionist
    if (!r?.atDesk) return
    const now = this.time.now
    // Rachel says hello to the dog when she trots past the desk (now and then)
    const dog = this.corgi
    if (dog && !dog.asleep && passingDesk(dog.position.x, dog.position.y) && now - this.dogGreetedAt > 3 * 60_000) {
      const dx = dog.position.x - r.position.x
      if (r.greet(Math.abs(dx) < 12 ? 0 : dx < 0 ? -1 : 1)) this.dogGreetedAt = now
    }
    for (const c of this.characters.values()) {
      if (!c.isWalking || !passingDesk(c.position.x, c.position.y)) continue
      if (!shouldGreet(c.employee.id, now, this.receptionGreeted, this.receptionLastGreet)) continue
      const dx = c.position.x - r.position.x
      if (!r.greet(Math.abs(dx) < 12 ? 0 : dx < 0 ? -1 : 1)) return
      this.receptionGreeted.set(c.employee.id, now)
      this.receptionLastGreet = now
      if (c.activity === 'idle' && Math.random() < 0.6) this.time.delayedCall(500, () => c.greet())
      return
    }
  }

  private checkGreetings(): void {
    const list = [...this.characters.values()]
    const now = this.time.now
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (!(a.isWalking || b.isWalking) || a.activity !== 'idle' || b.activity !== 'idle') continue
        if (Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) > 26 || !this.sees(a.position, b.position, 2)) continue
        const key = a.employee.id < b.employee.id ? `${a.employee.id}|${b.employee.id}` : `${b.employee.id}|${a.employee.id}`
        if ((this.greeted.get(key) ?? 0) > now) continue
        this.greeted.set(key, now + 90_000)
        // friendly people and old friends say hello; strangers often just pass
        const odds = 0.15 + (a.profile.traits.friendliness + b.profile.traits.friendliness) / 4 + relationships.familiarity(a.employee.id, b.employee.id) * 0.4
        if (this.rand() < odds) {
          ;(a.profile.traits.initiative > b.profile.traits.initiative ? a : b).greet()
          relationships.together(a.employee.id, b.employee.id, 0.015)
        }
      }
    }
  }

  private updateDoors(delta: number): void {
    for (const d of this.doors) {
      const near = [...this.characters.values()].some((c) => Math.abs(c.position.x - d.cx) < 22 && Math.abs(c.position.y - d.cy) < 26)
      const target = near ? 1 : 0
      if (target && d.open === 0) officeSound.door()
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), delta / 220)
      for (const leaf of d.leaves) leaf.img.x = Math.round(leaf.closedX + leaf.dir * d.open * (TILE - 3))
    }
  }

  // ── world interactions ──────────────────────────────────────

  private setupInteractions(): void {
    this.highlight = this.add.graphics().setDepth(60_000)
    this.editLayer = this.add.graphics().setDepth(60_001)
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // while placing, a held button pans the camera and the piece waits
      if (this.decorDrag && !(this.decorDrag.placing && p.isDown)) {
        this.moveDecorDrag(p)
        return
      }
      if (p.isDown) return
      const hit = this.hitInteractive(p)
      if (hit !== this.hovered) {
        this.hovered = hit
        this.drawHighlight()
        this.game.canvas.style.cursor = hit ? 'pointer' : ''
      }
      if (store.getState().editOffice) {
        const m = this.movableAt(p)
        this.game.canvas.style.cursor = m ? 'grab' : ''
        const uid = m ? (m.p.uid ?? m.kind) : null
        if (uid !== this.hoverUid) {
          this.hoverUid = uid
          this.drawEditLayer()
        }
      }
    })
  }

  private hitInteractive(p: Phaser.Input.Pointer): Interactive | null {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y)
    const tx = wp.x / TILE
    const ty = wp.y / TILE
    // while arranging, the office answers to its own guides, not its usual hover and click
    if (store.getState().editOffice) return null
    // the wall clock: looks like a clock, and mostly is
    const cx = WALL_DECOR.clock.x
    if (tx >= cx - 0.2 && tx < cx + 1.2 && ty >= 1 && ty < 2.8) return { id: 'fun:clock', label: 'Clock', rect: { x: cx - 0.2, y: 1, w: 1.4, h: 1.8 } }
    const prop = this.playfulPlacements().find(({ p }) => tx >= p.tx && tx < p.tx + p.tw && ty >= p.ty - 1 && ty < p.ty + p.th)
    if (prop) return { id: prop.id, label: prop.label, rect: { x: prop.p.tx, y: prop.p.ty - 1, w: prop.p.tw, h: prop.p.th + 1 } }
    const hits = INTERACTIVES.filter(
      (i) => tx >= i.rect.x && tx < i.rect.x + i.rect.w && ty >= i.rect.y && ty < i.rect.y + i.rect.h && (!i.id.startsWith('desk:') || this.placements.some((p) => p.id === i.id))
    )
    hits.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)
    return hits[0] ?? null
  }

  private drawHighlight(): void {
    const g = this.highlight
    g.clear()
    const target = this.hovered ?? INTERACTIVES.find((i) => i.id === store.getState().inspect) ?? null
    if (!target) return
    const r = target.rect
    const room = target.id.startsWith('room:')
    g.lineStyle(1, OUTLINE, room ? (this.hovered ? 0.5 : 0.35) : this.hovered ? 0.95 : 0.6)
    g.strokeRoundedRect(r.x * TILE - 1.5, r.y * TILE - 1.5, r.w * TILE + 3, r.h * TILE + 3, room ? 6 : 4)
  }

  // ── office customization (edit mode) ────────────────────────

  /** What's under the pointer that can be picked up: pieces standing in front win over rugs under them. */
  private movableAt(p: Phaser.Input.Pointer): Movable | null {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TILE)
    const ty = Math.floor(wp.y / TILE)
    if (wp.y < 4 * TILE) {
      for (const h of this.hung.values()) {
        const img = h.m.img
        if (wp.x >= img.x && wp.x < img.x + img.width && wp.y >= img.y - img.height && wp.y < img.y) return h.m
      }
      return null
    }
    const solid = [...this.movables.values()].sort((a, b) => Number(!!a.p.flat) - Number(!!b.p.flat))
    for (const m of solid) if (tx >= m.p.tx && tx < m.p.tx + m.p.tw && ty >= m.p.ty - (m.p.flat ? 0 : 1) && ty < m.p.ty + m.p.th) return m
    const bed = this.bedMovable()
    if (bed && tx >= bed.p.tx && tx < bed.p.tx + bed.p.tw && ty === bed.p.ty) return bed
    return null
  }

  private bedMovable(): Movable | null {
    if (!this.corgi) return null
    return { p: { key: 'dog:bed', tx: DOG_BED.tx, ty: DOG_BED.ty, ...DOG_BED_SIZE, blocks: false }, img: this.corgi.bedSprite, kind: 'bed' }
  }

  private wallTaken(): Set<number> {
    return takenWall(this.placements, (p) => {
      const img = this.placementImg.get(p)
      return img ? img.height : 0
    }, OFFICE === 'studio' ? STUDIO_WALL_SCREENS : OFFICE === 'lab' ? LAB_WALL_SCREENS : [])
  }

  /** Why this piece can't go here; null when it can. */
  private dragProblem(d: NonNullable<OfficeScene['decorDrag']>, tx: number, ty: number): string | null {
    const { m } = d
    if (m.kind === 'wall') return wallProblem(d.taken, store.getState().office.wall, m.p.uid!, m.p.key, tx)
    const size = m.kind === 'bed' ? DOG_BED_SIZE : { tw: m.p.tw, th: m.p.th, flat: m.p.flat }
    const why = spotProblem(d.ctx, d.others, size, tx, ty)
    if (why) return why
    if (m.p.flat && m.kind !== 'bed') return null
    for (let y = ty; y < ty + m.p.th; y++) {
      for (let x = tx; x < tx + m.p.tw; x++) {
        const who = this.tiles.get(`${x},${y}`)
        if (who && who !== DOG.id) return 'Someone’s standing there.'
      }
    }
    return null
  }

  private startDecorDrag(m: Movable, p: Phaser.Input.Pointer): void {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y)
    const others = this.placements.filter((q) => q !== m.p)
    const ctx = placeContext(store.getState().office)
    // a piece's own tiles are free for itself
    if (m.kind === 'bed') for (const k of [0, 1, 2]) ctx.needed.delete(`${m.p.tx + k},${m.p.ty}`)
    this.decorDrag = {
      m,
      tx: m.p.tx,
      ty: m.p.ty,
      gx: Math.floor(wp.x / TILE) - m.p.tx,
      gy: m.kind === 'wall' ? 0 : Math.max(0, Math.min(m.p.th - 1, Math.floor(wp.y / TILE) - m.p.ty)),
      moved: false,
      placing: false,
      why: null,
      others,
      ctx,
      grid: buildWalkGrid(others),
      taken: this.wallTaken()
    }
    if (canDrag(m)) this.game.canvas.style.cursor = 'grabbing'
    store.setState({ arrange: null })
  }

  private placeMovable(m: Movable, tx: number, ty: number): void {
    const tex = m.img.texture.getSourceImage() as HTMLCanvasElement
    if (m.kind === 'wall') m.img.setPosition(Math.round(tx * TILE + (m.p.tw * TILE - tex.width) / 2), WALL_TOP + tex.height)
    else if (m.kind === 'bed') m.img.setPosition((tx + 1) * TILE, (ty + 1) * TILE - 2).setDepth((ty + 1) * TILE - 14)
    else {
      const bottom = (ty + m.p.th) * TILE
      m.img.setPosition(Math.round(tx * TILE + (m.p.tw * TILE - tex.width) / 2), bottom).setDepth(m.p.flat ? 0.5 : bottom + (m.p.depthBias ?? 0))
    }
  }

  private moveDecorDrag(p: Phaser.Input.Pointer): void {
    const dd = this.decorDrag!
    if (!canDrag(dd.m)) return
    const wp = this.cameras.main.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TILE) - dd.gx
    const ty = dd.m.kind === 'wall' ? dd.m.p.ty : Math.floor(wp.y / TILE) - dd.gy
    if (tx === dd.tx && ty === dd.ty) return
    dd.tx = tx
    dd.ty = ty
    dd.moved = true
    dd.why = !dd.placing && tx === dd.m.p.tx && ty === dd.m.p.ty ? null : this.dragProblem(dd, tx, ty)
    if (dd.placing) dd.m.img.setVisible(true).setAlpha(dd.why ? 0.55 : 0.85)
    this.placeMovable(dd.m, tx, ty)
    dd.m.img.setTint(dd.why ? 0xff9aa4 : 0xc8ffd8)
    store.setState({ arrangeNote: dd.why })
    this.drawEditLayer()
  }

  private finishDecorDrag(): void {
    const dd = this.decorDrag!
    this.decorDrag = null
    const { m } = dd
    m.img.clearTint()
    this.game.canvas.style.cursor = ''
    // picked up and put straight back: that was a click
    if (!dd.moved) return this.openArrange(m)
    const stays = dd.tx === m.p.tx && dd.ty === m.p.ty
    if (dd.why || stays) {
      // no: it goes back where it was, and the note says why
      this.placeMovable(m, m.p.tx, m.p.ty)
      this.openArrange(m, dd.why)
      this.drawEditLayer()
      return
    }
    store.setState({ arrangeNote: null })
    this.saveMoved(m, dd.tx, dd.ty)
    this.openArrange(m)
  }

  /** The catalog's chosen piece, following the pointer until you click somewhere it fits. */
  private beginPlacing(key: string): void {
    this.endPlacing()
    const floor = decorDef(key)
    const wall = wallDef(key)
    if (!floor && !wall) return
    const o = store.getState().office
    const color = LIGHTS[o.light]?.color ?? LIGHTS.warm.color
    this.canvasTex('ghost', floor ? decorArt(key) : wallArt(key, { light: color, picture: o.picture, sign: this.signWords(o) }))
    const img = this.add.image(0, 0, 'ghost').setOrigin(0, 1).setDepth(floor?.flat ? 0.5 : 59_000).setVisible(false)
    const m: Movable = floor
      ? { p: { key, tx: -99, ty: -99, tw: floor.tw, th: floor.th, blocks: !floor.flat, flat: floor.flat, uid: 'ghost' }, img, kind: 'floor' }
      : { p: { key, tx: -99, ty: 1, tw: wall!.w, th: 3, blocks: false, uid: 'ghost' }, img, kind: 'wall' }
    this.decorDrag = {
      m,
      tx: -99,
      ty: -99,
      gx: Math.floor(m.p.tw / 2),
      gy: m.kind === 'wall' ? 0 : Math.floor(m.p.th / 2),
      moved: true,
      placing: true,
      why: null,
      others: this.placements,
      ctx: placeContext(o),
      grid: buildWalkGrid(this.placements),
      taken: this.wallTaken()
    }
    this.game.canvas.style.cursor = 'copy'
    this.drawEditLayer()
  }

  private endPlacing(): void {
    if (!this.decorDrag?.placing) return
    this.decorDrag.m.img.destroy()
    this.decorDrag = null
    this.game.canvas.style.cursor = ''
    this.drawEditLayer()
  }

  /** A click while placing: it goes down here if it fits; if not, the status says why and you can try elsewhere. */
  private commitPlacing(p: Phaser.Input.Pointer): void {
    const dd = this.decorDrag!
    this.moveDecorDrag(p)
    if (dd.tx === -99) return
    dd.why = this.dragProblem(dd, dd.tx, dd.ty)
    if (dd.why) return store.setState({ arrangeNote: dd.why })
    const o = store.getState().office
    const id = `d${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
    const key = dd.m.p.key
    const { tx, ty } = dd
    const wall = dd.m.kind === 'wall'
    store.setState({ placing: null, arrangeNote: null, arrange: wall ? { kind: 'hung', id } : { kind: 'piece', uid: id, key } })
    void actions.saveOffice(wall ? { wall: [...o.wall, { id, key, x: tx }] } : { items: [...o.items, { id, key, tx, ty }] })
  }

  private saveMoved(m: Movable, tx: number, ty: number): void {
    const o = store.getState().office
    const uid = m.p.uid ?? ''
    if (m.kind === 'bed') void actions.saveOffice({ dog: { ...o.dog, bed: { tx, ty } } })
    else if (m.kind === 'wall') void actions.saveOffice({ wall: o.wall.map((h) => (h.id === uid ? { ...h, x: tx } : h)) })
    else if (o.items.some((i) => i.id === uid)) void actions.saveOffice({ items: o.items.map((i) => (i.id === uid ? { ...i, tx, ty } : i)) })
    else {
      // back on its original spot, it's no longer a change
      const home = PLACEMENTS.find((q) => q.uid === uid)
      const moves = { ...o.moves, [uid]: { tx, ty } }
      if (home && home.tx === tx && home.ty === ty) delete moves[uid]
      void actions.saveOffice({ moves })
    }
  }

  /** Selecting a piece: its options appear in the panel. */
  private openArrange(m: Movable, note: string | null = null): void {
    if (m.kind === 'bed') store.setState({ arrange: { kind: 'dog' }, arrangeNote: note })
    else if (m.kind === 'wall') store.setState({ arrange: { kind: 'hung', id: m.p.uid! }, arrangeNote: note })
    else store.setState({ arrange: { kind: 'piece', uid: m.p.uid!, key: m.p.key }, arrangeNote: note })
  }

  /** A click on something that can't be picked up: the poster or the dog select; anywhere else clears the selection. */
  private arrangeClick(p: Phaser.Input.Pointer): void {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y)
    const dog = this.corgi
    const near = (x: number, y: number, r: number) => Math.hypot(wp.x - x, wp.y - y) < r
    if (dog && (near(dog.position.x, dog.position.y - 6, 12) || near(dog.ballSprite.x, dog.ballSprite.y - 3, 8))) return store.setState({ arrange: { kind: 'dog' }, arrangeNote: null })
    if (this.posters.some((i) => wp.x >= i.x && wp.x < i.x + i.width && wp.y >= i.y && wp.y < i.y + i.height)) return store.setState({ arrange: { kind: 'poster' }, arrangeNote: null })
    store.setState({ arrange: null, arrangeNote: null })
  }

  /** The nearest spot around this tile where a piece fits; null when there's none. */
  fitNear(key: string, tx: number, ty: number, self: string | null = null): { tx: number; ty: number } | null {
    const def = decorDef(key)
    if (!def) return null
    const ctx = placeContext(store.getState().office)
    const others = self ? this.placements.filter((q) => q.uid !== self) : this.placements
    const size = { tw: def.tw, th: def.th, flat: def.flat }
    const tries: { tx: number; ty: number }[] = []
    for (let dy = 0; dy < def.th; dy++) for (let dx = 0; dx < def.tw; dx++) tries.push({ tx: tx - dx, ty: ty - dy })
    return tries.find((t) => !spotProblem(ctx, others, size, t.tx, t.ty) && (def.flat || !this.tiles.has(`${t.tx},${t.ty}`))) ?? null
  }

  /** Is there anywhere left on this office's wall for a piece? */
  wallHasRoom(key: string): boolean {
    const taken = this.wallTaken()
    const hung = store.getState().office.wall
    for (let x = 1; x < COLS - 1; x++) if (!wallProblem(taken, hung, null, key, x)) return true
    return false
  }

  /** The signed words this project's sign shows. */
  private signWords(o: OfficeConfig): string {
    const name = store.getState().projects[store.getState().activeProjectId ?? '']?.name ?? ''
    return cleanSign(o.sign).trim() || signFor(name)
  }

  private setPersonalArt(o: OfficeConfig): void {
    setPersonal({ sign: this.signWords(o), picture: o.picture, light: LIGHTS[o.light]?.color ?? LIGHTS.warm.color })
  }

  /** Brings everything on the floor into line with the saved office. No rebuild: nobody and nothing else moves. */
  private syncDecor(o: OfficeConfig, prev: OfficeConfig): void {
    if (o.sign !== prev.sign || o.picture !== prev.picture || o.light !== prev.light) {
      this.setPersonalArt(o)
      for (const key of PERSONAL_KEYS) {
        const imgs = this.byKey.get(key) ?? []
        if (this.textures.exists(key)) this.textures.remove(key)
        if (!imgs.length) continue
        this.canvasTex(key, artFor(key)())
        for (const img of imgs) img.setTexture(key)
      }
    }
    const desired = resolveDecor(o, store.getState().employees.map((e) => e.deskId)).filter((q) => q.uid)
    const current = this.placements.filter((q) => q.uid)
    const byUid = new Map(desired.map((q) => [q.uid!, q]))
    const kept: Placement[] = []
    let added: Placement | null = null
    for (const q of current) {
      const to = byUid.get(q.uid!)
      if (!to || to.key !== q.key || to.tw !== q.tw) {
        this.dropImage(q)
        continue
      }
      kept.push(q)
      if (to.tx !== q.tx || to.ty !== q.ty) {
        q.tx = to.tx
        q.ty = to.ty
        const m = this.movables.get(q.uid!)
        if (m) this.placeMovable(m, q.tx, q.ty)
      }
    }
    const fresh = desired.filter((q) => !kept.some((k) => k.uid === q.uid))
    for (const q of fresh) {
      const img = this.placeImage(q)
      this.jiggle(img, 'hop')
      added = q
    }
    this.placements = [...this.placements.filter((q) => !q.uid), ...kept, ...fresh]
    this.refreshGrid()
    this.syncWall(o)
    this.syncCorner(o, prev)
    if (added && !added.flat) this.corgi?.noticeNew({ x: added.tx, y: added.ty })
    if (added?.flat) this.corgi?.noticeNew({ x: added.tx, y: added.ty - 1 })
    this.canvasTex('lampGlow', lampGlowMap(this.placements, this.lightRgb(), this.litWallSpots()))
    this.glowLayer?.setTexture('lampGlow')
    this.paintLighting()
    this.drawEditLayer()
  }

  /** Characters and the dog share this grid by reference, so it changes in place, then they check their routes. */
  private refreshGrid(): void {
    const next = buildWalkGrid(this.placements)
    for (let y = 0; y < next.length; y++) for (let x = 0; x < next[y].length; x++) this.grid[y][x] = next[y][x]
    for (const c of this.characters.values()) c.gridChanged()
    this.corgi?.gridChanged()
  }

  /** What hangs on the north wall. */
  private syncWall(o: OfficeConfig): void {
    const taken = this.wallTaken()
    const color = LIGHTS[o.light]?.color ?? LIGHTS.warm.color
    const sigFor = (key: string) => `${key}|${wallDef(key)?.lit ? color : ''}|${key === 'wall:picture' ? o.picture : ''}|${key === 'wall:sign' ? `${this.signWords(o)}|${color}` : ''}|${key === 'wall:pennants' ? o.accent : ''}`
    const wanted = new Map(o.wall.filter((h, i) => !wallProblem(taken, o.wall.slice(0, i), h.id, h.key, h.x)).map((h) => [h.id, h]))
    for (const [id, h] of this.hung) {
      const w = wanted.get(id)
      if (w && sigFor(w.key) === h.sig) continue
      h.m.img.destroy()
      this.hung.delete(id)
    }
    for (const [id, w] of wanted) {
      const have = this.hung.get(id)
      if (have) {
        have.m.p = { ...have.m.p, tx: w.x }
        this.placeMovable(have.m, w.x, 1)
        continue
      }
      const key = `hung:${id}`
      this.canvasTex(key, wallArt(w.key, { light: color, picture: o.picture, sign: this.signWords(o) }))
      const img = this.add.image(0, 0, key).setOrigin(0, 1).setDepth(6)
      const m: Movable = { p: { key: w.key, tx: w.x, ty: 1, tw: wallDef(w.key)?.w ?? 2, th: 3, blocks: false, uid: id }, img, kind: 'wall' }
      this.placeMovable(m, w.x, 1)
      this.hung.set(id, { m, sig: sigFor(w.key) })
    }
  }

  /** Puffy's corner: his bed where you put it, in the colour you chose, and the toy he's fond of. */
  private syncCorner(o: OfficeConfig, prev: OfficeConfig): void {
    const dog = this.corgi
    if (!dog) return
    if (o.dog.bedStyle !== prev.dog.bedStyle) dog.setBed(this.bedTexture(o))
    if (o.dog.toy !== prev.dog.toy) dog.setToy(this.toyTexture(o))
    if (o.dog.bed?.tx !== prev.dog.bed?.tx || o.dog.bed?.ty !== prev.dog.bed?.ty) {
      setDogCorner(dogBedAt(o, this.placements))
      dog.bedMoved()
    }
  }

  /** Where the camera is looking doesn't change anything; this redraws the guides while you're arranging. */
  private drawEditLayer(): void {
    const g = this.editLayer
    g.clear()
    if (!store.getState().editOffice) return
    const sel = store.getState().arrange
    const selected = (m: Movable) => (sel?.kind === 'piece' && sel.uid === m.p.uid) || (sel?.kind === 'hung' && sel.id === m.p.uid) || (sel?.kind === 'dog' && m.kind === 'bed')
    const outline = (m: Movable, x: number, y: number, w: number, h: number) => {
      const on = selected(m)
      const hover = this.hoverUid === (m.p.uid ?? m.kind)
      g.lineStyle(on ? 1.5 : 1, on ? ACTIVE : OUTLINE, on ? 1 : hover ? 0.9 : 0.28)
      g.strokeRect(x, y, w, h)
      if (on) {
        g.fillStyle(ACTIVE, 0.14)
        g.fillRect(x, y, w, h)
      }
    }
    for (const m of this.movables.values()) {
      if (this.decorDrag?.m !== m) outline(m, m.p.tx * TILE + 0.5, m.p.ty * TILE + 0.5, m.p.tw * TILE - 1, m.p.th * TILE - 1)
    }
    const bed = this.bedMovable()
    if (bed && this.decorDrag?.m.kind !== 'bed') outline(bed, bed.p.tx * TILE + 0.5, bed.p.ty * TILE + 0.5, bed.p.tw * TILE - 1, bed.p.th * TILE - 1)
    // while something is on its way to the wall, the wall says where there's room
    const toWall = this.decorDrag?.m.kind === 'wall'
    const taken = toWall ? this.wallTaken() : null
    const hung = store.getState().office.wall
    if (taken) {
      for (let x = 1; x < COLS - 1; x++) {
        if (taken.has(x) || hung.some((h) => h.id !== this.decorDrag!.m.p.uid && x >= h.x && x < h.x + (wallDef(h.key)?.w ?? 2))) continue
        g.lineStyle(1.5, 0x5ee6a8, 0.8)
        g.lineBetween(x * TILE + 2, 3.7 * TILE, (x + 1) * TILE - 2, 3.7 * TILE)
      }
    }
    for (const h of this.hung.values()) {
      if (this.decorDrag?.m !== h.m) outline(h.m, h.m.img.x - 0.5, h.m.img.y - h.m.img.height - 0.5, h.m.img.width + 1, h.m.img.height + 1)
    }
    const d = this.decorDrag
    if (!d?.moved || d.tx === -99) return
    const ok = 0x5ee6a8
    const no = 0xff6b7a
    if (d.m.kind === 'wall') {
      g.fillStyle(d.why ? no : ok, 0.3)
      g.fillRect(d.tx * TILE, TILE, d.m.p.tw * TILE, 3 * TILE)
      return
    }
    // the grid around the piece: which tiles it could use, and its footprint in green or red
    const flat = !!d.m.p.flat && d.m.kind !== 'bed'
    for (let y = d.ty - 2; y < d.ty + d.m.p.th + 2; y++) {
      for (let x = d.tx - 2; x < d.tx + d.m.p.tw + 2; x++) {
        const bad = !!tileProblem(d.ctx, d.grid, x, y, flat, d.m.kind === 'bed')
        g.lineStyle(1, bad ? no : ok, 0.3)
        g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1)
      }
    }
    g.fillStyle(d.why ? no : ok, 0.32)
    g.fillRect(d.tx * TILE, d.ty * TILE, d.m.p.tw * TILE, d.m.p.th * TILE)
  }

  // ── DOM overlay (crisp text over the pixel world) ───────────
  // indicator glyphs, one per kind of waiting: decision, question, blocked, interrupted, ready for review

  private createOverlay(): void {
    for (const e of store.getState().employees) {
      const el = document.createElement('div')
      el.className = 'office-label'
      el.innerHTML = `<span class="office-label-name"><button class="office-attn" hidden></button><span></span></span><span class="office-label-detail"></span>`
      ;(el.querySelector('.office-label-name > span') as HTMLElement).textContent = e.name.split(' ')[0]
      el.addEventListener('click', () => actions.select(e.id))
      // the attention indicator opens what waits for you (the decision, the result, the task)
      el.querySelector('.office-attn')!.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const item = store.getState().indicators.find((x) => x.employeeId === e.id)
        if (item) void actions.openAttention(item)
      })
      this.overlay.appendChild(el)
      this.labels.set(e.id, el)
    }
    this.meetingPanel = document.createElement('div')
    this.meetingPanel.className = 'meeting-panel'
    this.overlay.appendChild(this.meetingPanel)
  }

  /** Canvas pixels per CSS pixel (2 when rendering at a high-density display's resolution). */
  private get ds(): number {
    return 1 / (this.scale.zoom || 1)
  }

  /** World point → CSS position in the overlay (the canvas may render at device resolution). */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main
    return { x: ((x - cam.worldView.x) * cam.zoom) / this.ds, y: ((y - cam.worldView.y) * cam.zoom) / this.ds }
  }

  private updateOverlay(): void {
    const s = store.getState()
    // zoomed out, labels shrink to the name (problems keep their detail); zoomed in, full detail
    const compact = this.cameras.main.zoom / this.ds < 2.5
    for (const [id, el] of this.labels) {
      const c = this.characters.get(id)
      if (!c) continue
      const st = s.statuses[id]
      const busy = !!st && st.activity !== 'idle'
      const need = s.indicators.find((x) => x.employeeId === id)
      const show = busy || !!need || s.selectedEmployeeId === id
      el.style.display = show ? '' : 'none'
      if (!show) continue
      const badge = el.querySelector('.office-attn') as HTMLButtonElement
      const kind = need?.kind ?? ''
      if (badge.dataset.kind !== kind) {
        badge.dataset.kind = kind
        badge.hidden = !need
        badge.textContent = ATTN_GLYPH[kind] ?? ''
        badge.setAttribute('aria-label', need?.label ?? '')
        badge.dataset.tip = need ? `${need.label} · click to open` : ''
      }
      const p = this.toScreen(c.position.x, c.position.y - 32)
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`
      el.dataset.activity = st?.activity ?? 'idle'
      if (el.classList.contains('compact') !== compact) el.classList.toggle('compact', compact)
      // one small icon per state; the words are in the tooltip (labels stay quiet over the office)
      const detail = el.lastChild as HTMLElement
      const text = st?.detail ?? ''
      const icon = busy ? DOING_ICON[doingOf(st)!] ?? STATUS_ICON[st!.activity] ?? '' : ''
      if (detail.dataset.icon !== icon) {
        detail.dataset.icon = icon
        detail.innerHTML = icon ? `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${icon}"/></svg>` : ''
      }
      if (detail.dataset.tip !== text) {
        detail.dataset.tip = text
        detail.setAttribute('aria-label', text)
      }
      detail.style.display = icon && !need ? '' : 'none'
    }

    const project = s.activeProjectId ? s.projects[s.activeProjectId] : null
    const planningRun = Object.values(s.runs).find((r) => r.kind === 'planning' && r.status === 'running')
    if (project?.phase === 'planning' && planningRun) {
      const tv = WALL_DECOR.meetingTv
      const p = this.toScreen((tv.x + tv.w / 2) * TILE, 16)
      this.meetingPanel.style.display = ''
      const top = Math.max(8, Math.round(p.y - this.meetingPanel.offsetHeight))
      // kept fully inside the stage when zoomed in or panned near an edge
      const w = this.meetingPanel.offsetWidth
      const left = Math.min(Math.max(8, p.x - w / 2), Math.max(8, this.overlay.clientWidth - 8 - w))
      this.meetingPanel.style.transform = `translate(${Math.round(left)}px, ${top}px)`
      const recent = (s.events[planningRun.id] ?? []).filter((e) => e.kind === 'tool_use' || e.kind === 'text').slice(-4)
      const html = recent.map((e) => `<div class="mp-line ${e.kind}">${escapeHtml(e.summary)}</div>`).join('')
      const body = `<div class="mp-title"><span class="mp-live"></span>Kickoff · ${escapeHtml(project.name)}</div>${html || '<div class="mp-line">Maya is reading the repository…</div>'}`
      if (this.meetingPanel.dataset.html !== body) {
        this.meetingPanel.innerHTML = body
        this.meetingPanel.dataset.html = body
      }
    } else this.meetingPanel.style.display = 'none'

    // the world inspector card (rendered by React) follows its object
    const card = document.getElementById('world-inspector')
    const inspected = INTERACTIVES.find((i) => i.id === s.inspect)
    if (card && inspected) {
      const r = inspected.rect
      const top = this.toScreen((r.x + r.w / 2) * TILE, r.y * TILE)
      const bottom = this.toScreen((r.x + r.w / 2) * TILE, (r.y + r.h) * TILE)
      const at = placeCard(top.x, top.y, bottom.y, card.offsetWidth, card.offsetHeight, this.overlay.clientWidth, this.overlay.clientHeight)
      card.style.left = `${at.left}px`
      card.style.top = `${at.top}px`
      card.style.setProperty('--arrow-x', `${at.arrowX}px`)
      if (card.classList.contains('below') !== at.below) card.classList.toggle('below', at.below)
      if (card.classList.contains('detached') !== at.detached) card.classList.toggle('detached', at.detached)
    }
  }

  /** Who is in a room right now (for the room card). Cosmetic positions, real names. */
  occupants(zone: ZoneId): string[] {
    return [...this.characters.values()]
      .filter((c) => zoneAt(Math.floor(c.position.x / TILE), Math.floor((c.position.y - 2) / TILE)) === zone)
      .map((c) => c.employee.id)
  }

  // ── camera ──────────────────────────────────────────────────

  /** One camera motion at a time (focus, reset, eased zoom); any direct user input cancels it. */
  private glide: {
    from: View
    to: View
    /** Zoom about a fixed world point that stays under the same screen position (cursor zoom). */
    anchor?: { wx: number; wy: number; offX: number; offY: number }
    /** Pan towards a person who may be walking; following continues once the glide ends. */
    follow?: string
    start: number
    ms: number
    ease: (t: number) => number
  } | null = null
  private pinchAcc = 0
  private pinchAt = 0
  private lastNotch = 0

  /**
   * The exact camera centre. Phaser rounds the camera's scroll to whole pixels when it renders, so
   * reading it back would lose the fraction of every small trackpad movement; this keeps the truth.
   */
  private center = { cx: WORLD_W / 2, cy: WORLD_H / 2 }

  /** Where the camera is: the world point at the viewport centre, and canvas pixels per art pixel. */
  private get view(): View {
    return { ...this.center, zoom: this.cameras.main.zoom }
  }

  private setView(v: View): void {
    const cam = this.cameras.main
    this.center = clampCenter(v.cx, v.cy, cam.width, cam.height, v.zoom, WORLD_W, WORLD_H)
    cam.setZoom(v.zoom)
    cam.setScroll(this.center.cx - cam.width / 2, this.center.cy - cam.height / 2)
  }

  private glideTo(to: View, ms: number, opts: { anchor?: NonNullable<OfficeScene['glide']>['anchor']; follow?: string } = {}): void {
    if (this.reduced || ms <= 0) {
      this.glide = null
      const a = opts.anchor
      this.setView(a ? { ...anchoredCenter(a.wx, a.wy, a.offX, a.offY, to.zoom), zoom: to.zoom } : to)
      return
    }
    this.glide = { from: this.view, to, ...opts, start: performance.now(), ms, ease: opts.anchor ? easeOutCubic : easeInOutSine }
  }

  private updateGlide(): void {
    const g = this.glide
    if (!g) return
    // wall-clock time: monotonic, and a glide still lands on time after a dropped or throttled frame
    const t = Math.min(1, Math.max(0, (performance.now() - g.start) / g.ms))
    const k = g.ease(t)
    const zoom = g.from.zoom + (g.to.zoom - g.from.zoom) * k
    if (g.anchor) this.setView({ ...anchoredCenter(g.anchor.wx, g.anchor.wy, g.anchor.offX, g.anchor.offY, zoom), zoom })
    else {
      const to = (g.follow && this.followPoint(g.follow)) || g.to
      this.setView({ cx: g.from.cx + (to.cx - g.from.cx) * k, cy: g.from.cy + (to.cy - g.from.cy) * k, zoom })
    }
    if (t >= 1) this.glide = null
  }

  private followPoint(id: string): { cx: number; cy: number } | null {
    const c = this.characters.get(id)
    return c ? { cx: c.position.x, cy: c.position.y - 12 } : null
  }

  /** The user took the camera: stop any motion and stop following. */
  private takeControl(): void {
    this.glide = null
    this.followId = null
    this.userMoved = true
  }

  private setupCamera(): void {
    const cam = this.cameras.main
    cam.setRoundPixels(true)
    this.homeCamera()
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      const before = this.view
      cam.setSize(size.width, size.height)
      // a framing you chose keeps its centre and zoom; the starting view re-frames the new size
      if (this.userMoved) this.setView(before)
      else this.homeCamera()
    })
    // right-click has no meaning in the office; don't show the browser menu over it
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // right-click while placing puts the piece back in the catalog
      if (p.button === 2) {
        if (this.decorDrag?.placing) store.setState({ placing: null, arrangeNote: null })
        return
      }
      if (store.getState().editOffice && p.button === 0 && !this.decorDrag?.placing) {
        const m = this.movableAt(p)
        if (m) {
          this.startDecorDrag(m, p)
          this.drawEditLayer()
          return
        }
      }
      const v = this.view
      this.drag = { x: p.x, y: p.y, sx: v.cx, sy: v.cy, moved: false, button: p.button }
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.drag
      if (!d || !p.isDown) return
      if (!d.moved) {
        // a press that wanders a few pixels is still a click; past that it's a drag, starting here
        if (Math.hypot(p.x - d.x, p.y - d.y) <= DRAG_SLOP_CSS * this.ds) return
        d.moved = true
        // if a glide moved the view since the press, re-base so the point you grabbed stays under the cursor
        const z0 = this.cameras.main.zoom
        const v = this.view
        if (this.glide) Object.assign(d, { sx: v.cx + (p.x - d.x) / z0, sy: v.cy + (p.y - d.y) / z0 })
        this.takeControl()
        this.game.canvas.style.cursor = 'grabbing'
      }
      const z = this.cameras.main.zoom
      this.setView({ cx: d.sx - (p.x - d.x) / z, cy: d.sy - (p.y - d.y) / z, zoom: z })
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.decorDrag && !this.decorDrag.placing) {
        this.finishDecorDrag()
        return
      }
      const d = this.drag
      if (d?.moved) this.game.canvas.style.cursor = this.hovered ? 'pointer' : ''
      // arranging: a click means "what can go here?", never the office's usual click
      if (d && !d.moved && d.button === 0 && store.getState().editOffice) {
        if (this.decorDrag?.placing) this.commitPlacing(p)
        else this.arrangeClick(p)
        return void this.time.delayedCall(0, () => (this.drag = null))
      }
      if (d && !d.moved && d.button === 0 && (!over.length || store.getState().editOffice)) {
        const hit = this.hitInteractive(p)
        if (hit?.id.startsWith('play:')) {
          const key = hit.id.split(':').slice(1, -1).join(':')
          // not every cabinet in the row is the same game
          const cabinets = this.playfulPlacements().filter((q) => gameFor(q.p.key) === 'hotfix')
          const night = key === 'gs:arcadeB' || (key === 'arcade' && cabinets.findIndex((q) => q.id === hit.id) === 1)
          store.setState({ playing: { game: gameFor(key)!, night }, inspect: null })
          return void this.time.delayedCall(0, () => (this.drag = null))
        }
        if (hit?.id.startsWith('fun:')) {
          this.tapProp(hit.id)
          return void this.time.delayedCall(0, () => (this.drag = null))
        }
        store.setState({ inspect: hit?.id ?? null })
        if (!hit) actions.select(null)
        this.drawHighlight()
      }
      this.time.delayedCall(0, () => (this.drag = null))
    })
    // Wheel input is read natively (not passive) so a trackpad pinch never zooms the whole page.
    const canvas = this.game.canvas
    const onWheel = (e: WheelEvent) => this.onWheel(e)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    this.events.once(Phaser.Scenes.Events.DESTROY, () => canvas.removeEventListener('wheel', onWheel))
    // The camera moves only with the mouse and trackpad (no arrow keys); 0 fits, + and − zoom.
    // Phaser listens on the whole window, so ignore keys typed into inputs anywhere in the app.
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '0') this.fitCamera()
      else if (e.key === '=' || e.key === '+') this.zoomBy(1.2)
      else if (e.key === '-') this.zoomBy(1 / 1.2)
    })
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (this.decorDrag && !this.decorDrag.placing) return
    const ds = this.ds
    const intent = wheelIntent(e as WheelEvent & { wheelDeltaY?: number })
    if (intent === 'pan') {
      // two-finger trackpad scroll moves the office under your fingers, the same distance at any zoom
      this.takeControl()
      const v = this.view
      this.setView({ cx: v.cx + (e.deltaX * ds) / v.zoom, cy: v.cy + (e.deltaY * ds) / v.zoom, zoom: v.zoom })
      return
    }
    const now = performance.now()
    let dir: 1 | -1 | 0 = 0
    if (intent === 'pinch') {
      if (now - this.pinchAt > 250) this.pinchAcc = 0
      this.pinchAt = now
      this.pinchAcc -= e.deltaY
      if (Math.abs(this.pinchAcc) >= PINCH_STEP) {
        dir = this.pinchAcc > 0 ? 1 : -1
        this.pinchAcc -= dir * PINCH_STEP
      }
    } else {
      // free-spinning wheels send bursts; one step per notch-sized interval
      if (now - this.lastNotch < 45) return
      this.lastNotch = now
      dir = e.deltaY > 0 ? -1 : 1
    }
    if (dir) this.zoomStep(dir, e.offsetX * ds, e.offsetY * ds)
  }

  /** One zoom step about a screen point (canvas pixels): that point stays put. */
  private zoomStep(dir: 1 | -1, sx: number, sy: number): void {
    const cam = this.cameras.main
    const v = this.view
    // keep stepping from where a running zoom is heading, so quick notches add up
    const from = this.glide?.anchor ? this.glide.to.zoom : v.zoom
    const zoom = stepZoom(from, dir, this.ds, Math.min(from, MIN_ZOOM * this.ds), MAX_ZOOM * this.ds)
    if (zoom === from) return
    this.userMoved = true
    // while following someone, zoom about them (the screen centre) rather than the cursor
    const offX = this.followId ? 0 : sx - cam.width / 2
    const offY = this.followId ? 0 : sy - cam.height / 2
    this.glideTo({ ...v, zoom }, 150, { anchor: { wx: v.cx + offX / v.zoom, wy: v.cy + offY / v.zoom, offX, offY } })
  }

  /**
   * The starting view is the whole office, fitted edge to edge (the same as the Fit control); it
   * re-fits on resize unless you framed it yourself, and whenever the conversation opens or closes.
   */
  homeCamera(): void {
    this.fitCamera(false, false)
  }

  /** Fit the whole office in view (the "fit" control and ⌘0). */
  fitCamera(keepIfUserMoved = false, animate = true): void {
    if (keepIfUserMoved && this.userMoved) return
    this.userMoved = false
    this.followId = null
    // the whole office as large as it fits, edge to edge with a hairline margin (on sharp screens the
    // pixels are small enough that an in-between zoom still reads crisply)
    // and clear of the team dock along the bottom, so nothing in the office starts out hidden behind it
    const inset = DOCK_INSET * this.ds
    const tight = Math.min(this.scale.width / (WORLD_W + 8), (this.scale.height - inset) / (WORLD_H + 8))
    // beside the rail and the panel the stage can be narrower than the office at 1:1: seeing all of it matters more
    const z = Math.max(FIT_MIN_ZOOM * this.ds, tight)
    this.glideTo({ cx: WORLD_W / 2, cy: WORLD_H / 2 + inset / 2 / z, zoom: z }, animate ? 420 : 0)
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main
    this.zoomStep(factor > 1 ? 1 : -1, cam.width / 2, cam.height / 2)
  }

  focusEmployee(id: string): void {
    const p = this.followPoint(id)
    if (!p) return
    this.followId = id
    this.userMoved = true
    const zoom = Math.max(this.cameras.main.zoom, snapZoom(3 * this.ds, this.ds))
    this.glideTo({ ...p, zoom }, 420, { follow: id })
  }

  focusZone(zone: ZoneId): void {
    const z = ZONES[zone]
    const cam = this.cameras.main
    this.followId = null
    this.userMoved = true
    const fit = Math.min(cam.width / ((z.w + 2) * TILE), cam.height / ((z.h + 3) * TILE))
    const zoom = snapZoom(Phaser.Math.Clamp(fit, MIN_ZOOM * this.ds, MAX_ZOOM * this.ds), this.ds, 'down')
    this.glideTo({ cx: (z.x + z.w / 2) * TILE, cy: (z.y + z.h / 2) * TILE - 8, zoom }, 450)
  }

  focusRoom(id: string): void {
    const i = INTERACTIVES.find((x) => x.id === id)
    if (!i) return
    this.followId = null
    this.userMoved = true
    const zoom = Math.max(this.cameras.main.zoom, snapZoom(2.6 * this.ds, this.ds))
    this.glideTo({ cx: (i.rect.x + i.rect.w / 2) * TILE, cy: (i.rect.y + i.rect.h / 2) * TILE, zoom }, 450)
  }

  // ── store bindings ──────────────────────────────────────────

  private bindStore(): void {
    let prev: AppState = store.getState()
    for (const st of Object.values(prev.statuses)) this.applyStatus(st)
    this.redrawBoards(prev)
    this.syncConsults(prev)
    this.unsub.push(
      store.subscribe((s) => {
        if (s.statuses !== prev.statuses) {
          for (const st of Object.values(s.statuses)) if (prev.statuses[st.employeeId] !== st) this.applyStatus(st)
        }
        if (s.tasks !== prev.tasks || s.projects !== prev.projects) this.redrawBoards(s)
        if (s.tasks !== prev.tasks || s.deliveries !== prev.deliveries) this.playMoments(prev, s)
        if (s.tasks !== prev.tasks || s.statuses !== prev.statuses) this.syncConsults(s)
        if (s.selectedEmployeeId !== prev.selectedEmployeeId) {
          for (const [id, c] of this.characters) c.setSelected(id === s.selectedEmployeeId)
          if (s.selectedEmployeeId) this.focusEmployee(s.selectedEmployeeId)
          else this.followId = null
        }
        if (s.inspect !== prev.inspect) this.drawHighlight()
        if (s.deliveries !== prev.deliveries || s.attention !== prev.attention) this.reactAtReception(prev, s)
        // coming back to the office after a while away: she says hello (rarely)
        if (s.view === 'office' && prev.view !== 'office') this.greetUser()
        // the stage may have changed size while it was hidden (the rail, the panel): show the whole office again
        if (s.view === 'office' && prev.view !== 'office') setTimeout(() => this.sys?.game && this.scene.isActive() && this.fitCamera(true, false), 120)
        if (s.placing !== prev.placing) {
          if (s.placing) this.beginPlacing(s.placing)
          else this.endPlacing()
        }
        if (s.editOffice !== prev.editOffice || s.arrange !== prev.arrange) this.drawEditLayer()
        // customizing takes the side column, so the office re-fits as it does for the conversation
        if (s.editOffice !== prev.editOffice) this.time.delayedCall(80, () => this.fitCamera(false, true))
        if (s.office !== prev.office) this.syncDecor(s.office, prev.office)
        // showing or hiding the conversation changes the stage: the office re-fits to the new size
        if (s.panelOpen !== prev.panelOpen) this.time.delayedCall(80, () => this.fitCamera(false, true))
        if (s.office.accent !== prev.office.accent || s.office.art !== prev.office.art) this.applyStyle(s.office)
        prev = s
      })
    )
  }

  private applyStatus(st: EmployeeStatus): void {
    this.characters.get(st.employeeId)?.setActivity(st.activity)
    this.syncWork(store.getState())
  }

  private places = new Map<string, PlaceMachine>()

  /** Everything the real work decides about a person: where they are, their screen, whether they're asking for you. */
  private syncWork(s: AppState): void {
    const now = Date.now()
    for (const [id, c] of this.characters) {
      const st = s.statuses[id]
      const doing = doingOf(st)
      let m = this.places.get(id)
      if (!m) this.places.set(id, (m = new PlaceMachine()))
      c.setDoing(doing)
      c.setWorkPlace(m.next(placeFor(c.employee.role, doing), now, doing === null || doing === 'waiting' || doing === 'blocked'))
      c.setNeedsYou(!!st?.needsYou || s.indicators.some((x) => x.employeeId === id && (x.kind === 'approval' || x.kind === 'question')))
    }
  }

  /** The focus room hosts real consultations: the teammate answering and the one who asked. */
  private syncConsults(s: AppState): void {
    const roles = new Map<string, 0 | 1>()
    for (const st of Object.values(s.statuses)) {
      if (st.activity !== 'reviewing' || !st.taskId) continue
      const consult = parseConsultNote(s.tasks[st.taskId]?.note ?? null)
      if (!consult) continue
      roles.set(st.employeeId, 0)
      const asker = s.tasks[consult.consultFor]?.assigneeId
      if (asker && s.statuses[asker]?.activity !== 'working') roles.set(asker, 1)
    }
    for (const [id, c] of this.characters) c.setFocusRole(roles.get(id) ?? null)
    this.consult = null
    for (const [id, role] of roles) {
      if (role !== 0) continue
      const st = s.statuses[id]
      const consult = parseConsultNote(s.tasks[st?.taskId ?? '']?.note ?? null)
      const a = s.employees.find((e) => e.id === id)
      const b = s.employees.find((e) => e.id === s.tasks[consult?.consultFor ?? '']?.assigneeId)
      if (a && b && consult) this.consult = { a: ROLE_TINT[a.role] ?? '#f7c66b', b: ROLE_TINT[b.role] ?? '#5fb7ff', area: consult.area }
    }
  }

  private consult: { a: string; b: string; area: 'design' | 'architecture' } | null = null

  private redrawBoards(s: AppState): void {
    if (this.kanban) {
      drawKanban(this.kanban.px, this.kanban.w, this.kanban.h, Object.values(s.tasks))
      this.kanban.tex.refresh()
    }
    if (this.roadmap) {
      const rows: RoadmapRow[] = Object.values(s.projects)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
        .map((p) => {
          const tasks = p.id === s.activeProjectId ? Object.values(s.tasks).filter((t) => t.status !== 'proposed') : []
          const stage = { new: 0, planning: 0, awaiting_plan_approval: 1, executing: 2, blocked: 2, failed: 2, completed: 4 }[p.phase]
          const verifying = p.phase === 'executing' && tasks.some((t) => t.kind === 'qa' && (t.status === 'running' || t.status === 'merging'))
          return {
            stage: verifying ? 3 : stage,
            blocked: p.phase === 'blocked' || p.phase === 'failed',
            progress: tasks.length ? { done: tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length, total: tasks.length } : null,
            active: p.id === s.activeProjectId
          }
        })
      drawRoadmap(this.roadmap.px, this.roadmap.w, this.roadmap.h, rows)
      this.roadmap.tex.refresh()
    }
  }

  private animateScreens(): void {
    this.tick++
    // playtest screens: always running a build (decorative; never implies real work)
    this.wallScreens.forEach((c, i) => {
      if (OFFICE === 'lab') drawData(c.px, c.w, c.h, this.tick, i * 7)
      else drawGame(c.px, c.w, c.h, true, this.tick + i * 17)
      c.tex.refresh()
    })
    const s = store.getState()
    const night = 1 - daylight()
    const view = this.cameras.main.worldView
    this.syncWork(s)
    let typists = 0
    for (const d of this.desks) {
      const st = s.statuses[d.employeeId]
      const activity = st?.activity ?? 'idle'
      if (activity === 'working' || activity === 'testing') typists++
      const lastTool = st?.runId ? lastToolName(s.events[st.runId]) : null
      const state: MonitorState = {
        activity,
        doing: doingOf(st),
        present: this.spots.get(`desk:${d.deskId}`) === d.employeeId && !!this.characters.get(d.employeeId)?.posed && activity !== 'meeting',
        tool: lastTool,
        tick: this.tick
      }
      const dynamic = activity === 'working' || activity === 'testing' || activity === 'error' || activity === 'waiting' || !state.present
      // off-screen monitors refresh rarely; nobody is looking at them
      const visible = d.x + 48 > view.x && d.x < view.right && d.y + 48 > view.y && d.y < view.bottom
      if ((!dynamic || !visible) && this.tick % 6) continue
      const seed = d.deskId.length * 13
      drawPrimary(d.screens[0].px, d.screens[0].w, d.screens[0].h, state, seed)
      drawSecondary(d.screens[1].px, d.screens[1].w, d.screens[1].h, state, seed)
      d.screens.forEach((c) => c.tex.refresh())
      const glowA = activity === 'working' || activity === 'testing' ? 0.38 : activity === 'error' ? 0.42 : state.present ? 0.2 : 0.08
      d.glow.setAlpha(glowA * (0.35 + night * 0.65)).setTint(activity === 'error' ? 0xff5c6c : state.doing === 'debugging' ? 0xff9a5c : activity === 'waiting' ? 0xffc04a : 0x9fc8ff)
    }
    officeSound.setTypists(typists)

    const project = s.activeProjectId ? s.projects[s.activeProjectId] : null
    const tasks = Object.values(s.tasks)
    const planningRun = Object.values(s.runs).find((r) => r.kind === 'planning' && r.status === 'running')
    const steps = planningRun ? (s.events[planningRun.id] ?? []).filter((e) => e.kind === 'tool_use').length : 0
    const proposed = tasks.filter((t) => t.status === 'proposed').sort((a, b) => a.sortOrder - b.sortOrder)
    const real = tasks.filter((t) => t.status !== 'proposed')
    drawTv(this.tv.px, this.tv.w, this.tv.h, {
      mode: project?.phase === 'planning' ? 'planning' : project?.phase === 'awaiting_plan_approval' && proposed.length ? 'plan' : 'idle',
      steps,
      tasks: proposed,
      progress: real.length ? { done: real.filter((t) => t.status === 'done').length, total: real.length } : null,
      tick: this.tick,
      now: new Date(),
      board: [...real].sort((x, y) => x.sortOrder - y.sortOrder)
    })
    this.tv.tex.refresh()
    if (this.focusScreen) {
      drawFocus(this.focusScreen.px, this.focusScreen.w, this.focusScreen.h, { consult: this.consult, tick: this.tick })
      this.focusScreen.tex.refresh()
    }
    if (this.gameTv) this.drawLoungeTv(s, night)
    const m = this.microwave
    if (m && m.img.visible) {
      drawMicrowave(m.screen.px, m.screen.w, m.screen.h, this.tick, this.reduced)
      m.screen.tex.refresh()
    }
    // booth lights brighten while someone is on a call
    for (const [i, img] of this.boothFronts.entries()) img.setAlpha(this.spots.has(`phone:${i}`) ? 0.85 : 1)
  }

  private drawLoungeTv(s: AppState, night: number): void {
    const { px, w, h, tex } = this.gameTv
    if (this.time.now - this.tvSwitchedAt < 160 && !this.reduced) {
      // one frame of static while the channel changes
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.p(x, y, Math.random() < 0.5 ? '#2a2d36' : '#9aa0ad')
    } else if (this.tvChannel === 'team') {
      const real = Object.values(s.tasks).filter((t) => t.status !== 'proposed')
      drawTeamBoard(px, w, h, {
        people: s.employees.map((e) => {
          const a = s.statuses[e.id]?.activity ?? 'idle'
          return { color: ROLE_TINT[e.role] ?? '#a6accd', busy: a !== 'idle' && a !== 'meeting' }
        }),
        progress: real.length ? { done: real.filter((t) => t.status === 'done').length, total: real.length } : null,
        tick: this.tick
      })
    } else if (this.tvChannel === 'skyline') drawSkyline(px, w, h, 1 - night, this.tick, this.reduced)
    else drawGame(px, w, h, this.tvChannel === 'auto' && [...this.spots.keys()].some((k) => k.startsWith('beanbag:')), this.tick)
    tex.refresh()
  }

  // ── frame loop ──────────────────────────────────────────────

  update(time: number, delta: number): void {
    for (const q of this.sayings) this.placeSaying(q)
    for (const c of this.characters.values()) c.update(time, delta)
    this.updatePairs(time)
    this.updateVisits(time)
    this.receptionist?.update(time, delta)
    this.corgi?.update(delta)
    this.updateDoors(delta)
    for (const p of this.plants) {
      if (time < p.next) continue
      p.frame = p.frame ? 0 : 1
      p.img.setTexture(`plant:${p.kind}:${p.frame}`)
      p.next = time + (p.frame ? 600 + Math.random() * 500 : 2000 + Math.random() * 4000)
    }
    if (this.steam) this.steam.emitting = time < this.steamUntil
    this.updateRoomba(delta)

    this.updateGlide()
    if (this.followId && !this.glide && !this.drag?.moved) {
      const t = this.followPoint(this.followId)
      if (t) {
        const v = this.view
        const k = followFactor(delta)
        if (Math.abs(t.cx - v.cx) + Math.abs(t.cy - v.cy) > 0.05) this.setView({ cx: v.cx + (t.cx - v.cx) * k, cy: v.cy + (t.cy - v.cy) * k, zoom: v.zoom })
      }
    }
    this.updateOverlay()
  }
}

const WARM_GLOW = '255,201,121'

/** Warm glows for lamps and emissive props, derived from where they actually stand. */
function lampGlowMap(placements: Placement[], light: string, wallLights: { x: number; y: number }[]): HTMLCanvasElement {
  const { canvas } = makeCanvas(WORLD_W, WORLD_H)
  const ctx = canvas.getContext('2d')!
  const warm = (x: number, y: number, r: number, a: number, c = '255,196,120') => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${c},${a})`)
    g.addColorStop(1, `rgba(${c},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (const p of placements) {
    const cx = p.tx * TILE + (p.tw * TILE) / 2
    const bottom = (p.ty + p.th) * TILE
    if (p.key === 'floorLamp') warm(cx, bottom - 42, 34, 0.45, light === WARM_GLOW ? '255,196,120' : light)
    else if (p.key === 'lamp:lantern') warm(cx, bottom - 39, 30, 0.5, light === WARM_GLOW ? '255,196,120' : light)
    else if (p.key === 'lamp:arc') warm(cx - 10, bottom - 34, 32, 0.45, light === WARM_GLOW ? '255,196,120' : light)
    else if (p.key === 'lamp:mushroom') warm(cx, bottom - 20, 20, 0.5, light === WARM_GLOW ? '255,196,120' : light)
    else if (p.key === 'sideTable') warm(cx, bottom - 18, 14, 0.3)
    else if (p.key === 'aquarium') warm(cx, bottom - 26, 26, 0.35, '120,200,255')
    else if (p.key === 'arcade') warm(cx, bottom - 24, 14, 0.35, p.dx ? '120,200,255' : '255,110,190')
    else if (p.key === 'phoneBooth') warm(cx, bottom - 30, 16, 0.4)
    else if (p.key === 'coffeeBar') warm(cx, bottom - 30, 30, 0.25)
    else if (p.key === 'lightTable') warm(cx, bottom - 24, 30, 0.25, '210,235,255')
    else if (p.key === 'tvConsole' || p.key === 'displayStand') warm(cx, bottom - 30, 24, 0.18, '150,180,255')
    else if (glowFor(p.key)) {
      const [r, a, c] = glowFor(p.key)!
      warm(cx, bottom - r - 6, r, a, c)
    } else if (p.key.startsWith('desk:')) {
      const d = DESKS[p.key.slice(5)]
      if (d && (d.variant === 'pm' || d.variant === 'design')) warm(p.tx * TILE + F.DESK_LAMP.x + 2, bottom - F.DESK_H + F.DESK_LAMP.y + 2, 18, 0.5)
    }
  }
  const fw = FEATURE_WALL
  warm((fw.x + fw.w / 2) * TILE, (fw.y + 2) * TILE + 4, 70, 0.22)
  for (const w of wallLights) warm(w.x, w.y, 34, 0.55, light)
  return canvas
}

function glowBlob(w: number, h: number, color: string): HTMLCanvasElement {
  const { canvas } = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return canvas
}

function lastToolName(events: { kind: string; toolName: string | null }[] | undefined): string | null {
  if (!events) return null
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'tool_use') return events[i].toolName
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function variantFor(e: Employee): DeskVariant {
  if (e.role === 'pm') return 'pm'
  if (e.kinds.includes('qa')) return 'qa'
  if (e.capabilities.includes('ui-design') || e.capabilities.includes('frontend')) return 'design'
  return 'dev'
}

function personalFor(e: Employee): F.DeskPersonal {
  const p = personaFor(e)
  return { seed: e.id.length * 97 + e.hiredAt % 1000, mug: p.mug, item: p.item, sticky: p.sticky }
}

function parseConsultNote(note: string | null): { consultFor: string; area: 'design' | 'architecture' } | null {
  if (!note?.startsWith('{')) return null
  try {
    const n = JSON.parse(note) as { consultFor?: string; area?: 'design' | 'architecture' }
    return n.consultFor ? { consultFor: n.consultFor, area: n.area ?? 'architecture' } : null
  } catch {
    return null
  }
}

const dist = (s: { tx: number; ty: number }, p: { x: number; y: number }) => Math.hypot(s.tx * TILE - p.x, s.ty * TILE - p.y)

