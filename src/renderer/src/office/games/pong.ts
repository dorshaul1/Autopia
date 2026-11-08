// Ping pong, by the rules of the table in the play area. Pure: same state, input and time give the same result, so a
// match can be simulated in a test. Nothing here knows about the screen, the office or the project.

export const W = 240
export const H = 136
export const PADDLE_H = 26
const PADDLE_X = 12
const PADDLE_W = 4
const BALL = 3
const WIN = 5
const SERVE_MS = 900

export interface PongState {
  you: number
  them: number
  youY: number
  themY: number
  bx: number
  by: number
  vx: number
  vy: number
  /** Until this runs out, the ball waits. */
  serveIn: number
  /** Who serves next: the side that just lost the point. */
  servesLeft: boolean
  rally: number
  /** Where the opponent thinks the ball will arrive; they only look again now and then, which is what makes them beatable. */
  aim: number
  thinkIn: number
  over: boolean
  seed: number
}

export type PongEvent = 'hit' | 'wall' | 'point-you' | 'point-them' | 'win' | 'lose'

const random = (s: PongState) => {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0
  let t = s.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function newPong(seed = 1): PongState {
  return { you: 0, them: 0, youY: H / 2, themY: H / 2, bx: W / 2, by: H / 2, vx: 0, vy: 0, serveIn: SERVE_MS, servesLeft: false, rally: 0, aim: H / 2, thinkIn: 0, over: false, seed: seed >>> 0 }
}

/** Where a ball now moving at them will cross their paddle, bouncing off the edges. */
export function landing(s: Pick<PongState, 'bx' | 'by' | 'vx' | 'vy'>, targetX: number): number {
  if (!s.vx) return s.by
  const t = (targetX - s.bx) / s.vx
  if (t < 0) return H / 2
  const span = H - 2 * BALL
  let y = (s.by - BALL + s.vy * t) % (2 * span)
  if (y < 0) y += 2 * span
  return BALL + (y > span ? 2 * span - y : y)
}

const clampPaddle = (y: number) => Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, y))

/** A step of `ms`. `to` is where you want your paddle (it can't teleport). `skill` from 0 to 1 is the opponent's. */
export function stepPong(s: PongState, to: number, ms: number, base = 0.7): PongEvent[] {
  const ev: PongEvent[] = []
  if (s.over) return ev
  // they play up when you're ahead and ease off when you're behind, so matches stay close
  const skill = Math.max(0.3, Math.min(0.97, base + (s.you - s.them) * 0.07))
  const dt = ms / 1000
  const reach = 300 * dt
  s.youY = clampPaddle(s.youY + Math.max(-reach, Math.min(reach, to - s.youY)))

  s.thinkIn -= ms
  if (s.thinkIn <= 0) {
    s.thinkIn = 260 - 130 * skill
    // the longer and faster the rally, the less sure they are: that's how you beat them
    const miss = (1 - skill) * 70 * (random(s) - 0.5) * (1 + s.rally / 5)
    s.aim = (s.vx > 0 ? landing(s, W - PADDLE_X - PADDLE_W) : H / 2 + (s.by - H / 2) * 0.25) + miss
  }
  const theirs = (110 + 110 * skill) * dt
  s.themY = clampPaddle(s.themY + Math.max(-theirs, Math.min(theirs, s.aim - s.themY)))

  if (s.serveIn > 0) {
    s.serveIn -= ms
    if (s.serveIn <= 0) {
      s.vx = (s.servesLeft ? 1 : -1) * 120
      s.vy = (random(s) - 0.5) * 90
      s.rally = 0
    }
    return ev
  }
  s.bx += s.vx * dt
  s.by += s.vy * dt
  if (s.by < BALL || s.by > H - BALL) {
    s.by = s.by < BALL ? BALL : H - BALL
    s.vy = -s.vy
    ev.push('wall')
  }
  const hit = (paddleY: number, face: number, dir: 1 | -1) => {
    const near = dir > 0 ? s.bx - BALL <= face && s.bx > face - 9 : s.bx + BALL >= face && s.bx < face + 9
    if (!near || Math.abs(s.by - paddleY) > PADDLE_H / 2 + BALL) return false
    const off = (s.by - paddleY) / (PADDLE_H / 2)
    const speed = Math.min(330, Math.hypot(s.vx, s.vy) * 1.07 + 4)
    // where it lands on the paddle is where it goes: the edges send it wide
    const angle = off * 0.95
    s.vx = dir * speed * Math.cos(angle)
    s.vy = speed * Math.sin(angle)
    s.bx = face + dir * BALL
    s.rally++
    ev.push('hit')
    return true
  }
  if (s.vx < 0) hit(s.youY, PADDLE_X + PADDLE_W, 1)
  else if (s.vx > 0) hit(s.themY, W - PADDLE_X - PADDLE_W, -1)

  if (s.bx < -4 || s.bx > W + 4) {
    const youScored = s.bx > W
    if (youScored) s.you++
    else s.them++
    ev.push(youScored ? 'point-you' : 'point-them')
    s.servesLeft = !youScored
    s.bx = W / 2
    s.by = H / 2
    s.vx = s.vy = 0
    s.serveIn = SERVE_MS
    if (s.you >= WIN || s.them >= WIN) {
      s.over = true
      ev.push(s.you >= WIN ? 'win' : 'lose')
    }
  }
  return ev
}

/** The ball is gone for a moment, through nobody's fault: the point is played again. */
export function replayPoint(s: PongState): void {
  s.bx = W / 2
  s.by = H / 2
  s.vx = s.vy = 0
  s.rally = 0
  s.serveIn = SERVE_MS
}
