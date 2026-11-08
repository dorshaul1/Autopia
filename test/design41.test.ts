import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The design system's guarantees, checked from the source: tokens resolve, text meets WCAG contrast on
// every surface it is used on, and feature styles use tokens rather than raw values.
const dir = join(__dirname, '../src/renderer/src')
const tokens = readFileSync(join(dir, 'design/tokens.css'), 'utf8')
const styles = readFileSync(join(dir, 'styles.css'), 'utf8')
const primitives = readFileSync(join(dir, 'design/primitives.css'), 'utf8')

const defs = new Map<string, string>()
for (const m of tokens.matchAll(/--([\w-]+):\s*([^;]+);/g)) if (!defs.has(m[1])) defs.set(m[1], m[2].trim())
const resolve = (v: string): string => {
  const ref = /^var\(--([\w-]+)\)$/.exec(v)
  return ref ? resolve(defs.get(ref[1]) ?? '') : v
}
type RGBA = [number, number, number, number]
const parse = (v: string): RGBA => {
  const c = resolve(v)
  const hex = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c)
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], +rgba[4]]
  throw new Error(`not a color: ${v} → ${c}`)
}
const over = (top: RGBA, base: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1) as RGBA
const lum = ([r, g, b]: RGBA) => {
  const ch = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}
const contrast = (fg: string, bg: string, under = 'bg-panel') => {
  const base = parse(`var(--${under})`)
  const b = over(parse(`var(--${bg})`), base)
  const f = over(parse(`var(--${fg})`), b)
  const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('design tokens', () => {
  it('every var() used by the app is defined', () => {
    const used = new Set([...(styles + primitives).matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]))
    // component-local custom properties set inline (role colour, strength, office accent, panel width…)
    const local = new Set([...(styles + primitives).matchAll(/^\s*--([\w-]+):/gm)].map((m) => m[1]).concat(['role', 's', 'office', 'sheet-w', 'ui-font', 'arrow-x', 'team-dock-h']))
    const missing = [...used].filter((n) => !defs.has(n) && !local.has(n))
    expect(missing).toEqual([])
  })
  it('readable text meets WCAG AA (4.5:1) on every surface', () => {
    for (const surface of ['bg-app', 'bg-chrome', 'bg-panel', 'bg-elevated', 'bg-raised'])
      for (const text of ['text-primary', 'text-secondary', 'text-muted', 'text-faint']) expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })
  it('accent and status colours stay readable where they are used', () => {
    expect(contrast('on-accent', 'accent')).toBeGreaterThanOrEqual(7)
    expect(contrast('accent-text', 'bg-panel')).toBeGreaterThanOrEqual(4.5)
    for (const s of ['ok', 'warn', 'danger', 'info']) {
      expect(contrast(s, `${s}-soft`), `${s} on its soft fill`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(`${s}-text`, `${s}-soft`), `${s}-text on its soft fill`).toBeGreaterThanOrEqual(7)
    }
    expect(contrast('danger-text', 'danger-bg')).toBeGreaterThanOrEqual(7)
  })
  it('feature styles use tokens, not raw colours or type sizes', () => {
    const body = styles.replace(/\/\*[\s\S]*?\*\//g, '')
    const hex = body.match(/#[0-9a-f]{3,8}\b/gi) ?? []
    const rgba = (body.match(/rgba\([^)]*\)/g) ?? []).filter((x) => !x.includes('calc('))
    expect(hex).toEqual([])
    expect(rgba).toEqual([])
    expect(body.match(/font-size:\s*[\d.]+px/g) ?? []).toEqual([])
    expect(body.match(/font-weight:\s*\d+/g) ?? []).toEqual([])
    expect(primitives.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([])
    // motion comes from the tokens too: one timing, everywhere
    const rawTiming = (css: string) => (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*(transition|animation)[^:]*:[^;]*\b\d*\.?\d+m?s\b[^;]*;/gm) ?? []).filter((d) => !/reduce|0\.01ms|animation-delay/.test(d))
    expect(rawTiming(styles)).toEqual([])
  })
})
