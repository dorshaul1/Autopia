import { plural } from '@shared/friendlyError'
// Live preview of the project being built.
//
// Safety model:
// - The page renders in a separate WebContentsView: sandboxed, no Node, no preload, an in-memory
//   session per project, navigation pinned to the preview origin, all permission requests denied.
// - Static sites are served read-only by Autopia itself on 127.0.0.1 (no project code runs).
// - A project's own dev script runs only after the founder confirms the exact command, only when the
//   organization's managed policy doesn't deny it, bound to 127.0.0.1 on a free port.
// - Every server is a detached process group that is stopped on stop, project switch and app quit. A stop is
//   only reported once the group has really gone, and only a group Autopia started is ever signalled.

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as netServer } from 'node:net'
import { extname, join } from 'node:path'
import { BrowserWindow, WebContentsView, nativeImage, session, shell } from 'electron'
import type { ElementSnapshot, Picked } from '@shared/inspect'
import { cancelScript, markersScript, pickScript, snapshotScript } from './inspector'
import type { PreviewInfo, PreviewStatus, Project, Screenshot } from '@shared/types'
import { managedSettings, resolveLoginEnv } from './claude/cli'
import { predictBash } from './claude/policy'
import { detectPackageManager, installCommand, runCommand, scriptArgs, type PackageManager } from '@shared/delivery'
import { splitCommand } from '@shared/environment'
import { environmentOf } from './environment'
import { ProcessLedger, endGroup, groupAlive, holderOfPort, portsOfGroup } from './processes'
import { dependencyProblem } from '@shared/runtime'
import { dependencyState } from './deps'
import { safeResolve } from './projectFs'
import { launchLimits, launchOptions } from './studio'

const MAX_LOGS = 200
const START_TIMEOUT_MS = 45_000
/** Something with no page to open counts as running once it has stayed alive this long. */
const ALIVE_MS = 2500

interface Detected {
  kind: PreviewInfo['kind']
  framework: string | null
  script: string | null
  command: string | null
  reason: string | null
  root: string | null
  expects?: 'port' | 'process'
  /** Started as written, not through a package manager's run script. */
  direct?: boolean
}

/** Whether there is a page to show for this project. A worker or a desktop app can run without one. */
export const hasPage = (d: Pick<PreviewInfo, 'kind' | 'expects'>): boolean => d.kind !== 'none' && d.expects !== 'process'

const SCRIPT_COMMAND = /^(npm|pnpm|yarn|bun) run (\S+)$/

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

/** Looks at the project without running anything: package scripts, frameworks, static entry points. */
export function detectPreview(project: Project): Detected {
  const env = environmentOf(project.path)
  const chosen = env.run[0]
  // what you set yourself comes first
  if (env.configured && chosen?.id === 'configured' && !SCRIPT_COMMAND.test(chosen.command)) return { kind: 'script', framework: null, script: null, command: chosen.command, reason: null, root: null, expects: chosen.expects, direct: true }
  const pkgPath = join(project.path, 'package.json')
  if (existsSync(pkgPath)) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {}
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      return { kind: 'none', framework: null, script: null, command: null, reason: 'package.json could not be parsed.', root: null }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const framework = ['next', 'vite', 'react-scripts', 'astro', '@sveltejs/kit', 'nuxt', 'express', 'fastify', 'koa'].find((d) => d in deps) ?? null
    const configured = env.configured && chosen?.id === 'configured' ? SCRIPT_COMMAND.exec(chosen.command)?.[2] : null
    const script = (configured && pkg.scripts?.[configured] ? configured : null) ?? ['dev', 'start', 'serve', 'preview'].find((s) => pkg.scripts?.[s]) ?? null
    if (script) {
      // the team installs dependencies in temporary working copies, which never reach this folder: what
      // counts is what is really installed here (node_modules existing isn't enough)
      const problem = dependencyProblem(dependencyState(project.path))
      const pm = detectPackageManager(readdirSync(project.path), (pkg as { packageManager?: string }).packageManager)
      return {
        kind: 'script',
        framework,
        script,
        command: problem ? `${installCommand(pm)} && ${runCommand(pm, script)}` : runCommand(pm, script),
        reason: problem ? `${problem} Autopia installs them first (${installCommand(pm)}), then starts the app.` : null,
        root: null,
        expects: env.run.find((r) => r.command === runCommand(pm, script))?.expects ?? 'port'
      }
    }
  }
  // other languages: only what their own files show, as written
  const other = env.run.find((r) => !SCRIPT_COMMAND.test(r.command))
  if (other) return { kind: 'script', framework: env.frameworks[0] ?? null, script: null, command: other.command, reason: null, root: null, expects: other.expects, direct: true }
  for (const dir of ['', 'public', 'dist', 'build', 'site']) {
    if (existsSync(join(project.path, dir, 'index.html'))) return { kind: 'static', framework: 'static HTML', script: null, command: null, reason: null, root: dir }
  }
  return { kind: 'none', framework: null, script: null, command: null, reason: 'It has no web page to show here: no dev script and no index.html.', root: null }
}

/** Whether your organization's managed policy denies this exact command (Autopia then never runs it). */
export function deniedByPolicy(command: string): boolean {
  const s = managedSettings()
  const p = (s?.permissions ?? {}) as { allow?: string[]; deny?: string[]; ask?: string[] }
  return predictBash(command, { allow: p.allow ?? [], deny: p.deny ?? [], ask: p.ask ?? [], managedOnly: !!s?.allowManagedPermissionRulesOnly }) === 'blocked'
}

/** Build outputs and launch notes for projects that can't be rendered. */
export function artifacts(project: Project): PreviewInfo['artifacts'] {
  const out: PreviewInfo['artifacts'] = []
  for (const dir of ['dist', 'build', 'out', 'bin', 'target/release']) {
    const p = join(project.path, dir)
    if (existsSync(p) && statSync(p).isDirectory()) out.push({ path: dir, note: `${plural(readdirSync(p).length, 'item')}` })
  }
  for (const f of ['README.md', 'readme.md']) {
    const p = join(project.path, f)
    if (!existsSync(p)) continue
    // the section under a Usage / Run / Getting started heading, up to the next heading
    const sections = readFileSync(p, 'utf8').split(/\n(?=#+\s)/)
    const usage = sections.find((sec) => /^#+\s*(usage|run|running|getting started|quick ?start)/i.test(sec))
    out.push({ path: f, note: usage ? usage.replace(/^#+[^\n]*\n/, '').trim().slice(0, 600) : 'Project readme' })
    break
  }
  return out
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = netServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

interface Live {
  info: PreviewInfo
  child: ChildProcess | null
  server: Server | null
  view: WebContentsView | null
  /** The command you confirmed for this preview. */
  confirmed: string | null
  /** The most telling line the server printed before exiting. */
  lastError: string | null
  /** A port the server said it's on, other than the one Autopia gave it. Only believed once it's confirmed as theirs. */
  claimedPort?: number
  /** It said its port is taken: finding out who holds it is under way. */
  conflict?: boolean
  markers?: { n: number; selector: string | null; rect: { x: number; y: number } }[]
}

export class PreviewManager {
  private live = new Map<string, Live>()
  private bounds: { x: number; y: number; width: number; height: number } | null = null
  private shownFor: string | null = null
  private starting = new Map<string, Promise<PreviewInfo>>()
  private stopRequested = new Set<string>()
  private ledger: ProcessLedger

  constructor(
    private window: () => BrowserWindow | null,
    private onChange: (info: PreviewInfo) => void,
    pidFile: string
  ) {
    this.ledger = new ProcessLedger(pidFile)
    this.ledger.cleanUp()
  }

  info(project: Project): PreviewInfo {
    const cur = this.live.get(project.id)
    if (cur && cur.info.status !== 'stopped' && cur.info.status !== 'crashed') return cur.info
    if (cur?.info.status === 'crashed') {
      // the crash stays on record, but what a restart would run reflects the project folder now
      const now = detectPreview(project)
      return { ...cur.info, command: now.command, reason: now.reason, expects: now.expects, launch: launchOptions(project) }
    }
    const d = detectPreview(project)
    let reason = d.reason
    if (d.kind === 'script' && d.command) {
      // the founder runs this, but never a command the organization's managed policy denies
      const denied = d.command.split(' && ').find(deniedByPolicy)
      if (denied) reason = `Your organization's policy denies \`${denied}\`, so Autopia will not run it.`
    }
    const info: PreviewInfo = {
      projectId: project.id,
      kind: d.kind,
      framework: d.framework,
      command: d.command,
      reason,
      status: d.kind === 'none' ? 'unavailable' : 'stopped',
      url: null,
      port: null,
      logs: cur?.info.logs ?? [],
      error: cur?.info.error ?? null,
      artifacts: !hasPage(d) ? artifacts(project) : [],
      launch: launchOptions(project),
      limits: !hasPage(d) ? launchLimits(project) : [],
      page: null,
      canBack: false,
      canForward: false,
      expects: d.expects,
      pid: null,
      startedAt: null,
      finished: cur?.info.finished ?? null
    }
    return info
  }

  /** Starts a preview. `confirmed` must be true for script previews (the UI shows the exact command). */
  start(project: Project, confirmed: boolean): Promise<PreviewInfo> {
    // two starts at once are one start, and something already running stays the one running
    const inFlight = this.starting.get(project.id)
    if (inFlight) return inFlight
    const cur = this.live.get(project.id)?.info
    if (cur?.status === 'running' || cur?.status === 'starting') return Promise.resolve(cur)
    this.stopRequested.delete(project.id)
    const started = this.begin(project, confirmed).finally(() => this.starting.delete(project.id))
    this.starting.set(project.id, started)
    return started
  }

  async restart(project: Project, confirmed: boolean): Promise<PreviewInfo> {
    await this.stop(project.id)
    return this.start(project, confirmed)
  }

  private async begin(project: Project, confirmed: boolean): Promise<PreviewInfo> {
    await this.stop(project.id)
    this.stopRequested.delete(project.id)
    const base = this.info(project)
    if (base.kind === 'none') return base
    if (base.kind === 'script') {
      if (!confirmed) throw new Error('Confirm the command before Autopia runs your project')
      if (base.reason && /policy denies/.test(base.reason)) throw new Error(base.reason)
    }
    const port = await freePort()
    if (this.stopRequested.delete(project.id)) return this.info(project)
    const page = hasPage(base)
    const info: PreviewInfo = { ...base, status: 'starting', port: page ? port : null, url: page ? `http://127.0.0.1:${port}/` : null, logs: [], error: null, finished: null, page: null, canBack: false, canForward: false, startedAt: Date.now(), pid: null }
    const entry: Live = { info, child: null, server: null, view: null, confirmed: base.command, lastError: null }
    this.live.set(project.id, entry)
    this.emit(entry)

    if (base.kind === 'static') {
      const root = join(project.path, detectPreview(project).root ?? '')
      entry.server = this.staticServer(root, entry)
      await new Promise<void>((resolve, reject) => {
        entry.server!.once('error', reject)
        entry.server!.listen(port, '127.0.0.1', () => resolve())
      }).catch((err: Error) => this.fail(entry, `Could not start the static server: ${err.message}`))
      if (entry.info.status === 'starting') this.ready(entry)
      return entry.info
    }

    // the project's own dev script, bound to loopback on the port we chose
    const env = await resolveLoginEnv()
    if ((entry.info.status as PreviewStatus) !== 'starting') return entry.info
    const pm = base.command!.split(' ')[0] as PackageManager
    if (base.command!.includes(' install && ')) {
      // you confirmed this exact command: install the declared dependencies first, then start
      this.log(entry, `$ ${pm} install   (cwd ${project.path})`)
      const ok = await new Promise<boolean>((resolve) => {
        const inst = spawn(pm, pm === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install'], { cwd: project.path, env: { ...env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
        // tracked like the server, so stopping during an install really stops it
        entry.child = inst
        this.ledger.record(inst.pid)
        inst.on('exit', () => this.ledger.drop(inst.pid))
        const out = (buf: Buffer) => buf.toString().split('\n').forEach((l) => l.trim() && this.log(entry, l))
        inst.stdout!.on('data', out)
        inst.stderr!.on('data', out)
        inst.on('error', (err) => (this.log(entry, err.message), resolve(false)))
        inst.on('exit', (code) => resolve(code === 0))
      })
      entry.child = null
      if ((entry.info.status as PreviewStatus) !== 'starting') return entry.info
      if (!ok) {
        this.fail(entry, `Installing dependencies failed (${pm} install). Its output is below; describe the problem to the team and they’ll fix it.`)
        return entry.info
      }
      // an exit code isn't proof: check what is really in the folder before starting anything
      const still = dependencyProblem(dependencyState(project.path))
      if (still) {
        this.fail(entry, `${pm} install finished, but ${still}`)
        return entry.info
      }
    }
    const detected = detectPreview(project)
    const { bin, args } = detected.direct ? splitCommand(base.command!, port) : { bin: pm as string, args: ['run', base.command!.split(' ').pop()!, ...scriptArgs(pm, frameworkArgs(base.framework, port))] }
    this.log(entry, `$ ${bin} ${args.join(' ')}   (cwd ${project.path})`)
    const child = spawn(bin, args, {
      cwd: project.path,
      env: { ...env, PORT: String(port), HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })
    entry.child = child
    entry.info = { ...entry.info, pid: child.pid ?? null }
    this.ledger.record(child.pid)
    child.on('error', (err) => this.fail(entry, (err as NodeJS.ErrnoException).code === 'ENOENT' ? `${bin} isn’t installed on this Mac, or Autopia can’t find it.` : `It couldn’t start: ${err.message}`))
    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) {
        if (!line.trim()) continue
        this.log(entry, line)
        if (/ERR_[A-Z_]+|\bError\b|Cannot find|command not found/.test(line) && !entry.lastError) entry.lastError = line.trim().slice(0, 220)
        if (/EADDRINUSE|address already in use/i.test(line) && !entry.conflict) {
          entry.conflict = true
          void this.portConflict(entry, line)
        }
        const url = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/)
        if (url && page && entry.info.status === 'starting' && Number(url[1]) !== entry.info.port) entry.claimedPort = Number(url[1])
      }
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onData)
    child.on('exit', (code, signal) => {
      this.ledger.drop(child.pid)
      if (entry.child !== child) return
      entry.child = null
      if (entry.info.status === 'stopped' || entry.info.status === 'stopping' || entry.conflict) return
      // something with no page that finished cleanly did what it does
      if (!page && code === 0) {
        entry.info = { ...entry.info, status: 'stopped', pid: null, finished: 'It ran and finished by itself.' }
        this.log(entry, 'It finished (exit code 0).')
        return this.emit(entry)
      }
      this.fail(entry, `${page ? 'The dev server' : 'It'} exited (${signal ?? `code ${code}`})${entry.lastError ? `: ${entry.lastError}` : '.'}`)
    })
    if (!page) {
      setTimeout(() => {
        if (entry.child === child && entry.info.status === 'starting' && child.pid && groupAlive(child.pid)) this.ready(entry)
      }, ALIVE_MS)
      return entry.info
    }
    void this.waitForPort(entry)
    setTimeout(() => {
      if (entry.child === child && entry.info.status === 'starting') this.fail(entry, `The dev server did not start listening within ${START_TIMEOUT_MS / 1000}s.`)
    }, START_TIMEOUT_MS)
    return entry.info
  }

  /** Names who really holds the port. Their program is theirs: Autopia never stops it to make room. */
  private async portConflict(entry: Live, line: string): Promise<void> {
    const named = /(?:port\s+|:)(\d{2,5})\b/i.exec(line)?.[1]
    const port = named ? Number(named) : (entry.claimedPort ?? entry.info.port)
    const holder = port ? await holderOfPort(port) : null
    const who = holder ? `${holder.name} (process ${holder.pid})` : 'another program'
    this.fail(entry, `Port ${port} is already used by ${who}. Autopia won’t stop it. Close it yourself, or change the port this project uses, then start again.`)
  }

  /**
   * The team's work reached the project folder. A crash from before it no longer describes the code, and
   * a server can't keep running on dependencies that changed. Restarts only what you already confirmed;
   * anything new (like an install you didn't confirm) waits for you to start it.
   */
  async refreshAfterChange(project: Project): Promise<void> {
    const entry = this.live.get(project.id)
    if (!entry || entry.info.kind !== 'script') return
    const { status, error } = entry.info
    const now = detectPreview(project)
    const covered = !!now.command && !!entry.confirmed && entry.confirmed.endsWith(now.command)
    if (status === 'crashed' && covered) {
      await this.start(project, true)
      return
    }
    const oldCrash = status === 'crashed' || (status === 'stopped' && !!error)
    if (!oldCrash && !(status === 'running' && !covered)) return
    await this.stop(project.id)
    entry.info = { ...entry.info, error: null, command: now.command, reason: now.reason }
    this.onChange(this.info(project))
  }

  async stop(projectId: string): Promise<void> {
    if (this.starting.has(projectId)) this.stopRequested.add(projectId)
    const entry = this.live.get(projectId)
    if (!entry) return
    const pid = entry.child?.pid
    const keepCrash = entry.info.status === 'crashed'
    entry.info = { ...entry.info, status: pid ? 'stopping' : 'stopped', url: null, page: null, canBack: false, canForward: false }
    entry.child = null
    entry.server?.close()
    entry.server = null
    this.detachView(entry)
    this.emit(entry)
    if (pid) {
      // "stopped" is only said once it's true
      const gone = await endGroup(pid)
      if (gone) this.ledger.drop(pid)
      entry.info = { ...entry.info, status: 'stopped', pid: gone ? null : pid, error: gone ? (keepCrash ? entry.info.error : null) : `Autopia asked it to stop, but process ${pid} is still running. It will try again next launch.` }
      this.emit(entry)
    } else entry.info = { ...entry.info, pid: null }
  }

  /** On quit there's no time to wait: whatever ignores this is stopped at the next launch, from the ledger. */
  stopAll(): void {
    for (const entry of this.live.values()) {
      if (entry.child?.pid) {
        try {
          process.kill(-entry.child.pid, 'SIGTERM')
        } catch {
          // already gone
        }
      }
      entry.server?.close()
    }
  }

  /** Ledger, for anything else Autopia runs in a project folder. */
  processes(): ProcessLedger {
    return this.ledger
  }

  /** Where the renderer's preview frame is (window coordinates); null hides the view. */
  setBounds(projectId: string | null, bounds: { x: number; y: number; width: number; height: number } | null): void {
    this.bounds = bounds
    for (const [id, entry] of this.live) {
      if (id === projectId && bounds && entry.info.status === 'running') this.attachView(entry)
      else this.detachView(entry)
    }
    this.shownFor = bounds ? projectId : null
  }

  reload(projectId: string): void {
    this.live.get(projectId)?.view?.webContents.reloadIgnoringCache()
  }

  /** back, forward, or a path on the preview's own address. Never anywhere else. */
  navigate(projectId: string, to: string): void {
    const entry = this.live.get(projectId)
    const nav = entry?.view?.webContents.navigationHistory
    if (!entry?.view || !nav || !entry.info.url) return
    if (to === 'back') return void (nav.canGoBack() && nav.goBack())
    if (to === 'forward') return void (nav.canGoForward() && nav.goForward())
    const origin = new URL(entry.info.url).origin
    const url = new URL(to.startsWith('/') ? to : `/${to}`, origin)
    if (url.origin === origin) void entry.view.webContents.loadURL(url.href)
  }

  /** The running preview in your own browser: only ever its loopback address. */
  openExternal(projectId: string): void {
    const entry = this.live.get(projectId)
    if (!entry?.info.url || entry.info.status !== 'running') throw new Error('Start it first')
    const url = new URL(entry.info.url)
    if (url.hostname !== '127.0.0.1') throw new Error('Only the local preview can be opened')
    url.pathname = '/'
    void shell.openExternal(new URL(entry.info.page ?? '/', url.origin).href)
  }

  /** The page as it is, without Autopia's own numbered dots on it. */
  private async grab(entry: Live): Promise<Electron.NativeImage | null> {
    const view = entry.view!
    const marks = entry.markers?.length ? entry.markers : null
    if (marks) await view.webContents.executeJavaScript(markersScript([])).catch(() => undefined)
    try {
      return await this.picture(view)
    } finally {
      if (marks) void view.webContents.executeJavaScript(markersScript(marks)).catch(() => undefined)
    }
  }

  /** capturePage has nothing while the window is covered, so it falls back to asking the page itself. */
  private async picture(view: WebContentsView): Promise<Electron.NativeImage | null> {
    const shown = await view.webContents.capturePage().catch(() => null)
    if (shown && !shown.isEmpty()) return shown
    const dbg = view.webContents.debugger
    const mine = !dbg.isAttached()
    try {
      if (mine) dbg.attach('1.3')
      const { data } = (await dbg.sendCommand('Page.captureScreenshot', { format: 'png' })) as { data: string }
      const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
      return img.isEmpty() ? null : img
    } catch {
      return null
    } finally {
      if (mine && dbg.isAttached()) dbg.detach()
    }
  }

  /** A picture of the page right now, for while something has to appear over it. */
  async frame(projectId: string): Promise<string | null> {
    const entry = this.live.get(projectId)
    if (!entry?.view) return null
    return (await this.grab(entry))?.toDataURL() ?? null
  }

  /** Waits for you to point at something in the page. null: you cancelled, or the page went away. */
  async inspect(projectId: string): Promise<Picked | null> {
    const view = this.live.get(projectId)?.view
    if (!view) throw new Error('Start the preview to point at something in it')
    const wc = view.webContents
    // Esc has to reach the page while you're pointing, and your typing has to come back here afterwards
    wc.focus()
    return new Promise<Picked | null>((outer) => {
      const resolve = (v: Picked | null) => {
        this.window()?.webContents.focus()
        outer(v)
      }
      const gone = () => resolve(null)
      wc.once('did-start-navigation', gone)
      void wc.executeJavaScript(pickScript, true).then(
        (v) => {
          wc.off('did-start-navigation', gone)
          resolve((v as Picked | null) ?? null)
        },
        () => resolve(null)
      )
    })
  }

  cancelInspect(projectId: string): void {
    void this.live.get(projectId)?.view?.webContents.executeJavaScript(cancelScript).catch(() => undefined)
  }

  /** The numbered dots on what you've marked; back in place after every reload. */
  setMarkers(projectId: string, items: { n: number; selector: string | null; rect: { x: number; y: number } }[]): void {
    const entry = this.live.get(projectId)
    if (!entry) return
    entry.markers = items
    void entry.view?.webContents.executeJavaScript(markersScript(items)).catch(() => undefined)
  }

  /** The element as the page shows it now. undefined: the page can't be read right now. */
  async elementSnapshot(projectId: string, selector: string): Promise<ElementSnapshot | null | undefined> {
    const view = this.live.get(projectId)?.view
    if (!view) return undefined
    return view.webContents.executeJavaScript(snapshotScript(selector)).catch(() => undefined)
  }

  /** Captures what is actually rendered, saves it under the project's .autopia folder (git-ignored). */
  async screenshot(project: Project, crop?: { x: number; y: number; width: number; height: number }): Promise<Screenshot> {
    const view = this.live.get(project.id)?.view
    if (!view) throw new Error('Start the preview and keep it visible to capture it')
    // a freshly attached view may not have produced a frame yet: ask for one and retry briefly
    let img: Electron.NativeImage | null = null
    let lastError: unknown = null
    for (let i = 0; i < 6 && !img; i++) {
      try {
        img = await this.grab(this.live.get(project.id)!)
      } catch (err) {
        lastError = err
      }
      if (!img) {
        view.webContents.invalidate()
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    if (!img) throw new Error(`The preview could not be captured (${(lastError as Error)?.message ?? 'no frame rendered yet'}). Keep it visible and try again.`)
    if (crop && crop.width > 4 && crop.height > 4) {
      const size = img.getSize()
      const vb = view.getBounds()
      const sx = size.width / vb.width
      const sy = size.height / vb.height
      // what you marked can reach past the edge of what's on screen
      const x = Math.max(0, Math.round(crop.x * sx))
      const y = Math.max(0, Math.round(crop.y * sy))
      img = img.crop({ x, y, width: Math.max(1, Math.min(size.width - x, Math.round(crop.width * sx))), height: Math.max(1, Math.min(size.height - y, Math.round(crop.height * sy))) })
    }
    const dir = join(project.path, '.autopia', 'screenshots')
    mkdirSync(dir, { recursive: true })
    excludeAutopiaDir(project.path)
    const rel = `.autopia/screenshots/${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    writeFileSync(join(project.path, rel), img.toPNG())
    const { width, height } = img.getSize()
    const thumb = width > 2800 ? img.resize({ width: 2800 }) : img
    return { path: rel, dataUrl: thumb.toDataURL(), width, height, at: Date.now() }
  }

  // ── internals ──────────────────────────────────────────────

  private staticServer(root: string, entry: Live): Server {
    return createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new Error('hidden')
        let file = safeResolve(root, rel || '.')
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
        if (!existsSync(file)) {
          res.writeHead(404).end('Not found')
          this.log(entry, `404 ${url.pathname}`)
          return
        }
        res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        createReadStream(file).pipe(res)
      } catch {
        res.writeHead(403).end('Forbidden')
      }
    })
  }

  /**
   * Running means this project's own process is listening. A page answering on the port isn't enough: it could be
   * somebody else's server, and it would look just like yours.
   */
  private async waitForPort(entry: Live): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (entry.info.status === 'starting' && Date.now() < deadline) {
      const pid = entry.child?.pid
      const owned = pid ? await portsOfGroup(pid) : null
      if ((entry.info.status as PreviewStatus) !== 'starting') return
      if (owned?.length) {
        const port = owned.includes(entry.info.port!) ? entry.info.port! : entry.claimedPort && owned.includes(entry.claimedPort) ? entry.claimedPort : owned[0]
        entry.info = { ...entry.info, port, url: `http://127.0.0.1:${port}/` }
      }
      const url = entry.info.url!
      if (owned === null || owned.length) {
        const ok = await fetch(url, { signal: AbortSignal.timeout(1500) }).then(
          () => true,
          () => false
        )
        if (ok) return this.ready(entry)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }

  private ready(entry: Live): void {
    if (entry.info.status !== 'starting') return
    entry.info = { ...entry.info, status: 'running' }
    this.log(entry, entry.info.url ? `Ready at ${entry.info.url} (loopback only)` : 'It’s running. It has no page to show.')
    if (this.shownFor === entry.info.projectId && this.bounds) this.attachView(entry)
    this.emit(entry)
  }

  private fail(entry: Live, error: string): void {
    if (entry.info.status === 'crashed' || entry.info.status === 'stopped') return
    entry.info = { ...entry.info, status: 'crashed', error, pid: null }
    this.log(entry, error)
    if (entry.child?.pid) void endGroup(entry.child.pid)
    this.detachView(entry)
    this.emit(entry)
  }

  private attachView(entry: Live): void {
    const win = this.window()
    if (!win || !this.bounds || !entry.info.url) return
    if (!entry.view) {
      const partition = `preview-${entry.info.projectId}` // no "persist:" prefix → in-memory only
      const ses = session.fromPartition(partition)
      ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
      ses.setPermissionCheckHandler(() => false)
      const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
      const origin = new URL(entry.info.url).origin
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (e, url) => {
        if (new URL(url).origin !== origin) {
          e.preventDefault()
          this.log(entry, `Blocked navigation away from the preview: ${url}`)
        }
      })
      view.webContents.on('console-message', (details) => {
        const level = (details as unknown as { level: string }).level
        if (level === 'error' || level === 'warning') this.log(entry, `[page ${level}] ${(details as unknown as { message: string }).message}`)
      })
      view.webContents.on('did-fail-load', (_e, code, desc, url) => {
        if (code !== -3) this.log(entry, `[page] failed to load ${url}: ${desc} (${code})`)
      })
      const moved = (url: string) => {
        // the history only counts this move a moment after it's announced
        setTimeout(() => {
          if (entry.view !== view) return
          const nav = view.webContents.navigationHistory
          try {
            const u = new URL(url)
            entry.info = { ...entry.info, page: `${u.pathname}${u.search}${u.hash}`, canBack: nav.canGoBack(), canForward: nav.canGoForward() }
            this.emit(entry)
          } catch {
            // not a real address: where it was still stands
          }
        }, 50)
      }
      view.webContents.on('did-navigate', (_e, url) => moved(url))
      view.webContents.on('did-navigate-in-page', (_e, url) => moved(url))
      view.webContents.on('did-finish-load', () => {
        if (entry.markers?.length) void view.webContents.executeJavaScript(markersScript(entry.markers)).catch(() => undefined)
      })
      view.webContents.on('render-process-gone', (_e, d) => this.log(entry, `[page] renderer gone: ${d.reason}`))
      void view.webContents.loadURL(entry.info.url)
      entry.view = view
    }
    if (!win.contentView.children.includes(entry.view)) win.contentView.addChildView(entry.view)
    entry.view.setBounds(this.bounds)
  }

  private detachView(entry: Live): void {
    const win = this.window()
    if (entry.view && win && win.contentView.children.includes(entry.view)) win.contentView.removeChildView(entry.view)
    if (entry.info.status !== 'running' && entry.view) {
      entry.view.webContents.close()
      entry.view = null
    }
  }

  private log(entry: Live, line: string): void {
    if (!line.trim()) return
    // terminal color codes would show as "[31m" in the log
    const clean = line.replace(/\u001b\[[\d;]*[A-Za-z]/g, '')
    entry.info.logs = [...entry.info.logs, clean.slice(0, 400)].slice(-MAX_LOGS)
    this.emit(entry)
  }

  private emitTimer = new Map<string, NodeJS.Timeout>()
  private emit(entry: Live): void {
    // coalesce chatty server output into at most ~8 updates per second
    const id = entry.info.projectId
    if (this.emitTimer.has(id)) return
    this.emitTimer.set(
      id,
      setTimeout(() => {
        this.emitTimer.delete(id)
        this.onChange({ ...entry.info })
      }, 120)
    )
  }

}

/** Ask common dev servers to bind loopback on our port. */
function frameworkArgs(framework: string | null, port: number): string[] {
  switch (framework) {
    case 'vite':
    case 'astro':
    case '@sveltejs/kit':
      return ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
    case 'next':
      return ['-H', '127.0.0.1', '-p', String(port)]
    default:
      return [] // PORT/HOST env vars cover express-style servers and create-react-app
  }
}

/** Keep Autopia's working files (screenshots, feedback) out of the project's git history. */
export function excludeAutopiaDir(repo: string): void {
  const exclude = join(repo, '.git', 'info', 'exclude')
  if (!existsSync(join(repo, '.git'))) return
  mkdirSync(join(repo, '.git', 'info'), { recursive: true })
  const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!cur.split('\n').includes('.autopia/')) appendFileSync(exclude, `${cur.endsWith('\n') || !cur ? '' : '\n'}.autopia/\n`)
}

