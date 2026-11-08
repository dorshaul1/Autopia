import type { VerifyOutcome } from '../quality/engine'
import { enqueue, take, type SteerItem, type SteerQueue } from './steer'
import { describesAProduct, isCasual, parseTalk, pickResponder, understand, voicePrompt, type TalkOutput } from '@shared/conversation'
import { parseCommand, plainWords, planRouting, routingStatus, wouldCycle, type SteerCommand } from '@shared/steering'
import { execFileSync } from 'node:child_process'
import { autoDecision, blockerKey, diagnose } from '../director/blockers'
import { COMPLETENESS_ON, currentMilestone, isProductIdea, PRODUCT_PLANNING_RULES, productContext, sourceFileCount, specFromPlan } from '../product/product'
import { completenessRules, productKindOf } from '@shared/completeness'
import { isCapturePath } from '@shared/studio'
import { taskActions } from '@shared/mission'
import { permissionAsk, NATIVE_QUESTION, impactOf, rankBoard, parsePermission, type BoardItem } from '@shared/decisions'
import { barkReply, folkAddressed, folkById, frontDeskOf, type Folk } from '@shared/officeFolk'
import { WorkTracker } from '@shared/workActivity'
import { directCommand, NO_CAPABILITIES, questionBody, type ClaudeCapabilities, type NativeQuestion } from '@shared/claudeCode'
import { criteriaSignature, failureSignature, repairBudget, repairStopReason, teamUnmet } from '../quality/readiness'
import { firstName, humanizeKeys } from '@shared/naming'
import { ACTIONABLE, PRIORITY, categorize, dedupeKey, employeeAttention, isResolved } from '../attention'
import { noteReply, quickReply, statusReply } from './statusReply'
import { isSmallTalk, looksLikeQuestion } from '@shared/composer'
import { NEXT_LABEL, REASON_LABEL as REASON_TEXT, SHORT_REASON, continuationNote, interruptionFrom, recordFor, recoveryBody, refresh, type GitFacts } from './recovery'
import { EMPTY_USAGE, activeLimit, applyRateLimit, isUsageLimitError, resetFromError, type UsageState } from '../claude/usage'
import { planPrompt, qualityPlan } from '../quality/plan'
import { detectPreview, hasPage } from '../preview'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { environmentOf } from '../environment'
import { criticalRanks, waitingReason } from '@shared/graph'
import { REPEAT_NOTE, REPEAT_STOP, repeatedFailure, stallVerdict } from '../director/supervision'
import { classifyFailure, repairable, type BaselineCheck } from '../quality/regression'
import type { PushEvent } from '@shared/ipc'
import { appearanceFor, chooseAssignee, fitScore, HIRE_NAMES, HIRE_TEMPLATES, taskSkills } from '@shared/capabilities'
import type { QualityEngine } from '../quality/engine'
import { DESIGN_REVIEW_SCHEMA, designReviewPrompt, EXPERTISE_ON, type DesignGap } from '../skills/expertise'
import { describePick, feedbackKind, feedbackRequest, groupFeedback, type FeedbackItem } from '@shared/inspect'
import { CHECK_STATUS_LABEL, checkKey, checkMatch, evaluateChecks, isThrowawayCheck, shortCommand, refusedChecks, type BashEvidence, isLongRunning, normalizeClaims, withoutSettled } from '@shared/checks'
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DESK_IDS } from '@shared/roster'
import { triageBrief } from '@shared/triage'
import type {
  CompanyStatus,
  Message,
  SendMessageInput,
  ProductSpec,
  ChangeSet,
  Delivery,
  ValidationRun,
  ApprovalDecision,
  CheckResult,
  ClaudeInfo,
  ClaudeSession,
  KnowledgeKind,
  KnowledgeStatus,
  Employee,
  EmployeeActivity,
  EmployeeStatus,
  ExecutionStrategy,
  EmployeeAttention,
  Notification,
  NotificationKind,
  OfficeLocation,
  Project,
  ProjectPhase,
  Run,
  RunEventKind,
  RunPurpose,
  Settings,
  Task,
  BlockerDiagnosis,
  TaskRecovery,
  TaskStatus,
  QualityFinding
} from '@shared/types'
import { discoverCapabilities, latestClaudeVersion, startClaudeRun, updateClaudeCode, type PermissionDecision, type PermissionRequest, type RunHandle, type RunSpec } from '../claude/cli'
import { describeTool, FILE_WRITE_TOOLS, oneLine, rel, type ParsedEvent } from '../claude/streamParser'
import type { Repo } from '../db/repo'
import * as git from '../git/git'
import { changeSet, head as gitHead } from '../git/review'
import { excludeAutopiaDir } from '../preview'
import { deliverySummary, deliveryLimitations, settledByRun, projectChecks, revisionScope, undoBlocker } from './delivery'
import { Memory, countExploration, decisionIn, fileMatch, preferenceIn } from '../memory/memory'
import { SkillsEngine } from '../skills/engine'
import {
  CONSULT_SCHEMA,
  PLAN_SCHEMA,
  PRODUCT_PLAN_SCHEMA,
  QA_SCHEMA,
  WORK_SCHEMA,
  answerPrompt,
  checksPrompt,
  conflictPrompt,
  consultPrompt,
  consultSystemPrompt,
  criteriaPrompt,
  directTask,
  fixPrompt,
  flakyPrompt,
  planningPrompt,
  planningSystemPrompt,
  retryPrompt,
  foundationNote,
  selfChecksNote,
  steerNowPrompt,
  TALK_SCHEMA,
  talkSystemPrompt,
  steerPrompt,
  taskPrompt,
  workSystemPrompt,
  type ConsultOutput,
  type DecisionOutput,
  type PlanOutput,
  type QaOutput,
  type WorkOutput
} from './prompts'
import { clip, plural } from '@shared/friendlyError'
import { assertProjectTransition, assertTaskTransition, canContinueAround, canPlan, isReady, validateGraph, singleTaskPlanStartsNow, canRunBeside } from './stateMachine'


/**
 * Benchmark A/B only: AUTOPIA_ENGINE=legacy restores the Phase 13 engine (no light strategy, unmet
 * criteria not repaired, one failed task pauses the whole project, handoffs only by relevance, single-task
 * plans wait for approval, unplanned writers may run in parallel), so the same scenarios can be measured
 * against both. See benchmark/README.md.
 */
export const LEGACY_ENGINE = process.env.AUTOPIA_ENGINE === 'legacy'
/** A session with no stream events for this long is flagged; twice as long and it is restarted once. */
const MONITOR_INTERVAL_MS = 15_000

/** Notes you sent while this request was being built, for tasks that start after them. */
function notesFor(notes: { at: number; text: string }[], since: number): string {
  const own = notes.filter((n) => n.at >= since)
  return own.length ? ['Notes from the founder sent while this was being built (apply them):', ...own.map((n) => `- ${n.text}`)].join('\n') : ''
}

/**
 * Reasoning effort proportional to the work: trivial, low-risk changes don't pay for deep reasoning;
 * large or high-risk work and repairs get more. Total cost to a verified result is what matters.
 */
export function pickEffort(purpose: RunPurpose, _size: Task['size'], risk: 'low' | 'normal' | 'high'): 'low' | 'medium' | 'high' {
  if (purpose === 'resolve') return 'medium'
  // the strongest model throughout; extra effort is for what's truly delicate. In real runs high effort took
  // 25 minutes where medium took 8 on comparable steps, with no better result to show for it
  return risk === 'high' ? 'high' : 'medium'
}
const MAX_DETAIL = 4000
/** Concurrent Claude sessions are capped by the machine as well as by settings. */
/** Sessions mostly wait on the model; local cost is the checks they run. Half the cores, at least two. */
const CPU_BUDGET = Math.max(2, Math.floor(cpus().length / 2))

interface ActiveRun {
  run: Run
  handle: RunHandle | null
  cancelled: boolean
  lastEventAt: number
  warned: boolean
  stalled: boolean
  /** Permission prompts awaiting the founder; stall detection pauses while > 0. */
  waiting: number
  /** Tool calls started and not yet returned (a running tool is not silence). */
  inFlight: Map<string, { name: string; since: number }>
  /** The repeated-failure note was logged for this session. */
  repeatNoted: boolean
  /** Why the manager stopped this session for repeating the same failure (null otherwise). */
  looping: string | null
}

interface PermissionWaiter {
  runId: string
  /** Tool + exact subject, used for "allow for this task". */
  key: string
  resolve: (d: PermissionDecision) => void
}

interface ConsultNote {
  consultFor: string
  question: string
  area: 'design' | 'architecture'
}

interface Outcome {
  ok: boolean
  cancelled: boolean
  /** Cancelled by the manager because the session stalled (eligible for one automatic resume). */
  stalled: boolean
  /** Stopped by the manager for repeating the same failure (the reason; never retried automatically). */
  looping?: string | null
  structured: unknown
  /** The session's final text (used for answers to questions). */
  text: string | null
  error: string | null
  /** Every Bash call the agent made, with Claude Code's reported outcome. */
  bash: BashEvidence[]
  /** When the agent wrote or edited a file (tells a flaky check from one the agent changed). */
  edits?: number[]
}

/**
 * Owns all workflow state transitions. The renderer only *requests* actions; every state change
 * is decided here, persisted to SQLite, then pushed to the UI. Nothing here runs Claude for
 * cosmetic reasons: every session has a task (or a plan) behind it.
 */
export class Orchestrator {
  private active = new Map<string, ActiveRun>() // runId -> run
  private inFlight = new Set<string>() // taskIds with a runTask in progress (duplicate guard)
  private statuses = new Map<string, EmployeeStatus>()
  /** Set by the app: runs the quality engine's audits when a delivery reaches review. */
  onReview: ((project: Project, d: Delivery) => Promise<void>) | null = null
  /** Runs a finished result for real before anything is called done. */
  onVerify: ((project: Project, d: Delivery) => Promise<VerifyOutcome>) | null = null
  /** You answered the question of whether Autopia may run the verification commands. */
  onVerifyConsent: ((projectId: string, commands: string[], allowed: boolean) => void) | null = null
  private verifying = new Set<string>()
  private askedFirst = new Set<string>()
  private askedAfterWork = new Set<string>()
  /** A task's work was merged into the project folder. */
  onMerged: ((project: Project) => void) | null = null
  private presence = new Map<string, OfficeLocation>()
  private mergeLocks = new Map<string, Promise<unknown>>()
  private scheduling = false
  private employees: Employee[]
  private monitor: NodeJS.Timeout | null = null
  /** What Claude Code reported at the start of the most recent session (effective mode, auth, tools). */
  lastSession: ClaudeSession | null = null
  /** Claude Code's plan-usage signals as last reported (kept across restarts so the indicator isn't blank). */
  usage: UsageState = EMPTY_USAGE
  private resumeTimer: ReturnType<typeof setTimeout> | null = null
  readonly memory: Memory
  readonly skills: SkillsEngine
  /** Handoffs and decisions from a task's structured output, recorded once its work is merged. */
  private pendingNotes = new Map<string, { handoff?: string; decisions?: DecisionOutput[] }>()
  /** Check outcomes recorded in this project before now (validation history and finished tasks), as a baseline. */
  private checkBaseline(projectId: string, taskId: string): BaselineCheck[] {
    const fromValidations = this.repo.validations(projectId, 200).flatMap((v) => v.checks.map((c) => ({ command: c.command, status: c.status, output: c.output, at: c.at ?? v.startedAt, source: v.trigger !== 'task' ? 'a check you ran' : 'an earlier check run' })))
    const fromTasks = this.repo
      .tasks(projectId)
      .filter((t) => t.id !== taskId && t.status === 'done')
      .flatMap((t) => t.checks.map((c) => ({ command: c.command, status: c.status, output: c.output, at: c.at, source: t.key })))
    return [...fromValidations, ...fromTasks]
  }

  /** Overlapping edits already reported (task pair + file), so each is said once. */
  private overlapNoted = new Set<string>()
  /** The exact "waiting on a dependency" status the scheduler set per teammate (only those are replaced or cleared). */
  private depWaiting = new Map<string, string>()
  /** Projects whose current planning session Autopia started on its own judgement (see kickoff). */
  private autoPlans = new Set<string>()
  private permissionWaiters = new Map<string, PermissionWaiter>() // approvalId -> live CLI prompt
  private questionWaiters = new Map<string, { runId: string; resolve: (answer: string | null) => void }>() // approvalId -> Claude Code's own question
  private capabilityCache = new Map<string, { at: number; caps: ClaudeCapabilities }>()
  private stopping = new Set<string>() // running steps of a project you stopped: they keep their work
  private calledOff = new Set<string>() // tasks you cancelled while they ran: they end without a decision
  private taskAllows = new Map<string, Set<string>>() // taskId -> tool calls the founder allowed for that task

  constructor(
    private repo: Repo,
    private worktreeRoot: string,
    private getClaude: () => ClaudeInfo,
    private emit: (e: PushEvent) => void,
    /** A native notification for an item (the main process decides by focus and your preferences). */
    private alert: (n: Notification, repeat: boolean) => void = () => undefined
  ) {
    this.employees = repo.employees()
    this.memory = new Memory(repo)
    this.usage = { ...EMPTY_USAGE, ...(repo.meta<UsageState>('claude-usage') ?? {}) }
    this.skills = new SkillsEngine(repo, dirname(worktreeRoot))
    for (const e of this.employees) this.statuses.set(e.id, this.blankStatus(e.id))
    this.monitor = setInterval(() => this.superviseRuns(), MONITOR_INTERVAL_MS)
  }

  // ── team ─────────────────────────────────────────────────────

  // ── projects ─────────────────────────────────────────────────

  renameProject(id: string, name: string): Project {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean) throw new Error('A project needs a name')
    if (clean.length > 80) throw new Error('Keep the name under 80 characters')
    const updated = this.repo.updateProject(id, { name: clean })
    this.emit({ type: 'project', project: updated })
    return updated
  }

  /**
   * Removes a project from Autopia: its tasks, history, deliveries and memory. Files on disk are never
   * touched, and task branches stay in the repository so no unmerged work is lost.
   */
  /**
   * Stops all work on a project right now, not just new work: running sessions end, and what they'd done is kept so
   * Resume carries on from there. A step that's mid-merge is allowed to finish, since cutting that could corrupt it.
   */
  async stopProject(id: string): Promise<void> {
    const project = this.repo.project(id)
    this.setProjectControls(id, { paused: true })
    if (project.phase === 'planning') await this.cancelPlanning(id).catch(() => undefined)
    for (const t of this.repo.tasks(id).filter((x) => x.status === 'running')) {
      this.stopping.add(t.id)
      await this.cancelTask(t.id)
    }
    // questions and read-only replies stop too
    for (const a of this.active.values()) {
      if (a.run.projectId === id && !a.run.taskId) {
        a.cancelled = true
        a.handle?.cancel()
      }
    }
    this.logAction(id, null, 'director', `You stopped all work on ${project.name}. Unfinished work is kept; Resume continues it.`)
  }

  /** Stops one teammate's step for good: it won't start again, and what it hadn't finished is dropped. */
  async stopTask(taskId: string): Promise<void> {
    const task = this.repo.task(taskId)
    if (task.status === 'running') {
      this.calledOff.add(taskId)
      await this.cancelTask(taskId)
    } else if (['pending', 'interrupted', 'failed'].includes(task.status)) {
      const decision = this.repo.pendingApprovals(task.projectId).find((a) => a.taskId === taskId && a.kind === 'task_failed')
      if (decision) await this.resolveApproval(decision.id, { kind: 'task_failed', action: 'skip' })
      else this.transitionTask(task, 'cancelled', { lastError: 'Stopped by you', finishedAt: Date.now() })
      void this.schedule()
    } else throw new Error(`${task.key} is ${task.status}, so there is nothing to stop`)
    this.logAction(task.projectId, taskId, 'route', `You stopped ${task.key}.`)
  }

  async deleteProject(id: string): Promise<{ keptBranches: string[] }> {
    const project = this.repo.project(id)
    const busy = () => [...this.active.values()].some((a) => a.run.projectId === id) || this.verifying.has(id) || this.repo.project(id).phase === 'planning' || this.repo.tasks(id).some((t) => t.status === 'running' || t.status === 'merging')
    // deleting is the decision: anything still working stops first
    if (busy()) {
      await this.stopProject(id)
      const until = Date.now() + 20_000
      while (busy() && Date.now() < until) await new Promise((r) => setTimeout(r, 300))
      if ([...this.active.values()].some((a) => a.run.projectId === id) || this.verifying.has(id) || this.repo.tasks(id).some((t) => t.status === 'merging')) throw new Error('It’s finishing a merge or a check and couldn’t stop safely yet. Try again in a moment.')
    }
    const keptBranches: string[] = []
    if (project.gitEnabled) {
      for (const t of this.repo.tasks(id)) {
        if (t.status === 'done' || t.status === 'cancelled' || t.status === 'proposed' || t.status === 'pending') continue
        keptBranches.push(branchFor(t))
        await git.removeWorktreeKeepBranch(project.path, join(this.worktreeRoot, id, t.id))
      }
    }
    for (const e of this.employees) if (this.statuses.get(e.id)?.projectId === id) this.setStatus(e.id, this.blankStatus(e.id))
    this.repo.deleteProject(id)
    this.repo.setMeta(`code-graph:${id}`, null)
    this.emit({ type: 'projectDeleted', projectId: id })
    this.refreshTeams()
    return { keptBranches }
  }

  /** Hires a specialist from a template and seats them at the first free workstation. */
  hire(templateId: string, projectId: string | null = null): Employee {
    const template = HIRE_TEMPLATES.find((t) => t.id === templateId)
    if (!template) throw new Error('Unknown role template')
    const team = this.team(projectId)
    const taken = new Set(team.map((e) => e.deskId))
    const desk = DESK_IDS.find((d) => !taken.has(d))
    if (!desk) throw new Error('Every workstation is taken. The office has room for six people.')
    const usedNames = new Set(this.employees.map((e) => e.name))
    const name = HIRE_NAMES.find((n) => !usedNames.has(n)) ?? `Engineer ${team.length + 1}`
    const employee = this.repo.insertEmployee({
      id: `emp-${randomUUID().slice(0, 8)}`,
      role: template.role,
      name,
      title: template.title,
      bio: template.bio,
      deskId: desk,
      appearance: appearanceFor(name),
      specialization: template.specialization,
      capabilities: template.capabilities,
      kinds: template.kinds,
      hiredAt: Date.now(),
      projectId: team[0]?.projectId ?? null
    })
    this.employees = this.repo.employees()
    this.statuses.set(employee.id, this.blankStatus(employee.id))
    this.emit({ type: 'team', employees: this.employees })
    this.emit({ type: 'employee', status: this.statuses.get(employee.id)! })
    void this.schedule()
    return employee
  }

  /** Founder override of an assignment (pending, failed or interrupted tasks only). */
  reassign(taskId: string, employeeId: string): void {
    const task = this.repo.task(taskId)
    if (!['pending', 'failed', 'interrupted', 'proposed'].includes(task.status)) throw new Error(`${task.key} is ${task.status}; wait until it stops`)
    const e = this.employees.find((x) => x.id === employeeId)
    if (!e || !e.kinds.includes(task.kind)) throw new Error(`${e?.name ?? 'That employee'} cannot own ${task.kind} work`)
    const updated = this.repo.setAssignee(taskId, employeeId, `Assigned by you to ${e.name}.`)
    this.emit({ type: 'task', task: updated })
    this.logAction(task.projectId, taskId, 'reassign', `You reassigned ${task.key} to ${e.name}.`)
    void this.schedule()
  }

  setTaskPriority(taskId: string, priority: number): void {
    const p = Math.max(-1, Math.min(1, Math.round(priority)))
    // priority only decides what starts next: on anything already started or finished it would change nothing
    const before = this.repo.task(taskId)
    if (!taskActions(before).priority) throw new Error(`${before.key} is ${before.status}, so its priority can’t change anything`)
    const task = this.repo.updateTask(taskId, { priority: p })
    this.emit({ type: 'task', task })
    this.logAction(task.projectId, taskId, 'priority', `“${task.title}” set to ${p > 0 ? 'high' : p < 0 ? 'low' : 'normal'} priority.`)
    void this.schedule()
  }

  // ── notifications & manager log ──────────────────────────────

  /** Messages for people name the teammate and the task, never internal keys like T3 (see shared/naming). */
  private human(projectId: string | null, text: string): string
  private human(projectId: string | null, text: string | null): string | null
  private human(projectId: string | null, text: string | null): string | null {
    if (!text || !projectId || !/\bT\d/.test(text)) return text
    const nameOf = (id: string) => firstName(this.employees.find((e) => e.id === id)?.name)
    return humanizeKeys(text, this.repo.tasks(projectId), nameOf)
  }

  private createApproval(a: Parameters<Repo['createApproval']>[0]): ReturnType<Repo['createApproval']> {
    return this.repo.createApproval({ ...a, title: this.human(a.projectId, a.title), body: this.human(a.projectId, a.body) })
  }

  /**
   * Tell you about something, once per condition: linked to what caused it (an approval, a result, the
   * usage hold), repeats counted on one item, and resolved on its own once that cause is gone.
   */
  private notify(
    kind: NotificationKind,
    projectId: string | null,
    taskId: string | null,
    title: string,
    body: string,
    ctx: { approvalId?: string | null; deliveryId?: string | null; usage?: boolean; key?: string } = {}
  ): void {
    title = this.human(projectId, title)
    body = this.human(projectId, body)
    // the pending decision behind it (the newest one for this task, or the project's plan)
    let approval = ctx.approvalId ? this.repo.approval(ctx.approvalId) : null
    if (!approval && !ctx.deliveryId && !ctx.usage && projectId && kind !== 'manager' && kind !== 'milestone' && kind !== 'delivered') {
      approval = this.repo.pendingApprovals(projectId).filter((a) => a.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    }
    const category = categorize(kind, title, { approvalKind: approval?.kind ?? null, deliveryId: ctx.deliveryId, usage: ctx.usage })
    const task = taskId ? this.repo.tasks(projectId ?? '').find((t) => t.id === taskId) : null
    const employeeId = task?.assigneeId ?? (approval?.kind === 'plan' ? this.byRole('pm', projectId).id : null)
    const key = ctx.key ?? dedupeKey({ projectId, taskId, title, approvalId: approval?.id, deliveryId: ctx.deliveryId, category })
    const open = ACTIONABLE.has(category) ? this.repo.openNotification(key) : null
    const n = open
      ? this.repo.repeatNotification(open.id, { title, body })
      : this.repo.addNotification({ projectId, taskId, kind, title, body, category, key, approvalId: approval?.id ?? null, deliveryId: ctx.deliveryId ?? null, employeeId, priority: PRIORITY[category], resolved: !ACTIONABLE.has(category) })
    this.emit({ type: 'notification', notification: n })
    this.alert(n, !!open)
    this.queueAttention()
  }

  // ── attention: open items resolve themselves; one indicator per teammate ──

  private attentionTimer: ReturnType<typeof setTimeout> | null = null
  private lastAttention = ''

  /** Soon (batched): many state changes in a row cost one pass. */
  private queueAttention(): void {
    if (this.attentionTimer) return
    this.attentionTimer = setTimeout(() => {
      this.attentionTimer = null
      this.reconcileAttention()
    }, 250)
  }

  /** Close every open item whose cause is gone, and refresh the indicators above teammates. Deterministic. */
  reconcileAttention(): void {
    try {
      const projects = this.repo.projects()
      const approvals = projects.flatMap((p) => this.repo.pendingApprovals(p.id))
      const open = this.repo.openNotifications()
      const deliveries = new Map<string, Delivery>()
      const tasks = new Map<string, Task>()
      for (const p of projects) {
        for (const d of this.repo.deliveries(p.id)) deliveries.set(d.id, d)
        for (const t of this.repo.tasks(p.id)) tasks.set(t.id, t)
      }
      const facts = { pendingApprovals: new Set(approvals.map((a) => a.id)), deliveries, tasks, usageHeld: !!this.usage.hold }
      for (const n of open) if (isResolved(n, facts)) this.emit({ type: 'notification', notification: this.repo.resolveNotification(n.id) })
      const items = employeeAttention({ approvals, tasks: [...tasks.values()], deliveries: [...deliveries.values()], pmOf: (projectId) => this.team(projectId).find((e) => e.role === 'pm')?.id ?? null })
      const sig = JSON.stringify(items)
      if (sig !== this.lastAttention) {
        this.lastAttention = sig
        this.emit({ type: 'attention', items })
      }
    } catch (err) {
      console.error('[orchestrator] attention pass failed', err)
    }
  }

  attentionItems(): EmployeeAttention[] {
    return this.lastAttention ? (JSON.parse(this.lastAttention) as EmployeeAttention[]) : []
  }

  private logAction(projectId: string, taskId: string | null, kind: Parameters<Repo['addManagerAction']>[0]['kind'], message: string): void {
    this.emit({ type: 'managerAction', action: this.repo.addManagerAction({ projectId, taskId, kind, message: this.human(projectId, message) }) })
  }

  /**
   * Deterministic supervision (no AI): flags sessions that stop streaming, and restarts a stalled
   * session once by cancelling it; runTask then resumes the same Claude session.
   */
  /** Time asleep is not silence: after the machine wakes, every active session gets a fresh stall clock. */
  onSystemResume(): void {
    const now = Date.now()
    for (const a of this.active.values()) {
      a.lastEventAt = now
      a.warned = false
      this.logAction(a.run.projectId, a.run.taskId, 'director', 'The computer woke from sleep; the session keeps running (sleep is not counted as a stall).')
    }
  }

  private superviseRuns(): void {
    this.directorPass()
    this.reconcileAttention()
    const now = Date.now()
    for (const a of this.active.values()) {
      // waiting on the founder is not a stall, and neither is a tool that is still running (see stallVerdict)
      const v = stallVerdict({ now, lastEventAt: a.lastEventAt, waitingOnFounder: a.waiting, inFlight: [...a.inFlight.values()] })
      if (v.kind === 'ok') continue
      const task = a.run.taskId ? this.repo.task(a.run.taskId) : null
      const label = task ? task.key : 'Planning'
      if (v.kind === 'warn' && !a.warned) {
        a.warned = true
        this.logAction(a.run.projectId, a.run.taskId, 'stall', `${label}: ${v.reason}; watching it.`)
      }
      if (v.kind === 'restart' && !a.stalled && !a.cancelled) {
        a.stalled = true
        this.logAction(a.run.projectId, a.run.taskId, 'recover', `${label}: ${v.reason}; restarting the session once.`)
        this.notify('manager', a.run.projectId, a.run.taskId, `${label} stalled`, 'Autopia restarted the session automatically.')
        a.handle?.cancel()
      }
    }
  }

  // ── lifecycle ────────────────────────────────────────────────

  /** Reconcile anything left mid-flight by a previous app session, including orphaned CLI processes. */
  recoverFromRestart(): void {
    // a reply that was being written when Autopia closed has no session left to finish it: say so, and offer a retry
    for (const m of this.repo.messagesWithStatus('working')) {
      const asked = this.askedBefore(m)
      this.repo.updateMessage(m.id, { status: 'failed', error: 'Autopia closed before this finished. Try again.' })
      if (asked) this.repo.updateMessage(asked.id, { status: 'failed', error: 'Autopia closed before this finished. Try again.' })
    }
    // local memory housekeeping (no AI): drop old raw tool output, compact agent notes
    const settings = this.repo.settings()
    this.repo.pruneEventDetails(Date.now() - settings.eventRetentionDays * 86_400_000)
    for (const p of this.repo.projects()) this.memory.cleanup(p.id, settings)
    for (const { pid } of this.repo.runningPids()) killIfClaude(pid)
    // A permission prompt belongs to a live CLI process; after a restart nobody is waiting on it.
    for (const a of this.repo.pendingApprovalsOfKind('permission')) this.emitApproval(this.repo.resolveApproval(a.id, 'expired'))
    // the same goes for a question Claude Code itself asked: the step's interruption says how to carry on, and it can ask again
    for (const a of this.repo.pendingApprovalsOfKind('question')) if (NATIVE_QUESTION.test(a.title)) this.emitApproval(this.repo.resolveApproval(a.id, 'expired'))
    for (const run of this.repo.runsWithStatus('running')) {
      this.repo.updateRun(run.id, { status: 'interrupted', endedAt: Date.now(), error: 'Autopia was closed while this run was active' })
    }
    const cutOff: Task[] = []
    for (const status of ['running', 'merging'] as TaskStatus[]) {
      for (const task of this.repo.tasksWithStatus(status)) {
        // recorded before anything else, so a crash during recovery itself loses nothing
        const recovery = recordFor(task, 'restart', status === 'merging' ? 'integrate' : 'work', null, null, Date.now())
        cutOff.push(this.repo.updateTask(task.id, { status: 'interrupted', lastError: 'Interrupted: Autopia was closed while this task was running', recovery }))
        const p = this.repo.project(task.projectId)
        if (p.phase === 'executing') this.repo.updateProject(p.id, { phase: 'blocked' })
      }
    }
    // reopened: each project's map checks what changed while Autopia was closed, one after another
    void (async () => {
      for (const p of this.repo.projects()) {
        await new Promise((r) => setTimeout(r, 2000))
        await this.memory.refresh(p).catch(() => undefined)
      }
    })()
    // every interrupted task (including ones paused in an earlier session) shows on its teammate
    for (const task of this.repo.tasksWithStatus('interrupted')) this.showInterrupted(task)
    void Promise.all(cutOff.map((t) => this.attachRecovery(this.repo.project(t.projectId), t, true))).then(() => this.schedule())
    for (const p of this.repo.projects()) {
      if (p.phase === 'planning') this.repo.updateProject(p.id, { phase: 'new', lastError: 'Planning was interrupted by a restart' })
    }
    // notifications whose cause went away while Autopia was closed (e.g. expired permission prompts) close now
    this.reconcileAttention()
    void this.schedule()
  }

  shutdown(): void {
    if (this.monitor) clearInterval(this.monitor)
    for (const a of this.active.values()) a.handle?.cancel()
  }

  employeeStatuses(): EmployeeStatus[] {
    return [...this.statuses.values()]
  }

  reportPresence(employeeId: string, location: OfficeLocation): void {
    this.presence.set(employeeId, location)
    if (location === 'desk') {
    }
  }

  // ── kickoff: choose the lightest strategy ────────────────────

  /**
   * Starts an iteration. `auto` uses the local triage (no tokens): simple briefs go straight to one
   * agent with no meeting or planning session; everything else gets a plan for founder approval.
   */
  /** `said`: your own words, when `goal` was written out from a conversation: its size is judged on what you asked. */
  async kickoff(projectId: string, choice: ExecutionStrategy | 'auto', said?: string): Promise<void> {
    const project = this.repo.project(projectId)
    if (!canPlan(project.phase)) throw new Error(`Cannot start while the project is ${project.phase}`)
    if (!project.goal.trim()) throw new Error('Give the project a brief first')
    this.requireClaude()
    const delivery = await this.ensureDelivery(project)
    const triage = triageBrief(said ?? project.goal)
    // a product idea needs scope, architecture and design decided first: always plan it
    const product = isProductIdea(project.goal, sourceFileCount(project.path), !!this.repo.productSpec(projectId))
    // what a new project is for, in your words: later requests replace the goal but not this
    if (product || !sourceFileCount(project.path)) await this.memory.rememberPurpose(project, said ?? project.goal).catch(() => undefined)
    const triaged = LEGACY_ENGINE && triage.strategy === 'light' ? 'plan' : triage.strategy
    const strategy = choice === 'auto' ? (product ? 'plan' : triaged) : choice
    this.repo.updateProject(projectId, { strategy, complexity: product && triage.complexity === 'simple' ? 'medium' : triage.complexity })
    this.emitDelivery(this.repo.updateDelivery(delivery.id, { strategy }))
    // a plan Autopia chose on its own (not one you asked for, not a product build) that turns out to be a
    // single task needs no approval wait: see completePlanning
    if (choice === 'auto' && strategy === 'plan' && !product && !LEGACY_ENGINE) this.autoPlans.add(projectId)
    else this.autoPlans.delete(projectId)
    if (strategy === 'plan') return this.startPlanning(projectId)

    // Direct or light execution: one task, owned end-to-end by the most suitable single agent (light: the
    // owner plans the steps in their own session and reports every requirement of the brief).
    for (const a of this.repo.pendingApprovals(projectId)) if (a.kind === 'plan') this.emitApproval(this.repo.resolveApproval(a.id, 'superseded'))
    const fresh = this.repo.project(projectId)
    const t = directTask(fresh, triage, strategy === 'light')
    const kind = triage.role === 'designer' ? 'design' : 'code'
    const skills = taskSkills({ kind, title: t.title, description: t.description, files: [] })
    const owner = chooseAssignee(this.team(projectId), kind, skills, (id) => (this.isBusy(id) ? 1 : 0))
    if (!owner) throw new Error('Nobody on the team can own this work')
    this.repo.replaceProposedTasks(projectId, [
      {
        ...t,
        rationale: `${t.rationale} ${owner.reason}.`,
        key: this.nextKey(projectId),
        kind,
        assigneeId: owner.employee.id,
        dependsOnKeys: [],
        size: strategy === 'light' ? 'm' : 's',
        files: [],
        validation: [],
        skills
      }
    ])
    this.repo.setProposedTasksStatus(projectId, 'pending')
    this.repo.tasks(projectId).forEach((x) => this.emit({ type: 'task', task: x }))
    this.setPhase(fresh, 'executing', { lastError: null, planSummary: null })
    void this.schedule()
  }

  private nextKey(projectId: string): string {
    const n = this.repo.tasks(projectId).filter((t) => t.status !== 'proposed').length
    return `T${n + 1}`
  }

  // ── planning ─────────────────────────────────────────────────

  async startPlanning(projectId: string, feedback: string | null = null): Promise<void> {
    const project = this.repo.project(projectId)
    if (!canPlan(project.phase) && project.phase !== 'awaiting_plan_approval') {
      throw new Error(`Cannot plan while project is ${project.phase}`)
    }
    if (!project.goal.trim()) throw new Error('Give the project a brief before planning')
    const claude = this.requireClaude()
    const pm = this.byRole('pm', projectId)
    if (this.isBusy(pm.id)) throw new Error(`${pm.name} is busy with another run`)

    for (const a of this.repo.pendingApprovals(projectId)) if (a.kind === 'plan') this.emitApproval(this.repo.resolveApproval(a.id, 'superseded'))

    const triage = triageBrief(project.goal)
    this.setPhase(project, 'planning', { lastError: null, strategy: 'plan', complexity: project.complexity ?? triage.complexity })
    const settings = this.repo.settings()
    const prevSession = feedback ? this.lastPlanningSession(projectId) : null
    const sessionId = prevSession ?? randomUUID()
    const model = this.pickModel(settings, 'plan', { complexity: triage.complexity })
    const run = this.repo.createRun({ projectId, taskId: null, employeeId: pm.id, kind: 'planning', cwd: project.path, model: model || null, purpose: 'plan' })
    this.repo.updateRun(run.id, { sessionId })
    this.emit({ type: 'run', run: this.repo.run(run.id) })

    // Only the PM attends: nobody else has work yet, so nobody else is activated.
    this.setStatus(pm.id, {
      activity: 'meeting',
      projectId,
      taskId: null,
      runId: run.id,
      detail: 'Planning',
      reason: `Planning a ${triage.complexity} request`
    })

    // memory the planner can trust instead of re-surveying the repository (not needed when resuming)
    const pack = prevSession ? { text: '', ids: [], chars: 0 } : await this.memory.retrieve(project, { purpose: 'plan', text: project.goal, files: [] })
    this.repo.updateRun(run.id, { contextIds: pack.ids, contextChars: pack.chars })
    const product = isProductIdea(project.goal, sourceFileCount(project.path), !!this.repo.productSpec(projectId))
    const spec: RunSpec = {
      cwd: project.path,
      prompt:
        planningPrompt(project, triage, prevSession ? feedback : null, pack.text, prevSession ? '' : [this.memory.planningHistory(projectId), this.memory.projectStatus(projectId)].filter(Boolean).join('\n\n')) +
        (feedback && !prevSession ? `\n\nFounder feedback on a previous plan:\n${feedback}` : ''),
      systemPrompt: planningSystemPrompt(pm, this.team(projectId), this.repo.project(projectId).officeType) + (product ? `\n\n${PRODUCT_PLANNING_RULES}${COMPLETENESS_ON ? `\n${completenessRules(productKindOf(project.goal, this.repo.project(projectId).officeType))}` : ''}` : ''),
      settingSources: this.skills.scope === 'routed' ? 'project,local' : undefined,
      effort: triage.complexity === 'complex' ? 'high' : 'medium',
      model,
      sessionId,
      resume: !!prevSession,
      mode: 'readonly',
      permissionProfile: settings.permissionProfile,
      jsonSchema: product ? PRODUCT_PLAN_SCHEMA : PLAN_SCHEMA
    }
    void this.execute(run, spec, claude.path!, pm.id)
      .then((outcome) => this.completePlanning(projectId, pm, outcome))
      .catch((err: Error) => {
        // never leave a project stuck in "planning" with nothing running
        this.setPhase(this.repo.project(projectId), 'new', { lastError: `Planning could not be completed: ${err.message}` })
        this.setStatus(pm.id, this.blankStatus(pm.id))
      })
  }

  private completePlanning(projectId: string, pm: Employee, outcome: Outcome): void {
    const current = this.repo.project(projectId)
    if (outcome.cancelled) this.setPhase(current, 'new', { lastError: 'Planning cancelled' })
    else if (!outcome.ok) this.setPhase(current, 'new', { lastError: outcome.error ?? 'Planning failed' })
    else {
      const plan = this.parsePlan(outcome.structured)
      if (!plan.ok) this.setPhase(current, 'new', { lastError: plan.error })
      else {
        const offset = this.repo.tasks(projectId).filter((t) => t.status !== 'proposed').length
        const rekey = new Map(plan.value.tasks.map((t, i) => [t.key, `T${offset + i + 1}`]))
        // Capability-based staffing, spreading independent work across equally qualified people.
        const load = new Map<string, number>()
        const staffed = plan.value.tasks.map((t) => {
          const skills = taskSkills({ ...t, skills: t.skills as Task['skills'] })
          const owner = chooseAssignee(this.team(projectId), t.kind, skills, (id) => load.get(id) ?? 0)
          if (!owner) throw new Error(`Nobody on the team can own ${t.key} (${t.kind})`)
          load.set(owner.employee.id, (load.get(owner.employee.id) ?? 0) + (t.dependsOn.length ? 0.5 : 1))
          return { t, skills, owner }
        })
        const tasks = this.repo.replaceProposedTasks(
          projectId,
          staffed.map(({ t, skills, owner }) => ({
            key: rekey.get(t.key)!,
            title: t.title,
            description: t.description,
            acceptance: t.acceptance,
            kind: t.kind,
            assigneeId: owner.employee.id,
            dependsOnKeys: t.dependsOn.map((d) => rekey.get(d)!).filter(Boolean),
            rationale: `${t.rationale} ${owner.reason}.`,
            size: t.size,
            files: t.files,
            validation: t.validation.map((c) => c.trim()).filter((c) => c && !isLongRunning(c) && !isThrowawayCheck(c)),
            skills,
            milestone: plan.value.product ? Math.max(1, Math.min(t.milestone ?? 1, plan.value.product.milestones.length)) : null
          }))
        )
        tasks.forEach((t) => this.emit({ type: 'task', task: t }))
        if (plan.value.product) {
          const spec = this.repo.saveProductSpec(specFromPlan(projectId, plan.value.product, this.repo.productSpec(projectId)))
          this.emit({ type: 'product', spec })
        }
        this.setPhase(current, 'awaiting_plan_approval', {
          planSummary: plan.value.summary,
          complexity: plan.value.complexity,
          contextSummary: plan.value.repoSummary
        })
        const foundationKey = plan.value.product?.foundation?.taskKey
        if (foundationKey && rekey.has(foundationKey)) this.repo.setMeta(`foundation-task:${projectId}`, rekey.get(foundationKey))
        void this.recordPlanMemory(projectId, plan.value)
        const open = this.repo.openDelivery(projectId)
        if (open) this.repo.attachTasks(projectId, open.id)
        const approval = this.createApproval({ projectId, taskId: null, kind: 'plan', title: `Plan for ${current.name}`, body: plan.value.summary })
        this.emitApproval(approval)
        const proposed = tasks.filter((t) => t.status === 'proposed')
        if (singleTaskPlanStartsNow({ autoPlanned: this.autoPlans.has(projectId), product: !!plan.value.product, proposed: proposed.length, questions: plan.value.product?.questions?.length ?? 0 })) {
          // the request looked big enough to plan, but the plan is one task: start it the way a small
          // request starts, instead of waiting for an approval that decides nothing
          this.logAction(projectId, proposed[0].id, 'route', `${pm.name} planned it as one task (${proposed[0].key}), so it started right away like a small request. Ask for a plan in the Composer when you want to review one first.`)
          void this.resolveApproval(approval.id, { kind: 'plan', action: 'approve' }).catch((err: Error) => this.logAction(projectId, null, 'route', `Could not start ${proposed[0].key}: ${err.message}`))
        } else if (this.repo.settings().autoApprove) {
          this.autoApprovePlan(projectId, approval.id)
        } else {
          const team = new Set(proposed.map((t) => t.assigneeId)).size
          this.notify('decision', projectId, null, `Plan ready for ${current.name}`, `${proposed.length} tasks for a team of ${team}. Review and approve to start.`)
        }
      }
    }
    this.autoPlans.delete(projectId)
    if (this.repo.project(projectId).phase === 'awaiting_plan_approval') {
      this.setStatus(pm.id, { activity: 'waiting', projectId, taskId: null, runId: null, detail: 'Waiting for plan approval', reason: null })
    } else this.setStatus(pm.id, this.blankStatus(pm.id))
  }

  async cancelPlanning(projectId: string): Promise<void> {
    let running = false
    for (const a of this.active.values()) {
      if (a.run.projectId === projectId && a.run.kind === 'planning') {
        running = true
        a.cancelled = true
        a.handle?.cancel()
      }
    }
    // Nothing running but still marked as planning (e.g. completion failed): release it now.
    const project = this.repo.project(projectId)
    if (!running && project.phase === 'planning') {
      this.setPhase(project, 'new', { lastError: 'Planning cancelled' })
      const pm = this.byRole('pm', projectId)
      if (this.statuses.get(pm.id)?.projectId === projectId) this.setStatus(pm.id, this.blankStatus(pm.id))
    }
  }

  private parsePlan(structured: unknown): { ok: true; value: PlanOutput } | { ok: false; error: string } {
    const p = structured as PlanOutput | null
    if (!p || !Array.isArray(p.tasks) || !p.tasks.length) return { ok: false, error: 'Planning finished without a valid plan' }
    for (const t of p.tasks) {
      if (!['code', 'design', 'qa'].includes(t.kind)) return { ok: false, error: `Task ${t.key} has invalid kind ${t.kind}` }
      t.dependsOn = Array.isArray(t.dependsOn) ? t.dependsOn : []
      t.files = Array.isArray(t.files) ? t.files : []
      t.validation = Array.isArray(t.validation) ? t.validation : []
      if (!['s', 'm', 'l'].includes(t.size)) t.size = 'm'
    }
    const graphError = validateGraph(p.tasks)
    return graphError ? { ok: false, error: graphError } : { ok: true, value: p }
  }

  private lastPlanningSession(projectId: string): string | null {
    const run = this.repo.runs(projectId).find((r) => r.kind === 'planning' && r.sessionId && r.status === 'succeeded')
    return run?.sessionId ?? null
  }

  // ── approvals ────────────────────────────────────────────────

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const approval = this.repo.approval(id)
    if (approval.status !== 'pending') throw new Error('This decision was already made')
    if (approval.kind !== decision.kind) throw new Error('Decision does not match approval kind')
    const project = this.repo.project(approval.projectId)

    if (decision.kind === 'plan') {
      if (decision.action === 'approve') {
        const spec = this.repo.productSpec(project.id)
        if (spec && decision.answers) {
          const answered = spec.questions.map((q) => ({ ...q, answer: typeof decision.answers![q.id] === 'string' && decision.answers![q.id].trim() ? decision.answers![q.id].trim().slice(0, 500) : q.answer }))
          this.emit({ type: 'product', spec: this.repo.saveProductSpec({ ...spec, questions: answered }) })
        }
        // what you answered settles it for the whole team; what you left, or auto mode went ahead on, stays an assumption
        const asked = this.repo.productSpec(project.id)?.questions ?? []
        for (const q of asked) {
          if (q.answer && !this.autoDecided.has(id)) await this.memory.rememberAnswer(project, q.question, q.answer, 'Your answer on the plan').catch(() => undefined)
          else await this.memory.rememberAssumption(project, q.question, q.defaultAnswer, 'The plan, without your answer').catch(() => undefined)
        }
        this.emitApproval(this.repo.resolveApproval(id, 'approved'))
        this.repo.setProposedTasksStatus(project.id, 'pending')
        this.repo.tasks(project.id).forEach((t) => this.emit({ type: 'task', task: t }))
        this.setPhase(project, 'executing')
        const pm = this.byRole('pm', project.id)
        if (this.statuses.get(pm.id)?.activity === 'waiting') this.setStatus(pm.id, this.blankStatus(pm.id))
        void this.schedule()
      } else {
        this.autoPlans.delete(project.id) // you engaged with the plan: the revised one waits for your OK
        this.emitApproval(this.repo.resolveApproval(id, `revise: ${decision.feedback}`))
        this.logAction(project.id, null, 'replan', 'You asked for plan changes; Maya is revising the plan in the same session.')
        await this.startPlanning(project.id, decision.feedback)
      }
      return
    }

    const asked = decision.kind === 'question' ? this.questionWaiters.get(id) : null
    if (asked && decision.kind === 'question') {
      const answer = decision.answer.trim()
      if (!answer) throw new Error('Write an answer first')
      this.questionWaiters.delete(id)
      this.emitApproval(this.repo.resolveApproval(id, `answered: ${answer}`))
      asked.resolve(answer)
      return
    }

    if (decision.kind === 'permission') {
      const waiter = this.permissionWaiters.get(id)
      if (!waiter) {
        this.emitApproval(this.repo.resolveApproval(id, 'expired'))
        throw new Error('This request expired: the Claude Code session already ended')
      }
      this.permissionWaiters.delete(id)
      if (decision.action === 'allow_task' && approval.taskId) {
        this.taskAllows.set(approval.taskId, new Set([...(this.taskAllows.get(approval.taskId) ?? []), waiter.key]))
      }
      this.emitApproval(this.repo.resolveApproval(id, decision.action))
      waiter.resolve(
        decision.action === 'deny'
          ? { behavior: 'deny', message: 'The user declined this in Autopia. Do not retry it or work around it with other commands or tools; continue without it and state in your summary what could not be done or verified.' }
          : { behavior: 'allow' }
      )
      return
    }

    if (decision.kind === 'budget') {
      // Budgets no longer exist (Claude Code's own plan limits apply); an old budget decision just closes.
      this.emitApproval(this.repo.resolveApproval(id, 'superseded: Autopia no longer uses budgets'))
      void this.schedule()
      return
    }
    if (decision.kind === 'verify') {
      this.onVerifyConsent?.(project.id, this.repo.meta<string[]>(`verify-asked:${project.id}`) ?? [], decision.action === 'allow')
      this.emitApproval(this.repo.resolveApproval(id, decision.action))
      // asked up front, while the team works: the result gets run once it's finished
      const unfinished = this.repo.tasks(project.id).some((t) => ['pending', 'running', 'merging'].includes(t.status))
      if (unfinished) void this.schedule()
      else void this.finalizeDelivery(project)
      return
    }
    if (decision.kind === 'question' && NATIVE_QUESTION.test(approval.title)) {
      this.emitApproval(this.repo.resolveApproval(id, 'expired'))
      throw new Error('This question expired: the Claude Code session that asked it has ended')
    }
    const task = approval.taskId ? this.repo.task(approval.taskId) : null
    if (!task) throw new Error('Approval has no task')
    if (decision.kind === 'unverified') {
      this.emitApproval(this.repo.resolveApproval(id, decision.action))
      if (decision.action === 'accept') {
        this.requireClaude()
        this.logAction(project.id, task.id, 'route', `You accepted ${task.key} without every check passing; integrating it.`)
        void this.runTask(task.id, true, true)
      } else if (decision.action === 'retry') {
        this.requireClaude()
        void this.runTask(task.id, true)
      } else {
        this.transitionTask(task, 'cancelled', { lastError: task.lastError ?? 'Skipped by you', finishedAt: Date.now() })
        await this.cleanupWorktree(project, task)
        this.setPhase(this.repo.project(project.id), 'executing')
        void this.schedule()
      }
      return
    }
    if (decision.kind === 'question') {
      const answer = decision.answer.trim()
      if (!answer) throw new Error('Write an answer first')
      this.emitApproval(this.repo.resolveApproval(id, `answered: ${answer}`))
      if (!this.autoDecided.has(id)) await this.memory.rememberAnswer(project, approval.body, answer, `Your answer to ${task.key}`).catch(() => undefined)
      this.emit({ type: 'task', task: this.repo.updateTask(task.id, { note: `The founder answered your question: ${answer}` }) })
      this.logAction(project.id, task.id, 'consult', `You answered ${task.key}'s question; it resumes.`)
      void this.schedule()
      return
    }
    if (decision.action === 'retry') this.requireClaude()
    // retrying work that paused at a usage limit is you choosing to continue: release the hold
    if (decision.action === 'retry' && this.usage.hold && /paused at your Claude usage limit/.test(this.repo.approval(id).title)) {
      this.usage = { ...this.usage, hold: null }
      this.saveUsage()
    }
    this.emitApproval(this.repo.resolveApproval(id, decision.action))
    if (decision.action === 'retry') {
      void this.runTask(task.id, true)
    } else if (decision.action === 'skip') {
      this.transitionTask(task, 'cancelled', { lastError: task.lastError ?? 'Skipped by you', finishedAt: Date.now() })
      await this.cleanupWorktree(project, task)
      this.setPhase(this.repo.project(project.id), 'executing')
      void this.schedule()
    } else {
      for (const t of this.repo.tasks(project.id)) {
        if (['pending', 'failed', 'interrupted'].includes(t.status)) this.transitionTask(t, 'cancelled')
      }
      this.setPhase(this.repo.project(project.id), 'failed', { lastError: 'Stopped by you' })
      const open = this.repo.openDelivery(project.id)
      if (open) this.emitDelivery(this.repo.updateDelivery(open.id, { status: 'rejected', decidedAt: Date.now(), decisionNote: 'Stopped by the founder before completion. Nothing was reverted.' }))
    }
  }

  // ── scheduling ───────────────────────────────────────────────

  async retryTask(taskId: string): Promise<void> {
    const task = this.repo.task(taskId)
    const pending = this.repo.pendingApprovals(task.projectId).find((a) => a.taskId === taskId && (a.kind === 'task_failed' || a.kind === 'unverified'))
    if (pending) return this.resolveApproval(pending.id, pending.kind === 'unverified' ? { kind: 'unverified', action: 'retry' } : { kind: 'task_failed', action: 'retry' })
    if (!['failed', 'interrupted'].includes(task.status)) throw new Error(`Task is ${task.status}`)
    this.requireClaude()
    void this.runTask(taskId, true)
  }

  async cancelTask(taskId: string): Promise<void> {
    for (const a of this.active.values()) {
      if (a.run.taskId === taskId) {
        a.cancelled = true
        a.handle?.cancel()
      }
    }
  }

  /**
   * Starts every ready task that can run safely, highest critical-path rank first, within the
   * concurrency budget. A ready task is held back only when its owner is busy or it would touch
   * the same files as running work.
   */
  async schedule(): Promise<void> {
    if (this.scheduling) return
    this.scheduling = true
    try {
      if (!this.getClaude().available) return
      // at a real usage limit nothing new starts until you continue (or the reset passes, if you chose that)
      if (this.usage.hold) return
      const settings = this.repo.settings()
      const globalLimit = Math.min(Math.max(1, settings.maxParallel), CPU_BUDGET)
      let globalSlots = globalLimit - [...this.active.values()].filter((a) => a.run.kind === 'task').length
      // fair across offices: higher priority first, then the project with the fewest sessions running,
      // so several offices make progress at once instead of one taking every slot
      const runningIn = (id: string) => [...this.active.values()].filter((a) => a.run.kind === 'task' && a.run.projectId === id).length
      const projects = this.repo.projects().sort((a, b) => b.priority - a.priority || runningIn(a.id) - runningIn(b.id) || a.createdAt - b.createdAt)
      // a folder that came back: its work continues where it stopped
      for (const p of projects) if (p.phase === 'blocked' && p.lastError?.startsWith('Project folder not found') && existsSync(p.path)) this.setPhase(p, 'executing', { lastError: null })
      for (const project of this.repo.projects().sort((a, b) => b.priority - a.priority || runningIn(a.id) - runningIn(b.id) || a.createdAt - b.createdAt)) {
        if (project.phase !== 'executing') continue
        // a project folder that was moved or deleted: nothing starts there (work resumes once it's back)
        if (!existsSync(project.path)) {
          if (!project.lastError?.startsWith('Project folder not found')) {
            this.setPhase(project, 'blocked', { lastError: `Project folder not found at ${project.path}. Move it back (or reopen it from its new place) to continue.` })
            this.notify('failure', project.id, null, `${project.name}: folder not found`, `Nothing runs until ${project.path} is back.`)
          }
          continue
        }
        const open = this.repo.openDelivery(project.id)
        if (open) this.repo.attachTasks(project.id, open.id)
        const tasks = this.repo.tasks(project.id)
        if (open?.status === 'implementing') {
          const mine = tasks.filter((t) => t.deliveryId === open.id)
          const built = mine.filter((t) => t.kind !== 'qa').every((t) => t.status === 'done' || t.status === 'cancelled')
          if (built && mine.some((t) => t.kind === 'qa' && t.status === 'running')) this.emitDelivery(this.repo.updateDelivery(open.id, { status: 'validating' }))
        }
        const byId = new Map(tasks.map((t) => [t.id, t]))
        const running = tasks.filter((t) => t.status === 'running' || t.status === 'merging')
        this.reflectDependencyWaits(project, tasks)

        // A stuck task blocks only the work that depends on it: independent workstreams keep going, and the
        // project shows as blocked once nothing else can run. Product milestones stay strictly sequential.
        if (tasks.some((t) => t.status === 'failed' || t.status === 'interrupted')) {
          // (product milestones still verify one at a time; within a milestone, unrelated work goes on)
          const independent = !LEGACY_ENGINE && !project.paused && canContinueAround(tasks, byId)
          if (!independent) {
            if (!running.length) this.setPhase(project, 'blocked')
            continue
          }
        }
        if (tasks.every((t) => t.status === 'done' || t.status === 'cancelled')) {
          // the team finishing isn't "done": the project completes when the result has passed for real
          if (this.verifying.has(project.id) || this.repo.pendingApprovals(project.id).some((a) => a.kind === 'verify')) continue
          this.checkMilestones(project.id)
          void this.finalizeDelivery(project)
          continue
        }
        // CEO controls: a paused project starts nothing new; finished work is still finalized above
        // and running work finishes. There is no spending cap: Claude Code's own plan limits apply.
        if (project.paused) continue
        // Without git there is no isolation, so writers must run one at a time.
        let slots = project.gitEnabled ? globalSlots : Math.min(globalSlots, 1 - running.length)
        const ranks = criticalRanks(tasks)
        const score = (t: Task) => ranks.get(t.id)! + t.priority * 100
        const asking = new Set(this.repo.pendingApprovals(project.id).filter((a) => a.kind === 'question').map((a) => a.taskId))
        // product mode: one verified milestone at a time (coherent vertical slices, not everything at once)
        const spec = this.repo.productSpec(project.id)
        const milestone = spec ? this.advanceMilestones(project, spec, tasks) : null
        const ready = tasks
          .filter((t) => isReady(t, byId) && !asking.has(t.id) && (milestone === null || t.milestone === null || t.milestone <= milestone))
          .sort((a, b) => score(b) - score(a) || a.sortOrder - b.sortOrder)
        const claimed = [...running]
        const starting = new Set<string>()
        // files that repeatedly caused merge conflicts are never edited by two tasks at once
        const hot = this.memory.hotFiles(project.id)
        const touchesHot = (t: Task) => hot.filter((h) => t.files.some((f) => fileMatch(f, h)))
        for (let task of ready) {
          if (slots <= 0) break
          if (this.inFlight.has(task.id)) continue
          if (!canRunBeside(task, claimed, LEGACY_ENGINE)) continue
          const mine = touchesHot(task)
          if (mine.length && claimed.some((r) => touchesHot(r).some((h) => mine.includes(h)))) continue
          if (this.isBusy(task.assigneeId) || starting.has(task.assigneeId)) {
            // The owner is busy: hand the task to an idle, capable colleague instead of waiting.
            const swapped = this.reassignToIdle(project, task, starting)
            if (!swapped) continue
            task = swapped
          }
          slots--
          globalSlots--
          claimed.push(task)
          starting.add(task.assigneeId)
          void this.runTask(task.id, false)
        }
      }
    } finally {
      this.scheduling = false
    }
  }

  /**
   * Early notice of a likely merge conflict: two tasks running at once in their own worktrees both
   * changed the same file (plans often miss files: 4 recorded tasks edited outside their plan). Nothing
   * is stopped; integration merges them one at a time and resolves conflicts as usual.
   */
  private noteOverlap(task: Task, path: string): void {
    const others = this.repo.tasks(task.projectId).filter((t) => t.id !== task.id && (t.status === 'running' || t.status === 'merging') && t.changedFiles.some((c) => c.replace(/^\S+\s+/, '') === path))
    for (const o of others) {
      const key = `${[task.id, o.id].sort().join('|')}|${path}`
      if (this.overlapNoted.has(key)) continue
      this.overlapNoted.add(key)
      this.logAction(task.projectId, task.id, 'director', `${task.key} and ${o.key} are both changing ${path}. They integrate one at a time; the second resolves any conflict with the first.`)
    }
  }

  /**
   * Office truth for queued work: a teammate whose next task waits on another task shows that wait
   * (real dependency state, no AI). Only states set here are cleared here; real activity always wins.
   */
  private reflectDependencyWaits(project: Project, tasks: Task[]): void {
    const keyOf = (id: string) => tasks.find((t) => t.id === id)?.key
    const firstName = (id: string) => this.employees.find((x) => x.id === id)?.name.split(' ')[0] ?? null
    for (const e of this.team(project.id)) {
      const st = this.statuses.get(e.id)
      // ours = still exactly the wait we set (any real activity since then replaced it and wins)
      const ours = !!st && st.activity === 'waiting' && st.detail === this.depWaiting.get(e.id)
      if (!ours) this.depWaiting.delete(e.id)
      if (!(ours || !st || st.activity === 'idle')) continue
      if (ours && st!.projectId !== project.id) continue // waiting in another project: that project updates it
      const next = tasks.find((t) => t.assigneeId === e.id && t.status === 'pending' && t.dependsOn.some((d) => !['done', 'cancelled'].includes(tasks.find((x) => x.id === d)?.status ?? 'done')))
      if (next) {
        const detail = waitingReason(next, tasks, () => null, firstName) ?? `Waiting on ${next.dependsOn.map(keyOf).join(', ')}`
        if (st?.detail !== detail) this.setStatus(e.id, { activity: 'waiting', projectId: project.id, taskId: next.id, runId: null, detail, reason: next.rationale })
        this.depWaiting.set(e.id, detail)
      } else if (ours) {
        this.depWaiting.delete(e.id)
        this.setStatus(e.id, this.blankStatus(e.id))
      }
    }
  }

  /** Deterministic reassignment: only to someone idle whose capabilities cover most of the task. */
  private reassignToIdle(project: Project, task: Task, starting: Set<string>): Task | null {
    const skills = taskSkills(task)
    const from = this.employees.find((e) => e.id === task.assigneeId)
    const candidates = this.team(project.id).filter((e) => e.role !== 'pm' && e.id !== task.assigneeId && e.kinds.includes(task.kind) && !this.isBusy(e.id) && !starting.has(e.id))
    // anyone who owns this kind of work beats waiting; only a large step is worth holding for its specialist
    const best = candidates
      .map((e) => ({ e, score: fitScore(e, task.kind, skills) }))
      .filter((x) => x.score >= 0.6 || task.size !== 'l')
      .sort((a, b) => b.score - a.score)[0]
    if (!best) return null
    const covered = skills.filter((s) => best.e.capabilities.includes(s))
    const why = `${from?.name.split(' ')[0] ?? 'The owner'} was busy; ${best.e.name.split(' ')[0]} was idle and covers ${covered.join(', ') || task.kind}.`
    // said before it changes hands, so the task is still named as the one it's moving from
    this.logAction(project.id, task.id, 'reassign', `Reassigned ${task.key} to ${best.e.name}. ${why}`)
    const updated = this.repo.setAssignee(task.id, best.e.id, `${task.rationale ?? ''} Reassigned: ${why}`.trim())
    this.emit({ type: 'task', task: updated })
    return updated
  }

  // ── task execution ───────────────────────────────────────────

  /** integrateOnly: the founder accepted the work as is; skip the agent and go straight to merging. */
  private async runTask(taskId: string, isRetry: boolean, integrateOnly = false): Promise<void> {
    if (this.inFlight.has(taskId)) return
    this.inFlight.add(taskId)
    try {
      await this.runTaskInner(taskId, isRetry, integrateOnly)
    } catch (err) {
      const task = this.repo.task(taskId)
      if (task.status === 'running' || task.status === 'merging') this.failTask(this.repo.project(task.projectId), task, (err as Error).message)
      else console.error('[orchestrator] task could not start', err)
    } finally {
      this.inFlight.delete(taskId)
      if (['done', 'cancelled'].includes(this.repo.task(taskId).status)) this.taskAllows.delete(taskId)
      void this.schedule()
    }
  }

  private async runTaskInner(taskId: string, isRetry: boolean, integrateOnly = false): Promise<void> {
    let task = this.repo.task(taskId)
    const consult = parseConsult(task.note)
    if (consult) return this.runConsult(task, consult)
    const project = this.repo.project(task.projectId)
    const employee = this.employees.find((e) => e.id === task.assigneeId)!
    const claude = this.requireClaude()
    const settings = this.repo.settings()
    const model = this.pickModel(settings, task.kind === 'qa' ? 'qa' : 'work', { size: task.size })

    if (isRetry && project.phase !== 'executing') this.setPhase(project, 'executing')
    task = this.transitionTask(task, 'running', {
      attempts: task.attempts + 1,
      lastError: isRetry ? task.lastError : null,
      startedAt: task.startedAt ?? Date.now(),
      model: model || null
    })
    const activity: EmployeeActivity = task.kind === 'qa' ? 'testing' : 'working'
    const status = (detail: string, runId: string | null = null, act: EmployeeActivity = activity) =>
      this.setStatus(employee.id, { activity: act, projectId: project.id, taskId: task.id, runId, detail, reason: task.rationale })
    status('Heading to desk')
    // Visual gate: the employee sits down first, bounded so navigation can never block real work.

    let cwd = project.path
    const branch = branchFor(task)
    const worktree = join(this.worktreeRoot, project.id, task.id)
    // Resume the same session after an interruption, or when a teammate/founder answered a question.
    const answer = task.note
    // Continuing after an interruption: check what is really on disk first, then take the one safe step.
    let rec = isRetry ? task.recovery : null
    const onDisk = isRetry ? await this.inspectGit(project, task).catch(() => null) : null
    if (rec) {
      rec = refresh(rec, task, onDisk, project.baseBranch)
      task = this.repo.updateTask(task.id, { recovery: rec })
      if (rec.next === 'finish') {
        // merged before the interruption; only the bookkeeping was missing. Nothing runs again.
        this.logAction(project.id, task.id, 'recover', `Already merged into ${project.baseBranch} before the interruption; recorded ${task.key} as done without running anything again.`)
        await git.removeWorktree(project.path, worktree, branch).catch(() => undefined)
        return this.finishTask(task, task.changedFiles)
      }
      if (rec.next === 'integrate' && !integrateOnly) {
        integrateOnly = true
        this.logAction(project.id, task.id, 'recover', `${task.key}: the work had already passed its checks; finishing the merge without a new Claude Code session.`)
      }
    }
    // never discard a kept branch or worktree with work on it
    const kept = !!onDisk && (onDisk.worktree || (onDisk.branch && onDisk.commits > 0))
    const canResume = (isRetry || !!answer) && !!task.sessionId && rec?.sessionResumable !== false && (!project.gitEnabled || existsSync(worktree) || kept)
    if (project.gitEnabled) {
      if (kept && !existsSync(worktree)) {
        await git.attachWorktree(project.path, worktree, branch)
        this.logAction(project.id, task.id, 'recover', `${task.key}: re-attached its kept branch (${onDisk!.commits} commit${onDisk!.commits === 1 ? '' : 's'}) as the worktree.`)
      } else if (!canResume && !kept) await git.createWorktree(project.path, worktree, branch, project.baseBranch!)
      cwd = worktree
    }
    // work is on disk but its session can't be resumed: a new session that starts from the verified state
    const continuing = !!rec && !canResume && (kept || !project.gitEnabled) && !integrateOnly
    let sessionId = canResume ? task.sessionId! : randomUUID()
    task = this.repo.updateTask(task.id, { sessionId })
    this.emit({ type: 'task', task })

    const deps = task.dependsOn.map((d) => this.repo.task(d)).filter((d) => d.status === 'done')
    const delivery = task.deliveryId ? this.repo.delivery(task.deliveryId) : null
    // files you attached in the Composer live in the main checkout's .autopia folder; give the agent a copy
    for (const dir of ['attachments', 'screenshots']) {
      const from = join(project.path, '.autopia', dir)
      if (cwd !== project.path && existsSync(from)) cpSync(from, join(cwd, '.autopia', dir), { recursive: true })
    }
    if (delivery?.screenshot && cwd !== project.path) {
      // the founder's screenshot lives in the main checkout's .autopia folder; give the agent a copy
      const target = join(cwd, delivery.screenshot)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(project.path, delivery.screenshot), target)
    }
    // the handoffs of the tasks this one builds on always reach it (by relevance alone they can be missed)
    const pinned = LEGACY_ENGINE ? [] : deps.map((d) => `handoff:${d.key}`)
    const pack = canResume ? { text: '', ids: [] as string[], chars: 0 } : await this.memory.retrieve(project, { purpose: 'task', text: `${task.title}\n${task.description}`, files: task.files, taskKind: task.kind, size: task.size, pinned })
    let contextPending = true
    const productSpec = this.repo.productSpec(project.id)
    // engineering methods and skills for this task, chosen deterministically (no AI)
    const facts = this.repo.knowledge(project.id)
    const stackText = facts.find((k) => k.topic === 'stack')?.text ?? ''
    const checksAvailable = projectChecks(project)
    const hasTests = checksAvailable.includes('npm test') || /pytest|node:test|jest|vitest/i.test(facts.find((k) => k.topic === 'conventions')?.text ?? '')
    const routed = this.skills.route({
      task,
      purpose: delivery?.kind === 'revision' ? 'revision' : isRetry ? 'retry' : 'work',
      complexity: project.complexity,
      hasTests,
      office: project.officeType,
      direction: this.repo.productSpec(project.id)?.direction ? `${this.repo.productSpec(project.id)!.direction!.personality} ${this.repo.productSpec(project.id)!.direction!.standards.join(' ')}` : undefined,
      imageTools: (this.lastSession?.tools ?? []).filter((t) => /image|imagen|dall-?e|stable.?diffusion|generate_?img/i.test(t)),
      reviewedLater: task.kind !== 'qa' && this.repo.tasks(project.id).some((t) => t.deliveryId === task.deliveryId && t.kind === 'qa' && t.status !== 'cancelled'),
      react: /\bReact\b|Next\.js/.test(stackText)
    })
    // how this task will be verified, decided once before work starts (deterministic)
    if (!task.qualityPlan) {
      const plan = qualityPlan({ task, risk: routed.record.risk, projectChecks: checksAvailable, hasTests, previewable: hasPage(detectPreview(project)), reviewerAvailable: routed.record.subagents.includes('reviewer') })
      task = this.repo.updateTask(task.id, { qualityPlan: plan })
      this.emit({ type: 'task', task })
    }
    const qualityText = planPrompt(task.qualityPlan!)
    const repairLimit = repairBudget(routed.record.risk, settings.maxFixAttempts)
    let lastSignature: string | null = null
    let repairedFrom: CheckResult | null = null
    // proportional quality gates: high-risk work must pass the project's own lint/typecheck/test
    const plannedChecks = task.qualityPlan!.items
      .filter((i) => i.applies && (i.dimension === 'static' || i.dimension === 'build' || (i.dimension === 'tests' && !task.validation.length)))
      .flatMap((i) => checksAvailable.filter((c) => i.how.includes(c)))
    const gateChecks = [
      ...new Set([
        ...(routed.record.risk === 'high'
          ? checksAvailable.filter((c) => /lint|typecheck|type-check|npm test|pytest/.test(c))
          : routed.record.risk === 'normal' && task.kind !== 'design' && !task.validation.length
            ? checksAvailable.filter((c) => c === 'npm test' || /pytest/.test(c))
            : []),
        ...plannedChecks
      ])
    ]
    const schema = task.kind === 'qa' ? QA_SCHEMA : WORK_SCHEMA
    const isFoundation = this.repo.meta<string>(`foundation-task:${project.id}`) === task.key
    const wantsBuild = isFoundation || [...task.validation, ...plannedChecks].some((c) => /\bbuild\b/.test(c))
    // the first time a product can run checks, your OK comes before anyone starts: nobody then stops to ask for each test run
    if (delivery && !this.askedFirst.has(project.id)) {
      this.askedFirst.add(project.id)
      await this.selfChecks?.askForFoundation(project, delivery, cwd).catch(() => undefined)
    }
    const selfRun = this.selfChecks?.selfChecks(project, cwd, wantsBuild) ?? []
    const agent = async (purpose: RunPurpose, prompt: string, resume: boolean, label?: string): Promise<Outcome> => {
      const run = this.repo.createRun({ projectId: project.id, taskId: task.id, employeeId: employee.id, kind: 'task', cwd, model: model || null, purpose })
      this.repo.updateRun(run.id, { sessionId, skills: routed.record, ...(contextPending ? { contextIds: pack.ids, contextChars: pack.chars } : {}) })
      contextPending = false
      status(label ?? (purpose === 'work' ? 'Starting Claude Code' : purpose === 'fix' ? 'Fixing failed check' : purpose === 'resolve' ? 'Resolving merge conflict' : 'Resuming'), run.id)
      return this.execute(
        this.repo.run(run.id),
        {
          cwd,
          prompt,
          systemPrompt: [workSystemPrompt(employee, task.kind, project.officeType, isFoundation || selfRun.length > 0), routed.prompt, qualityText, gateChecks.length ? `Required checks for this ${routed.record.risk}-risk task (run each with Bash before submitting): ${gateChecks.join(' · ')}` : ''].filter(Boolean).join('\n\n'),
          pluginDirs: routed.pluginDir ? [routed.pluginDir] : [],
          agents: routed.agents,
          settingSources: this.skills.scope === 'routed' ? 'project,local' : undefined,
          effort: pickEffort(purpose, task.size, routed.record.reasons.some((r) => /security/.test(r)) ? 'high' : 'normal'),
          model,
          sessionId,
          resume,
          mode: 'write',
          permissionProfile: settings.permissionProfile,
          jsonSchema: schema
        },
        claude.path!,
        employee.id
      )
    }

    if (!integrateOnly) {
      if (answer) task = this.repo.updateTask(task.id, { note: null })
      if (delivery) this.selfChecks?.askEarly(project, delivery)
      const freshPrompt = async (note: string, text: string) =>
        taskPrompt(project, { ...(answer ? { ...task, description: `${task.description}\n\n${answer}` } : task), validation: task.validation.filter((v) => !selfRun.some((c) => checkMatch(v, c))) }, deps, [isFoundation ? foundationNote(productSpec) : selfRun.length ? selfChecksNote(selfRun) : '', note, productSpec ? productContext(productSpec, task.milestone) : '', notesFor([...(this.repo.meta<{ at: number; text: string }[]>(`notes:${project.id}`) ?? []), ...(this.steerQueue()[task.id] ?? []).filter((m) => m.viaPrompt && !task.description.includes(m.text)).map((m) => ({ at: Date.now(), text: m.text }))].filter((n, i, all) => all.findIndex((x) => x.text === n.text) === i), delivery?.createdAt ?? 0), text].filter(Boolean).join('\n\n'), task.dependsOn.map((d) => this.repo.task(d)).filter((d) => d.status === 'cancelled'))
      const continueNote = async (r: TaskRecovery) =>
        continuationNote(r, { base: project.baseBranch, diffStat: project.gitEnabled ? await git.diffStat(cwd, project.baseBranch!) : '', uncommitted: r.git?.uncommitted ?? [], lastSummary: task.resultSummary, lastError: task.lastError })
      let outcome = await agent(
        canResume ? 'retry' : continuing ? 'retry' : 'work',
        canResume ? [this.memory.decidedSince(project.id, this.repo.allRuns(project.id).filter((r) => r.taskId === task.id).reduce((n, r) => Math.max(n, r.startedAt), 0)), answer ? answerPrompt(answer) : retryPrompt(task.lastError)].filter(Boolean).join('\n\n') : await freshPrompt(continuing ? await continueNote(rec!) : '', pack.text),
        canResume,
        continuing ? 'Continuing from kept work' : undefined
      )
      // Claude Code no longer has the session (it can't be restored): say so, and continue in a new
      // session from what is verifiably in the worktree instead of starting over.
      if (canResume && !outcome.ok && interruptionFrom(`${outcome.error ?? ''}`) === 'resume_failed') {
        rec = { ...(rec ?? recordFor(task, 'resume_failed', 'work', await this.inspectGit(project, task), project.baseBranch, Date.now(), false)), sessionResumable: false }
        sessionId = randomUUID()
        task = this.repo.updateTask(task.id, { sessionId, recovery: rec })
        this.emit({ type: 'task', task })
        this.logAction(project.id, task.id, 'recover', `${task.key}: Claude Code no longer has the previous session, so it was not resumed. Started a new session from the files already in the worktree.`)
        const context = await this.memory.retrieve(project, { purpose: 'task', text: `${task.title}\n${task.description}`, files: task.files, taskKind: task.kind, size: task.size, pinned })
        outcome = await agent('retry', await freshPrompt(await continueNote(rec), context.text), false, 'Continuing in a new session')
      }
      let stallRetried = false
      let reminded = false
      let flakyRerun = false
      // Verification evidence is what the agent ran through Claude Code's own Bash tool (and therefore
      // through the same permission policy); Autopia never runs commands on its own.
      const evidence: BashEvidence[] = []
      const edits: number[] = []

      // Bounded loop: structured result → check evidence → (fix and re-run) until green or out of attempts.
      for (;;) {
        task = this.repo.task(task.id)
        evidence.push(...outcome.bash)
        edits.push(...(outcome.edits ?? []))
        if (outcome.stalled && !stallRetried) {
          stallRetried = true
          outcome = await agent('retry', retryPrompt('your previous session stopped responding'), true)
          continue
        }
        if (outcome.looping) return this.failTask(project, task, outcome.looping)
        // you called this step off: it just ends, with no decision left to make
        // you stopped the project: this step ends here with its work kept, and Resume picks it up
        if (this.stopping.delete(task.id)) return this.interruptTask(project, this.repo.task(task.id), 'stopped', 'You stopped the work.')
        if (this.calledOff.delete(task.id)) {
          this.transitionTask(this.repo.task(task.id), 'cancelled', { lastError: 'Cancelled by you', finishedAt: Date.now() })
          await this.cleanupWorktree(project, task)
          void this.schedule()
          return
        }
        if (outcome.cancelled) return this.failTask(project, task, outcome.stalled ? 'Stalled twice; stopped by the manager' : 'Cancelled by you')
        if (!outcome.ok) return this.failTask(project, task, outcome.error ?? 'Claude Code run failed')
        // what you said while this step ran is applied now, in the same session (nothing restarts)
        const steer = this.takeSteer(task.id)
        // those that reached the session while it worked are done with; the rest it hears now
        for (const m of steer.filter((x) => x.delivered)) this.markSteer(m.messageId, task.id, 'applied')
        const missed = steer.filter((x) => !x.delivered)
        if (missed.length) {
          this.logAction(project.id, task.id, 'route', `${task.key}: applying your message${missed.length > 1 ? 's' : ''} in ${employee.name.split(' ')[0]}'s current session.`)
          for (const m of missed) {
            this.queueSteer(task.id, { ...m, delivered: true, sent: false })
            this.markSteer(m.messageId, task.id, 'delivered')
          }
          outcome = await agent('fix', steerPrompt(missed.map((m) => m.text)), true, 'Applying your feedback')
          continue
        }

        let summary: string
        let claimed: string[]
        if (task.kind === 'qa') {
          const qa = outcome.structured as QaOutput | null
          if (!qa) return this.failTask(project, task, 'QA finished without a verdict')
          summary = qa.summary
          claimed = qa.checks ?? []
          if (qa.verdict !== 'pass') return this.routeQaFailure(project, task, qa)
        } else {
          const work = outcome.structured as WorkOutput | null
          if (!work) return this.failTask(project, task, 'Finished without a structured result')
          summary = work.summary
          claimed = work.checks ?? []
          if (work.outcome === 'needs_input' && work.question && task.consults < 1) return this.requestInput(project, task, employee, work)
          // the work exists and only a declined command stands in the way: Autopia's own checks decide, not a stopped session
          const onlyRefused = work.outcome === 'blocked' && outcome.bash.some((b) => b.founderDenied || b.policyDenied) && /\b(permission|declined|denied|allow|approval)\b/i.test(work.blocker ?? '') && (!project.gitEnabled || (await git.diffStat(cwd, project.baseBranch!).catch(() => '')) !== '' || (await git.uncommittedFiles(cwd).catch(() => [])).length > 0)
          if (work.outcome !== 'completed' && !onlyRefused) return this.failTask(project, task, `Blocked: ${work.blocker ?? work.question ?? work.summary}`, summary)
          if (work.handoff || work.decisions?.length) this.pendingNotes.set(task.id, { handoff: work.handoff, decisions: work.decisions })
          if (Array.isArray(work.criteria) && work.criteria.length) task = this.repo.updateTask(task.id, { criteria: work.criteria.slice(0, 10) })
        }

        // the project's own checks, run here with your one-time OK: nobody stops to ask for each test run
        // a foundation has to really build before anyone builds on it
        // a new product's commands only exist once someone has written them: this is the moment to ask, once
        if (delivery && (isFoundation || !this.askedAfterWork.has(project.id))) {
          this.askedAfterWork.add(project.id)
          await this.selfChecks?.askForFoundation(project, delivery, cwd)
        }
        const self = this.selfChecks?.selfChecks(project, cwd, wantsBuild) ?? []
        if (self.length) evidence.push(...(await this.selfChecks!.runSelfChecks(project, cwd, self)))
        // the agent's `npm test` and Autopia's `npm run test` are the same check, whichever way it went for the agent
        const selfKeys = new Set(self.map(checkKey))
        const required = [...new Set([...self, ...[...normalizeClaims(task.validation), ...gateChecks, ...normalizeClaims(claimed), ...refusedChecks(evidence)].filter((c) => !selfKeys.has(checkKey(c)))].map((c) => c.trim()).filter((c) => !isThrowawayCheck(c)).filter((c) => c && !isLongRunning(c)))]
        const results = withoutSettled(evaluateChecks(required, evidence))
        const missing = results.filter((r) => r.status === 'missing')
        if (missing.length && !reminded) {
          reminded = true
          outcome = await agent('fix', checksPrompt(missing.map((m) => m.command)), true)
          continue
        }
        task = this.repo.updateTask(task.id, { checks: results, validation: required, resultSummary: summary })
        this.emit({ type: 'task', task })
        if (results.length) this.recordTaskValidation(task, results)
        const failed = results.find((r) => r.status === 'failed')
        // is it this change's doing? (recorded baseline, session evidence, the output itself; no AI)
        const cls = failed && !LEGACY_ENGINE ? classifyFailure(failed, { baseline: this.checkBaseline(project.id, task.id), session: evidence, edits, taskStartedAt: task.startedAt ?? 0 }) : null
        if (failed && cls?.kind === 'flaky' && !flakyRerun) {
          flakyRerun = true
          this.logAction(project.id, task.id, 'route', `${task.key}: \`${failed.command}\` looks flaky (${cls.evidence}); asking for one re-run before any code change.`)
          outcome = await agent('fix', flakyPrompt(failed), true, 'Re-running a flaky check')
          continue
        }
        if (failed && cls && !repairable(cls.kind)) {
          const why = `\`${failed.command}\` failed, but ${cls.evidence}.`
          const what = cls.kind === 'pre_existing' ? 'It is not attributed to this work and was not repaired automatically: fixing it would go beyond what you asked.' : 'Autopia did not ask the agent to change code for a problem with the machine.'
          task = this.repo.updateTask(task.id, { repairStop: `${why} ${what}` })
          this.logAction(project.id, task.id, 'route', `${task.key}: ${why} ${what}`)
          return this.requestVerificationDecision(project, task, results.filter((r) => r.status !== 'passed'), `${why} ${what} Accept the work as it is, retry, or ask for a fix.\n${oneLine(failed.output, 300)}`)
        }
        if (failed) {
          // bounded, evidence-driven repair: stop when a fix left the failure unchanged or the budget is used
          const signature = failureSignature(failed)
          const stop = repairStopReason(signature, lastSignature, task.fixAttempts, repairLimit)
          if (stop) {
            task = this.repo.updateTask(task.id, { repairStop: stop })
            return this.failTask(project, task, `${stop}\n${failed.command}\n${failed.output}`, summary)
          }
          lastSignature = signature
          repairedFrom ??= failed
          task = this.repo.updateTask(task.id, { fixAttempts: task.fixAttempts + 1 })
          this.logAction(project.id, task.id, 'route', `${task.key}: \`${failed.command}\` failed${cls ? ` (${cls.evidence})` : ''}; repair attempt ${task.fixAttempts} of ${repairLimit} by ${employee.name} in the same session.`)
          outcome = await agent('fix', fixPrompt(failed, task.fixAttempts, repairLimit, selfKeys.has(checkKey(failed.command))), true)
          continue
        }
        // Requirements the agent itself reports as not met get the same bounded, evidence-driven repair as a
        // failed check; if they remain, the work is partial and the founder decides (never "done").
        // "I couldn't run the tests" isn't a gap when Autopia just ran them and they passed
        const checkedHere = self.length > 0 && results.every((r) => r.status === 'passed')
        const unmet = task.kind === 'qa' || LEGACY_ENGINE ? [] : task.criteria.filter(teamUnmet).filter((c) => !(checkedHere && /declin|not (be )?(run|verif)|couldn.?t (run|verif)|could not (run|verif)|unable to (run|verif)|permission/i.test(`${c.criterion} ${c.evidence ?? ''}`)))
        if (unmet.length) {
          const signature = criteriaSignature(unmet)
          const stop = repairStopReason(signature, lastSignature, task.fixAttempts, repairLimit, 'The same unmet requirements')
          if (stop) {
            task = this.repo.updateTask(task.id, { repairStop: stop })
            const list = unmet.map((c) => `• ${c.criterion}${c.evidence ? ` (${oneLine(c.evidence, 140)})` : ''}`).join('\n')
            return this.requestVerificationDecision(project, task, results.filter((r) => r.status !== 'passed'), `Partly done. ${stop} Not met, by ${employee.name.split(' ')[0]}'s own report:\n${list}`)
          }
          lastSignature = signature
          task = this.repo.updateTask(task.id, { fixAttempts: task.fixAttempts + 1 })
          this.logAction(project.id, task.id, 'route', `${task.key}: ${plural(unmet.length, 'requirement')} reported as not met; focused repair ${task.fixAttempts} of ${repairLimit} by ${employee.name} in the same session.`)
          outcome = await agent('fix', criteriaPrompt(unmet, task.fixAttempts, repairLimit), true, 'Finishing unmet requirements')
          continue
        }
        const unverified = results.filter((r) => r.status !== 'passed')
        if (unverified.length) return this.requestVerificationDecision(project, task, unverified)
        // QA must be backed by something it actually ran, never inspection alone.
        if (task.kind === 'qa' && !evidence.some((e) => !e.isError)) {
          return this.requestVerificationDecision(project, task, [], 'QA reported a pass without running any command.')
        }
        // a verified repair is worth remembering: the failure and what fixed it, in the agent's own words
        if (repairedFrom) void this.recordRepairLesson(project, task, repairedFrom, summary)
        break
      }
    }

    if (!project.gitEnabled) return this.finishTask(task, task.changedFiles)

    // ── integrate: commit, protect user changes, resolve conflicts, merge serially ──
    task = this.transitionTask(task, 'merging')
    status('Integrating changes')
    await git.commitAll(cwd, `${task.key}: ${task.title}\n\n${task.resultSummary ?? ''}`)
    let changed = (await git.changedFiles(cwd, project.baseBranch!)).map((f) => `${f.status} ${f.path}`)
    if (!changed.length) {
      await git.removeWorktree(project.path, worktree, branch)
      return this.finishTask(task, [])
    }
    const dirty = await git.dirtyFiles(project.path)
    const touched = new Set(changed.map((c) => c.replace(/^\S+\s+/, '')))
    const clash = dirty.filter((f) => touched.has(f))
    if (clash.length) {
      return this.failTask(project, this.repo.updateTask(task.id, { changedFiles: changed }), `You have uncommitted changes in ${clash.join(', ')}. Commit or stash them, then retry. Autopia never overwrites your work.`)
    }

    for (;;) {
      const conflicts = await git.predictConflicts(project.path, project.baseBranch!, branch)
      if (!conflicts?.length) break
      task = this.repo.updateTask(task.id, { conflicts: task.conflicts + 1 })
      if (task.fixAttempts >= settings.maxFixAttempts) {
        return this.failTask(project, task, `Merge conflicts with ${project.baseBranch} in: ${conflicts.join(', ')}. The task branch ${branch} is preserved.`)
      }
      task = this.repo.updateTask(task.id, { fixAttempts: task.fixAttempts + 1 })
      const marked = await git.mergeBaseIntoWorktree(cwd, project.baseBranch!)
      if (!marked.length) break // git resolved it on merge (e.g. rename detection)
      const r = await agent('resolve', conflictPrompt(project.baseBranch!, marked), true)
      if (r.cancelled) return this.failTask(project, this.repo.task(task.id), 'Cancelled by you')
      if (!r.ok || (await git.hasConflictMarkers(cwd))) {
        return this.failTask(project, this.repo.task(task.id), `Could not resolve conflicts in ${marked.join(', ')}`)
      }
      await git.commitAll(cwd, `${task.key}: resolve conflicts with ${project.baseBranch}`)
      // two people's work has just become one: it has to pass together before it's merged, with one go at fixing it if not
      const self = this.selfChecks?.selfChecks(project, cwd, false) ?? []
      const brokenBy = async () => (self.length ? evaluateChecks(self, await this.selfChecks!.runSelfChecks(project, cwd, self)).filter((c) => c.status === 'failed') : [])
      const broken = await brokenBy()
      if (broken.length) {
        this.logAction(project.id, task.id, 'route', `${task.key}: \`${broken[0].command}\` fails now that its conflict with ${project.baseBranch} is resolved; ${employee.name} repairs it before merging.`)
        const fixed = await agent('fix', fixPrompt(broken[0], 1, 1, true), true, 'Repairing after the merge')
        if (fixed.cancelled) return this.failTask(project, this.repo.task(task.id), 'Cancelled by you')
        await git.commitAll(cwd, `${task.key}: repair after resolving conflicts`)
        const still = await brokenBy()
        if (still.length) return this.failTask(project, this.repo.task(task.id), `\`${still[0].command}\` still fails after resolving conflicts with ${project.baseBranch}. Nothing was merged; the task branch ${branch} is preserved.`)
      }
    }
    changed = (await git.changedFiles(cwd, project.baseBranch!)).map((f) => `${f.status} ${f.path}`)
    await this.withMergeLock(project.id, () => git.mergeIntoBase(project.path, project.baseBranch!, branch, mergeMessage(task)))
    await git.removeWorktree(project.path, worktree, branch)
    this.onMerged?.(this.repo.project(project.id))
    this.finishTask(this.repo.task(task.id), changed)
  }

  /** Messages queued for a session that ended first: they stay with the team for the steps to come. */
  private releaseSteer(taskId: string): void {
    const task = this.repo.task(taskId)
    for (const m of this.takeSteer(taskId)) {
      if (m.delivered) {
        this.markSteer(m.messageId, taskId, 'applied')
        continue
      }
      this.markSteer(m.messageId, taskId, 'released')
      // it came too late for this step, which is finished: someone still has to act on it
      const d = task.status !== 'cancelled' && !m.viaPrompt ? this.repo.openDelivery(task.projectId) : null
      if (d) this.addFollowUp(this.repo.project(task.projectId), d, m.messageId, m.text, [task], [])
    }
  }

  private finishTask(task: Task, changed: string[]): void {
    this.releaseSteer(task.id)
    // a shared contract moved: said out loud, and the code map carries it to whoever starts next
    if (this.repo.meta<string>(`foundation-task:${task.projectId}`) !== task.key) {
      const paths = changed.map((c) => c.replace(/^\S+\s+/, ''))
      for (const e of this.repo.knowledge(task.projectId)) {
        if (e.topic.startsWith('contract:') && e.files.some((f) => paths.includes(f))) this.logAction(task.projectId, task.id, 'route', `${task.key} changed ${e.files[0]}, which holds “${e.title.replace('Shared contract: ', '')}” other work relies on.`)
      }
    }
    void this.recordTaskMemory(task, changed)
    this.transitionTask(task, 'done', { changedFiles: changed, lastError: null, finishedAt: Date.now(), recovery: null })
    // Release the agent immediately.
    this.setStatus(task.assigneeId, this.blankStatus(task.assigneeId))
    this.checkMilestones(task.projectId)
  }

  /** Milestones are notified once each: halfway (≥ 4 tasks) and delivery. */
  private checkMilestones(projectId: string): void {
    const project = this.repo.project(projectId)
    const tasks = this.repo.tasks(projectId).filter((t) => t.status !== 'proposed')
    const done = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length
    const seen = new Set(this.repo.notifications(200).filter((n) => n.projectId === projectId).map((n) => n.title))
    const iteration = tasks.length
    if (done === tasks.length) {
      const title = `Finished: ${project.name} (${done} task${done === 1 ? '' : 's'})`
      if (!seen.has(title)) {
        const files = new Set(tasks.flatMap((t) => t.changedFiles)).size
        this.notify('delivered', projectId, null, title, `All work merged into ${project.baseBranch ?? 'the project'}; ${files} files changed.`)
      }
    } else if (iteration >= 4 && done * 2 >= iteration) {
      const title = `Halfway: ${project.name} (${done}/${iteration})`
      if (!seen.has(title)) this.notify('milestone', projectId, null, title, 'Half of the planned tasks are done.')
    }
  }

  /** Bounded collaboration: ask a teammate (design/architecture) or the founder (product) one question. */
  private requestInput(project: Project, task: Task, asker: Employee, work: WorkOutput): void {
    const question = work.question!.trim()
    const requeued = this.transitionTask(task, 'pending', { resultSummary: work.summary })
    this.repo.updateTask(task.id, { consults: task.consults + 1 })
    this.setStatus(asker.id, this.blankStatus(asker.id))
    if (work.askAbout === 'product' || !work.askAbout) {
      // you've been asked this already: your answer stands, and you aren't asked twice
      const settled = this.memory.answeredBefore(project.id, question)
      if (settled) {
        this.emit({ type: 'task', task: this.repo.updateTask(task.id, { note: `The founder already answered this: ${settled}` }) })
        this.logAction(project.id, task.id, 'consult', `${task.key} asked something you've already answered, so it goes on with your answer.`)
        return void this.schedule()
      }
      this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'question', title: `${asker.name.split(' ')[0]} asks about ${task.key}`, body: question }))
      this.notify('decision', project.id, task.id, `${task.key}: question for you`, question)
      this.logAction(project.id, task.id, 'consult', `${asker.name} paused ${task.key} with a product question for you.`)
      this.emit({ type: 'task', task: this.repo.task(requeued.id) })
      return
    }
    const area = work.askAbout
    const kind = area === 'design' ? 'design' : 'code'
    const skills: Task['skills'] = area === 'design' ? ['ui-design'] : ['architecture']
    const owner = chooseAssignee(this.team(project.id), kind, skills, (id) => (this.isBusy(id) ? 1 : 0), [asker.id])
    if (!owner) {
      this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'question', title: `${asker.name.split(' ')[0]} asks about ${task.key}`, body: question }))
      this.notify('decision', project.id, task.id, `${task.key}: question for you`, question)
      return
    }
    const consultTask = this.repo.insertTask(project.id, {
      key: `${task.key}.q`,
      title: `${area === 'design' ? 'Design' : 'Architecture'} input for ${task.key}`,
      description: question,
      acceptance: 'A decisive answer the asker can implement.',
      kind,
      assigneeId: owner.employee.id,
      dependsOnKeys: [],
      rationale: `${asker.name.split(' ')[0]} asked for ${area} input; ${owner.reason}.`,
      size: 's',
      skills
    })
    const note: ConsultNote = { consultFor: task.id, question, area }
    this.repo.updateTask(consultTask.id, { note: JSON.stringify(note), priority: 1 })
    this.repo.addDependency(task.id, consultTask.id)
    this.emit({ type: 'task', task: this.repo.task(consultTask.id) })
    this.emit({ type: 'task', task: this.repo.task(task.id) })
    this.logAction(project.id, task.id, 'consult', `${asker.name} asked ${owner.employee.name} for ${area} input on ${task.key}; ${task.key} resumes with the answer.`)
  }

  /** A read-only consultation session; its answer is handed to the asking task, which then resumes. */
  private async runConsult(task: Task, consult: ConsultNote): Promise<void> {
    const project = this.repo.project(task.projectId)
    const employee = this.employees.find((e) => e.id === task.assigneeId)!
    const asking = this.repo.task(consult.consultFor)
    const asker = this.employees.find((e) => e.id === asking.assigneeId)!
    const claude = this.requireClaude()
    const settings = this.repo.settings()
    const model = this.pickModel(settings, 'work', { size: 's' })
    task = this.transitionTask(task, 'running', { attempts: task.attempts + 1, startedAt: task.startedAt ?? Date.now(), model: model || null })
    const run = this.repo.createRun({ projectId: project.id, taskId: task.id, employeeId: employee.id, kind: 'task', cwd: project.path, model: model || null, purpose: 'work' })
    const sessionId = randomUUID()
    this.repo.updateRun(run.id, { sessionId })
    this.setStatus(employee.id, { activity: 'reviewing', projectId: project.id, taskId: task.id, runId: run.id, detail: `Answering ${asker.name.split(' ')[0]}`, reason: task.rationale, doing: 'collaborating' })
    const outcome = await this.execute(
      this.repo.run(run.id),
      {
        cwd: project.path,
        prompt: consultPrompt(asker, asking, consult.question, project),
        systemPrompt: consultSystemPrompt(employee, consult.area),
        model,
        sessionId,
        resume: false,
        mode: 'readonly',
        permissionProfile: settings.permissionProfile,
        jsonSchema: CONSULT_SCHEMA
      },
      claude.path!,
      employee.id
    )
    const answer = (outcome.structured as ConsultOutput | null)?.answer
    if (!outcome.ok || !answer) return this.failTask(project, this.repo.task(task.id), outcome.error ?? 'No answer produced')
    this.emit({ type: 'task', task: this.repo.updateTask(asking.id, { note: `${employee.name} (${employee.title}) answered your question "${consult.question}":\n${answer}` }) })
    void this.memory.remember(
      project,
      { kind: 'decision', title: consult.question.slice(0, 100), text: answer, files: asking.files, source: `${employee.name.split(' ')[0]} answered ${asking.key} (${consult.area})` },
      'agent'
    )
    this.finishTask(this.repo.updateTask(task.id, { resultSummary: answer }), [])
  }

  /**
   * QA found defects: route them to the developer who owns the work (one bounded fix task), then
   * re-run QA after it. Escalates to the founder when attempts are exhausted.
   */
  private routeQaFailure(project: Project, qa: Task, out: QaOutput): void {
    const settings = this.repo.settings()
    const issues = out.issues.map((i) => `- ${i}`).join('\n') || out.summary
    const owners = qa.dependsOn.map((d) => this.repo.task(d)).filter((d) => d.kind !== 'qa')
    if (qa.fixAttempts >= settings.maxFixAttempts || !owners.length) {
      return this.failTask(project, qa, `QA failed:\n${issues}`, out.summary)
    }
    const owner = owners[owners.length - 1]
    const fix = this.repo.insertTask(project.id, {
      key: `${qa.key}.${qa.fixAttempts + 1}`,
      title: `Fix QA findings from ${qa.key}`,
      description: `QA (${qa.key}) found these defects in your work on ${owners.map((o) => o.key).join(', ')}:\n${issues}`,
      acceptance: `Every defect listed is fixed; ${qa.key} re-verifies afterwards.`,
      kind: owner.kind === 'design' ? 'design' : 'code',
      assigneeId: owner.assigneeId,
      dependsOnKeys: [],
      rationale: `Routed back to ${owner.key}'s owner with QA's findings (attempt ${qa.fixAttempts + 1} of ${settings.maxFixAttempts}).`,
      size: 's',
      files: [...new Set(owners.flatMap((o) => o.files))],
      validation: [...new Set(owners.flatMap((o) => o.validation))]
    })
    this.repo.addDependency(qa.id, fix.id)
    this.logAction(project.id, qa.id, 'route', `QA found ${plural(out.issues.length, 'defect')}; routed back to ${this.employees.find((e) => e.id === owner.assigneeId)?.name ?? 'the owner'} as ${fix.key}, then ${qa.key} re-runs.`)
    const requeued = this.transitionTask(qa, 'pending', { fixAttempts: qa.fixAttempts + 1, lastError: `QA failed; waiting on ${fix.key}`, resultSummary: out.summary })
    this.emit({ type: 'task', task: fix })
    this.emit({ type: 'task', task: requeued })
    this.setStatus(qa.assigneeId, this.blankStatus(qa.assigneeId))
  }

  private failTask(project: Project, task: Task, error: string, summary?: string): void {
    // A real Claude usage limit isn't a failure: pause (keeping the session and worktree) instead of
    // repairing or retrying, which would only spend requests against a closed limit.
    const limit = activeLimit(this.usage, Date.now())
    if (isUsageLimitError(error) || limit) return this.pauseAtLimit(project, task, error, limit?.type ?? null, limit?.resetsAt ?? resetFromError(error))
    // Cut off (Claude Code exited, the network dropped) rather than failed: keep everything and offer to continue.
    const cut = interruptionFrom(error)
    if (cut && cut !== 'resume_failed') return this.interruptTask(project, task, cut, error)
    const updated = this.transitionTask(task, 'failed', { lastError: error, ...(summary ? { resultSummary: summary } : {}) })
    this.setStatus(task.assigneeId, { activity: 'error', projectId: project.id, taskId: task.id, runId: null, detail: oneLine(error, 80), reason: task.rationale })
    this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'task_failed', title: `${updated.key} is stuck`, body: error }))
    const security = /uncommitted changes|never overwrites/i.test(error)
    this.notify(security ? 'security' : 'failure', project.id, task.id, `${updated.key} is stuck`, clip(error.split('\n')[0], 200))
  }

  /**
   * Required checks that could not run (policy block, founder denial, or never run) are never treated
   * as passing: the founder decides whether to accept the work unverified, retry, or skip it.
   */
  private requestVerificationDecision(project: Project, task: Task, results: CheckResult[], reason?: string): void {
    const lines = results.map((r) => `• ${shortCommand(r.command)} — ${CHECK_STATUS_LABEL[r.status]}${r.status === 'blocked' ? `: ${oneLine(r.output, 160)}` : ''}`)
    const body = [reason ?? 'These required checks did not run, so this work is unverified:', ...lines].join('\n')
    const updated = this.transitionTask(task, 'failed', { lastError: body })
    this.setStatus(task.assigneeId, { activity: 'waiting', projectId: project.id, taskId: task.id, runId: null, detail: 'Checks could not run', reason: task.rationale })
    this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'unverified', title: `${updated.key} couldn’t be fully checked`, body }))
    this.notify('decision', project.id, task.id, `${updated.key} couldn’t be fully checked`, clip(lines[0] ?? body, 200))
  }

  /** A task cut off mid-work: interrupted (not failed), with what is preserved and how it continues. */
  private interruptTask(project: Project, task: Task, reason: TaskRecovery['reason'], error: string): void {
    const stage = task.status === 'merging' ? 'integrate' : 'work'
    const recovery = recordFor(task, reason, stage, null, project.baseBranch, Date.now())
    const updated = this.transitionTask(task, 'interrupted', { lastError: `Interrupted: ${REASON_TEXT[reason]}.\n${oneLine(error, 300)}`, recovery })
    this.showInterrupted(updated)
    this.logAction(project.id, task.id, 'recover', `${task.key}: ${REASON_TEXT[reason].toLowerCase()}; its work is kept and it can continue.`)
    void this.attachRecovery(project, updated, true)
  }

  /** The teammate shows the interruption (waiting at the desk, not working and not failed). */
  private showInterrupted(task: Task): void {
    const rec = task.recovery
    const detail = rec ? `Interrupted: ${SHORT_REASON[rec.reason]} · ${NEXT_LABEL[rec.next].toLowerCase()} when you're ready` : 'Interrupted · resume when you\'re ready'
    this.setStatus(task.assigneeId, { activity: 'waiting', projectId: task.projectId, taskId: task.id, runId: null, detail, reason: task.rationale })
  }

  /** What git says about a task's worktree and branch now (read-only). Null for projects without git. */
  private async inspectGit(project: Project, task: Task): Promise<GitFacts | null> {
    if (!project.gitEnabled || !project.baseBranch) return null
    const dir = join(this.worktreeRoot, project.id, task.id)
    const branch = branchFor(task)
    const worktree = existsSync(dir) && (await git.isRepo(dir))
    const hasBranch = await git.branchExists(project.path, branch)
    return {
      worktree,
      branch: hasBranch,
      commits: hasBranch ? await git.commitsAhead(project.path, project.baseBranch, branch) : 0,
      uncommitted: worktree ? await git.uncommittedFiles(dir).catch(() => []) : [],
      merged: await git.hasMergeCommit(project.path, project.baseBranch, mergeMessage(task))
    }
  }

  /** Fill in the verified git facts and (once) the decision that explains the interruption. */
  private async attachRecovery(project: Project, task: Task, decision: boolean): Promise<void> {
    try {
      const facts = await this.inspectGit(project, task).catch(() => null)
      const current = this.repo.task(task.id)
      if (current.status !== 'interrupted' || !current.recovery) return
      const recovery = refresh(current.recovery, current, facts, project.baseBranch)
      const updated = this.repo.updateTask(task.id, { recovery })
      this.emit({ type: 'task', task: updated })
      this.showInterrupted(updated)
      if (decision && !this.repo.pendingApprovals(project.id).some((a) => a.taskId === task.id && a.kind === 'task_failed')) {
        this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'task_failed', title: `${updated.key} was interrupted`, body: recoveryBody(recovery) }))
        this.notify('decision', project.id, task.id, `${updated.key} was interrupted`, `${REASON_TEXT[recovery.reason]}. Its work is kept.`)
      }
    } catch (err) {
      console.error('[orchestrator] could not inspect an interrupted task', err)
    }
  }

  private async cleanupWorktree(project: Project, task: Task): Promise<void> {
    if (!project.gitEnabled) return
    await git.removeWorktree(project.path, join(this.worktreeRoot, project.id, task.id), branchFor(task)).catch(() => undefined)
    if (this.statuses.get(task.assigneeId)?.taskId === task.id) this.setStatus(task.assigneeId, this.blankStatus(task.assigneeId))
  }

  // ── model selection ──────────────────────────────────────────

  /** Match model capability to the work; never picks a model the organization disallows. */
  private pickModel(settings: Settings, purpose: 'plan' | 'work' | 'qa', _hint: { size?: Task['size']; complexity?: string }): string {
    let model: string
    if (settings.modelStrategy === 'fixed') model = purpose === 'plan' ? settings.planningModel || settings.model : settings.model
    else model = 'opus' // planning, building, fixing and reviewing always get the strongest model there is
    const allowed = this.getClaude().allowedModels
    return model && allowed && !allowed.includes(model) ? '' : model
  }

  // ── Claude process execution ─────────────────────────────────

  private async execute(run: Run, spec: RunSpec, claudePath: string, employeeId: string): Promise<Outcome> {
    const chosenEffort = this.repo.settings().effort
    if (chosenEffort && chosenEffort !== 'auto' && (spec.mode === 'write' || spec.mode === 'direct')) spec = { ...spec, effort: chosenEffort }
    if (spec.effort) run = this.repo.updateRun(run.id, { effort: spec.effort })
    const entry: ActiveRun = { run, handle: null, cancelled: false, lastEventAt: Date.now(), warned: false, stalled: false, waiting: 0, inFlight: new Map(), repeatNoted: false, looping: null }
    this.active.set(run.id, entry)
    if (run.taskId && this.calledOff.has(run.taskId)) entry.cancelled = true
    let seq = 0
    // what they're really doing, from the tools they really use: this is what the office shows
    const work = new WorkTracker(run.taskId ? this.repo.task(run.taskId).kind : null)
    const toolNames = new Map<string, string>()
    const bashCalls = new Map<string, { command: string; at: number }>()
    const bash: BashEvidence[] = []
    const edits: number[] = []
    const founderDenied = new Set<string>()
    const decidedAt = new Map<string, number>() // command -> when the founder answered (excluded from check timing)
    const record = (kind: RunEventKind, summary: string, extra: { detail?: string | null; toolName?: string | null; isError?: boolean } = {}) => {
      entry.lastEventAt = Date.now()
      const event = this.repo.addEvent({
        runId: run.id,
        seq: seq++,
        kind,
        summary: oneLine(summary, 240),
        detail: extra.detail ? extra.detail.slice(0, MAX_DETAIL) : null,
        toolName: extra.toolName ?? null,
        isError: extra.isError
      })
      this.emit({ type: 'runEvent', projectId: run.projectId, event })
    }

    let malformed = 0
    const onEvent = (ev: ParsedEvent) => {
      switch (ev.kind) {
        case 'init': {
          record('init', `Session started · ${ev.model ?? 'default model'} · ${ev.permissionMode ?? 'default'} permissions${spec.effort ? ` · ${spec.effort} effort` : ''}`, { detail: `Tools: ${ev.tools.join(', ')}${ev.skills.length ? `\nSkills: ${ev.skills.join(', ')}` : ''}` })
          // what Claude Code actually loaded, not what Autopia intended to offer
          const cur = this.repo.run(run.id).skills
          if (cur && (cur.skills.length || cur.subagents.length)) {
            const available = cur.skills.filter((s) => ev.skills.some((x) => x === s || x.endsWith(`:${s}`)))
            const missingAgents = cur.subagents.filter((a) => !ev.agents.includes(a))
            this.repo.updateRun(run.id, { skills: { ...cur, available } })
            if (available.length < cur.skills.length || missingAgents.length) {
              record('system', `Claude Code did not load: ${[...cur.skills.filter((s) => !available.includes(s)), ...missingAgents].join(', ')}`)
            }
          }
          this.lastSession = { permissionMode: ev.permissionMode, apiKeySource: ev.apiKeySource, tools: ev.tools, mcpServers: ev.mcpServers, at: Date.now() }
          this.emit({ type: 'run', run: this.repo.updateRun(run.id, { model: ev.model }) })
          break
        }
        case 'rateLimit':
          this.noteUsage(ev.info)
          break
        case 'partial':
          spec.onPartial?.(ev.text)
          break
        case 'user_echo':
          if (this.steerEchoed(run.taskId, ev.text)) record('system', 'Your message reached this session', {})
          break
        case 'thinking':
          record('thinking', ev.text, { detail: ev.text })
          break
        case 'text':
          record('text', ev.text, { detail: ev.text })
          break
        case 'tool_use': {
          // a structured result that keeps arriving unreadable won't fix itself: stop, and say so
          if ((ev.input as { __unparsedToolInput?: unknown } | null)?.__unparsedToolInput && ++malformed >= 3 && !entry.cancelled) {
            record('error', 'The result kept coming back unreadable, so this session was stopped.', { isError: true })
            entry.cancelled = true
            entry.handle?.cancel()
          }
          toolNames.set(ev.toolUseId, ev.name)
          if (ev.name !== 'StructuredOutput') entry.inFlight.set(ev.toolUseId, { name: ev.name, since: Date.now() })
          if (ev.name === 'Bash' && typeof ev.input.command === 'string') bashCalls.set(ev.toolUseId, { command: ev.input.command, at: Date.now() })
          record('tool_use', ev.summary, { toolName: ev.name, detail: JSON.stringify(ev.input, null, 2) })
          // real activation: the agent invoked a skill or started a subagent
          if (ev.name === 'Skill' || ev.name === 'Task' || ev.name === 'Agent') {
            const cur = this.repo.run(run.id).skills
            const name = String(ev.input.skill ?? ev.input.command ?? ev.input.subagent_type ?? '').replace(/^\//, '')
            if (cur && name) {
              const patch = ev.name === 'Skill' ? { invoked: [...new Set([...(cur.invoked ?? []), name])] } : { subagentsUsed: [...new Set([...(cur.subagentsUsed ?? []), name])] }
              this.repo.updateRun(run.id, { skills: { ...cur, ...patch } })
            }
          }
          if (ev.name !== 'StructuredOutput') {
            const s = this.statuses.get(employeeId)
            const doing = work.tool(ev.toolUseId, ev.name, ev.input, Date.now())
            // a parallel tool mustn't replace what you're being asked
            if (s) this.setStatus(employeeId, { ...s, runId: run.id, detail: s.needsYou ? s.detail : ev.summary, doing: s.doing === 'collaborating' ? s.doing : doing })
          }
          const key = FILE_WRITE_TOOLS[ev.name]
          if (key) edits.push(Date.now())
          const relPath = key ? rel(spec.cwd, ev.input[key]) : ''
          if (key && run.taskId && relPath && !isAbsolute(relPath)) {
            const task = this.repo.task(run.taskId)
            const file = `M ${relPath}`
            if (!task.changedFiles.includes(file)) this.emit({ type: 'task', task: this.repo.updateTask(task.id, { changedFiles: [...task.changedFiles, file] }) })
            this.noteOverlap(task, relPath)
          }
          break
        }
        case 'tool_result': {
          entry.inFlight.delete(ev.toolUseId)
          {
            const before = work.doing
            const doing = work.result(ev.toolUseId, ev.isError, Date.now(), ev.text)
            const s = this.statuses.get(employeeId)
            if (s && doing !== before && s.doing !== 'collaborating') this.setStatus(employeeId, { ...s, doing })
          }
          const name = toolNames.get(ev.toolUseId) ?? 'tool'
          if (name === 'StructuredOutput') break
          const call = bashCalls.get(ev.toolUseId)
          if (call) {
            bash.push({
              command: call.command,
              isError: ev.isError,
              output: ev.text,
              ms: Date.now() - Math.max(call.at, decidedAt.get(call.command) ?? 0),
              at: call.at,
              founderDenied: ev.isError && founderDenied.has(call.command),
              policyDenied: false
            })
            // the same command failing the same way again and again: note it, then stop the loop
            const rep = ev.isError && run.taskId ? repeatedFailure(bash) : null
            if (rep && rep.count >= REPEAT_NOTE && !entry.repeatNoted) {
              entry.repeatNoted = true
              this.logAction(run.projectId, run.taskId, 'director', `The agent has run \`${oneLine(rep.command, 80)}\` ${rep.count} times with the same error (${oneLine(rep.error, 100)}). Watching; Autopia stops the session at ${REPEAT_STOP}.`)
            }
            if (rep && rep.count >= REPEAT_STOP && !entry.looping && !entry.cancelled) {
              entry.looping = `Stopped: the agent ran \`${oneLine(rep.command, 120)}\` ${rep.count} times with the same error (${oneLine(rep.error, 160)}) instead of changing approach. Its work so far is kept in the task's worktree.`
              this.logAction(run.projectId, run.taskId, 'recover', entry.looping)
              entry.handle?.cancel()
            }
          }
          const first = ev.text.split('\n').find((l) => l.trim()) ?? ''
          record('tool_result', `${name}${ev.isError ? ' error' : ' ok'}${first ? ` · ${first}` : ''}`, { toolName: name, detail: ev.text, isError: ev.isError })
          break
        }
        case 'result': {
          const u = ev.usage
          const tokens = u ? ` · ${fmtTokens(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens)} in / ${fmtTokens(u.outputTokens)} out` : ''
          record('result', ev.ok ? `Finished in ${ev.numTurns ?? '?'} turns · $${(ev.costUsd ?? 0).toFixed(3)}${tokens}` : `Run ended: ${ev.subtype}`, {
            detail: [ev.text, ...ev.errors].filter(Boolean).join('\n'),
            isError: !ev.ok
          })
          for (const d of ev.denials) {
            for (const b of bash) if (b.isError && b.command === d.command && !b.founderDenied) b.policyDenied = true
          }
          break
        }
        case 'system':
          record('system', ev.text)
          break
      }
    }

    // Claude Code asked (its policy said "ask"): relay to the founder and hold the tool call until they decide.
    // Claude Code's own question tool: each one comes to you as a question, and the session waits for the answer
    const askYou = async (req: PermissionRequest): Promise<PermissionDecision> => {
      const questions = (Array.isArray(req.input.questions) ? req.input.questions : []) as NativeQuestion[]
      const employee = this.employees.find((e) => e.id === employeeId)
      const first = employee?.name.split(' ')[0] ?? 'A teammate'
      const answers: Record<string, string> = {}
      for (const q of questions) {
        if (entry.cancelled) return { behavior: 'deny', message: 'The task was cancelled.' }
        const approval = this.createApproval({ projectId: run.projectId, taskId: run.taskId, kind: 'question', title: `${first} has a question`, body: questionBody(q) })
        entry.waiting++
        const before = this.statuses.get(employeeId)
        if (before) this.setStatus(employeeId, { ...before, activity: 'waiting', runId: run.id, detail: `Asking you: ${q.question.slice(0, 60)}`, needsYou: true })
        this.emitApproval(approval)
        this.notify('decision', run.projectId, run.taskId, approval.title, q.question)
        const answer = await new Promise<string | null>((resolve) => this.questionWaiters.set(approval.id, { runId: run.id, resolve }))
        entry.waiting--
        if (before && this.statuses.get(employeeId)?.activity === 'waiting') this.setStatus(employeeId, { ...before, runId: run.id })
        if (answer === null) return { behavior: 'deny', message: 'The question could no longer be answered.' }
        record('system', `You answered: ${q.question} ${answer}`)
        if (!this.autoDecided.has(approval.id)) void this.memory.rememberAnswer(this.repo.project(run.projectId), q.question, answer, 'Your answer to a question').catch(() => undefined)
        answers[q.question] = answer
      }
      return { behavior: 'allow', updatedInput: { ...req.input, answers } }
    }

    const onPermission = (req: PermissionRequest): Promise<PermissionDecision> => {
      if (req.toolName === 'AskUserQuestion') return askYou(req)
      const subject = permissionSubject(req, spec.cwd)
      const key = `${req.toolName}:${subject}`
      if (run.taskId && this.taskAllows.get(run.taskId)?.has(key)) {
        record('system', `Allowed (you OK'd this for the task): ${req.toolName} ${shortCommand(subject)}`)
        return Promise.resolve({ behavior: 'allow' })
      }
      if (entry.cancelled) return Promise.resolve({ behavior: 'deny', message: 'The task was cancelled.' })
      const employee = this.employees.find((e) => e.id === employeeId)
      const first = employee?.name.split(' ')[0] ?? 'An agent'
      const reason = typeof req.input.description === 'string' ? req.input.description : null
      const approval = this.createApproval({
        projectId: run.projectId,
        taskId: run.taskId,
        kind: 'permission',
        title: `${first} wants to ${permissionAsk(req.toolName)}`,
        body: JSON.stringify({ tool: req.toolName, subject, reason, runId: run.id, suggestions: req.suggestions })
      })
      entry.waiting++
      const before = this.statuses.get(employeeId)
      if (before) this.setStatus(employeeId, { ...before, activity: 'waiting', runId: run.id, detail: `Needs approval: ${shortCommand(subject, 60)}`, needsYou: true })
      record('system', `Waiting for your OK: ${req.toolName} ${shortCommand(subject)}`, { toolName: req.toolName })
      this.emitApproval(approval)
      this.notify('decision', run.projectId, run.taskId, approval.title, `${req.toolName}: ${shortCommand(subject, 160)}`)
      return new Promise((resolve) => {
        this.permissionWaiters.set(approval.id, {
          runId: run.id,
          key,
          resolve: (d) => {
            entry.waiting--
            if (d.behavior === 'deny' && req.toolName === 'Bash') founderDenied.add(subject)
            decidedAt.set(subject, Date.now())
            record('system', `${d.behavior === 'allow' ? 'You allowed' : 'You declined'}: ${req.toolName} ${shortCommand(subject)}`, { toolName: req.toolName })
            if (before && this.statuses.get(employeeId)?.activity === 'waiting') this.setStatus(employeeId, { ...before, runId: run.id })
            resolve(d)
            this.flushSteer(run.taskId)
          }
        })
      })
    }

    try {
      entry.handle = await startClaudeRun(
        claudePath,
        spec,
        onEvent,
        (line) => {
          if (/^Warning: claude\.ai MCP servers blocked/.test(line)) return
          record('stderr', line, { isError: true })
        },
        onPermission
      )
      if (entry.handle.pid) this.repo.updateRun(run.id, { pid: entry.handle.pid })
      if (entry.cancelled) entry.handle.cancel()
      this.flushSteer(run.taskId, true)
      const outcome = await entry.handle.done
      const r = outcome.result
      let error: string | null = null
      if (outcome.cancelled || entry.cancelled) error = 'Cancelled'
      else if (!r) error = `Claude Code exited (code ${outcome.exitCode}) without a result${outcome.stderr ? `: ${oneLine(outcome.stderr, 400)}` : ''}`
      else if (!r.ok) error = r.subtype === 'error_max_budget_usd' ? 'Stopped: per-run budget limit reached' : r.errors.join('; ') || r.text || `Run failed (${r.subtype})`
      else if (spec.jsonSchema && !r.structured) error = 'Run finished without structured output'

      const cancelled = outcome.cancelled || entry.cancelled || entry.stalled
      if (error && !cancelled) record('error', error, { isError: true })
      const updated = this.repo.updateRun(run.id, {
        status: cancelled ? 'cancelled' : error ? 'failed' : 'succeeded',
        endedAt: Date.now(),
        costUsd: r?.costUsd ?? null,
        numTurns: r?.numTurns ?? null,
        inputTokens: r?.usage?.inputTokens ?? null,
        outputTokens: r?.usage?.outputTokens ?? null,
        cacheReadTokens: r?.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: r?.usage?.cacheWriteTokens ?? null,
        durationMs: r?.durationMs ?? null,
        apiMs: r?.apiMs ?? null,
        exploreCalls: countExploration(this.repo.events(run.id)),
        pid: null,
        error
      })
      this.emit({ type: 'run', run: updated })
      return { ok: !error, cancelled, stalled: entry.stalled, looping: entry.looping, structured: r?.structured ?? null, text: r?.text ?? null, error, bash, edits }
    } catch (err) {
      const error = `Failed to start Claude Code: ${(err as Error).message}`
      record('error', error, { isError: true })
      this.emit({ type: 'run', run: this.repo.updateRun(run.id, { status: 'failed', endedAt: Date.now(), error, pid: null }) })
      return { ok: false, cancelled: false, stalled: false, structured: null, text: null, error, bash }
    } finally {
      this.active.delete(run.id)
      // The CLI process is gone: any prompt it raised can no longer be answered.
      for (const [id, w] of this.permissionWaiters) {
        if (w.runId !== run.id) continue
        this.permissionWaiters.delete(id)
        const was = this.repo.approval(id)
        this.emitApproval(this.repo.resolveApproval(id, 'expired'))
        this.logAction(was.projectId, was.taskId, 'route', `A request to use ${parsePermission(was.body).tool} closed unanswered, because its session ended.`)
      }
      for (const [id, w] of this.questionWaiters) {
        if (w.runId !== run.id) continue
        this.questionWaiters.delete(id)
        const was = this.repo.approval(id)
        this.emitApproval(this.repo.resolveApproval(id, 'expired'))
        this.logAction(was.projectId, was.taskId, 'route', 'A question closed unanswered, because its session ended.')
        w.resolve(null)
      }
    }
  }

  // ── deliveries: implementation → validation → review → acceptance ──

  private emitDelivery(d: Delivery): void {
    this.emit({ type: 'delivery', delivery: d })
    this.queueAttention()
  }

  /** A founder request (brief) gets a delivery when work starts; a plan revision keeps the same one. */
  private async ensureDelivery(project: Project): Promise<Delivery> {
    const open = this.repo.openDelivery(project.id)
    if (open) return open
    await this.memory.refresh(project).catch(() => undefined)
    const d = this.repo.createDelivery({
      projectId: project.id,
      parentId: null,
      kind: 'brief',
      request: project.goal,
      baseSha: project.gitEnabled ? await gitHead(project.path) : null,
      screenshot: null
    })
    this.emitDelivery(d)
    return d
  }

  /** The team is done: record what was delivered and what is known to be missing, then ask the founder. */
  private async finalizeDelivery(project: Project): Promise<void> {
    const d = this.repo.openDelivery(project.id)
    if (!d) {
      this.setPhase(project, 'completed', { lastError: null })
      return
    }
    // every step was skipped: there's nothing to verify or review, and saying "ready" would be untrue
    const steps = this.repo.tasks(project.id).filter((t) => t.deliveryId === d.id && t.status !== 'proposed')
    if (steps.length && steps.every((t) => t.status === 'cancelled')) {
      this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'rejected', decidedAt: Date.now(), completedAt: Date.now(), decisionNote: 'Nothing was delivered: every step was skipped.', headSha: project.gitEnabled ? await gitHead(project.path) : null }))
      const parent = d.parentId ? this.repo.delivery(d.parentId) : null
      if (parent?.status === 'revising') this.emitDelivery(this.repo.updateDelivery(parent.id, { status: 'review', decidedAt: null, decisionNote: null }))
      this.setPhase(project, 'completed', { lastError: null })
      return
    }
    if (this.verifying.has(project.id)) return
    this.verifying.add(project.id)
    let outcome: VerifyOutcome = 'verified'
    try {
      this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'validating', headSha: project.gitEnabled ? await gitHead(project.path) : null }))
      if (this.onVerify) outcome = await this.onVerify(project, this.repo.delivery(d.id))
    } catch (err) {
      // the check itself breaking is never a pass
      outcome = 'blocked'
      const fresh = this.repo.delivery(d.id)
      this.emitDelivery(this.repo.updateDelivery(d.id, { verification: { state: 'blocked', commit: fresh.headSha, attempts: fresh.verification?.attempts ?? 0, signature: null, at: Date.now(), reason: `Verification couldn’t run: ${(err as Error).message}`, steps: fresh.verification?.steps ?? [] } }))
    } finally {
      this.verifying.delete(project.id)
    }
    // waiting for your OK, or back with the team for a repair: verification runs again when that's done
    if (outcome === 'waiting' || outcome === 'fixing') return void this.schedule()
    // work you asked for while this ran comes first; it verifies when that finishes
    const open = this.repo.tasks(project.id).filter((t) => t.deliveryId === d.id && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'proposed')
    if (open.length) return void this.schedule()
    const tasks = this.repo.tasks(project.id).filter((t) => t.deliveryId === d.id)
    const unresolved = outcome === 'verified' ? [] : [this.repo.delivery(d.id).verification?.reason ?? 'It wasn’t verified.']
    const updated = this.repo.updateDelivery(d.id, {
      status: 'review',
      headSha: project.gitEnabled ? await gitHead(project.path) : null,
      summary: deliverySummary(tasks),
      limitations: [...unresolved, ...settledByRun(deliveryLimitations(tasks), outcome === 'verified' ? this.repo.delivery(d.id).verification : null)],
      completedAt: Date.now()
    })
    this.emitDelivery(updated)
    void this.memory.recordLessons(project)
    // QA runs before the result is announced: it may send verified defects back for one focused fix
    if (this.onReview) await this.onReview(project, updated).catch(() => undefined)
    if (this.repo.delivery(updated.id).status !== 'review') return
    this.setPhase(this.repo.project(project.id), outcome === 'verified' ? 'completed' : 'blocked', { lastError: outcome === 'verified' ? null : unresolved[0] })
    if (outcome !== 'verified') {
      this.notify('failure', project.id, null, `Result #${updated.number} ${outcome === 'blocked' ? 'is blocked' : 'doesn’t work yet'}`, unresolved[0], { deliveryId: updated.id })
      return
    }
    const caveat = updated.limitations.length ? ` ${plural(updated.limitations.length, 'known limitation')}.` : ''
    const projectPm = this.byRole('pm', project.id)
    this.notify('decision', project.id, null, `Result #${updated.number} is ready to review`, `${((n) => `${n} task${n === 1 ? '' : 's'} done.`)(tasks.filter((t) => t.status === 'done').length)}${caveat}`, { deliveryId: updated.id })
    const pm = projectPm
    if (this.statuses.get(pm.id)?.activity === 'idle') {
      this.setStatus(pm.id, { activity: 'waiting', projectId: project.id, taskId: null, runId: null, detail: `Delivery #${updated.number} awaits your review`, reason: null })
    }
  }

  /** Automatic verification, or your "Verify again": a fresh start with a fresh repair budget. */
  async reverify(deliveryId: string): Promise<void> {
    const d = this.repo.delivery(deliveryId)
    if (d.status !== 'review') throw new Error('Only a finished result can be verified again')
    const project = this.repo.project(d.projectId)
    this.onVerifyConsent?.(project.id, [], true)
    this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'validating', completedAt: null, verification: null, limitations: d.limitations.filter((l) => l !== d.verification?.reason) }))
    this.setPhase(project, 'executing', { lastError: null })
    await this.finalizeDelivery(this.repo.project(project.id))
  }

  canRepairDelivery(project: Project): boolean {
    return !this.repo.project(project.id).paused && this.getClaude().available
  }

  /** The commands are in the question, and only your answer to it lets them run. */
  askToVerify(project: Project, d: Delivery, commands: string[], early = false): void {
    if (this.repo.pendingApprovals(project.id).some((a) => a.kind === 'verify')) return
    this.repo.setMeta(`verify-asked:${project.id}`, commands)
    this.emitApproval(this.createApproval({ projectId: project.id, taskId: null, kind: 'verify', title: early ? 'OK for Autopia to run this project’s own checks and app?' : `Run result #${d.number} for real?`, body: commands.join('\n') }))
  }

  /** Measured failure → one focused task for whoever fits; verification runs again once it's merged. */
  addVerificationRepair(project: Project, d: Delivery, brief: string): string | null {
    const title = `Fix what failed when result #${d.number} was run`
    const skills = taskSkills({ kind: 'code', title, description: brief, files: [] })
    const owner = chooseAssignee(this.team(project.id), 'code', skills, (id) => (this.isBusy(id) ? 1 : 0))
    if (!owner) return null
    const t = this.repo.insertTask(project.id, {
      key: this.nextKey(project.id),
      title,
      description: brief,
      acceptance: 'The same verification passes: it installs, its checks pass, the dev server stays up and the page renders without errors.',
      kind: 'code',
      assigneeId: owner.employee.id,
      dependsOnKeys: [],
      rationale: `Autopia ran result #${d.number} for real and measured this failure. ${owner.reason}.`,
      size: 's',
      files: [],
      validation: [],
      skills,
      milestone: null
    })
    const task = this.repo.updateTask(t.id, { deliveryId: d.id })
    this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'implementing', completedAt: null }))
    this.emit({ type: 'task', task })
    this.logAction(project.id, task.id, 'route', `Result #${d.number} failed when run for real; ${owner.employee.name} fixes it (repair ${d.verification?.attempts ?? 1}).`)
    this.setPhase(this.repo.project(project.id), 'executing', { lastError: null })
    return task.key
  }

  private clearReviewWait(projectId: string): void {
    const pm = this.byRole('pm', projectId)
    const st = this.statuses.get(pm.id)
    if (st?.activity === 'waiting' && st.projectId === projectId && st.detail?.startsWith('Delivery #')) this.setStatus(pm.id, this.blankStatus(pm.id))
  }

  deliveries(projectId: string): Delivery[] {
    return this.repo.deliveries(projectId)
  }

  /** Read-only diff for a delivery (or the whole project when deliveryId is null). */
  async changes(projectId: string, deliveryId: string | null): Promise<ChangeSet> {
    const project = this.repo.project(projectId)
    const tasks = this.repo.tasks(projectId)
    if (!project.gitEnabled) {
      const files = [...new Set(tasks.filter((t) => !deliveryId || t.deliveryId === deliveryId).flatMap((t) => t.changedFiles.map((f) => f.replace(/^\S+\s+/, ''))))]
      return {
        base: null,
        head: null,
        branch: null,
        commits: [],
        files: files.map((path) => ({ path, oldPath: null, status: 'M', additions: 0, deletions: 0, binary: false, truncated: false, hunks: [] })),
        byTask: [],
        uncommitted: [],
        note: 'This project is not a git repository, so line-level diffs are not available. The list shows files the agents reported writing.'
      }
    }
    const d = deliveryId ? this.repo.delivery(deliveryId) : null
    const first = this.repo.deliveries(projectId).at(-1)
    const set = await changeSet(project.path, d ? d.baseSha : (first?.baseSha ?? null), d?.headSha ?? null, tasks.filter((t) => !d || t.deliveryId === d.id))
    if (d && !d.headSha) set.note = 'Work in progress: showing what has been merged so far.'
    return set
  }

  async decideDelivery(id: string, decision: 'accept' | 'reject', note: string | null): Promise<Delivery> {
    const d = this.repo.delivery(id)
    if (d.status !== 'review') throw new Error(`Delivery #${d.number} is ${d.status}; only deliveries in review can be decided`)
    const project = this.repo.project(d.projectId)
    const updated = this.repo.updateDelivery(id, {
      status: decision === 'accept' ? 'accepted' : 'rejected',
      decidedAt: Date.now(),
      decisionNote: note?.trim() || (decision === 'reject' ? 'Discarded. Its changes are still in the project; use "Undo its changes" to revert them with new commits.' : null)
    })
    this.emitDelivery(updated)
    this.clearReviewWait(d.projectId)
    if (decision === 'accept') {
      // accepting a revision accepts the work it revised (the founder saw the combined result)
      const chain: Delivery[] = [updated]
      for (let p = d.parentId ? this.repo.delivery(d.parentId) : null; p && p.status === 'revising'; p = p.parentId ? this.repo.delivery(p.parentId) : null) {
        chain.push(p)
        this.emitDelivery(this.repo.updateDelivery(p.id, { status: 'accepted', decisionNote: `Accepted together with revision #${d.number}.` }))
      }
      const ids = new Set(chain.map((x) => x.id))
      // accepted work becomes reusable knowledge for future requests
      for (const t of this.repo.tasks(d.projectId).filter((x) => x.deliveryId && ids.has(x.deliveryId) && x.status === 'done')) {
        const files = t.changedFiles.map((f) => f.replace(/^\S+\s+/, ''))
        await this.memory.remember(project, { kind: 'completed', topic: `completed:${t.key}`, title: `${t.key} ${t.title}`, text: (t.resultSummary ?? '').split('\n')[0], files, source: `accepted in #${d.number}` })
      }
      for (const l of chain.flatMap((x) => x.limitations)) await this.memory.remember(project, { kind: 'limitation', title: l.slice(0, 80), text: l, files: [], source: `#${d.number}` })
      this.logAction(d.projectId, null, 'route', `You accepted result #${d.number}.`)
    } else this.logAction(d.projectId, null, 'route', `You discarded result #${d.number}.${note ? ` ${note}` : ''}`)
    return updated
  }

  /**
   * Undoes a result you discarded by reverting its merge commits with new commits (history is kept,
   * nothing is reset). Refused whenever it could touch your uncommitted work or a later result.
   */
  async undoDelivery(id: string): Promise<Delivery> {
    const d = this.repo.delivery(id)
    const project = this.repo.project(d.projectId)
    const undone = this.repo.meta<string[]>(`undone:${project.id}`) ?? []
    const ready = project.gitEnabled && !!d.baseSha && !!d.headSha
    const files = ready ? await git.filesBetween(project.path, d.baseSha!, d.headSha!).catch(() => []) : []
    const merges = ready ? await git.mergesBetween(project.path, d.baseSha!, d.headSha!).catch(() => []) : []
    const tasks = this.repo.tasks(project.id)
    const later = this.repo
      .deliveries(project.id)
      .filter((x) => x.number > d.number && !undone.includes(x.id))
      .map((x) => ({ number: x.number, files: tasks.filter((t) => t.deliveryId === x.id).flatMap((t) => t.changedFiles.map((c) => c.replace(/^\S+\s+/, ''))) }))
    const blocker = undoBlocker({
      gitEnabled: project.gitEnabled,
      status: d.status,
      hasCommits: ready,
      alreadyUndone: undone.includes(d.id),
      busy: project.phase === 'planning' || [...this.active.values()].some((a) => a.run.projectId === project.id) || !!this.repo.openDelivery(project.id),
      onBase: project.gitEnabled ? (await git.currentBranch(project.path).catch(() => '')) === project.baseBranch : false,
      merges: merges.length,
      files,
      dirty: project.gitEnabled ? await git.dirtyFiles(project.path) : [],
      later
    })
    if (blocker) throw new Error(blocker)
    const reverted = await git.revertMerges(project.path, merges)
    this.repo.setMeta(`undone:${project.id}`, [...undone, d.id])
    const updated = this.repo.updateDelivery(d.id, { decisionNote: `${d.decisionNote ? `${d.decisionNote}\n` : ''}Undone: its ${plural(reverted.length, 'merge')} were reverted by new commits (${reverted.map((s) => s.slice(0, 7)).join(', ')}); history is kept.` })
    this.emitDelivery(updated)
    void this.memory.refresh(project, true).catch(() => undefined) // notes about the reverted files go stale on their own
    this.logAction(project.id, null, 'route', `You undid result #${d.number}: ${plural(reverted.length, 'merge')} reverted with new commits; ${plural(files.length, 'file')} are back as they were before it.`)
    return updated
  }

  /**
   * Natural-language follow-up: one scoped task, owned by whoever built the affected files, with the
   * previous delivery's summary and files as context. No planning meeting, no repository re-survey.
   */
  async requestRevision(projectId: string, input: { deliveryId: string | null; text: string; screenshot: string | null; taskId: string | null; files?: string[]; kind?: Task['kind']; title?: string; employeeId?: string | null }): Promise<Delivery> {
    const project = this.repo.project(projectId)
    const text = input.text.trim()
    if (!text) throw new Error('Describe what should change')
    if (this.repo.openDelivery(projectId)) throw new Error('The team is still working on the current request. Ask for changes once it reaches review.')
    if (project.phase === 'planning' || project.phase === 'awaiting_plan_approval') throw new Error('Finish the planning step first')
    this.requireClaude()
    const parent = input.deliveryId ? this.repo.delivery(input.deliveryId) : (this.repo.deliveries(projectId).find((x) => x.status === 'review' || x.status === 'accepted') ?? null)
    const all = this.repo.tasks(projectId)
    const parentTasks = parent ? all.filter((t) => t.deliveryId === parent.id) : []
    const changed = parent && project.gitEnabled && parent.baseSha ? (await this.changes(projectId, parent.id)).files.map((f) => f.path) : [...new Set(parentTasks.flatMap((t) => t.changedFiles.map((f) => f.replace(/^\S+\s+/, ''))))]

    let feedback: string | null = null
    if (input.screenshot) {
      if (!/^\.autopia\/screenshots\/[\w.-]+\.png$/.test(input.screenshot)) throw new Error('Unknown screenshot')
      excludeAutopiaDir(project.path)
      feedback = `.autopia/feedback/${Date.now()}.png`
      mkdirSync(join(project.path, '.autopia', 'feedback'), { recursive: true })
      copyFileSync(join(project.path, input.screenshot), join(project.path, feedback))
    }
    const referenced = input.taskId ? (all.find((t) => t.id === input.taskId) ?? null) : null
    const scope = revisionScope(text, parent, parentTasks, changed, feedback, referenced)
    const triage = triageBrief(text)
    const kind = input.kind ?? (triage.role === 'designer' ? 'design' : 'code')
    if (input.files?.length) scope.files = input.files
    if (input.title) scope.title = input.title
    const skills = taskSkills({ kind, title: scope.title, description: text, files: scope.files })
    // reuse the teammate who built most of the affected files; otherwise pick by capability
    const overlap = new Map<string, number>()
    for (const t of parentTasks) {
      const e = this.employees.find((x) => x.id === t.assigneeId)
      if (!e?.kinds.includes(kind)) continue
      const n = t.changedFiles.filter((f) => changed.includes(f.replace(/^\S+\s+/, ''))).length
      overlap.set(e.id, (overlap.get(e.id) ?? 0) + n + 0.1)
    }
    const builder = [...overlap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const asked = input.employeeId ? this.employees.find((e) => e.id === input.employeeId && e.role !== 'pm') : null
    const owner = asked
      ? { employee: asked, reason: 'you asked them directly' }
      : builder
        ? { employee: this.employees.find((e) => e.id === builder)!, reason: 'built this area in the previous delivery' }
        : chooseAssignee(this.team(projectId), kind, skills, (id) => (this.isBusy(id) ? 1 : 0))
    if (!owner) throw new Error('Nobody on the team can own this change')

    if (parent?.status === 'review') this.emitDelivery(this.repo.updateDelivery(parent.id, { status: 'revising', decidedAt: Date.now(), decisionNote: `Revision requested: ${text.slice(0, 200)}` }))
    this.clearReviewWait(projectId)
    await this.memory.refresh(project).catch(() => undefined)
    const d = this.repo.updateDelivery(this.repo.createDelivery({ projectId, parentId: parent?.id ?? null, kind: 'revision', request: input.title ? `${input.title}\n\n${text}` : text, baseSha: project.gitEnabled ? await gitHead(project.path) : null, screenshot: feedback }).id, { strategy: 'revision' })
    const task = this.repo.insertTask(projectId, {
      key: this.nextKey(projectId),
      title: scope.title,
      description: scope.description,
      acceptance: "The founder's request is addressed and existing behaviour is otherwise unchanged.",
      kind,
      assigneeId: owner.employee.id,
      dependsOnKeys: [],
      rationale: `Revision${parent ? ` of #${parent.number}` : ''}: ${owner.employee.name.split(' ')[0]} ${owner.reason}.`,
      size: 's',
      files: scope.files,
      validation: scope.validation,
      skills
    })
    this.emit({ type: 'task', task: this.repo.updateTask(task.id, { deliveryId: d.id }) })
    this.emitDelivery(d)
    this.logAction(projectId, task.id, 'route', `Revision #${d.number} → ${owner.employee.name} (${owner.reason}); no planning needed.`)
    const fresh = this.repo.project(projectId)
    this.setPhase(fresh, 'executing', { lastError: null })
    void this.schedule()
    return d
  }

  /**
   * What you pointed at in the preview, as real work. Changes in the same files stay with one teammate; the rest
   * run side by side. Joins whatever is already in progress instead of waiting for it.
   */
  async sendVisualFeedback(projectId: string, input: (Pick<FeedbackItem, 'id' | 'note' | 'pick' | 'shot'> & Pick<Partial<FeedbackItem>, 'capture' | 'mark'>)[]): Promise<FeedbackItem[]> {
    const project = this.repo.project(projectId)
    // only pictures Autopia wrote itself get named to a teammate
    const items = input.filter((i) => i.note.trim()).map((i) => ({ ...i, shot: isCapturePath(i.shot) ? i.shot : null, capture: i.capture && isCapturePath(i.capture.path) ? i.capture : null }))
    if (!items.length) throw new Error('Say what should change first')
    if (project.phase === 'planning' || project.phase === 'awaiting_plan_approval') throw new Error('Finish the planning step first')
    this.requireClaude()
    const located: FeedbackItem[] = await Promise.all(items.map(async (i) => ({ ...i, note: i.note.trim(), sources: await this.memory.locate(project, i.pick).catch(() => []), taskId: null, check: null })))
    const said = located.map((i, n) => `${located.length > 1 ? `${n + 1}. ` : ''}${i.note} (${describePick(i.pick)})`).join('\n')
    const mine = this.emitMessage(this.repo.addMessage({ projectId, role: 'user', intent: 'change', text: said, attachments: [], employeeId: null, taskId: null, deliveryId: null, runId: null, status: 'sent', error: null }))
    const assigned: string[] = []
    for (const group of groupFeedback(located)) {
      // what already became work stays work: a later failure must not make you send it twice
      try {
        const text = feedbackRequest(group)
        const kind = feedbackKind(group.map((g) => g.note).join(' '))
        const files = [...new Set(group.flatMap((g) => { const exact = g.sources.filter((s) => s.confidence === 'exact'); return (exact.length ? exact : g.sources).map((s) => s.file) }))]
        let task: Task
        const open = this.repo.openDelivery(projectId)
        if (!open) {
          const d = await this.requestRevision(projectId, { deliveryId: null, text, screenshot: group.find((g) => g.shot)?.shot ?? null, taskId: null, files, kind, title: group[0].note.slice(0, 80) })
          task = this.repo.tasks(projectId).filter((t) => t.deliveryId === d.id).at(-1)!
          this.emitMessage(this.repo.updateMessage(mine.id, { deliveryId: d.id }))
        } else {
          const skills = taskSkills({ kind, title: group[0].note, description: text, files })
          const owner = chooseAssignee(this.team(projectId), kind, skills, (id) => (this.isBusy(id) || assigned.includes(id) ? 1 : 0))
          if (!owner) throw new Error('Nobody on the team can own this change')
          const t = this.repo.insertTask(projectId, { key: this.nextKey(projectId), title: group[0].note.slice(0, 80), description: text, acceptance: 'What was asked is true on the page, and nothing else about it changed.', kind, assigneeId: owner.employee.id, dependsOnKeys: [], rationale: `You pointed at this in the preview. ${owner.reason}.`, size: 's', files, validation: [], skills, milestone: null })
          task = this.repo.updateTask(t.id, { deliveryId: open.id })
          this.emit({ type: 'task', task })
          if (open.status !== 'implementing') this.emitDelivery(this.repo.updateDelivery(open.id, { status: 'implementing', completedAt: null }))
          if (this.repo.project(projectId).phase !== 'executing') this.setPhase(this.repo.project(projectId), 'executing', { lastError: null })
        }
        assigned.push(task.assigneeId)
        for (const g of group) g.taskId = task.id
      } catch (err) {
        if (!located.some((i) => i.taskId)) throw err
        this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'note', text: `Some of your notes couldn’t start: ${(err as Error).message}. They’re still in the Studio.`, attachments: [], employeeId: null, taskId: null, deliveryId: null, runId: null, status: 'delivered', error: null }))
      }
    }
    const who = [...new Set(located.flatMap((i) => i.taskId ?? []))].map((id) => this.repo.task(id!)).map((t) => `${firstName(this.employees.find((e) => e.id === t.assigneeId)?.name)} (${t.key})`)
    this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'note', text: `On it: ${who.join(', ')}. You can follow each change in the preview.`, attachments: [], employeeId: this.byRole('pm', projectId).id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
    void this.schedule()
    return located
  }

  // ── validation ─────────────────────────────────────────────


  validations(projectId: string): ValidationRun[] {
    return this.repo.validations(projectId)
  }

  private recordTaskValidation(task: Task, checks: CheckResult[]): void {
    const status = checks.every((c) => c.status === 'passed') ? 'passed' : checks.some((c) => c.status === 'failed') ? 'failed' : 'unverified'
    const v = this.repo.createValidation({ projectId: task.projectId, deliveryId: task.deliveryId, runId: null, trigger: 'task', status, checks })
    this.emit({ type: 'validation', validation: this.repo.finishValidation(v.id, { status, checks, error: null }) })
  }

  /** A check you ran came out: a failure is said once, and a pass settles it. */
  operationResult(projectId: string, label: string, command: string, failure: string | null): void {
    const key = `ops:${projectId}:${command}`
    if (failure) return void this.notify('failure', projectId, null, `${label} failed`, clip(failure, 200), { key })
    const prev = this.repo.openNotification(key)
    if (prev) this.emit({ type: 'notification', notification: this.repo.resolveNotification(prev.id) })
  }

  /**
   * You asked the team to fix a measured failure. The same failure with a task already on it joins that task instead of
   * starting another. It never retries by itself: running the check again is yours.
   */
  async fixOperation(projectId: string, x: { signature: string; title: string; brief: string }): Promise<Task> {
    const known = this.repo.meta<Record<string, string>>(`op-fixes:${projectId}`) ?? {}
    const tasks = this.repo.tasks(projectId)
    const on = tasks.find((t) => t.id === known[x.signature])
    if (on && !['done', 'cancelled', 'failed'].includes(on.status)) return on
    const open = this.repo.openDelivery(projectId)
    let task: Task | undefined
    if (open) {
      // the team is on a request right now: this joins it, so it's delivered and verified with that work
      const skills = taskSkills({ kind: 'code', title: x.title, description: x.brief, files: [] })
      const owner = chooseAssignee(this.team(projectId), 'code', skills, (id) => (this.isBusy(id) ? 1 : 0))
      if (!owner) throw new Error('Nobody on the team can take this right now')
      const t = this.repo.insertTask(projectId, { key: this.nextKey(projectId), title: x.title, description: x.brief, acceptance: 'The same command passes when Autopia runs it again.', kind: 'code', assigneeId: owner.employee.id, dependsOnKeys: [], rationale: `You asked for this from Operations. ${owner.reason}.`, size: 's', files: [], validation: [], skills, milestone: null })
      task = this.repo.updateTask(t.id, { deliveryId: open.id })
      this.emit({ type: 'task', task })
      this.logAction(projectId, task.id, 'route', `${x.title} → ${owner.employee.name} (asked for from Operations).`)
      void this.schedule()
    } else {
      const d = await this.requestRevision(projectId, { deliveryId: null, text: x.brief, screenshot: null, taskId: null, title: x.title })
      task = this.repo.tasks(projectId).find((t) => t.deliveryId === d.id)
    }
    if (!task) throw new Error('The fix couldn’t be handed to the team')
    this.repo.setMeta(`op-fixes:${projectId}`, { ...known, [x.signature]: task.id })
    return task
  }

  /** Which task is on which measured failure. */
  operationFixes(projectId: string): Record<string, string> {
    return this.repo.meta<Record<string, string>>(`op-fixes:${projectId}`) ?? {}
  }

  // ── project memory ─────────────────────────────────────────

  private async recordPlanMemory(projectId: string, plan: PlanOutput): Promise<void> {
    const project = this.repo.project(projectId)
    if (plan.repoSummary.trim()) {
      await this.memory.remember(project, { kind: 'architecture', topic: 'architecture:plan', title: 'Architecture (planning summary)', text: plan.repoSummary, files: [], source: `${this.byRole('pm', project.id).name.split(' ')[0]}'s plan` })
    }
    for (const d of plan.decisions ?? []) {
      await this.memory.remember(project, { kind: 'decision', title: d.title, text: d.decision, rationale: d.why, alternatives: d.alternatives ?? null, files: d.modules ?? [], source: 'planning' })
    }
    const p = plan.product
    if (p) {
      await this.memory.remember(project, { kind: 'decision', topic: 'decision:product-stack', title: 'Product stack', text: `${p.architecture.stack}. Data: ${p.architecture.data}. API: ${p.architecture.api}`, rationale: p.architecture.rationale, alternatives: null, files: [], source: 'product plan' })
      if (p.constraints.length) await this.memory.remember(project, { kind: 'convention', topic: 'direction:constraints', title: 'Constraints', text: p.constraints.join('\n'), files: [], source: 'product plan' }, 'system')
      for (const a of p.assumptions.slice(0, 6)) await this.memory.rememberAssumption(project, a.slice(0, 120), a, 'product plan')
      if (p.direction) {
        const dir = p.direction
        await this.memory.remember(project, { kind: 'convention', topic: 'direction:project', title: 'Quality direction', text: `For ${dir.audience}. ${dir.personality} Concept: ${dir.concept}\nExcellent means: ${dir.standards.join('; ')}\nNot: ${dir.avoid.join('; ')}${dir.assets.length ? `\nAssets: ${dir.assets.join('; ')}` : ''}`, files: [], source: 'Quality direction in the plan' }, 'system')
      }
      if (p.foundation) {
        await this.memory.remember(project, { kind: 'architecture', topic: 'architecture:structure', title: 'Project structure', text: p.foundation.structure.map((x) => `${x.path}: ${x.owns}`).join('\n'), files: [], source: 'Foundation in the plan' }, 'system')
        for (const c of p.foundation.contracts) await this.memory.remember(project, { kind: 'decision', topic: `contract:${c.name}`, title: `Shared contract: ${c.name}`, text: `${c.file}: ${c.shape}`, files: [c.file], source: 'Foundation in the plan' }, 'system')
      }
      await this.memory.remember(project, { kind: 'convention', topic: 'convention:design-direction', title: 'Design direction', text: `${p.design.direction}\nType: ${p.design.typography}\nColours: ${p.design.colors.map((c) => `${c.name} ${c.value}`).join(', ')}\nLayout: ${p.design.layout}\nComponents: ${p.design.components}\nAccessibility: ${p.design.accessibility}`, files: [], source: 'product plan' })
    }
  }

  /** The QA engineer appears at work in the office while an automated audit runs (no Claude session). */
  qaBusy(projectId: string, detail: string): () => void {
    const qa = this.team(projectId).find((e) => e.kinds.includes('qa') && !this.isBusy(e.id))
    if (!qa) return () => undefined
    this.setStatus(qa.id, { activity: 'testing', projectId, taskId: null, runId: null, detail, reason: 'Automated quality audit (no AI session)' })
    return () => {
      if (this.statuses.get(qa.id)?.detail === detail) this.setStatus(qa.id, this.blankStatus(qa.id))
    }
  }

  /**
   * Gates finished milestones (deterministic checks via the quality engine, at most one focused repair
   * each) and returns the milestone whose tasks may run now. The last milestone is gated by delivery review.
   */
  private gating = new Set<string>()
  private advanceMilestones(project: Project, spec: ProductSpec, tasks: Task[]): number | null {
    const last = spec.milestones[spec.milestones.length - 1]?.n
    for (const m of spec.milestones) {
      const own = tasks.filter((t) => t.milestone === m.n && t.status !== 'proposed')
      if (!own.length || m.n === last) continue
      if (!own.every((t) => t.status === 'done' || t.status === 'cancelled')) continue
      const repair = m.gate?.repairTaskKey ? tasks.find((t) => t.key === m.gate!.repairTaskKey) : null
      const regate = m.gate?.verdict === 'failed' && repair?.status === 'done' && (repair.finishedAt ?? 0) > m.gate.at
      if ((m.gate && !regate) || !this.onMilestone) continue
      const key = `${project.id}:${m.n}`
      if (this.gating.has(key)) continue
      this.gating.add(key)
      this.emit({ type: 'product', spec: this.repo.saveProductSpec({ ...spec, milestones: spec.milestones.map((x) => (x.n === m.n ? { ...x, status: 'verifying' } : x)) }) })
      this.logAction(project.id, null, 'route', `Milestone ${m.n} "${m.title}" finished; verifying it before milestone ${m.n + 1} starts.`)
      void this.onMilestone(project, m.n)
        .catch(() => undefined)
        .finally(() => {
          this.gating.delete(key)
          void this.schedule()
        })
    }
    const fresh = this.repo.productSpec(project.id) ?? spec
    return currentMilestone(fresh, tasks)
  }

  /**
   * Natural-language product feedback. Before approval it revises the plan; while the team is
   * building it is recorded and given to every task that has not started yet; afterwards it becomes a
   * scoped revision of the delivered product. Existing working behaviour is preserved unless asked.
   */
  async productFeedback(projectId: string, text: string): Promise<'replanned' | 'queued' | 'revision'> {
    const request = text.trim()
    if (!request) throw new Error('Describe what should change')
    const spec = this.repo.productSpec(projectId)
    if (spec) this.emit({ type: 'product', spec: this.repo.saveProductSpec({ ...spec, changes: [...spec.changes, { at: Date.now(), request: request.slice(0, 2000) }].slice(-20) }) })
    const project = this.repo.project(projectId)
    const plan = this.repo.pendingApprovals(projectId).find((a) => a.kind === 'plan')
    if (plan && project.phase === 'awaiting_plan_approval') {
      await this.resolveApproval(plan.id, { kind: 'plan', action: 'revise', feedback: request })
      return 'replanned'
    }
    if (this.repo.openDelivery(projectId) || project.phase === 'planning') {
      const notes = this.repo.meta<{ at: number; text: string }[]>(`notes:${projectId}`) ?? []
      this.repo.setMeta(`notes:${projectId}`, [...notes, { at: Date.now(), text: request.slice(0, 2000) }].slice(-20))
      this.logAction(projectId, null, 'route', `Your note was recorded; tasks that have not started yet will apply it: "${request.slice(0, 120)}"`)
      return 'queued'
    }
    await this.requestRevision(projectId, { deliveryId: null, text: request, screenshot: null, taskId: null })
    return 'revision'
  }

  // ── company director (deterministic; no AI session of its own) ──

  spent(projectId: string): number {
    return this.repo.allRuns(projectId).reduce((n, r) => n + (r.costUsd ?? 0), 0)
  }

  // ── Claude plan usage ────────────────────────────────────────

  /** A `rate_limit_event` from any session: keep the latest per limit, persist, and tell the UI. */
  private noteUsage(info: Record<string, unknown>): void {
    this.usage = applyRateLimit(this.usage, info, Date.now())
    this.saveUsage()
  }

  private saveUsage(): void {
    this.repo.setMeta('claude-usage', this.usage)
    this.emit({ type: 'usage', usage: this.usageView() })
  }

  usageView(): { limits: UsageState['limits'][string][]; extra: UsageState['extra']; updatedAt: number | null; hold: UsageState['hold'] } {
    return { limits: Object.values(this.usage.limits), extra: this.usage.extra, updatedAt: this.usage.updatedAt, hold: this.usage.hold }
  }

  /**
   * A task stopped at a real usage limit: mark it interrupted (Retry resumes the same Claude Code
   * session in its worktree), hold new work, and say when it resets if Claude Code told us.
   */
  private pauseAtLimit(project: Project, task: Task, error: string, type: string | null, until: number | null): void {
    const when = until ? new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
    const auto = !!until && this.repo.settings().autoResumeAfterLimit
    const said = oneLine(error, 200)
    const body = `Claude Code reported a usage limit${type ? ` (${type.replace(/_/g, ' ')})` : ''}${when ? `; it resets ${when}` : ''}. Nothing was lost: Retry continues the same session in its worktree. Autopia does not work around plan limits.\nClaude Code: ${said}`
    const recovery = recordFor(task, 'usage_limit', task.status === 'merging' ? 'integrate' : 'work', null, project.baseBranch, Date.now())
    const updated = this.transitionTask(task, 'interrupted', { lastError: `Paused at your Claude usage limit${when ? ` (resets ${when})` : ''}`, recovery })
    void this.attachRecovery(project, updated, false)
    this.setStatus(task.assigneeId, { activity: 'waiting', projectId: project.id, taskId: task.id, runId: null, detail: when ? `Usage limit: resets ${when}` : 'Usage limit reached', reason: task.rationale })
    if (!this.repo.pendingApprovals(project.id).some((a) => a.taskId === task.id && a.kind === 'task_failed')) {
      this.emitApproval(this.createApproval({ projectId: project.id, taskId: task.id, kind: 'task_failed', title: `${updated.key} paused at your Claude usage limit`, body }))
    }
    const first = !this.usage.hold
    this.usage = { ...this.usage, hold: { type, until, since: this.usage.hold?.since ?? Date.now() } }
    this.saveUsage()
    if (first) {
      this.logAction(project.id, task.id, 'director', `Claude usage limit reached; new work is held${when ? ` until ${when}` : ''}.`)
      this.notify('decision', project.id, task.id, 'Claude usage limit reached', auto ? `Work is paused and continues after ${when}.` : when ? `Work is paused. Your limit resets ${when}; continue from the usage indicator.` : 'Work is paused. Continue when your limit resets.', { usage: true })
    }
    this.armAutoResume()
  }

  /** With auto-continue on and an exact reset time from Claude Code, continue shortly after it passes. */
  private armAutoResume(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = null
    const hold = this.usage.hold
    if (!hold?.until || !(this.repo.settings().autoResumeAfterLimit || this.repo.settings().autoApprove)) return
    this.resumeTimer = setTimeout(() => void this.resumeAfterLimit('auto'), Math.max(0, hold.until - Date.now()) + 60_000)
  }

  /**
   * Continue after a usage limit: release the hold and retry each task paused at the limit exactly
   * once (each resumes its own session, so no work is repeated).
   */
  async resumeAfterLimit(by: 'you' | 'auto' = 'you'): Promise<number> {
    if (!this.usage.hold) return 0
    this.usage = { ...this.usage, hold: null }
    this.saveUsage()
    let n = 0
    for (const p of this.repo.projects()) {
      for (const a of this.repo.pendingApprovals(p.id).filter((x) => x.kind === 'task_failed' && /paused at your Claude usage limit/.test(x.title))) {
        if (a.taskId && this.repo.task(a.taskId).status === 'interrupted') {
          n++
          await this.resolveApproval(a.id, { kind: 'task_failed', action: 'retry' })
        }
      }
      if (n) this.logAction(p.id, null, 'director', by === 'auto' ? 'Usage limit reset passed; paused work continues.' : 'You continued after the usage limit.')
    }
    void this.schedule()
    return n
  }

  /** Re-arm (or disarm) auto-continue when the setting changes. */
  settingsChanged(): void {
    this.armAutoResume()
    // turning auto mode on approves what is already waiting that it may approve
    if (this.repo.settings().autoApprove) {
      for (const p of this.repo.projects()) for (const a of this.repo.pendingApprovals(p.id)) if (a.kind === 'plan') this.autoApprovePlan(p.id, a.id)
      this.directorPass()
    }
  }

  /** Auto mode: a ready plan starts without waiting for you (its open questions keep the PM's assumptions). */
  private autoApprovePlan(projectId: string, approvalId: string): void {
    if (this.autoDecided.has(approvalId) && this.repo.approval(approvalId).status !== 'pending') return
    this.autoDecided.add(approvalId)
    const pm = this.byRole('pm', projectId)
    this.logAction(projectId, null, 'director', `Auto mode approved ${pm.name.split(' ')[0]}'s plan; work starts now. Turn auto mode off to review plans first.`)
    void this.resolveApproval(approvalId, { kind: 'plan', action: 'approve' }).catch((err: Error) => this.logAction(projectId, null, 'director', `Auto mode could not start the plan: ${err.message}`))
  }

  /** Pause or resume a project. (Budgets were removed: there is no Autopia spending cap.) */
  setProjectControls(projectId: string, patch: { paused?: boolean }): Project {
    const project = this.repo.project(projectId)
    const next: { paused?: boolean } = {}
    if (typeof patch.paused === 'boolean') next.paused = patch.paused
    const updated = this.repo.updateProject(projectId, next)
    this.emit({ type: 'project', project: updated })
    if (next.paused !== undefined) this.logAction(projectId, null, 'director', next.paused ? `You paused ${project.name}: nothing new starts; running work finishes.` : `You resumed ${project.name}.`)
    void this.schedule()
    return updated
  }

  /**
   * Resolves routine blockers on its own, once per distinct blocker: resumes interrupted sessions and
   * retries after a missing dependency. Everything else (failing checks after bounded repair, policy,
   * your uncommitted changes, budget, requirements) waits for the CEO with a diagnosis.
   */
  private directorPass(): void {
    const settings = this.repo.settings()
    if (!(settings.autoResolve || settings.autoApprove) || !this.getClaude().available) return
    const tried = new Set(this.repo.meta<string[]>('director-auto') ?? [])
    for (const project of this.repo.projects()) {
      if (project.paused) continue
      for (const a of this.repo.pendingApprovals(project.id).filter((x) => x.kind === 'task_failed' && x.taskId)) {
        const task = this.repo.task(a.taskId!)
        if (!['failed', 'interrupted'].includes(task.status) || [...this.active.values()].some((x) => x.run.taskId === task.id)) continue
        let b = diagnose(task, a)
        // auto mode also retries a stuck task once on the same evidence (never policy, your changes or limits)
        if (!b.autoAction && settings.autoApprove && AUTO_RETRY.has(b.kind)) b = { ...b, autoAction: 'retry' }
        if (!b.autoAction) continue
        const key = blockerKey(task.id, b)
        if (tried.has(key)) continue
        tried.add(key)
        this.repo.setMeta('director-auto', [...tried].slice(-500))
        if (b.autoAction === 'install_and_retry') {
          this.repo.updateTask(task.id, { note: `The previous attempt failed because a dependency was missing (${b.summary}). Install the project's declared dependencies first (e.g. \`npm install\`), then continue your task and re-run its checks.` })
        }
        this.logAction(project.id, task.id, 'director', `${task.key}: ${b.kind.replace('_', ' ')} (${b.summary.slice(0, 120)}). ${b.autoAction === 'resume' ? 'Resuming the same session once.' : b.autoAction === 'retry' ? 'Auto mode: retrying it once in the same session.' : 'Retrying once after installing dependencies.'}`)
        void this.resolveApproval(a.id, { kind: 'task_failed', action: 'retry' }).catch((err: Error) => this.logAction(project.id, task.id, 'director', `${task.key}: automatic ${b.autoAction} failed to start: ${err.message}`))
      }
      if (settings.autoApprove) this.autoDecide(project)
    }
  }

  /**
   * Auto mode decides everything Autopia itself asks you, so work never waits on you: plans start,
   * teammates' questions get "use your judgment", and work whose checks couldn't run is accepted (it
   * stays labelled unverified). Claude Code's own permission prompts are not Autopia's to answer: they
   * come from your Claude Code / organization policy and always wait for you.
   */
  private autoDecided = new Set<string>()
  private autoDecide(project: Project): void {
    for (const a of this.repo.pendingApprovals(project.id)) {
      // each decision once, even if the pass runs again before it settles
      if (!autoDecision(a.kind) || this.autoDecided.has(a.id)) continue
      this.autoDecided.add(a.id)
      if (a.kind === 'plan') this.autoApprovePlan(project.id, a.id)
      else if (a.kind === 'question' && a.taskId) {
        this.logAction(project.id, a.taskId, 'director', `Auto mode answered ${this.repo.task(a.taskId).key}'s question: use your best judgment and note the assumption.`)
        void this.resolveApproval(a.id, autoDecision('question')!).catch(() => undefined)
      } else if (a.kind === 'unverified' && a.taskId) {
        this.logAction(project.id, a.taskId, 'director', `Auto mode accepted ${this.repo.task(a.taskId).key} although not every check could run; it stays marked unverified in the result.`)
        void this.resolveApproval(a.id, autoDecision('unverified')!).catch(() => undefined)
      }
    }
  }

  /** What the director sees: capacity, per-project next work, blockers with diagnoses. Deterministic. */
  /** Everything needing you, from the live records: nothing here is remembered separately, so it can't drift. */
  decisionBoard(): BoardItem[] {
    const projects = this.repo.projects()
    const status = this.companyStatus()
    const diagnosis = new Map(status.projects.flatMap((p) => p.blocked).filter((b) => b.approvalId).map((b) => [b.approvalId!, b.diagnosis]))
    const items: BoardItem[] = []
    const covered = new Set<string>()
    for (const p of projects) {
      const tasks = this.repo.tasks(p.id)
      for (const a of this.repo.pendingApprovals(p.id)) {
        covered.add(a.id)
        const task = a.taskId ? (tasks.find((t) => t.id === a.taskId) ?? null) : null
        const waiter = this.permissionWaiters.get(a.id) ?? this.questionWaiters.get(a.id)
        const live = a.kind === 'permission' || (a.kind === 'question' && NATIVE_QUESTION.test(a.title)) ? !!waiter : null
        const run = waiter ? this.repo.run(waiter.runId) : null
        items.push({
          type: 'decision',
          id: a.id,
          approval: a,
          projectName: p.name,
          employeeId: task?.assigneeId ?? (a.kind === 'plan' ? this.byRole('pm', p.id).id : (run?.employeeId ?? null)),
          task: task && { id: task.id, key: task.key, title: task.title, status: task.status, assigneeId: task.assigneeId, lastError: task.lastError, recovery: task.recovery },
          live,
          impact: impactOf(a, tasks, live),
          run: run && { id: run.id, sessionId: run.sessionId, cwd: run.cwd },
          diagnosis: diagnosis.get(a.id) ?? null
        })
      }
    }
    for (const n of this.repo.openNotifications()) {
      if ((n.approvalId && covered.has(n.approvalId)) || n.category === 'approval' || n.category === 'question' || n.category === 'blocked' || n.category === 'interrupted') continue
      items.push({ type: 'notice', id: `notice:${n.id}`, notification: n, projectName: projects.find((p) => p.id === n.projectId)?.name ?? null })
    }
    for (const m of this.repo.messagesWithStatus('clarify')) {
      const later = this.repo.messages(m.projectId).some((x) => x.role === 'user' && x.createdAt > m.createdAt)
      if (later || Date.now() - m.createdAt > 86_400_000) continue
      items.push({ type: 'clarify', id: `clarify:${m.id}`, projectId: m.projectId, projectName: projects.find((p) => p.id === m.projectId)?.name ?? 'Project', text: m.text, at: m.createdAt })
    }
    return rankBoard(items)
  }

  companyStatus(): CompanyStatus {
    const settings = this.repo.settings()
    const limit = Math.min(Math.max(1, settings.maxParallel), CPU_BUDGET)
    const projects = this.repo.projects().sort((a, b) => b.priority - a.priority)
    let decisions = 0
    const tried = new Set(this.repo.meta<string[]>('director-auto') ?? [])
    const out = projects.map((p) => {
      const tasks = this.repo.tasks(p.id)
      const byId = new Map(tasks.map((t) => [t.id, t]))
      const approvals = this.repo.pendingApprovals(p.id)
      decisions += approvals.length
      const spec = this.repo.productSpec(p.id)
      const ms = spec ? currentMilestone(spec, tasks) : null
      const running = tasks.filter((t) => t.status === 'running' || t.status === 'merging').map((t) => ({ taskKey: t.key, title: t.title, employeeId: t.assigneeId }))
      const ranks = criticalRanks(tasks)
      const next = tasks
        .filter((t) => isReady(t, byId) && (ms === null || t.milestone === null || t.milestone <= ms))
        .sort((a, b) => ranks.get(b.id)! + b.priority * 100 - (ranks.get(a.id)! + a.priority * 100))
        .slice(0, 3)
        .map((t) => ({ taskKey: t.key, title: t.title, employeeId: t.assigneeId, why: `${(ranks.get(t.id) ?? 0) > 1 ? 'on the critical path' : 'ready'}${t.priority > 0 ? ', high priority' : ''}` }))
      const blocked = [
        ...approvals.filter((a) => a.kind === 'task_failed' || a.kind === 'unverified').map((a) => {
          const t = a.taskId ? byId.get(a.taskId) ?? null : null
          let d = diagnose(t ?? { status: 'failed', lastError: a.body, repairStop: null }, a)
          if (d.autoAction && t && tried.has(blockerKey(t.id, d))) {
            d = { ...d, autoAction: null, reason: `${d.reason} The director already tried this once on the same evidence, so it now needs you.`, recommendation: d.recommendation ?? 'Retry if the cause is gone, or skip the task.' }
          }
          return { taskKey: t?.key ?? null, diagnosis: { ...d, summary: this.human(p.id, d.summary), reason: this.human(p.id, d.reason) }, approvalId: a.id }
        })
      ]
      const spentUsd = this.spent(p.id)
      const note = p.paused
        ? 'Paused by you.'
        : p.phase === 'executing'
            ? running.length
              ? `${plural(running.length, 'task')} running${next.length ? `; ${next.length} ready for the next free slot` : ''}.`
              : next.length
                ? 'Ready work is waiting for a free slot or its owner.'
                : ms
                  ? `Waiting for milestone ${ms} to finish verification.`
                  : 'Waiting on dependencies.'
            : p.phase === 'blocked'
              ? 'Blocked: see the diagnosis.'
              : p.phase === 'awaiting_plan_approval'
                ? 'Plan ready: waiting for your approval.'
                : p.phase === 'planning'
                  ? 'Planning in progress.'
                  : p.phase === 'completed'
                    ? 'Delivered.'
                    : 'Not started.'
      return {
        id: p.id,
        name: p.name,
        phase: p.phase,
        priority: p.priority,
        paused: p.paused,
        budgetUsd: p.budgetUsd,
        spentUsd,
        running,
        next,
        blocked,
        milestone: spec && ms ? { n: ms, of: spec.milestones.length, title: spec.milestones.find((m) => m.n === ms)?.title ?? '' } : null,
        note
      }
    })
    return { capacity: { running: [...this.active.values()].filter((a) => a.run.kind === 'task').length, limit }, projects: out, decisions }
  }

  // ── conversation ─────────────────────────────────────────────

  private emitMessage(m: Message): Message {
    this.emit({ type: 'message', message: m })
    return m
  }

  /**
   * Everything typed in the Composer arrives here and goes to the flow that already handles it:
   * a new request (planned when needed), a scoped change, a note for unstarted tasks, a plan revision,
   * or a read-only question. The literal text is recorded so the conversation shows what you sent.
   */
  async sendMessage(input: SendMessageInput): Promise<Message> {
    const projectId = input.projectId!
    const project = this.repo.project(projectId)
    const text = input.text.trim()
    if (!text) throw new Error('Write a message first')
    for (const a of input.attachments) if (!/^\.autopia\/(attachments|screenshots)\/[\w.-]+$/.test(a)) throw new Error('Unknown attachment')
    // a preview capture on a change request goes through the existing screenshot path (copied for the agent)
    const capture = input.intent === 'change' ? (input.attachments.find((a) => a.startsWith('.autopia/screenshots/')) ?? null) : null
    const files = input.attachments.filter((a) => a !== capture)
    const withFiles = files.length ? `${text}\n\nAttached (read these files): ${files.join(', ')}` : text
    const direct = text.startsWith('/') ? directCommand(text, /^\/claude\s/.test(text) ? [] : (await this.claudeCapabilities(projectId)).commands.map((c) => c.name)) : null
    const wish = input.intent === 'ask' || direct ? null : preferenceIn(text) ?? decisionIn(text)
    const kept = wish ? await this.memory.rememberSaid(project, text).catch(() => null) : null
    const keptNote = kept && `Noted${kept.replaced.length ? `, in place of “${kept.replaced[0].slice(0, 60).replace(/[.!]$/, '')}”${kept.replaced.length > 1 ? ` and ${kept.replaced.length - 1} more` : ''}` : ''}. Everyone on this project goes by this from now on. If I've misread you, say so, or change it in Memory.`
    const mine = this.emitMessage(
      this.repo.addMessage({ projectId, role: 'user', intent: input.intent, text, attachments: input.attachments, employeeId: input.employeeId, taskId: input.taskId, deliveryId: input.deliveryId, runId: null, status: 'sent', error: null })
    )
    if (direct) {
      void this.directTurn(project, mine, direct.prompt, input.employeeId)
      return mine
    }
    // only a standing wish, with nothing in progress: it's kept, and nobody needs to go to work over it
    // the same for a decision you're only telling the team about ("we decided…"), not asking anyone to act on
    const onlySaying = wish === text && (preferenceIn(text) === text || /^(we|i)('ve| have)? decided\b|^(my |our )?decision\s*:/i.test(text))
    if (keptNote && !(onlySaying && !files.length && input.intent !== 'build' && input.intent !== 'plan' && input.intent !== 'reply' && !this.repo.openDelivery(projectId))) this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'note', text: keptNote, attachments: [], employeeId: this.byRole('pm', projectId).id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
    if (onlySaying && !files.length && input.intent !== 'build' && input.intent !== 'plan' && input.intent !== 'reply' && !this.repo.openDelivery(projectId)) {
      this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'note', text: kept?.replaced.length ? `${keptNote} Nothing else changes: ask if existing work should be updated too.` : 'Noted. Everyone on this project follows that from now on. Nothing else changes: ask if existing work should be updated too.', attachments: [], employeeId: this.byRole('pm', projectId).id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
      return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'applied' }))
    }
    // the front desk and the dog answer when they're the ones spoken to; neither takes on work
    const folk = this.folkFor(project, text, input)
    if (folk === 'dog') return this.bark(project, mine, text)
    if (folk === 'desk') {
      void this.talk(project, mine, withFiles, input, false, true)
      return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'working' }))
    }
    // one input: decided here, not by a mode. An explicit plan, plan feedback and a change on a chosen result stand as they are
    // pressing Start is a decision, and so is describing what an empty project should become: neither is left to a guess at the wording
    const startsIt = (input.intent === 'build' && input.instruction === true) || (!this.repo.tasks(projectId).length && !sourceFileCount(project.path) && !input.employeeId && describesAProduct(text))
    if (startsIt) input = { ...input, intent: 'build' }
    const stated = startsIt || input.intent === 'plan' || (input.intent === 'reply' && !looksLikeQuestion(text)) || !!capture || !!input.deliveryId || (input.instruction === true && !!input.taskId)
    try {
      if (!stated) {
        const open = this.repo.tasks(projectId).filter((t) => ['pending', 'running', 'interrupted', 'failed'].includes(t.status))
        const command = files.length || !open.length ? null : parseCommand(text, open, this.team(projectId))
        if (command) return await this.runCommand(project, mine, command)
        const reading = understand(text)
        if (reading === 'status' && !files.length) {
          const team = this.team(projectId)
          const who = pickResponder({ text, employeeId: input.employeeId, taskId: input.taskId, team, tasks: [], recent: [], now: Date.now() })
          this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'ask', text: statusReply({ project, tasks: this.repo.tasks(projectId), approvals: this.repo.pendingApprovals(projectId), employees: team, statuses: [...this.statuses.values()].filter((st) => st.projectId === projectId), previewable: hasPage(detectPreview(project)), previewRunning: false }), attachments: [], employeeId: who.id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
          return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'answered' }))
        }
        if (reading === 'talk' || input.intent === 'ask') {
          void this.talk(project, mine, withFiles, input)
          return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'working' }))
        }
      }
      switch (input.intent) {
        case 'ask':
          void this.talk(project, mine, withFiles, input)
          return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'working' }))
        case 'build':
        case 'plan': {
          if (project.phase === 'planning' || (project.phase === 'executing' && this.repo.openDelivery(projectId))) throw new Error('The team is still working on the current request. Send this as a note, or wait until it is ready to review.')
          // you accepted a result while its last checks wrapped up: nothing's left in progress
          if (project.phase === 'executing') this.setPhase(project, 'completed', { lastError: null })
          this.repo.updateProject(projectId, { goal: withFiles })
          await this.kickoff(projectId, input.intent === 'plan' ? 'plan' : 'auto')
          const d = this.repo.openDelivery(projectId)
          return this.emitMessage(this.repo.updateMessage(mine.id, { deliveryId: d?.id ?? null }))
        }
        case 'change': {
          const d = await this.requestRevision(projectId, { deliveryId: input.deliveryId, text: withFiles, screenshot: capture, taskId: input.taskId, employeeId: input.employeeId })
          return this.emitMessage(this.repo.updateMessage(mine.id, { deliveryId: d.id }))
        }
        case 'note': {
          // "skip the about page", "do the footer first": Autopia does these itself, no session involved
          const open = this.repo.tasks(projectId).filter((t) => ['pending', 'running', 'interrupted', 'failed'].includes(t.status))
          const command = files.length ? null : parseCommand(text, open, this.team(projectId))
          if (command) return await this.runCommand(project, mine, command)
          const fate = await this.productFeedback(projectId, withFiles)
          if (fate === 'queued') this.routeNote(project, mine, withFiles, input.taskId, input.employeeId)
          // a note never goes unanswered: the PM confirms it and says where the work stands (no AI call)
          const pm = this.byRole('pm', projectId)
          const ack = noteReply({
            project,
            tasks: this.repo.tasks(projectId),
            approvals: this.repo.pendingApprovals(projectId),
            employees: this.team(projectId),
            statuses: [...this.statuses.values()].filter((st) => st.projectId === projectId),
            previewable: hasPage(detectPreview(project)),
            previewRunning: false
          }, this.repo.message(mine.id).routing?.targets.map((t) => t.name))
          this.emitMessage(this.repo.addMessage({ projectId, role: 'autopia', intent: 'note', text: ack, attachments: [], employeeId: pm.id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
          return mine
        }
        case 'reply': {
          const plan = this.repo.pendingApprovals(projectId).find((a) => a.kind === 'plan')
          if (!plan) throw new Error('There is no plan waiting for changes')
          await this.resolveApproval(plan.id, { kind: 'plan', action: 'revise', feedback: withFiles })
          return mine
        }
      }
    } catch (err) {
      this.emitMessage(this.repo.updateMessage(mine.id, { status: 'failed', error: (err as Error).message }))
      throw err
    }
  }

  /** Stop an answer that is still being written (its read-only session ends; nothing was changed). */
  stopMessage(messageId: string): void {
    const m = this.repo.messages(this.repo.messageProject(messageId)).find((x) => x.id === messageId)
    if (!m || m.status !== 'working') return
    const a = m.runId ? this.active.get(m.runId) : null
    if (a) {
      a.cancelled = true
      a.handle?.cancel()
    }
    this.emitMessage(this.repo.updateMessage(messageId, { status: 'failed', error: 'Stopped by you' }))
    const asked = this.askedBefore(m)
    if (asked) this.emitMessage(this.repo.updateMessage(asked.id, { status: 'failed', error: 'Stopped by you' }))
  }

  /** The message a reply is answering, if it's still waiting on that reply. */
  private askedBefore(reply: Message): Message | null {
    const all = this.repo.messages(reply.projectId)
    const mine = all.slice(0, all.findIndex((x) => x.id === reply.id)).reverse().find((x) => x.role === 'user')
    return mine && (mine.status === 'sent' || mine.status === 'working') ? mine : null
  }

  // ── steering: your messages reach sessions that are already running ──

  /** Kept in meta so a restart never loses them. */
  private steerQueue(): SteerQueue {
    return this.repo.meta<SteerQueue>('steer') ?? {}
  }

  private queueSteer(taskId: string, item: SteerItem): void {
    this.repo.setMeta('steer', enqueue(this.steerQueue(), taskId, item))
  }

  /** How far one message got with one teammate; the message's own state follows from all of them. */
  private markSteer(messageId: string, taskId: string, state: NonNullable<Message['routing']>['targets'][number]['state']): void {
    const m = this.repo.message(messageId)
    if (!m.routing) return
    const routing = { targets: m.routing.targets.map((t) => (t.taskId === taskId ? { ...t, state } : t)) }
    this.emitMessage(this.repo.updateMessage(messageId, { routing, status: routingStatus(routing) }))
  }

  /**
   * Hands a task whatever's waiting for it, if its session can take it right now: not while it waits on a
   * permission answer. What isn't echoed back by the end of the turn goes in when the turn ends instead.
   */
  private flushSteer(taskId: string | null, fresh = false): void {
    if (!taskId) return
    const items = this.steerQueue()[taskId]
    const entry = [...this.active.values()].find((a) => a.run.taskId === taskId && a.handle)
    if (!items?.length || !entry) return
    const next = items.map((m) => {
      const item = fresh ? { ...m, sent: false } : m
      if (item.delivered) return item
      if (item.viaPrompt) {
        this.markSteer(item.messageId, taskId, 'delivered')
        return { ...item, delivered: true }
      }
      if (item.sent || entry.waiting > 0) return item
      return { ...item, sent: entry.handle!.send(steerNowPrompt(item.text)) }
    })
    this.repo.setMeta('steer', { ...this.steerQueue(), [taskId]: next })
  }

  /** Claude Code echoed a message back: it's in that session's conversation now. */
  private steerEchoed(taskId: string | null, text: string): boolean {
    const items = taskId ? this.steerQueue()[taskId] : null
    const hit = items?.find((m) => m.sent && !m.delivered && text.includes(m.text.trim()))
    if (!items || !hit) return false
    this.repo.setMeta('steer', { ...this.steerQueue(), [taskId!]: items.map((m) => (m === hit ? { ...m, delivered: true } : m)) })
    this.markSteer(hit.messageId, taskId!, 'delivered')
    return true
  }

  /** Sends an instruction only where it matters: unaffected teammates keep working, undisturbed. */
  private routeNote(project: Project, mine: Message, text: string, onlyTaskId: string | null, onlyEmployeeId: string | null): void {
    const d = this.repo.openDelivery(project.id)
    const tasks = this.repo.tasks(project.id).filter((t) => !d || t.deliveryId === d.id)
    const plan = planRouting({
      text,
      running: tasks.filter((t) => ['running', 'interrupted', 'failed'].includes(t.status)),
      upcoming: tasks.filter((t) => t.status === 'pending'),
      finished: tasks.filter((t) => t.status === 'done'),
      people: this.team(project.id),
      onlyTaskId,
      onlyEmployeeId
    })
    const target = (t: Task) => ({ taskId: t.id, key: t.key, name: firstName(this.employees.find((e) => e.id === t.assigneeId)?.name) ?? t.key, state: 'queued' as const })
    const routing = { targets: [...plan.reach, ...plan.upcoming].map(target) }
    for (const t of plan.reach) this.queueSteer(t.id, { messageId: mine.id, text })
    for (const t of plan.upcoming) this.queueSteer(t.id, { messageId: mine.id, text, viaPrompt: true })
    this.emitMessage(this.repo.updateMessage(mine.id, { routing, status: routingStatus(routing) }))
    // said about one piece of work: it stays with that work, not in the notes every later step reads
    if (plan.scope !== 'everyone') {
      const notes = this.repo.meta<{ at: number; text: string }[]>(`notes:${project.id}`) ?? []
      this.repo.setMeta(`notes:${project.id}`, notes.filter((n) => n.text !== text.trim().slice(0, 2000)))
    }
    if (d && plan.revisit.length) this.addFollowUp(project, d, mine.id, text, plan.revisit, plan.scope === 'everyone' ? [...plan.reach, ...plan.upcoming] : [])
    for (const t of plan.reach) this.flushSteer(t.id)
    void this.schedule()
  }

  /** Finished work an instruction changes: one new step keeps what's there and applies only that. */
  private addFollowUp(project: Project, d: Delivery, messageId: string, text: string, revisit: Task[], after: Task[]): void {
    const first = revisit[0]
    const owner = this.team(project.id).find((e) => e.id === first.assigneeId)
    if (!owner) return
    const t = this.repo.insertTask(project.id, {
      key: this.nextKey(project.id),
      title: `Update ${first.title}`.slice(0, 80),
      description: `This is already built: ${revisit.map((x) => `${x.key} "${x.title}"`).join(', ')}. The person you are building it for then sent this:\n\n${text}\n\nChange only what this needs and keep everything else as it is.`,
      acceptance: 'What was asked is true of the finished work, and nothing else about it changed.',
      kind: first.kind,
      assigneeId: first.assigneeId,
      dependsOnKeys: [],
      rationale: `${owner.name} built this, and your message changes it.`,
      size: 's',
      files: [...new Set(revisit.flatMap((x) => x.changedFiles.map((c) => c.replace(/^\S+\s+/, ''))))],
      validation: [],
      skills: first.skills,
      milestone: null
    })
    for (const a of after) this.repo.addDependency(t.id, a.id)
    const task = this.repo.updateTask(t.id, { deliveryId: d.id })
    this.queueSteer(task.id, { messageId, text, viaPrompt: true })
    const m = this.repo.message(messageId)
    const routing = { targets: [...(m.routing?.targets ?? []), { taskId: task.id, key: task.key, name: firstName(owner.name) ?? task.key, state: 'queued' as const }] }
    this.emitMessage(this.repo.updateMessage(messageId, { routing, status: routingStatus(routing) }))
    this.emit({ type: 'task', task: this.repo.task(task.id) })
    if (d.status !== 'implementing') this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'implementing', completedAt: null }))
    this.logAction(project.id, task.id, 'route', `Your message changes finished work: ${owner.name} picks it up in ${task.key}.`)
    if (this.repo.project(project.id).phase !== 'executing') this.setPhase(this.repo.project(project.id), 'executing', { lastError: null })
  }

  /** Carries out a direct instruction and says exactly what happened, from what really changed. */
  private async runCommand(project: Project, mine: Message, c: SteerCommand<Task>): Promise<Message> {
    const quote = (t: Task) => `${t.key} “${t.title}”`
    const reply = (text: string, status: Message['status']) => {
      this.emitMessage(this.repo.addMessage({ projectId: project.id, role: 'autopia', intent: 'note', text, attachments: [], employeeId: this.byRole('pm', project.id).id, taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
      return this.emitMessage(this.repo.updateMessage(mine.id, { status }))
    }
    const tasks = this.repo.tasks(project.id)
    if (c.kind === 'clarify') {
      const options = c.candidates.slice(0, 4).map(quote)
      return reply(`Which one should I ${c.verb}: ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}? Nothing changed yet.`, 'clarify')
    }
    if (c.kind === 'cancel') {
      const t = c.task
      if (t.status === 'running') {
        // no session yet (or between turns): it stops at the next point it would carry on from
        this.calledOff.add(t.id)
        await this.cancelTask(t.id)
        return reply(`Stopping ${quote(t)}. Finished steps stay as they are, and everyone else keeps working.`, 'applied')
      }
      const decision = this.repo.pendingApprovals(project.id).find((a) => a.taskId === t.id && a.kind === 'task_failed')
      if (decision) await this.resolveApproval(decision.id, { kind: 'task_failed', action: 'skip' })
      else {
        this.transitionTask(t, 'cancelled', { lastError: 'Cancelled by you', finishedAt: Date.now() })
        void this.schedule()
      }
      this.logAction(project.id, t.id, 'route', `You cancelled ${t.key}.`)
      return reply(`Cancelled ${quote(t)}. It won’t start, and everyone else keeps working.`, 'applied')
    }
    if (c.kind === 'prioritize') {
      const t = c.task
      if (t.status !== 'pending') return reply(`${quote(t)} is already being worked on.`, 'applied')
      this.setTaskPriority(t.id, 1)
      const blockers = t.dependsOn.map((id) => tasks.find((x) => x.id === id)).filter((x): x is Task => !!x && x.status !== 'done' && x.status !== 'cancelled')
      void this.schedule()
      return reply(`${quote(t)} is next in line${blockers.length ? `, right after ${blockers.map((b) => b.key).join(', ')}, which it needs` : ''}. Nobody already working is interrupted.`, 'applied')
    }
    if (c.kind === 'order') {
      if (c.then.status !== 'pending') return reply(`${quote(c.then)} has already started, so it can’t wait for ${c.first.key} now.`, 'clarify')
      if (wouldCycle(tasks, c.then.id, c.first.id)) return reply(`${quote(c.first)} already needs ${quote(c.then)}, so it can’t go first. Nothing changed.`, 'clarify')
      this.repo.addDependency(c.then.id, c.first.id)
      this.emit({ type: 'task', task: this.repo.task(c.then.id) })
      this.logAction(project.id, c.then.id, 'route', `You put ${c.first.key} before ${c.then.key}.`)
      void this.schedule()
      return reply(`${quote(c.then)} now waits for ${quote(c.first)}.`, 'applied')
    }
    try {
      this.reassign(c.task.id, c.employee.id)
      return reply(`${firstName(c.employee.name)} now owns ${quote(c.task)}.`, 'applied')
    } catch (err) {
      return reply(`${(err as Error).message}. Nothing changed.`, 'clarify')
    }
  }

  /** Everything you sent for this task since its last step (and forget it, so it applies once). */
  private takeSteer(taskId: string): SteerItem[] {
    const { items, rest } = take(this.steerQueue(), taskId)
    if (items.length) this.repo.setMeta('steer', rest)
    return items
  }

  /** What the code and past decisions say about a plan that's waiting for your OK. */
  async planRisks(projectId: string): Promise<string[]> {
    const project = this.repo.project(projectId)
    await this.memory.refresh(project).catch(() => undefined)
    return this.memory.planRisks(project.id, this.repo.tasks(projectId).filter((t) => t.status === 'proposed'))
  }

  /** One bounded look at the real screenshots: against the direction a new product promised, or at what an existing one was asked to change. */
  async designReview(project: Project, d: Delivery, shots: string[]): Promise<DesignGap[]> {
    const direction = EXPERTISE_ON ? this.repo.productSpec(project.id)?.direction : null
    const claude = this.getClaude()
    if (!EXPERTISE_ON || !claude.available || !claude.path) return []
    // the widest and narrowest first, then other pages: the pictures go in the message, so seeing them never stops for a permission
    const images = [...new Set(shots)].slice(0, 4).map((s) => join(project.path, s)).filter((f) => existsSync(f))
    if (!images.length) return []
    const designer = this.team(project.id).find((e) => e.kinds.includes('design')) ?? this.byRole('pm', project.id)
    const model = this.pickModel(this.repo.settings(), 'qa', {})
    const run = this.repo.createRun({ projectId: project.id, taskId: null, employeeId: designer.id, kind: 'ask', cwd: project.path, model: model || null, purpose: 'ask' })
    const release = this.setStatusBusy(designer.id, project.id, run.id)
    try {
      const finished = this.repo.productSpec(project.id)?.completeness
      const text = !direction ? null : `${direction.personality} Concept: ${direction.concept}\nExcellent means: ${direction.standards.join('; ')}\nMust not become: ${direction.avoid.join('; ')}${finished ? `\nComplete means: ${finished.essentials.join('; ')}\nShared facts: ${finished.content}` : ''}`
      const outcome = await this.execute(run, { cwd: project.path, prompt: designReviewPrompt({ direction: text, asked: d.request, type: environmentOf(project.path).type }), attachments: images, systemPrompt: `You are ${designer.name}, reviewing real screenshots of the product you helped make. You only read.`, effort: 'medium', model, sessionId: randomUUID(), resume: false, ephemeral: true, jsonSchema: DESIGN_REVIEW_SCHEMA, mode: 'readonly', permissionProfile: this.repo.settings().permissionProfile }, claude.path, designer.id)
      const out = outcome.structured as { distinctive: boolean; generic: string[]; gaps: DesignGap[] } | null
      if (!outcome.ok || !out) return []
      // not being able to see the pictures says nothing about the product: it's never a defect to send anyone to fix
      const blind = /\b(screenshots?|images?|pictures?)\b.*\b(read|open|view|access|declin\w*|denied|see)\b|\b(could ?n.?t|could not|cannot|can.?t|unable to)\b.*\b(read|open|view|see)\b.*\b(screenshots?|images?)\b/i
      const seen = out.gaps.filter((g) => !blind.test(g.message))
      if (seen.length < out.gaps.length || (!out.gaps.length && out.generic.some((g) => blind.test(g)))) {
        this.emitDelivery(this.repo.updateDelivery(d.id, { limitations: [...this.repo.delivery(d.id).limitations, 'The creative review didn’t run: its screenshots couldn’t be opened.'] }))
        return []
      }
      this.repo.setMeta(`design-review:${d.id}`, { ...out, saw: images.length })
      this.logAction(project.id, null, 'route', `Creative review of result #${d.number}: ${out.gaps.length ? `${plural(out.gaps.length, 'gap')}, ${out.gaps.filter((g) => g.severity === 'high').length} serious` : 'no gaps'}${out.distinctive ? '' : '; reads as generic'}.`)
      const notes = [...out.gaps.filter((g) => g.severity === 'medium').map((g) => `Creative review: ${g.message}`), ...(out.distinctive || !direction ? [] : out.generic.slice(0, 2).map((g) => `Reads as generic: ${g}`))].slice(0, 3)
      if (notes.length) this.emitDelivery(this.repo.updateDelivery(d.id, { limitations: [...this.repo.delivery(d.id).limitations.filter((l) => !/^(Creative review|Reads as generic):/.test(l)), ...notes] }))
      return out.gaps
    } finally {
      release()
    }
  }

  private setStatusBusy(employeeId: string, projectId: string, runId: string): () => void {
    const prev = this.statuses.get(employeeId)
    const idle = !prev || prev.activity === 'idle'
    if (idle) this.setStatus(employeeId, { activity: 'reviewing', projectId, taskId: null, runId, detail: 'Reviewing how it looks', reason: 'Creative review' })
    return () => {
      if (idle && this.statuses.get(employeeId)?.runId === runId) this.setStatus(employeeId, this.blankStatus(employeeId))
    }
  }

  /** A project just created or opened: its code map starts now, in the background. */
  warmCodeMap(project: Project): void {
    // the parser's first load is heavy: it waits until the new product has opened on screen
    setTimeout(() => void this.memory.refresh(project).catch(() => undefined), 2000)
  }

  /** Who is on what, from the records, so an answer about ongoing work doesn't have to guess. */
  private workRightNow(projectId: string): string {
    const open = this.repo.tasks(projectId).filter((t) => ['running', 'merging', 'pending'].includes(t.status))
    if (!open.length) return ''
    const who = (t: Task) => firstName(this.employees.find((e) => e.id === t.assigneeId)?.name) ?? 'A teammate'
    return ['The team right now (their changes are in their own working copies until merged):', ...open.map((t) => `- ${t.key} "${t.title}": ${who(t)}, ${t.status}`)].join('\n')
  }

  /**
   * One Claude Code call, as the chosen teammate: it answers and decides what the message means. Reads the
   * project only when the message could be about it. Real work starts only from a clear, stated action.
   */
  /** Who a message is for, if it's the front desk or the dog: said to them, or a small reply to what they just said. */
  private folkFor(project: Project, text: string, input: Pick<SendMessageInput, 'employeeId' | 'intent' | 'attachments' | 'instruction'>): Folk | null {
    if (input.intent === 'plan' || input.intent === 'reply' || input.instruction || input.attachments.length) return null
    const team = this.team(project.id)
    const said = folkAddressed({ text, employeeId: input.employeeId, office: project.officeType, team })
    if (said || input.employeeId) return said
    const last = [...this.repo.messages(project.id)].reverse().find((m) => m.role === 'autopia' && m.text.trim())
    const namesSomeone = team.some((p) => plainWords(text).includes(plainWords(p.name)[0]))
    const going = last && Date.now() - last.createdAt < 15 * 60_000 && isCasual(text) && understand(text) === 'talk' && !namesSomeone
    return going ? folkById(last.employeeId, project.officeType) : null
  }

  /** The dog answers in the only language the dog has. No session and no tokens. Nothing is ever started by this. */
  private bark(project: Project, mine: Message, text: string): Message {
    const turn = this.repo.messages(project.id).filter((m) => m.employeeId === 'office:corgi').length
    this.emitMessage(this.repo.addMessage({ projectId: project.id, role: 'autopia', intent: 'ask', text: barkReply(text, turn), attachments: [], employeeId: 'office:corgi', taskId: null, deliveryId: null, runId: null, status: 'answered', error: null }))
    return this.emitMessage(this.repo.updateMessage(mine.id, { status: 'answered' }))
  }

  private async talk(project: Project, mine: Message, text: string, input: Pick<SendMessageInput, 'employeeId' | 'taskId'>, handedOff = false, atDesk = false): Promise<void> {
    const claude = this.getClaude()
    const team = this.team(project.id)
    const history = this.repo.messages(project.id).filter((m) => m.id !== mine.id && m.text.trim())
    const tasks = this.repo.tasks(project.id)
    const desk = frontDeskOf(project.officeType)
    // the front desk isn't on the team, so its session is recorded under the team's lead, and only the words are theirs
    const pm = this.byRole('pm', project.id)
    const persona: Employee | null = atDesk ? { ...pm, id: desk.id, name: desk.name, title: desk.role, bio: 'You run the front desk of this office and know what is going on, but you do not build or change anything yourself.' } : null
    const who = persona ?? team.find((e) => e.id === pickResponder({ text, employeeId: input.employeeId, taskId: input.taskId, team, tasks, recent: history.slice(-6), now: Date.now() }).id) ?? this.byRole('pm', project.id)
    const reply = this.emitMessage(this.repo.addMessage({ projectId: project.id, role: 'autopia', intent: 'ask', text: '', attachments: [], employeeId: who.id, taskId: mine.taskId, deliveryId: null, runId: null, status: 'working', error: null }))
    const fail = (error: string) => {
      this.emitMessage(this.repo.updateMessage(reply.id, { status: 'failed', error }))
      this.emitMessage(this.repo.updateMessage(mine.id, { status: 'failed', error }))
    }
    if (!claude.available || !claude.path) {
      // no Claude Code to think with: a greeting can still be answered from the records
      if (!isSmallTalk(text)) return fail(claude.error ?? 'Claude Code is not available')
      this.emitMessage(this.repo.updateMessage(reply.id, { status: 'answered', text: quickReply(text, { tasks, employees: team, review: this.repo.openDelivery(project.id)?.status === 'review' ? this.repo.openDelivery(project.id)!.number : null }) }))
      return void this.emitMessage(this.repo.updateMessage(mine.id, { status: 'answered' }))
    }
    const casual = isCasual(text)
    const greeting = isSmallTalk(text) && text.trim().split(/\s+/).length > 1 || /^(hi+|hey+|hello+|thanks?|thx|ty|ok(ay)?|cool|nice|great|bye|שלום|היי|תודה)[\s!.,?…]*$/iu.test(text.trim())
    const task = input.taskId ? tasks.find((t) => t.id === input.taskId) ?? null : null
    const pack = casual ? { text: '', ids: [] as string[], chars: 0 } : await this.memory.retrieve(project, { purpose: 'task', text, files: task?.files ?? [] }).catch(() => ({ text: '', ids: [] as string[], chars: 0 }))
    const allowed = claude.allowedModels
    const pick = (m: string) => (!allowed || allowed.includes(m) ? m : '')
    // talk is light; working something out in the code isn't, and that gets the same model the work does
    const deep = !casual && /\b(why|debug|root cause|architecture|refactor|race|deadlock|trade-?offs?|review|how (does|should|would|could))\b/i.test(text)
    const model = deep ? pick('opus') || pick('sonnet') : pick('haiku') || pick('sonnet')
    const sessionOwner = persona ? pm.id : who.id
    const run = this.repo.createRun({ projectId: project.id, taskId: null, employeeId: sessionOwner, kind: 'ask', cwd: project.path, model: model || null, purpose: 'ask' })
    this.repo.updateRun(run.id, { contextIds: pack.ids, contextChars: pack.chars })
    this.emitMessage(this.repo.updateMessage(reply.id, { runId: run.id }))
    this.emit({ type: 'run', run: this.repo.run(run.id) })
    const prev = this.statuses.get(sessionOwner)
    const idle = !persona && (!prev || prev.activity === 'idle')
    if (idle) this.setStatus(who.id, { activity: 'reviewing', projectId: project.id, taskId: null, runId: run.id, detail: 'Replying to you', reason: 'You sent a message' })
    const name = (id: string | null) => firstName(team.find((e) => e.id === id)?.name) ?? (id === desk.id ? desk.name : id === 'office:corgi' ? 'Puffy' : 'Teammate')
    const conversation = history.slice(-14).map((m) => `${m.role === 'user' ? 'You' : name(m.employeeId)}: ${m.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    try {
      const outcome = await this.execute(
        run,
        {
          cwd: project.path,
          prompt: [
            project.contextSummary && !casual ? `What we know about this repository: ${project.contextSummary}` : '',
            task ? `They are asking about ${task.key} "${task.title}": ${task.resultSummary ?? task.description}` : '',
            this.workRightNow(project.id) || 'Nobody is working on anything right now.',
            pack.text,
            conversation.length ? `The conversation so far:\n${conversation.join('\n')}` : '',
            `Their new message:\n${text}`
          ]
            .filter(Boolean)
            .join('\n\n'),
          systemPrompt: `${talkSystemPrompt(who, project.name, team, voicePrompt(who), casual, project.officeType, greeting)}${persona ? '\n\nYou are not one of the people who build this. If they want something built or changed, say you will pass it on to the team. Puffy is the office corgi.' : ''}`,
          settingSources: casual ? '' : this.skills.scope === 'routed' ? 'project,local' : undefined,
          effort: 'low',
          model,
          sessionId: randomUUID(),
          resume: false,
          ephemeral: true,
          // a greeting has nothing to decide, so it skips structured output: that's what makes it quick
          ...(greeting ? {} : { jsonSchema: TALK_SCHEMA }),
          mode: casual ? 'chat' : 'readonly',
          permissionProfile: this.repo.settings().permissionProfile,
          attachments: mine.attachments.map((a) => join(project.path, a))
        },
        claude.path,
        sessionOwner
      )
      const said = greeting ? parseTalk({ reply: outcome.text ?? '', action: 'none', request: null, handoff: null }) : parseTalk(outcome.structured)
      if (!outcome.ok || !said) return fail(outcome.cancelled ? 'Stopped before answering' : outcome.error ?? 'No answer came back')
      this.emitMessage(this.repo.updateMessage(reply.id, { status: 'answered', text: said.reply }))
      const next = said.handoff && !handedOff ? team.find((e) => e.id !== who.id && firstName(e.name)?.toLowerCase() === said.handoff!.split(' ')[0].toLowerCase()) : null
      if (next) return await this.talk(project, mine, text, { employeeId: next.id, taskId: input.taskId }, true)
      await this.actOn(project, mine, said, text)
    } catch (err) {
      fail((err as Error).message)
    } finally {
      if (idle && this.statuses.get(who.id)?.runId === run.id) this.setStatus(who.id, this.blankStatus(who.id))
    }
  }

  /** What Claude Code offers in this project, from Claude Code itself. Skills and servers can change, so it's kept briefly. */
  async claudeCapabilities(projectId: string, fresh = false): Promise<ClaudeCapabilities> {
    const claude = this.getClaude()
    if (!claude.available || !claude.path) return NO_CAPABILITIES
    const held = this.capabilityCache.get(projectId)
    if (!fresh && held && Date.now() - held.at < 5 * 60_000) return held.caps
    const caps = await discoverCapabilities(claude.path, this.repo.project(projectId).path).catch(() => NO_CAPABILITIES)
    const full = { ...caps, version: claude.version ?? caps.version }
    if (caps.commands.length) this.capabilityCache.set(projectId, { at: Date.now(), caps: full })
    return full
  }

  /** For Settings: what Claude Code offers in a product, or in general with none open. */
  async claudeOverview(projectId: string | null, fresh = false): Promise<ClaudeCapabilities> {
    if (projectId) return this.claudeCapabilities(projectId, fresh)
    const claude = this.getClaude()
    if (!claude.available || !claude.path) return NO_CAPABILITIES
    const held = this.capabilityCache.get('')
    if (!fresh && held && Date.now() - held.at < 5 * 60_000) return held.caps
    mkdirSync(this.worktreeRoot, { recursive: true })
    const caps = await discoverCapabilities(claude.path, this.worktreeRoot).catch(() => NO_CAPABILITIES)
    const full = { ...caps, version: claude.version ?? caps.version }
    if (caps.commands.length) this.capabilityCache.set('', { at: Date.now(), caps: full })
    return full
  }

  /** Online, so it's asked apart from the model list and never holds it up. Once an hour is plenty. */
  private latestVersion: { at: number; version: Promise<string | null> } | null = null
  claudeLatest(): Promise<string | null> {
    if (!this.latestVersion || Date.now() - this.latestVersion.at > 3_600_000) this.latestVersion = { at: Date.now(), version: latestClaudeVersion() }
    return this.latestVersion.version
  }

  async updateClaude(): Promise<string> {
    const claude = this.getClaude()
    if (!claude.path) throw new Error('Claude Code is not available')
    const said = await updateClaudeCode(claude.path)
    this.capabilityCache.clear()
    return said
  }

  /**
   * Claude Code itself, through a teammate: your words as you wrote them, every tool and command it has, your settings,
   * and its own permission prompts. The conversation continues in the same session each time you talk to this person.
   */
  private async directTurn(project: Project, mine: Message, prompt: string, employeeId: string | null): Promise<void> {
    const claude = this.getClaude()
    const team = this.team(project.id)
    const who = team.find((e) => e.id === employeeId) ?? team.find((e) => e.role === 'lead_dev') ?? this.byRole('pm', project.id)
    const reply = this.emitMessage(this.repo.addMessage({ projectId: project.id, role: 'autopia', intent: 'ask', text: '', attachments: [], employeeId: who.id, taskId: mine.taskId, deliveryId: null, runId: null, status: 'working', error: null }))
    const fail = (error: string) => {
      this.emitMessage(this.repo.updateMessage(reply.id, { status: 'failed', error }))
      this.emitMessage(this.repo.updateMessage(mine.id, { status: 'failed', error }))
    }
    if (!claude.available || !claude.path) return fail(claude.error ?? 'Claude Code is not available')
    const claudePath = claude.path
    const settings = this.repo.settings()
    const key = `direct-session:${project.id}:${who.id}`
    const prior = this.repo.meta<string>(key)
    const prev = this.statuses.get(who.id)
    const idle = !prev || prev.activity === 'idle'
    let written = ''
    let shownAt = 0
    const attempt = async (sessionId: string, resume: boolean) => {
      const run = this.repo.createRun({ projectId: project.id, taskId: null, employeeId: who.id, kind: 'ask', cwd: project.path, model: settings.modelStrategy === 'fixed' ? settings.model || null : null, purpose: 'ask' })
      this.emitMessage(this.repo.updateMessage(reply.id, { runId: run.id }))
      this.emit({ type: 'run', run: this.repo.run(run.id) })
      if (idle) this.setStatus(who.id, { activity: 'working', projectId: project.id, taskId: null, runId: run.id, detail: 'Working in Claude Code', reason: 'You asked directly' })
      return this.execute(
        run,
        {
          cwd: project.path,
          prompt,
          systemPrompt: `You are talking directly with the person who owns this project, through Autopia. They may know you as ${who.name}.`,
          // said out loud every time: a resumed conversation otherwise stays on whatever model it began with
          model: (settings.modelStrategy === 'fixed' && settings.model) || 'default',
          sessionId,
          resume,
          mode: 'direct',
          permissionProfile: settings.permissionProfile,
          attachments: mine.attachments.map((a) => join(project.path, a)),
          onPartial: (text) => {
            written += text
            // the words as they arrive, a few times a second
            if (Date.now() - shownAt < 150 || this.repo.messages(project.id).find((m) => m.id === reply.id)?.status !== 'working') return
            shownAt = Date.now()
            this.emitMessage(this.repo.updateMessage(reply.id, { text: written }))
          }
        },
        claudePath,
        who.id
      )
    }
    try {
      let sessionId = prior ?? randomUUID()
      let outcome = await attempt(sessionId, !!prior)
      // that conversation no longer exists on this machine: start a new one rather than fail
      if (!outcome.ok && prior && /no conversation found/i.test(outcome.error ?? '')) {
        written = ''
        sessionId = randomUUID()
        outcome = await attempt(sessionId, false)
      }
      if (outcome.ok) this.repo.setMeta(key, sessionId)
      if (this.repo.messages(project.id).find((m) => m.id === reply.id)?.status !== 'working') return
      if (!outcome.ok) return fail(outcome.cancelled ? 'Stopped before finishing' : outcome.error ?? 'No answer came back')
      this.emitMessage(this.repo.updateMessage(reply.id, { status: 'answered', text: outcome.text?.trim() || written.trim() || 'Done.' }))
      this.emitMessage(this.repo.updateMessage(mine.id, { status: 'answered' }))
    } catch (err) {
      fail((err as Error).message)
    } finally {
      if (idle && this.statuses.get(who.id)?.activity === 'working') this.setStatus(who.id, this.blankStatus(who.id))
    }
  }

  /** What the conversation decided, carried out by the same machinery as everything else. */
  private async actOn(project: Project, mine: Message, said: TalkOutput, text: string): Promise<void> {
    const id = project.id
    if (said.action === 'none' || said.action === 'clarify' || !said.request) return void this.emitMessage(this.repo.updateMessage(mine.id, { status: said.action === 'clarify' ? 'clarify' : 'answered' }))
    const request = said.action === 'bug' ? `A bug was reported: ${said.request}\n\nThey said: "${text.slice(0, 600)}"\n\nFind the real cause, fix it and check that it no longer happens.` : said.request
    // something's underway: it joins the work without restarting anything
    if (this.repo.openDelivery(id) || this.repo.project(id).phase === 'planning') {
      const fate = await this.productFeedback(id, request)
      if (fate === 'queued') this.routeNote(this.repo.project(id), mine, request, mine.taskId, mine.employeeId)
      else this.emitMessage(this.repo.updateMessage(mine.id, { status: 'delivered' }))
      return
    }
    if (this.repo.deliveries(id).length) {
      const d = await this.requestRevision(id, { deliveryId: null, text: request, screenshot: null, taskId: null })
      return void this.emitMessage(this.repo.updateMessage(mine.id, { status: 'sent', deliveryId: d.id }))
    }
    this.repo.updateProject(id, { goal: request })
    await this.kickoff(id, 'auto', text)
    // the result is known by what you asked for, in your words; the expanded brief is for the team
    const opened = this.repo.openDelivery(id)
    if (opened && text.trim() && opened.request !== text) this.emitDelivery(this.repo.updateDelivery(opened.id, { request: text }))
    this.emitMessage(this.repo.updateMessage(mine.id, { status: 'sent', deliveryId: opened?.id ?? null }))
  }

  /** Set by the app: the project's own checks, which Autopia runs itself once you've OK'd them. */
  selfChecks: Pick<QualityEngine, 'selfChecks' | 'runSelfChecks' | 'askEarly' | 'askForFoundation'> | null = null

  /** Set by the app: verifies a finished milestone (quality engine). */
  onMilestone: ((project: Project, n: number) => Promise<void>) | null = null

  /** One focused repair for a milestone gate failure, owned by the best-fitting idle person. */
  /**
   * One focused correction of verified defects that review QA found in this result, before you see it.
   * Bounded by the caller (once per result); respects pause and budget; never widens the scope: the
   * task lists exactly the findings to fix. Returns null when it cannot run now.
   */
  addQualityCorrection(project: Project, d: Delivery, findings: QualityFinding[]): Task | null {
    const fresh = this.repo.project(project.id)
    if (fresh.paused || !this.getClaude().available) return null
    const kind: Task['kind'] = findings.every((f) => f.dimension === 'visual' || f.dimension === 'accessibility') ? 'design' : 'code'
    const title = `Fix ${findings.length} verified issue${findings.length === 1 ? '' : 's'} found in review`
    const where = (f: QualityFinding) => [f.file && `${f.file}${f.line ? `:${f.line}` : ''}`, f.width && `at ${f.width}px`].filter(Boolean).join(' ')
    const description = [
      `Autopia's review QA of result #${d.number} measured these defects in what this result changed. Fix exactly these, nothing else: keep every requirement of the original request and all working behaviour unchanged, and re-run the project's checks afterwards.`,
      ...findings.map((f) => `- [${f.severity}] ${f.message}${where(f) ? ` (${where(f)})` : ''}${f.evidence ? `. Evidence: ${f.evidence}` : ''}${f.fix ? `. Suggested: ${f.fix}` : ''}`),
      'Autopia re-runs the same QA when you finish and compares: what you fixed, what remains, and anything new.'
    ].join('\n')
    const skills = taskSkills({ kind, title, description, files: [] })
    const owner = chooseAssignee(this.team(project.id), kind, skills, (id) => (this.isBusy(id) ? 1 : 0))
    if (!owner) return null
    const t = this.repo.insertTask(project.id, {
      key: this.nextKey(project.id),
      title,
      description,
      acceptance: 'Each listed defect no longer occurs, nothing else changed, and the project checks still pass.',
      kind,
      assigneeId: owner.employee.id,
      dependsOnKeys: [],
      rationale: `Review QA measured these in result #${d.number}. ${owner.reason}.`,
      size: 's',
      files: [...new Set(findings.map((f) => f.file).filter((f): f is string => !!f && f.includes('/') && !f.includes(' ')))],
      validation: [],
      skills,
      milestone: null
    })
    const task = this.repo.updateTask(t.id, { deliveryId: d.id })
    this.emitDelivery(this.repo.updateDelivery(d.id, { status: 'implementing', completedAt: null }))
    this.emit({ type: 'task', task })
    this.logAction(project.id, task.id, 'route', `Result #${d.number}: review QA measured ${plural(findings.length, 'defect')} in the changed work; ${owner.employee.name} fixes them in ${task.key} before it reaches you (one attempt).`)
    this.setPhase(fresh, 'executing', { lastError: null })
    void this.schedule()
    return task
  }

  addMilestoneRepair(project: Project, milestone: number, title: string, description: string, kind: Task['kind']): Task {
    const skills = taskSkills({ kind, title, description, files: [] })
    const owner = chooseAssignee(this.team(project.id), kind, skills, (id) => (this.isBusy(id) ? 1 : 0))
    if (!owner) throw new Error('Nobody can own the milestone repair')
    const open = this.repo.openDelivery(project.id)
    const t = this.repo.insertTask(project.id, {
      key: this.nextKey(project.id),
      title,
      description,
      acceptance: 'The listed problems are fixed and the affected checks pass again.',
      kind,
      assigneeId: owner.employee.id,
      dependsOnKeys: [],
      rationale: `Milestone ${milestone} gate found concrete problems. ${owner.reason}.`,
      size: 's',
      files: [],
      validation: [],
      skills,
      milestone
    })
    const task = open ? this.repo.updateTask(t.id, { deliveryId: open.id }) : t
    this.emit({ type: 'task', task })
    this.logAction(project.id, task.id, 'route', `Milestone ${milestone}: focused repair ${task.key} → ${owner.employee.name}.`)
    return task
  }

  /** Only after the checks passed again: the failure signature and the fix that resolved it. */
  private async recordRepairLesson(project: Project, task: Task, failed: CheckResult, summary: string): Promise<void> {
    const firstError = failed.output.split('\n').find((l) => /error|fail|✖|assert|expected|exception|not ok/i.test(l))?.trim().slice(0, 200) ?? 'failed'
    const cause = summary.split('\n').find((l) => /cause|because|fix/i.test(l))?.trim() ?? summary.split('\n')[0]
    await this.memory
      .remember(project, {
        kind: 'lesson',
        topic: `lesson:repair:${failed.command}:${firstError.replace(/[^a-z0-9]+/gi, ' ').trim().slice(0, 60)}`,
        title: `\`${failed.command}\` failure resolved in ${task.key}`,
        text: `Failure: ${firstError}\nResolved by (verified, checks passed after ${plural(task.fixAttempts, 'repair attempt')}): ${cause.slice(0, 300)}`,
        files: task.files.slice(0, 6),
        source: `${task.key} repair (verified)`
      })
      .catch(() => undefined)
  }

  /** After a task is merged: its handoff for teammates and any significant decisions it made. */
  private async recordTaskMemory(task: Task, changed: string[]): Promise<void> {
    const notes = this.pendingNotes.get(task.id)
    this.pendingNotes.delete(task.id)
    if (!notes) return
    const project = this.repo.project(task.projectId)
    const files = changed.map((c) => c.replace(/^\S+\s+/, ''))
    if (notes.handoff?.trim()) {
      await this.memory.remember(project, { kind: 'handoff', topic: `handoff:${task.key}`, title: `${task.key} ${task.title}`, text: notes.handoff, files, source: `${task.key} handoff` })
    }
    for (const d of notes.decisions ?? []) {
      await this.memory.remember(project, { kind: 'decision', title: d.title, text: d.decision, rationale: d.why, alternatives: d.alternatives ?? null, files, source: task.key })
    }
  }

  memoryReport(projectId: string) {
    return this.memory.report(projectId)
  }

  async reindex(projectId: string) {
    const project = this.repo.project(projectId)
    await this.memory.refresh(project, true)
    await this.memory.recordLessons(project)
    return this.memory.report(projectId)
  }

  /** Founder edits always win and are marked as theirs. */
  async editKnowledge(projectId: string, input: { id: string | null; kind: KnowledgeKind; title: string; text: string; rationale: string | null; alternatives: string | null; files: string[] }) {
    const project = this.repo.project(projectId)
    const prev = input.id ? this.repo.knowledgeEntry(input.id) : null
    if (prev && prev.projectId !== projectId) throw new Error('That note belongs to another project')
    const entry = await this.memory.remember(
      project,
      { kind: input.kind, topic: prev?.topic, title: input.title, text: input.text, rationale: input.rationale, alternatives: input.alternatives, files: input.files, source: prev ? `corrected by you (was: ${prev.source})` : 'written by you' },
      'user'
    )
    return entry
  }

  setKnowledgeStatus(id: string, status: KnowledgeStatus): void {
    const e = this.repo.knowledgeEntry(id)
    if (!e) throw new Error('Unknown note')
    this.memory.setStatus(this.repo.project(e.projectId), e, status)
  }

  /** Deleting a founder-written note needs explicit confirmation. */
  forget(id: string, confirmUserNote: boolean): void {
    const e = this.repo.knowledgeEntry(id)
    if (!e) return
    if (e.author === 'user' && !confirmUserNote) throw new Error('This note was written by you; confirm to delete it')
    this.repo.deleteKnowledge(id)
  }

  resetMemory(projectId: string, includeUser: boolean): number {
    const n = this.repo.resetKnowledge(projectId, includeUser)
    this.repo.setMeta(`memory-key:${projectId}`, null)
    return n
  }

  // ── helpers ──────────────────────────────────────────────────

  private requireClaude(): ClaudeInfo {
    const c = this.getClaude()
    if (!c.available || !c.path) throw new Error(c.error ?? 'Claude Code CLI is not available')
    return c
  }

  /**
   * The people in a project's office: its own team, or the original Autopia team for projects created
   * before offices existed. Assignment, planning and consultations only ever use this team.
   */
  team(projectId: string | null | undefined): Employee[] {
    const own = projectId ? this.employees.filter((e) => e.projectId === projectId) : []
    return own.length ? own : this.employees.filter((e) => !e.projectId)
  }

  private byRole(role: Employee['role'], projectId: string | null | undefined): Employee {
    const e = this.team(projectId).find((m) => m.role === role)
    if (!e) throw new Error(`No ${role} on the team`)
    return e
  }

  /** A project was created (with its own team) or removed: refresh who exists and tell the UI. */
  refreshTeams(): void {
    this.employees = this.repo.employees()
    for (const e of this.employees) if (!this.statuses.has(e.id)) this.statuses.set(e.id, this.blankStatus(e.id))
    for (const id of [...this.statuses.keys()]) if (!this.employees.some((e) => e.id === id)) this.statuses.delete(id)
    this.emit({ type: 'team', employees: this.employees })
  }

  private isBusy(employeeId: string): boolean {
    for (const a of this.active.values()) if (a.run.employeeId === employeeId) return true
    const s = this.statuses.get(employeeId)
    return !!s && (s.activity === 'working' || s.activity === 'testing') && !!s.taskId
  }

  private async withMergeLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mergeLocks.get(projectId) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    this.mergeLocks.set(projectId, next)
    return next
  }

  private setPhase(
    project: Project,
    phase: ProjectPhase,
    patch: Partial<Pick<Project, 'planSummary' | 'lastError' | 'strategy' | 'complexity' | 'contextSummary'>> = {}
  ): Project {
    if (project.phase !== phase) assertProjectTransition(project.phase, phase)
    else if (!Object.keys(patch).length) return project
    const updated = this.repo.updateProject(project.id, { phase, ...patch })
    this.emit({ type: 'project', project: updated })
    return updated
  }

  private transitionTask(
    task: Task,
    status: TaskStatus,
    patch: Partial<Pick<Task, 'resultSummary' | 'lastError' | 'changedFiles' | 'attempts' | 'startedAt' | 'finishedAt' | 'model' | 'fixAttempts' | 'recovery'>> = {}
  ): Task {
    assertTaskTransition(task.status, status)
    const updated = this.repo.updateTask(task.id, { status, ...patch })
    this.emit({ type: 'task', task: updated })
    this.queueAttention()
    if (status === 'cancelled') this.releaseSteer(task.id)
    return updated
  }

  private blankStatus(employeeId: string): EmployeeStatus {
    return { employeeId, activity: 'idle', projectId: null, taskId: null, runId: null, detail: null, reason: null, since: Date.now() }
  }

  private setStatus(employeeId: string, s: Omit<EmployeeStatus, 'employeeId' | 'since'>): void {
    const prev = this.statuses.get(employeeId)
    const status: EmployeeStatus = { ...s, detail: this.human(s.projectId, s.detail), employeeId, since: prev && prev.activity === s.activity ? prev.since : Date.now() }
    this.statuses.set(employeeId, status)
    this.emit({ type: 'employee', status })
  }

  private emitApproval(approval: ReturnType<Repo['approval']>): void {
    this.emit({ type: 'approval', approval })
    this.queueAttention()
    if (approval.status === 'pending' && approval.kind !== 'permission' && this.repo.settings().autoApprove) setTimeout(() => this.directorPass(), 300)
  }
}

/** Blockers auto mode may retry once: a check or build that still failed, or an unclear failure. */
const AUTO_RETRY = new Set<BlockerDiagnosis['kind']>(['test_failure', 'build_failure', 'unknown'])
const mergeMessage = (task: Pick<Task, 'key' | 'title'>) => `Merge ${task.key}: ${task.title}`
const branchFor = (task: Task) => `autopia/${task.key.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${task.id.slice(0, 8)}`

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Kills a leftover Claude Code process from a crashed session (only if it really is one). */
/** The exact thing being approved: the command for Bash, the path for file tools, else a short description. */
function permissionSubject(req: PermissionRequest, cwd: string): string {
  const i = req.input
  if (typeof i.command === 'string') return i.command
  const key = FILE_WRITE_TOOLS[req.toolName] ?? (typeof i.file_path === 'string' ? 'file_path' : null)
  if (key && typeof i[key] === 'string') return rel(cwd, i[key])
  if (typeof i.url === 'string') return i.url
  return describeTool(req.toolName, i, cwd)
}

function killIfClaude(pid: number): void {
  try {
    const comm = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim()
    if (/claude/i.test(comm)) process.kill(pid, 'SIGTERM')
  } catch {
    // not running
  }
}

function parseConsult(note: string | null): ConsultNote | null {
  if (!note || !note.startsWith('{')) return null
  try {
    const n = JSON.parse(note) as ConsultNote
    return n.consultFor ? n : null
  } catch {
    return null
  }
}
