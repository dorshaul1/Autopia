// Uses the running app the way a person would: clicks what looks clickable, follows links, fills in and submits
// forms, presses keys on a game, and records what really happened. Runs in the same hidden, sandboxed, in-memory kind
// of window as the rest of visual QA. Nothing leaves the machine or changes data: writes to the app's server and
// anything but a plain read from other hosts are cancelled (and counted, since an attempt is itself an outcome).
// No AI; completenessFindings (shared/completeness) decides what it means.

import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { InteractionProbe, ProbedPage } from '@shared/completeness'

const WIDTH = 1280
const HEIGHT = 800
const MAX_PAGES = 5
const MAX_CONTROLS = 24
const MAX_FORMS = 2
const BUDGET_MS = 40_000
const SETTLE_MS = 500
const CONFIRM_SETTLE_MS = 1500
const WAIT_MS = 350
const SECOND_WAIT_MS = 500

/** Installed before the page's own code runs, on every load. */
const INSTALL = String.raw`(() => {
  if (window.__ap) return
  const c = { muts: 0, net: 0, store: 0, dialogs: 0, opened: 0, printed: 0, clip: 0, submits: 0, reloads: 0 }
  window.__ap = { c }
  window.alert = () => { c.dialogs++ }
  window.confirm = () => { c.dialogs++; return false }
  window.prompt = () => { c.dialogs++; return null }
  window.print = () => { c.printed++ }
  window.open = () => { c.opened++; return null }
  try { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { c.store++; return set.apply(this, a) } } catch {}
  try { if (navigator.clipboard) navigator.clipboard.writeText = async () => { c.clip++ } } catch {}
  const f = window.fetch
  if (f) window.fetch = function (...a) { c.net++; return f.apply(this, a) }
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (...a) { c.net++; return send.apply(this, a) }
  new MutationObserver((r) => { c.muts += r.length }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  window.addEventListener('submit', (e) => {
    c.submits++
    if (!e.defaultPrevented && !e.target.getAttribute('action')) { c.reloads++; e.preventDefault() }
  })
})()`

/** The page-side helpers, added after load. */
const HELPERS = String.raw`(() => {
  const A = window.__ap
  if (!A || A.list) return
  const c = A.c
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 }
  const label = (el) => ((el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || (el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').alt) || '') + '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const CONTROL = 'button,[role=button],[role=tab],[role=menuitem],a[href],input[type=button],summary,[onclick]'
  const find = () => {
    const on = (el) => /active|selected|current/i.test(el.getAttribute('class') || '') || ['aria-pressed', 'aria-selected', 'aria-current'].some((a) => { const v = el.getAttribute(a); return v && v !== 'false' })
    // choosing what's already chosen rightly does nothing
    const controls = [...document.querySelectorAll(CONTROL)].filter((el) => vis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !on(el))
      // a form's own submit button is tried with the form, filled in
      .filter((el) => !(el.form && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type')))))
    const looks = [...document.body.querySelectorAll('*')].slice(0, 2000).filter((el) => {
      if (el.closest(CONTROL) || el.closest('label') || el.querySelector(CONTROL) || /^(INPUT|SELECT|TEXTAREA|CANVAS|OPTION)$/.test(el.tagName)) return false
      if (getComputedStyle(el).cursor !== 'pointer' || !vis(el)) return false
      const p = el.parentElement
      return !p || getComputedStyle(p).cursor !== 'pointer'
    }).slice(0, 5)
    return [...controls, ...looks]
  }
  const sigOf = (el) => el.tagName + '|' + label(el) + '|' + (el.getAttribute('href') || '')
  A.list = () => {
    const seen = {}
    return find().map((el) => {
      const sig = sigOf(el)
      seen[sig] = (seen[sig] || 0) + 1
      const href = el.tagName === 'A' ? el.getAttribute('href') : null
      const id = href && /^#[^/!]/.test(href) ? decodeURIComponent(href.slice(1)) : null
      return { sig, nth: seen[sig] - 1, label: label(el) || el.tagName.toLowerCase(), href, abs: el.tagName === 'A' ? el.href : null, target: el.getAttribute('target'), kind: el.tagName === 'A' ? 'link' : el.matches(CONTROL) ? 'control' : 'looks-clickable', missing: !!id && !document.getElementById(id) }
    })
  }
  const clean = () => { let t = document.body ? document.body.innerText : ''; for (const n of document.querySelectorAll('code,pre')) if (n.innerText) t = t.split(n.innerText).join(' '); return t.replace(/\s+/g, ' ').trim() }
  const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/
  const url = () => location.href.replace(/#$/, '')
  A.mark = () => { A.base = { ...c, url: url(), y: scrollY, x: scrollX, focus: document.activeElement, junk: (clean().match(JUNK) || [null])[0] } }
  A.effect = () => {
    const b = A.base
    if (!b) return { any: true, dom: true, onlyHash: false, reloads: 0, junk: null } // a new document: the click navigated
    const counted = Object.keys(c).some((k) => k !== 'reloads' && c[k] !== b[k])
    const dom = c.muts !== b.muts
    const moved = scrollY !== b.y || scrollX !== b.x || document.activeElement !== b.focus
    const j = (clean().match(JUNK) || [null])[0]
    const onlyHash = !counted && !moved && url() !== b.url && url().split('#')[0] === b.url.split('#')[0]
    return { any: counted || moved || url() !== b.url, dom, onlyHash, reloads: c.reloads - b.reloads, junk: j && j !== b.junk ? j : null }
  }
  A.click = (sig, nth) => {
    const el = find().filter((x) => sigOf(x) === sig)[nth]
    if (!el) return false
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mousedown', at))
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouseup', at))
    if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', at))
    return true
  }
  const setValue = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const sample = (el) => {
    const hint = (el.name + ' ' + el.id + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase()
    if (el.type === 'email' || /e-?mail/.test(hint)) return 'sam.rivera@example.com'
    if (el.type === 'tel' || /phone|tel\b/.test(hint)) return '5550100123'
    if (el.type === 'url') return 'https://example.com'
    if (el.type === 'password') return 'Test-pass-1234'
    if (el.type === 'number' || el.type === 'range') return el.min || '1'
    if (el.type === 'date') return new Date().toISOString().slice(0, 10)
    if (el.type === 'time') return '10:30'
    if (el.type === 'color') return '#336699'
    if (/name/.test(hint)) return 'Sam Rivera'
    return el.tagName === 'TEXTAREA' ? 'Testing this form with a short message.' : 'Test entry'
  }
  const forms = () => [...document.forms].filter(vis)
  // a button beside an empty box often rightly does nothing until there's something in it
  A.fillLoose = () => {
    for (const el of document.querySelectorAll('input:not([type]),input[type=text],input[type=search],input[type=email],input[type=number],textarea')) {
      if (el.form || el.value || el.disabled || el.readOnly || !vis(el)) continue
      el.value = sample(el)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  A.formCount = () => forms().length
  A.fill = (i) => {
    const f = forms()[i]
    if (!f) return null
    for (const el of f.elements) {
      if (el.disabled || el.readOnly || /^(hidden|submit|button|reset|file|image)$/.test(el.type) || !el.tagName) continue
      if (el.type === 'checkbox') { if (el.required && !el.checked) el.click(); continue }
      if (el.type === 'radio') { if (el.required && !f.querySelector('input[name="' + CSS.escape(el.name) + '"]:checked')) el.click(); continue }
      if (el.tagName === 'SELECT') { const o = [...el.options].find((x) => x.value && !x.disabled); if (o) setValue(el, o.value); continue }
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) setValue(el, sample(el))
    }
    const b = f.querySelector('button[type=submit],input[type=submit],button:not([type])')
    return { valid: f.checkValidity(), label: (b && label(b)) || (f.getAttribute('aria-label') || '') }
  }
  A.submit = (i) => { const f = forms()[i]; if (f) f.requestSubmit() }
  A.measure = () => {
    const text = clean()
    const media = [...document.querySelectorAll('img, canvas, video, svg')].filter(vis).length
    const leafs = {}
    for (const el of document.querySelectorAll('p,li,h1,h2,h3,h4,span,div,td,blockquote,figcaption,dd')) {
      if (el.children.length || !vis(el)) continue
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.length >= 30) leafs[t] = (leafs[t] || 0) + 1
    }
    const repeats = Object.entries(leafs).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, count]) => ({ text, count }))
    const imgs = {}
    for (const i of document.images) if (i.currentSrc && vis(i)) imgs[i.currentSrc] = (imgs[i.currentSrc] || 0) + 1
    const top = Object.entries(imgs).sort((a, b) => b[1] - a[1])[0]
    return { text: text.slice(0, 30000), mediaCount: media, repeats, sameImage: top && top[1] >= 4 ? { src: top[0], count: top[1] } : null, net: c.net }
  }
  A.canvas = () => {
    const list = [...document.querySelectorAll('canvas')].filter(vis).map((x) => ({ el: x, r: x.getBoundingClientRect() })).filter((x) => x.r.width >= 100 && x.r.height >= 100).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)
    if (!list.length) return null
    const { r } = list[0]
    A.gameCanvas = list[0].el
    return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(Math.min(r.width, innerWidth - Math.max(0, r.left))), height: Math.round(Math.min(r.height, innerHeight - Math.max(0, r.top))) }
  }
  A.play = () => {
    const el = A.gameCanvas
    if (el) {
      const r = el.getBoundingClientRect()
      const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
      el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }))
      el.dispatchEvent(new MouseEvent('mousedown', at))
      el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }))
      el.dispatchEvent(new MouseEvent('mouseup', at))
      el.dispatchEvent(new MouseEvent('click', at))
    }
    const key = (type, key, code, keyCode) => { const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }; (el || document.body).dispatchEvent(new KeyboardEvent(type, init)) }
    for (const [k, code, n] of [['Enter', 'Enter', 13], [' ', 'Space', 32], ['ArrowRight', 'ArrowRight', 39], ['ArrowUp', 'ArrowUp', 38], ['d', 'KeyD', 68], ['w', 'KeyW', 87]]) { key('keydown', k, code, n); setTimeout(() => key('keyup', k, code, n), 250) }
  }
})()`

interface Listed {
  sig: string
  nth: number
  label: string
  href: string | null
  abs: string | null
  target: string | null
  kind: 'control' | 'link' | 'looks-clickable'
  missing: boolean
}

interface Effect {
  any: boolean
  dom: boolean
  onlyHash: boolean
  junk: string | null
}
const NAVIGATED: Effect = { any: true, dom: true, onlyHash: false, junk: null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** A failed fetch on a request this probe cancelled says nothing about the product. */
const OUR_DOING = /Failed to fetch|NetworkError|ERR_BLOCKED|Load failed/i
const STAND_IN = /^https?:\/\/(www\.)?(example\.(com|org|net)|yourdomain\.|yoursite\.|domain\.com)/i

export interface ProbeResult extends InteractionProbe {
  /** Saved screenshots of the other pages it reached, for the creative review. */
  shots: string[]
}

/** Never holds up a delivery: a page that wedges everything just means this evidence is missing. */
export function probeInteractions(projectPath: string, id: string, url: string): Promise<ProbeResult> {
  return Promise.race([probe(projectPath, id, url), new Promise<ProbeResult>((_, reject) => setTimeout(() => reject(new Error('Using the app took too long')), BUDGET_MS + 30_000))])
}

async function probe(projectPath: string, id: string, url: string): Promise<ProbeResult> {
  const u = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Autopia only uses the local preview')
  const started = Date.now()
  const left = () => BUDGET_MS - (Date.now() - started)
  const partition = `interact-${id}`
  const ses = session.fromPartition(partition)
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  let cancelled = 0
  let failData = false
  const statuses = new Map<string, number>()
  ses.webRequest.onBeforeRequest((d, cb) => {
    const own = d.url.startsWith(u.origin)
    const read = d.method === 'GET' || d.method === 'HEAD' || d.method === 'OPTIONS'
    if (!read) {
      cancelled++
      return cb({ cancel: true })
    }
    if (failData && own && d.resourceType === 'xhr') return cb({ cancel: true })
    cb({})
  })
  ses.webRequest.onCompleted((d) => {
    if (d.resourceType === 'mainFrame') statuses.set(d.url, d.statusCode)
  })

  const out: ProbeResult = { pages: [], total: 0, tried: 0, unknown: 0, dead: [], crashed: [], brokenLinks: [], missingAnchors: [], placeholderLinks: [], forms: [], junkAfter: [], canvas: null, dataFailure: null, ranOut: false, shots: [] }
  const win = new BrowserWindow({ show: false, width: WIDTH, height: HEIGHT, useContentSize: true, webPreferences: { partition, offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  const wc = win.webContents
  let opened = 0
  let navigations = 0
  const exceptions: string[] = []
  try {
    wc.setWindowOpenHandler(() => {
      opened++
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, to) => {
      if (new URL(to).origin !== u.origin) {
        e.preventDefault()
        opened++
      }
    })
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) navigations++
    })
    const dbg = wc.debugger
    dbg.attach('1.3')
    dbg.on('message', (_e, method, params) => {
      if (method !== 'Runtime.exceptionThrown') return
      const d = (params as { exceptionDetails: { text: string; exception?: { description?: string } } }).exceptionDetails
      exceptions.push((d.exception?.description ?? d.text).split('\n').slice(0, 3).join(' '))
    })
    // the debugger only answers once the page has a renderer
    await wc.loadURL('about:blank')
    const ask = (method: string, params?: object) => Promise.race([dbg.sendCommand(method, params), new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} didn’t respond`)), 5000))])
    await ask('Page.enable')
    await ask('Page.addScriptToEvaluateOnNewDocument', { source: INSTALL })
    await ask('Runtime.enable')

    const exec = async <T>(code: string): Promise<T> => {
      const run = () => Promise.race([wc.executeJavaScript(`${HELPERS};${code}`, true) as Promise<T>, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('The page didn’t respond')), 5000))])
      return run().catch(async () => {
        await sleep(400)
        return run()
      })
    }
    const settle = async () => {
      for (let i = 0; i < 40 && wc.isLoading(); i++) await sleep(100)
    }
    const load = async (to: string, ms = SETTLE_MS) => {
      await Promise.race([wc.loadURL(to).catch(() => undefined), sleep(15_000)])
      await settle()
      await sleep(ms)
    }
    const pathOf = (href: string) => {
      const x = new URL(href)
      return x.pathname.replace(/\/index\.html?$/, '/') + x.search + (/^#[/!]/.test(x.hash) ? x.hash : '')
    }
    const noise = async () => {
      await exec('__ap.mark()')
      await sleep(250)
      return (await exec<{ any: boolean }>('__ap.effect()')).any
    }
    const frame = async (rect: Electron.Rectangle) => {
      const img = await wc.capturePage(rect)
      return img.isEmpty() ? null : createHash('sha1').update(img.toBitmap()).digest('hex')
    }

    /** One use of one control on the current page: true when something happened. */
    const use = async (page: string, c: Listed): Promise<'none' | 'acted' | 'gone'> => {
      await exec('__ap.mark()')
      const before = { cancelled, opened, navigations, errors: exceptions.length }
      const found = await exec<boolean>(`__ap.click(${JSON.stringify(c.sig)}, ${c.nth})`).catch(() => false)
      if (!found) return 'gone'
      await sleep(WAIT_MS)
      let eff = await exec<Effect>('__ap.effect()').catch(() => NAVIGATED)
      const happened = () => eff.any || cancelled !== before.cancelled || opened !== before.opened || navigations !== before.navigations
      if (!happened()) {
        await sleep(SECOND_WAIT_MS)
        eff = await exec<Effect>('__ap.effect()').catch(() => NAVIGATED)
      }
      if (navigations !== before.navigations) await settle()
      const fresh = exceptions.slice(before.errors).filter((e) => !OUR_DOING.test(e))
      if (fresh.length) out.crashed.push({ page, label: c.label, error: fresh[0] })
      if (eff.junk) out.junkAfter.push({ page, label: c.label, match: eff.junk })
      // throwing is its own finding, and a jump to a section that doesn't exist went nowhere
      if (fresh.length) return 'acted'
      if (c.missing && eff.onlyHash && cancelled === before.cancelled && opened === before.opened && navigations === before.navigations) return 'none'
      return happened() ? 'acted' : 'none'
    }

    const visited = new Set<string>()
    const queue = [pathOf(url)]
    const tested = new Set<string>()
    const suspects: { path: string; c: Listed }[] = []
    while (queue.length && out.pages.length < MAX_PAGES) {
      if (left() < 2000) {
        out.ranOut = true
        break
      }
      const path = queue.shift()!
      if (visited.has(path)) continue
      visited.add(path)
      const full = u.origin + path
      await load(full)
      const m = await exec<Omit<ProbedPage, 'path' | 'status'> & { net: number }>('__ap.measure()')
      out.pages.push({ path, status: statuses.get(full) ?? null, text: m.text, mediaCount: m.mediaCount, repeats: m.repeats, sameImage: m.sameImage })
      if (out.pages.length > 1 && out.shots.length < 3) {
        const img = await wc.capturePage().catch(() => null)
        if (img && !img.isEmpty()) {
          const dir = join(projectPath, '.autopia', 'quality')
          mkdirSync(dir, { recursive: true })
          const rel = `.autopia/quality/${id}-page${out.pages.length}.png`
          writeFileSync(join(projectPath, rel), img.toPNG())
          out.shots.push(rel)
        }
      }
      let noisy = await noise()
      const listed = await exec<Listed[]>('__ap.list()')
      const picks: Listed[] = []
      for (const c of listed) {
        if (c.nth > 1) continue // a grid of the same button: two is proof enough
        const key = `${c.sig}#${c.nth}`
        if (tested.has(key)) continue
        tested.add(key)
        if (c.href && /^(mailto:|tel:|sms:)/i.test(c.href)) continue
        if (c.abs && !c.abs.startsWith(u.origin) && /^https?:/i.test(c.abs)) {
          if (STAND_IN.test(c.abs)) out.placeholderLinks.push({ page: path, label: c.label, href: c.abs })
          continue
        }
        picks.push(c)
      }
      out.total += picks.length
      let dirty = false
      for (const c of picks) {
        if (left() < 1500 || out.tried >= MAX_CONTROLS) {
          out.ranOut = out.ranOut || left() < 1500
          break
        }
        if (dirty) {
          await load(full)
          noisy = await noise()
          dirty = false
        }
        out.tried++
        const result = await use(path, c)
        if (result === 'gone') {
          out.unknown++
          continue
        }
        const now = wc.getURL()
        const moved = now.startsWith(u.origin) && pathOf(now) !== path
        if (moved) {
          const status = statuses.get(now)
          if (status !== undefined && status >= 400) out.brokenLinks.push({ page: path, label: c.label, href: pathOf(now), status })
          else if (!visited.has(pathOf(now))) queue.push(pathOf(now))
          dirty = true
        } else if (result === 'acted') dirty = true
        else if (noisy) out.unknown++
        else if (c.missing) out.missingAnchors.push({ page: path, label: c.label, href: c.href ?? '' })
        else suspects.push({ path, c })
      }
      // forms, filled in with valid values
      if (dirty) await load(full)
      const formTotal = await exec<number>('__ap.formCount()')
      for (let i = 0; i < Math.min(formTotal, MAX_FORMS) && left() > 1500; i++) {
        if (i > 0) await load(full)
        noisy = await noise()
        const filled = await exec<{ valid: boolean; label: string } | null>(`__ap.fill(${i})`)
        if (!filled) continue
        if (!filled.valid) {
          out.forms.push({ page: path, label: filled.label, outcome: 'unknown' })
          continue
        }
        await exec('__ap.mark()')
        const before = { cancelled, navigations, opened }
        await exec(`__ap.submit(${i})`)
        await sleep(WAIT_MS + SECOND_WAIT_MS)
        const e = await exec<{ any: boolean; reloads: number }>('__ap.effect()').catch(() => ({ any: true, reloads: 0 }))
        const acted = e.any || cancelled !== before.cancelled || navigations !== before.navigations || opened !== before.opened
        out.forms.push({ page: path, label: filled.label, outcome: e.reloads ? 'reloads' : acted ? 'works' : noisy ? 'unknown' : 'dead' })
      }
    }
    if (queue.length) out.ranOut = out.ranOut || left() < 2000

    // "dead" is a serious thing to say, so it takes two looks: a fresh load, more time to wake up
    for (const path of [...new Set(suspects.map((s) => s.path))]) {
      if (left() < 1500) {
        out.ranOut = true
        out.unknown += suspects.filter((s) => s.path === path).length
        continue
      }
      await load(u.origin + path, CONFIRM_SETTLE_MS)
      for (const { c } of suspects.filter((s) => s.path === path)) {
        await exec('__ap.fillLoose()').catch(() => undefined)
        const again = await use(path, c)
        if (again === 'none') out.dead.push({ page: path, label: c.label, kind: c.kind === 'looks-clickable' ? 'looks-clickable' : c.kind })
        else await load(u.origin + path)
      }
    }

    // a canvas: does it move, does it answer?
    const home = u.origin + pathOf(url)
    await load(home)
    const rect = await exec<Electron.Rectangle | null>('__ap.canvas()')
    if (rect && rect.width > 0 && rect.height > 0) {
      const errors = exceptions.length
      const a = await frame(rect)
      await sleep(700)
      const b = await frame(rect)
      await exec('__ap.play()')
      await sleep(700)
      const c = await frame(rect)
      if (a && b && c) out.canvas = a !== b ? 'animated' : b !== c ? 'responds' : 'static'
      const fresh = exceptions.slice(errors).filter((e) => !OUR_DOING.test(e))
      if (fresh.length) out.crashed.push({ page: pathOf(url), label: 'playing', error: fresh[0] })
    }

    // when it loads data: what if that fails?
    const loaded = await exec<{ net: number }>('__ap.measure()').catch(() => ({ net: 0 }))
    if (loaded.net > 0 && left() > 3000) {
      failData = true
      const errors = exceptions.length
      await load(home, CONFIRM_SETTLE_MS)
      const f = await exec<{ text: string; mediaCount: number }>('__ap.measure()').catch(() => ({ text: '', mediaCount: 0 }))
      const fresh = exceptions.slice(errors).filter((e) => !OUR_DOING.test(e))
      out.dataFailure = { blank: f.text.length < 3 && f.mediaCount === 0, stuck: /\bloading\b/i.test(f.text) && f.text.length < 400, exception: fresh[0] ?? null }
    }
    return out
  } finally {
    win.destroy()
    void ses.clearStorageData().catch(() => undefined)
  }
}
