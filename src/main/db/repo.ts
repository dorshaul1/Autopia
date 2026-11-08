import { isOfficeType, teamFor, type OfficeType } from '@shared/offices'
import { randomUUID } from 'node:crypto'
import type {
  Message,
  ProductSpec,
  QualityDimension,
  QualityException,
  QualityReport,
  AssignmentRecord,
  ManagerAction,
  Notification,
  NotificationKind,
  Approval,
  ApprovalKind,
  CheckResult,
  Delivery,
  RunSkills,
  SearchHit,
  SkillInstall,
  DeliveryStatus,
  Employee,
  KnowledgeConfidence,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeStatus,
  ValidationRun,
  Project,
  ProjectPhase,
  Run,
  RunEvent,
  RunEventKind,
  RunKind,
  RunStatus,
  Settings,
  Task,
  TaskKind,
  TaskStatus
} from '@shared/types'
import { checkStatus } from '@shared/checks'
import type { DB } from './database'
import { DEFAULT_SETTINGS, readableSettings } from '@shared/settings'

type Row = Record<string, unknown>


const toProject = (r: Row): Project => ({
  id: r.id as string,
  name: r.name as string,
  path: r.path as string,
  goal: r.goal as string,
  phase: r.phase as ProjectPhase,
  gitEnabled: !!r.git_enabled,
  baseBranch: (r.base_branch as string) ?? null,
  planSummary: (r.plan_summary as string) ?? null,
  lastError: (r.last_error as string) ?? null,
  strategy: (r.strategy as Project['strategy']) ?? null,
  complexity: (r.complexity as Project['complexity']) ?? null,
  contextSummary: (r.context_summary as string) ?? null,
  priority: (r.priority as number) ?? 0,
  budgetUsd: (r.budget_usd as number) ?? null,
  paused: !!r.paused,
  officeType: isOfficeType(r.office_type) ? r.office_type : 'startup',
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number
})

const toRun = (r: Row): Run => ({
  id: r.id as string,
  projectId: r.project_id as string,
  taskId: (r.task_id as string) ?? null,
  employeeId: r.employee_id as string,
  kind: r.kind as RunKind,
  status: r.status as RunStatus,
  sessionId: (r.session_id as string) ?? null,
  cwd: r.cwd as string,
  model: (r.model as string) ?? null,
  costUsd: (r.cost_usd as number) ?? null,
  numTurns: (r.num_turns as number) ?? null,
  error: (r.error as string) ?? null,
  purpose: (r.purpose as Run['purpose']) ?? 'work',
  inputTokens: (r.input_tokens as number) ?? null,
  outputTokens: (r.output_tokens as number) ?? null,
  cacheReadTokens: (r.cache_read_tokens as number) ?? null,
  cacheWriteTokens: (r.cache_write_tokens as number) ?? null,
  durationMs: (r.duration_ms as number) ?? null,
  apiMs: (r.api_ms as number) ?? null,
  contextIds: JSON.parse((r.context_ids as string) ?? '[]'),
  contextChars: (r.context_chars as number) ?? null,
  exploreCalls: (r.explore_calls as number) ?? null,
  skills: r.skills ? (JSON.parse(r.skills as string) as RunSkills) : null,
  effort: (r.effort as string) ?? null,
  startedAt: r.started_at as number,
  endedAt: (r.ended_at as number) ?? null
})

const toEvent = (r: Row): RunEvent => ({
  id: r.id as number,
  runId: r.run_id as string,
  seq: r.seq as number,
  ts: r.ts as number,
  kind: r.kind as RunEventKind,
  summary: r.summary as string,
  detail: (r.detail as string) ?? null,
  toolName: (r.tool_name as string) ?? null,
  isError: !!r.is_error
})

const toNotification = (r: Row): Notification => ({
  id: r.id as number,
  projectId: (r.project_id as string) ?? null,
  taskId: (r.task_id as string) ?? null,
  kind: r.kind as NotificationKind,
  title: r.title as string,
  body: r.body as string,
  read: !!r.read,
  createdAt: r.created_at as number,
  category: ((r.category as string) ?? 'info') as Notification['category'],
  key: (r.key as string) ?? null,
  approvalId: (r.approval_id as string) ?? null,
  deliveryId: (r.delivery_id as string) ?? null,
  employeeId: (r.employee_id as string) ?? null,
  priority: (r.priority as number) ?? 10,
  count: (r.count as number) ?? 1,
  updatedAt: (r.updated_at as number) ?? (r.created_at as number),
  resolvedAt: (r.resolved_at as number) ?? null
})

const toAction = (r: Row): ManagerAction => ({
  id: r.id as number,
  projectId: r.project_id as string,
  taskId: (r.task_id as string) ?? null,
  kind: r.kind as ManagerAction['kind'],
  message: r.message as string,
  createdAt: r.created_at as number
})

const toApproval = (r: Row): Approval => ({
  id: r.id as string,
  projectId: r.project_id as string,
  taskId: (r.task_id as string) ?? null,
  kind: r.kind as ApprovalKind,
  status: r.status as Approval['status'],
  title: r.title as string,
  body: r.body as string,
  resolution: (r.resolution as string) ?? null,
  createdAt: r.created_at as number,
  resolvedAt: (r.resolved_at as number) ?? null
})

export interface NewTask {
  key: string
  title: string
  description: string
  acceptance: string
  kind: TaskKind
  assigneeId: string
  dependsOnKeys: string[]
  rationale?: string | null
  size?: Task['size']
  files?: string[]
  validation?: string[]
  skills?: Task['skills']
  priority?: number
  milestone?: number | null
}

/** Thin, synchronous data-access layer. All writes go through here. */
/** The sentence around a match, so you can tell which message it is. */
function snippet(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(word)
  const start = Math.max(0, at - 30)
  return `${start ? '…' : ''}${flat.slice(start, start + 110)}${start + 110 < flat.length ? '…' : ''}`
}

export class Repo {
  constructor(private db: DB) {}

  // ── search ──────────────────────────────────────────────────
  /**
   * Everything recorded, across every product, for words you typed. Plain SQL on what's already stored: nothing is
   * indexed separately and nothing calls a model. Newest first within each kind.
   */
  search(query: string, perKind = 5): SearchHit[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
    if (!words.length || query.trim().length < 2) return []
    const like = (cols: string[]) => {
      const params = words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`)
      const hay = cols.map((c) => `COALESCE(${c},'')`).join(" || ' ' || ")
      return { sql: words.map(() => `LOWER(${hay}) LIKE ? ESCAPE '\\'`).join(' AND '), params }
    }
    const names = new Map((this.db.prepare('SELECT id, name FROM projects').all() as Row[]).map((r) => [r.id as string, r.name as string]))
    const hits: SearchHit[] = []
    const run = (table: string, cols: string[], extra: string, order: string, make: (r: Row) => SearchHit | null) => {
      const w = like(cols)
      for (const r of this.db.prepare(`SELECT * FROM ${table} WHERE ${w.sql}${extra} ORDER BY ${order} LIMIT ?`).all(...w.params, perKind) as Row[]) {
        const hit = names.has(r.project_id as string) ? make(r) : null
        if (hit) hits.push(hit)
      }
    }
    const product = (r: Row) => ({ projectId: r.project_id as string, projectName: names.get(r.project_id as string)! })
    run('tasks', ['key', 'title', 'description', 'result_summary'], " AND status != 'proposed'", 'created_at DESC', (r) => ({ kind: 'task', id: r.id as string, title: r.title as string, at: r.created_at as number, ...product(r) }))
    run('deliveries', ['request', 'summary'], '', 'number DESC', (r) => ({ kind: 'delivery', id: r.id as string, title: (r.request as string).split('\n').find((l) => l.trim() && !/^Visual feedback from/.test(l)) ?? `Result #${r.number}`, at: r.created_at as number, ...product(r) }))
    run('messages', ['text'], " AND TRIM(text) != ''", 'created_at DESC', (r) => ({ kind: 'message', id: r.id as string, title: snippet(r.text as string, words[0]), at: r.created_at as number, ...product(r) }))
    run('employees', ['name', 'title'], ' AND project_id IS NOT NULL', 'hired_at', (r) => ({ kind: 'employee', id: r.id as string, title: r.name as string, at: 0, ...product(r) }))
    run('code_files', ['file'], '', 'file', (r) => ({ kind: 'file', id: r.file as string, title: r.file as string, at: 0, ...product(r) }))
    return hits
  }

  // ── employees ────────────────────────────────────────────────
  /** Inserts the founding team and refreshes their profile, but never moves a desk the founder changed. */
  seedEmployees(team: Employee[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO employees (id, role, name, title, bio, desk_id, appearance, specialization, capabilities, kinds, hired_at, project_id)
       VALUES (@id, @role, @name, @title, @bio, @deskId, @appearance, @specialization, @capabilities, @kinds, @hiredAt, @projectId)
       ON CONFLICT(id) DO UPDATE SET role=excluded.role, name=excluded.name, title=excluded.title, bio=excluded.bio,
         appearance=excluded.appearance, specialization=excluded.specialization, capabilities=excluded.capabilities, kinds=excluded.kinds`
    )
    this.db.transaction(() => {
      for (const e of team) {
        stmt.run({ ...e, projectId: e.projectId ?? null, appearance: JSON.stringify(e.appearance), capabilities: JSON.stringify(e.capabilities), kinds: JSON.stringify(e.kinds) })
      }
    })()
  }

  employees(): Employee[] {
    return (this.db.prepare('SELECT * FROM employees ORDER BY hired_at, rowid').all() as Row[]).map((r) => ({
      id: r.id as string,
      role: r.role as Employee['role'],
      name: r.name as string,
      title: r.title as string,
      bio: r.bio as string,
      deskId: r.desk_id as string,
      appearance: JSON.parse(r.appearance as string),
      specialization: (r.specialization as string) ?? '',
      capabilities: JSON.parse((r.capabilities as string) ?? '[]'),
      kinds: JSON.parse((r.kinds as string) ?? '[]'),
      hiredAt: (r.hired_at as number) ?? 0,
      projectId: (r.project_id as string) ?? null
    }))
  }

  insertEmployee(e: Employee): Employee {
    this.seedEmployees([e])
    this.setDesk(e.id, e.deskId)
    return this.employees().find((x) => x.id === e.id)!
  }

  setDesk(employeeId: string, deskId: string): void {
    this.db.prepare('UPDATE employees SET desk_id = ? WHERE id = ?').run(deskId, employeeId)
  }

  setAssignee(taskId: string, employeeId: string, rationale: string): Task {
    this.db.prepare('UPDATE tasks SET assignee_id = ?, rationale = ?, updated_at = ? WHERE id = ?').run(employeeId, rationale, Date.now(), taskId)
    return this.task(taskId)
  }

  /** Every assignment an employee has had, newest first, across projects. */
  assignmentHistory(employeeId: string, limit = 30): AssignmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.project_id, p.name AS project_name, t.key, t.title, t.status, t.finished_at, t.checks,
           (SELECT COALESCE(SUM(cost_usd), 0) FROM runs r WHERE r.task_id = t.id) AS cost
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.assignee_id = ? AND t.status != 'proposed'
         ORDER BY COALESCE(t.finished_at, t.updated_at) DESC LIMIT ?`
      )
      .all(employeeId, limit) as Row[]
    return rows.map((r) => {
      const checks = JSON.parse((r.checks as string) ?? '[]') as { ok: boolean }[]
      return {
        taskId: r.id as string,
        projectId: r.project_id as string,
        projectName: r.project_name as string,
        key: r.key as string,
        title: r.title as string,
        status: r.status as Task['status'],
        finishedAt: (r.finished_at as number) ?? null,
        costUsd: r.cost as number,
        checksPassed: checks.filter((c) => c.ok).length,
        checksTotal: checks.length
      }
    })
  }

  employeeRuns(employeeId: string): Run[] {
    return (this.db.prepare('SELECT * FROM runs WHERE employee_id = ?').all(employeeId) as Row[]).map(toRun)
  }

  // ── notifications ────────────────────────────────────────────
  addNotification(n: {
    projectId: string | null
    taskId: string | null
    kind: NotificationKind
    title: string
    body: string
    category?: Notification['category']
    key?: string | null
    approvalId?: string | null
    deliveryId?: string | null
    employeeId?: string | null
    priority?: number
    /** News is history from the start; actionable items stay open until their cause is gone. */
    resolved?: boolean
  }): Notification {
    const now = Date.now()
    const info = this.db
      .prepare(
        `INSERT INTO notifications (project_id, task_id, kind, title, body, created_at, category, key, approval_id, delivery_id, employee_id, priority, count, updated_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(n.projectId, n.taskId, n.kind, n.title, n.body, now, n.category ?? 'info', n.key ?? null, n.approvalId ?? null, n.deliveryId ?? null, n.employeeId ?? null, n.priority ?? 10, now, n.resolved === false ? null : now)
    return this.notification(Number(info.lastInsertRowid))
  }

  /** The open item for a condition, if there is one (dedupe). */
  openNotification(key: string): Notification | null {
    const r = this.db.prepare('SELECT * FROM notifications WHERE key = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1').get(key) as Row | undefined
    return r ? toNotification(r) : null
  }

  /** The same condition reported again: one item, counted; unread again only if what it says changed. */
  repeatNotification(id: number, n: { title: string; body: string }): Notification {
    const cur = this.notification(id)
    const changed = cur.title !== n.title || cur.body !== n.body
    this.db.prepare('UPDATE notifications SET title = ?, body = ?, count = count + 1, updated_at = ?, read = CASE WHEN ? THEN 0 ELSE read END WHERE id = ?').run(n.title, n.body, Date.now(), changed ? 1 : 0, id)
    return this.notification(id)
  }

  openNotifications(): Notification[] {
    return (this.db.prepare('SELECT * FROM notifications WHERE resolved_at IS NULL ORDER BY priority DESC, updated_at DESC').all() as Row[]).map(toNotification)
  }

  resolveNotification(id: number): Notification {
    this.db.prepare('UPDATE notifications SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(Date.now(), id)
    return this.notification(id)
  }

  private notification(id: number): Notification {
    return toNotification(this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Row)
  }

  /** Open items first (they persist however old), then recent history. */
  notifications(limit = 100): Notification[] {
    const open = this.openNotifications()
    const recent = (this.db.prepare('SELECT * FROM notifications WHERE resolved_at IS NOT NULL ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[]).map(toNotification)
    return [...open, ...recent]
  }

  markNotificationsRead(ids: number[] | 'all'): void {
    if (ids === 'all') this.db.prepare('UPDATE notifications SET read = 1').run()
    else {
      const stmt = this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?')
      this.db.transaction(() => ids.forEach((i) => stmt.run(i)))()
    }
  }

  // ── manager log ──────────────────────────────────────────────
  addManagerAction(a: Omit<ManagerAction, 'id' | 'createdAt'>): ManagerAction {
    const info = this.db
      .prepare('INSERT INTO manager_actions (project_id, task_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(a.projectId, a.taskId, a.kind, a.message, Date.now())
    const r = this.db.prepare('SELECT * FROM manager_actions WHERE id = ?').get(Number(info.lastInsertRowid)) as Row
    return toAction(r)
  }

  managerActions(projectId: string, limit = 50): ManagerAction[] {
    return (this.db.prepare('SELECT * FROM manager_actions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit) as Row[]).map(toAction)
  }

  // ── settings ─────────────────────────────────────────────────
  settings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored: Record<string, unknown> = {}
    for (const { key, value } of rows) {
      if (!(key in DEFAULT_SETTINGS)) continue
      try {
        stored[key] = JSON.parse(value)
      } catch {
        console.warn(`[repo] ignoring a damaged setting: ${key}`)
      }
    }
    return readableSettings(stored)
  }

  // ── deliveries ───────────────────────────────────────────────
  private toDelivery = (r: Row): Delivery => ({
    id: r.id as string,
    projectId: r.project_id as string,
    parentId: (r.parent_id as string) ?? null,
    number: r.number as number,
    kind: r.kind as Delivery['kind'],
    request: r.request as string,
    status: r.status as DeliveryStatus,
    baseSha: (r.base_sha as string) ?? null,
    headSha: (r.head_sha as string) ?? null,
    summary: (r.summary as string) ?? null,
    limitations: JSON.parse((r.limitations as string) ?? '[]'),
    verification: r.verification ? JSON.parse(r.verification as string) : null,
    strategy: (r.strategy as Delivery['strategy']) ?? null,
    screenshot: (r.screenshot as string) ?? null,
    createdAt: r.created_at as number,
    completedAt: (r.completed_at as number) ?? null,
    decidedAt: (r.decided_at as number) ?? null,
    decisionNote: (r.decision_note as string) ?? null
  })

  createDelivery(d: Pick<Delivery, 'projectId' | 'parentId' | 'kind' | 'request' | 'baseSha' | 'screenshot'>): Delivery {
    const id = randomUUID()
    const n = (this.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM deliveries WHERE project_id = ?').get(d.projectId) as { n: number }).n
    this.db
      .prepare(
        `INSERT INTO deliveries (id, project_id, parent_id, number, kind, request, status, base_sha, screenshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'implementing', ?, ?, ?)`
      )
      .run(id, d.projectId, d.parentId, n, d.kind, d.request, d.baseSha, d.screenshot, Date.now())
    return this.delivery(id)
  }

  delivery(id: string): Delivery {
    const r = this.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Delivery ${id} not found`)
    return this.toDelivery(r)
  }

  deliveries(projectId: string): Delivery[] {
    return (this.db.prepare('SELECT * FROM deliveries WHERE project_id = ? ORDER BY number DESC').all(projectId) as Row[]).map(this.toDelivery)
  }

  /** The delivery currently being worked on (at most one per project). */
  openDelivery(projectId: string): Delivery | null {
    const r = this.db
      .prepare(`SELECT * FROM deliveries WHERE project_id = ? AND status IN ('implementing', 'validating') ORDER BY number DESC LIMIT 1`)
      .get(projectId) as Row | undefined
    return r ? this.toDelivery(r) : null
  }

  updateDelivery(id: string, patch: Partial<Pick<Delivery, 'request' | 'status' | 'headSha' | 'summary' | 'limitations' | 'verification' | 'completedAt' | 'decidedAt' | 'decisionNote' | 'strategy'>>): Delivery {
    const cols: Record<string, string> = {
      request: 'request',
      strategy: 'strategy',
      status: 'status',
      headSha: 'head_sha',
      summary: 'summary',
      limitations: 'limitations',
      verification: 'verification',
      completedAt: 'completed_at',
      decidedAt: 'decided_at',
      decisionNote: 'decision_note'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${cols[k]} = ?`)
      vals.push(k === 'limitations' || k === 'verification' ? (v === null ? null : JSON.stringify(v)) : v)
    }
    if (sets.length) this.db.prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.delivery(id)
  }

  /** Tasks not yet linked to a delivery join the open one. */
  attachTasks(projectId: string, deliveryId: string): void {
    this.db.prepare(`UPDATE tasks SET delivery_id = ? WHERE project_id = ? AND delivery_id IS NULL`).run(deliveryId, projectId)
  }

  // ── validation history ───────────────────────────────────────
  private toValidation = (r: Row): ValidationRun => ({
    id: r.id as string,
    projectId: r.project_id as string,
    deliveryId: (r.delivery_id as string) ?? null,
    runId: (r.run_id as string) ?? null,
    trigger: r.trigger as ValidationRun['trigger'],
    status: r.status as ValidationRun['status'],
    checks: JSON.parse(r.checks as string),
    error: (r.error as string) ?? null,
    startedAt: r.started_at as number,
    endedAt: (r.ended_at as number) ?? null,
    command: (r.command as string) ?? null,
    stamp: (r.stamp as string) ?? null
  })

  createValidation(v: Pick<ValidationRun, 'projectId' | 'deliveryId' | 'runId' | 'trigger' | 'status' | 'checks' | 'command' | 'stamp'>): ValidationRun {
    const id = randomUUID()
    this.db
      .prepare(`INSERT INTO validations (id, project_id, delivery_id, run_id, trigger, status, checks, command, stamp, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, v.projectId, v.deliveryId, v.runId, v.trigger, v.status, JSON.stringify(v.checks), v.command ?? null, v.stamp ?? null, Date.now())
    return this.validation(id)
  }

  validation(id: string): ValidationRun {
    return this.toValidation(this.db.prepare('SELECT * FROM validations WHERE id = ?').get(id) as Row)
  }

  validations(projectId: string, limit = 50): ValidationRun[] {
    return (this.db.prepare('SELECT * FROM validations WHERE project_id = ? ORDER BY started_at DESC LIMIT ?').all(projectId, limit) as Row[]).map(this.toValidation)
  }

  finishValidation(id: string, patch: Pick<ValidationRun, 'status' | 'checks' | 'error'> & { runId?: string | null }): ValidationRun {
    this.db
      .prepare(`UPDATE validations SET status = ?, checks = ?, error = ?, run_id = COALESCE(?, run_id), ended_at = ? WHERE id = ?`)
      .run(patch.status, JSON.stringify(patch.checks), patch.error, patch.runId ?? null, Date.now(), id)
    return this.validation(id)
  }

  /** Validations left running by a crash can never finish. */
  interruptValidations(): void {
    this.db.prepare(`UPDATE validations SET status = 'error', error = 'Interrupted: Autopia was closed', ended_at = ? WHERE status = 'running'`).run(Date.now())
  }

  // ── project knowledge ────────────────────────────────────────
  private toKnowledge = (r: Row): KnowledgeEntry => {
    const safe = <T>(v: unknown, fallback: T): T => {
      try {
        return v ? (JSON.parse(v as string) as T) : fallback
      } catch {
        return fallback // a corrupted row degrades to "no files", never a crash
      }
    }
    const status = ((r.status as string) ?? 'active') as KnowledgeStatus
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      kind: r.kind as KnowledgeKind,
      topic: (r.topic as string) ?? `${r.kind}:${r.id}`,
      title: (r.title as string) ?? String(r.text).slice(0, 80),
      text: r.text as string,
      rationale: (r.rationale as string) ?? null,
      alternatives: (r.alternatives as string) ?? null,
      files: ((f: unknown) => (Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : []))(safe<unknown>(r.files, [])),
      hashes: ((h: unknown) => (h && typeof h === 'object' && !Array.isArray(h) ? (h as Record<string, string>) : {}))(safe<unknown>(r.hashes, {})),
      commit: (r.commit_sha as string) ?? null,
      source: r.source as string,
      confidence: ((r.confidence as string) ?? 'reported') as KnowledgeConfidence,
      status,
      author: ((r.author as string) ?? 'agent') as KnowledgeEntry['author'],
      uses: (r.uses as number) ?? 0,
      lastUsedAt: (r.last_used_at as number) ?? null,
      createdAt: r.created_at as number,
      updatedAt: (r.updated_at as number) ?? (r.created_at as number),
      stale: status === 'stale',
      statusNote: (r.status_note as string) ?? null
    }
  }

  knowledge(projectId: string): KnowledgeEntry[] {
    return (this.db.prepare('SELECT * FROM knowledge WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Row[]).map(this.toKnowledge)
  }

  knowledgeEntry(id: string): KnowledgeEntry | null {
    const r = this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Row | undefined
    return r ? this.toKnowledge(r) : null
  }

  /** Insert or update by (project, topic): the same fact is refreshed, never duplicated. */
  upsertKnowledge(k: Omit<KnowledgeEntry, 'id' | 'uses' | 'lastUsedAt' | 'createdAt' | 'updatedAt' | 'stale' | 'statusNote'> & { statusNote?: string | null }): KnowledgeEntry {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM knowledge WHERE project_id = ? AND topic = ?').get(k.projectId, k.topic) as { id: string } | undefined
    if (existing) {
      this.db
        .prepare(
          `UPDATE knowledge SET kind = ?, title = ?, text = ?, rationale = ?, alternatives = ?, files = ?, hashes = ?, commit_sha = ?, source = ?,
             confidence = ?, status = ?, author = ?, stale = ?, status_note = ?, updated_at = ? WHERE id = ?`
        )
        .run(k.kind, k.title, k.text, k.rationale, k.alternatives, JSON.stringify(k.files), JSON.stringify(k.hashes), k.commit, k.source, k.confidence, k.status, k.author, k.status === 'stale' ? 1 : 0, k.statusNote ?? null, now, existing.id)
      return this.knowledgeEntry(existing.id)!
    }
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO knowledge (id, project_id, kind, topic, title, text, rationale, alternatives, files, hashes, commit_sha, source, confidence, status, author, stale, status_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, k.projectId, k.kind, k.topic, k.title, k.text, k.rationale, k.alternatives, JSON.stringify(k.files), JSON.stringify(k.hashes), k.commit, k.source, k.confidence, k.status, k.author, k.status === 'stale' ? 1 : 0, k.statusNote ?? null, now, now)
    return this.knowledgeEntry(id)!
  }

  /** A status change always replaces the note: a reason only while set aside, none when active again. */
  setKnowledgeStatus(id: string, status: KnowledgeStatus, note: string | null = null): void {
    this.db.prepare('UPDATE knowledge SET status = ?, stale = ?, status_note = ?, updated_at = ? WHERE id = ?').run(status, status === 'stale' ? 1 : 0, note, Date.now(), id)
  }

  /** Re-confirms a fact against the current files without changing what it says. */
  setKnowledgeHashes(id: string, hashes: Record<string, string>): void {
    this.db.prepare('UPDATE knowledge SET hashes = ? WHERE id = ?').run(JSON.stringify(hashes), id)
  }

  markKnowledgeUsed(ids: string[]): void {
    const st = this.db.prepare('UPDATE knowledge SET uses = uses + 1, last_used_at = ? WHERE id = ?')
    const now = Date.now()
    this.db.transaction(() => ids.forEach((id) => st.run(now, id)))()
  }

  deleteKnowledge(id: string): void {
    this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id)
  }

  /** Removes everything Autopia or agents wrote for a project; founder-written notes only when asked. */
  resetKnowledge(projectId: string, includeUser: boolean): number {
    const r = this.db.prepare(`DELETE FROM knowledge WHERE project_id = ? ${includeUser ? '' : "AND author != 'user'"}`).run(projectId)
    return r.changes
  }

  /** Drops raw tool output from old activity logs; one-line summaries stay. */
  pruneEventDetails(olderThan: number): number {
    return this.db
      .prepare(`UPDATE run_events SET detail = NULL WHERE detail IS NOT NULL AND run_id IN (SELECT id FROM runs WHERE ended_at IS NOT NULL AND ended_at < ?)`)
      .run(olderThan).changes
  }

  approvalsOfKind(projectId: string, kind: ApprovalKind): Approval[] {
    return (this.db.prepare('SELECT * FROM approvals WHERE project_id = ? AND kind = ? ORDER BY created_at').all(projectId, kind) as Row[]).map(toApproval)
  }

  // ── skill installs ───────────────────────────────────────────
  private toInstall = (r: Row): SkillInstall => ({
    id: r.id as string,
    catalogId: r.catalog_id as string,
    repo: r.repo as string,
    path: r.path as string,
    sha: r.sha as string,
    status: r.status as SkillInstall['status'],
    files: JSON.parse(r.files as string),
    findings: JSON.parse(r.findings as string),
    skillMd: r.skill_md as string,
    downloadedAt: r.downloaded_at as number,
    approvedAt: (r.approved_at as number) ?? null
  })

  // ── quality ─────────────────────────────────────────────────

  private toReport = (r: Row): QualityReport => ({
    id: r.id as string,
    projectId: r.project_id as string,
    deliveryId: (r.delivery_id as string) ?? null,
    kind: r.kind as QualityReport['kind'],
    status: r.status as QualityReport['status'],
    findings: JSON.parse(r.findings as string),
    metrics: JSON.parse(r.metrics as string),
    shots: JSON.parse(r.shots as string),
    note: (r.note as string) ?? null,
    error: (r.error as string) ?? null,
    startedAt: r.started_at as number,
    endedAt: (r.ended_at as number) ?? null
  })

  qualityReports(projectId: string, limit = 40): QualityReport[] {
    return (this.db.prepare('SELECT * FROM quality_reports WHERE project_id = ? ORDER BY started_at DESC LIMIT ?').all(projectId, limit) as Row[]).map(this.toReport)
  }

  saveQualityReport(q: QualityReport): QualityReport {
    this.db
      .prepare(
        `INSERT INTO quality_reports (id, project_id, delivery_id, kind, status, findings, metrics, shots, note, error, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, findings = excluded.findings, metrics = excluded.metrics, shots = excluded.shots,
           note = excluded.note, error = excluded.error, ended_at = excluded.ended_at`
      )
      .run(q.id, q.projectId, q.deliveryId, q.kind, q.status, JSON.stringify(q.findings), JSON.stringify(q.metrics), JSON.stringify(q.shots), q.note, q.error, q.startedAt, q.endedAt)
    return q
  }

  qualityExceptions(deliveryId: string): QualityException[] {
    return (this.db.prepare('SELECT * FROM quality_exceptions WHERE delivery_id = ? ORDER BY created_at').all(deliveryId) as Row[]).map((r) => ({
      id: r.id as string,
      deliveryId: r.delivery_id as string,
      dimension: r.dimension as QualityDimension,
      note: r.note as string,
      createdAt: r.created_at as number
    }))
  }

  setQualityException(projectId: string, deliveryId: string, dimension: QualityDimension, note: string | null): void {
    if (note === null) this.db.prepare('DELETE FROM quality_exceptions WHERE delivery_id = ? AND dimension = ?').run(deliveryId, dimension)
    else
      this.db
        .prepare(
          `INSERT INTO quality_exceptions (id, delivery_id, project_id, dimension, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(delivery_id, dimension) DO UPDATE SET note = excluded.note, created_at = excluded.created_at`
        )
        .run(randomUUID(), deliveryId, projectId, dimension, note, Date.now())
  }

  // ── conversation ────────────────────────────────────────────

  private toMessage = (r: Row): Message => ({
    id: r.id as string,
    projectId: r.project_id as string,
    role: r.role as Message['role'],
    intent: r.intent as Message['intent'],
    text: r.text as string,
    attachments: JSON.parse(r.attachments as string),
    employeeId: (r.employee_id as string) ?? null,
    taskId: (r.task_id as string) ?? null,
    deliveryId: (r.delivery_id as string) ?? null,
    runId: (r.run_id as string) ?? null,
    status: r.status as Message['status'],
    error: (r.error as string) ?? null,
    routing: r.routing ? JSON.parse(r.routing as string) : null,
    createdAt: r.created_at as number
  })

  messages(projectId: string): Message[] {
    return (this.db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at, rowid').all(projectId) as Row[]).map(this.toMessage)
  }

  messagesWithStatus(status: Message['status']): Message[] {
    return (this.db.prepare('SELECT * FROM messages WHERE status = ?').all(status) as Row[]).map(this.toMessage)
  }

  message(id: string): Message {
    return this.toMessage(this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row)
  }

  private lastMessageAt = 0

  addMessage(m: Omit<Message, 'id' | 'createdAt' | 'routing'>): Message {
    const id = randomUUID()
    // a reply can be saved in the same millisecond as what it answers: time alone must never swap them
    const at = (this.lastMessageAt = Math.max(Date.now(), this.lastMessageAt + 1))
    this.db
      .prepare(
        `INSERT INTO messages (id, project_id, role, intent, text, attachments, employee_id, task_id, delivery_id, run_id, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, m.projectId, m.role, m.intent, m.text, JSON.stringify(m.attachments), m.employeeId, m.taskId, m.deliveryId, m.runId, m.status, m.error, at)
    return this.message(id)
  }

  messageProject(id: string): string {
    const r = this.db.prepare('SELECT project_id FROM messages WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error('Message not found')
    return r.project_id as string
  }

  updateMessage(id: string, patch: Partial<Pick<Message, 'text' | 'status' | 'error' | 'runId' | 'deliveryId' | 'taskId' | 'routing'>>): Message {
    const cols: Record<string, string> = { text: 'text', status: 'status', error: 'error', runId: 'run_id', deliveryId: 'delivery_id', taskId: 'task_id', routing: 'routing' }
    const keys = Object.keys(patch)
    const values = Object.entries(patch).map(([k, v]) => (k === 'routing' ? (v ? JSON.stringify(v) : null) : v))
    if (keys.length) this.db.prepare(`UPDATE messages SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`).run(...values, id)
    return this.message(id)
  }

  productSpec(projectId: string): ProductSpec | null {
    const r = this.db.prepare('SELECT spec FROM product_specs WHERE project_id = ?').get(projectId) as Row | undefined
    return r ? (JSON.parse(r.spec as string) as ProductSpec) : null
  }

  saveProductSpec(spec: ProductSpec): ProductSpec {
    const next = { ...spec, updatedAt: Date.now() }
    this.db
      .prepare('INSERT INTO product_specs (project_id, spec, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at')
      .run(spec.projectId, JSON.stringify(next), next.updatedAt)
    return next
  }

  skillInstalls(): SkillInstall[] {
    return (this.db.prepare('SELECT * FROM skill_installs ORDER BY downloaded_at DESC').all() as Row[]).map(this.toInstall)
  }

  saveSkillInstall(i: SkillInstall): void {
    this.db
      .prepare(
        `INSERT INTO skill_installs (id, catalog_id, repo, path, sha, status, files, findings, skill_md, downloaded_at, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, approved_at = excluded.approved_at, findings = excluded.findings`
      )
      .run(i.id, i.catalogId, i.repo, i.path, i.sha, i.status, JSON.stringify(i.files), JSON.stringify(i.findings), i.skillMd, i.downloadedAt, i.approvedAt)
  }

  deleteSkillInstall(id: string): void {
    this.db.prepare('DELETE FROM skill_installs WHERE id = ?').run(id)
  }

  /** Small JSON records that are not user settings (kept in the settings table under a meta: prefix). */
  // ── code map (see memory/codeGraph) ──
  codeFiles(projectId: string): Map<string, { mtime: number; size: number; hash: string }> {
    const rows = this.db.prepare('SELECT file, mtime, size, hash FROM code_files WHERE project_id = ?').all(projectId) as { file: string; mtime: number; size: number; hash: string }[]
    return new Map(rows.map((r) => [r.file, { mtime: r.mtime, size: r.size, hash: r.hash }]))
  }

  /** One file's symbols and references, replaced together so a crash never leaves it half-written. */
  saveCodeFile(projectId: string, file: string, meta: { mtime: number; size: number; hash: string }, parsed: { symbols: { name: string; kind: string; line: number; endLine: number; exported: boolean }[]; refs: string[] } | null): void {
    this.db.transaction(() => {
      this.dropCodeFile(projectId, file)
      this.db.prepare('INSERT INTO code_files (project_id, file, mtime, size, hash) VALUES (?, ?, ?, ?, ?)').run(projectId, file, meta.mtime, meta.size, meta.hash)
      const sym = this.db.prepare('INSERT INTO code_symbols (project_id, file, name, kind, line, end_line, exported) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const s of parsed?.symbols ?? []) sym.run(projectId, file, s.name, s.kind, s.line, s.endLine, s.exported ? 1 : 0)
      const ref = this.db.prepare('INSERT INTO code_refs (project_id, file, name) VALUES (?, ?, ?)')
      for (const name of parsed?.refs ?? []) ref.run(projectId, file, name)
    })()
  }

  dropCodeFile(projectId: string, file: string): void {
    for (const t of ['code_files', 'code_symbols', 'code_refs']) this.db.prepare(`DELETE FROM ${t} WHERE project_id = ? AND file = ?`).run(projectId, file)
  }

  codeSymbols(projectId: string): { file: string; name: string; kind: string; line: number; endLine: number; exported: boolean }[] {
    const rows = this.db.prepare('SELECT file, name, kind, line, end_line, exported FROM code_symbols WHERE project_id = ? LIMIT 100000').all(projectId) as { file: string; name: string; kind: string; line: number; end_line: number; exported: number }[]
    return rows.map((r) => ({ file: r.file, name: r.name, kind: r.kind, line: r.line, endLine: r.end_line, exported: !!r.exported }))
  }

  codeRefFiles(projectId: string, name: string): string[] {
    return (this.db.prepare('SELECT DISTINCT file FROM code_refs WHERE project_id = ? AND name = ? LIMIT 40').all(projectId, name) as { file: string }[]).map((r) => r.file)
  }

  meta<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`meta:${key}`) as { value: string } | undefined
    if (!r) return null
    try {
      return JSON.parse(r.value) as T
    } catch {
      // a damaged record is rebuilt by whoever owns it (index, caches); it never stops work
      console.warn(`[repo] ignoring corrupted meta record ${key}`)
      return null
    }
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(`meta:${key}`, JSON.stringify(value))
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v))
      }
    })()
    return this.settings()
  }

  // ── projects ─────────────────────────────────────────────────
  createProject(p: Pick<Project, 'name' | 'path' | 'goal' | 'gitEnabled' | 'baseBranch'> & { officeType?: OfficeType }): Project {
    const now = Date.now()
    const id = randomUUID()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, path, goal, phase, git_enabled, base_branch, created_at, updated_at, office_type)
           VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
        )
        .run(id, p.name, p.path, p.goal, p.gitEnabled ? 1 : 0, p.baseBranch, now, now, p.officeType ?? 'startup')
      // every new project gets its own team for its office (one transaction: never a project without people)
      this.seedEmployees(teamFor(p.officeType ?? 'startup', id, now).map((e) => ({ ...e, projectId: id })))
    })()
    return this.project(id)
  }

  project(id: string): Project {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Project ${id} not found`)
    return toProject(r)
  }

  projectByPath(path: string): Project | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Row | undefined
    return r ? toProject(r) : null
  }

  projects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]).map(toProject)
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'phase' | 'planSummary' | 'lastError' | 'goal' | 'baseBranch' | 'strategy' | 'complexity' | 'contextSummary' | 'priority' | 'budgetUsd' | 'paused'>>
  ): Project {
    const cols: Record<string, string> = {
      name: 'name',
      phase: 'phase',
      planSummary: 'plan_summary',
      lastError: 'last_error',
      goal: 'goal',
      baseBranch: 'base_branch',
      strategy: 'strategy',
      complexity: 'complexity',
      contextSummary: 'context_summary',
      priority: 'priority',
      budgetUsd: 'budget_usd',
      paused: 'paused'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${cols[k]} = ?`)
      vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
    }
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.project(id)
  }

  /** Deletes a project and everything Autopia recorded about it (tasks, runs, logs, memory). */
  deleteProject(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      // the project's own office team goes with it (the original team is never removed)
      this.db.prepare('DELETE FROM employees WHERE project_id = ?').run(id)
      this.db.prepare("DELETE FROM settings WHERE key LIKE 'meta:memory-%:' || ?").run(id)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`meta:office:${id}`)
    })()
  }

  // ── tasks ────────────────────────────────────────────────────
  private depsFor(taskId: string): string[] {
    return (this.db.prepare('SELECT depends_on FROM task_deps WHERE task_id = ?').all(taskId) as Row[]).map(
      (r) => r.depends_on as string
    )
  }

  private toTask = (r: Row): Task => ({
    id: r.id as string,
    projectId: r.project_id as string,
    deliveryId: (r.delivery_id as string) ?? null,
    key: r.key as string,
    title: r.title as string,
    description: r.description as string,
    acceptance: r.acceptance as string,
    kind: r.kind as TaskKind,
    assigneeId: r.assignee_id as string,
    status: r.status as TaskStatus,
    dependsOn: this.depsFor(r.id as string),
    sortOrder: r.sort_order as number,
    attempts: r.attempts as number,
    sessionId: (r.session_id as string) ?? null,
    resultSummary: (r.result_summary as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    changedFiles: JSON.parse(r.changed_files as string),
    rationale: (r.rationale as string) ?? null,
    size: ((r.size as string) ?? 'm') as Task['size'],
    files: JSON.parse((r.files as string) ?? '[]'),
    validation: JSON.parse((r.validation as string) ?? '[]'),
    checks: (JSON.parse((r.checks as string) ?? '[]') as CheckResult[]).map((c) => ({ ...c, status: checkStatus(c) })),
    model: (r.model as string) ?? null,
    fixAttempts: (r.fix_attempts as number) ?? 0,
    conflicts: (r.conflicts as number) ?? 0,
    priority: (r.priority as number) ?? 0,
    skills: JSON.parse((r.skills as string) ?? '[]'),
    consults: (r.consults as number) ?? 0,
    note: (r.note as string) ?? null,
    startedAt: (r.started_at as number) ?? null,
    finishedAt: (r.finished_at as number) ?? null,
    qualityPlan: r.quality_plan ? JSON.parse(r.quality_plan as string) : null,
    criteria: JSON.parse((r.criteria as string) ?? '[]'),
    repairStop: (r.repair_stop as string) ?? null,
    recovery: r.recovery ? JSON.parse(r.recovery as string) : null,
    milestone: (r.milestone as number) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number
  })

  /** Replaces any not-yet-started tasks of a project with a freshly proposed plan. */
  replaceProposedTasks(projectId: string, tasks: NewTask[]): Task[] {
    const now = Date.now()
    const ids = new Map<string, string>()
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM tasks WHERE project_id = ? AND status = 'proposed'`).run(projectId)
      const base = (
        this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE project_id = ?').get(projectId) as {
          n: number
        }
      ).n
      const ins = this.db.prepare(
        `INSERT INTO tasks (id, project_id, key, title, description, acceptance, kind, assignee_id, status, sort_order,
           rationale, size, files, validation, skills, priority, milestone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      tasks.forEach((t, i) => {
        const id = randomUUID()
        ids.set(t.key, id)
        ins.run(
          id,
          projectId,
          t.key,
          t.title,
          t.description,
          t.acceptance,
          t.kind,
          t.assigneeId,
          base + i,
          t.rationale ?? null,
          t.size ?? 'm',
          JSON.stringify(t.files ?? []),
          JSON.stringify(t.validation ?? []),
          JSON.stringify(t.skills ?? []),
          t.priority ?? 0,
          t.milestone ?? null,
          now,
          now
        )
      })
      const dep = this.db.prepare('INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)')
      for (const t of tasks) {
        for (const k of t.dependsOnKeys) {
          const target = ids.get(k)
          if (target && target !== ids.get(t.key)) dep.run(ids.get(t.key), target)
        }
      }
    })()
    return this.tasks(projectId)
  }

  /** Adds one task outside of a plan (e.g. a fix routed back from QA). It starts as pending. */
  insertTask(projectId: string, t: NewTask): Task {
    const now = Date.now()
    const id = randomUUID()
    const order = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE project_id = ?').get(projectId) as { n: number }).n
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, key, title, description, acceptance, kind, assignee_id, status, sort_order,
           rationale, size, files, validation, skills, priority, milestone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, t.key, t.title, t.description, t.acceptance, t.kind, t.assigneeId, order, t.rationale ?? null, t.size ?? 'm', JSON.stringify(t.files ?? []), JSON.stringify(t.validation ?? []), JSON.stringify(t.skills ?? []), t.priority ?? 0, t.milestone ?? null, now, now)
    return this.task(id)
  }

  addDependency(taskId: string, dependsOn: string): void {
    this.db.prepare('INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)').run(taskId, dependsOn)
  }

  tasks(projectId: string): Task[] {
    return (
      this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order').all(projectId) as Row[]
    ).map(this.toTask)
  }

  task(id: string): Task {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Task ${id} not found`)
    return this.toTask(r)
  }

  tasksWithStatus(status: TaskStatus): Task[] {
    return (this.db.prepare('SELECT * FROM tasks WHERE status = ?').all(status) as Row[]).map(this.toTask)
  }

  updateTask(
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'status'
        | 'sessionId'
        | 'resultSummary'
        | 'lastError'
        | 'changedFiles'
        | 'attempts'
        | 'checks'
        | 'model'
        | 'fixAttempts'
        | 'conflicts'
        | 'startedAt'
        | 'finishedAt'
        | 'validation'
        | 'priority'
        | 'consults'
        | 'note'
        | 'deliveryId'
        | 'qualityPlan'
        | 'criteria'
        | 'repairStop'
        | 'recovery'
        | 'milestone'
      >
    >
  ): Task {
    const cols: Record<string, string> = {
      status: 'status',
      sessionId: 'session_id',
      resultSummary: 'result_summary',
      lastError: 'last_error',
      changedFiles: 'changed_files',
      attempts: 'attempts',
      checks: 'checks',
      model: 'model',
      fixAttempts: 'fix_attempts',
      conflicts: 'conflicts',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      validation: 'validation',
      priority: 'priority',
      consults: 'consults',
      note: 'note',
      deliveryId: 'delivery_id',
      qualityPlan: 'quality_plan',
      criteria: 'criteria',
      repairStop: 'repair_stop',
      recovery: 'recovery',
      milestone: 'milestone'
    }
    const json = new Set(['changedFiles', 'checks', 'validation', 'qualityPlan', 'criteria', 'recovery'])
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${cols[k]} = ?`)
      vals.push(json.has(k) ? JSON.stringify(v) : v)
    }
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.task(id)
  }

  setProposedTasksStatus(projectId: string, status: TaskStatus): void {
    this.db
      .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE project_id = ? AND status = 'proposed'`)
      .run(status, Date.now(), projectId)
  }

  // ── runs ─────────────────────────────────────────────────────
  createRun(r: Pick<Run, 'projectId' | 'taskId' | 'employeeId' | 'kind' | 'cwd' | 'model' | 'purpose'>): Run {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, task_id, employee_id, kind, status, cwd, model, purpose, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`
      )
      .run(id, r.projectId, r.taskId, r.employeeId, r.kind, r.cwd, r.model, r.purpose, Date.now())
    return this.run(id)
  }

  run(id: string): Run {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Run ${id} not found`)
    return toRun(r)
  }

  runs(projectId: string, limit = 50): Run[] {
    return (
      this.db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?').all(projectId, limit) as Row[]
    ).map(toRun)
  }

  runsWithStatus(status: RunStatus): Run[] {
    return (this.db.prepare('SELECT * FROM runs WHERE status = ?').all(status) as Row[]).map(toRun)
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<
        Run,
        | 'status'
        | 'sessionId'
        | 'costUsd'
        | 'numTurns'
        | 'error'
        | 'endedAt'
        | 'model'
        | 'inputTokens'
        | 'outputTokens'
        | 'cacheReadTokens'
        | 'cacheWriteTokens'
        | 'durationMs'
        | 'apiMs'
        | 'contextChars'
        | 'exploreCalls'
        | 'contextIds'
        | 'skills'
        | 'effort'
      > & { pid: number | null }
    >
  ): Run {
    const cols: Record<string, string> = {
      status: 'status',
      sessionId: 'session_id',
      costUsd: 'cost_usd',
      numTurns: 'num_turns',
      error: 'error',
      endedAt: 'ended_at',
      model: 'model',
      inputTokens: 'input_tokens',
      outputTokens: 'output_tokens',
      cacheReadTokens: 'cache_read_tokens',
      cacheWriteTokens: 'cache_write_tokens',
      durationMs: 'duration_ms',
      apiMs: 'api_ms',
      pid: 'pid',
      contextChars: 'context_chars',
      exploreCalls: 'explore_calls',
      contextIds: 'context_ids',
      skills: 'skills',
      effort: 'effort'
    }
    const sets = Object.keys(patch).map((k) => `${cols[k]} = ?`)
    if (!sets.length) return this.run(id)
    this.db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...Object.entries(patch).map(([k, v]) => (k === 'contextIds' || k === 'skills' ? JSON.stringify(v) : v)), id)
    return this.run(id)
  }

  /** Process ids of runs still marked running (for orphan cleanup after a crash). */
  runningPids(): { id: string; pid: number }[] {
    return this.db.prepare(`SELECT id, pid FROM runs WHERE status = 'running' AND pid IS NOT NULL`).all() as { id: string; pid: number }[]
  }

  allRuns(projectId: string): Run[] {
    return (this.db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at').all(projectId) as Row[]).map(toRun)
  }

  // ── run events ───────────────────────────────────────────────
  addEvent(e: {
    runId: string
    seq: number
    kind: RunEventKind
    summary: string
    detail?: string | null
    toolName?: string | null
    isError?: boolean
  }): RunEvent {
    const info = this.db
      .prepare(
        `INSERT INTO run_events (run_id, seq, ts, kind, summary, detail, tool_name, is_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.runId, e.seq, Date.now(), e.kind, e.summary, e.detail ?? null, e.toolName ?? null, e.isError ? 1 : 0)
    return toEvent(this.db.prepare('SELECT * FROM run_events WHERE id = ?').get(info.lastInsertRowid) as Row)
  }

  events(runId: string): RunEvent[] {
    return (this.db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY seq').all(runId) as Row[]).map(toEvent)
  }

  // ── approvals ────────────────────────────────────────────────
  createApproval(a: Pick<Approval, 'projectId' | 'taskId' | 'kind' | 'title' | 'body'>): Approval {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO approvals (id, project_id, task_id, kind, status, title, body, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(id, a.projectId, a.taskId, a.kind, a.title, a.body, Date.now())
    return this.approval(id)
  }

  approval(id: string): Approval {
    const r = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error(`Approval ${id} not found`)
    return toApproval(r)
  }

  approvals(projectId: string): Approval[] {
    return (
      this.db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]
    ).map(toApproval)
  }

  pendingApprovalsOfKind(kind: ApprovalKind): Approval[] {
    return (this.db.prepare(`SELECT * FROM approvals WHERE status = 'pending' AND kind = ?`).all(kind) as Row[]).map(toApproval)
  }

  pendingApprovals(projectId: string): Approval[] {
    return this.approvals(projectId).filter((a) => a.status === 'pending')
  }

  resolveApproval(id: string, resolution: string): Approval {
    this.db
      .prepare(`UPDATE approvals SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`)
      .run(resolution, Date.now(), id)
    return this.approval(id)
  }
}
