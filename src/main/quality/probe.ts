// Loads the running app in a hidden, sandboxed, in-memory window and measures what it really rendered:
// uncaught errors, the dev server's error overlay, files that failed to load, visible content and the
// actual pixels. judgeRender (shared/delivery) decides what that means.

import { BrowserWindow, session } from 'electron'
import type { RenderSnapshot } from '@shared/delivery'

const WIDTH = 1280
const HEIGHT = 800
const LOAD_TIMEOUT_MS = 20_000
/** Client-rendered apps paint after load: wait for content up to this long. */
const CONTENT_WAIT_MS = 8000
const SETTLE_MS = 700

const MEASURE = String.raw`(() => {
  const big = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 }
  const overlayEl = document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay, #react-refresh-overlay')
  let overlay = null
  if (overlayEl) {
    const root = overlayEl.shadowRoot
    overlay = ((root && root.textContent) || overlayEl.textContent || 'error overlay').replace(/\s+/g, ' ').trim() || 'error overlay'
    if (overlayEl.tagName === 'NEXTJS-PORTAL' && !(root && root.querySelector('[data-nextjs-dialog], [data-nextjs-toast]'))) overlay = null
  }
  const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim()
  const media = [...document.querySelectorAll('img, canvas, video, svg')].filter(big).length
  return { textLength: text.length, mediaCount: media, overlay }
})()`

/** Dominant color's share of the sampled pixels (BGRA bitmap). */
function uniform(bitmap: Buffer, width: number, height: number): boolean {
  const counts = new Map<number, number>()
  let total = 0
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000)))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const key = (bitmap[i] << 16) | (bitmap[i + 1] << 8) | bitmap[i + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    }
  }
  return total > 0 && Math.max(...counts.values()) / total >= 0.999
}

/** A stuck page must fail the check, not hang the whole delivery. */
function bounded<T>(what: string, p: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} didn’t respond within ${ms / 1000}s`)), ms))])
}

export async function probeRender(url: string, id: string): Promise<RenderSnapshot> {
  const u = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Autopia only loads the local preview')
  const partition = `verify-${id}` // in-memory, discarded afterwards
  const ses = session.fromPartition(partition)
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  const snap: RenderSnapshot = { loadError: null, httpStatus: null, textLength: 0, mediaCount: 0, overlay: null, uniformFrame: null, exceptions: [], consoleErrors: [], failedRequests: [] }
  // only the app's own files count: a blocked third-party script or an offline CDN isn't its failure
  const own = (to: string) => to.startsWith(u.origin)
  ses.webRequest.onCompleted((d) => {
    if (d.url === url || d.url === `${url}/`) snap.httpStatus = d.statusCode
    else if (d.statusCode >= 400 && own(d.url)) snap.failedRequests.push(`${d.statusCode} ${d.url.replace(u.origin, '')}`)
  })
  ses.webRequest.onErrorOccurred((d) => {
    if (own(d.url) && !/ERR_ABORTED/.test(d.error)) snap.failedRequests.push(`${d.error} ${d.url.replace(u.origin, '')}`)
  })
  const win = new BrowserWindow({ show: false, width: WIDTH, height: HEIGHT, useContentSize: true, webPreferences: { partition, offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e, to) => {
      if (new URL(to).origin !== u.origin) e.preventDefault()
    })
    // uncaught exceptions come from the debugger: console.error alone is often just a warning
    const dbg = win.webContents.debugger
    dbg.attach('1.3')
    dbg.on('message', (_e, method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const d = (params as { exceptionDetails: { text: string; exception?: { description?: string } } }).exceptionDetails
        snap.exceptions.push((d.exception?.description ?? d.text).split('\n').slice(0, 4).join(' '))
      }
      if (method === 'Runtime.consoleAPICalled') {
        const p = params as { type: string; args: { value?: unknown; description?: string }[] }
        if (p.type === 'error') snap.consoleErrors.push(p.args.map((a) => String(a.value ?? a.description ?? '')).join(' ').slice(0, 300))
      }
    })
    // answered once the page's renderer exists, so it's issued with the navigation, not before it
    const enabled = dbg.sendCommand('Runtime.enable')
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`no response within ${LOAD_TIMEOUT_MS / 1000}s`)), LOAD_TIMEOUT_MS))
    ]).catch((err: Error) => {
      snap.loadError = err.message
    })
    if (!snap.loadError) {
      await bounded('The debugger', enabled)
      const deadline = Date.now() + CONTENT_WAIT_MS
      for (;;) {
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        const m = (await bounded('The page', win.webContents.executeJavaScript(MEASURE, true))) as Pick<RenderSnapshot, 'textLength' | 'mediaCount' | 'overlay'>
        Object.assign(snap, m)
        if (m.overlay || m.textLength >= 3 || m.mediaCount > 0 || Date.now() > deadline) break
      }
      const img = await bounded('The page capture', win.webContents.capturePage()).catch(() => null)
      if (img && !img.isEmpty()) {
        const size = img.getSize()
        snap.uniformFrame = uniform(img.toBitmap(), size.width, size.height)
      }
    }
    snap.failedRequests = [...new Set(snap.failedRequests)]
    snap.exceptions = [...new Set(snap.exceptions)]
    snap.consoleErrors = [...new Set(snap.consoleErrors)]
    return snap
  } catch (err) {
    snap.loadError = (err as Error).message
    return snap
  } finally {
    win.destroy()
    void ses.clearStorageData().catch(() => undefined)
  }
}
