import type { DeliveryVerification } from './delivery'
// Domain model shared between the main process (source of truth) and the renderer.

import type { WorkDoing } from './workActivity'

export type RoleId = 'pm' | 'lead_dev' | 'designer' | 'qa' | 'engineer'

/** What an employee can actually do; drives assignment (not a simulated skill rating). */
export type Capability =
  | 'planning'
  | 'architecture'
  | 'backend'
  | 'api'
  | 'data'
  | 'frontend'
  | 'ui-design'
  | 'styling'
  | 'accessibility'
  | 'testing'
  | 'qa'
  | 'docs'
  | 'devops'
  | 'performance'
  | 'security'
  // game development
  | 'gameplay'
  | 'game-design'
  | 'level-design'
  | 'game-art'
  // AI and automation
  | 'llm'
  | 'ml'
  | 'data-pipelines'
  | 'evaluation'
  | 'mlops'

export interface Appearance {
  skin: string
  hair: string
  hairStyle: 'short' | 'long' | 'bun' | 'curly' | 'buzz'
  shirt: string
  shirtAccent: string
  pants: string
  shoes: string
  accessory: 'none' | 'glasses' | 'headphones' | 'beanie' | 'earrings'
  /** Outfit cut, so each employee has a distinct silhouette. */
  outfit: 'blazer' | 'hoodie' | 'sweater' | 'overshirt'
  /** Inner layer visible under open jackets. */
  inner: string
}

export interface Employee {
  id: string
  role: RoleId
  name: string
  title: string
  bio: string
  appearance: Appearance
  deskId: string
  specialization: string
  capabilities: Capability[]
  /** Task kinds this employee can own. */
  kinds: TaskKind[]
  hiredAt: number
  /** The project whose office this person works in; null for the original Autopia team (shared by older projects). */
  projectId?: string | null
}

/** What an employee is doing in the real workflow. Visual behaviour is derived from this. */
export type EmployeeActivity = 'idle' | 'meeting' | 'working' | 'testing' | 'reviewing' | 'waiting' | 'error'

export interface EmployeeStatus {
  employeeId: string
  activity: EmployeeActivity
  projectId: string | null
  taskId: string | null
  runId: string | null
  /** Short, real description of the latest tool activity, e.g. "Edit src/app.ts". */
  detail: string | null
  /** What the real tool events say they're doing; absent until there's an event to go on. */
  doing?: WorkDoing | null
  /** Claude Code is holding for your answer right now: a permission or a question. */
  needsYou?: boolean
  /** Why this employee was activated (the task's rationale), shown in the UI. */
  reason: string | null
  since: number
}

export type ProjectPhase =
  | 'new'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'executing'
  | 'blocked'
  | 'completed'
  | 'failed'

export interface Project {
  id: string
  name: string
  path: string
  goal: string
  phase: ProjectPhase
  gitEnabled: boolean
  baseBranch: string | null
  planSummary: string | null
  lastError: string | null
  /** How the current iteration is being executed. */
  strategy: ExecutionStrategy | null
  complexity: Complexity | null
  /** Reusable repo summary produced during planning, so agents don't re-explore. */
  contextSummary: string | null
  /** -1 low, 0 normal, 1 high. Higher-priority projects get execution slots first. */
  priority: number
  /** The kind of company this project lives in (its office, team and development guidance). */
  officeType: import('./offices').OfficeType
  /** Spending cap for this project in USD (null = no cap). New work stops when reached. */
  budgetUsd: number | null
  /** Paused by the CEO: nothing new starts; running work finishes. */
  paused: boolean
  createdAt: number
  updatedAt: number
}

export type Complexity = 'simple' | 'medium' | 'complex'
/**
 * direct = one agent, no planning meeting; light = one agent that plans its own steps in-session (no
 * planning meeting, no approval wait); plan = PM plans, founder approves, scheduler runs the graph.
 */
export type ExecutionStrategy = 'direct' | 'light' | 'plan'
export type TaskSize = 's' | 'm' | 'l'

export interface Triage {
  complexity: Complexity
  strategy: ExecutionStrategy
  /** Role that would take a direct task. */
  role: RoleId
  reasons: string[]
}

/**
 * passed/failed = Claude ran the command with its own Bash tool and Autopia read the exit status.
 * blocked = Claude Code refused it (organization or CLI policy). denied = the founder declined it.
 * missing = the agent never ran it.
 */
export type CheckStatus = 'passed' | 'failed' | 'blocked' | 'denied' | 'missing'

export interface CheckResult {
  command: string
  status: CheckStatus
  ok: boolean
  ms: number
  /** Tail of combined output. */
  output: string
  at: number
}

export type TaskStatus =
  | 'proposed' // part of a plan awaiting approval
  | 'pending' // approved, waiting on dependencies / a free slot
  | 'running'
  | 'merging'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted' // app quit while running; resumable

export type TaskKind = 'code' | 'design' | 'qa'

/**
 * What an interruption left behind (verified from the task record and git) and the one safe way to
 * continue it. Kept on the task until it finishes, so it survives restarts.
 */
export interface TaskRecovery {
  reason: 'restart' | 'cli_exit' | 'network' | 'usage_limit' | 'stalled' | 'resume_failed' | 'stopped'
  /** Its own work, or integrating work that had already passed its checks. */
  stage: 'work' | 'integrate'
  at: number
  /** Interruptions in a row without finishing. */
  count: number
  sessionId: string | null
  /** false once Claude Code reported it no longer has the session; null when not yet known. */
  sessionResumable: boolean | null
  git: { worktree: boolean; branch: boolean; commits: number; uncommitted: string[]; merged: boolean } | null
  /** Plain lines: what work is preserved. */
  preserved: string[]
  next: 'finish' | 'integrate' | 'resume' | 'reattach' | 'continue' | 'restart'
}

export interface Task {
  id: string
  projectId: string
  /** The delivery (user request) this task implements. */
  deliveryId: string | null
  key: string
  title: string
  description: string
  acceptance: string
  kind: TaskKind
  assigneeId: string
  status: TaskStatus
  dependsOn: string[]
  sortOrder: number
  attempts: number
  sessionId: string | null
  resultSummary: string | null
  lastError: string | null
  changedFiles: string[]
  /** Why this task exists and why this role owns it. */
  rationale: string | null
  size: TaskSize
  /** Paths/globs the task is expected to touch; used to avoid conflicting parallel work. */
  files: string[]
  /** Local, deterministic commands Autopia runs to verify the task. */
  validation: string[]
  checks: CheckResult[]
  model: string | null
  fixAttempts: number
  conflicts: number
  /** -1 low, 0 normal, 1 high; combined with critical-path rank by the scheduler. */
  priority: number
  /** Capabilities the task needs; used to match an owner. */
  skills: Capability[]
  /** Teammate consultations already used (bounded). */
  consults: number
  /** Structured input waiting for this task (a consult answer or founder reply). */
  note: string | null
  startedAt: number | null
  finishedAt: number | null
  /** How this task will be verified, decided before work starts (deterministic). */
  qualityPlan: QualityPlan | null
  /** The agent's account of each acceptance criterion (a report, backed by checks only where it says so). */
  criteria: CriterionReport[]
  /** Why automatic repair stopped early, when it did. */
  repairStop: string | null
  /** Set while the task is interrupted: why it stopped, what is preserved, and the safe way to continue. */
  recovery: TaskRecovery | null
  /** Product milestone this task belongs to (1-based); null outside product mode. */
  milestone: number | null
  createdAt: number
  updatedAt: number
}

export type RunKind = 'planning' | 'task' | 'validation' | 'ask'
/** What a run was for: initial work, a bounded fix after failed checks, or merge-conflict resolution. */
export type RunPurpose = 'plan' | 'work' | 'fix' | 'resolve' | 'retry' | 'validate' | 'ask'
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface Run {
  id: string
  projectId: string
  taskId: string | null
  employeeId: string
  kind: RunKind
  status: RunStatus
  sessionId: string | null
  cwd: string
  model: string | null
  costUsd: number | null
  numTurns: number | null
  error: string | null
  purpose: RunPurpose
  /** Token usage as reported by the CLI's result message (null when not reported). */
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  durationMs: number | null
  apiMs: number | null
  /** Memory entries injected into this run's prompt and their size. */
  contextIds: string[]
  contextChars: number | null
  /** File-discovery tool calls (Read/Glob/Grep/listing commands) the agent made. */
  exploreCalls: number | null
  /** Methods, skills and subagents routed to this run. */
  skills: RunSkills | null
  /** Reasoning effort Autopia requested for this session (null = Claude Code's default). */
  effort: string | null
  startedAt: number
  endedAt: number | null
}

export type RunEventKind =
  | 'init'
  | 'thinking'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'stderr'
  | 'error'
  | 'system'

export interface RunEvent {
  id: number
  runId: string
  seq: number
  ts: number
  kind: RunEventKind
  /** One-line human summary. */
  summary: string
  /** Optional longer body (truncated). */
  detail: string | null
  toolName: string | null
  isError: boolean
}

/** permission = a live Claude Code "ask" for one tool call; unverified = required checks could not run. */
export type ApprovalKind = 'plan' | 'task_failed' | 'question' | 'permission' | 'unverified' | 'budget' | 'verify'
export type ApprovalStatus = 'pending' | 'resolved'

export interface Approval {
  id: string
  projectId: string
  taskId: string | null
  kind: ApprovalKind
  status: ApprovalStatus
  title: string
  body: string
  resolution: string | null
  createdAt: number
  resolvedAt: number | null
}

export type ApprovalDecision =
  | { kind: 'plan'; action: 'approve'; answers?: Record<string, string> }
  | { kind: 'plan'; action: 'revise'; feedback: string }
  | { kind: 'task_failed'; action: 'retry' | 'skip' | 'stop' }
  | { kind: 'question'; answer: string }
  | { kind: 'permission'; action: 'allow' | 'allow_task' | 'deny' }
  | { kind: 'unverified'; action: 'accept' | 'retry' | 'skip' }
  | { kind: 'budget'; action: 'raise'; budgetUsd: number }
  | { kind: 'budget'; action: 'pause' }
  | { kind: 'verify'; action: 'allow' | 'skip' }

export interface ClaudeInfo {
  available: boolean
  path: string | null
  version: string | null
  error: string | null
  /** Organization-managed policy limits that change what agents can do on this machine. */
  restrictions: string[]
  /** Models the org allows (null = unrestricted). */
  allowedModels: string[] | null
  /** The signed-in Claude Code account agents use (null if it could not be read). */
  account?: { loggedIn: boolean; email: string | null; organization: string | null; plan: string | null; method: string | null } | null
  /** Who pays for agents' sessions (subscription, API key, cloud) and any unexpected-charge warnings. */
  billing?: { mode: 'subscription' | 'api' | 'cloud' | 'unknown'; plan: string | null; warnings: string[]; ignored: string[] }
}

/** Reported by Claude Code's init message for the latest session. */
export interface ClaudeSession {
  permissionMode: string | null
  apiKeySource: string | null
  tools: string[]
  mcpServers: { name: string; status: string }[]
  at: number
}

// ── delivery & review ─────────────────────────────────────────────

/**
 * Implementation → Validation → Review → (user) Acceptance. "review" means the team finished; only
 * the founder can move a delivery to accepted, ask for a revision, or reject it.
 */
export type DeliveryStatus = 'implementing' | 'validating' | 'review' | 'accepted' | 'revising' | 'rejected'

export interface Delivery {
  id: string
  projectId: string
  /** The delivery this one revises, if any. */
  parentId: string | null
  number: number
  kind: 'brief' | 'revision'
  /** The founder's words: the brief or the revision request. */
  request: string
  status: DeliveryStatus
  /** Base commit when work started and the commit when the team finished (git projects). */
  baseSha: string | null
  headSha: string | null
  summary: string | null
  /** Known gaps: unverified checks, skipped or failed tasks. Never hidden. */
  /** How Autopia chose to run it (null for results from before this was recorded). */
  strategy: ExecutionStrategy | 'revision' | null
  limitations: string[]
  /** The result actually run in the project folder: what was measured, and where that left it. */
  verification: DeliveryVerification | null
  /** Screenshot attached to a revision request (path inside the project's .autopia folder). */
  screenshot: string | null
  createdAt: number
  completedAt: number | null
  decidedAt: number | null
  decisionNote: string | null
}

export interface ValidationRun {
  id: string
  projectId: string
  deliveryId: string | null
  runId: string | null
  /** ops = run by Autopia itself in the project folder, with no AI involved. */
  trigger: 'task' | 'manual' | 'ops'
  status: 'running' | 'passed' | 'failed' | 'unverified' | 'error' | 'cancelled'
  /** What it's running (ops runs: known from the start). */
  command?: string | null
  /** Exactly which code it ran against. */
  stamp?: string | null
  /** The end of the output so far, while it runs. Never stored. */
  live?: string | null
  checks: CheckResult[]
  error: string | null
  startedAt: number
  endedAt: number | null
}

/**
 * stack/module/workflow/dependency/convention are derived by Autopia directly from repository files
 * (no AI). architecture/decision/handoff/completed/limitation come from work; lesson from history.
 */
export type KnowledgeKind =
  | 'stack'
  | 'module'
  | 'workflow'
  | 'dependency'
  | 'convention'
  | 'architecture'
  | 'decision'
  | 'limitation'
  | 'completed'
  | 'handoff'
  | 'lesson'

/** verified = read by Autopia from the files; reported = an agent's account; user = written or corrected by the founder. */
export type KnowledgeConfidence = 'verified' | 'reported' | 'user'
export type KnowledgeStatus = 'active' | 'stale' | 'archived'

/** One compact, deduplicated fact (keyed by topic) with its provenance and freshness. */
export interface KnowledgeEntry {
  id: string
  projectId: string
  kind: KnowledgeKind
  /** Stable dedupe key: writing the same topic updates the entry instead of appending. */
  topic: string
  title: string
  text: string
  /** Decision records: why, and what else was considered. */
  rationale: string | null
  alternatives: string | null
  files: string[]
  /** git blob hash of each file when the entry was last confirmed. */
  hashes: Record<string, string>
  /** Repository commit when the entry was last confirmed. */
  commit: string | null
  source: string
  confidence: KnowledgeConfidence
  status: KnowledgeStatus
  author: 'system' | 'agent' | 'user'
  /** How many prompts included it, and when last. */
  uses: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  /** Convenience: status === 'stale'. */
  stale: boolean
  /** Why it was set aside (file changed or removed, superseded, conflicts with your decision); null when active. */
  statusNote: string | null
}

/** What memory gave one run, kept so the founder can see it and so savings can be measured. */
export interface ContextUse {
  ids: string[]
  chars: number
}

export interface MemoryIndexInfo {
  commit: string | null
  indexedAt: number | null
  files: number
  skippedSecrets: number
  hasClaudeMd: boolean
  /** The code map, once it has run: real counts of what's parsed. */
  graph?: CodeGraphInfo
}

export interface CodeGraphInfo {
  files: number
  symbols: number
  /** Files actually parsed the last time it updated; everything else was already current. */
  parsed: number
  ms: number
  at: number
  /** False while a large repository is still being read, or if it's bigger than the map covers. */
  complete: boolean
}

export interface Lesson {
  topic: string
  title: string
  text: string
  evidence: number
  audience: 'agents' | 'founder'
}

export interface HistoryStat {
  label: string
  n: number
  medianMs: number | null
  medianCostUsd: number | null
  medianTokens: number | null
}

export interface MemoryReport {
  index: MemoryIndexInfo
  entries: KnowledgeEntry[]
  lessons: Lesson[]
  stats: HistoryStat[]
  /** Exploration per run, with and without memory context (observational, not causal). */
  exploration: { withContext: { runs: number; avgCalls: number; avgInputTokens: number | null }; without: { runs: number; avgCalls: number; avgInputTokens: number | null } }
  usage: { runId: string; taskKey: string | null; employeeId: string; contextChars: number; contextIds: string[]; exploreCalls: number | null; at: number }[]
}

export interface DiffLine {
  t: '+' | '-' | ' '
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string | null
  status: 'A' | 'M' | 'D' | 'R'
  additions: number
  deletions: number
  binary: boolean
  truncated: boolean
  hunks: DiffHunk[]
}

export interface ChangeSet {
  base: string | null
  head: string | null
  branch: string | null
  commits: { sha: string; subject: string; author: string; at: number; taskKey: string | null }[]
  files: DiffFile[]
  /** Attribution from Autopia's per-task merge commits (only when it is reliable). */
  byTask: { taskId: string; key: string; title: string; employeeId: string; files: string[] }[]
  /** The founder's own uncommitted edits: shown, never touched. */
  uncommitted: { path: string; status: string }[]
  note: string | null
}

export type PreviewStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'unavailable'

export interface PreviewInfo {
  projectId: string
  /** static = served read-only by Autopia; script = the project's own dev script (needs your OK). */
  kind: 'static' | 'script' | 'none'
  framework: string | null
  /** Exact command Autopia would run for a script preview. */
  command: string | null
  /** Why there is no preview (for kind none), or why a script can't run (policy). */
  reason: string | null
  status: PreviewStatus
  url: string | null
  port: number | null
  logs: string[]
  error: string | null
  /** For projects without a web preview: build outputs and launch notes found on disk. */
  artifacts: { path: string; note: string }[]
  /** What can be opened outside Autopia, found on disk. */
  launch: import('./studio').LaunchOption[]
  /** Things found that Autopia can't open for you. */
  limits: string[]
  /** Where the page is right now, as the page itself reports it. */
  page: string | null
  canBack: boolean
  canForward: boolean
  /** port = it should open a page; process = staying alive is all it does. */
  expects?: 'port' | 'process'
  /** The process group Autopia started, while it is alive. */
  pid?: number | null
  startedAt?: number | null
  /** It ended by itself without an error: that isn't a crash. */
  finished?: string | null
}

export interface Screenshot {
  /** Path relative to the project (inside .autopia/, excluded from git). */
  path: string
  dataUrl: string
  width: number
  height: number
  at: number
}

export type CapabilityType = 'workflow' | 'skill' | 'plugin' | 'subagent' | 'mcp' | 'hook' | 'tool'

/** One entry in Autopia's capability registry, whatever its mechanism. */
/** Something on record that matched a search, and where it lives. */
export interface SearchHit {
  kind: 'task' | 'delivery' | 'message' | 'employee' | 'file'
  /** Its id; for a file, its path. */
  id: string
  title: string
  projectId: string
  projectName: string
  at: number
}

export interface SkillFinding {
  severity: 'info' | 'warn' | 'danger'
  file: string
  message: string
}

/** An external skill you installed (never active until you approve it). */
export interface SkillInstall {
  id: string
  catalogId: string
  repo: string
  path: string
  sha: string
  status: 'reviewing' | 'approved' | 'disabled' | 'rejected'
  files: { path: string; bytes: number }[]
  findings: SkillFinding[]
  skillMd: string
  downloadedAt: number
  approvedAt: number | null
}

/** What a run was given: chosen methods, third-party skills and subagents, with the routing reasons. */
export interface RunSkills {
  /** Professional methods given to this run (skills/expertise). */
  expertise?: string[]
  primary: string | null
  domains: string[]
  /** Approved external skills offered to this run (loaded through --plugin-dir). */
  skills: string[]
  /** Why each one was selected, as decided at the time. Older runs don't have it. */
  why?: Record<string, string>
  /** Names to show for the ids above. */
  labels?: Record<string, string>
  subagents: string[]
  /** What Claude Code itself reported: offered skills present in the session's init message. */
  available?: string[]
  /** Skills the agent actually invoked with the Skill tool, and subagents it actually started. */
  invoked?: string[]
  subagentsUsed?: string[]
  risk: 'low' | 'normal' | 'high'
  reasons: string[]
}

export interface SkillsReport {
  skills: import('./skills').SkillEntry[]
  installs: SkillInstall[]
  scope: 'routed' | 'personal'
  personalSkills: string[]
  /** Your organization's policy applies to something on this list. */
  orgManaged: boolean
}

// Founder's office customization: cosmetic only, never affects work. One per project.
export { DEFAULT_OFFICE, type OfficeConfig } from './officeDecor'

export type PermissionProfile = 'standard' | 'full'

/**
 * allowed = runs without asking; approval = Claude Code asks and Autopia relays it to the founder;
 * blocked = refused by policy; unsupported = not available with this CLI/policy; unknown = not determined.
 */
export type CapabilityStatus = 'allowed' | 'approval' | 'blocked' | 'unsupported' | 'unknown'

export interface CapabilityRow {
  id: string
  label: string
  /** Representative command or tool. */
  example: string
  status: CapabilityStatus
  /** Who decides: the organization's managed policy, Claude Code itself, or Autopia. */
  source: 'organization' | 'claude-code' | 'autopia'
  detail: string
  remediation: string | null
  /** 'policy' = predicted from the managed rules; 'probe' = observed in a live compatibility test. */
  evidence: 'policy' | 'probe'
}

export interface PolicyProbe {
  at: number
  model: string | null
  costUsd: number | null
  permissionMode: string | null
  apiKeySource: string | null
  /** command or tool → observed status */
  observed: Record<string, CapabilityStatus>
  error: string | null
}

export interface PolicyReport {
  cli: { path: string | null; version: string | null; available: boolean }
  managedFile: string | null
  flags: {
    managedRulesOnly: boolean
    bypassDisabled: boolean
    managedMcpOnly: boolean
    enforcedModels: string[] | null
  }
  rules: { allow: string[]; deny: string[]; ask: string[] }
  /** What Autopia requests for write tasks, and what the CLI reported in the latest session. */
  mode: { requested: string; reported: string | null; reportedAt: number | null; apiKeySource: string | null }
  capabilities: CapabilityRow[]
  probe: PolicyProbe | null
}

export interface Settings {
  /** Empty string = Claude Code's default model. */
  model: string
  planningModel: string
  maxParallel: number
  /**
   * Use your Claude subscription for agents even if ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are set in
   * the environment (Autopia leaves those out of agents' environment). Off = Claude Code decides, as in
   * a terminal.
   */
  preferSubscription: boolean
  /** After a real usage limit, continue paused work automatically once Claude Code's reported reset time passes. */
  autoResumeAfterLimit: boolean
  permissionProfile: PermissionProfile
  /** Claude Code's effort for building and direct chats; auto = Autopia chooses per task. */
  effort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** adaptive = pick the model per task size/complexity; fixed = always use `model`. */
  modelStrategy: 'adaptive' | 'fixed'
  /** Bounded automatic fix attempts after failed local checks or merge conflicts. */
  maxFixAttempts: number
  /** Agent-written notes unused for this many days are archived (founder notes never are). */
  memoryRetentionDays: number
  /** Tool output in activity logs older than this is dropped; summaries are kept. */
  eventRetentionDays: number
  /** The director resumes interrupted work and retries missing-dependency failures once on its own. */
  autoResolve: boolean
  /**
   * Auto mode: approves plans, resumes interrupted work and retries a stuck task once, without asking.
   * Permissions, questions for you, unverified work, usage limits and your own changes still come to you.
   */
  autoApprove: boolean
  /** Native notifications while Autopia is in the background: what needs you, everything, or none. Always silent. */
  desktopNotifications: 'important' | 'all' | 'off'
  /** Quiet mode: no desktop notifications at all; everything still collects in the notification center. */
  quietMode: boolean
}

export interface EmployeeMetrics {
  employeeId: string
  busyMs: number
  sessions: number
  costUsd: number
  utilization: number
}

export interface TimelineBar {
  runId: string
  employeeId: string
  taskId: string | null
  purpose: RunPurpose
  status: RunStatus
  start: number
  end: number | null
}

/** Efficiency metrics computed only from recorded runs and checks. */
export interface ProjectMetrics {
  wallMs: number
  activeMs: number
  agentMs: number
  waitingMs: number
  /** agentMs / activeMs: average number of sessions executing at once. */
  parallelism: number
  planningMs: number
  workMs: number
  fixMs: number
  validationMs: number
  sessions: number
  retries: number
  failures: number
  conflicts: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  /** Runs whose usage the CLI reported; token totals cover only these. */
  meteredRuns: number
  employees: EmployeeMetrics[]
  timeline: TimelineBar[]
}

export interface ProjectSnapshot {
  project: Project
  tasks: Task[]
  runs: Run[]
  approvals: Approval[]
}

export interface FsEntry {
  name: string
  relPath: string
  isDir: boolean
  size: number
}

export interface FileContent {
  relPath: string
  content: string
  truncated: boolean
  binary: boolean
  size: number
}

export type OfficeLocation = 'desk' | 'meeting' | 'elsewhere'

export type NotificationKind = 'decision' | 'failure' | 'milestone' | 'delivered' | 'security' | 'manager'

/** What a notification is about: drives grouping, priority, indicators and whether it stays open. */
export type AttentionCategory = 'approval' | 'question' | 'blocked' | 'failure' | 'usage' | 'interrupted' | 'review' | 'outcome' | 'info'

export interface Notification {
  id: number
  projectId: string | null
  taskId: string | null
  kind: NotificationKind
  title: string
  body: string
  read: boolean
  createdAt: number
  category: AttentionCategory
  /** The condition behind it: repeats of the same key update this item instead of adding new ones. */
  key: string | null
  approvalId: string | null
  deliveryId: string | null
  employeeId: string | null
  priority: number
  /** How many times the same condition was reported. */
  count: number
  updatedAt: number
  /** Set when its cause is gone (decided, reviewed, fixed). Open items have none. */
  resolvedAt: number | null
}

/** The indicator above a teammate: the most pressing thing about their work that waits for you. */
export interface EmployeeAttention {
  employeeId: string
  kind: AttentionCategory
  projectId: string
  taskId: string | null
  approvalId: string | null
  deliveryId: string | null
  label: string
}

/** A deterministic action taken by the project-management layer (no AI involved). */
export interface ManagerAction {
  id: number
  projectId: string
  taskId: string | null
  kind: 'reassign' | 'stall' | 'recover' | 'consult' | 'priority' | 'replan' | 'route' | 'director'
  message: string
  createdAt: number
}

export interface AssignmentRecord {
  taskId: string
  projectId: string
  projectName: string
  key: string
  title: string
  status: TaskStatus
  finishedAt: number | null
  costUsd: number
  checksPassed: number
  checksTotal: number
}

export interface EmployeeProfile {
  employee: Employee
  history: AssignmentRecord[]
  stats: { shipped: number; sessions: number; costUsd: number; avgTaskMs: number; checkPassRate: number | null }
}

export interface PortfolioItem {
  project: Project
  done: number
  total: number
  running: number
  blocked: number
  pendingDecisions: number
  costUsd: number
  activeEmployees: string[]
  summary: string
  /** What the product is, in a sentence. */
  purpose: string
  /** Last time anything was recorded for it. */
  lastActivity: number
  latest: { number: number; status: DeliveryStatus; at: number } | null
}

// ── quality (Phase 8) ─────────────────────────────────────────

export type QualityDimension = 'requirements' | 'runtime' | 'tests' | 'static' | 'build' | 'security' | 'accessibility' | 'visual' | 'interaction' | 'design' | 'performance' | 'review'

/** What the evidence says. Never inferred from an agent's claim alone. */
export type EvidenceStatus = 'verified' | 'failed' | 'not_checked' | 'blocked' | 'na'

export interface QualityPlanItem {
  dimension: QualityDimension
  applies: boolean
  /** How it will be checked (commands, audits) or why not. */
  how: string
  reason: string
}

export interface QualityPlan {
  scope: 'focused' | 'broad'
  risk: 'low' | 'normal' | 'high'
  items: QualityPlanItem[]
  /** Acceptance criteria the agent must report on (broad scope only). */
  criteria: string[]
}

export interface CriterionReport {
  criterion: string
  met: boolean
  evidence: string
}

/** verified = measured on the real page or certain; suspected = a pattern match or unconfirmed; advice = a recommendation, not a defect. */
export type FindingCertainty = 'verified' | 'suspected' | 'advice'

export interface QualityFinding {
  dimension: QualityDimension
  severity: 'high' | 'medium' | 'low' | 'info'
  rule: string
  message: string
  file: string | null
  line: number | null
  /** Viewport width for visual findings. */
  width: number | null
  count: number
  /** Older reports have none; see classifyFindings. */
  certainty?: FindingCertainty
  /** What was observed, beyond the message (e.g. the elements causing an overflow). */
  evidence?: string | null
  /** Suggested corrective action. */
  fix?: string | null
  /** Inside what this result changed: true = introduced or touched here, false = existed before, null = unknown. */
  inScope?: boolean | null
  /** Higher first: user impact (severity) × certainty × scope. */
  priority?: number
}

export interface QualityReport {
  id: string
  projectId: string
  deliveryId: string | null
  kind: 'audit' | 'visual'
  status: 'running' | 'done' | 'skipped' | 'error'
  findings: QualityFinding[]
  /** Real measurements only (e.g. load time in ms, DOM nodes, bytes transferred), keyed by name. */
  metrics: Record<string, number>
  shots: { width: number; path: string }[]
  /** What was examined (files, URL) or why it was skipped. */
  note: string | null
  error: string | null
  startedAt: number
  endedAt: number | null
}

export interface QualityException {
  id: string
  deliveryId: string
  dimension: QualityDimension
  note: string
  createdAt: number
}

export interface RepairRecord {
  taskKey: string
  taskTitle: string
  attempts: number
  tokens: number
  ms: number
  costUsd: number
  outcome: 'repaired' | 'failed' | 'in progress'
  stopReason: string | null
}

export interface Readiness {
  deliveryId: string
  /** ready = every applicable dimension verified; with_exceptions = the rest were accepted by you with a note. */
  verdict: 'ready' | 'ready_with_exceptions' | 'not_ready' | 'unverified'
  dimensions: { dimension: QualityDimension; label: string; status: EvidenceStatus; applies: boolean; evidence: string[]; exception: string | null }[]
  criteria: (CriterionReport & { taskKey: string })[]
  blockers: string[]
  repairs: RepairRecord[]
  findings: QualityFinding[]
  completion: CompletionReport
}

/** The one autonomous correction review QA may make per result, and what it achieved (finding keys). */
export interface QualityCorrection {
  taskKey: string
  targeted: string[]
  /** Every finding key before the correction (to tell new problems from old ones). */
  before: string[]
  outcome: { fixed: string[]; remaining: string[]; introduced: string[] } | null
  at: number
}

/** What a result really is, for the completion report. */
export type CompletionStatus = 'verified' | 'limited' | 'partial' | 'blocked' | 'failed'

export interface CompletionReport {
  status: CompletionStatus
  headline: string
  /** What was actually run, with its outcome. */
  tested: string[]
  failed: string[]
  unverified: string[]
  limitations: string[]
  /** Verified issues outside this result's scope and advice: never fixed automatically. */
  recommendations: QualityFinding[]
  correction: QualityCorrection | null
}

export interface QualityOverview {
  readiness: Readiness | null
  reports: QualityReport[]
  /** Per finished delivery, oldest first: real outcomes only. */
  trend: { number: number; verdict: Readiness['verdict']; checksPassed: number; checksTotal: number; repairs: number; at: number }[]
}

// ── product mode (Phase 9) ────────────────────────────────────

export interface ProductFeature {
  id: string
  name: string
  description: string
  scope: 'mvp' | 'later'
  /** confirmed = stated by the founder; assumption = a default Autopia chose (visible, changeable). */
  basis: 'confirmed' | 'assumption'
  milestone: number | null
}

export interface ProductQuestion {
  id: string
  question: string
  /** Why the answer materially changes the result. */
  why: string
  options: string[]
  /** What Autopia will do if you don't answer. */
  defaultAnswer: string
  answer: string | null
}

export interface ProductMilestone {
  n: number
  title: string
  /** The working vertical slice this milestone delivers. */
  goal: string
  acceptance: string[]
  status: 'pending' | 'active' | 'verifying' | 'done' | 'failed'
  /** Real gate evidence once verified (checks, audits, visual QA). */
  gate: { verdict: 'passed' | 'failed' | 'unverified'; evidence: string[]; at: number; repairTaskKey: string | null } | null
}

export interface ProductSpec {
  projectId: string
  vision: string
  users: string[]
  journeys: { name: string; steps: string[] }[]
  features: ProductFeature[]
  assumptions: string[]
  constraints: string[]
  architecture: { stack: string; rationale: string; data: string; api: string }
  /** The quality bar for this product. Absent on older projects. */
  direction?: { audience: string; personality: string; concept: string; explored?: string[]; standards: string[]; avoid: string[]; assets: string[] }
  /** What makes this product feel finished. Absent on older projects. */
  completeness?: { essentials: string[]; content: string; notBuilding: string[] }
  /** The first step, what each folder owns and the contracts tasks share. Absent on older projects. */
  foundation?: { taskKey: string; structure: { path: string; owns: string }[]; contracts: { name: string; file: string; shape: string }[] }
  design: { direction: string; typography: string; colors: { name: string; value: string }[]; layout: string; components: string; accessibility: string }
  milestones: ProductMilestone[]
  risks: string[]
  questions: ProductQuestion[]
  /** Founder feedback applied over time (what was asked, when). */
  changes: { at: number; request: string }[]
  createdAt: number
  updatedAt: number
}

/** Deterministic hand-over facts derived from the repository and real results. */
export interface ProductDeliverable {
  run: { label: string; command: string }[]
  env: string[]
  checks: { command: string; status: CheckStatus; at: number }[]
  limitations: string[]
  decisions: { title: string; text: string }[]
  commits: number
  files: number
  previewable: boolean
  tokens: number
  costUsd: number
  /** Wall-clock time from the first planning run to the last finished run. */
  elapsedMs: number
}

// ── company director (Phase 10) ───────────────────────────────

export type BlockerKind =
  | 'interrupted'
  | 'usage_limit'
  | 'stalled'
  | 'repeated_failure'
  | 'missing_dependency'
  | 'test_failure'
  | 'build_failure'
  | 'merge_conflict'
  | 'user_changes'
  | 'policy'
  | 'budget'
  | 'requirements'
  | 'unverified'
  | 'cli_unavailable'
  | 'unknown'

export interface BlockerDiagnosis {
  kind: BlockerKind
  /** One line, from the real error. */
  summary: string
  /** What the director does automatically (bounded, once per distinct blocker), or null when the CEO decides. */
  autoAction: 'resume' | 'install_and_retry' | 'retry' | null
  /** Why it needs the CEO, or what the automatic action is. */
  reason: string
  /** Recommended CEO action when escalated. */
  recommendation: string | null
}

export interface CompanyStatus {
  capacity: { running: number; limit: number }
  projects: {
    id: string
    name: string
    phase: ProjectPhase
    priority: number
    paused: boolean
    budgetUsd: number | null
    spentUsd: number
    running: { taskKey: string; title: string; employeeId: string }[]
    next: { taskKey: string; title: string; employeeId: string; why: string }[]
    blocked: { taskKey: string | null; diagnosis: BlockerDiagnosis; approvalId: string | null }[]
    milestone: { n: number; of: number; title: string } | null
    /** Why the director is or is not starting work here right now. */
    note: string
  }[]
  decisions: number
}

/** One result's real execution profile, derived from its recorded sessions. */
export interface ResultTelemetry {
  deliveryId: string
  strategy: Delivery['strategy']
  /** Distinct teammates who ran sessions for it. */
  agents: number
  /** Claude Code sessions (each one model conversation), split by purpose. */
  sessions: { planning: number; work: number; repair: number; total: number }
  turns: number
  costUsd: number
  /** Part of costUsd spent in planning sessions. */
  planningCostUsd: number
  /** Fresh (non-cached) input + output tokens, and cache reads, as Claude Code reported them. */
  tokens: { fresh: number; cached: number }
  /** Planning session time, implementation session time, repair session time (agent time, not wall). */
  ms: { planning: number; work: number; repair: number }
  /** First session start to last session end. */
  wallMs: number
  /** Repair sessions (fixes, retries, conflict resolution). */
  retries: number
}

export interface StrategyStats {
  strategy: string
  results: number
  medianCostUsd: number | null
  medianWallMinutes: number | null
  medianSessions: number | null
  /** Share of all cost spent on planning sessions. */
  planningShare: number | null
  /** Share of results that needed no repair session. */
  firstPassRate: number | null
}

export interface EngineMetrics {
  tasks: { done: number; failedOrSkipped: number; firstPassRate: number | null; reworkRuns: number; workRuns: number }
  deliveries: { finished: number; medianMinutes: number | null; cleanRate: number | null }
  /** Summed agent time divided by wall-clock time per delivery (1 = sequential). */
  parallelism: number | null
  byTeamSize: { size: string; deliveries: number; medianCostUsd: number | null; firstPassRate: number | null }[]
  /** Per execution strategy, from finished results that recorded one (measured, not estimated). */
  byStrategy: StrategyStats[]
  context: { medianMemoryChars: number | null; medianDiscoveryCalls: number | null; medianFirstInputTokens: number | null }
  byEffort: { effort: string; runs: number; medianTokens: number | null; successRate: number | null }[]
  bySize: { size: string; tasks: number; medianTokens: number | null; medianMinutes: number | null }[]
  failures: { kind: string; count: number }[]
  skills: { offered: number; loaded: number; invoked: number; reviewerOffered: number; reviewerUsed: number }
  totals: { runs: number; tokens: number; costUsd: number; agentMinutes: number }
}

// ── conversation (Phase 12B) ──────────────────────────────────

/** What a message asks Autopia to do. Chosen locally before sending and shown to the user. */
export type MessageIntent = 'build' | 'plan' | 'change' | 'note' | 'ask' | 'reply'

/**
 * Only what existing records don't already hold: the literal text you sent, its attachments and
 * target, and answers to questions. Plans, progress, decisions and results come from their own records.
 */
export interface Message {
  id: string
  projectId: string
  role: 'user' | 'autopia'
  intent: MessageIntent
  text: string
  attachments: string[]
  employeeId: string | null
  taskId: string | null
  deliveryId: string | null
  runId: string | null
  /**
   * sent → (queued: waiting for a teammate → delivered: it reached their session → applied: they finished with it)
   * clarify: Autopia can't tell what you mean and asked. working → answered, or failed (with the reason).
   * Every message ends in a visible outcome.
   */
  status: 'sent' | 'queued' | 'delivered' | 'applied' | 'clarify' | 'working' | 'answered' | 'failed'
  /** Who an instruction sent during the work went to, and how far it got with each of them. */
  routing: { targets: { taskId: string; key: string; name: string; state: 'queued' | 'delivered' | 'applied' | 'released' }[] } | null
  error: string | null
  createdAt: number
}

export interface SendMessageInput {
  /** null = create a new project from this message. */
  projectId: string | null
  intent: MessageIntent
  text: string
  attachments: string[]
  employeeId: string | null
  taskId: string | null
  deliveryId: string | null
  /** Said about one task on purpose: an instruction, never read as a question to answer. */
  instruction?: boolean
}
