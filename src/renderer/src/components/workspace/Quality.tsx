import { useEffect, useMemo, useState } from 'react'
import { Dialog, Loading } from '../ui'
import type { EvidenceStatus, QualityFinding, QualityOverview, QualityReport, Readiness } from '@shared/types'
import { activeProject, actions, useApp } from '../../store'
import { Icon, Pill, duration, money, timeAgo, useNaming, type Tone } from '../common'
import { Validation } from './Validation'

const STATUS: Record<EvidenceStatus, { label: string; tone: Tone; icon: 'check' | 'close' | 'shield' | 'alert' | 'skip' }> = {
  verified: { label: 'Verified', tone: 'ok', icon: 'check' },
  failed: { label: 'Failed', tone: 'danger', icon: 'close' },
  not_checked: { label: 'Not checked', tone: 'warn', icon: 'alert' },
  blocked: { label: 'Blocked', tone: 'warn', icon: 'shield' },
  na: { label: 'Not applicable', tone: 'muted', icon: 'skip' }
}

const VERDICT: Record<Readiness['verdict'], { label: string; tone: Tone; text: string }> = {
  ready: { label: 'Ready', tone: 'ok', text: 'Every applicable check has passing evidence.' },
  ready_with_exceptions: { label: 'Ready with documented exceptions', tone: 'info', text: 'Open items were accepted by you with a recorded reason.' },
  not_ready: { label: 'Not ready', tone: 'danger', text: 'Something failed. Request a focused repair or record an exception.' },
  unverified: { label: 'Not fully checked', tone: 'warn', text: 'Some checks haven’t run yet. Nothing counts as passed without a real result.' }
}

const SEV_TONE: Record<QualityFinding['severity'], Tone> = { high: 'danger', medium: 'warn', low: 'info', info: 'muted' }

/** Delivery readiness from real evidence only, with the actions that change it. */
export function Quality() {
  const naming = useNaming()
  const project = useApp(activeProject)!
  const deliveries = useApp((s) => s.deliveries)
  const validations = useApp((s) => s.validations)
  const pushed = useApp((s) => s.qualityReports)
  const tasks = useApp((s) => s.tasks)
  const [data, setData] = useState<QualityOverview | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [excepting, setExcepting] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = () => window.autopia.qualityOverview(project.id).then(setData)
  useEffect(() => {
    const t = setTimeout(() => void load(), 150)
    return () => clearTimeout(t)
  }, [project.id, deliveries, validations, pushed, tasks])

  const r = data?.readiness ?? null
  const delivery = r ? deliveries.find((d) => d.id === r.deliveryId) : null
  const running = (kind: QualityReport['kind']) => pushed.some((x) => x.kind === kind && x.status === 'running') || data?.reports.some((x) => x.kind === kind && x.status === 'running')
  const visual = data?.reports.find((x) => x.kind === 'visual' && x.deliveryId === r?.deliveryId && x.status !== 'running') ?? data?.reports.find((x) => x.kind === 'visual' && x.status !== 'running')
  const fkey = (f: QualityFinding) => `${f.rule}|${f.file}|${f.line}|${f.width}`
  const actionable = useMemo(() => (r?.findings ?? []).filter((f) => f.severity !== 'info'), [r])

  if (!data) return <Loading>Reading the evidence…</Loading>

  const repair = () => {
    if (!delivery) return
    const chosen = actionable.filter((f) => picked.has(fkey(f)))
    const failing = r!.dimensions.filter((d) => d.applies && d.status === 'failed' && !d.exception)
    const lines = [
      'Focused repair. Fix only these verified problems, keep everything else unchanged, and re-run the affected checks:',
      ...chosen.map((f) => `- [${f.dimension}/${f.severity}] ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''}${f.width ? ` at ${f.width}px` : ''})` : ''}`),
      ...(chosen.length ? [] : failing.flatMap((d) => d.evidence.slice(0, 2).map((e) => `- [${d.label}] ${e}`)))
    ]
    void actions.run(() => window.autopia.requestRevision(project.id, { deliveryId: delivery.id, text: lines.join('\n'), screenshot: null, taskId: null })).then(() => setPicked(new Set()))
  }

  return (
    <div className="ws-scroll ws-pad quality">
      <header className="val-head">
        <div>
          <h3>Quality</h3>
          <p className="muted small">
            Readiness comes only from evidence: check commands that actually ran, Autopia's static audit of the changed lines, and audits of the real running app. An agent saying it is done
            never counts.
          </p>
        </div>
        <div className="row gap">
          <button className="btn btn-sm" disabled={!!running('audit')} onClick={() => actions.run(() => window.autopia.runQualityAudit(project.id, r?.deliveryId ?? null))} data-tip="Local, no AI: scans the result's added lines">
            <Icon name="shield" size={12} /> {running('audit') ? 'Auditing…' : 'Static audit'}
          </button>
          <button className="btn btn-sm" disabled={!!running('visual')} onClick={() => actions.run(() => window.autopia.runVisualQa(project.id, r?.deliveryId ?? null))} data-tip="Real screenshots and DOM audit at 375, 768 and 1280 px (no AI)">
            <Icon name="eye" size={12} /> {running('visual') ? 'Inspecting…' : 'Visual QA'}
          </button>
        </div>
      </header>

      {!r ? (
        <p className="muted">No result yet. Checks run when the team hands work back to you.</p>
      ) : (
        <>
          <section className={`q-verdict q-${VERDICT[r.verdict].tone}`}>
            <div>
              <Pill tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Pill>
              <span className="muted small"> Result #{delivery?.number}</span>
              <p className="small">{VERDICT[r.verdict].text}</p>
            </div>
            {r.blockers.length > 0 && (
              <ul className="q-blockers small">
                {r.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="q-dims">
            {r.dimensions.filter((d) => d.applies).map((d) => {
              const st = STATUS[d.status]
              const open = d.applies && d.status !== 'verified'
              return (
                <article key={d.dimension} className={`q-dim${d.applies ? '' : ' na'}`}>
                  <header>
                    <strong>{d.label}</strong>
                    <Pill tone={d.exception ? 'info' : st.tone}>{d.exception ? 'Exception' : st.label}</Pill>
                  </header>
                  {d.evidence.slice(0, 3).map((e, i) => (
                    <p key={i} className="small muted q-ev">
                      {e}
                    </p>
                  ))}
                  {d.exception && <p className="small q-exc">“{d.exception}”</p>}
                  {open && delivery && excepting !== d.dimension && (
                    <div className="row gap">
                      {d.exception ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => actions.run(() => window.autopia.setQualityException(project.id, delivery.id, d.dimension, null)).then(load)}>
                          Remove exception
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => (setExcepting(d.dimension), setNote(''))}>
                          Accept with a note…
                        </button>
                      )}
                    </div>
                  )}
                  {excepting === d.dimension && delivery && (
                    <form
                      className="q-exc-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void actions.run(() => window.autopia.setQualityException(project.id, delivery.id, d.dimension, note)).then(() => (setExcepting(null), load()))
                      }}
                    >
                      <input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this is acceptable for this result" />
                      <button className="btn btn-sm btn-primary" disabled={note.trim().length < 4}>
                        Record
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setExcepting(null)}>
                        Cancel
                      </button>
                    </form>
                  )}
                </article>
              )
            })}
          </section>

          {r.criteria.length > 0 && (
            <section className="card">
              <h4>Acceptance criteria</h4>
              <p className="faint small">Reported by the implementer; counted as verified only together with passing checks.</p>
              <ul className="q-list">
                {r.criteria.map((c, i) => (
                  <li key={i}>
                    <Icon name={c.met ? 'check' : 'close'} size={12} /> <b>{naming.ownerOf(c.taskKey) ?? 'Teammate'}</b> {c.criterion} <span className="muted small">{c.evidence}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <header className="row between">
              <h4>Findings ({r.findings.length})</h4>
              {delivery && (delivery.status === 'review' || delivery.status === 'accepted') && (r.findings.length > 0 || r.dimensions.some((d) => d.status === 'failed' && !d.exception)) && (
                <button className="btn btn-sm btn-primary" disabled={!picked.size && !r.dimensions.some((d) => d.status === 'failed' && !d.exception)} onClick={repair}>
                  <Icon name="retry" size={12} /> Request focused repair{picked.size ? ` (${picked.size})` : ''}
                </button>
              )}
            </header>
            {!r.findings.length ? (
              <p className="muted small">Nothing found in the code scan or the visual check of this result.</p>
            ) : (
              <ul className="q-findings">
                {r.findings.map((f) => {
                  const k = fkey(f)
                  return (
                    <li key={k}>
                      {f.severity !== 'info' && (
                        <input
                          type="checkbox"
                          checked={picked.has(k)}
                          onChange={(e) => {
                            const next = new Set(picked)
                            if (e.target.checked) next.add(k)
                            else next.delete(k)
                            setPicked(next)
                          }}
                        />
                      )}
                      <Pill tone={SEV_TONE[f.severity]}>{f.severity}</Pill>
                      <span className="faint small">{f.dimension}</span>
                      {f.certainty && f.certainty !== 'verified' && (
                        <span className="faint small" data-tip={f.certainty === 'suspected' ? 'A pattern match or an unconfirmed measurement: check before acting' : 'A recommendation, not a defect'}>
                          {f.certainty === 'suspected' ? 'to confirm' : 'advice'}
                        </span>
                      )}
                      {f.inScope === false && <span className="faint small" data-tip="Already there before this result">existed before</span>}
                      <span>
                        {f.message}
                        {f.evidence ? <span className="faint"> {f.evidence}</span> : null}
                        {f.fix ? <span className="faint"> · {f.fix}</span> : null}
                      </span>
                      {f.file && (
                        <span className="mono small">
                          {f.file}
                          {f.line ? `:${f.line}` : ''}
                        </span>
                      )}
                      {f.width && <span className="faint small">{f.width}px</span>}
                      {f.count > 1 && <span className="faint small">×{f.count}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <VisualPanel report={visual ?? null} projectId={project.id} />

      {r && r.repairs.length > 0 && (
        <section className="card">
          <h4>Automatic repairs</h4>
          <table className="q-table small">
            <thead>
              <tr>
                <th>Task</th>
                <th>Attempts</th>
                <th>Tokens</th>
                <th>Time</th>
                <th>Cost</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {r.repairs.map((x) => (
                <tr key={x.taskKey}>
                  <td>
                    <b>{naming.ownerOf(x.taskKey) ?? 'Teammate'}</b> {x.taskTitle}
                    {x.stopReason && <div className="faint">{x.stopReason}</div>}
                  </td>
                  <td>{x.attempts}</td>
                  <td>{x.tokens ? `${Math.round(x.tokens / 1000)}k` : '—'}</td>
                  <td>{x.ms ? duration(0, x.ms) : '—'}</td>
                  <td>{x.costUsd ? money(x.costUsd) : '—'}</td>
                  <td>
                    <Pill tone={x.outcome === 'repaired' ? 'ok' : x.outcome === 'failed' ? 'danger' : 'info'}>{x.outcome}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.trend.length > 1 && (
        <section className="card">
          <h4>History</h4>
          <div className="q-trend">
            {data.trend.map((t) => (
              <div key={t.number} className={`q-bar q-${VERDICT[t.verdict].tone}`} data-tip={`#${t.number}: ${VERDICT[t.verdict].label} · ${t.checksPassed}/${t.checksTotal} checks passed · ${t.repairs} repair(s) · ${timeAgo(t.at)}`}>
                <span style={{ height: `${t.checksTotal ? Math.max(8, (t.checksPassed / t.checksTotal) * 100) : 8}%` }} />
                <em>#{t.number}</em>
              </div>
            ))}
          </div>
          <p className="faint small">Bar height = share of checks that passed in that result; colour = how ready it was.</p>
        </section>
      )}

      <section className="q-checks">
        <Validation embedded />
      </section>
    </div>
  )
}

function VisualPanel({ report, projectId }: { report: QualityReport | null; projectId: string }) {
  const [shots, setShots] = useState<Record<string, string>>({})
  const [zoom, setZoom] = useState<string | null>(null)
  useEffect(() => {
    setShots({})
    if (!report) return
    for (const s of report.shots) void window.autopia.qualityShot(projectId, s.path).then((url) => setShots((m) => ({ ...m, [s.path]: url })), () => undefined)
  }, [report?.id])
  if (!report) return null
  return (
    <section className="card">
      <header className="row between">
        <h4>Visual QA</h4>
        <span className="muted small">
          {report.status === 'done' ? `${timeAgo(report.endedAt ?? report.startedAt)} · real captures of ${report.note}` : report.status}
        </span>
      </header>
      {report.status !== 'done' && <p className={`small ${report.status === 'error' ? 'bad-text' : 'muted'}`}>{report.error ?? report.note}</p>}
      {Object.keys(report.metrics).length > 0 && (
        <div className="q-metrics small">
          {report.metrics.loadMs !== undefined && <span>Load {report.metrics.loadMs} ms</span>}
          <span>{report.metrics.domNodes} DOM nodes</span>
          <span>{report.metrics.transferKb} KB transferred</span>
          <span>{report.metrics.requests} requests</span>
          {report.metrics.controlsFound !== undefined && <span>Used {report.metrics.controlsUsed} of {report.metrics.controlsFound} controls on {report.metrics.pagesUsed} page{report.metrics.pagesUsed === 1 ? '' : 's'}</span>}
          <span className="faint">measured at 1280 px from the local preview</span>
        </div>
      )}
      <div className="q-shots">
        {report.shots.map((s) => (
          <figure key={s.path} onClick={() => setZoom(s.path)}>
            {shots[s.path] ? <img src={shots[s.path]} alt={`Page at ${s.width}px`} /> : <div className="q-shot-ph" />}
            <figcaption className="small muted">{s.width}px</figcaption>
          </figure>
        ))}
      </div>
      {zoom && shots[zoom] && (
        <Dialog onClose={() => setZoom(null)} className="modal-lightbox">
          <img className="q-zoom" src={shots[zoom]} alt="Full-size capture" />
        </Dialog>
      )}
    </section>
  )
}
