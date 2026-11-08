// Autopia mode: the same request sent through the running app exactly as a founder would (Composer
// message → plan/triage → agents → checks → result), driven over the Chrome DevTools protocol.
// Start the app with `npx electron-vite dev --remoteDebuggingPort 9333` (ideally with a separate
// AUTOPIA_USER_DATA so benchmark projects never mix with your own).
import { randomUUID } from 'node:crypto'
import { benchPermission, type RunRecord } from './results'
import { changes, runChecks, type Sandbox } from './sandbox'
import { stepChecks, type Scenario } from './scenarios'

const PORT = Number(process.env.AUTOPIA_CDP_PORT) || 9333

export class AppDriver {
  private ws!: WebSocket
  private seq = 0

  static async connect(): Promise<AppDriver> {
    const d = new AppDriver()
    let targets: { type: string; url: string; webSocketDebuggerUrl: string }[]
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    } catch {
      throw new Error(`Autopia is not running with --remoteDebuggingPort ${PORT}`)
    }
    const page = targets.find((t) => t.type === 'page' && /^(http:\/\/localhost|file:)/.test(t.url))
    if (!page) throw new Error('No Autopia window found')
    d.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, j) => (d.ws.addEventListener('open', r), d.ws.addEventListener('error', j)))
    return d
  }

  /** Calls window.autopia.<method>(...args) in the app and returns the JSON result. */
  call<T>(method: string, ...args: unknown[]): Promise<T> {
    const expression = `window.autopia.${method}(...${JSON.stringify(args)}).then((r) => JSON.stringify(r ?? null))`
    const id = ++this.seq
    return new Promise((res, rej) => {
      const h = (m: MessageEvent) => {
        const d = JSON.parse(String(m.data))
        if (d.id !== id) return
        this.ws.removeEventListener('message', h)
        const r = d.result
        if (r?.exceptionDetails) rej(new Error(`${method}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`))
        else res(JSON.parse(r.result.value))
      }
      this.ws.addEventListener('message', h)
      this.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  }

  close(): void {
    this.ws.close()
  }
}

interface Snap {
  project: { id: string; phase: string }
  tasks: { id: string; status: string; title: string; lastError: string | null }[]
  runs: { id: string; status: string; kind: string; startedAt: number; endedAt: number | null; costUsd: number | null; numTurns: number | null; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; model: string | null }[]
  approvals: { id: string; kind: string; status: string; title: string; taskId: string | null; body: string }[]
}
interface Delivery { id: string; number: number; status: string; createdAt: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ACTIVE = new Set(['pending', 'running', 'merging', 'proposed'])

/**
 * `minimal`: the first request is started as one direct task (Autopia's agent, memory, checks and QA,
 * but no triage, planning or delegation), the closest Autopia gets to plain Claude Code.
 */
export async function runAutopia(s: Scenario, sb: Sandbox, label: string, log: (m: string) => void, minimal = false): Promise<RunRecord> {
  const app = await AppDriver.connect()
  const rec: RunRecord = {
    id: randomUUID(), scenario: s.id, mode: minimal ? 'autopia-minimal' : 'autopia', label, startedAt: Date.now(), wallMs: 0, sessions: 0, costUsd: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: 0, tools: {}, permissionDenials: 0, decisions: [],
    interrupted: false, stepResults: [], checks: [], pass: false, changes: { files: 0, added: 0, removed: 0, paths: [] },
    overBudget: false, error: null, claudeVersion: null, model: null
  }
  const deadline = rec.startedAt + s.budget.minutes * 60_000
  const boot = await app.call<{ claude: { version: string | null } }>('bootstrap')
  rec.claudeVersion = boot.claude?.version ?? null

  const project = await app.call<{ id: string }>('createProject', { name: `bench ${s.id}`, goal: s.steps[0].request, mode: 'open', directory: sb.repo, initGit: true })
  await app.call('setProjectControls', project.id, { budgetUsd: s.budget.usd })
  let lastDelivery: Delivery | null = null
  try {
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i]
      log(`  step ${i + 1}/${s.steps.length}: sent to Autopia`)
      const sentAt = Date.now()
      if (i === 0 && minimal) await app.call('kickoff', project.id, 'direct')
      else
        await app.call('sendMessage', {
          projectId: project.id, intent: i === 0 ? 'build' : 'change', text: step.request, attachments: [], employeeId: null, taskId: null, deliveryId: i === 0 ? null : lastDelivery?.id ?? null
        })
      let interruptDone = !step.interrupt
      let retried = false
      for (;;) {
        await sleep(4000)
        if (Date.now() > deadline) {
          rec.overBudget = true
          throw new Error('time budget used')
        }
        const snap = await app.call<Snap>('getProject', project.id)
        // interruption: cancel the first running task session once, then retry it like a founder would
        if (!interruptDone) {
          const first = snap.runs.filter((r) => r.kind === 'task' && r.startedAt >= sentAt).sort((a, b) => a.startedAt - b.startedAt)[0]
          const task = snap.tasks.find((t) => t.status === 'running')
          if (first && task && Date.now() - first.startedAt > step.interrupt!.afterSeconds * 1000) {
            log(`  interrupting ${task.title} after ${step.interrupt!.afterSeconds}s`)
            await app.call('cancelTask', task.id)
            rec.interrupted = true
            interruptDone = true
            continue
          }
        }
        const pending = snap.approvals.filter((a) => a.status === 'pending')
        for (const a of pending) {
          const decision = decide(a, retried && rec.interrupted, rec)
          if (!decision) throw new Error(`stopped at "${a.title}": ${a.body.split('\n')[0].slice(0, 200)}`)
          if (a.kind === 'task_failed') retried = true
          if (a.kind === 'permission' && (decision as { action?: string }).action === 'deny') rec.permissionDenials++
          rec.decisions.push(`${a.kind}: ${JSON.stringify(decision).slice(0, 80)}`)
          log(`  ${a.kind} → ${JSON.stringify(decision)}`)
          await app.call('resolveApproval', a.id, decision)
        }
        if (pending.length) continue
        const deliveries = await app.call<Delivery[]>('deliveries', project.id)
        const current = deliveries.filter((d) => d.createdAt >= sentAt - 1000).sort((a, b) => b.number - a.number)[0]
        const busy = snap.project.phase === 'planning' || snap.tasks.some((t) => ACTIVE.has(t.status))
        if (current && !busy && ['review', 'accepted', 'rejected'].includes(current.status)) {
          lastDelivery = current
          if (current.status === 'review') {
            await app.call('decideDelivery', current.id, 'accept', null)
            rec.decisions.push(`delivery #${current.number}: accept`)
          }
          break
        }
        if (!busy && ['failed', 'blocked'].includes(snap.project.phase)) throw new Error(`project ${snap.project.phase}: ${snap.tasks.map((t) => t.lastError).filter(Boolean).join('; ').slice(0, 300)}`)
      }
      const checks = stepChecks(s, i)
      if (checks.length && i < s.steps.length - 1) rec.stepResults.push({ step: i + 1, checks: await runChecks(s, sb, checks) })
    }
  } catch (e) {
    rec.error = (e as Error).message
    log(`  ${rec.error}`)
    const snap = await app.call<Snap>('getProject', project.id)
    for (const t of snap.tasks.filter((t) => t.status === 'running')) await app.call('cancelTask', t.id).catch(() => {})
    if (snap.project.phase === 'planning') await app.call('cancelPlanning', project.id).catch(() => {})
  }
  rec.wallMs = Date.now() - rec.startedAt
  // metrics from the app's own run records (Claude Code result messages)
  const snap = await app.call<Snap>('getProject', project.id)
  for (const r of snap.runs) {
    rec.sessions++
    rec.costUsd += r.costUsd ?? 0
    rec.turns += r.numTurns ?? 0
    rec.tokens.input += r.inputTokens ?? 0
    rec.tokens.output += r.outputTokens ?? 0
    rec.tokens.cacheRead += r.cacheReadTokens ?? 0
    rec.tokens.cacheWrite += r.cacheWriteTokens ?? 0
    rec.model ??= r.model
    const events = await app.call<{ kind: string; toolName: string | null }[]>('runEvents', r.id)
    for (const e of events) if (e.kind === 'tool_use' && e.toolName) rec.tools[e.toolName] = (rec.tools[e.toolName] ?? 0) + 1
  }
  if (rec.costUsd > s.budget.usd) rec.overBudget = true
  app.close()
  rec.checks = await runChecks(s, sb, s.verify)
  rec.pass = !rec.error && rec.checks.every((c) => c.ok) && rec.stepResults.every((st) => st.checks.every((c) => c.ok))
  rec.changes = changes(s, sb)
  return rec
}

/**
 * What a founder would do, applied the same way every run. Plans are approved as proposed, questions get
 * "use your judgement", permission requests get the same answer as in direct mode (routine commands allowed, risky ones declined: see benchPermission), and
 * unverified results are accepted as delivered (the hidden checks judge them), and the only retry is the
 * one after a deliberate interruption. Anything else (a stuck task, a budget stop) ends the run.
 */
function decide(a: Snap['approvals'][number], alreadyRetried: boolean, rec: RunRecord): object | null {
  switch (a.kind) {
    case 'plan':
      return { kind: 'plan', action: 'approve' }
    case 'question':
      return { kind: 'question', answer: 'Use your best judgement and keep it simple.' }
    case 'permission': {
      let subject = a.body
      try {
        subject = (JSON.parse(a.body) as { subject?: string }).subject ?? a.body
      } catch {
        // plain-text body
      }
      if (benchPermission(subject) === 'allow') {
        rec.permissionAllows = (rec.permissionAllows ?? 0) + 1
        return { kind: 'permission', action: 'allow' }
      }
      return { kind: 'permission', action: 'deny' }
    }
    case 'unverified':
      // accepted as-is; the benchmark's own hidden checks decide whether the work actually passes
      return { kind: 'unverified', action: 'accept' }
    case 'task_failed':
      return /Cancelled by founder/.test(a.body + a.title) && !alreadyRetried ? { kind: 'task_failed', action: 'retry' } : null
    default:
      return null
  }
}
