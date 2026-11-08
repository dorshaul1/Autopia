import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { productKindOf } from '@shared/completeness'
import { STUDIO_VIEWPORTS, SURFACE_WORDS, comparePair, diagnosticsOf, readStudioPrefs, surfaceOf, type Capture, type StudioViewport } from '@shared/studio'
import type { PreviewInfo, Project } from '@shared/types'
import { activeProject, actions, useApp, store } from '../../store'
import { Icon, timeAgo } from '../common'
import { refreshProductImage } from '../home/ProductImage'
import { Segmented } from '../ui'
import { Compare, useCaptureImage } from './Compare'
import { Diagnostics, askToFix } from './Diagnostics'
import { Markup } from './Markup'
import { NotesTray, useNotes } from './Notes'
import { Outside } from './Outside'

const VIEWPORTS: { value: StudioViewport; label: string; icon: 'monitor' | 'tablet' | 'phone'; height: number }[] = [
  { value: 'desktop', label: 'Desktop', icon: 'monitor', height: 0 },
  { value: 'tablet', label: 'Tablet', icon: 'tablet', height: 1180 },
  { value: 'mobile', label: 'Phone', icon: 'phone', height: 844 }
]

const STATE: Record<PreviewInfo['status'], { word: string; tone: string }> = {
  running: { word: 'Running', tone: 'live' },
  starting: { word: 'Starting', tone: 'live' },
  stopping: { word: 'Stopping', tone: 'live' },
  stopped: { word: 'Not running', tone: 'quiet' },
  crashed: { word: 'Stopped unexpectedly', tone: 'danger' },
  unavailable: { word: 'Runs outside Autopia', tone: 'quiet' }
}

/** The product, first. A new instance per product, so nothing of one can show up in another. */
export function Studio({ head }: { head?: ReactNode }) {
  const project = useApp(activeProject)!
  return <ProductStudio key={project.id} project={project} head={head} />
}

function ProductStudio({ project, head }: { project: Project; head?: ReactNode }) {
  const stored = useApp((s) => s.preview)
  const preview = stored?.projectId === project.id ? stored : null
  const modal = useApp((s) => !!s.error || s.palette)
  const reports = useApp((s) => s.qualityReports.length)
  const prefsKey = `autopia:studio:${project.id}`
  const [prefs, setPrefsState] = useState(() => {
    try {
      return readStudioPrefs(localStorage.getItem(prefsKey))
    } catch {
      return readStudioPrefs(null)
    }
  })
  const setPrefs = (patch: Partial<typeof prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(prefsKey, JSON.stringify(next))
      } catch {
        // storage unavailable: it lasts until you leave
      }
      return next
    })
  const [mode, setMode] = useState<'live' | 'markup' | 'compare'>('live')
  const [confirming, setConfirming] = useState(false)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [marking, setMarking] = useState<Capture | null>(null)
  const [pair, setPair] = useState<[Capture, Capture] | null>(null)
  const [trayOpen, setTrayOpen] = useState(true)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const running = preview?.status === 'running'

  const loadCaptures = useCallback(() => {
    void window.autopia.studioCaptures(project.id).then(setCaptures, () => undefined)
  }, [project.id])
  useEffect(loadCaptures, [loadCaptures, reports, preview?.status])
  const notes = useNotes(project.id, running, loadCaptures)
  // look again each time it opens: the team may have added an entry point since
  useEffect(() => actions.refreshPreview(), [project.id])

  // it's on screen and it's real: this is now the product's picture everywhere
  useEffect(() => {
    if (!running || prefs.viewport !== 'desktop') return
    const t = setTimeout(() => {
      void window.autopia.rememberProductImage?.(project.id).then((ok) => ok && refreshProductImage(project.id), () => undefined)
    }, 4000)
    return () => clearTimeout(t)
  }, [running, prefs.viewport, project.id])

  // anything floating over the native view needs it out of the way; a still of the page stays in its place
  const [overlaid, setOverlaid] = useState(false)
  const [still, setStill] = useState<string | null>(null)
  useEffect(() => {
    let frameReq = 0
    let current = false
    const check = () => {
      frameReq = 0
      const el = frame.current
      if (!el) return
      const f = el.getBoundingClientRect()
      const over = [...document.querySelectorAll('.popover, .cmp-menu, .dialog, .toast, [role="dialog"], [role="menu"], [role="listbox"]')].some((n) => {
        if (n.closest('.studio .segmented')) return false
        const r = n.getBoundingClientRect()
        return r.width > 0 && r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top
      })
      if (over === current) return
      current = over
      if (!over) {
        setOverlaid(false)
        setStill(null)
        return
      }
      void window.autopia.previewFrame(project.id).catch(() => null).then((image) => {
        if (!current) return
        setStill(image)
        setOverlaid(true)
      })
    }
    const observer = new MutationObserver(() => {
      frameReq ||= requestAnimationFrame(check)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frameReq) cancelAnimationFrame(frameReq)
    }
  }, [project.id])

  const hidden = modal || overlaid || mode !== 'live'
  useLayoutEffect(() => {
    const el = frame.current
    if (!el || !running || hidden) {
      void window.autopia.previewBounds(null, null)
      return
    }
    const sync = () => {
      const r = el.getBoundingClientRect()
      setSize({ width: Math.round(r.width), height: Math.round(r.height) })
      void window.autopia.previewBounds(project.id, { x: r.left, y: r.top, width: r.width, height: r.height })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [project.id, running, hidden, prefs.viewport])
  useEffect(() => () => void window.autopia.previewBounds(null, null), [])

  const canRun = preview && preview.kind !== 'none' && !(preview.reason && /policy/.test(preview.reason))
  const start = async () => {
    if (!preview) return
    if (preview.kind === 'script' && !okd(project.id, preview.command)) {
      // you already said yes to running this command for the checks: it isn't asked again
      if (!preview.command || !(await window.autopia.mayRunCommand(project.id, preview.command))) return setConfirming(true)
      rememberOk(project.id, preview.command)
    }
    void actions.run(() => window.autopia.previewStart(project.id, preview.kind === 'script'))
  }
  // you pressed Try it: starting it is the next step anyway, so that's one press. Anything that needs your OK still asks.
  const tryIt = useApp((s) => s.tryIt)
  useEffect(() => {
    if (!tryIt || !preview) return
    store.setState({ tryIt: false })
    if (canRun && preview.status === 'stopped') void start()
  }, [tryIt, preview?.status])
  const confirmStart = () => {
    setConfirming(false)
    rememberOk(project.id, preview?.command ?? null)
    void actions.run(() => window.autopia.previewStart(project.id, true))
  }
  const stop = () => void actions.run(() => window.autopia.previewStop(project.id))

  const capture = async () => {
    const c = await actions.run(() => window.autopia.studioCapture(project.id, { source: 'you', taskId: null }))
    if (c) setCaptures((list) => [c, ...list])
    return c
  }
  const markUp = async () => {
    // the page as it is right now if it's running, otherwise the newest real picture of it
    const c = running ? await capture() : captures[0]
    if (!c) return
    setMarking(c)
    setMode('markup')
    setTrayOpen(true)
  }
  const openCompare = (taskId?: string | null) => {
    const p = comparePair(captures, taskId)
    if (!p) return
    setPair(p)
    setMode('compare')
  }
  const point = () => {
    setMode('live')
    setTrayOpen(true)
    void notes.point()
  }

  // in the Studio's own controls only: typing here never gets taken, and keys inside the page belong to the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || modal || t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape' && mode !== 'live') return e.stopPropagation(), setMode('live')
      if (e.key === 'Escape' && notes.pointing) return e.stopPropagation(), notes.cancelPoint()
      const key = e.key.toLowerCase()
      if (key === 'p' && running && !notes.pointing) point()
      else if (key === 'm' && (running || captures.length)) void markUp()
      else if (key === 'c' && captures.length > 1) openCompare()
      else if (key === 'd' && preview?.kind !== 'none') setPrefs({ drawer: !prefs.drawer })
      else if (key === 'r' && running) void window.autopia.previewReload(project.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!preview) return <div className="studio"><div className="st-center"><span className="spinner" /><p className="muted small">Looking at the project…</p></div></div>

  const surface = surfaceOf(preview, productKindOf(project.goal, project.officeType))
  const words = SURFACE_WORDS[surface]
  const { errors, warnings } = diagnosticsOf(preview.logs)
  const state = STATE[preview.status]
  const vp = VIEWPORTS.find((v) => v.value === prefs.viewport)!
  const wanted = STUDIO_VIEWPORTS[prefs.viewport]
  const live = preview.status === 'running' || preview.status === 'starting'
  const noPage = preview.kind === 'none' || preview.expects === 'process'
  const showTray = trayOpen && (notes.items.length > 0 || mode === 'markup' || notes.pointing)

  return (
    <div className="studio">
      {!focus && head}
      <div className="st-bar">
        <span className="st-state">
          <span className={`pulse-dot tone-${state.tone}`} aria-hidden />
          {state.word}
        </span>

        {mode === 'markup' && marking ? (
          <>
            <span className="small muted st-mode">Click for a spot, drag for an area, then say what should change.</span>
            <span className="grow" />
            <select className="select select-ghost st-pick" aria-label="Which capture" value={marking.path} onChange={(e) => setMarking(captures.find((c) => c.path === e.target.value)!)}>
              {captures.map((c) => (
                <option key={`${c.path}:${c.source}`} value={c.path}>
                  {new Date(c.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                </option>
              ))}
            </select>
            <button className="btn btn-sm btn-ghost" onClick={() => void notes.addMark(marking, { x: 0, y: 0, width: 1, height: 1 }, { width: marking.width, height: marking.height })}>
              The whole screen
            </button>
            <button className="btn btn-sm" onClick={() => setMode('live')} data-tip="Esc. Your notes stay.">
              Done
            </button>
          </>
        ) : mode === 'compare' ? (
          <>
            <span className="small muted st-mode">Comparing two real captures.</span>
            <span className="grow" />
            <button className="btn btn-sm" onClick={() => setMode('live')} data-tip="Esc">
              Done
            </button>
          </>
        ) : notes.pointing ? (
          <>
            <span className="small st-mode">Click something or drag across an area. Your app won’t react.</span>
            <span className="grow" />
            <button className="btn btn-sm" onClick={notes.cancelPoint}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {running && (
              <div className="st-nav">
                <button className="icon-btn" disabled={!preview.canBack} onClick={() => void window.autopia.previewNavigate(project.id, 'back')} aria-label="Back in the app" data-tip="Back in the app">
                  <Icon name="back" size={12} />
                </button>
                <button className="icon-btn st-forward" disabled={!preview.canForward} onClick={() => void window.autopia.previewNavigate(project.id, 'forward')} aria-label="Forward in the app" data-tip="Forward in the app">
                  <Icon name="back" size={12} />
                </button>
                <button className="icon-btn" onClick={() => void window.autopia.previewReload(project.id)} aria-label="Reload" data-tip="Reload (R)">
                  <Icon name="refresh" size={12} />
                </button>
                <PageField key={preview.page ?? ''} page={preview.page} onGo={(to) => void window.autopia.previewNavigate(project.id, to)} />
              </div>
            )}
            <span className="grow" />
            {running && (
              <>
                <Segmented iconOnly label="Screen size" value={prefs.viewport} onChange={(viewport) => setPrefs({ viewport })} options={VIEWPORTS.map((v) => ({ value: v.value, label: v.label, icon: v.icon, tip: v.label }))} />
                {wanted > 0 && size && <span className="small faint st-size">{size.width}×{size.height}</span>}
                <button className="btn btn-sm st-act" onClick={point} data-tip="Point at something in the app (P)">
                  <Icon name="target" size={12} /> <span>Point</span>
                </button>
              </>
            )}
            {(running || captures.length > 0) && (
              <button className="btn btn-sm st-act" onClick={() => void markUp()} data-tip={running ? 'Freeze the screen and mark it up (M)' : 'Mark up the newest capture (M)'}>
                <Icon name="crop" size={12} /> <span>Mark up</span>
              </button>
            )}
            {running && (
              <button className="icon-btn" onClick={() => void capture()} aria-label="Capture" data-tip="Keep a picture of it">
                <Icon name="camera" size={13} />
              </button>
            )}
            {captures.length > 1 && (
              <button className="icon-btn" onClick={() => openCompare()} aria-label="Compare captures" data-tip="Compare two real captures (C)">
                <Icon name="compare" size={13} />
              </button>
            )}
            {notes.items.length > 0 && !trayOpen && (
              <button className="btn btn-sm btn-ghost" onClick={() => setTrayOpen(true)}>
                <Icon name="chat" size={12} /> {notes.items.length}
              </button>
            )}
            {!noPage && (
              <button className={`btn btn-sm btn-ghost st-diag${errors ? ' bad' : ''}${prefs.drawer ? ' active' : ''}`} onClick={() => setPrefs({ drawer: !prefs.drawer })} aria-label={`What it reports: ${errors + warnings} problems`} data-tip="What the page and server report (D)">
                <Icon name="alert" size={12} /> {errors + warnings || ''}
              </button>
            )}
            {running && (
              <button className="icon-btn" onClick={() => void actions.run(() => window.autopia.previewOpenExternal(project.id))} aria-label="Open in your browser" data-tip="Open in your browser">
                <Icon name="reveal" size={13} />
              </button>
            )}
            {live && canRun && (
              <button className="icon-btn" onClick={() => void actions.run(() => window.autopia.previewRestart(project.id, true))} aria-label="Restart" data-tip="Restart">
                <Icon name="retry" size={13} />
              </button>
            )}
            {live && (
              <button className="icon-btn" onClick={stop} aria-label="Stop" data-tip="Stop">
                <Icon name="stop" size={13} />
              </button>
            )}
            {!live && canRun && !confirming && (
              <button className="btn btn-sm btn-primary" onClick={start}>
                <Icon name="play" size={12} /> {preview.status === 'crashed' ? 'Start it again' : words.start}
              </button>
            )}
          </>
        )}
      </div>

      <div className="st-body">
        <div className="st-main">
          <div className={`st-stage${wanted ? ' framed' : ''}`}>
            {mode === 'markup' && marking && <Markup projectId={project.id} capture={marking} notes={notes} />}
            {mode === 'compare' && pair && <Compare projectId={project.id} captures={captures} pair={pair} onPair={setPair} />}
            {mode === 'live' && noPage && <Outside preview={preview} surface={surface} captures={captures} />}
            {mode === 'live' && !noPage && confirming && (
              <div className="st-center">
                <div className="st-card">
                  <Icon name="shield" size={16} />
                  <h3>Run this project’s own code?</h3>
                  <p className="small">
                    Autopia will run <code>{preview.command}</code> in <code>{project.path}</code>, on this Mac only, on a free local port. It keeps running until you press Stop or quit Autopia.
                  </p>
                  {preview.reason && <p className="small warn-text">{preview.reason}</p>}
                  <div className="row gap">
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={confirmStart}>
                      Run it
                    </button>
                  </div>
                </div>
              </div>
            )}
            {mode === 'live' && !noPage && !confirming && (preview.status === 'starting' || preview.status === 'stopping') && (
              <div className="st-center">
                <span className="spinner" />
                <p className="small">{preview.status === 'stopping' ? 'Stopping' : 'Starting'}{preview.command ? ` ${preview.command}` : ''}…</p>
                {preview.logs.at(-1) && <p className="small faint mono st-last-line">{preview.logs.at(-1)}</p>}
              </div>
            )}
            {mode === 'live' && !noPage && !confirming && preview.status === 'crashed' && (
              <div className="st-center">
                <div className="st-card st-card-wide">
                  <Icon name="alert" size={18} />
                  <h3>It stopped unexpectedly</h3>
                  <p className="small bad-text">{preview.error}</p>
                  <pre className="preview-tail">{preview.logs.slice(-12).join('\n')}</pre>
                  <div className="row gap">
                    <button className="btn btn-sm" onClick={start}>
                      Start it again
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={() => askToFix(project.id, `${preview.error ?? ''}\n\n${preview.logs.slice(-12).join('\n')}`, null)}>
                      Ask the team to fix it
                    </button>
                  </div>
                </div>
              </div>
            )}
            {mode === 'live' && !noPage && !confirming && preview.status === 'stopped' && <Idle projectId={project.id} capture={captures[0] ?? null} reason={preview.reason} idle={words.idle} label={words.start} canRun={!!canRun} onStart={start} />}
            <div
              ref={frame}
              className={`st-frame${running && mode === 'live' ? ' live' : ''}`}
              style={wanted ? { maxWidth: wanted, maxHeight: vp.height || undefined } : undefined}
            >
              {running && mode === 'live' && hidden && (still ? <img className="preview-still" src={still} alt="" /> : <div className="preview-covered">Paused while something is shown on top.</div>)}
            </div>
          </div>
          {prefs.drawer && !noPage && mode === 'live' && <Diagnostics preview={preview} onClose={() => setPrefs({ drawer: false })} />}
        </div>
        {showTray && <NotesTray notes={notes} captures={captures} onClose={() => setTrayOpen(false)} onCompare={(id) => openCompare(id)} />}
      </div>
    </div>
  )
}

/** Where the page is. Enter goes there, on the preview's own address only. */
function PageField({ page, onGo }: { page: string | null; onGo: (to: string) => void }) {
  const [value, setValue] = useState(page ?? '/')
  return (
    <input
      className="st-page mono"
      aria-label="Page in the app"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onGo(value.trim() || '/')
        if (e.key === 'Escape') setValue(page ?? '/')
      }}
    />
  )
}

/** Not running: the last real picture of it, plainly marked as a picture, and how to start it. */
function Idle({ projectId, capture, reason, idle, label, canRun, onStart }: { projectId: string; capture: Capture | null; reason: string | null; idle: string; label: string; canRun: boolean; onStart: () => void }) {
  const url = useCaptureImage(projectId, capture?.path ?? null)
  return (
    <div className="st-idle">
      {url && <img src={url} alt="" />}
      <div className="st-card">
        <h3>{idle}</h3>
        {capture && <p className="small muted">The picture behind this is from {timeAgo(capture.at)}, not live.</p>}
        {reason && <p className="small warn-text">{reason}</p>}
        {canRun && (
          <button className="btn btn-primary" onClick={onStart}>
            <Icon name="play" size={12} /> {label}
          </button>
        )}
      </div>
    </div>
  )
}

/** You've OK'd this exact command for this project: it isn't asked again, until the command changes. */
const okKey = (projectId: string, command: string | null) => `autopia:preview-ok:${projectId}:${command}`
export function okd(projectId: string, command: string | null): boolean {
  try {
    return localStorage.getItem(okKey(projectId, command)) === '1'
  } catch {
    return false
  }
}
export function rememberOk(projectId: string, command: string | null): void {
  try {
    localStorage.setItem(okKey(projectId, command), '1')
  } catch {
    // storage unavailable: it asks again next time
  }
}
