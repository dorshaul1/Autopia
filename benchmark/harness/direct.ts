// Baseline: the same request given straight to Claude Code (one session, resumed for follow-ups and
// after interruptions), with the same permission profile Autopia's agents use. No Autopia prompts,
// memory, skills, planning or checks.
import { randomUUID } from 'node:crypto'
import { detectClaude, startClaudeRun, type RunHandle } from '../../src/main/claude/cli'
import type { ParsedEvent } from '../../src/main/claude/streamParser'
import { benchPermission, type RunRecord } from './results'
import { changes, runChecks, type Sandbox } from './sandbox'
import { stepChecks, type Scenario } from './scenarios'

const RESUME_AFTER_INTERRUPT = 'Your previous session was interrupted part-way through. Check the current state of the files, then continue and finish the task.'

export async function runDirect(s: Scenario, sb: Sandbox, label: string, log: (m: string) => void): Promise<RunRecord> {
  const claude = await detectClaude()
  if (!claude.available || !claude.path) throw new Error(`Claude Code is not available: ${claude.error}`)
  const rec: RunRecord = {
    id: randomUUID(), scenario: s.id, mode: 'direct', label, startedAt: Date.now(), wallMs: 0, sessions: 0, costUsd: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: 0, tools: {}, permissionDenials: 0, decisions: [],
    interrupted: false, stepResults: [], checks: [], pass: false, changes: { files: 0, added: 0, removed: 0, paths: [] },
    overBudget: false, error: null, claudeVersion: claude.version, model: null
  }
  const sessionId = randomUUID()
  const deadline = rec.startedAt + s.budget.minutes * 60_000
  let started = false

  const session = async (prompt: string, interruptAfter?: number): Promise<'ok' | 'interrupted' | 'failed'> => {
    const remainingUsd = s.budget.usd - rec.costUsd
    if (remainingUsd <= 0.01 || Date.now() > deadline) return (rec.overBudget = true), 'failed'
    rec.sessions++
    let handle: RunHandle | null = null
    let interrupted = false
    const onEvent = (e: ParsedEvent) => {
      if (e.kind === 'init') rec.model ??= e.model
      if (e.kind === 'tool_use') rec.tools[e.name] = (rec.tools[e.name] ?? 0) + 1
      if (e.kind === 'result') {
        rec.costUsd += e.costUsd ?? 0
        rec.turns += e.numTurns ?? 0
        if (e.usage) {
          rec.tokens.input += e.usage.inputTokens
          rec.tokens.output += e.usage.outputTokens
          rec.tokens.cacheRead += e.usage.cacheReadTokens
          rec.tokens.cacheWrite += e.usage.cacheWriteTokens
        }
      }
    }
    handle = await startClaudeRun(
      claude.path!,
      {
        cwd: sb.repo, prompt, systemPrompt: '', model: '', sessionId, resume: started, mode: 'write', permissionProfile: 'standard',
        maxBudgetUsd: Math.max(0.05, Math.round(remainingUsd * 100) / 100), settingSources: 'project,local'
      },
      onEvent,
      () => {},
      async (req) => {
        const subject = typeof req.input.command === 'string' ? req.input.command : `${req.toolName} ${JSON.stringify(req.input)}`
        if (benchPermission(subject) === 'allow') {
          rec.permissionAllows = (rec.permissionAllows ?? 0) + 1
          return { behavior: 'allow' }
        }
        rec.permissionDenials++
        log(`  permission declined: ${subject.slice(0, 120)}`)
        return { behavior: 'deny', message: 'Not permitted in this benchmark run.' }
      }
    )
    started = true
    const timers = [
      setTimeout(() => ((rec.overBudget = true), handle!.cancel()), Math.max(1000, deadline - Date.now())),
      ...(interruptAfter ? [setTimeout(() => ((interrupted = true), log(`  interrupting after ${interruptAfter}s`), handle!.cancel()), interruptAfter * 1000)] : [])
    ]
    const out = await handle.done
    timers.forEach(clearTimeout)
    if (interrupted) return 'interrupted'
    if (!out.ok) rec.error = out.result?.errors.join('; ') || out.stderr.slice(-500) || `exit ${out.exitCode}`
    return out.ok ? 'ok' : 'failed'
  }

  for (let i = 0; i < s.steps.length; i++) {
    const step = s.steps[i]
    log(`  step ${i + 1}/${s.steps.length}: direct Claude Code session`)
    let r = await session(step.request, step.interrupt?.afterSeconds)
    if (r === 'interrupted') {
      rec.interrupted = true
      r = await session(RESUME_AFTER_INTERRUPT)
    }
    const checks = stepChecks(s, i)
    if (checks.length && i < s.steps.length - 1) rec.stepResults.push({ step: i + 1, checks: await runChecks(s, sb, checks) })
    if (r === 'failed') break
  }
  rec.wallMs = Date.now() - rec.startedAt
  rec.checks = await runChecks(s, sb, s.verify)
  rec.pass = rec.checks.every((c) => c.ok) && rec.stepResults.every((st) => st.checks.every((c) => c.ok))
  rec.changes = changes(s, sb)
  return rec
}
