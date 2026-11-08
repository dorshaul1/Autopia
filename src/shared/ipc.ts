import type { OfficeType } from './offices'
import type { ClaudeCapabilities } from './claudeCode'
import type {
  EmployeeAttention,
  PolicyReport,
  Delivery,
  ValidationRun,
  PreviewInfo,
  ChangeSet,
  DiffFile,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeStatus,
  MemoryReport,
  Screenshot,
  OfficeConfig,
  Approval,
  ApprovalDecision,
  ClaudeInfo,
  Employee,
  EmployeeProfile,
  EmployeeStatus,
  ManagerAction,
  Notification,
  PortfolioItem,
  FileContent,
  FsEntry,
  OfficeLocation,
  Project,
  ProjectMetrics,
  ProjectSnapshot,
  Run,
  RunEvent,
  Settings,
  Task, SkillInstall, SkillsReport, Message, SendMessageInput, ProductDeliverable, ProductSpec, QualityDimension, QualityOverview, QualityReport, Readiness } from './types'

export interface BootstrapData {
  claude: ClaudeInfo
  employees: Employee[]
  statuses: EmployeeStatus[]
  projects: Project[]
  settings: Settings
}

export interface CreateProjectInput {
  name: string
  goal: string
  /** 'new' creates `<parentDir>/<slug>`; 'open' uses an existing folder. */
  mode: 'new' | 'open'
  directory: string
  initGit: boolean
  /** The office this project lives in; defaults to the one recommended for its goal. */
  officeType?: OfficeType
}

/** Request/response channels (renderer -> main). */
export interface AutopiaApi {
  bootstrap(): Promise<BootstrapData>
  refreshClaude(): Promise<ClaudeInfo>
  /** Claude Code plan usage as last reported by the CLI (status and reset times; no estimates). */
  usage(): Promise<UsageView>
  /** The indicator above each teammate that waits for you. */
  attention(): Promise<EmployeeAttention[]>
  /** Continue work held at a usage limit (each paused task resumes its own session once). */
  resumeAfterLimit(): Promise<number>
  /** Open Claude's official usage page in the browser. */
  openUsagePage(): Promise<void>
  officeConfig(projectId: string | null): Promise<OfficeConfig>
  gitCheck(): Promise<{ available: boolean }>
  cancelConnectClaude(): Promise<void>
  saveOfficeConfig(projectId: string | null, config: OfficeConfig): Promise<OfficeConfig>
  /** Effective Claude Code permissions: managed policy, latest session, and the last live test. */
  policy(): Promise<PolicyReport>
  /** Founder-initiated live compatibility test (one short session in a temp folder). */
  runPolicyProbe(): Promise<PolicyReport>
  pickDirectory(): Promise<string | null>
  createProject(input: CreateProjectInput): Promise<Project>
  getMetrics(projectId: string): Promise<ProjectMetrics>
  getProject(id: string): Promise<ProjectSnapshot>
  renameProject(id: string, name: string): Promise<Project>
  /** Removes the project from Autopia. Files on disk and task branches are kept. */
  deleteProject(id: string): Promise<{ keptBranches: string[] }>
  // delivery & review
  deliveries(projectId: string): Promise<Delivery[]>
  changes(projectId: string, deliveryId: string | null): Promise<ChangeSet>
  uncommittedDiff(projectId: string): Promise<DiffFile[]>
  decideDelivery(deliveryId: string, decision: 'accept' | 'reject', note: string | null): Promise<Delivery>
  /** Reverts a discarded result's merges with new commits (refused if it could touch your work or a later result). */
  undoDelivery(deliveryId: string): Promise<Delivery>
  requestRevision(projectId: string, input: { deliveryId: string | null; text: string; screenshot: string | null; taskId: string | null }): Promise<Delivery>
  validations(projectId: string): Promise<ValidationRun[]>
  /** What this project really is and where it stands, read from its folder now. */
  opsState(projectId: string): Promise<import('./operations').OpsState>
  /** Runs one of the commands that state lists, in the project folder. `confirmed` means you've seen the exact command. */
  opsRun(projectId: string, commandId: string, confirmed: boolean): Promise<ValidationRun>
  /** Is the product's folder still where Autopia expects it? */
  projectFolderExists(projectId: string): Promise<boolean>
  opsCancel(validationId: string): Promise<void>
  opsFix(projectId: string, input: { source: 'process' | 'check'; validationId?: string }): Promise<Task>
  opsSaveConfig(projectId: string, config: import('./environment').OpsConfig): Promise<import('./operations').OpsState>
  // skills (external ones come only from where you point, and stay off until you approve them)
  skillsReport(): Promise<SkillsReport>
  installSkillFromGitHub(url: string): Promise<SkillInstall>
  /** Without a path, asks for a folder. */
  importLocalSkill(path?: string): Promise<SkillInstall | null>
  approveSkill(id: string): Promise<SkillInstall>
  removeSkill(id: string): Promise<void>
  setSkillEnabled(id: string, enabled: boolean): Promise<void>
  setSkillScope(scope: 'routed' | 'personal'): Promise<void>
  // conversation
  messages(projectId: string): Promise<Message[]>
  /** Stop an answer that is still being written. */
  stopMessage(id: string): Promise<void>
  /** The product's latest real capture as a small image, or null if it has none. */
  productImage(projectId: string): Promise<string | null>
  /** Keeps what the running preview shows right now as the product's image. */
  rememberProductImage(projectId: string): Promise<boolean>
  /** What Claude Code offers in this project, from Claude Code itself. */
  claudeCapabilities(projectId: string, fresh?: boolean): Promise<ClaudeCapabilities>
  /** The same, for Settings: works with no product open. */
  claudeOverview(projectId: string | null, fresh: boolean): Promise<ClaudeCapabilities>
  /** The official page on installing Claude Code, in your browser. */
  openClaudeInstall(): Promise<void>
  claudeLatest(): Promise<string | null>
  updateClaude(): Promise<string>
  /** Opens Claude Code's own sign-in. */
  connectClaude(): Promise<ClaudeInfo>
  /** An attached image as a data URL (null when it isn't one of this project's attachments). */
  attachmentImage(projectId: string, rel: string): Promise<string | null>
  /** One entry point for everything typed in the Composer; dispatches to the existing flows. */
  sendMessage(input: SendMessageInput): Promise<Message>
  /** Saves a pasted or dropped image into the project's .autopia/attachments folder. */
  saveAttachment(projectId: string, name: string, dataUrl: string): Promise<string>
  /** Where new projects are created by default (~/Autopia). */
  defaultProjectsDir(): Promise<string>
  // company director
  setProjectControls(projectId: string, patch: { paused?: boolean }): Promise<Project>
  /** Pending decisions across every project, newest first. */
  allDecisions(): Promise<Approval[]>
  // product mode
  productSpec(projectId: string): Promise<ProductSpec | null>
  productDeliverable(projectId: string): Promise<ProductDeliverable>
  /** Natural-language feedback: before approval it revises the plan, afterwards it becomes a scoped revision. */
  productFeedback(projectId: string, text: string): Promise<'replanned' | 'queued' | 'revision'>
  // quality engine: evidence-based readiness, static audit, visual QA, documented exceptions
  qualityOverview(projectId: string): Promise<QualityOverview>
  /** Evidence-based readiness for one result (any result, not just the latest). */
  readiness(projectId: string, deliveryId: string): Promise<Readiness>
  runQualityAudit(projectId: string, deliveryId: string | null): Promise<QualityReport>
  runVisualQa(projectId: string, deliveryId: string | null): Promise<QualityReport>
  verifyDelivery(deliveryId: string): Promise<void>
  setQualityException(projectId: string, deliveryId: string, dimension: QualityDimension, note: string | null): Promise<Readiness>
  qualityShot(projectId: string, path: string): Promise<string>
  // long-term memory
  stopProject(projectId: string): Promise<void>
  stopTask(taskId: string): Promise<void>
  memoryReport(projectId: string): Promise<MemoryReport>
  planRisks(projectId: string): Promise<string[]>
  reindexMemory(projectId: string): Promise<MemoryReport>
  editKnowledge(projectId: string, input: { id: string | null; kind: KnowledgeKind; title: string; text: string; rationale: string | null; alternatives: string | null; files: string[] }): Promise<KnowledgeEntry | null>
  setKnowledgeStatus(id: string, status: KnowledgeStatus): Promise<void>
  forgetKnowledge(id: string, confirmUserNote: boolean): Promise<void>
  resetMemory(projectId: string, includeUser: boolean): Promise<number>
  // live preview (rendered in an isolated view positioned over the renderer's frame)
  previewInfo(projectId: string): Promise<PreviewInfo>
  previewStart(projectId: string, confirmed: boolean): Promise<PreviewInfo>
  mayRunCommand(projectId: string, command: string): Promise<boolean>
  previewStop(projectId: string): Promise<void>
  previewRestart(projectId: string, confirmed: boolean): Promise<PreviewInfo>
  previewBounds(projectId: string | null, bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>
  previewReload(projectId: string): Promise<void>
  previewFrame(projectId: string): Promise<string | null>
  previewNavigate(projectId: string, to: string): Promise<void>
  previewOpenExternal(projectId: string): Promise<void>
  studioCapture(projectId: string, input: { source: 'you' | 'before' | 'after'; taskId: string | null }): Promise<import('./studio').Capture>
  studioCaptures(projectId: string): Promise<import('./studio').Capture[]>
  studioImage(projectId: string, path: string): Promise<string>
  studioCrop(projectId: string, path: string, mark: import('./studio').RelRect): Promise<string>
  studioLaunch(projectId: string, id: string): Promise<void>
  previewInspect(projectId: string): Promise<import('./inspect').Picked | null>
  previewInspectCancel(projectId: string): Promise<void>
  previewMarkers(projectId: string, items: { n: number; selector: string | null; rect: { x: number; y: number } }[]): Promise<void>
  previewElement(projectId: string, selector: string): Promise<import('./inspect').ElementSnapshot | null | undefined>
  sendVisualFeedback(projectId: string, items: { id: string; note: string; pick: import('./inspect').Picked; shot: string | null }[]): Promise<import('./inspect').FeedbackItem[]>
  previewScreenshot(projectId: string, crop: { x: number; y: number; width: number; height: number } | null): Promise<Screenshot>
  portfolio(): Promise<PortfolioItem[]>
  employeeProfile(employeeId: string): Promise<EmployeeProfile>
  reassignTask(taskId: string, employeeId: string): Promise<void>
  /** Everything needing you across every product, most held up first. */
  decisionBoard(): Promise<import('./decisions').BoardItem[]>
  /** Everything recorded that matches, across every product. No AI. */
  search(query: string): Promise<import('./types').SearchHit[]>
  /** Results you've marked as milestones. */
  deliveryMarks(projectId: string): Promise<string[]>
  setDeliveryMark(deliveryId: string, on: boolean): Promise<string[]>
  notifications(): Promise<Notification[]>
  markNotificationsRead(ids: number[] | 'all'): Promise<void>
  managerActions(projectId: string): Promise<ManagerAction[]>
  resolveApproval(id: string, decision: ApprovalDecision): Promise<void>
  retryTask(id: string): Promise<void>
  cancelPlanning(projectId: string): Promise<void>
  runEvents(runId: string): Promise<RunEvent[]>
  listDir(projectId: string, relPath: string): Promise<FsEntry[]>
  readFile(projectId: string, relPath: string): Promise<FileContent>
  revealInFinder(projectId: string, relPath: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  reportPresence(employeeId: string, location: OfficeLocation): void
  onEvent(listener: (event: PushEvent) => void): () => void
}

/** Push events (main -> renderer). */
/** Claude Code plan usage as the CLI reported it (no estimates), plus whether work is held at a limit. */
export interface UsageView {
  limits: { type: string; status: string; resetsAt: number | null; utilization: number | null; seenAt: number }[]
  extra: { status: string | null; reason: string | null; using: boolean } | null
  updatedAt: number | null
  hold: { type: string | null; until: number | null; since: number } | null
}

export type PushEvent =
  | { type: 'project'; project: Project }
  | { type: 'projectDeleted'; projectId: string }
  | { type: 'task'; task: Task }
  | { type: 'run'; run: Run }
  | { type: 'runEvent'; projectId: string; event: RunEvent }
  | { type: 'employee'; status: EmployeeStatus }
  | { type: 'approval'; approval: Approval }
  | { type: 'claude'; info: ClaudeInfo }
  | { type: 'usage'; usage: UsageView }
  | { type: 'attention'; items: EmployeeAttention[] }
  /** A desktop notification was clicked: show what it is about. */
  | { type: 'openNotification'; notification: Notification }
  | { type: 'team'; employees: Employee[] }
  | { type: 'notification'; notification: Notification }
  | { type: 'managerAction'; action: ManagerAction }
  | { type: 'delivery'; delivery: Delivery }
  | { type: 'validation'; validation: ValidationRun }
  | { type: 'preview'; preview: PreviewInfo }
  | { type: 'quality'; report: QualityReport }
  | { type: 'product'; spec: ProductSpec }
  | { type: 'message'; message: Message }

export const IPC = {
  invoke: 'autopia:invoke',
  push: 'autopia:push',
  presence: 'autopia:presence'
} as const

export type InvokeMethod = Exclude<keyof AutopiaApi, 'onEvent' | 'reportPresence'>
