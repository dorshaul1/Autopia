import { readFileSync, writeFileSync } from 'node:fs'
import { QualityEngine } from './quality/engine'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Notification as OsNotification, powerMonitor, screen, shell, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type PushEvent } from '@shared/ipc'
import { FOUNDING_TEAM, seatingPlan } from '@shared/roster'
import type { ClaudeInfo, Notification } from '@shared/types'
import { shouldAlert } from './attention'
import { OFFICE_TYPES, distinctLooks, missingOriginalTeam } from '@shared/offices'
import { detectClaude, withLoginEnv, resolveLoginEnv, setIgnoreApiKeys } from './claude/cli'
import { openDatabase } from './db/database'
import { Repo } from './db/repo'
import { registerIpc } from './ipc'
import { Orchestrator } from './orchestrator/orchestrator'
import { PreviewManager } from './preview'
import { Operations } from './operations'
import { fatal, logFolder, startLogging } from './log'

const here = dirname(fileURLToPath(import.meta.url))
// Lets tests and demos run against an isolated database.
if (process.env.AUTOPIA_USER_DATA) app.setPath('userData', process.env.AUTOPIA_USER_DATA)
startLogging()
// one installed copy, one database: opening it again just brings the window forward
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})
let mainWindow: BrowserWindow | null = null
// error stays null until detection finishes so the UI shows "checking", not "unavailable"
let markClaudeReady = () => {}
const claudeReady = new Promise<void>((resolve) => (markClaudeReady = resolve))
let claudeInfo: ClaudeInfo = { available: false, path: null, version: null, error: null, restrictions: [], allowedModels: null }

function push(event: PushEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.push, event)
}

const windowStateFile = () => join(app.getPath('userData'), 'window-state.json')

/** Where you left the window, unless that spot isn't on any screen you have now. */
function savedBounds(): { x: number; y: number; width: number; height: number; maximized: boolean } | null {
  try {
    const b = JSON.parse(readFileSync(windowStateFile(), 'utf8'))
    const seen = screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width - 80 && b.x + b.width > d.workArea.x + 80 && b.y >= d.workArea.y - 8 && b.y < d.workArea.y + d.workArea.height - 40)
    return seen && b.width >= 1100 && b.height >= 700 ? b : null
  } catch {
    return null
  }
}

function rememberBounds(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    try {
      writeFileSync(windowStateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
    } catch {
      // not saved: it opens at the default size next time
    }
  }
  const soon = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', soon)
  win.on('move', soon)
  win.on('close', save)
}

/** Copy and paste by right click, as everywhere else on a Mac. Nothing else is added to it. */
function textMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = p.isEditable
      ? [{ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' }]
      : p.selectionText.trim()
        ? [{ role: 'copy' }]
        : []
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

/** An installed copy's menu: the usual ones, without development tools, and a way to find its logs. */
function productionMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : [{ role: 'fileMenu' } as MenuItemConstructorOptions]),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Claude Code Setup Guide', click: () => void shell.openExternal('https://code.claude.com/docs/en/quickstart') },
        { label: 'Show Logs', click: () => void shell.openPath(logFolder()) }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const saved = savedBounds()
  const win = new BrowserWindow({
    width: saved?.width ?? 1480,
    height: saved?.height ?? 920,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Autopia',
    backgroundColor: '#12110e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  if (saved?.maximized) win.maximize()
  rememberBounds(win)
  textMenu(win)
  win.once('ready-to-show', () => {
    // Dev aid: scripted UI checks run invisibly and click-through, so nobody mistakes them for the real app.
    if (process.env.AUTOPIA_TEST_WINDOW) {
      win.setOpacity(0)
      win.setIgnoreMouseEvents(true)
      win.showInactive()
    } else win.show()
  })
  // Dev aid: AUTOPIA_CAPTURE=/path/shot.png saves a screenshot of the window every few seconds.
  const capture = process.env.AUTOPIA_CAPTURE
  if (capture) {
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return clearInterval(timer)
      // capture can fail mid-reload; the next tick retries
      const img = await win.webContents.capturePage().catch(() => null)
      if (img) writeFileSync(capture, img.toPNG())
    }, 4000)
  }
  // Never navigate the app window away; send external links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  void resolveLoginEnv() // warm the (possibly slow) login-shell PATH lookup early
  if (app.isPackaged) productionMenu()
  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase(join(app.getPath('userData'), 'autopia.db'))
  } catch (err) {
    fatal('Autopia couldn’t open its data', err)
    return app.quit()
  }
  const repo = new Repo(db)
  repo.seedEmployees(FOUNDING_TEAM)
  // every office has its full team: the original office gets the Tech Startup roles it was missing
  const missing = missingOriginalTeam(repo.employees(), Date.now())
  if (missing.length) repo.seedEmployees(missing)
  // older teams could draw near-identical people: only the duplicates change, and only once they've been told apart
  for (const p of repo.projects()) {
    if (!p.officeType || p.officeType === 'startup') continue
    const team = repo.employees().filter((e) => e.projectId === p.id)
    const told = distinctLooks(team, OFFICE_TYPES[p.officeType].shirts)
    const changed = told.filter((e, i) => e !== team[i])
    if (changed.length) repo.seedEmployees(changed)
  }
  // Seats are not assignable: normalize any older seating so no furnished desk is ever empty.
  // (the original team only: each project office seats its own team from its roster)
  const original = repo.employees().filter((e) => !e.projectId)
  for (const [id, desk] of seatingPlan(original)) if (original.find((e) => e.id === id)?.deskId !== desk) repo.setDesk(id, desk)

  // Native alerts only while Autopia is in the background, only for what your preferences ask for, never
  // for a repeat of an unchanged condition, and always silent. Clicking one opens what it is about.
  const alert = (n: Notification, repeat: boolean) => {
    const s = repo.settings()
    if (!OsNotification.isSupported() || !shouldAlert({ category: n.category, repeat }, { desktop: s.desktopNotifications, quiet: s.quietMode }, !!mainWindow?.isFocused())) return
    const project = n.projectId ? repo.projects().find((p) => p.id === n.projectId)?.name : null
    const os = new OsNotification({ title: n.title, subtitle: project ?? undefined, body: n.body, silent: true })
    os.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      push({ type: 'openNotification', notification: n })
    })
    os.show()
  }
  const orchestrator = new Orchestrator(repo, join(app.getPath('userData'), 'worktrees'), () => claudeInfo, push, alert)
  const preview = new PreviewManager(() => mainWindow, (info) => push({ type: 'preview', preview: info }), join(app.getPath('userData'), 'preview-pids'))
  app.on('before-quit', () => preview.stopAll())
  const quality = new QualityEngine(repo, preview, push, {
    busy: (projectId, detail) => orchestrator.qaBusy(projectId, detail),
    designReview: (project, d, shots) => orchestrator.designReview(project, d, shots),
    correct: (project, d, findings) => orchestrator.addQualityCorrection(project, d, findings)?.key ?? null,
    askToVerify: (project, d, commands, early) => orchestrator.askToVerify(project, d, commands, early),
    canRepair: (project) => orchestrator.canRepairDelivery(project),
    repairVerification: (project, d, brief) => orchestrator.addVerificationRepair(project, d, brief)
  })
  const operations = new Operations(repo, preview, quality, orchestrator, push)
  app.on('before-quit', () => operations.stopAll())
  orchestrator.onVerify = (project, d) => quality.verify(project, d)
  orchestrator.selfChecks = quality
  orchestrator.onVerifyConsent = (projectId, commands, allowed) => quality.setVerifyConsent(projectId, commands, allowed)
  orchestrator.onReview = (project, d) => quality.onReview(project, d)
  powerMonitor.on('resume', () => orchestrator.onSystemResume())
  orchestrator.onMerged = (project) => void preview.refreshAfterChange(project).catch(() => undefined)
  orchestrator.onMilestone = (project, n) => quality.milestoneGate(project, n, (title, description, kind) => orchestrator.addMilestoneRepair(project, n, title, description, kind))
  registerIpc({
    repo,
    orchestrator,
    preview,
    quality,
    operations,
    claude: {
      get: () => claudeInfo,
      set: (info) => {
        claudeInfo = info
        push({ type: 'claude', info })
      },
      ready: claudeReady
    },
    window: () => mainWindow,
    notify: (n) => {
      push({ type: 'notification', notification: n })
      alert(n, false)
    }
  })

  mainWindow = createWindow()
  mainWindow.on('closed', () => (mainWindow = null))
  // The preview is a native view on top of the window; only the page can say where it goes. If the
  // page reloads (or its renderer restarts) it never gets to say "hide", so hide it here: the page
  // shows it again once it's back on the preview.
  mainWindow.webContents.on('did-start-loading', () => preview.setBounds(null, null))
  mainWindow.webContents.on('render-process-gone', () => preview.setBounds(null, null))

  setIgnoreApiKeys(repo.settings().preferSubscription)
  claudeInfo = await detectClaude()
  markClaudeReady()
  void withLoginEnv(claudeInfo).then((info) => {
    claudeInfo = info
    push({ type: 'claude', info })
  }, () => undefined)
  push({ type: 'usage', usage: orchestrator.usageView() })
  push({ type: 'claude', info: claudeInfo })
  orchestrator.recoverFromRestart()

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      mainWindow = createWindow()
      mainWindow.on('closed', () => (mainWindow = null))
    }
  })
  app.on('before-quit', () => {
    // a session ending now can't record it (recovery reads it next launch), and an error box here would stop the quit forever
    process.on('uncaughtException', (err) => console.error('while quitting:', err.message))
    orchestrator.shutdown()
    db.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
