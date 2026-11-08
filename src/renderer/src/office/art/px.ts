// Tiny pixel painter used to author every texture procedurally at 1 art-pixel = 1 canvas pixel.

export type RGB = [number, number, number]

export function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgb([r, g, b]: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Lighten (amt > 0) or darken (amt < 0), with a slight hue shift for richer pixel-art ramps. */
export function shade(c: string, amt: number): string {
  const [r, g, b] = hex(c)
  if (amt >= 0) return rgb([r + (255 - r) * amt, g + (255 - g) * amt * 0.96, b + (255 - b) * amt * 0.85])
  const k = 1 + amt
  return rgb([r * k * 0.97, g * k * 0.98, b * k * 1.04 + 4 * -amt])
}

export function mix(a: string, b: string, t: number): string {
  const A = hex(a)
  const B = hex(b)
  return rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}

/** Deterministic PRNG so the office looks identical every launch. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Px {
  constructor(public ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false
  }

  r(x: number, y: number, w: number, h: number, c: string): this {
    if (w <= 0 || h <= 0) return this
    this.ctx.fillStyle = c
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
    return this
  }

  drawImage(art: HTMLCanvasElement, x: number, y: number): this {
    this.ctx.drawImage(art, x, y)
    return this
  }

  p(x: number, y: number, c: string): this {
    return this.r(x, y, 1, 1, c)
  }

  h(x: number, y: number, w: number, c: string): this {
    return this.r(x, y, w, 1, c)
  }

  v(x: number, y: number, h: number, c: string): this {
    return this.r(x, y, 1, h, c)
  }

  alpha(a: number, fn: () => void): this {
    const prev = this.ctx.globalAlpha
    this.ctx.globalAlpha = a
    fn()
    this.ctx.globalAlpha = prev
    return this
  }

  /** Bevelled block: fill with 1px highlight on top/left and shadow on bottom/right. */
  bevel(x: number, y: number, w: number, h: number, c: string, opts: { outline?: string; light?: number; dark?: number } = {}): this {
    const light = shade(c, opts.light ?? 0.18)
    const dark = shade(c, -(opts.dark ?? 0.22))
    this.r(x, y, w, h, c)
    this.h(x, y, w, light)
    this.v(x, y, h, light)
    this.h(x, y + h - 1, w, dark)
    this.v(x + w - 1, y, h, dark)
    if (opts.outline) this.outlineRect(x - 1, y - 1, w + 2, h + 2, opts.outline)
    return this
  }

  outlineRect(x: number, y: number, w: number, h: number, c: string): this {
    this.h(x, y, w, c)
    this.h(x, y + h - 1, w, c)
    this.v(x, y, h, c)
    this.v(x + w - 1, y, h, c)
    return this
  }

  /** Rounded rect with 1px corner cut (the classic pixel-art soft corner). */
  round(x: number, y: number, w: number, h: number, c: string): this {
    this.r(x + 1, y, w - 2, h, c)
    this.r(x, y + 1, w, h - 2, c)
    return this
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): this {
    for (let y = -ry; y <= ry; y++) {
      const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1))))
      this.h(cx - span, cy + y, span * 2 + 1, c)
    }
    return this
  }

  /** Adds a 1px outline around every opaque pixel in the region (crisp sprite silhouettes). */
  silhouette(x: number, y: number, w: number, h: number, c: string, alphaThreshold = 40): this {
    const img = this.ctx.getImageData(x, y, w, h)
    const d = img.data
    const solid = (ix: number, iy: number) => ix >= 0 && iy >= 0 && ix < w && iy < h && d[(iy * w + ix) * 4 + 3] > alphaThreshold
    const mark: number[] = []
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        if (solid(ix, iy)) continue
        if (solid(ix - 1, iy) || solid(ix + 1, iy) || solid(ix, iy - 1) || solid(ix, iy + 1)) mark.push(ix, iy)
      }
    }
    this.ctx.fillStyle = c
    for (let i = 0; i < mark.length; i += 2) this.ctx.fillRect(x + mark[i], y + mark[i + 1], 1, 1)
    return this
  }
}

/**
 * Selective outline ("selout"): every transparent pixel touching the sprite takes the color of its
 * darkest opaque neighbor, darkened further. Reads crisp without the clip-art look of pure black.
 */
export function selout(px: Px, x: number, y: number, w: number, h: number, darken = 0.5, threshold = 40): void {
  const ctx = px.ctx
  const img = ctx.getImageData(x, y, w, h)
  const d = img.data
  const out = new Uint8ClampedArray(d)
  const at = (ix: number, iy: number) => (iy * w + ix) * 4
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      if (d[at(ix, iy) + 3] > threshold) continue
      let best = -1
      let lum = 1e9
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = ix + dx
        const ny = iy + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const i = at(nx, ny)
        if (d[i + 3] <= threshold) continue
        const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11
        if (l < lum) {
          lum = l
          best = i
        }
      }
      if (best < 0) continue
      const o = at(ix, iy)
      const k = 1 - darken
      out[o] = d[best] * k * 0.92
      out[o + 1] = d[best + 1] * k * 0.92
      out[o + 2] = Math.min(255, d[best + 2] * k * 1.05 + 6)
      out[o + 3] = 255
    }
  }
  img.data.set(out)
  ctx.putImageData(img, x, y)
}

/**
 * A 3/4-view block: lit top plane, base-colored front face with a darker foot, per the art direction.
 * (x, y) is the top-left of the top plane; the front face hangs below it.
 */
export function block(
  px: Px,
  x: number,
  y: number,
  w: number,
  topH: number,
  frontH: number,
  r: { hi: string; base: string; mid: string; lo: string },
  opts: { rim?: boolean } = {}
): void {
  px.r(x, y, w, topH, r.hi)
  px.r(x, y + topH, w, frontH, r.base)
  if (frontH > 2) px.r(x, y + topH + frontH - 1, w, 1, r.mid)
  if (opts.rim !== false) px.h(x, y + topH, w, r.mid)
}

/** 50% checker dither between the current pixels and a color, for soft gradients. */
export function dither(px: Px, x: number, y: number, w: number, h: number, c: string, phase = 0): void {
  for (let iy = 0; iy < h; iy++) for (let ix = (iy + phase) & 1; ix < w; ix += 2) px.p(x + ix, y + iy, c)
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; px: Px } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return { canvas, px: new Px(ctx) }
}

// 5x7 pixel font for signage.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '10101', '11001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
}

/** Draws text in the 5x7 font; returns width in pixels. */
export function drawText(px: Px, text: string, x: number, y: number, c: string, scale = 1, spacing = 1): number {
  let cx = x
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']
    g.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) if (row[gx] === '1') px.r(cx + gx * scale, y + gy * scale, scale, scale, c)
    })
    cx += 5 * scale + spacing * scale
  }
  return cx - x - spacing * scale
}

export function textWidth(text: string, scale = 1, spacing = 1): number {
  return text.length * (5 + spacing) * scale - spacing * scale
}
