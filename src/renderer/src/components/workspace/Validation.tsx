import { useState } from 'react'
import { CHECK_STATUS_LABEL } from '@shared/checks'
import type { ValidationRun } from '@shared/types'
import { actions, store, useApp } from '../../store'
import { Icon, Pill, duration, timeAgo } from '../common'

const TONE: Record<ValidationRun['status'], 'ok' | 'danger' | 'warn' | 'info' | 'muted'> = {
  passed: 'ok',
  failed: 'danger',
  unverified: 'warn',
  running: 'info',
  error: 'muted',
  cancelled: 'muted'
}

/** Real check results only: what ran, what failed, and what policy or the founder kept from running. */
export function Validation({ embedded = false }: { embedded?: boolean } = {}) {
  const runs = useApp((s) => s.validations)
  const deliveries = useApp((s) => s.deliveries)
  const [open, setOpen] = useState<string | null>(runs[0]?.id ?? null)

  return (
    <div className={embedded ? 'validation' : 'ws-scroll ws-pad validation'}>
      <header className="val-head">
        <div>
          {embedded ? <h4>Check runs</h4> : <h3>Validation</h3>}
          <p className="muted small">
            What the team ran while working, and what you ran from Operations. A blocked or declined command is reported as such, never as a pass.
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => actions.goStage('operations')}>
          <Icon name="play" size={12} /> Run checks now
        </button>
      </header>

      {!runs.length && <p className="muted">No check runs yet. They appear here as the team works, or when you run them from Operations.</p>}

      <ul className="val-list">
        {runs.map((v) => {
          const d = deliveries.find((x) => x.id === v.deliveryId)
          const passed = v.checks.filter((c) => c.status === 'passed').length
          return (
            <li key={v.id} className={open === v.id ? 'open' : ''}>
              <button className="val-row" onClick={() => setOpen(open === v.id ? null : v.id)}>
                <Pill tone={TONE[v.status]} pulse={v.status === 'running'}>
                  {v.status}
                </Pill>
                <span className="val-title">
                  {v.trigger === 'ops' ? (v.command ?? 'A check you ran') : v.trigger === 'manual' ? 'Manual revalidation' : 'Task checks'}
                  {d && <span className="muted"> · #{d.number}</span>}
                </span>
                {v.checks.length > 0 && (
                  <span className="muted small">
                    {passed}/{v.checks.length} passed
                  </span>
                )}
                <span className="muted small">{v.endedAt ? duration(v.startedAt, v.endedAt) : ''}</span>
                <span className="muted small">{timeAgo(v.startedAt)}</span>
              </button>
              {open === v.id && (
                <div className="val-body">
                  {v.error && <div className="callout callout-danger small">{v.error}</div>}
                  <ul className="checks">
                    {v.checks.map((c, i) => (
                      <li key={i} className={c.ok ? 'ok' : c.status === 'failed' ? 'bad' : 'unverified'}>
                        <Icon name={c.ok ? 'check' : c.status === 'failed' ? 'close' : 'shield'} size={12} />
                        <span className="mono">{c.command}</span>
                        <span className="muted small">
                          {CHECK_STATUS_LABEL[c.status]}
                          {c.ms ? ` · ${(c.ms / 1000).toFixed(1)}s` : ''}
                        </span>
                        {!c.ok && c.output && <pre className="check-out">{c.output}</pre>}
                        {(c.status === 'blocked' || c.status === 'denied') && (
                          <span className="check-hint">
                            {c.status === 'blocked' ? 'Blocked by policy: see Settings → Claude Code & permissions.' : 'You declined it when Claude Code asked.'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {v.runId && (
                    <button className="btn btn-sm btn-ghost" onClick={() => store.setState({ section: 'activity', focusedRunId: v.runId })}>
                      View session log
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
