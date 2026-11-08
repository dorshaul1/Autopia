// The office dog's mind: what it feels like doing next. Pure and deterministic for a seed; the scene
// (Corgi.ts) does the walking and posing. Not an agent, no stats, no needs to manage: "energy" is an
// internal mood so naps follow play, never something shown or asked of you.

import { DOG as LAYOUT_DOG } from './layout'

export const DOG = { id: 'office:corgi', name: 'Puffy' }

/** Her bed and bowl stand beside the front desk, on open floor (they don't block anyone's path). */
// (per office: the office in view decides where they are, or whether there is a dog at all)
let moved: { tx: number; ty: number } | null = null
/** Where this project wants his bed (null: where the office puts it). The bowl stays beside it. */
export function setDogCorner(bed: { tx: number; ty: number } | null): void {
  moved = bed
}
const at = (k: 'bed' | 'bowl' | 'ball') => {
  if (moved && k === 'bed') return moved
  if (moved && k === 'bowl') return { tx: moved.tx + 2, ty: moved.ty }
  return LAYOUT_DOG?.[k]
}
const spot = (k: 'bed' | 'bowl' | 'ball') => ({
  get tx() {
    return at(k)?.tx ?? 0
  },
  get ty() {
    return at(k)?.ty ?? 0
  }
})
export const DOG_BED = spot('bed')
export const DOG_BOWL = spot('bowl')
export const BALL_HOME = spot('ball')

export type DogBehavior = 'wander' | 'sniff' | 'follow' | 'nap' | 'napDesk' | 'toy' | 'zoomies' | 'drink' | 'visit' | 'sit'

interface Def {
  weight: number
  /** Minimum time before doing it again. */
  cooldown: number
  /** Energy it uses (negative = restores). */
  energy: number
}

export const DOG_BEHAVIORS: Record<DogBehavior, Def> = {
  wander: { weight: 24, cooldown: 0, energy: 0.06 },
  sniff: { weight: 16, cooldown: 15_000, energy: 0.04 },
  sit: { weight: 10, cooldown: 0, energy: -0.04 },
  follow: { weight: 9, cooldown: 90_000, energy: 0.1 },
  visit: { weight: 8, cooldown: 60_000, energy: 0.05 },
  drink: { weight: 5, cooldown: 120_000, energy: -0.02 },
  toy: { weight: 6, cooldown: 90_000, energy: 0.12 },
  zoomies: { weight: 3, cooldown: 6 * 60_000, energy: 0.35 },
  nap: { weight: 7, cooldown: 4 * 60_000, energy: -1 },
  napDesk: { weight: 5, cooldown: 4 * 60_000, energy: -1 }
}

export interface DogContext {
  /** Reduced motion: no zoomies (the hop and roll are skipped by the scene). */
  reduced: boolean
  /** 0 (sleepy) … 1 (bouncy). */
  energy: number
  /** Someone is really working at a desk right now (napping beside them is possible). */
  someoneWorking: boolean
  /** An idle teammate is around to follow or visit. */
  someoneIdle: boolean
}

/** Small seeded generator: varied timing that never moves in step with the team's. */
export function dogRandom(seed: number): () => number {
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
 * The next thing the dog does. Weighted, never the same twice in a row, with cooldowns. Tired dogs
 * nap more and play less; bouncy dogs play more and nap less. Zoomies need energy and full motion.
 */
export function nextDogBehavior(rand: () => number, now: number, last: Partial<Record<DogBehavior, number>>, prev: DogBehavior | null, ctx: DogContext): DogBehavior {
  const ok = (k: DogBehavior) => {
    if (k === prev) return false
    if (now - (last[k] ?? -Infinity) < DOG_BEHAVIORS[k].cooldown) return false
    if (k === 'zoomies' && (ctx.reduced || ctx.energy < 0.6)) return false
    if (k === 'napDesk' && !ctx.someoneWorking) return false
    if ((k === 'follow' || k === 'visit') && !ctx.someoneIdle) return false
    if ((k === 'nap' || k === 'napDesk') && ctx.energy > 0.75) return false
    return true
  }
  const options = (Object.keys(DOG_BEHAVIORS) as DogBehavior[]).filter(ok)
  if (!options.length) return 'sit'
  const weight = (k: DogBehavior) => {
    const w = DOG_BEHAVIORS[k].weight
    if (k === 'nap' || k === 'napDesk') return w * (1.6 - ctx.energy)
    if (k === 'zoomies' || k === 'toy' || k === 'follow') return w * (0.4 + ctx.energy)
    return w
  }
  const total = options.reduce((n, k) => n + weight(k), 0)
  let pick = rand() * total
  for (const k of options) {
    pick -= weight(k)
    if (pick < 0) return k
  }
  return options[options.length - 1]
}

/** Energy after doing something, kept in 0…1. */
export function spendEnergy(energy: number, k: DogBehavior): number {
  const e = DOG_BEHAVIORS[k].energy
  return e === -1 ? 1 : Math.min(1, Math.max(0, energy - e))
}

/** What a click does: a small happy reaction, never the same one twice in a row. */
export type DogReaction = 'pet' | 'paw' | 'tilt' | 'hop'
export function nextReaction(rand: () => number, prev: DogReaction | null, reduced: boolean): DogReaction {
  const all: DogReaction[] = reduced ? ['pet', 'paw', 'tilt'] : ['pet', 'paw', 'tilt', 'hop']
  const options = all.filter((r) => r !== prev)
  return options[Math.floor(rand() * options.length)]
}

/** A cooldown map helper: may this key happen again yet? */
export function cooled(map: Map<string, number>, key: string, now: number, ms: number): boolean {
  return now - (map.get(key) ?? -Infinity) >= ms
}
