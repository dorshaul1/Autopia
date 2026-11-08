// Live pixel content for monitors, the meeting-room TV and the kanban board.
// Everything shown here is derived from real workflow state passed in by the scene.

import type { WorkDoing } from '@shared/workActivity'
import type { EmployeeActivity, Task } from '@shared/types'
import { drawText, mix, rng, textWidth, type Px } from './art/px'

export interface MonitorState {
  activity: EmployeeActivity
  /** What the real tool events say; decides what's on screen. */
  doing?: WorkDoing | null
  present: boolean
  /** Name of the tool most recently used in the real run, e.g. "Bash", "Edit". */
  tool: string | null
  tick: number
}

const CODE_COLORS = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b', '#a6accd']

/** Left monitor: editor / review. */
export function drawPrimary(px: Px, w: number, h: number, s: MonitorState, seed: number): void {
  const { activity, present, tick } = s
  if (!present && activity === 'idle') return drawSaver(px, w, h, tick, seed)
  if (activity === 'meeting') return drawLocked(px, w, h)
  if (activity === 'error') {
    px.r(0, 0, w, h, tick % 2 ? '#5a1620' : '#7a1d2a')
    px.v(Math.floor(w / 2), 2, 4, '#ffffff').p(Math.floor(w / 2), 7, '#ffffff')
    return
  }
  if (activity === 'waiting') {
    px.r(0, 0, w, h, '#1e2230')
    px.r(1, 1, w - 2, 3, tick % 2 ? '#e8a317' : '#b47c0c')
    for (let i = 0; i < 3; i++) px.h(2, 5 + i * 2, 6 + ((i * 3) % 5), '#5a6178')
    return
  }
  if (activity === 'idle') {
    // desktop: wallpaper + a couple of windows, occasional cursor movement
    for (let y = 0; y < h; y++) px.h(0, y, w, mix('#2d3a63', '#7a5ea8', y / h))
    px.r(2, 2, 7, 5, '#e9e6f2').h(2, 2, 7, '#8a7fb0')
    px.p(10 + (tick % 3), 6 + (tick % 2), '#ffffff')
    return
  }
  if (s.doing === 'researching' || s.doing === 'reviewing') {
    // reading: a page of text, moving slowly
    px.r(0, 0, w, h, '#f4f2ee')
    const page = rng(seed + Math.floor(tick / 4))
    for (let line = 1; line < h - 1; line += 2) px.h(1, line, 3 + Math.floor(page() * (w - 5)), line === 1 + (Math.floor(tick / 2) % Math.max(1, h - 2)) ? '#2b59c3' : '#9aa3b5')
    return
  }
  // working / testing: a code editor scrolling as the real run progresses
  px.r(0, 0, w, h, '#1b1f2b')
  px.v(0, 0, h, '#262b3a')
  const r = rng(seed + tick)
  for (let line = 0; line < h - 1; line++) {
    const indent = 1 + Math.floor(r() * 3) * 2
    let x = indent + 1
    while (x < w - 1 && r() > 0.18) {
      const len = 1 + Math.floor(r() * 4)
      px.h(x, line, Math.min(len, w - 1 - x), CODE_COLORS[Math.floor(r() * CODE_COLORS.length)])
      x += len + 1
    }
  }
  if (s.tool === 'Edit' || s.tool === 'Write' || s.tool === 'MultiEdit') px.r(2 + (tick % 8), h - 2, 1, 2, '#ffffff')
  // debugging: the line that's wrong stands out
  if (s.doing === 'debugging') px.r(1, 2 + (seed % Math.max(1, h - 4)), w - 2, 1, tick % 2 ? '#ff5c6c' : '#b23a48')
}

/** Right monitor: terminal / test runner / docs, reacting to the actual tool in use. */
export function drawSecondary(px: Px, w: number, h: number, s: MonitorState, seed: number): void {
  const { activity, present, tick, tool } = s
  if (!present && activity === 'idle') return drawSaver(px, w, h, tick + 7, seed + 3)
  if (activity === 'meeting') return drawLocked(px, w, h)
  if (activity === 'error') {
    px.r(0, 0, w, h, '#14161d')
    for (let i = 0; i < 4; i++) px.h(1, 1 + i * 2, 4 + ((i * 5) % 9), i === 3 ? '#ff5c6c' : '#a6accd')
    return
  }
  if (activity === 'idle' || activity === 'waiting') {
    px.r(0, 0, w, h, '#f4f2ee')
    px.r(0, 0, w, 2, '#2b59c3')
    for (let i = 0; i < 3; i++) px.h(2, 3 + i * 2, 9 - i * 2, '#9aa3b5')
    return
  }
  px.r(0, 0, w, h, '#0e1014')
  if (activity === 'testing' || s.doing === 'testing') {
    const rows = Math.min(h - 1, 1 + (tick % (h + 3)))
    const r = rng(seed)
    for (let i = 0; i < rows; i++) {
      px.r(1, i, 2, 1, r() < 0.88 ? '#3ddc84' : '#ff5c6c')
      px.h(4, i, 3 + Math.floor(r() * 8), '#6b7280')
    }
    return
  }
  if (s.doing === 'debugging') {
    // the failure, still on screen
    for (let i = 0; i < h; i++) px.h(1, i, 3 + ((i * 5 + seed) % (w - 4)), i % 3 === 1 ? '#ff5c6c' : '#6b7280')
    return
  }
  const terminal = tool === 'Bash'
  const r = rng(seed + Math.floor(tick / (terminal ? 1 : 3)))
  for (let i = 0; i < h; i++) {
    const len = 2 + Math.floor(r() * (w - 4))
    px.h(1, i, len, terminal ? (i === h - 1 ? '#3ddc84' : '#9ca3af') : i % 3 === 0 ? '#82aaff' : '#5b6378')
  }
  if (terminal && tick % 2) px.r(2, h - 1, 2, 1, '#ffffff')
}

function drawLocked(px: Px, w: number, h: number): void {
  px.r(0, 0, w, h, '#151925')
  const cx = Math.floor(w / 2)
  px.r(cx - 2, 4, 5, 4, '#8a93a6').r(cx - 1, 2, 3, 2, '#8a93a6').p(cx, 3, '#151925').p(cx, 5, '#151925')
}

function drawSaver(px: Px, w: number, h: number, tick: number, seed: number): void {
  px.r(0, 0, w, h, '#0b0d13')
  const t = tick + seed * 3
  const x = Math.abs(((t * 1) % ((w - 3) * 2)) - (w - 3))
  const y = Math.abs(((t * 1) % ((h - 3) * 2)) - (h - 3))
  px.r(x, y, 3, 3, ['#f7c66b', '#5fb7ff', '#5ee6a8'][Math.floor(t / 12) % 3])
}

// ── meeting room TV ─────────────────────────────────────────────

export interface TvState {
  mode: 'idle' | 'planning' | 'plan'
  /** Real count of planning tool calls so far (planning mode). */
  steps: number
  tasks: Task[]
  progress: { done: number; total: number } | null
  tick: number
  /** Idle screen: the real local time and the active project's real tasks (in plan order). */
  now?: Date
  board?: Task[]
}

const KIND_COLOR: Record<string, string> = { code: '#5fb7ff', design: '#ff8fb1', qa: '#5ee6a8' }

export function drawTv(px: Px, w: number, h: number, s: TvState): void {
  px.r(0, 0, w, h, '#0f1320')
  if (s.mode === 'planning') {
    px.r(0, 0, w, 6, '#2b59c3')
    drawText(px, 'PLAN', 2, -1 + 1, '#ffffff', 1, 1)
    // one bar per real planning step, newest highlighted
    const n = Math.min(s.steps, 6)
    for (let i = 0; i < n; i++) {
      const y = 8 + i * 4
      const len = 14 + ((i * 17 + s.steps) % 40)
      px.r(3, y, 2, 2, i === n - 1 && s.tick % 2 ? '#f7c66b' : '#5ee6a8')
      px.h(7, y, len, '#a6accd').h(7, y + 1, Math.floor(len * 0.6), '#4b5370')
    }
    if (s.steps === 0) px.r(3 + (s.tick % 20), 14, 3, 2, '#f7c66b')
    return
  }
  if (s.mode === 'plan') {
    px.r(0, 0, w, 6, '#1fbf75')
    drawText(px, 'PLAN', 2, 0, '#ffffff', 1, 1)
    const cols = Math.min(s.tasks.length, 8)
    const cw = Math.floor((w - 4) / Math.max(cols, 1))
    s.tasks.slice(0, 8).forEach((t, i) => {
      px.r(2 + i * cw + 1, 9, cw - 2, h - 12, '#1c2233')
      px.r(2 + i * cw + 1, 9, cw - 2, 3, KIND_COLOR[t.kind] ?? '#a6accd')
      for (let k = 0; k < 3; k++) px.h(2 + i * cw + 2, 14 + k * 3, Math.max(2, cw - 5 - k * 2), '#5b6378')
    })
    return
  }
  // idle: a wall clock with the real local time, and the active project's tasks as a board
  drawClock(px, 15, Math.floor(h / 2), 11, s.now ?? new Date())
  const x0 = 32
  const tasks = (s.board ?? []).slice(0, 24)
  if (tasks.length) {
    tasks.forEach((t, i) => {
      const x = x0 + (i % 8) * 5
      const y = 5 + Math.floor(i / 8) * 5
      const c = KIND_COLOR[t.kind] ?? '#a6accd'
      if (t.status === 'done') px.r(x, y, 4, 4, c)
      else if (t.status === 'running' || t.status === 'merging') px.r(x, y, 4, 4, s.tick % 4 < 2 ? c : mix(c, '#0f1320', 0.45))
      else if (t.status === 'failed') px.r(x, y, 4, 4, '#ff5c6c')
      else px.outlineRect(x, y, 4, 4, mix(c, '#0f1320', 0.5))
    })
  } else {
    for (let i = 0; i < 3; i++) px.p(x0 + 18 + i * 3, 12, i === s.tick % 3 ? '#56d4ef' : '#4b5370')
  }
  const bw = w - x0 - 4
  px.r(x0, h - 6, bw, 2, '#262b3a')
  if (s.progress && s.progress.total) px.r(x0, h - 6, Math.round((bw * s.progress.done) / s.progress.total), 2, '#5ee6a8')
}

/** A small analog clock face (the pixel font has no digits). */
function drawClock(px: Px, cx: number, cy: number, r: number, now: Date): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y)
      if (d <= r - 1) px.p(cx + x, cy + y, '#161b2b')
      else if (d <= r + 0.3) px.p(cx + x, cy + y, '#4b5370')
    }
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    px.p(Math.round(cx + Math.sin(a) * (r - 3)), Math.round(cy - Math.cos(a) * (r - 3)), k % 3 === 0 ? '#c9d2e3' : '#5b6378')
  }
  const hand = (turns: number, len: number, c: string) => {
    const a = turns * Math.PI * 2
    for (let i = 1; i <= len; i++) px.p(Math.round(cx + Math.sin(a) * i), Math.round(cy - Math.cos(a) * i), c)
  }
  const m = now.getMinutes()
  hand(((now.getHours() % 12) + m / 60) / 12, r - 6, '#ffffff')
  hand(m / 60, r - 3, '#56d4ef')
  px.p(cx, cy, '#ffffff')
}

// ── kanban board ────────────────────────────────────────────────

export function drawKanban(px: Px, w: number, h: number, tasks: Task[]): void {
  px.r(0, 0, w, h, '#fbfaf6')
  const cw = Math.floor(w / 3)
  px.v(cw, 1, h - 2, '#d8d4ca').v(cw * 2, 1, h - 2, '#d8d4ca')
  px.h(1, 3, cw - 2, '#9aa3b5').h(cw + 1, 3, cw - 2, '#e8a317').h(cw * 2 + 1, 3, cw - 2, '#1fbf75')
  const col = (t: Task) =>
    t.status === 'done' || t.status === 'cancelled' ? 2 : t.status === 'running' || t.status === 'merging' || t.status === 'failed' ? 1 : 0
  const counts = [0, 0, 0]
  for (const t of tasks) {
    const c = col(t)
    const i = counts[c]++
    if (i >= 6) continue
    const x = c * cw + 2 + (i % 2) * 6
    const y = 6 + Math.floor(i / 2) * 6
    const color = t.status === 'failed' ? '#ff5c6c' : KIND_COLOR[t.kind] ?? '#ffd23f'
    px.r(x, y, 5, 5, color).h(x, y, 5, mix(color, '#ffffff', 0.4))
  }
}

// ── milestone board (engineering wall) ──────────────────────────

export interface RoadmapRow {
  /** 0 new … 4 shipped; blocked rows are tinted red. */
  stage: number
  blocked: boolean
  /** Real task progress for rows where it is known. */
  progress: { done: number; total: number } | null
  active: boolean
}

const STAGE_COLOR = ['#9aa3b5', '#2b59c3', '#e8a317', '#7a4fb0', '#1fbf75']

/** One row per project (most recent first): milestone pips plan → approve → build → verify → ship. */
export function drawRoadmap(px: Px, w: number, h: number, rows: RoadmapRow[]): void {
  px.r(0, 0, w, h, '#fbfcfd')
  for (let x = 2; x < w; x += 6) px.p(x, 1, '#e4e8ee')
  if (!rows.length) {
    drawText(px, 'PLAN', Math.floor((w - textWidth('PLAN')) / 2), Math.floor(h / 2) - 3, '#c4cad4')
    return
  }
  const rh = Math.floor((h - 2) / Math.min(4, rows.length))
  rows.slice(0, 4).forEach((r, i) => {
    const y = 2 + i * rh
    if (r.active) px.r(0, y - 1, 2, rh - 1, '#f7c66b')
    for (let k = 0; k < 5; k++) {
      const x = 4 + k * 8
      const done = k < r.stage
      const now = k === r.stage
      const c = r.blocked && now ? '#e04f5f' : done || now ? STAGE_COLOR[k] : '#dfe3e8'
      px.r(x, y + 1, 4, 4, c)
      if (now) px.outlineRect(x - 1, y, 6, 6, r.blocked ? '#e04f5f' : '#2b2e38')
      if (k < 4) px.h(x + 4, y + 3, 4, done ? '#9aa3b5' : '#e4e8ee')
    }
    if (r.progress && r.progress.total) {
      const bx = 46
      const bw = w - bx - 3
      px.r(bx, y + 2, bw, 2, '#e4e8ee').r(bx, y + 2, Math.round((bw * r.progress.done) / r.progress.total), 2, '#1fbf75')
    }
  })
}

// ── focus room display ──────────────────────────────────────────

export interface FocusState {
  /** Role colours of the consultant and the asker during a real consultation. */
  consult: { a: string; b: string; area: 'design' | 'architecture' } | null
  tick: number
}

export function drawFocus(px: Px, w: number, h: number, s: FocusState): void {
  px.r(0, 0, w, h, '#0f1320')
  if (!s.consult) {
    drawText(px, 'FREE', Math.floor((w - textWidth('FREE')) / 2), 4, '#5ee6a8')
    px.h(4, h - 3, w - 8, '#262b3a')
    return
  }
  px.r(0, 0, w, 3, s.consult.area === 'design' ? '#ff8fb1' : '#5fb7ff')
  px.r(3, 6, 6, 6, s.consult.a).r(w - 9, 6, 6, 6, s.consult.b)
  // the question travelling between them
  const t = s.tick % (w - 20)
  px.r(10 + t, 8, 2, 2, '#f7c66b')
  px.h(10, 13, w - 20, '#4b5370')
}

// ── game-corner TV (cosmetic) ───────────────────────────────────

export function drawGame(px: Px, w: number, h: number, playing: boolean, tick: number): void {
  if (!playing) {
    px.r(0, 0, w, h, '#0b0d13')
    px.p(w - 3, h - 2, tick % 6 < 3 ? '#e04f5f' : '#5a1620')
    return
  }
  for (let y = 0; y < h; y++) px.h(0, y, w, mix('#2d3a63', '#7a5ea8', y / h))
  px.r(0, h - 5, w, 5, '#3a7d44').h(0, h - 5, w, '#5ea24f')
  const x = (tick * 2) % (w + 10) - 5
  px.r(x, h - 10, 4, 5, '#ffd23f').p(x + 1, h - 9, '#251a18')
  for (let i = 0; i < 3; i++) {
    const cx = (i * 19 + w - ((tick * 3) % w)) % w
    px.r(cx, 4 + i * 3, 6, 2, '#eef1f5')
  }
}

// ── lounge TV channels (chosen by the founder) ──────────────────

export type LoungeChannel = 'auto' | 'team' | 'skyline' | 'off'
export const LOUNGE_CHANNELS: { id: LoungeChannel; label: string }[] = [
  { id: 'auto', label: 'Game' },
  { id: 'team', label: 'Team' },
  { id: 'skyline', label: 'Skyline' },
  { id: 'off', label: 'Off' }
]

export interface TeamBoard {
  /** One entry per teammate: their role colour and whether they are on real work right now. */
  people: { color: string; busy: boolean }[]
  /** Real task progress of the active project, if there is one. */
  progress: { done: number; total: number } | null
  tick: number
}

/** Team channel: who is really working, and the active project's real progress. Nothing invented. */
export function drawTeamBoard(px: Px, w: number, h: number, s: TeamBoard): void {
  // no labels (the pixel font is too coarse here): a filled tile is a teammate on real work
  px.r(0, 0, w, h, '#0f1320')
  px.h(0, 0, w, '#56d4ef').h(0, 1, w, '#1c2233')
  const n = s.people.length
  const gap = Math.min(6, Math.floor((w - 4) / Math.max(n, 1)))
  const x0 = Math.floor((w - gap * n) / 2) + 1
  s.people.forEach((p, i) => {
    const x = x0 + i * gap
    if (p.busy) px.r(x, 7, 4, 4, p.color).h(x, 7, 4, mix(p.color, '#ffffff', 0.4))
    else px.outlineRect(x, 7, 4, 4, mix(p.color, '#0f1320', 0.55))
    if (p.busy && s.tick % 4 < 2) px.h(x, 12, 4, mix(p.color, '#0f1320', 0.5))
  })
  const bw = w - 8
  px.r(4, h - 6, bw, 2, '#262b3a')
  if (s.progress && s.progress.total) px.r(4, h - 6, Math.round((bw * s.progress.done) / s.progress.total), 2, '#5ee6a8')
}

/** Skyline channel: a calm city view that follows the office's own daylight (0 night … 1 day). */
export function drawSkyline(px: Px, w: number, h: number, light: number, tick: number, still: boolean): void {
  const top = mix('#0b1026', '#7fb6e6', light)
  const bottom = mix('#2a2350', '#d9ecf7', light)
  for (let y = 0; y < h; y++) px.h(0, y, w, mix(top, bottom, y / h))
  if (light < 0.4) for (let i = 0; i < 9; i++) px.p((i * 23 + 5) % w, (i * 7) % Math.floor(h / 2), '#cfd6f5')
  else px.r(w - 12, 3, 4, 4, '#fff1c8')
  const r = rng(91)
  let x = 0
  while (x < w) {
    const bw = 4 + Math.floor(r() * 6)
    const bh = 6 + Math.floor(r() * (h - 9))
    const body = mix('#151a2e', '#55657e', light)
    px.r(x, h - bh, bw - 1, bh, body)
    for (let wy = h - bh + 2; wy < h - 1; wy += 3) {
      for (let wx = x + 1; wx < x + bw - 2; wx += 2) {
        // a few windows switch slowly at night; still under reduced motion
        const lit = r() < 0.35 !== (!still && light < 0.5 && (wx * 7 + wy * 3 + Math.floor(tick / 20)) % 29 === 0)
        if (lit && light < 0.6) px.p(wx, wy, '#ffd98a')
      }
    }
    x += bw
  }
}

/** Microwave window: warm interior with the plate turning while it runs. */
export function drawMicrowave(px: Px, w: number, h: number, tick: number, still: boolean): void {
  px.r(0, 0, w, h, '#f2b24a')
  px.r(1, 1, w - 2, h - 2, '#f7c46a')
  const cx = Math.floor(w / 2)
  px.h(cx - 4, h - 2, 9, '#d18a2c')
  const f = still ? 0 : tick % 4
  // a bowl on the turntable, its handle-side highlight moving round
  px.r(cx - 2, h - 5, 5, 3, '#fbfbf7').h(cx - 2, h - 5, 5, '#e8e2d6')
  px.p(cx - 2 + [0, 2, 4, 2][f], h - 4, '#d76b4a')
}
