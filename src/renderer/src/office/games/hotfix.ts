// Hotfix, the game inside the office's arcade cabinet. Bugs crawl down towards production; you run along the bottom
// firing patches up the lanes. Coffee drifts down too: don't patch it, catch it, and everything slows for a while. Pure.

export const HW = 240
export const HH = 136
export const LANES = 6
const PROD_Y = HH - 16
const LANE_W = HW / LANES
export const laneX = (lane: number) => LANE_W * lane + LANE_W / 2

export type BugKind = 'bug' | 'fast' | 'flaky' | 'coffee'

export interface Bug {
  id: number
  kind: BugKind
  x: number
  y: number
  lane: number
  hops: number
}

export interface HotfixState {
  lane: number
  /** You run along the line, one lane at a time: being in the wrong place costs something. */
  moveIn: number
  bugs: Bug[]
  patches: { x: number; y: number }[]
  score: number
  lives: number
  elapsed: number
  spawnIn: number
  reload: number
  calm: number
  over: boolean
  nextId: number
  /** The cabinet's secret difficulty: same game, gentler pace. */
  decaf: boolean
  seed: number
}

export type HotfixEvent = 'fire' | 'squash' | 'coffee' | 'spill' | 'miss' | 'over'

const random = (s: HotfixState) => {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0
  let t = s.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function newHotfix(seed = 1, decaf = false): HotfixState {
  return { lane: Math.floor(LANES / 2), moveIn: 0, bugs: [], patches: [], score: 0, lives: 3, elapsed: 0, spawnIn: 500, reload: 0, calm: 0, over: false, nextId: 1, decaf, seed: seed >>> 0 }
}

const pace = (s: HotfixState) => (1 + s.elapsed / 40_000) * (s.decaf ? 0.65 : 1) * (s.calm > 0 ? 0.45 : 1)

/** A step of `ms`. `lane` is where you want to be; `fire` is held or pressed. */
export function stepHotfix(s: HotfixState, lane: number, fire: boolean, ms: number): HotfixEvent[] {
  const ev: HotfixEvent[] = []
  if (s.over) return ev
  s.elapsed += ms
  s.calm = Math.max(0, s.calm - ms)
  s.reload = Math.max(0, s.reload - ms)
  s.moveIn = Math.max(0, s.moveIn - ms)
  const want = Math.max(0, Math.min(LANES - 1, Math.round(lane)))
  if (want !== s.lane && !s.moveIn) {
    s.lane += Math.sign(want - s.lane)
    s.moveIn = 85
  }
  const dt = ms / 1000

  if (fire && !s.reload) {
    s.patches.push({ x: laneX(s.lane), y: PROD_Y - 6 })
    s.reload = 230
    ev.push('fire')
  }
  for (const p of s.patches) p.y -= 210 * dt
  s.patches = s.patches.filter((p) => p.y > -4)

  s.spawnIn -= ms
  if (s.spawnIn <= 0) {
    const r = random(s)
    const kind: BugKind = r < 0.09 ? 'coffee' : s.elapsed > 12_000 && r < 0.3 ? 'fast' : s.elapsed > 22_000 && r < 0.48 ? 'flaky' : 'bug'
    const l = Math.floor(random(s) * LANES)
    s.bugs.push({ id: s.nextId++, kind, x: laneX(l), y: -6, lane: l, hops: 0 })
    s.spawnIn = Math.max(190, 1050 - s.elapsed / 60) / (s.decaf ? 0.7 : 1)
  }

  const k = pace(s)
  for (const b of s.bugs) {
    b.y += (b.kind === 'fast' ? 40 : b.kind === 'coffee' ? 24 : 21) * k * dt
    // flaky bugs change their mind about which lane they're in
    if (b.kind === 'flaky' && b.hops < 2 && b.y > 26 + b.hops * 34) {
      b.lane = Math.max(0, Math.min(LANES - 1, b.lane + (random(s) < 0.5 ? -1 : 1)))
      b.hops++
    }
    b.x += (laneX(b.lane) - b.x) * Math.min(1, 7 * dt)
  }

  for (const p of s.patches) {
    const b = s.bugs.find((x) => Math.abs(x.x - p.x) < 11 && Math.abs(x.y - p.y) < 9)
    if (!b) continue
    p.y = -99
    s.bugs = s.bugs.filter((x) => x !== b)
    if (b.kind === 'coffee') ev.push('spill')
    else {
      s.score += b.kind === 'bug' ? 10 : 25
      ev.push('squash')
    }
  }
  s.patches = s.patches.filter((p) => p.y > -4)

  for (const b of [...s.bugs]) {
    if (b.y < PROD_Y) continue
    s.bugs = s.bugs.filter((x) => x !== b)
    if (b.kind === 'coffee') {
      if (b.lane === s.lane) {
        s.calm = 6000
        ev.push('coffee')
      }
      continue
    }
    s.lives--
    ev.push('miss')
    if (s.lives <= 0) {
      s.over = true
      ev.push('over')
      break
    }
  }
  return ev
}
