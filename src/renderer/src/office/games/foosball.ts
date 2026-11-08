// Table football: two rods each, one stick for both of yours, one button to kick. Pure, like the ping pong.

export const FW = 240
export const FH = 136
const WIN = 3
export const GOAL_H = 62
const BALL = 3
const MAN_H = 8
const MAN_W = 5
const KICK_MS = 170
const SERVE_MS = 800

export interface Rod {
  x: number
  /** Which way this rod plays. */
  dir: 1 | -1
  /** Where each man stands, relative to the rod's position. */
  men: number[]
  yours: boolean
}

export const RODS: Rod[] = [
  { x: 20, dir: 1, men: [0], yours: true },
  { x: 74, dir: -1, men: [-34, 0, 34], yours: false },
  { x: 166, dir: 1, men: [-34, 0, 34], yours: true },
  { x: 220, dir: -1, men: [0], yours: false }
]

export interface FoosState {
  you: number
  them: number
  /** Rod position, from the middle of the table. */
  youY: number
  themY: number
  bx: number
  by: number
  vx: number
  vy: number
  youKick: number
  themKick: number
  themCool: number
  /** Where they last decided to put the rod: nobody tracks a shot perfectly. */
  themAim: number
  themThink: number
  serveIn: number
  stuck: number
  over: boolean
  seed: number
}

export type FoosEvent = 'kick' | 'wall' | 'man' | 'goal-you' | 'goal-them' | 'win' | 'lose'

const random = (s: FoosState) => {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0
  let t = s.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function newFoos(seed = 1): FoosState {
  return { you: 0, them: 0, youY: 0, themY: 0, bx: FW / 2, by: FH / 2, vx: 0, vy: 0, youKick: 0, themKick: 0, themCool: 0, themAim: 0, themThink: 0, serveIn: SERVE_MS, stuck: 0, over: false, seed: seed >>> 0 }
}

const slide = (y: number) => Math.max(-30, Math.min(30, y))

/** A step of `ms`. `to` is where you want your rods, -30 to 30. `kick` is pressed this step. */
export function stepFoos(s: FoosState, to: number, kick: boolean, ms: number, base = 0.6): FoosEvent[] {
  const ev: FoosEvent[] = []
  if (s.over) return ev
  // they play up when you're ahead and ease off when you're behind
  const skill = Math.max(0.25, Math.min(0.95, base + (s.you - s.them) * 0.1))
  const dt = ms / 1000
  const reach = 230 * dt
  s.youY = slide(s.youY + Math.max(-reach, Math.min(reach, to - s.youY)))
  s.youKick = Math.max(0, s.youKick - ms)
  s.themKick = Math.max(0, s.themKick - ms)
  s.themCool = Math.max(0, s.themCool - ms)
  if (kick && !s.youKick) {
    s.youKick = KICK_MS
    ev.push('kick')
  }

  // they line up the rod nearest the ball with it, and kick when it comes in range
  const near = RODS.filter((r) => !r.yours).sort((a, b) => Math.abs(a.x - s.bx) - Math.abs(b.x - s.bx))[0]
  const man = near.men.reduce((best, m) => (Math.abs(s.by - FH / 2 - m - s.themY) < Math.abs(s.by - FH / 2 - best - s.themY) ? m : best), near.men[0])
  s.themThink -= ms
  if (s.themThink <= 0) {
    s.themThink = 240 - 120 * skill
    s.themAim = s.by - FH / 2 - man + (1 - skill) * 40 * (random(s) - 0.5)
  }
  const theirs = (60 + 75 * skill) * dt
  s.themY = slide(s.themY + Math.max(-theirs, Math.min(theirs, s.themAim - s.themY)))
  if (!s.themKick && !s.themCool && Math.abs(s.bx - near.x) < 16 + 10 * skill && s.bx > near.x - 4) {
    s.themKick = KICK_MS
    s.themCool = 520 - 260 * skill
    ev.push('kick')
  }

  if (s.serveIn > 0) {
    s.serveIn -= ms
    if (s.serveIn <= 0) {
      s.vx = (random(s) < 0.5 ? -1 : 1) * 70
      s.vy = (random(s) - 0.5) * 70
    }
    return ev
  }

  s.bx += s.vx * dt
  s.by += s.vy * dt
  // felt slows it, but never to a dead stop for long
  const drag = Math.pow(0.5, dt / 2.6)
  s.vx *= drag
  s.vy *= drag

  if (s.by < BALL || s.by > FH - BALL) {
    s.by = s.by < BALL ? BALL : FH - BALL
    s.vy = -s.vy * 0.9
    ev.push('wall')
  }
  const mouth = Math.abs(s.by - FH / 2) < GOAL_H / 2 - BALL
  if (!mouth && (s.bx < BALL || s.bx > FW - BALL)) {
    s.bx = s.bx < BALL ? BALL : FW - BALL
    s.vx = -s.vx * 0.9
    ev.push('wall')
  }

  for (const rod of RODS) {
    const rodY = FH / 2 + (rod.yours ? s.youY : s.themY)
    const kicking = (rod.yours ? s.youKick : s.themKick) > 0
    for (const m of rod.men) {
      const y = rodY + m
      if (Math.abs(s.bx - rod.x) > MAN_W + BALL || Math.abs(s.by - y) > MAN_H / 2 + BALL + 1) continue
      const off = (s.by - y) / (MAN_H / 2 + BALL)
      if (kicking) {
        const speed = 235 + 40 * Math.abs(off)
        s.vx = rod.dir * speed * Math.cos(off * 0.8)
        s.vy = speed * Math.sin(off * 0.8)
        s.bx = rod.x + rod.dir * (MAN_W + BALL + 1)
        ev.push('man')
      } else if (Math.sign(s.vx || rod.dir) !== rod.dir || Math.abs(s.vx) < 20) {
        // the ball comes off a standing man, a little deadened
        s.vx = rod.dir * Math.max(40, Math.abs(s.vx) * 0.7)
        s.vy += off * 40
        s.bx = rod.x + rod.dir * (MAN_W + BALL + 1)
        ev.push('man')
      }
    }
  }

  // nowhere near anyone and barely moving: the table gets a nudge, as real ones do
  if (Math.hypot(s.vx, s.vy) < 14) {
    s.stuck += ms
    if (s.stuck > 900) {
      s.stuck = 0
      s.vx = (s.bx < FW / 2 ? 1 : -1) * (50 + random(s) * 25)
      s.vy = (random(s) - 0.5) * 60
    }
  } else s.stuck = 0

  if (s.bx < -3 || s.bx > FW + 3) {
    const yours = s.bx > FW
    if (yours) s.you++
    else s.them++
    ev.push(yours ? 'goal-you' : 'goal-them')
    s.bx = FW / 2
    s.by = FH / 2
    s.vx = s.vy = 0
    s.serveIn = SERVE_MS
    if (s.you >= WIN || s.them >= WIN) {
      s.over = true
      ev.push(s.you >= WIN ? 'win' : 'lose')
    }
  }
  return ev
}
