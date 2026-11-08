// The office receptionist: a character at the front desk. Not an employee and never given work. Everything here is
// local and token-free; only chatting with them starts a session (see shared/officeFolk.ts).
// Their panel and reactions only read state the app already has.

import { OFFICE, RECEPTION } from './layout'
import type { Appearance, Approval, Delivery, Employee, EmployeeStatus, Project, Task } from '@shared/types'

const RECEPTIONISTS = {
  startup: {
    id: 'reception:rachel',
    name: 'Rachel',
    role: 'Office manager & reception',
    appearance: {
    skin: '#c98e6b',
    hair: '#3a2420',
    hairStyle: 'long',
    shirt: '#a85f78',
    shirtAccent: '#7d4459',
    pants: '#2b2d3a',
    shoes: '#3a2a26',
    accessory: 'earrings',
    outfit: 'blazer',
    inner: '#f1e6d8'
    } satisfies Appearance
  },
  studio: {
    id: 'reception:mika',
    name: 'Mika',
    role: 'Studio manager & front desk',
    appearance: {
      skin: '#e8bf95',
      hair: '#e0457b',
      hairStyle: 'short',
      shirt: '#2e2a3d',
      shirtAccent: '#4fe3ff',
      pants: '#26232e',
      shoes: '#eeeeef',
      accessory: 'headphones',
      outfit: 'hoodie',
      inner: '#1f1d26'
    } satisfies Appearance
  },
  lab: {
    id: 'reception:nadia',
    name: 'Nadia',
    role: 'Lab coordinator & front desk',
    appearance: {
      skin: '#9a6440',
      hair: '#1f1612',
      hairStyle: 'bun',
      shirt: '#2f5d7c',
      shirtAccent: '#dfe8ee',
      pants: '#2c3446',
      shoes: '#1a1a1f',
      accessory: 'glasses',
      outfit: 'blazer',
      inner: '#f2efe8'
    } satisfies Appearance
  }
}

/** The front-desk person of an office type. */
export const receptionistFor = (type: keyof typeof RECEPTIONISTS) => RECEPTIONISTS[type] ?? RECEPTIONISTS.startup

/** The front-desk person of the office in view (each office has its own; none is on the team). */
export const RECEPTIONIST = {
  get id() {
    return RECEPTIONISTS[OFFICE].id
  },
  get name() {
    return RECEPTIONISTS[OFFICE].name
  },
  get role() {
    return RECEPTIONISTS[OFFICE].role
  },
  get appearance(): Appearance {
    return RECEPTIONISTS[OFFICE].appearance
  }
}

/** Her chair: behind the front desk, facing the lobby and the entrance. */
export const RECEPTION_SEAT = {
  get tx() {
    return RECEPTION.seat.tx
  },
  get ty() {
    return RECEPTION.seat.ty
  }
}
/** Where a visitor stands at the desk (the reception idle spot, claimed like any other). */
export const DESK_FRONT = {
  get tx() {
    return RECEPTION.front.tx
  },
  get ty() {
    return RECEPTION.front.ty
  },
  get key() {
    return RECEPTION.front.key
  }
}
/** Just inside the entrance. */
export const ENTRY = {
  get tx() {
    return RECEPTION.entry.tx
  },
  get ty() {
    return RECEPTION.entry.ty
  }
}

// ── routines ───────────────────────────────────────────────────

export type Routine = 'typing' | 'idle' | 'paperwork' | 'phone' | 'coffee' | 'tidy' | 'stretch' | 'break'

interface RoutineDef {
  weight: number
  ms: [number, number]
  /** Minimum time before the same routine can start again. */
  cooldown: number
}

export const ROUTINES: Record<Routine, RoutineDef> = {
  typing: { weight: 34, ms: [9_000, 26_000], cooldown: 0 },
  idle: { weight: 18, ms: [4_000, 10_000], cooldown: 0 },
  paperwork: { weight: 12, ms: [7_000, 15_000], cooldown: 20_000 },
  phone: { weight: 7, ms: [8_000, 18_000], cooldown: 90_000 },
  coffee: { weight: 7, ms: [5_000, 9_000], cooldown: 120_000 },
  tidy: { weight: 6, ms: [3_000, 6_000], cooldown: 60_000 },
  stretch: { weight: 4, ms: [1_600, 2_400], cooldown: 180_000 },
  // time away from the desk; the walk there and back is extra
  break: { weight: 3, ms: [20_000, 40_000], cooldown: 8 * 60_000 }
}

/** Small seeded generator: her timing is varied, reproducible in tests, and never tied to the team's. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The next thing she does at the desk: weighted, never the same routine twice in a row, respecting
 * cooldowns. She only steps away when allowed (not early on, and never while you have something to
 * decide: someone should be at the desk).
 */
export function nextRoutine(rand: () => number, now: number, lastStarted: Partial<Record<Routine, number>>, prev: Routine | null, canLeave: boolean): { kind: Routine; ms: number } {
  const options = (Object.keys(ROUTINES) as Routine[]).filter(
    (k) => k !== prev && (k !== 'break' || canLeave) && now - (lastStarted[k] ?? -Infinity) >= ROUTINES[k].cooldown
  )
  const total = options.reduce((n, k) => n + ROUTINES[k].weight, 0)
  let pick = rand() * total
  let kind = options[options.length - 1]
  for (const k of options) {
    pick -= ROUTINES[k].weight
    if (pick < 0) {
      kind = k
      break
    }
  }
  const [lo, hi] = ROUTINES[kind].ms
  return { kind, ms: Math.round(lo + rand() * (hi - lo)) }
}

// ── greetings ──────────────────────────────────────────────────

export const GREET_EACH_MS = 4 * 60_000
export const GREET_ANY_MS = 20_000

/** Whether to greet a teammate passing the desk: once in a while per person, and not constantly. */
export function shouldGreet(id: string, now: number, lastById: Map<string, number>, lastAny: number): boolean {
  return now - lastAny >= GREET_ANY_MS && now - (lastById.get(id) ?? -Infinity) >= GREET_EACH_MS
}

/** Someone is "passing reception" when walking through the lobby just in front of or beside the desk. */
export function passingDesk(x: number, y: number, tile = 16): boolean {
  const tx = x / tile
  const ty = y / tile
  return tx >= RECEPTION_SEAT.tx - 4 && tx <= RECEPTION_SEAT.tx + 5 && ty >= RECEPTION_SEAT.ty - 2 && ty <= RECEPTION_SEAT.ty + 5
}

// ── reactions to real events ───────────────────────────────────

export interface ReceptionState {
  deliveries: Pick<Delivery, 'id' | 'status'>[]
  attention: Record<string, Pick<Approval, 'status'>>
}

/** What she reacts to between two snapshots: results that just became ready, and whether you're needed. */
export function receptionEvents(prev: ReceptionState, next: ReceptionState): { resultsReady: string[]; needsYou: boolean } {
  const resultsReady = next.deliveries.filter((d) => d.status === 'review' && prev.deliveries.some((p) => p.id === d.id && p.status !== 'review')).map((d) => d.id)
  return { resultsReady, needsYou: Object.values(next.attention).some((a) => a.status === 'pending') }
}

// ── her panel: a digest of real state ──────────────────────────

export interface ReceptionDigest {
  needs: { id: string; title: string; projectId: string; project: string }[]
  ready: { id: string; number: number; request: string }[]
  finished: { id: string; label: string; who: string | null; at: number }[]
  working: { id: string; name: string; detail: string | null }[]
}

export interface DigestInput {
  attention: Record<string, Approval>
  projects: Record<string, Pick<Project, 'id' | 'name'>>
  activeProjectId: string | null
  deliveries: Pick<Delivery, 'id' | 'projectId' | 'number' | 'request' | 'status'>[]
  tasks: Record<string, Pick<Task, 'id' | 'key' | 'title' | 'status' | 'assigneeId' | 'finishedAt'>>
  employees: Pick<Employee, 'id' | 'name'>[]
  statuses: Record<string, Pick<EmployeeStatus, 'activity' | 'detail'>>
}

const first = (name: string) => name.split(' ')[0]

/** Everything the desk knows, from existing state only; empty lists mean nothing to report. */
export function receptionDigest(s: DigestInput): ReceptionDigest {
  const needs = Object.values(s.attention)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((a) => ({ id: a.id, title: a.title, projectId: a.projectId, project: s.projects[a.projectId]?.name ?? 'Project' }))
  const ready = s.deliveries
    .filter((d) => d.status === 'review' && d.projectId === s.activeProjectId)
    .map((d) => ({ id: d.id, number: d.number, request: d.request }))
  const finished = Object.values(s.tasks)
    .filter((t) => t.status === 'done' && t.finishedAt)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, 3)
    .map((t) => {
      const who = s.employees.find((e) => e.id === t.assigneeId)
      return { id: t.id, label: t.title, who: who ? first(who.name) : null, at: t.finishedAt! }
    })
  const working = s.employees
    .filter((e) => {
      const a = s.statuses[e.id]?.activity ?? 'idle'
      return a !== 'idle'
    })
    .map((e) => ({ id: e.id, name: first(e.name), detail: s.statuses[e.id]?.detail ?? null }))
  return { needs, ready, finished, working }
}
