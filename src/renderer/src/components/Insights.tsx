import { useEffect, useState } from 'react'
import { Loading } from './ui'
import type { ProjectMetrics, RunPurpose } from '@shared/types'
import { activeProject, sortedTasks, useApp } from '../store'
import { Avatar, Icon, ROLE_COLOR, money, useNaming, useTicker } from './common'

const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

const PURPOSE_LABEL: Record<RunPurpose, string> = { plan: 'Planning', work: 'Implementation', retry: 'Retry', fix: 'Fix after check', resolve: 'Conflict resolution', validate: 'Validation', ask: 'Question' }

/** Time and cost. Every number is computed in the main process from recorded runs and checks. */
export function Insights() {
  const naming = useNaming()
  const project = useApp(activeProject)!
  const runs = useApp((s) => s.runs)
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const everyone = useApp((s) => s.allEmployees)
  const [m, setM] = useState<ProjectMetrics | null>(null)
  const live = Object.values(runs).some((r) => r.status === 'running')
  useTicker(live, 1000)

  // Event-driven refresh: recompute when runs or tasks change, debounced.
  useEffect(() => {
    const t = setTimeout(() => void window.autopia.getMetrics(project.id).then(setM), 250)
    return () => clearTimeout(t)
  }, [project.id, runs, tasks])

  if (!m) return <Loading>Loading metrics…</Loading>
  if (!m.sessions) {
    return (
      <div className="empty">
        <div className="empty-mark">
          <Icon name="activity" size={22} />
        </div>
        <h3>No measurements yet</h3>
        <p>Metrics appear once the team runs its first Claude Code session. Idle employees never consume tokens.</p>
      </div>
    )
  }

  const now = Date.now()
  const start = Math.min(...m.timeline.map((b) => b.start), ...tasks.flatMap((t) => t.checks.map((c) => c.at)))
  const end = Math.max(...m.timeline.map((b) => b.end ?? now), ...tasks.flatMap((t) => t.checks.map((c) => c.at + c.ms)))
  const span = Math.max(1, end - start)
  const pct = (t: number) => `${((t - start) / span) * 100}%`
  const width = (a: number, b: number) => `${Math.max(0.6, ((b - a) / span) * 100)}%`

  const phases = [
    { k: 'Planning', v: m.planningMs, c: 'var(--accent)' },
    { k: 'Implementation', v: m.workMs, c: 'var(--info)' },
    { k: 'Fixes', v: m.fixMs, c: 'var(--warn)' },
    { k: 'Local checks', v: m.validationMs, c: 'var(--ok)' }
  ]
  const phaseTotal = phases.reduce((n, p) => n + p.v, 0) || 1
  const lanes = employees.filter((e) => m.timeline.some((b) => b.employeeId === e.id) || tasks.some((t) => t.assigneeId === e.id && t.checks.length))

  return (
    <div className="insights">
      <div className="metric-grid">
        <Metric label="Wall time" value={fmtMs(m.wallMs)} hint="First session start to last activity" />
        <Metric label="Executing" value={fmtMs(m.activeMs)} hint="Time anything was running (union of sessions and checks)" />
        <Metric label="Waiting" value={fmtMs(m.waitingMs)} hint="Wall time with nothing executing: approvals, decisions, idle" />
        <Metric label="Parallelism" value={`${m.parallelism.toFixed(2)}×`} hint="Agent time ÷ time with at least one session running" />
        <Metric label="Sessions" value={String(m.sessions)} hint="Claude Code processes launched" />
        <Metric label="Retries · fixes" value={String(m.retries)} hint="Manual retries plus automatic bounded fixes" />
        <Metric label="Failures" value={String(m.failures)} tone={m.failures ? 'bad' : undefined} />
        <Metric label="Conflicts" value={String(m.conflicts)} tone={m.conflicts ? 'warn' : undefined} hint="Merge conflicts detected before integration" />
      </div>

      <section className="card">
        <div className="card-head">
          <span className="section-label">Usage</span>
          <span className="muted small">
            CLI-reported · {m.meteredRuns}/{m.sessions} sessions metered
          </span>
        </div>
        <div className="usage-row">
          <div>
            <strong>{money(m.costUsd)}</strong>
            <span>cost</span>
          </div>
          <div>
            <strong>{fmtTok(m.inputTokens)}</strong>
            <span>input</span>
          </div>
          <div>
            <strong>{fmtTok(m.cacheReadTokens)}</strong>
            <span>cache read</span>
          </div>
          <div>
            <strong>{fmtTok(m.cacheWriteTokens)}</strong>
            <span>cache write</span>
          </div>
          <div>
            <strong>{fmtTok(m.outputTokens)}</strong>
            <span>output</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="section-label">Timeline</span>
          <span className="muted small">overlapping bars ran in parallel</span>
        </div>
        <div className="gantt">
          {lanes.map((e) => (
            <div className="lane" key={e.id}>
              <span className="lane-who">
                <Avatar employee={e} size={18} />
                {e.name.split(' ')[0]}
              </span>
              <div className="lane-track">
                {m.timeline
                  .filter((b) => b.employeeId === e.id)
                  .map((b) => {
                    const t = tasks.find((x) => x.id === b.taskId)
                    return (
                      <span
                        key={b.runId}
                        className={`bar p-${b.purpose} s-${b.status}`}
                        style={{ left: pct(b.start), width: width(b.start, b.end ?? now), ['--role' as string]: ROLE_COLOR[e.role] }}
                        data-tip={`${t ? `${naming.refOf(t, 40)} · ` : ''}${PURPOSE_LABEL[b.purpose]} · ${fmtMs((b.end ?? now) - b.start)} · ${b.status}`}
                      />
                    )
                  })}
                {tasks
                  .filter((t) => t.assigneeId === e.id)
                  .flatMap((t) => t.checks.map((c, i) => ({ t, c, i })))
                  .map(({ t, c, i }) => (
                    <span
                      key={`${t.id}-${i}`}
                      className={`bar check ${c.ok ? 'ok' : 'bad'}`}
                      style={{ left: pct(c.at), width: width(c.at, c.at + c.ms) }}
                      data-tip={`${naming.refOf(t, 40)} · local check · ${c.command} · ${c.ok ? 'passed' : 'failed'} · ${fmtMs(c.ms)}`}
                    />
                  ))}
              </div>
            </div>
          ))}
          <div className="gantt-axis">
            <span>{new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="section-label">Where the time went</span>
        </div>
        <div className="phase-bar">{phases.map((p) => p.v > 0 && <span key={p.k} style={{ width: `${(p.v / phaseTotal) * 100}%`, background: p.c }} data-tip={`${p.k} · ${fmtMs(p.v)}`} />)}</div>
        <div className="phase-legend">
          {phases.map((p) => (
            <span key={p.k}>
              <i style={{ background: p.c }} /> {p.k} <strong>{fmtMs(p.v)}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="section-label">Team utilization</span>
          <span className="muted small">busy ÷ wall time</span>
        </div>
        <ul className="util">
          {m.employees
            .filter((u) => u.sessions > 0)
            .map((u) => {
              const e = employees.find((x) => x.id === u.employeeId) ?? everyone.find((x) => x.id === u.employeeId)
              if (!e) return null
              return (
                <li key={u.employeeId} className={u.sessions ? '' : 'inactive'}>
                  <Avatar employee={e} size={22} />
                  <span className="util-name">{e.name.split(' ')[0]}</span>
                  <span className="util-track">
                    <span style={{ width: `${Math.min(100, u.utilization * 100)}%`, background: ROLE_COLOR[e.role] }} />
                  </span>
                  <span className="util-num">{u.sessions ? `${Math.round(u.utilization * 100)}% · ${u.sessions} · ${money(u.costUsd)}` : 'not activated · $0'}</span>
                </li>
              )
            })}
        </ul>
      </section>
    </div>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`} data-tip={hint}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
