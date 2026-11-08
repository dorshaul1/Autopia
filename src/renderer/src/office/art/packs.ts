// Office art packs: which drawing each office uses for a piece, its desk and chair, floors and
// walls, and its logo wall. The Tech Startup uses the original art untouched; other offices supply
// their own pieces and recolour shared drawings through their material map.

import { OFFICE } from '../layout'
import { STARTUP_FEATURE, featureWall, paintBackground } from './environment'
import { DECOR_FACTORIES, PERSONAL_KEYS } from './decor'
import * as F from './furniture'
import { LAB_WALL, LAB_FACTORIES, LAB_FEATURE, LAB_GLOW, LAB_KEEP, labChair, labDesk, labRecolor, paintLabBackground } from './lab'
import { M, type Ramp } from './palette'
import { STUDIO_WALL, STUDIO_FACTORIES, STUDIO_FEATURE, STUDIO_GLOW, STUDIO_KEEP, gamingChair, glowTable, paintStudioBackground, rigDesk, studioRecolor } from './studio'

/** The drawing for a placement key in the office in view. */
export function artFor(key: string): () => HTMLCanvasElement {
  if ((PERSONAL_KEYS as readonly string[]).includes(key)) return DECOR_FACTORIES[key]
  const base = F.FACTORIES[key] ?? DECOR_FACTORIES[key]
  if (OFFICE === 'studio') {
    if (STUDIO_FACTORIES[key]) return STUDIO_FACTORIES[key]
    if (key === 'pingpong') return () => glowTable(base())
    if (base && !STUDIO_KEEP.has(key)) return () => studioRecolor(base())
  }
  if (OFFICE === 'lab') {
    if (LAB_FACTORIES[key]) return LAB_FACTORIES[key]
    if (base && !LAB_KEEP.has(key)) return () => labRecolor(base())
  }
  if (!base) throw new Error(`No art for ${key}`)
  return base
}

/** A floor piece's drawing, on its own (plants sway between two frames; this is the first). */
export function decorArt(key: string): HTMLCanvasElement {
  return key.startsWith('plant:') ? F.plant(key.slice(6) as Parameters<typeof F.plant>[0], 0) : artFor(key)()
}

export function deskArt(variant: Parameters<typeof F.desk>[0], personal?: F.DeskPersonal): HTMLCanvasElement {
  const d = F.desk(variant, personal)
  return OFFICE === 'studio' ? rigDesk(d) : OFFICE === 'lab' ? labDesk(d) : d
}

export function chairArt(away: boolean): HTMLCanvasElement {
  const c = F.officeChair(away)
  return OFFICE === 'studio' ? gamingChair(away, c) : OFFICE === 'lab' ? labChair(c) : c
}

export function backgroundArt(accent: Ramp): HTMLCanvasElement {
  return OFFICE === 'studio' ? paintStudioBackground(accent) : OFFICE === 'lab' ? paintLabBackground(accent) : paintBackground(accent)
}

export function featureArt(): ReturnType<typeof featureWall> {
  return featureWall(OFFICE === 'studio' ? STUDIO_FEATURE : OFFICE === 'lab' ? LAB_FEATURE : STARTUP_FEATURE)
}

/** How strongly the sign lights its surroundings. */
export const signGlowStrength = (): number => (OFFICE === 'studio' ? STUDIO_FEATURE : OFFICE === 'lab' ? LAB_FEATURE : STARTUP_FEATURE).glow ?? 0.5

/** Interior walls take the office's own material, so a dark studio has no cream walls in it. */
export const wallPlaster = (): Ramp => (OFFICE === 'studio' ? STUDIO_WALL : OFFICE === 'lab' ? LAB_WALL : M.plaster)

/** Extra emissive glow for office-specific pieces: [radius, intensity, rgb] or null. */
export function glowFor(key: string): [number, number, string] | null {
  return OFFICE === 'studio' ? (STUDIO_GLOW[key] ?? null) : OFFICE === 'lab' ? (LAB_GLOW[key] ?? null) : null
}
