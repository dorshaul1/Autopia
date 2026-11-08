// The Studio: what kind of thing this product is, what its logs say went wrong, and which real pictures of it exist.
// Pure and token-free. Nothing here invents a state: everything comes from the preview, the logs or a file on disk.

import type { ProductKind } from './completeness'

/** How a product can be seen. web: its page runs here. Everything else says what it can really do. */
export type ProductSurface = 'web' | 'webGame' | 'service' | 'game' | 'native' | 'results'

export interface LaunchOption {
  id: string
  label: string
  /** Relative to the project. */
  path: string
  /** What happens when you open it, and what Autopia then can't do. */
  note: string
}

const SERVICES = new Set(['express', 'fastify', 'koa'])

export function surfaceOf(preview: { kind: 'static' | 'script' | 'none'; framework: string | null; launch: LaunchOption[] }, kind: ProductKind): ProductSurface {
  if (preview.kind !== 'none') {
    if (kind === 'game') return 'webGame'
    return preview.framework && SERVICES.has(preview.framework) ? 'service' : 'web'
  }
  if (kind === 'game' || preview.launch.some((l) => l.id.startsWith('engine:'))) return preview.launch.length || kind === 'game' ? 'game' : 'results'
  return preview.launch.length ? 'native' : 'results'
}

export const SURFACE_WORDS: Record<ProductSurface, { start: string; idle: string }> = {
  web: { start: 'Start the app', idle: 'It isn’t running right now.' },
  webGame: { start: 'Start the game', idle: 'It isn’t running right now.' },
  service: { start: 'Start the server', idle: 'It isn’t running right now. The Studio shows whatever its address answers.' },
  game: { start: 'Open the game', idle: 'This game runs outside Autopia.' },
  native: { start: 'Open the app', idle: 'This app runs outside Autopia.' },
  results: { start: '', idle: 'This has no screen to show, so here is what it does when it runs.' }
}

export interface Diagnostic {
  level: 'error' | 'warning'
  text: string
  count: number
}

/** What the page and the server reported, worst first, with repeats folded. Only ever what the logs say. */
export function diagnosticsOf(logs: string[]): { problems: Diagnostic[]; errors: number; warnings: number; output: string[] } {
  const seen = new Map<string, Diagnostic>()
  const output: string[] = []
  for (const line of logs) {
    const page = /^\[page (error|warning)\]\s*(.*)$/.exec(line)
    const broken = /^\[page\]\s*(.*)$/.exec(line)
    const server = !page && !broken && /\b(ERR_[A-Z_]+|Error:|Unhandled|EADDRINUSE|Cannot find|command not found)/.test(line)
    if (!page && !broken) output.push(line)
    if (!page && !broken && !server) continue
    const level = page?.[1] === 'warning' ? 'warning' : 'error'
    const text = page?.[2] ?? broken?.[1] ?? line
    const key = `${level}:${text}`
    const had = seen.get(key)
    if (had) had.count++
    else seen.set(key, { level, text, count: 1 })
  }
  const problems = [...seen.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  return { problems, errors: problems.filter((p) => p.level === 'error').length, warnings: problems.filter((p) => p.level === 'warning').length, output }
}

/** What you'd hand a teammate: your request stays yours to edit before it goes anywhere. */
export function fixRequest(problem: string, page: string | null): string {
  return `The running app reports this${page ? ` on ${page}` : ''}:\n\n${problem}\n\nFix the cause.`
}

/** A real picture of the product. There is no way to make one without the file. */
export interface Capture {
  path: string
  at: number
  /** you: captured in the Studio. before/after: around a change you sent. check: taken by the team's own visual check. */
  source: 'you' | 'before' | 'after' | 'check'
  width: number
  height: number
  page: string | null
  deliveryId: string | null
  deliveryNumber: number | null
  taskId: string | null
}

export const CAPTURE_WORDS: Record<Capture['source'], string> = { you: 'Your capture', before: 'Before your change', after: 'After your change', check: 'Visual check' }

/** A sensible first comparison: around a change if there is one, otherwise the two newest at the same width. */
export function comparePair(captures: Capture[], taskId?: string | null): [Capture, Capture] | null {
  const newest = [...captures].sort((a, b) => b.at - a.at)
  if (newest.length < 2) return null
  const around = (id: string) => {
    const before = newest.find((c) => c.taskId === id && c.source === 'before')
    const after = newest.find((c) => c.taskId === id && c.source === 'after')
    return before && after ? ([before, after] as [Capture, Capture]) : null
  }
  if (taskId) {
    const pair = around(taskId)
    if (pair) return pair
  }
  const latest = newest.find((c) => c.source === 'after')
  const pair = latest?.taskId ? around(latest.taskId) : null
  if (pair) return pair
  for (const later of newest) {
    const earlier = newest.find((c) => c.at < later.at && c.width === later.width)
    if (earlier) return [earlier, later]
  }
  return [newest[1], newest[0]]
}

export interface RelRect {
  x: number
  y: number
  width: number
  height: number
}

/** A mark on a picture, as fractions of it, so it stays put at any size or pixel density. A click is a point. */
export function relRect(a: { x: number; y: number }, b: { x: number; y: number }, box: { width: number; height: number }): RelRect | null {
  if (box.width <= 0 || box.height <= 0) return null
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const x1 = clamp(a.x / box.width)
  const y1 = clamp(a.y / box.height)
  const x2 = clamp(b.x / box.width)
  const y2 = clamp(b.y / box.height)
  const dragged = Math.abs(b.x - a.x) > 6 || Math.abs(b.y - a.y) > 6
  return dragged ? { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) } : { x: x1, y: y1, width: 0, height: 0 }
}

/** The part of a picture worth saving for a mark: the region itself, or the neighbourhood of a point. */
export function cropOf(rel: RelRect, size: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const margin = rel.width || rel.height ? 0 : 0.1
  const x1 = Math.max(0, rel.x - margin)
  const y1 = Math.max(0, rel.y - margin)
  const x2 = Math.min(1, rel.x + rel.width + margin)
  const y2 = Math.min(1, rel.y + rel.height + margin)
  const x = Math.round(x1 * size.width)
  const y = Math.round(y1 * size.height)
  return { x, y, width: Math.max(1, Math.min(size.width - x, Math.round((x2 - x1) * size.width))), height: Math.max(1, Math.min(size.height - y, Math.round((y2 - y1) * size.height))) }
}

export const STUDIO_VIEWPORTS = { desktop: 0, tablet: 820, mobile: 390 } as const
export type StudioViewport = keyof typeof STUDIO_VIEWPORTS

export interface StudioPrefs {
  viewport: StudioViewport
  drawer: boolean
}

/** What you left the Studio like for this product. Anything unreadable falls back to the plain default. */
export function readStudioPrefs(raw: string | null): StudioPrefs {
  try {
    const p = JSON.parse(raw ?? '{}') as Partial<StudioPrefs>
    return { viewport: p.viewport && p.viewport in STUDIO_VIEWPORTS ? p.viewport : 'desktop', drawer: p.drawer === true }
  } catch {
    return { viewport: 'desktop', drawer: false }
  }
}

const OWN_FILE = /^\.autopia\/(screenshots|quality|feedback)\/[\w.-]+\.png$/
/** Only pictures Autopia itself wrote. Everything from outside the main process goes through this. */
export const isCapturePath = (rel: unknown): rel is string => typeof rel === 'string' && OWN_FILE.test(rel)
