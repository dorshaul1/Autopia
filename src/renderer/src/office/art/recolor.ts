// Material recolouring: an office's version of a shared piece keeps the original drawing (its shape,
// detail and the anchor points the scene overlays onto) and swaps its materials ramp for ramp. Pixels
// that were derived from a ramp (a selective outline, a shaded seam) follow their nearest ramp step,
// so lighting and outlines stay consistent. Unmatched colours (screens, labels, small accents) stay.

import { hex, rgb, type RGB } from './px'
import type { Ramp } from './palette'

export type MaterialMap = [from: Ramp, to: Ramp][]

const STEPS = ['hi', 'base', 'mid', 'lo'] as const

interface Swatch {
  from: RGB
  to: RGB
}

const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** Recolours a canvas in place; returns it. `tolerance` is the summed RGB distance a derived shade may sit from its step. */
export function recolor(canvas: HTMLCanvasElement, map: MaterialMap, tolerance = 54): HTMLCanvasElement {
  const swatches: Swatch[] = map.flatMap(([from, to]) => STEPS.map((k) => ({ from: hex(from[k]), to: hex(to[k]) })))
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const cache = new Map<number, RGB | null>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
    let out = cache.get(key)
    if (out === undefined) {
      const c: RGB = [d[i], d[i + 1], d[i + 2]]
      let best: Swatch | null = null
      let bd = Infinity
      for (const s of swatches) {
        const k = dist(c, s.from)
        if (k < bd) (bd = k), (best = s)
      }
      // keep the pixel's offset from its step (a darker seam stays darker), scaled to the new material
      out = best && bd <= tolerance ? ([0, 1, 2].map((j) => clamp(best!.to[j] + (c[j] - best!.from[j]) * 0.85)) as RGB) : null
      cache.set(key, out)
    }
    if (out) {
      d[i] = out[0]
      d[i + 1] = out[1]
      d[i + 2] = out[2]
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** A ramp from four hex values (hi, base, mid, lo). */
export const ramp = (hi: string, base: string, mid: string, lo: string): Ramp => ({ hi, base, mid, lo })

/** Hex of an RGB triple (re-exported for art packs). */
export const toHex = rgb
