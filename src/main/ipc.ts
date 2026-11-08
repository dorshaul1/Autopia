import { projectMetrics } from './orchestrator/metrics'
import { connectClaudeAccount, withLoginEnv } from './claude/cli'
import { purposeOf } from '@shared/projectHome'
import { LIMITS } from '@shared/settings'
import { projectNameFrom } from '@shared/composer'
import { isOfficeType, recommendOffice } from '@shared/offices'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { IPC, type AutopiaApi, type CreateProjectInput, type InvokeMethod } from '@shared/ipc'
import { projectSummary } from '@shared/summary'
import { sanitizeOffice } from '@shared/officeDecor'
import { type ApprovalDecision, type ClaudeInfo, type Notification, type OfficeConfig, type OfficeLocation, type PolicyProbe, type Settings } from '@shared/types'
import { bypassDisabled, detectClaude, setIgnoreApiKeys } from './claude/cli'
import { policyReport, runPolicyProbe } from './claude/policy'
import type { Repo } from './db/repo'
import * as git from './git/git'
import type { Orchestrator } from './orchestrator/orchestrator'
import { excludeAutopiaDir, hasPage, type PreviewManager } from './preview'
import type { Operations } from './operations'
import { captureImage, cropCapture, launchOptions, listCaptures, recordCapture } from './studio'
import type { QualityEngine } from './quality/engine'
import { deliverable } from './product/product'
import { changeSet, uncommittedDiff } from './git/review'
import * as fsx from './projectFs'

type Handlers = { [K in InvokeMethod]: (...args: Parameters<AutopiaApi[K]>) => ReturnType<AutopiaApi[K]> | Awaited<ReturnType<AutopiaApi[K]>> }

export interface IpcDeps {
  repo: Repo
  orchestrator: Orchestrator
  preview: PreviewManager
  quality: QualityEngine
  operations: Operations
  notify: (n: Notification) => void
  claude: { get(): ClaudeInfo; set(info: ClaudeInfo): void; ready: Promise<void> }
  window: () => BrowserWindow | null
}

/** Anything that can start an agent. */
let signingIn: AbortController | null = null

const NEEDS_CLAUDE = new Set(['opsFix', 'sendVisualFeedback', 'sendMessage', 'requestRevision', 'resolveApproval', 'retryTask', 'decideDelivery', 'verifyDelivery', 'runPolicyProbe'])

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`)
  return v
}

export function registerIpc({ repo, orchestrator, claude, window, notify, preview, quality, operations }: IpcDeps): void {
  let probing = false
  // A stored "full" profile is meaningless once the organization disables bypass mode.
  if (repo.settings().permissionProfile === 'full' && bypassDisabled()) repo.updateSettings({ permissionProfile: 'standard' })
  const handlers: Handlers = {
    async bootstrap() {
      return {
        claude: claude.get(),
        employees: repo.employees(),
        statuses: orchestrator.employeeStatuses(),
        projects: repo.projects(),
        settings: repo.settings()
      }
    },

    async refreshClaude() {
      const info = await withLoginEnv(await detectClaude())
      claude.set(info)
      if (info.available) void orchestrator.schedule()
      return info
    },

    getMetrics: async (projectId) => projectMetrics(repo, str(projectId, 'projectId')),
    usage: async () => orchestrator.usageView(),
    attention: async () => orchestrator.attentionItems(),
    resumeAfterLimit: async () => orchestrator.resumeAfterLimit('you'),
    async openUsagePage() {
      // Claude's own usage page (official); Autopia never reads it or your session
      await shell.openExternal('https://claude.ai/settings/usage')
    },
    deliveries: async (projectId) => orchestrator.deliveries(str(projectId, 'projectId')),
    changes: (projectId, deliveryId) => orchestrator.changes(str(projectId, 'projectId'), deliveryId === null ? null : str(deliveryId, 'deliveryId')),
    async uncommittedDiff(projectId) {
      const p = repo.project(str(projectId, 'projectId'))
      return p.gitEnabled ? uncommittedDiff(p.path) : []
    },
    decideDelivery(deliveryId, decision, note) {
      if (decision !== 'accept' && decision !== 'reject') throw new Error('Unknown decision')
      const id = str(deliveryId, 'deliveryId')
      let text = typeof note === 'string' ? note.slice(0, 2000) : null
      if (decision === 'accept') {
        // accepting unverified work is allowed, but never silently: the open items are recorded
        const d = repo.delivery(id)
        const r = quality.readiness(d.projectId, id)
        const open = r.dimensions.filter((x) => x.applies && x.status !== 'verified')
        if (open.length) {
          const items = open.map((x) => `${x.label}: ${x.exception ? `exception (${x.exception})` : x.status.replace('_', ' ')}`).join('; ')
          text = `${text ? `${text}\n` : ''}Accepted with open quality items: ${items}`
        }
      }
      return orchestrator.decideDelivery(id, decision, text)
    },
    undoDelivery: (deliveryId) => orchestrator.undoDelivery(str(deliveryId, 'deliveryId')),
    messages: async (projectId) => repo.messages(str(projectId, 'projectId')),
    stopMessage: async (id) => orchestrator.stopMessage(str(id, 'id')),
    rememberProductImage: async (id) => {
      const project = repo.project(str(id, 'id'))
      const url = await preview.frame(project.id)
      if (!url) return false
      const file = join(project.path, LIVE_IMAGE)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(url.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      return true
    },
    productImage: async (id) => {
      const project = repo.project(str(id, 'id'))
      const report = repo.qualityReports(project.id, 60).find((r) => r.kind === 'visual' && r.status === 'done' && r.shots.length)
      const shot = report?.shots.find((s) => s.width === 1280) ?? report?.shots[report.shots.length - 1]
      // whichever real picture of it is newest: the last QA capture, or the last time it was running in the preview
      const file = [shot && join(project.path, shot.path), join(project.path, LIVE_IMAGE)]
        .filter((f): f is string => !!f && existsSync(f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      if (!file) return null
      // the top of the page, small: a whole-page capture is far too heavy for a list
      const image = nativeImage.createFromPath(file)
      const size = image.getSize()
      if (!size.width) return null
      return image.crop({ x: 0, y: 0, width: size.width, height: Math.min(size.height, Math.round(size.width * 0.625)) }).resize({ width: 640 }).toDataURL()
    },
    // Claude Code may still be being located just after launch: this waits for that instead of answering "nothing"
    claudeCapabilities: async (id, fresh) => {
      await claude.ready
      return orchestrator.claudeCapabilities(str(id, 'id'), fresh === true)
    },
    claudeOverview: async (id, fresh) => {
      await claude.ready
      return orchestrator.claudeOverview(id === null ? null : str(id, 'id'), fresh === true)
    },
    async openClaudeInstall() {
      await shell.openExternal('https://code.claude.com/docs/en/quickstart')
    },
    claudeLatest: () => orchestrator.claudeLatest(),
    updateClaude: () => orchestrator.updateClaude(),
    async cancelConnectClaude() {
      signingIn?.abort()
    },
    async gitCheck() {
      return { available: await git.available() }
    },
    async connectClaude() {
      if (!claude.get().path) throw new Error('Claude Code is not installed')
      const attempt = new AbortController()
      signingIn = attempt
      try {
        await connectClaudeAccount(claude.get().path!, attempt.signal)
      } catch (err) {
        // you cancelled: nothing went wrong, and nothing to say
        if (!attempt.signal.aborted) throw err
      }
      const info = await withLoginEnv(await detectClaude())
      claude.set(info)
      return info
    },
    async attachmentImage(projectId, rel) {
      // only images Autopia saved into this project's own attachment folder
      const r = str(rel, 'rel')
      if (!/^\.autopia\/(attachments|screenshots)\/[\w.-]+\.(png|jpe?g|gif|webp)$/i.test(r)) return null
      const file = join(repo.project(str(projectId, 'projectId')).path, r)
      if (!existsSync(file)) return null
      const ext = r.split('.').pop()!.toLowerCase()
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(file).toString('base64')}`
    },
    defaultProjectsDir: async () => defaultProjectsDir(),
    async saveAttachment(projectId, name, dataUrl) {
      const project = repo.project(str(projectId, 'projectId'))
      // images, plus files the team can read: text, code, data, logs and PDFs
      const raw = str(dataUrl, 'dataUrl')
      const img = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
      const file = /^data:[\w.+/-]*;base64,([A-Za-z0-9+/=]*)$/.exec(raw)
      const extOf = (str(name, 'name').match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? '').toLowerCase()
      const READABLE = ['txt', 'md', 'json', 'csv', 'tsv', 'pdf', 'log', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'sh', 'toml', 'ini', 'env.example']
      if (!img && !(file && READABLE.includes(extOf))) throw new Error('Attach an image or a text, code, data, log or PDF file')
      const bytes = Buffer.from(img ? img[2] : file![1], 'base64')
      if (bytes.length > 8 * 1024 * 1024) throw new Error('That file is larger than 8 MB')
      const safe = str(name, 'name').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'file'
      const ext = img ? (img[1] === 'jpeg' ? 'jpg' : img[1]) : extOf
      const rel = `.autopia/attachments/${Date.now()}-${safe}.${ext}`
      mkdirSync(join(project.path, '.autopia', 'attachments'), { recursive: true })
      excludeAutopiaDir(project.path)
      writeFileSync(join(project.path, rel), bytes)
      return rel
    },
    async sendMessage(input) {
      if (!input || typeof input.text !== 'string' || !input.text.trim()) throw new Error('Write a message first')
      const intents = ['build', 'plan', 'change', 'note', 'ask', 'reply']
      if (!intents.includes(input.intent)) throw new Error('Unknown request type')
      let projectId = input.projectId ? str(input.projectId, 'projectId') : null
      if (!projectId) {
        // a new project straight from the idea: no form; the folder goes under ~/Autopia
        const name = projectNameFrom(input.text)
        const root = defaultProjectsDir()
        mkdirSync(root, { recursive: true })
        const path = fsx.prepareNewProjectDir(root, uniqueName(root, name))
        const baseBranch = await git.ensureRepo(path)
        // the office that fits the idea (a game → the studio, AI work → the lab), with its own team
        const project = repo.createProject({ name, path, goal: '', gitEnabled: true, baseBranch, officeType: recommendOffice(input.text).type })
        orchestrator.refreshTeams()
        orchestrator.warmCodeMap(project)
        notify({ ...repo.addNotification({ kind: 'manager', projectId: project.id, taskId: null, title: `Created ${name}`, body: path }) })
        projectId = project.id
      }
      const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      return orchestrator.sendMessage({
        projectId,
        intent: projectId && input.projectId ? input.intent : input.intent === 'ask' ? 'ask' : 'build',
        text: input.text.slice(0, 20_000),
        attachments: arr(input.attachments).slice(0, 10),
        employeeId: input.employeeId ? str(input.employeeId, 'employeeId') : null,
        instruction: input.instruction === true,
        taskId: input.taskId ? str(input.taskId, 'taskId') : null,
        deliveryId: input.deliveryId ? str(input.deliveryId, 'deliveryId') : null
      })
    },
    async setProjectControls(projectId, patch) {
      const p: { paused?: boolean } = {}
      if (typeof patch?.paused === 'boolean') p.paused = patch.paused
      return orchestrator.setProjectControls(str(projectId, 'projectId'), p)
    },
    allDecisions: async () => repo.projects().flatMap((p) => repo.pendingApprovals(p.id)).sort((a, b) => b.createdAt - a.createdAt),
    productSpec: async (projectId) => repo.productSpec(str(projectId, 'projectId')),
    async productDeliverable(projectId) {
      const project = repo.project(str(projectId, 'projectId'))
      const tasks = repo.tasks(project.id)
      const deliveries = repo.deliveries(project.id)
      const first = [...deliveries].reverse().find((d) => d.baseSha)
      const last = deliveries.find((d) => d.headSha)
      const commits = project.gitEnabled && first?.baseSha && last?.headSha ? (await changeSet(project.path, first.baseSha, last.headSha, tasks)).commits.length : 0
      const latest = deliveries.find((d) => d.status === 'review' || d.status === 'accepted')
      return deliverable(project, tasks, repo.allRuns(project.id), repo.knowledge(project.id), latest?.limitations ?? [], hasPage(preview.info(project)), commits)
    },
    productFeedback: async (projectId, text) => orchestrator.productFeedback(str(projectId, 'projectId'), str(text, 'text').slice(0, 4000)),
    qualityOverview: async (projectId) => quality.overview(str(projectId, 'projectId')),
    verifyDelivery: (deliveryId) => orchestrator.reverify(str(deliveryId, 'deliveryId')),
    readiness: async (projectId, deliveryId) => quality.readiness(str(projectId, 'projectId'), str(deliveryId, 'deliveryId')),
    runQualityAudit: async (projectId, deliveryId) => quality.audit(repo.project(str(projectId, 'projectId')), deliveryId ? str(deliveryId, 'deliveryId') : null),
    runVisualQa: async (projectId, deliveryId) => quality.visual(repo.project(str(projectId, 'projectId')), deliveryId ? str(deliveryId, 'deliveryId') : null),
    async setQualityException(projectId, deliveryId, dimension, note) {
      if (!['requirements', 'tests', 'static', 'build', 'security', 'accessibility', 'visual', 'performance', 'review'].includes(dimension)) throw new Error('Unknown dimension')
      return quality.setException(str(projectId, 'projectId'), str(deliveryId, 'deliveryId'), dimension, typeof note === 'string' ? note.slice(0, 500) : null)
    },
    qualityShot: async (projectId, path) => quality.shot(repo.project(str(projectId, 'projectId')), str(path, 'path')),
    requestRevision(projectId, input) {
      return orchestrator.requestRevision(str(projectId, 'projectId'), {
        deliveryId: input?.deliveryId ? str(input.deliveryId, 'deliveryId') : null,
        text: str(input?.text ?? '', 'text').slice(0, 8000),
        screenshot: input?.screenshot ? str(input.screenshot, 'screenshot') : null,
        taskId: input?.taskId ? str(input.taskId, 'taskId') : null
      })
    },
    validations: async (projectId) => orchestrator.validations(str(projectId, 'projectId')),
    opsState: (projectId) => operations.state(repo.project(str(projectId, 'projectId'))),
    opsRun: (projectId, commandId, confirmed) => operations.run(repo.project(str(projectId, 'projectId')), str(commandId, 'commandId'), confirmed === true),
    projectFolderExists: async (projectId) => existsSync(repo.project(str(projectId, 'projectId')).path),
    opsCancel: (validationId) => operations.cancel(str(validationId, 'validationId')),
    opsFix: (projectId, input) => operations.fix(repo.project(str(projectId, 'projectId')), input?.source === 'process' ? { source: 'process' } : { source: 'check', validationId: str(input?.validationId, 'validationId') }),
    opsSaveConfig: (projectId, config) => operations.saveConfig(repo.project(str(projectId, 'projectId')), config ?? {}),
    memoryReport: async (projectId) => orchestrator.memoryReport(str(projectId, 'projectId')),
    planRisks: async (projectId) => orchestrator.planRisks(str(projectId, 'projectId')),
    reindexMemory: (projectId) => orchestrator.reindex(str(projectId, 'projectId')),
    editKnowledge(projectId, input) {
      if (!['stack', 'module', 'workflow', 'dependency', 'convention', 'architecture', 'decision', 'limitation', 'completed', 'handoff', 'lesson'].includes(input?.kind)) throw new Error('Unknown kind')
      const title = str(input.title ?? '', 'title').trim()
      const text = str(input.text ?? '', 'text').trim()
      if (!title || !text) throw new Error('A note needs a title and text')
      return orchestrator.editKnowledge(str(projectId, 'projectId'), {
        id: input.id ? str(input.id, 'id') : null,
        kind: input.kind,
        title: title.slice(0, 120),
        text: text.slice(0, 2000),
        rationale: input.rationale ? str(input.rationale, 'rationale').slice(0, 1000) : null,
        alternatives: input.alternatives ? str(input.alternatives, 'alternatives').slice(0, 600) : null,
        files: Array.isArray(input.files) ? input.files.filter((f) => typeof f === 'string' && !f.includes('..') && !f.startsWith('/')).slice(0, 20) : []
      })
    },
    async setKnowledgeStatus(id, status) {
      if (!['active', 'stale', 'archived'].includes(status)) throw new Error('Unknown status')
      orchestrator.setKnowledgeStatus(str(id, 'id'), status)
    },
    forgetKnowledge: async (id, confirmUserNote) => orchestrator.forget(str(id, 'id'), confirmUserNote === true),
    skillsReport: async () => orchestrator.skills.report(),
    installSkillFromGitHub: async (url) => orchestrator.skills.installFromGitHub(str(url, 'url')),
    async importLocalSkill(path) {
      let dir = typeof path === 'string' ? path : null
      if (!dir) {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Choose a skill folder (with SKILL.md)' })
        if (r.canceled || !r.filePaths[0]) return null
        dir = r.filePaths[0]
      }
      return orchestrator.skills.importLocal(dir, basename(dir))
    },
    approveSkill: async (id) => orchestrator.skills.approve(str(id, 'id')),
    removeSkill: async (id) => orchestrator.skills.remove(str(id, 'id')),
    setSkillEnabled: async (id, enabled) => orchestrator.skills.setEnabled(str(id, 'id'), enabled === true),
    async setSkillScope(scope) {
      if (scope !== 'routed' && scope !== 'personal') throw new Error('Invalid scope')
      orchestrator.skills.setScope(scope)
    },
    resetMemory: async (projectId, includeUser) => orchestrator.resetMemory(str(projectId, 'projectId'), includeUser === true),
    previewInfo: async (projectId) => preview.info(repo.project(str(projectId, 'projectId'))),
    mayRunCommand: async (projectId, command) => quality.mayRunCommand(str(projectId, 'projectId'), str(command, 'command')),
    previewStart: (projectId, confirmed) => preview.start(repo.project(str(projectId, 'projectId')), confirmed === true),
    previewStop: (projectId) => preview.stop(str(projectId, 'projectId')),
    previewRestart: (projectId, confirmed) => preview.restart(repo.project(str(projectId, 'projectId')), confirmed === true),
    async previewBounds(projectId, bounds) {
      const ok = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n) && n >= 0 && n < 20000)
      preview.setBounds(projectId ? str(projectId, 'projectId') : null, ok ? { x: Math.round(bounds!.x), y: Math.round(bounds!.y), width: Math.round(bounds!.width), height: Math.round(bounds!.height) } : null)
    },
    previewReload: async (projectId) => preview.reload(str(projectId, 'projectId')),
    previewFrame: (projectId) => preview.frame(str(projectId, 'projectId')),
    previewNavigate: async (projectId, to) => preview.navigate(str(projectId, 'projectId'), str(to, 'to')),
    previewOpenExternal: async (projectId) => preview.openExternal(str(projectId, 'projectId')),
    studioCapture: async (projectId, input) => {
      const project = repo.project(str(projectId, 'projectId'))
      const source: 'you' | 'before' | 'after' = input?.source === 'before' || input?.source === 'after' ? input.source : 'you'
      const shot = await preview.screenshot(project)
      // what it belongs to is the work open right now, or else the newest finished result
      const all = repo.deliveries(project.id)
      const owner = repo.openDelivery(project.id) ?? [...all].filter((d) => d.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0] ?? null
      const capture = { path: shot.path, at: shot.at, source, width: shot.width, height: shot.height, page: preview.info(project).page, deliveryId: owner?.id ?? null, taskId: typeof input?.taskId === 'string' ? input.taskId : null }
      recordCapture(project, capture)
      return { ...capture, deliveryNumber: owner?.number ?? null }
    },
    studioCaptures: async (projectId) => {
      const project = repo.project(str(projectId, 'projectId'))
      return listCaptures(project, repo.qualityReports(project.id, 60), repo.deliveries(project.id))
    },
    studioImage: async (projectId, path) => captureImage(repo.project(str(projectId, 'projectId')), str(path, 'path')),
    studioCrop: async (projectId, path, mark) => cropCapture(repo.project(str(projectId, 'projectId')), str(path, 'path'), mark),
    studioLaunch: async (projectId, id) => {
      const project = repo.project(str(projectId, 'projectId'))
      // only what was found on disk just now; the renderer names an option, never a path
      const option = launchOptions(project).find((l) => l.id === str(id, 'id'))
      if (!option) throw new Error('That can no longer be opened from this project')
      const problem = await shell.openPath(join(project.path, option.path))
      if (problem) throw new Error(`Your Mac couldn’t open ${option.path}: ${problem}`)
    },
    previewInspect: (projectId) => preview.inspect(str(projectId, 'projectId')),
    previewInspectCancel: async (projectId) => preview.cancelInspect(str(projectId, 'projectId')),
    previewMarkers: async (projectId, items) => preview.setMarkers(str(projectId, 'projectId'), Array.isArray(items) ? items : []),
    previewElement: (projectId, selector) => preview.elementSnapshot(str(projectId, 'projectId'), str(selector, 'selector')),
    sendVisualFeedback: (projectId, items) => orchestrator.sendVisualFeedback(str(projectId, 'projectId'), items),
    previewScreenshot: (projectId, crop) => preview.screenshot(repo.project(str(projectId, 'projectId')), crop ?? undefined),

    // each project has its own office; one that predates this keeps the look it already had
    async officeConfig(projectId) {
      const own = typeof projectId === 'string' ? repo.meta<OfficeConfig>(`office:${projectId}`) : null
      return sanitizeOffice(own ?? repo.meta<OfficeConfig>('office'))
    },

    async saveOfficeConfig(projectId, config) {
      const clean = sanitizeOffice(config)
      repo.setMeta(typeof projectId === 'string' ? `office:${projectId}` : 'office', clean)
      return clean
    },

    async policy() {
      return policyReport(claude.get(), orchestrator.lastSession, repo.meta<PolicyProbe>('policyProbe'))
    },

    async runPolicyProbe() {
      const info = claude.get()
      if (!info.available || !info.path) throw new Error(info.error ?? 'Claude Code CLI is not available')
      if (probing) throw new Error('A compatibility test is already running')
      probing = true
      try {
        const model = info.allowedModels && !info.allowedModels.includes('haiku') ? '' : 'haiku'
        repo.setMeta('policyProbe', await runPolicyProbe(info.path, model))
      } finally {
        probing = false
      }
      return policyReport(claude.get(), orchestrator.lastSession, repo.meta<PolicyProbe>('policyProbe'))
    },

    async pickDirectory() {
      const win = window()
      const res = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      return res.canceled ? null : res.filePaths[0] ?? null
    },

    async createProject(input: CreateProjectInput) {
      const name = str(input.name, 'name').trim()
      if (!name) throw new Error('Project name is required')
      const dir = str(input.directory, 'directory')
      // the default home for new projects simply doesn't exist yet on a first run
      if (dir === defaultProjectsDir()) mkdirSync(dir, { recursive: true })
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('Choose an existing folder')

      const path = input.mode === 'new' ? fsx.prepareNewProjectDir(dir, name) : dir
      const existing = repo.projectByPath(path)
      if (existing) return existing

      const alreadyGit = await git.isRepo(path)
      const useGit = input.mode === 'new' || alreadyGit || !!input.initGit
      const baseBranch = useGit ? await git.ensureRepo(path) : null
      if (baseBranch === 'HEAD') throw new Error('The repository is in detached HEAD state; check out a branch first')
      const goal = str(input.goal ?? '', 'goal')
      const officeType = isOfficeType(input.officeType) ? input.officeType : recommendOffice(`${name} ${goal}`).type
      const created = repo.createProject({ name, path, goal, gitEnabled: useGit, baseBranch, officeType })
      orchestrator.refreshTeams()
      orchestrator.warmCodeMap(created)
      return created
    },

    async getProject(id) {
      return {
        project: repo.project(id),
        tasks: repo.tasks(id),
        runs: repo.runs(id),
        approvals: repo.approvals(id)
      }
    },

    renameProject: async (id, name) => orchestrator.renameProject(str(id, 'id'), str(name, 'name')),
    stopProject: (id) => orchestrator.stopProject(str(id, 'id')),
    stopTask: (id) => orchestrator.stopTask(str(id, 'id')),
    async deleteProject(id) {
      const pid = str(id, 'id')
      await preview.stop(pid)
      return orchestrator.deleteProject(pid)
    },



    async portfolio() {
      const employees = repo.employees()
      return repo.projects().map((project) => {
        const tasks = repo.tasks(project.id)
        const runs = repo.runs(project.id, 500)
        const real = tasks.filter((t) => t.status !== 'proposed')
        const statuses = orchestrator.employeeStatuses()
        return {
          project,
          done: real.filter((t) => t.status === 'done' || t.status === 'cancelled').length,
          total: real.length,
          running: real.filter((t) => t.status === 'running' || t.status === 'merging').length,
          blocked: real.filter((t) => t.status === 'failed' || t.status === 'interrupted').length,
          pendingDecisions: repo.pendingApprovals(project.id).length,
          costUsd: runs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
          activeEmployees: statuses.filter((st) => st.projectId === project.id && st.runId && st.activity !== 'idle' && st.activity !== 'waiting').map((st) => st.employeeId),
          summary: projectSummary(project, tasks, runs, employees),
          purpose: purposeOf(repo.productSpec(project.id)?.vision, project.goal),
          lastActivity: Math.max(project.updatedAt, ...runs.map((r) => r.endedAt ?? r.startedAt)),
          latest: (() => {
            const d = repo.deliveries(project.id).filter((x) => x.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
            return d ? { number: d.number, status: d.status, at: d.completedAt! } : null
          })()
        }
      })
    },

    async employeeProfile(employeeId) {
      const employee = repo.employees().find((e) => e.id === str(employeeId, 'employeeId'))
      if (!employee) throw new Error('Unknown employee')
      const history = repo.assignmentHistory(employee.id)
      const runs = repo.employeeRuns(employee.id)
      const finished = history.filter((h) => h.status === 'done')
      const tasks = finished.map((h) => repo.task(h.taskId)).filter((t) => t.startedAt && t.finishedAt)
      const checks = history.reduce((n, h) => n + h.checksTotal, 0)
      return {
        employee,
        history,
        stats: {
          shipped: finished.length,
          sessions: runs.length,
          costUsd: runs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
          avgTaskMs: tasks.length ? tasks.reduce((n, t) => n + (t.finishedAt! - t.startedAt!), 0) / tasks.length : 0,
          checkPassRate: checks ? history.reduce((n, h) => n + h.checksPassed, 0) / checks : null
        }
      }
    },

    decisionBoard: async () => orchestrator.decisionBoard(),
    search: async (query) => repo.search(str(query, 'query').slice(0, 200)),
    deliveryMarks: async (projectId) => repo.meta<string[]>(`delivery-marks:${str(projectId, 'projectId')}`) ?? [],
    setDeliveryMark: async (deliveryId, on) => {
      const d = repo.delivery(str(deliveryId, 'deliveryId'))
      const key = `delivery-marks:${d.projectId}`
      const rest = (repo.meta<string[]>(key) ?? []).filter((id) => id !== d.id)
      const next = on === true ? [...rest, d.id] : rest
      repo.setMeta(key, next)
      return next
    },
    reassignTask: async (taskId, employeeId) => orchestrator.reassign(str(taskId, 'taskId'), str(employeeId, 'employeeId')),
    notifications: async () => repo.notifications(),
    markNotificationsRead: async (ids) => repo.markNotificationsRead(ids === 'all' ? 'all' : (ids as number[]).map(Number)),
    managerActions: async (projectId) => repo.managerActions(str(projectId, 'projectId')),
    cancelPlanning: (id) => orchestrator.cancelPlanning(str(id, 'id')),
    resolveApproval: (id, decision: ApprovalDecision) => orchestrator.resolveApproval(str(id, 'id'), decision),
    retryTask: (id) => orchestrator.retryTask(str(id, 'id')),
    runEvents: async (runId) => repo.events(str(runId, 'runId')),

    async listDir(projectId, relPath) {
      return fsx.listDir(repo.project(projectId).path, str(relPath, 'relPath'))
    },
    readFile: (projectId, relPath) => fsx.readFile(repo.project(projectId).path, str(relPath, 'relPath')),
    async revealInFinder(projectId, relPath) {
      shell.showItemInFolder(fsx.safeResolve(repo.project(projectId).path, str(relPath, 'relPath')))
    },

    async updateSettings(patch: Partial<Settings>) {
      const clean: Partial<Settings> = {}
      if (typeof patch.model === 'string') clean.model = patch.model.trim()
      if (typeof patch.planningModel === 'string') clean.planningModel = patch.planningModel.trim()
      if (typeof patch.maxParallel === 'number') clean.maxParallel = Math.min(LIMITS.maxParallel[1], Math.max(LIMITS.maxParallel[0], Math.round(patch.maxParallel)))
      if (typeof patch.preferSubscription === 'boolean') clean.preferSubscription = patch.preferSubscription
      if (typeof patch.autoResumeAfterLimit === 'boolean') clean.autoResumeAfterLimit = patch.autoResumeAfterLimit
      if (patch.permissionProfile === 'full' && bypassDisabled()) throw new Error('Full access is disabled by your organization policy')
      if (patch.permissionProfile === 'standard' || patch.permissionProfile === 'full') clean.permissionProfile = patch.permissionProfile
      if (patch.modelStrategy === 'adaptive' || patch.modelStrategy === 'fixed') clean.modelStrategy = patch.modelStrategy
      if (typeof patch.memoryRetentionDays === 'number') clean.memoryRetentionDays = Math.min(365, Math.max(7, Math.round(patch.memoryRetentionDays)))
      if (typeof patch.eventRetentionDays === 'number') clean.eventRetentionDays = Math.min(365, Math.max(3, Math.round(patch.eventRetentionDays)))
      if (patch.effort === 'auto' || patch.effort === 'low' || patch.effort === 'medium' || patch.effort === 'high' || patch.effort === 'xhigh' || patch.effort === 'max') clean.effort = patch.effort
      if (typeof patch.autoResolve === 'boolean') clean.autoResolve = patch.autoResolve
      if (typeof patch.autoApprove === 'boolean') clean.autoApprove = patch.autoApprove
      if (patch.desktopNotifications === 'important' || patch.desktopNotifications === 'all' || patch.desktopNotifications === 'off') clean.desktopNotifications = patch.desktopNotifications
      if (typeof patch.quietMode === 'boolean') clean.quietMode = patch.quietMode
      if (typeof patch.maxFixAttempts === 'number') clean.maxFixAttempts = Math.min(5, Math.max(0, Math.round(patch.maxFixAttempts)))
      const before = repo.settings()
      const s = repo.updateSettings(clean)
      if (before.preferSubscription !== s.preferSubscription) {
        setIgnoreApiKeys(s.preferSubscription)
        claude.set(await detectClaude())
      }
      if (before.autoResumeAfterLimit !== s.autoResumeAfterLimit || before.autoApprove !== s.autoApprove) orchestrator.settingsChanged()
      if (before.permissionProfile !== 'full' && s.permissionProfile === 'full') {
        const n = repo.addNotification({ projectId: null, taskId: null, kind: 'security', title: 'Full-access mode enabled', body: 'Agents now skip permission checks inside task worktrees.' })
        notify(n)
      }
      void orchestrator.schedule()
      return s
    }
  }

  ipcMain.handle(IPC.invoke, async (event, method: string, ...args: unknown[]) => {
    if (event.senderFrame?.url && !isAppUrl(event.senderFrame.url)) throw new Error('Untrusted sender')
    if (!Object.prototype.hasOwnProperty.call(handlers, method)) throw new Error(`Unknown method ${method}`)
    const fn = handlers[method as InvokeMethod] as (...a: unknown[]) => unknown
    if (MUTATING.has(method)) console.info(`[ipc] ${method}`, JSON.stringify(args).slice(0, 200))
    // right after launch Claude Code is still being looked for: that isn't the same as not having it
    if (NEEDS_CLAUDE.has(method)) await claude.ready
    return fn(...args)
  })

  ipcMain.on(IPC.presence, (_e, employeeId: unknown, location: unknown) => {
    if (typeof employeeId === 'string' && ['desk', 'meeting', 'elsewhere'].includes(location as string)) {
      orchestrator.reportPresence(employeeId, location as OfficeLocation)
    }
  })
}

// Calls that change workflow state are logged so every decision has an audit trail.
const LIVE_IMAGE = '.autopia/quality/live-preview.png'

const MUTATING = new Set(['setDeliveryMark', 'studioCapture', 'studioCrop', 'studioLaunch', 'previewOpenExternal', 'rememberProductImage', 'setProjectModel', 'tryProjectModel', 'updateClaude', 'connectClaude', 'stopProject', 'stopTask', 'createProject', 'renameProject', 'deleteProject', 'reassignTask', 'setTaskPriority', 'setProjectPriority', 'resolveApproval', 'retryTask', 'cancelPlanning', 'updateSettings', 'runPolicyProbe', 'saveOfficeConfig', 'decideDelivery', 'undoDelivery', 'requestRevision', 'opsRun', 'opsCancel', 'opsFix', 'opsSaveConfig', 'forgetKnowledge', 'previewStart', 'previewStop', 'previewRestart', 'reindexMemory', 'editKnowledge', 'setKnowledgeStatus', 'cleanupMemory', 'resetMemory', 'installSkillFromGitHub', 'importLocalSkill', 'approveSkill', 'removeSkill', 'setSkillEnabled', 'setSkillScope', 'runQualityAudit', 'runVisualQa', 'setQualityException', 'productFeedback', 'setProjectControls', 'sendMessage', 'saveAttachment'])

function isAppUrl(url: string): boolean {
  // an installed copy only ever trusts its own page; a dev server is only ever trusted in development
  if (app.isPackaged) return url.startsWith(pathToFileURL(join(app.getAppPath(), 'out/renderer')).href)
  return url.startsWith('file://') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')
}

/** New projects created from the Composer live here unless you choose another folder. */
export function defaultProjectsDir(): string {
  // a separate data folder is a separate world: nothing it makes lands among your real projects
  if (process.env.AUTOPIA_USER_DATA) return join(process.env.AUTOPIA_USER_DATA, 'projects')
  return join(homedir(), 'Autopia')
}

/** A short, readable project name from the first words of an idea (editable later). */
export { projectNameFrom }

function uniqueName(root: string, name: string): string {
  const slug = fsx.slugify
  if (!existsSync(join(root, slug(name)))) return name
  for (let i = 2; i < 100; i++) if (!existsSync(join(root, slug(`${name} ${i}`)))) return `${name} ${i}`
  return `${name} ${Date.now()}`
}
