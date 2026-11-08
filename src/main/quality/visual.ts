// Real visual, accessibility and page-performance QA. The running preview (loopback only) is loaded
// in hidden, sandboxed, in-memory windows at phone, tablet and desktop widths. Every finding comes
// from the rendered DOM or a captured frame, and every screenshot is a real capture. No AI here.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { QualityFinding } from '@shared/types'

export const WIDTHS = [375, 768, 1280]
const HEIGHT = 860
const SETTLE_MS = 900
const LOAD_TIMEOUT_MS = 20_000

/** Runs in the page. Plain ES2017, no imports; returns JSON-safe data. */
const PAGE_AUDIT = String.raw`(() => {
  const W = innerWidth
  const sel = (el) => {
    if (!el || !el.tagName) return '?'
    let s = el.tagName.toLowerCase()
    if (el.id) return s + '#' + el.id
    const cls = [...el.classList].slice(0, 2).join('.')
    if (cls) s += '.' + cls
    const p = el.parentElement
    return p && p !== document.body ? (p.id ? p.tagName.toLowerCase() + '#' + p.id + ' > ' : '') + s : s
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0
  }
  const all = [...document.body.querySelectorAll('*')].slice(0, 4000)
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true
    }
    return false
  }
  // only the outermost element of an overflowing subtree is a cause; its children just move with it
  const over = new Set()
  const overflow = []
  for (const el of all) {
    if (!visible(el) || inScroller(el)) continue
    const r = el.getBoundingClientRect()
    if (!(r.right > W + 1 || r.left < -1)) continue
    over.add(el)
    let inside = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (over.has(p)) { inside = true; break }
    if (!inside) overflow.push({ sel: sel(el), by: Math.round(Math.max(r.right - W, -r.left)) })
  }
  // screen-reader-only text: tiny or clipped on purpose
  const srOnly = (el, cs) => { const b = el.getBoundingClientRect(); return b.width <= 2 || b.height <= 2 || /rect\(/.test(cs.clip) || /inset\((4[5-9]|[5-9]\d|100)%/.test(cs.clipPath) }
  const clipped = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (!/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis' || !visible(el)) continue
    if (!el.textContent.trim() || el.children.length > 3) continue
    if (srOnly(el, cs)) continue
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) clipped.push(sel(el))
  }
  const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  // an opaque ancestor background is known; with none (backgrounds painted by other layers, gradients
  // behind translucent cards) white is only an assumption, checked against the rendered pixels later
  const bgOf = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor)
      if ((c[3] === undefined ? 1 : c[3]) > 0.9) return { c, assumed: false }
    }
    return { c: [255, 255, 255, 1], assumed: true }
  }
  const lowContrast = []
  let checked = 0
  for (const el of all) {
    if (checked > 400) break
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (srOnly(el, cs)) continue
    checked++
    const fg = parse(cs.color)
    if ((fg[3] === undefined ? 1 : fg[3]) < 0.5) continue
    const bg = bgOf(el)
    if (!bg) continue
    const a = lum(fg), b = lum(bg.c)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
    const r = el.getBoundingClientRect()
    if (ratio < need) lowContrast.push({ sel: sel(el), ratio: Math.round(ratio * 100) / 100, need, assumed: bg.assumed, fg: fg.slice(0, 3), bg: bg.c.slice(0, 3), rect: [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)] })
  }
  const nameOf = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()
    if (t) return t
    const lb = el.getAttribute('aria-labelledby')
    if (lb && document.getElementById(lb)) return document.getElementById(lb).textContent.trim()
    if (el.id && document.querySelector('label[for="' + el.id + '"]')) return 'label'
    if (el.closest('label')) return 'label'
    if (el.tagName === 'INPUT' && /submit|button|reset/.test(el.type)) return el.value
    if (el.tagName === 'IMG') return el.alt
    return (el.textContent || '').trim() || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ').trim()
  }
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')].filter(visible)
  const unlabeled = controls.filter((c) => !nameOf(c)).map(sel)
  const smallTargets = W <= 480 ? controls.filter((c) => { const r = c.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && c.tagName !== 'A' }).map(sel) : []
  const imgs = [...document.images]
  const noAlt = imgs.filter((i) => !i.hasAttribute('alt') && visible(i)).map((i) => i.currentSrc.split('/').pop() || sel(i))
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc.split('/').pop())
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1])
  let skip = null
  for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) { skip = 'h' + heads[i - 1] + ' → h' + heads[i]; break }
  const nav = performance.getEntriesByType('navigation')[0]
  const res = performance.getEntriesByType('resource')
  return {
    docWidth: document.documentElement.scrollWidth,
    overflow: overflow.sort((a, b) => b.by - a.by).slice(0, 6),
    clipped: clipped.slice(0, 6),
    lowContrast: lowContrast.slice(0, 8),
    unlabeled: unlabeled.slice(0, 8),
    smallTargets: smallTargets.slice(0, 8),
    noAlt: noAlt.slice(0, 8),
    broken: broken.slice(0, 8),
    noLang: !document.documentElement.lang,
    noTitle: !document.title.trim(),
    noH1: heads.length > 0 && !heads.includes(1),
    headingSkip: skip,
    blank: document.body.innerText.trim().length === 0 && document.body.querySelectorAll('img,canvas,svg,video').length === 0,
    domNodes: document.getElementsByTagName('*').length,
    loadMs: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : null,
    transferBytes: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav ? nav.transferSize || 0 : 0)),
    requests: res.length + 1
  }
})()`

export interface ContrastIssue {
  sel: string
  ratio: number
  need: number
  /** No opaque ancestor background: the ratio used an assumed white and must be checked on the pixels. */
  assumed?: boolean
  fg?: number[]
  bg?: number[]
  /** Page coordinates [x, y, width, height]. */
  rect?: number[]
  /** Background measured from the captured screenshot. */
  measured?: boolean
}

export interface PageAudit {
  docWidth: number
  overflow: { sel: string; by: number }[]
  clipped: string[]
  lowContrast: ContrastIssue[]
  unlabeled: string[]
  smallTargets: string[]
  noAlt: string[]
  broken: string[]
  noLang: boolean
  noTitle: boolean
  noH1: boolean
  headingSkip: string | null
  blank: boolean
  domNodes: number
  loadMs: number | null
  transferBytes: number
  requests: number
}

export interface VisualResult {
  findings: QualityFinding[]
  metrics: Record<string, number>
  shots: { width: number; path: string }[]
}

/** Turns per-width page audits into deduplicated findings (pure; unit-tested). */
export function visualFindings(audits: { width: number; audit: PageAudit; consoleErrors: string[]; failedRequests: string[] }[], origin = ''): QualityFinding[] {
  const out = new Map<string, QualityFinding>()
  const add = (f: Omit<QualityFinding, 'count' | 'line'>, key = `${f.rule}:${f.file}`) => {
    const prev = out.get(key)
    if (prev) {
      prev.count++
      if (f.width !== null && (prev.width === null || f.width < prev.width)) prev.width = f.width
    } else out.set(key, { ...f, line: null, count: 1 })
  }
  const overflowWidths: number[] = []
  const causes = new Map<string, number>()
  for (const { width, audit: a, consoleErrors, failedRequests } of audits) {
    if (a.blank) add({ dimension: 'visual', severity: 'high', rule: 'blank-page', message: 'The page rendered nothing visible.', file: null, width })
    if (a.docWidth > width + 1) {
      // one root cause, one finding: the widest offenders are its evidence, not separate findings
      overflowWidths.push(width)
      for (const o of a.overflow) causes.set(o.sel, Math.max(causes.get(o.sel) ?? 0, o.by))
    } else for (const o of a.overflow) add({ dimension: 'visual', severity: 'medium', rule: 'element-overflow', message: `Extends ${o.by}px past the viewport.`, file: o.sel, width })
    for (const c of a.clipped) add({ dimension: 'visual', severity: 'low', rule: 'clipped', message: 'Content is cut off by its container.', file: c, width })
    for (const c of a.lowContrast)
      add({ dimension: 'accessibility', severity: 'medium', rule: 'contrast', message: `Text contrast ${c.ratio}:1 (needs ${c.need}:1)${c.measured ? ', measured against the rendered background' : c.assumed ? ', against an assumed white background' : ''}.`, file: c.sel, width, ...(c.assumed && !c.measured ? { certainty: 'suspected' as const } : {}) })
    for (const u of a.unlabeled) add({ dimension: 'accessibility', severity: 'high', rule: 'no-name', message: 'Interactive control has no accessible name.', file: u, width })
    for (const s of a.smallTargets) add({ dimension: 'accessibility', severity: 'low', rule: 'tap-target', message: 'Touch target smaller than 24×24 px.', file: s, width })
    for (const i of a.noAlt) add({ dimension: 'accessibility', severity: 'medium', rule: 'img-alt', message: 'Image without alt text (use alt="" if decorative).', file: i, width })
    for (const b of a.broken) add({ dimension: 'visual', severity: 'high', rule: 'broken-image', message: 'Image failed to load.', file: b, width })
    if (a.noLang) add({ dimension: 'accessibility', severity: 'low', rule: 'html-lang', message: '<html> has no lang attribute.', file: null, width })
    if (a.noTitle) add({ dimension: 'accessibility', severity: 'low', rule: 'title', message: 'The page has no <title>.', file: null, width })
    if (a.noH1) add({ dimension: 'accessibility', severity: 'info', rule: 'no-h1', message: 'Headings start below h1.', file: null, width })
    if (a.headingSkip) add({ dimension: 'accessibility', severity: 'info', rule: 'heading-skip', message: `Heading level skipped (${a.headingSkip}).`, file: null, width })
    for (const e of consoleErrors) add({ dimension: 'visual', severity: 'high', rule: 'console-error', message: e.slice(0, 220), file: null, width }, `console:${e.slice(0, 80)}`)
    for (const r of failedRequests) {
      // QA loads only the local preview: requests to other hosts are expected to fail here and say nothing about the product
      const url = r.replace(/^\S+\s+/, '')
      const external = /^https?:\/\//.test(url) && !(origin && url.startsWith(origin)) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
      if (external) add({ dimension: 'visual', severity: 'info', rule: 'external-resource', message: `Not loaded during QA (external hosts are not contacted): ${new URL(url).host}`, file: null, width, certainty: 'suspected' }, `ext:${new URL(url).host}`)
      else add({ dimension: 'visual', severity: 'medium', rule: 'failed-request', message: `Request failed: ${r}`, file: null, width }, `req:${r}`)
    }
  }
  if (overflowWidths.length) {
    const top = [...causes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3)
    out.set('page-overflow', {
      dimension: 'visual',
      severity: 'high',
      rule: 'page-overflow',
      message: `The page scrolls sideways at ${overflowWidths.join(' and ')}px.`,
      file: top[0]?.[0] ?? null,
      line: null,
      width: Math.min(...overflowWidths),
      count: overflowWidths.length,
      evidence: top.length ? `Wider than the viewport: ${top.map(([sel, by]) => `${sel} (+${by}px)`).join(', ')}` : null
    })
  }
  const rank = { high: 0, medium: 1, low: 2, info: 3 }
  return [...out.values()].sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * Loads `url` (must be loopback) at each width, captures it, audits the DOM. Shots go to
 * <project>/.autopia/quality/<id>-<width>.png.
 */
export async function runVisualQa(projectPath: string, reportId: string, url: string): Promise<VisualResult> {
  const u = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Visual QA only loads the local preview')
  const dir = join(projectPath, '.autopia', 'quality')
  mkdirSync(dir, { recursive: true })
  const partition = `quality-${reportId}` // in-memory, discarded afterwards
  const ses = session.fromPartition(partition)
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  const failed: string[] = []
  ses.webRequest.onCompleted((d) => {
    if (d.statusCode >= 400) failed.push(`${d.statusCode} ${d.url.replace(u.origin, '')}`)
  })
  ses.webRequest.onErrorOccurred((d) => {
    if (!/ERR_ABORTED/.test(d.error)) failed.push(`${d.error} ${d.url.replace(u.origin, '')}`)
  })

  const audits: Parameters<typeof visualFindings>[0] = []
  const shots: VisualResult['shots'] = []
  const metrics: Record<string, number> = {}
  for (const width of WIDTHS) {
    failed.length = 0
    const consoleErrors: string[] = []
    const win = new BrowserWindow({
      show: false,
      width,
      height: HEIGHT,
      useContentSize: true,
      webPreferences: { partition, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
    })
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (e, to) => {
        if (new URL(to).origin !== u.origin) e.preventDefault()
      })
      win.webContents.on('console-message', (details) => {
        const d = details as unknown as { level: string; message: string }
        if (d.level === 'error') consoleErrors.push(d.message)
      })
      await Promise.race([
        win.loadURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`The preview did not load within ${LOAD_TIMEOUT_MS / 1000}s`)), LOAD_TIMEOUT_MS))
      ])
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      const audit = (await win.webContents.executeJavaScript(PAGE_AUDIT, true)) as PageAudit
      // capture the full page height (bounded) so below-the-fold layout is visible too
      const fullHeight = Math.min(Math.max(HEIGHT, (await win.webContents.executeJavaScript('document.documentElement.scrollHeight', true)) as number), 3000)
      if (fullHeight > HEIGHT) {
        win.setContentSize(width, fullHeight)
        await new Promise((r) => setTimeout(r, 400))
      }
      const img = await win.webContents.capturePage()
      if (img.isEmpty()) throw new Error('The page could not be captured')
      audit.lowContrast = resolveContrast(audit.lowContrast, img.toBitmap(), img.getSize(), width)
      const rel = `.autopia/quality/${reportId}-${width}.png`
      writeFileSync(join(projectPath, rel), img.toPNG())
      shots.push({ width, path: rel })
      audits.push({ width, audit, consoleErrors: [...new Set(consoleErrors)], failedRequests: [...new Set(failed)] })
      if (width === 1280) {
        if (audit.loadMs !== null) metrics.loadMs = audit.loadMs
        metrics.domNodes = audit.domNodes
        metrics.transferKb = Math.round(audit.transferBytes / 1024)
        metrics.requests = audit.requests
      }
    } finally {
      win.destroy()
    }
  }
  await ses.clearStorageData().catch(() => undefined)
  return { findings: visualFindings(audits, u.origin), metrics, shots }
}

/**
 * Text whose contrast was computed against an assumed white background is re-checked on the captured
 * frame: the dominant colour inside its box is the background it is really drawn on. Issues that pass
 * on the real pixels are dropped; the rest are kept as measured. `bitmap` is BGRA.
 */
export function resolveContrast(issues: ContrastIssue[], bitmap: Buffer, size: { width: number; height: number }, cssWidth: number): ContrastIssue[] {
  const scale = size.width / cssWidth
  return issues.flatMap((c) => {
    if (!c.assumed || !c.rect || !c.fg) return [c]
    const [x, y, w, h] = c.rect.map((v) => Math.round(v * scale))
    // group pixels by colour (4 bits per channel, so anti-aliasing doesn't split the background), then
    // average the real pixels of the dominant group: the background exactly, not a rounded bucket
    const groups = new Map<number, number[]>()
    for (let py = Math.max(0, y); py < Math.min(size.height, y + h); py += 2) {
      for (let px = Math.max(0, x); px < Math.min(size.width, x + w); px += 2) {
        const i = (py * size.width + px) * 4
        const key = ((bitmap[i + 2] >> 4) << 8) | ((bitmap[i + 1] >> 4) << 4) | (bitmap[i] >> 4)
        const g = groups.get(key) ?? [0, 0, 0, 0]
        g[0] += bitmap[i + 2]
        g[1] += bitmap[i + 1]
        g[2] += bitmap[i]
        g[3]++
        groups.set(key, g)
      }
    }
    const top = [...groups.values()].sort((a, b) => b[3] - a[3])[0]
    if (!top) return [c] // off-frame: stays an unconfirmed suspicion
    const bg = [top[0] / top[3], top[1] / top[3], top[2] / top[3]].map(Math.round)
    const ratio = Math.round(contrastRatio(c.fg, bg) * 100) / 100
    return ratio >= c.need ? [] : [{ ...c, ratio, bg, measured: true }]
  })
}

export function contrastRatio(fg: number[], bg: number[]): number {
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const [a, b] = [lum(fg), lum(bg)].sort((p, q) => q - p)
  return (a + 0.05) / (b + 0.05)
}
