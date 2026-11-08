import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckRun, ChangeStats } from './sandbox'
import { BENCH_ROOT } from './scenarios'

export const RESULTS_FILE = join(BENCH_ROOT, 'results', 'runs.jsonl')

/** direct = plain Claude Code; autopia-minimal = through Autopia, forced to one direct task; autopia = Autopia's adaptive strategy. */
export type Mode = 'direct' | 'autopia-minimal' | 'autopia'

/** One measured run of one scenario. Every number here comes from Claude Code's own result messages or the clock. */
export interface RunRecord {
  id: string
  scenario: string
  mode: Mode
  /** Free label for what was being measured, e.g. "baseline" or "after-check-chains". */
  label: string
  startedAt: number
  wallMs: number
  /** Claude Code sessions/processes started (including resumes, fixes, planning, QA). */
  sessions: number
  costUsd: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  turns: number
  tools: Record<string, number>
  /** Permission requests the harness declined (see benchPermission). */
  permissionDenials: number
  /** Permission requests the harness allowed (routine commands a founder would approve). */
  permissionAllows?: number
  /** Founder-style decisions the harness made in Autopia mode (plan approvals, accepts). */
  decisions: string[]
  interrupted: boolean
  stepResults: { step: number; checks: CheckRun[] }[]
  checks: CheckRun[]
  pass: boolean
  changes: ChangeStats
  /** True when the run hit its time or cost budget. */
  overBudget: boolean
  error: string | null
  claudeVersion: string | null
  model: string | null
}

/**
 * The same founder-style answer to a permission prompt in every mode, so modes run under identical
 * permissions: routine commands are allowed (your organization's policy may require asking for them),
 * anything destructive, privileged, networked or history-rewriting is declined. Policy denials are
 * enforced by Claude Code itself and never reach this.
 */
export const RISKY_COMMAND = /\b(pkill|killall|kill\s|rm\s+-[a-z]*[rf]|sudo|curl|wget|ssh|scp|git\s+(push|reset|clean|checkout|rebase|commit))\b|>\s*\/(?!dev\/null)/

export function benchPermission(subject: string): 'allow' | 'deny' {
  return RISKY_COMMAND.test(subject) ? 'deny' : 'allow'
}

export function appendRecord(r: RunRecord): void {
  appendFileSync(RESULTS_FILE, JSON.stringify(r) + '\n')
}

export function readRecords(): RunRecord[] {
  if (!existsSync(RESULTS_FILE)) return []
  return readFileSync(RESULTS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord)
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}

/** Markdown summary of recorded runs: one row per scenario × mode × label, medians over repeats. */
export function summarise(records: RunRecord[]): string {
  if (!records.length) return '_No live runs recorded yet._\n'
  const groups = new Map<string, RunRecord[]>()
  for (const r of records) {
    const k = `${r.scenario}|${r.mode}|${r.label}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const rows = [...groups.entries()].sort().map(([k, rs]) => {
    const [scenario, mode, label] = k.split('|')
    const tok = (r: RunRecord) => r.tokens.input + r.tokens.cacheWrite + r.tokens.output
    return `| ${scenario} | ${mode} | ${label} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${(median(rs.map((r) => r.wallMs)) / 60000).toFixed(1)} | $${median(rs.map((r) => r.costUsd)).toFixed(2)} | ${Math.round(median(rs.map(tok)) / 1000)}k | ${median(rs.map((r) => r.sessions))} | ${median(rs.map((r) => r.turns))} | ${median(rs.map((r) => r.changes.files))} |`
  })
  const totals = (mode: string) => {
    const rs = records.filter((r) => r.mode === mode)
    return rs.length ? `${mode}: ${rs.filter((r) => r.pass).length}/${rs.length} passed, $${rs.reduce((a, r) => a + r.costUsd, 0).toFixed(2)} total` : null
  }
  return [
    '| Scenario | Mode | Label | Pass | Minutes (median) | Cost (median) | Non-cached tokens | Sessions | Turns | Files changed |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...(['direct', 'autopia-minimal', 'autopia'].map(totals).filter(Boolean) as string[]).map((t) => `- ${t}`)
  ].join('\n')
}
