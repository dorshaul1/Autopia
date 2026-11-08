import { RETURN_AFTER_MS } from '@shared/projectHome'
import type { OpKind, OpsConfig } from '@shared/environment'
import { checkView, type CheckView, type OpsState } from '@shared/operations'
import { placeOf, type Stage } from '@shared/stages'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { PushEvent, UsageView } from '@shared/ipc'
import type {
  Approval,
  ClaudeInfo,
  Delivery,
  PreviewInfo,
  ValidationRun,
  Employee,
  EmployeeAttention,
  EmployeeStatus,
  ManagerAction,
  Notification,
  OfficeConfig,
  Project,
  Run,
  RunEvent,
  Settings,
  Task, ProductSpec, QualityReport, Message } from '@shared/types'
import { DEFAULT_OFFICE } from '@shared/types'
import { settleFirstRun } from './components/home/firstRunStage'

/** What the side sheet shows; a stack so Back returns to where you were. */
export const PANEL_WIDTH = { min: 340, max: 760 }
function savedWidth(): number | null {
  try {
    const w = Number(localStorage.getItem('autopia.panelWidth'))
    return w >= PANEL_WIDTH.min && w <= PANEL_WIDTH.max ? w : null
  } catch {
    return null
  }
}

export type SheetEntry = { kind: 'conversation' } | { kind: 'employee'; id: string } | { kind: 'task'; id: string } | { kind: 'log'; runId: string }

/** Where the Composer sends: a project (optionally aimed at a teammate, task or result), or a new project. */
export interface ComposerTarget {
  newProject: boolean
  employeeId: string | null
  taskId: string | null
  deliveryId: string | null
}

/** Sections of the Company view and of Settings (deep-linkable from anywhere). */
export type SettingsSection = 'claude' | 'skills' | 'permissions' | 'work' | 'notifications' | 'memory'

export type WorkspaceSection = 'product' | 'overview' | 'activity' | 'files' | 'operations' | 'knowledge' | 'insights'
export type ResultPane = 'preview' | 'changes' | 'checks' | 'all'

const MAX_EVENTS_PER_RUN = 600

export interface AppState {
  ready: boolean
  claude: ClaudeInfo | null
  /** Claude Code plan usage as the CLI last reported it (no estimates). */
  usage: UsageView | null
  /** The indicator above each teammate that waits for you (from the main process, all projects). */
  indicators: EmployeeAttention[]
  /** What the next message replies to (shown above the composer; sent along as context). */
  replyTo: { who: string; text: string; messageId?: string } | null
  settings: Settings | null
  /** The team of the office in view (each project has its own office and team). */
  employees: Employee[]
  /** Everyone, in every office. */
  allEmployees: Employee[]
  statuses: Record<string, EmployeeStatus>
  projects: Record<string, Project>
  activeProjectId: string | null
  tasks: Record<string, Task>
  runs: Record<string, Run>
  approvals: Record<string, Approval>
  events: Record<string, RunEvent[]>
  selectedEmployeeId: string | null
  focusedRunId: string | null
  /** A file another panel asked the file browser to show. */
  openFilePath: string | null
  /** World object the founder clicked (see office INTERACTIVES). */
  inspect: string | null
  /** Who the office camera is following (set by the scene; null when you move the camera yourself). */
  followingId: string | null
  view: 'home' | 'office' | 'workspace' | 'result' | 'settings'
  /** Everything but the current stage steps aside. */
  /** Places you've been, for Back and Forward. */
  /** The rail shows only status dots, leaving more room for the work. */
  railCollapsed: boolean
  /** When you were last in the open product; what "since you were here" counts from. */
  lastSeen: number | null
  /** What the Results area shows next to the result's summary. */
  resultPane: ResultPane
  settingsSection: SettingsSection
  /** The result shown in the Result view (kept when you go back to the office). */
  resultId: string | null
  section: WorkspaceSection
  /** Delivery selected in the review section. */
  reviewId: string | null
  deliveries: Delivery[]
  validations: ValidationRun[]
  /** What this project is and where it stands, read from its folder. */
  ops: OpsState | null
  /** This product's folder has gone: nothing here describes it until it's back. */
  folderMissing: boolean
  /** Something asked for from ⌘K, waiting for the Operations stage. */
  opsIntent: { kind: OpsIntentKind } | null
  /** Latest quality report per id for the active project (pushed while audits run). */
  qualityReports: QualityReport[]
  preview: PreviewInfo | null
  /** Product spec of the active project (product mode only). */
  product: ProductSpec | null
  notifications: Notification[]
  managerActions: ManagerAction[]
  /** A mini-game open over the office. Nothing else in the app depends on it. */
  playing: { game: 'pong' | 'foosball' | 'hotfix'; night?: boolean } | null
  /** You asked to try a result: the preview starts it if it can, once. */
  tryIt: boolean
  panelOpen: boolean
  /** Team replies that arrived while the conversation wasn't on screen. */
  unread: number
  /** The side panel's width (dragged), and whether the conversation takes the whole stage. */
  panelWidth: number | null
  /** A folder you already picked to open as a project. */
  openFolder: string | null
  showShortcuts: boolean
  /** Office customization (cosmetic, this project's own) and whether the founder is arranging the office. */
  office: OfficeConfig
  /** The piece selected while customizing, the catalog piece being placed, and what the office has to say about it. */
  arrange: ArrangeTarget | null
  placing: string | null
  arrangeNote: string | null
  editOffice: boolean
  /** Bumped when the layout is reset, so the scene rebuilds from defaults. */
  error: string | null
  sheet: SheetEntry[]
  messages: Message[]
  /** Pending decisions across all projects (the Needs-you tray). */
  attention: Record<string, Approval>
  board: import('@shared/decisions').BoardItem[]
  /** A message a search found: the conversation brings it into view once. */
  revealMessage: string | null
  palette: boolean
  /** What the Command is for right now; null is everything. */
  commandMode: 'direction' | null
  /** What became of the last thing sent from the Command. */
  receipt: { kind: 'message'; projectId: string; messageId: string } | { kind: 'direction'; projectId: string; outcome: string } | null
  /** The conversation narrowed to one teammate. */
  threadWith: string | null
  /** The product a confirm-delete dialog is open for. */
  deletingProduct: string | null
  /** Words carried from the Command into Home's creator. */
  creatorText: string | null
  target: ComposerTarget
  /** Bumped to move keyboard focus into the Composer. */
  composerFocus: number
}

export const store = createStore<AppState>(() => ({
  ready: false,
  claude: null,
  usage: null,
  indicators: [],
  replyTo: null,
  settings: null,
  employees: [],
  allEmployees: [],
  statuses: {},
  projects: {},
  activeProjectId: null,
  tasks: {},
  runs: {},
  approvals: {},
  events: {},
  selectedEmployeeId: null,
  focusedRunId: null,
  openFilePath: null,
  inspect: null,
  view: 'office',
  resultPane: 'preview',
  railCollapsed: false,
  lastSeen: null,
  settingsSection: 'claude',
  resultId: null,
  playing: null,
  tryIt: false,
  section: 'overview',
  followingId: null,
  reviewId: null,
  deliveries: [],
  validations: [],
  ops: null,
  folderMissing: false,
  opsIntent: null,
  qualityReports: [],
  preview: null,
  product: null,
  notifications: [],
  managerActions: [],
  panelOpen: true,
  unread: 0,
  panelWidth: savedWidth(),
  openFolder: null,
  showShortcuts: false,
  office: DEFAULT_OFFICE,
  arrange: null,
  placing: null,
  arrangeNote: null,
  editOffice: false,
  error: null,
  sheet: [{ kind: 'conversation' }],
  messages: [],
  attention: {},
  board: [],
  revealMessage: null,
  palette: false,
  commandMode: null,
  receipt: null,
  threadWith: null,
  deletingProduct: null,
  creatorText: null,
  target: { newProject: false, employeeId: null, taskId: null, deliveryId: null },
  composerFocus: 0
}))

// Shallow comparison lets selectors derive arrays without re-rendering on every store change.
export const useApp = <T>(selector: (s: AppState) => T): T => useStore(store, useShallow(selector))

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map((i) => [i.id, i]))
const LAST_PROJECT = 'autopia:lastProject'
const PLACE = 'autopia:place'

/** A product's spaces: the conversation and details panel travels with you through these. */
export const isSpace = (view: AppState['view']) => view === 'office' || view === 'result' || view === 'workspace'

type Place = Partial<Pick<AppState, 'view' | 'section' | 'resultPane' | 'panelOpen' | 'railCollapsed'>>
function readPlace(): Place | null {
  try {
    const place = JSON.parse(localStorage.getItem(PLACE) ?? 'null') as Place | null
    // a window can remember a page that has since gone: never land on nothing
    return place && !['home', 'office', 'workspace', 'result', 'settings'].includes(place.view ?? '') ? { ...place, view: 'home' } : place
  } catch {
    return null
  }
}

/** How one product's workspace was left. */
type WorkspaceLayout = Pick<AppState, 'section' | 'resultPane' | 'panelOpen'> & {
  view: 'office' | 'workspace' | 'result'
  /** What the panel and the Deliveries stage were showing. Checked against the records before it's used. */
  panel?: SheetEntry | null
  resultId?: string | null
  thread?: string | null
}
const workspaceKey = (id: string) => `autopia:workspace:${id}`
function readWorkspace(id: string): WorkspaceLayout | null {
  try {
    return JSON.parse(localStorage.getItem(workspaceKey(id)) ?? 'null') as WorkspaceLayout | null
  } catch {
    return null
  }
}

export interface NavPlace {
  projectId: string | null
  view: AppState['view']
  section: WorkspaceSection
  resultPane: ResultPane
}
const placeNow = (s: AppState): NavPlace => ({ projectId: s.activeProjectId, view: s.view, section: s.section, resultPane: s.resultPane })

const seenKey = (id: string) => `autopia:seen:${id}`
function readSeen(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(seenKey(id)))
    return v > 0 ? v : null
  } catch {
    return null
  }
}
function markSeen(id: string | null): void {
  if (!id) return
  try {
    localStorage.setItem(seenKey(id), String(Date.now()))
  } catch {
    // storage unavailable: no summary next time
  }
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => markSeen(store.getState().activeProjectId))

/** Where you were when you opened Settings: the way back goes there, not to a fixed page. */
let beforeSettings: Pick<AppState, 'view' | 'section' | 'resultPane'> | null = null

let placeWatch: (() => void) | null = null
function keepPlace(): void {
  placeWatch?.()
  placeWatch = store.subscribe((s, prev) => {
    if (s.view === 'settings' && prev.view !== 'settings') beforeSettings = { view: prev.view, section: prev.section, resultPane: prev.resultPane }
    const now = placeNow(s)
    const was = placeNow(prev)
    if (now.view === was.view && s.section === prev.section && s.resultPane === prev.resultPane && s.panelOpen === prev.panelOpen && s.railCollapsed === prev.railCollapsed && s.sheet === prev.sheet && s.resultId === prev.resultId && s.threadWith === prev.threadWith && now.projectId === was.projectId) return
    try {
      localStorage.setItem(PLACE, JSON.stringify({ view: s.view, section: s.section, resultPane: s.resultPane, panelOpen: s.panelOpen, railCollapsed: s.railCollapsed } satisfies Place))
      if (s.activeProjectId && isSpace(s.view) && s.activeProjectId === prev.activeProjectId) {
        localStorage.setItem(workspaceKey(s.activeProjectId), JSON.stringify({ view: s.view as WorkspaceLayout['view'], section: s.section, resultPane: s.resultPane, panelOpen: s.panelOpen, panel: s.sheet.length > 1 ? s.sheet[s.sheet.length - 1] : null, resultId: s.resultId, thread: s.threadWith } satisfies WorkspaceLayout))
      }
    } catch {
      // storage unavailable: you just start from the office next time
    }
  })
}

let unsubscribe: (() => void) | null = null
let openTicket = 0

/** A project's office team: its own people, or the original team for projects that predate offices. */
export function teamOf(all: Employee[], projectId: string | null): Employee[] {
  const own = projectId ? all.filter((e) => e.projectId === projectId) : []
  return own.length ? own : all.filter((e) => !e.projectId)
}

let boardAsked = 0
let boardTimer: ReturnType<typeof setTimeout> | null = null
/** Many events in a row cost one read. */
const queueBoard = () => {
  boardTimer ??= setTimeout(() => {
    boardTimer = null
    void actions.refreshBoard()
  }, 150)
}

/** What was on screen, only if it still exists. A deleted task or finished-with teammate quietly falls back. */
export function restoredPanel(saved: Pick<WorkspaceLayout, 'panel' | 'resultId' | 'thread'> | null, has: { task: (id: string) => boolean; run: (id: string) => boolean; employee: (id: string) => boolean; delivery: (id: string) => boolean }): { sheet: SheetEntry[]; resultId: string | null; threadWith: string | null } {
  const home: SheetEntry = { kind: 'conversation' }
  const p = saved?.panel
  const alive = p && ((p.kind === 'task' && has.task(p.id)) || (p.kind === 'employee' && has.employee(p.id)) || (p.kind === 'log' && has.run(p.runId)))
  return {
    sheet: alive ? [home, p] : [home],
    resultId: saved?.resultId && has.delivery(saved.resultId) ? saved.resultId : null,
    threadWith: saved?.thread && (has.employee(saved.thread) || /^(reception:|office:)/.test(saved.thread)) ? saved.thread : null
  }
}

let officeSaves = 0

export type ArrangeTarget = { kind: 'piece'; uid: string; key: string } | { kind: 'hung'; id: string } | { kind: 'poster' } | { kind: 'dog' }

export const actions = {
  async bootstrap() {
    const [data, office] = await Promise.all([window.autopia.bootstrap(), window.autopia.officeConfig(null)])
    store.setState({
      ready: true,
      office,
      claude: data.claude,
      settings: data.settings,
      employees: teamOf(data.employees, null),
      allEmployees: data.employees,
      statuses: Object.fromEntries(data.statuses.map((s) => [s.employeeId, s])),
      projects: byId(data.projects)
    })
    settleFirstRun(data.projects.length)
    // one subscription only: starting up twice (React's dev double-run, a reload) would double every event
    unsubscribe?.()
    unsubscribe = window.autopia.onEvent(applyEvent)
    void window.autopia.allDecisions().then((list) => store.setState({ attention: byId(list) }))
    void actions.refreshBoard()
    void window.autopia.notifications().then((notifications) => store.setState({ notifications }))
    void window.autopia.attention().then((indicators) => store.setState({ indicators }))
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_PROJECT)
    } catch {
      // storage unavailable
    }
    const initial = (last && data.projects.find((p) => p.id === last)) || data.projects[0]
    // nothing saves while this starts up, and the one saved place from before becomes this product's layout once
    placeWatch?.()
    placeWatch = null
    const place = readPlace()
    if (place && initial && !readWorkspace(initial.id) && place.view && isSpace(place.view)) {
      try {
        localStorage.setItem(workspaceKey(initial.id), JSON.stringify({ view: place.view, section: place.section ?? 'tasks', resultPane: place.resultPane ?? 'preview', panelOpen: place.panelOpen ?? true }))
      } catch {
        // storage unavailable: it opens in the office
      }
    }
    if (initial) await actions.openProject(initial.id)
    else store.setState({ view: 'home', target: { newProject: true, employeeId: null, taskId: null, deliveryId: null } })
    // back where you were; a place that no longer exists falls back to something that does
    if (place) store.setState({ railCollapsed: !!place.railCollapsed, ...(place.view === 'home' ? { view: 'home' as const } : {}) })
    keepPlace()
  },

  /** Opens a product where you were last working in it; the one you're in just comes to the front. */
  async goToProduct(id: string, overview = false) {
    const s = store.getState()
    if (s.activeProjectId !== id) await actions.openProject(id)
    else if (!isSpace(s.view)) store.setState({ view: readWorkspace(id)?.view ?? 'workspace', section: readWorkspace(id)?.section ?? 'overview' })
    if (overview) store.setState({ view: 'workspace', section: 'overview' })
  },

  /** The conversation, with one teammate or everyone. Who you're talking to is also who the next message goes to. */
  talkTo(employeeId: string | null) {
    actions.openSheet({ kind: 'conversation' })
    store.setState((s) => ({ threadWith: employeeId, target: { ...s.target, newProject: false, employeeId }, composerFocus: s.composerFocus + 1 }))
  },

  /** Opens the Command, for anything; for one purpose when a page asks. */
  openCommand(mode: 'direction' | null = null) {
    store.setState({ palette: true, commandMode: mode })
  },

  /** Starting something new always happens in one place. */
  startNew() {
    store.setState((s) => ({ view: 'home', openFolder: null, composerFocus: s.composerFocus + 1 }))
  },

  setRail(collapsed: boolean) {
    store.setState({ railCollapsed: collapsed })
  },

  /** Out of Settings, back to wherever you came from. With no product open that's Home. */
  leaveSettings() {
    const s = store.getState()
    const to = beforeSettings
    beforeSettings = null
    if (!s.activeProjectId || !to || to.view === 'home') return store.setState({ view: s.activeProjectId && !to ? 'workspace' : 'home', ...(s.activeProjectId && !to ? { section: 'overview' as const } : {}) })
    store.setState(to)
  },

  /** Go to something in the current product, from anywhere. */
  goStage(stage: Stage) {
    const s = store.getState()
    store.setState({ section: s.section, resultPane: s.resultPane, ...placeOf(stage, s.resultPane) })
  },

  /** The toolbar's Customize button, Done and Esc: the only ways in and out of customizing. */
  setCustomizing(on: boolean) {
    if (on) actions.select(null)
    store.setState({ editOffice: on, arrange: null, placing: null, arrangeNote: null, ...(on ? { inspect: null, playing: null } : {}) })
  },

  /** Persist a cosmetic office change (layout, accent, artwork). */
  async saveOffice(patch: Partial<OfficeConfig>) {
    const { office, activeProjectId: project } = store.getState()
    const next = { ...office, ...patch }
    const ticket = ++officeSaves
    store.setState({ office: next })
    const saved = await actions.run(() => window.autopia.saveOfficeConfig(project, next))
    // only the latest save speaks for this project: a slower, older answer never undoes a newer change
    if (saved && ticket === officeSaves && store.getState().activeProjectId === project) store.setState({ office: saved })
  },

  /** Asks the folder again. A stale answer for another product is dropped. */
  async refreshOps(): Promise<void> {
    const id = store.getState().activeProjectId
    if (!id || typeof window.autopia.opsState !== 'function') return
    const there = await window.autopia.projectFolderExists(id).catch(() => true)
    if (store.getState().activeProjectId === id) store.setState({ folderMissing: !there })
    const state = await window.autopia.opsState(id).catch(() => null)
    if (state && store.getState().activeProjectId === id) store.setState({ ops: state })
  },

  async saveOpsConfig(config: OpsConfig): Promise<void> {
    const id = store.getState().activeProjectId
    if (!id) return
    const state = await actions.run(() => window.autopia.opsSaveConfig(id, config))
    if (state) store.setState({ ops: state, preview: await window.autopia.previewInfo(id) })
  },

  async openProject(id: string) {
    if (store.getState().activeProjectId !== id) store.setState({ playing: null })
    const ticket = ++openTicket
    // everything first, then one change: the screen never flashes empty, and the last click wins
    const [snap, messages, deliveries, validations, preview, product, office] = await Promise.all([window.autopia.getProject(id), window.autopia.messages(id), window.autopia.deliveries(id), window.autopia.validations(id), window.autopia.previewInfo(id), window.autopia.productSpec(id), window.autopia.officeConfig(id)])
    if (ticket !== openTicket) return
    const saved = readWorkspace(id)
    // gone a while: the Overview says what happened, before anything else
    const seen = readSeen(id)
    const returning = !saved || (seen !== null && Date.now() - seen >= RETURN_AFTER_MS)
    markSeen(store.getState().activeProjectId)
    markSeen(id)
    void window.autopia.projectFolderExists?.(id).then((there) => store.getState().activeProjectId === id && store.setState({ folderMissing: !there }), () => undefined)
    store.setState((s) => ({
      activeProjectId: id,
      // each project's office comes with it, in the same change, so it never shows another project's touches
      office,
      ...(s.activeProjectId === id ? {} : { editOffice: false, arrange: null, placing: null, arrangeNote: null }),
      employees: teamOf(s.allEmployees, id),
      projects: { ...s.projects, [id]: snap.project },
      tasks: byId(snap.tasks),
      runs: byId(snap.runs),
      approvals: byId(snap.approvals),
      events: {},
      focusedRunId: snap.runs[0]?.id ?? null,
      deliveries,
      validations,
      // the same product opened again keeps what it knows: Operations won't ask until it next refreshes
      ops: s.activeProjectId === id ? s.ops : null,
      opsIntent: null,
      qualityReports: [],
      preview,
      product,
      reviewId: null,
      messages,
      ...restoredPanel(saved, {
        task: (t) => snap.tasks.some((x) => x.id === t),
        run: (r) => snap.runs.some((x) => x.id === r),
        employee: (e) => teamOf(s.allEmployees, id).some((x) => x.id === e),
        delivery: (d) => deliveries.some((x) => x.id === d)
      }),
      target: { newProject: false, employeeId: null, taskId: null, deliveryId: null },
      // each product opens the way you left it
      lastSeen: seen,
      // nothing aimed at one product follows you into another
      receipt: null,
      replyTo: null,
      view: returning ? 'workspace' : saved.view,
      section: returning ? 'overview' : saved.section,
      resultPane: saved?.resultPane ?? 'preview',
      panelOpen: saved?.panelOpen ?? true
    }))
    void window.autopia.managerActions(id).then((loaded) => {
      // merge with anything pushed while loading
      const ids = new Set(loaded.map((x) => x.id))
      store.setState((st) => ({ managerActions: [...st.managerActions.filter((x) => !ids.has(x.id) && x.projectId === id), ...loaded] }))
    })
    try {
      localStorage.setItem(LAST_PROJECT, id)
    } catch {
      // storage unavailable
    }
    // Load the history of the most recent runs so the activity feed is populated after restarts.
    await Promise.all(snap.runs.slice(0, 6).map((r) => actions.loadEvents(r.id)))
  },

  /** Re-checks what the active project can preview (it changes as the team adds files). */
  refreshPreview() {
    const id = store.getState().activeProjectId
    if (!id) return
    void window.autopia
      .previewInfo(id)
      .then((preview) => store.getState().activeProjectId === id && store.setState({ preview }))
      .catch(() => undefined)
  },

  async loadEvents(runId: string) {
    const events = await window.autopia.runEvents(runId)
    store.setState((s) => {
      // keep anything pushed while the load was in flight, once each
      const seen = new Set(events.map((x) => x.id))
      const merged = [...events, ...(s.events[runId] ?? []).filter((x) => !seen.has(x.id))]
      return { events: { ...s.events, [runId]: merged.slice(-MAX_EVENTS_PER_RUN) } }
    })
  },

  /** A card can outlive its decision (a restart ended that session): quietly take it away. */
  refreshDecisions() {
    void window.autopia.allDecisions().then((list) => store.setState({ attention: Object.fromEntries(list.map((a) => [a.id, a])) }))
    const id = store.getState().activeProjectId
    if (id) void window.autopia.getProject(id).then((p) => store.setState({ approvals: Object.fromEntries(p.approvals.map((a) => [a.id, a])) }))
  },

  async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err) {
      const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (/already made/.test(msg)) actions.refreshDecisions()
      else store.setState({ error: msg })
      return undefined
    }
  },

  select(employeeId: string | null) {
    store.setState({ selectedEmployeeId: employeeId })
    if (employeeId) actions.openSheet({ kind: 'employee', id: employeeId })
  },

  /** Shows something in the side sheet; Back returns to what was there. */
  openSheet(entry: SheetEntry) {
    store.setState((s) => {
      const top = s.sheet[s.sheet.length - 1]
      const same = JSON.stringify(top) === JSON.stringify(entry)
      const base = entry.kind === 'conversation' ? [] : s.sheet.filter((x) => x.kind === 'conversation').slice(0, 1)
      return { panelOpen: true, view: isSpace(s.view) ? s.view : 'office', sheet: same ? s.sheet : entry.kind === 'conversation' ? [entry] : [...(base.length ? base : [{ kind: 'conversation' as const }]), ...s.sheet.slice(1).filter((x) => JSON.stringify(x) !== JSON.stringify(entry)).slice(-3), entry] }
    })
  },

  backSheet() {
    store.setState((s) => (s.sheet.length > 1 ? { sheet: s.sheet.slice(0, -1), selectedEmployeeId: null } : { panelOpen: false }))
  },

  /**
   * Opens what an item is about, reusing the existing views: a result to review, the task with its
   * decision, or the conversation for plans and project-wide items. Marks it read.
   */
  /** Everything that needs you, as the backend sees it now. Answers from an older question are dropped. */
  async refreshBoard() {
    if (typeof window.autopia.decisionBoard !== 'function') return
    const asked = ++boardAsked
    const board = await window.autopia.decisionBoard().catch(() => null)
    if (board && asked === boardAsked) store.setState({ board })
  },

  async openNotice(n: Pick<Notification, 'id' | 'projectId' | 'taskId' | 'deliveryId' | 'employeeId'> & { read?: boolean }) {
    if (n.id && !n.read) {
      void window.autopia.markNotificationsRead([n.id])
      store.setState((s) => ({ notifications: s.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }))
    }
    return actions.openAttention(n)
  },

  async openAttention(t: { projectId: string | null; taskId?: string | null; deliveryId?: string | null; employeeId?: string | null }) {
    if (!t.projectId) return
    if (store.getState().activeProjectId !== t.projectId) await actions.openProject(t.projectId)
    if (t.deliveryId) {
      const list = await window.autopia.deliveries(t.projectId)
      store.setState({ deliveries: list })
      return actions.openDelivery(t.deliveryId)
    }
    store.setState({ view: 'office' })
    if (t.taskId) actions.openSheet({ kind: 'task', id: t.taskId })
    else actions.openSheet({ kind: 'conversation' })
  },

  /** Open a folder as a project: the folder first, since that's the whole question. */
  async openFolder() {
    const dir = await window.autopia.pickDirectory()
    if (dir) store.setState((s) => ({ view: 'home', openFolder: dir, composerFocus: s.composerFocus + 1 }))
  },

  /** Results, at a given pane: the running app, the code changes, the checks, or every result. */
  openPane(pane: ResultPane) {
    store.setState({ view: 'result', resultPane: pane })
  },

  /** A search result, wherever it lives: its own product first, then its place in it. */
  async openHit(h: import('@shared/types').SearchHit) {
    if (store.getState().activeProjectId !== h.projectId) await actions.openProject(h.projectId)
    if (h.kind === 'task') {
      actions.goStage('overview')
      return actions.openSheet({ kind: 'task', id: h.id })
    }
    if (h.kind === 'delivery') return actions.openDelivery(h.id)
    if (h.kind === 'employee') return actions.openSheet({ kind: 'employee', id: h.id })
    if (h.kind === 'file') return store.setState({ view: 'workspace', section: 'files', openFilePath: h.id })
    store.setState({ revealMessage: h.id, threadWith: null })
    actions.openSheet({ kind: 'conversation' })
  },

  /** One delivery, presented in full, with the product's history beside it. */
  openDelivery(deliveryId?: string) {
    const s = store.getState()
    const id = deliveryId ?? s.deliveries.find((d) => d.status === 'review')?.id ?? s.deliveries.find((d) => d.completedAt)?.id ?? s.deliveries[0]?.id ?? null
    store.setState({ view: 'result', resultPane: 'all', resultId: id })
  },

  /** Opens a result in the focused Result view (the latest one when no id is given). */
  openResult(deliveryId?: string) {
    const s = store.getState()
    const id = deliveryId ?? s.deliveries.find((d) => d.status === 'review')?.id ?? s.deliveries.find((d) => d.completedAt)?.id ?? null
    if (!id) return store.setState({ error: 'Nothing to review yet. Results appear here when the team finishes a request.' })
    store.setState({ tryIt: true, view: 'result', resultPane: 'preview', resultId: id, target: { newProject: false, employeeId: null, taskId: null, deliveryId: id } })
  },

  /** Aims the Composer (at a teammate, task or result) and moves focus into it. */
  compose(target: Partial<ComposerTarget>) {
    // the composer lives in the conversation: bring it up from wherever you are
    store.setState((s) => ({ panelOpen: true, sheet: [{ kind: 'conversation' }], target: { newProject: false, employeeId: null, taskId: null, deliveryId: null, ...target }, composerFocus: s.composerFocus + 1 }))
  }
}

// Agents can stream many lines a second, and nobody reads faster than the screen: they land together.
let pendingEvents: RunEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
function queueRunEvent(event: RunEvent): void {
  pendingEvents.push(event)
  flushTimer ??= setTimeout(flushRunEvents, 50)
}
function flushRunEvents(): void {
  flushTimer = null
  const batch = pendingEvents
  pendingEvents = []
  store.setState((s) => {
    const events = { ...s.events }
    for (const event of batch) {
      const list = events[event.runId] ?? []
      // the same event can arrive twice (a load racing a push, or a listener re-registered by a reload)
      if (list.some((x) => x.id === event.id)) continue
      events[event.runId] = list.length >= MAX_EVENTS_PER_RUN ? [...list.slice(1), event] : [...list, event]
    }
    return { events }
  })
}

function applyEvent(e: PushEvent): void {
  const s = store.getState()
  switch (e.type) {
    case 'claude':
      store.setState({ claude: e.info })
      break
    case 'usage':
      store.setState({ usage: e.usage })
      break
    case 'employee':
      store.setState({ statuses: { ...s.statuses, [e.status.employeeId]: e.status } })
      break
    case 'project':
      store.setState({ projects: { ...s.projects, [e.project.id]: e.project } })
      break
    case 'projectDeleted': {
      const { [e.projectId]: _gone, ...rest } = s.projects
      void _gone
      store.setState({ projects: rest })
      if (s.activeProjectId === e.projectId) {
        const next = Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (next) void actions.openProject(next.id)
        else store.setState({ activeProjectId: null, tasks: {}, runs: {}, approvals: {}, events: {}, deliveries: [], validations: [], ops: null, qualityReports: [], preview: null, product: null, messages: [], target: { newProject: true, employeeId: null, taskId: null, deliveryId: null } })
      }
      break
    }
    case 'task':
      if (e.task.projectId === s.activeProjectId) {
        store.setState({ tasks: { ...s.tasks, [e.task.id]: e.task } })
        // a finished step merges files into the project: what can be previewed may have changed
        if (e.task.status === 'done' && s.tasks[e.task.id]?.status !== 'done') actions.refreshPreview()
      }
      break
    case 'run':
      if (e.run.projectId === s.activeProjectId) {
        const isNew = !s.runs[e.run.id]
        store.setState({
          runs: { ...s.runs, [e.run.id]: e.run },
          ...(isNew ? { focusedRunId: e.run.id } : {})
        })
      }
      break
    case 'runEvent':
      if (e.projectId === s.activeProjectId) queueRunEvent(e.event)
      break
    case 'team':
      store.setState({ allEmployees: e.employees, employees: teamOf(e.employees, s.activeProjectId) })
      break
    case 'notification': {
      // one entry per item: a repeat or a resolution replaces it in place
      const rest = s.notifications.filter((n) => n.id !== e.notification.id)
      store.setState({ notifications: [e.notification, ...rest].slice(0, 200) })
      queueBoard()
      break
    }
    case 'attention':
      store.setState({ indicators: e.items })
      queueBoard()
      break
    case 'openNotification':
      void actions.openNotice(e.notification)
      break
    case 'managerAction':
      if (e.action.projectId === s.activeProjectId && !s.managerActions.some((x) => x.id === e.action.id)) store.setState({ managerActions: [e.action, ...s.managerActions].slice(0, 100) })
      break
    case 'delivery':
      if (e.delivery.projectId === s.activeProjectId) {
        const rest = s.deliveries.filter((d) => d.id !== e.delivery.id)
        store.setState({ deliveries: [e.delivery, ...rest].sort((a, b) => b.number - a.number) })
      }
      break
    case 'product':
      if (e.spec.projectId === s.activeProjectId) store.setState({ product: e.spec })
      break
    case 'quality':
      if (e.report.projectId === s.activeProjectId) {
        const rest = s.qualityReports.filter((r) => r.id !== e.report.id)
        store.setState({ qualityReports: [e.report, ...rest].sort((a, b) => b.startedAt - a.startedAt) })
      }
      break
    case 'validation':
      if (e.validation.projectId === s.activeProjectId) {
        const rest = s.validations.filter((v) => v.id !== e.validation.id)
        store.setState({ validations: [e.validation, ...rest].sort((a, b) => b.startedAt - a.startedAt) })
        if (e.validation.status !== 'running') void actions.refreshOps()
      }
      break
    case 'preview':
      if (e.preview.projectId === s.activeProjectId) store.setState({ preview: e.preview })
      break
    case 'approval': {
      queueBoard()
      const { [e.approval.id]: _old, ...others } = s.attention
      void _old
      store.setState({
        attention: e.approval.status === 'pending' ? { ...others, [e.approval.id]: e.approval } : others,
 ...(e.approval.projectId === s.activeProjectId ? { approvals: { ...s.approvals, [e.approval.id]: e.approval } } : {})
      })
      break
    }
    case 'message':
      queueBoard()
      if (e.message.projectId === s.activeProjectId) {
        const rest = s.messages.filter((m) => m.id !== e.message.id)
        const fresh = rest.length === s.messages.length && e.message.role === 'autopia'
        const seen = s.panelOpen && s.view === 'office' && s.sheet[s.sheet.length - 1]?.kind === 'conversation'
        store.setState({ messages: [...rest, e.message].sort((a, b) => a.createdAt - b.createdAt), unread: fresh && !seen ? s.unread + 1 : s.unread })
      }
      break
  }
}

// ── derived selectors ─────────────────────────────────────────

export const activeProject = (s: AppState): Project | null => (s.activeProjectId ? s.projects[s.activeProjectId] ?? null : null)

export type OpsIntentKind = OpKind | 'all' | 'start' | 'stop' | 'restart'

let opsMemo: { ops: OpsState | null; runs: ValidationRun[]; out: CheckView[] } = { ops: null, runs: [], out: [] }
/** This project's checks, each read against the code as it is now. */
export const opsChecks = (s: AppState): CheckView[] => {
  if (opsMemo.ops === s.ops && opsMemo.runs === s.validations) return opsMemo.out
  const ops = s.ops
  const out = ops ? ops.environment.checks.map((c) => checkView(c, s.validations, ops.stamp, ops.denied.includes(c.command) || ops.missing.includes(c.command.split(' ')[0]), ops.verified)) : []
  opsMemo = { ops, runs: s.validations, out }
  return out
}

export const sortedTasks = (s: AppState): Task[] => Object.values(s.tasks).sort((a, b) => a.sortOrder - b.sortOrder)

export const pendingApprovals = (s: AppState): Approval[] =>
  Object.values(s.approvals)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)

export const sortedRuns = (s: AppState): Run[] => Object.values(s.runs).sort((a, b) => b.startedAt - a.startedAt)

/** Pending decisions across every project, oldest first (live permission prompts first). */
export const attentionItems = (s: AppState): Approval[] =>
  Object.values(s.attention)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => (a.kind === 'permission' ? 0 : 1) - (b.kind === 'permission' ? 0 : 1) || a.createdAt - b.createdAt)
