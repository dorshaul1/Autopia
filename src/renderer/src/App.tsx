import { CustomizePanel } from './components/OfficeCustomize'
import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '@shared/friendlyError'
import { PRIMARY_STAGES } from '@shared/stages'
import { ConfirmHost, Dialog, IconButton, useLinger } from './components/ui'
import { SettingsView } from './components/SettingsDialog'
import { WorldHud } from './components/WorldHud'
import { WorldInspector } from './components/WorldInspector'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Rail } from './components/shell/Rail'
import { StatusBar } from './components/shell/StatusBar'
import { Home } from './components/home/Home'
import { CommandBar } from './components/shell/CommandBar'
import { Command } from './components/shell/Command'
import { Receipt } from './components/shell/Receipt'
import { DeleteProject } from './components/ProjectActions'
import { Sheet } from './components/sheet/Sheet'
import { Workspace } from './components/workspace/Workspace'
import { ResultView } from './components/result/ResultView'
import { OfficeView, officeCamera } from './office/OfficeView'
import { Playground } from './components/playground/Playground'
import { actions, attentionItems, isSpace, store, useApp } from './store'
import { Icon } from './components/common'
import { TooltipLayer } from './components/Tooltip'

/** F6 moves between the regions of the window, the way a desktop app should. */
function cycleRegion(dir: number): void {
  const regions = ['.rail', '.cbar', '.stage', '.sheet', '.sbar'].map((q) => document.querySelector<HTMLElement>(q)).filter((x): x is HTMLElement => !!x)
  const at = regions.findIndex((r) => r.contains(document.activeElement))
  const next = regions[(at + dir + regions.length) % regions.length]
  next?.querySelector<HTMLElement>('button:not([disabled]), [href], input, textarea, select, [tabindex="0"]')?.focus()
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/** Keyboard first: every main action has a shortcut, and Esc always steps back one layer. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') return e.preventDefault(), s.palette ? store.setState({ palette: false, commandMode: null }) : actions.openCommand()
      if (mod && e.key === '\\') return e.preventDefault(), store.setState({ panelOpen: !s.panelOpen, view: isSpace(s.view) ? s.view : 'office' })
      if (mod && e.key === '0') return e.preventDefault(), store.setState({ view: 'home' })
      if (mod && e.key.toLowerCase() === 'b') return e.preventDefault(), actions.setRail(!s.railCollapsed)
      if (mod && e.key === '[' && s.panelOpen && s.sheet.length > 1 && isSpace(s.view)) return e.preventDefault(), actions.backSheet()
      if (e.key === 'F6') return e.preventDefault(), cycleRegion(e.shiftKey ? -1 : 1)
      if (mod && e.key.toLowerCase() === 'n') return e.preventDefault(), actions.startNew()
      if (mod && e.key === ',') return e.preventDefault(), store.setState({ view: 'settings' })
      if (e.key === '?' && !typing(e.target)) return e.preventDefault(), store.setState({ showShortcuts: !s.showShortcuts })
      if (mod && /^[1-4]$/.test(e.key) && s.activeProjectId) return e.preventDefault(), actions.goStage(PRIMARY_STAGES[+e.key - 1])
      if (e.key === 'Escape') {
        if (s.palette) return store.setState({ palette: false, commandMode: null })
        if (typing(e.target)) return
        // customizing answers to Esc itself (see OfficeCustomize)
        if (s.editOffice) return
        if (s.inspect) return store.setState({ inspect: null })
        if (s.view === 'settings') return actions.leaveSettings()
        if (s.panelOpen && s.sheet.length > 1) return actions.backSheet()
      }
      if (e.key === '/' && !mod && !typing(e.target)) return e.preventDefault(), actions.openCommand()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Full-page views keep their main actions top-right (Accept, for one), so notices sit at the bottom there. */
const belowHeaderActions = (s: { view: string }) => s.view === 'result' || s.view === 'workspace'

/** When the team hands back a result, say so once, with a one-click way to see it. */
function ResultToast() {
  const notes = useApp((s) => s.notifications)
  const projects = useApp((s) => s.projects)
  const low = useApp(belowHeaderActions)
  const since = useRef(Date.now())
  const [shown, setShown] = useState<(typeof notes)[number] | null>(null)
  useEffect(() => {
    const fresh = notes.find((n) => n.createdAt >= since.current && /^Result #\d+ is ready to review/.test(n.title))
    if (!fresh || fresh.id === shown?.id) return
    since.current = fresh.createdAt + 1
    // you're already looking at this project's results
    const s = store.getState()
    if (s.view !== 'result' || s.activeProjectId !== fresh.projectId) setShown(fresh)
  }, [notes])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), 12000)
    return () => clearTimeout(t)
  }, [shown])
  if (!shown || !shown.projectId) return null
  const open = async () => {
    setShown(null)
    if (store.getState().activeProjectId !== shown.projectId) await actions.openProject(shown.projectId!)
    const list = await window.autopia.deliveries(shown.projectId!)
    store.setState({ deliveries: list })
    actions.openResult(list.find((d) => d.status === 'review')?.id)
  }
  return (
    <div className={`toast toast-attn toast-result${low ? ' toast-low' : ''}`} role="status">
      <Icon name="check" size={13} />
      <span>
        <b>{projects[shown.projectId]?.name}</b> · {shown.title}
      </span>
      <button className="btn btn-sm btn-primary" onClick={open}>
        Review
      </button>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setShown(null)}>
        ×
      </button>
    </div>
  )
}

/** Without its folder a product can't be shown truthfully: this says why, above whatever the stage can still show. */
function FolderMissing() {
  const missing = useApp((s) => s.folderMissing && isSpace(s.view))
  const path = useApp((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.path : null))
  if (!missing || !path) return null
  return (
    <div className="folder-missing" role="alert">
      <Icon name="alert" size={13} />
      <span className="small">
        This product’s folder isn’t at <code>{path}</code>. Move it back and Autopia picks it up. Its history here is safe.
      </span>
      <button className="btn btn-sm" onClick={() => void actions.refreshOps()}>Check again</button>
    </div>
  )
}

/** A short, non-blocking heads-up when something new needs you and the conversation isn't open. */
function AttentionToast() {
  const items = useApp(attentionItems)
  const projects = useApp((s) => s.projects)
  const low = useApp(belowHeaderActions)
  const since = useRef(Date.now())
  const seen = useRef(new Set<string>())
  const [shown, setShown] = useState<(typeof items)[number] | null>(null)
  useEffect(() => {
    // only decisions that arrive while you're here; older ones live in the Needs-you tray
    const fresh = items.find((a) => !seen.current.has(a.id) && a.createdAt >= since.current)
    for (const a of items) seen.current.add(a.id)
    // here, the status bar and the conversation already show it; a toast is for another product
    if (fresh && fresh.projectId !== store.getState().activeProjectId) setShown(fresh)
  }, [items])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), 8000)
    return () => clearTimeout(t)
  }, [shown])
  // settled while it was up: nothing left to open
  if (!shown || !items.some((a) => a.id === shown.id)) return null
  const open = async () => {
    setShown(null)
    if (store.getState().activeProjectId !== shown.projectId) await actions.openProject(shown.projectId)
    actions.openSheet({ kind: 'conversation' })
  }
  return (
    <div className={`toast toast-attn${low ? ' toast-low' : ''}`} role="status">
      <span className="attn-dot" />
      <span>
        <b>{projects[shown.projectId]?.name}</b> · {shown.title}
      </span>
      <button className="btn btn-sm btn-primary" onClick={open}>
        Open
      </button>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setShown(null)}>
        ×
      </button>
    </div>
  )
}

const SHEET_LEAVE_MS = 130

const SHORTCUTS: [string, string][] = [
  ['⌘K or /', 'Ask, tell or search everything, in every product'],
  ['⌘0', 'Home: every product'],
  ['⌘1 to ⌘4', 'Overview, Office, Preview, Results'],
  ['⌘\\', 'Show or hide the team conversation'],
  ['⌘B', 'Show or hide the rail labels'],
  ['F6', 'Move between parts of the window'],
  ['⌘N', 'New product'],
  ['⌘,', 'Settings'],
  ['↑ ↓', 'Move through lists: search, the work on the Overview, results'],
  ['P, M, C, D, R', 'In Preview: point, mark up, compare, what it reports, reload'],
  ['Esc', 'Close the top layer'],
  ['?', 'This list']
]

function Shortcuts() {
  const open = useApp((s) => s.showShortcuts)
  if (!open) return null
  return (
    <Dialog onClose={() => store.setState({ showShortcuts: false })} title="Keyboard shortcuts">
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, what]) => (
          <div key={k}>
            <dt>{what}</dt>
            <dd>
              <kbd>{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

function DeleteHost() {
  const id = useApp((s) => s.deletingProduct)
  const project = useApp((s) => (id ? s.projects[id] : null))
  return project ? <DeleteProject project={project} onClose={() => store.setState({ deletingProduct: null })} /> : null
}

export function App() {
  const ready = useApp((s) => s.ready)
  const error = useApp((s) => s.error)
  const view = useApp((s) => s.view)
  const place = useApp((s) => `${s.activeProjectId}:${s.view}:${s.section}:${s.resultPane}`)
  const panelPlace = useApp((s) => `${s.activeProjectId}:${s.sheet.length}:${s.sheet[s.sheet.length - 1]?.kind}`)
  const customizing = useApp((s) => s.editOffice && s.view === 'office')
  const panelAsked = useApp((s) => s.panelOpen)
  const sheetWanted = useApp((s) => (s.panelOpen || (s.editOffice && s.view === 'office')) && isSpace(s.view) && !!s.activeProjectId)
  // the column stays for the moment the panel takes to leave; the office re-fits as it goes
  const sheetOpen = useLinger(sheetWanted, SHEET_LEAVE_MS)
  const panelWidth = useApp((s) => s.panelWidth)
  // the catalog leaves the way it came, unless the conversation is ready to take its place
  const customizeShown = useLinger(customizing, SHEET_LEAVE_MS) && (customizing || !panelAsked)
  useShortcuts()
  // leaving the office, or asking for the conversation, ends customizing: nothing stays half open
  useEffect(() => {
    if (view !== 'office' && store.getState().editOffice) actions.setCustomizing(false)
  }, [view])
  useEffect(() => {
    let before = store.getState()
    return store.subscribe((s) => {
      const asked = s.panelOpen !== before.panelOpen || s.sheet !== before.sheet
      const already = before.editOffice
      before = s
      if (asked && already && s.editOffice) {
        actions.setCustomizing(false)
        store.setState({ panelOpen: true })
      }
    })
  }, [])
  // The office keeps its state but stops rendering while a full view covers it.
  useEffect(() => officeCamera.setPaused(view !== 'office'), [view])
  // a fresh page starts with no preview on top (the preview pane shows it again when it's open)
  useEffect(() => void window.autopia.previewBounds(null, null), [])
  // The UI needs the Electron preload bridge; a plain browser tab only gets an explanation.
  const inElectron = typeof window.autopia !== 'undefined'

  useEffect(() => {
    if (inElectron) void actions.bootstrap().catch((err) => store.setState({ error: String(err) }))
  }, [inElectron])

  useEffect(() => {
    if (!error) return
    // long enough to read and act on; the close button is always there
    const t = setTimeout(() => store.setState({ error: null }), 15000)
    return () => clearTimeout(t)
  }, [error])

  if (!inElectron) return <div className="boot">Autopia runs in its desktop window. This browser tab only serves the UI to Electron.</div>
  if (!ready)
    return (
      <div className="boot">
        <span className="brand-mark big">
          <span>A</span>
        </span>
        Opening your studio…
      </div>
    )

  return (
    <div className={`app2${sheetOpen ? ' with-sheet' : ''}${customizeShown ? ' customizing' : ''}`} style={panelWidth ? ({ ['--sheet-w' as string]: `${panelWidth}px` } as React.CSSProperties) : undefined}>
      <ErrorBoundary label="Rail">
        <Rail />
      </ErrorBoundary>
      <ErrorBoundary label="Header">
        <CommandBar />
        <FolderMissing />
      </ErrorBoundary>
      <div className="app2-main">
        <main className="stage">
          <OfficeView />
          {view === 'home' && (
            <ErrorBoundary label="Home" page resetKey={place}>
              <Home />
            </ErrorBoundary>
          )}
          {view === 'settings' && (
            <ErrorBoundary label="Settings" page resetKey={place}>
              <SettingsView />
            </ErrorBoundary>
          )}
          {view === 'result' && (
            <ErrorBoundary label="Result" page resetKey={place}>
              <ResultView />
            </ErrorBoundary>
          )}
          {view === 'workspace' && (
            <ErrorBoundary label="Workspace" page resetKey={place}>
              <Workspace />
            </ErrorBoundary>
          )}
          {view === 'office' && <WorldHud />}
          {view === 'office' && <WorldInspector />}
          {view === 'office' && <Playground />}
          <ConfirmHost />
          <Shortcuts />
          <AttentionToast />
          <ResultToast />
          <Receipt />
          <TooltipLayer />
          {error && (
            <div className="toast toast-error" role="alert" data-tip={friendlyError(error).detail ?? undefined}>
              <Icon name="alert" size={14} />
              <span>{friendlyError(error).message}</span>
              <IconButton icon="close" label="Dismiss" size="sm" onClick={() => store.setState({ error: null })} />
            </div>
          )}
        </main>
        {customizeShown ? (
          <ErrorBoundary label="Customize">
            <CustomizePanel closing={!customizing} />
          </ErrorBoundary>
        ) : (
          sheetOpen && (
            <ErrorBoundary label="Panel" resetKey={panelPlace}>
              <Sheet />
            </ErrorBoundary>
          )
        )}
      </div>
      <ErrorBoundary label="Status">
        <StatusBar />
      </ErrorBoundary>
      <Command />
      <DeleteHost />
    </div>
  )
}
