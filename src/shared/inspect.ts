// Pointing at the running app: what a selection captures, and how feedback becomes work. Pure and deterministic.
// A source location is only ever a claim with its evidence attached; nothing here assumes one element is one file.

export interface ElementSnapshot {
  text: string
  width: number
  height: number
  styles: Record<string, string>
}

export interface InspectedElement {
  tag: string
  selector: string
  id: string | null
  classes: string[]
  attrs: Record<string, string>
  /** Nearest components, innermost first, from the framework's own development metadata. */
  components: string[]
  /** file:line the framework itself reports (React dev builds, Vue, Svelte). Unchecked until the main process confirms it. */
  reported: { file: string; line: number | null; framework: string }[]
  /** The element's surroundings: nearest landmark or heading. */
  near: string
  page: string
  snapshot: ElementSnapshot
  /** A canvas, or a frame from another origin: it can't be looked inside. */
  opaque: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Picked = { kind: 'element'; rect: Rect; element: InspectedElement } | { kind: 'region'; rect: Rect; page: string }

export interface SourceCandidate {
  file: string
  line: number | null
  /** exact: the framework reported it and the file exists. likely: found by searching the code. */
  confidence: 'exact' | 'likely'
  why: string
}

export interface FeedbackItem {
  id: string
  note: string
  pick: Picked
  /** Saved crop of what you pointed at. */
  shot: string | null
  sources: SourceCandidate[]
  taskId: string | null
  /** What the page shows after the change: only what could be measured. */
  check: FeedbackCheck | null
  /** Marked on a picture rather than the live page: which picture, and where on it as fractions of its size. */
  capture?: { path: string; at: number } | null
  mark?: { x: number; y: number; width: number; height: number } | null
}

export type FeedbackCheck = { state: 'changed'; what: string[] } | { state: 'same' } | { state: 'gone' } | { state: 'unknown'; why: string }

const quote = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function describePick(p: Picked): string {
  if (p.kind === 'region') return !p.rect.width && !p.rect.height ? `spot at ${Math.round(p.rect.x)},${Math.round(p.rect.y)}` : `area ${Math.round(p.rect.width)}×${Math.round(p.rect.height)} at ${Math.round(p.rect.x)},${Math.round(p.rect.y)}`
  const e = p.element
  const name = e.components[0] ? `${e.components[0]} ` : ''
  return `${name}<${e.tag}>${e.snapshot.text ? ` “${quote(e.snapshot.text, 40)}”` : ''}`
}

const BEHAVIOUR = /\b(click|tap|press|submit|save|load|open|close|crash|error|broken|bug|fail\w*|does(n.?t| not)|won.?t|logic|filter|sort|calculate|wrong (value|total|result)|disabled|validat\w*|redirect|navigat\w*)\b/i
export const feedbackKind = (notes: string): 'design' | 'code' => (BEHAVIOUR.test(notes) ? 'code' : 'design')

/**
 * Changes that touch the same file go to one teammate; the rest run side by side. Anything whose source is
 * unknown stays together too, since it could touch anything.
 */
export function groupFeedback<T extends Pick<FeedbackItem, 'sources'>>(items: T[]): T[][] {
  const groups: { files: Set<string>; items: T[] }[] = []
  const unknown: T[] = []
  for (const item of items) {
    // where it's written decides; files that merely contain it (often the same App for everything) don't
    const exact = item.sources.filter((s) => s.confidence === 'exact')
    const files = (exact.length ? exact : item.sources).map((s) => s.file)
    if (!files.length) {
      unknown.push(item)
      continue
    }
    const hits = groups.filter((g) => files.some((f) => g.files.has(f)))
    const into = hits[0] ?? { files: new Set<string>(), items: [] }
    if (!hits.length) groups.push(into)
    for (const other of hits.slice(1)) {
      other.files.forEach((f) => into.files.add(f))
      into.items.push(...other.items)
      groups.splice(groups.indexOf(other), 1)
    }
    files.forEach((f) => into.files.add(f))
    into.items.push(item)
  }
  return [...groups.map((g) => g.items), ...(unknown.length ? [unknown] : [])]
}

/** What the teammate is told: your words first, then what was pointed at, then where it may live and how sure that is. */
export function feedbackRequest(items: (Pick<FeedbackItem, 'note' | 'pick' | 'sources' | 'shot'> & Pick<Partial<FeedbackItem>, 'capture' | 'mark'>)[]): string {
  const parts = items.map((it, i) => {
    const p = it.pick
    const lines = [`${items.length > 1 ? `${i + 1}. ` : ''}${it.note.trim()}`]
    if (p.kind === 'element') {
      const e = p.element
      lines.push(`Pointed at: <${e.tag}>${e.snapshot.text ? ` showing “${quote(e.snapshot.text, 120)}”` : ''} on ${e.page}${e.near ? `, in ${e.near}` : ''}`, `Selector: ${e.selector}`)
      if (e.components.length) lines.push(`Components: ${e.components.slice(0, 5).join(' < ')}`)
      if (e.opaque) lines.push('It draws its own content (canvas or embedded frame), so the page structure says nothing about what is inside it.')
    } else if (it.mark) {
      const pct = (v: number) => `${Math.round(v * 100)}%`
      const where = it.mark.width || it.mark.height ? `the area from ${pct(it.mark.x)} across, ${pct(it.mark.y)} down, ${pct(it.mark.width)} wide and ${pct(it.mark.height)} tall` : `the spot ${pct(it.mark.x)} across, ${pct(it.mark.y)} down`
      lines.push(`Marked on a screenshot: ${where}${p.page ? `, on ${p.page}` : ''}. That is a position on the picture, not a place in the code.`)
    } else {
      lines.push(`Pointed at: an area of ${Math.round(p.rect.width)}×${Math.round(p.rect.height)}px at ${Math.round(p.rect.x)},${Math.round(p.rect.y)} on ${p.page}`)
    }
    if (it.shot) lines.push(`Picture of what they mean: ${it.shot} (in your working directory). Read it.`)
    if (it.capture?.path.startsWith('.autopia/screenshots/')) lines.push(`The whole screen: ${it.capture.path}`)
    if (it.sources.length) lines.push('Where it may live (confirm in the source; a visible element can come from several places):', ...it.sources.slice(0, 5).map((s) => `- ${s.file}${s.line ? `:${s.line}` : ''} (${s.why})`))
    else lines.push('Autopia could not place this in the source: find it by what is on screen.')
    return lines.join('\n')
  })
  return [`Visual feedback from the running app. Change what was asked and keep everything else as it is.`, ...parts].join('\n\n')
}

const WATCHED = ['color', 'background-color', 'font-size', 'font-weight', 'display', 'opacity', 'border-radius', 'padding', 'margin', 'visibility']
export const WATCHED_STYLES = WATCHED

/** What measurably differs. Says nothing about whether it's what you wanted: that's for you to see. */
export function compareSnapshots(before: ElementSnapshot, after: ElementSnapshot | null): FeedbackCheck {
  if (!after) return { state: 'gone' }
  const what: string[] = []
  if (before.text !== after.text) what.push('text')
  if (before.width !== after.width || before.height !== after.height) what.push('size')
  for (const k of Object.keys(before.styles)) if (before.styles[k] !== after.styles[k]) what.push(k)
  return what.length ? { state: 'changed', what } : { state: 'same' }
}

/** Your words and the status, never more than the records and the page show. */
export function feedbackStatus(item: Pick<FeedbackItem, 'taskId' | 'check'>, taskStatus: string | null): { label: string; tone: 'muted' | 'info' | 'ok' | 'warn' | 'danger' } {
  if (!item.taskId) return { label: 'Not sent', tone: 'muted' }
  if (taskStatus === 'failed' || taskStatus === 'interrupted') return { label: 'Stopped', tone: 'danger' }
  if (taskStatus === 'cancelled') return { label: 'Cancelled', tone: 'muted' }
  if (taskStatus !== 'done') return { label: taskStatus === 'pending' ? 'Waiting' : 'Being changed', tone: 'info' }
  const c = item.check
  if (!c) return { label: 'Done, not checked on the page', tone: 'warn' }
  if (c.state === 'changed') return { label: `Done, page changed (${c.what.slice(0, 3).join(', ')})`, tone: 'ok' }
  if (c.state === 'gone') return { label: 'Done, element no longer on the page', tone: 'warn' }
  if (c.state === 'same') return { label: 'Done, but no visible change', tone: 'warn' }
  return { label: `Done, unverified: ${c.why}`, tone: 'warn' }
}
