// Deterministic replay of recorded runs (no AI calls): rebuilds each task session's Bash evidence from
// the app's stored run events and re-evaluates the task's required checks with the current matcher and
// with the matcher as it was before the check-chain change, to measure sessions spent on re-running
// checks that had in fact already passed.
import { evaluateChecks, normalizeClaims, type BashEvidence } from '../../src/shared/checks'
import { AppDriver } from './autopia'

/** The pre-change matcher, kept verbatim for before/after comparison. */
function legacyRunsCheck(required: string, ran: string): boolean {
  const norm = (c: string) => c.replace(/\s+/g, ' ').trim().replace(/\s+2>&1$/, '')
  const want = norm(required)
  const parts = norm(ran).split(' && ')
  const last = norm(parts[parts.length - 1])
  if (last !== want) return false
  return !/[|;]/.test(last.replace(want, ''))
}
const legacyMissing = (required: string[], ev: BashEvidence[]) => required.filter((c) => !ev.some((e) => legacyRunsCheck(c, e.command)))

interface Ev { kind: string; toolName: string | null; detail: string | null; isError: boolean; ts: number }
interface Snap {
  tasks: { id: string; key: string; title: string; validation: string[] }[]
  runs: { id: string; taskId: string | null; kind: string; purpose: string; status: string; startedAt: number; costUsd: number | null; endedAt: number | null }[]
}

export async function replay(log: (m: string) => void): Promise<void> {
  const app = await AppDriver.connect()
  const projects = (await app.call<{ projects: { id: string; name: string }[] }>('bootstrap')).projects
  let fixRuns = 0, fixCost = 0, avoidable = 0, avoidableCost = 0, avoidableMs = 0
  for (const p of projects) {
    const snap = await app.call<Snap>('getProject', p.id)
    for (const task of snap.tasks) {
      const runs = snap.runs.filter((r) => r.taskId === task.id && r.kind === 'task').sort((a, b) => a.startedAt - b.startedAt)
      const evidence: BashEvidence[] = []
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i]
        const events = await app.call<Ev[]>('runEvents', r.id)
        const open: string[] = []
        for (const e of events) {
          if (e.kind === 'tool_use' && e.toolName === 'Bash') open.push((JSON.parse(e.detail ?? '{}') as { command?: string }).command ?? '')
          if (e.kind === 'tool_result' && e.toolName === 'Bash' && open.length)
            evidence.push({ command: open.shift()!, isError: e.isError, output: e.detail ?? '', ms: 0, at: e.ts, founderDenied: false, policyDenied: false })
        }
        const next = runs[i + 1]
        if (!next || next.purpose !== 'fix' || r.status !== 'succeeded') continue
        fixRuns++
        fixCost += next.costUsd ?? 0
        // the required list Autopia ended up with (claims + plan + gates), servers excluded as at run time
        const required = normalizeClaims(task.validation)
        // before the change, setup commands an agent listed as checks (npm install, open file) were required too
        const legacyRequired = [...new Set([...required, ...task.validation.filter((v) => /^(npm (install|i|ci)|yarn( install)?|pnpm (install|i)|pip3? install|open)(\s|$)/.test(v.trim()))])]
        const before = legacyMissing(legacyRequired, evidence)
        const after = evaluateChecks(required, evidence).filter((c) => c.status === 'missing').map((c) => c.command)
        const failedAfter = evaluateChecks(required, evidence).filter((c) => c.status === 'failed').length
        const saved = before.length > 0 && after.length === 0 && failedAfter === 0
        if (saved) (avoidable++, (avoidableCost += next.costUsd ?? 0), (avoidableMs += (next.endedAt ?? next.startedAt) - next.startedAt))
        log(`${p.name.slice(0, 18).padEnd(18)} ${task.title.slice(0, 34).padEnd(34)} fix $${(next.costUsd ?? 0).toFixed(2)}  missing before: ${before.length}  after: ${after.length}${saved ? '  → avoidable' : ''}`)
        for (const m of after) log(`      still missing: ${m.slice(0, 90)}`)
      }
    }
  }
  app.close()
  log(`\n${fixRuns} fix session(s) followed a successful session, $${fixCost.toFixed(2)} in total.`)
  log(`${avoidable} of them re-ran checks that the recorded evidence shows had already passed ($${avoidableCost.toFixed(2)}, ${(avoidableMs / 60000).toFixed(1)} agent-minutes).`)
}
