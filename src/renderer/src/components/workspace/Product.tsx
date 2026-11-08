import { useEffect, useState } from 'react'
import { milestoneStatus } from '@shared/product'
import type { ProductDeliverable, ProductMilestone } from '@shared/types'
import { activeProject, actions, pendingApprovals, sortedTasks, store, useApp } from '../../store'
import { Avatar, Icon, Pill, duration, money, timeAgo, type Tone } from '../common'

const M_TONE: Record<ProductMilestone['status'], Tone> = { pending: 'muted', active: 'info', verifying: 'info', done: 'ok', failed: 'danger' }
const M_LABEL: Record<ProductMilestone['status'], string> = { pending: 'Not started', active: 'In progress', verifying: 'Verifying', done: 'Verified', failed: 'Needs attention' }

/** The CEO view of a product: what is being built and why, real milestone progress, decisions and hand-over. */
export function Product() {
  const project = useApp(activeProject)!
  const spec = useApp((s) => s.product)
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const approvals = useApp(pendingApprovals)
  const deliveries = useApp((s) => s.deliveries)
  const [deliverable, setDeliverable] = useState<ProductDeliverable | null>(null)

  const reviewable = deliveries.some((d) => d.status === 'review' || d.status === 'accepted')
  useEffect(() => {
    if (reviewable) void window.autopia.productDeliverable(project.id).then(setDeliverable)
  }, [project.id, reviewable, deliveries])

  if (!spec) return <div className="ws-pad muted">No brief yet. One is written when you describe something new to build.</div>

  const live = tasks.filter((t) => t.status !== 'proposed')
  return (
    <div className="ws-scroll ws-pad product">
      <section className="pd-hero">
        <div>
          <div className="section-label">Product</div>
          <h2>{project.name}</h2>
          <p>{spec.vision}</p>
          <div className="pd-users">
            {spec.users.map((u) => (
              <span key={u} className="chip">
                {u}
              </span>
            ))}
          </div>
        </div>
        {approvals.length > 0 && (
          <button className="btn btn-primary" onClick={() => (store.setState({ view: 'office' }), actions.openSheet({ kind: 'conversation' }))}>
            <Icon name="flag" size={12} /> {approvals.length} decision{approvals.length > 1 ? 's' : ''} waiting
          </button>
        )}
      </section>

      <section className="card">
        <h4>Milestones</h4>
        <ol className="pd-milestones">
          {spec.milestones.map((m) => {
            const status = live.length ? milestoneStatus(m, live) : 'pending'
            // finished but some applicable checks could not run: say so, never "Verified"
            const partly = status === 'done' && m.gate?.verdict === 'unverified'
            const own = live.filter((t) => t.milestone === m.n)
            const done = own.filter((t) => t.status === 'done').length
            return (
              <li key={m.n} className={`pd-m pd-${status}`}>
                <div className="row between">
                  <div>
                    <strong>
                      {m.n}. {m.title}
                    </strong>
                    <p className="small muted">{m.goal}</p>
                  </div>
                  <div className="pd-m-state">
                    <Pill tone={partly ? 'warn' : M_TONE[status]} pulse={status === 'active' || status === 'verifying'}>
                      {partly ? 'Done · partly verified' : M_LABEL[status]}
                    </Pill>
                    {own.length > 0 && (
                      <span className="faint small">
                        {done}/{own.length} tasks
                      </span>
                    )}
                  </div>
                </div>
                <ul className="pd-acc small">
                  {m.acceptance.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                {own.length > 0 && (
                  <div className="pd-tasks">
                    {own.map((t) => {
                      const e = employees.find((x) => x.id === t.assigneeId)
                      return (
                        <button key={t.id} className={`pd-task st-${t.status}`} onClick={() => store.setState({ section: 'overview' })} data-tip={`${t.title} · ${t.status}`}>
                          {e && <Avatar employee={e} size={16} />}
                          <span className="pd-task-title">{t.title}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {m.gate && (
                  <div className={`pd-gate small ${m.gate.verdict}`}>
                    <b>Verification {m.gate.verdict}</b> · {timeAgo(m.gate.at)}
                    {m.gate.repairTaskKey && <span> · repair {m.gate.repairTaskKey}</span>}
                    <ul>
                      {m.gate.evidence.slice(0, 6).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      <div className="pd-grid">
        <section className="card">
          <h4>Scope</h4>
          <ul className="pd-features">
            {spec.features.map((f) => (
              <li key={f.id} className={f.scope}>
                <div>
                  <b>{f.name}</b> <span className="small muted">{f.description}</span>
                </div>
                <span className="pd-badges">
                  <Pill tone={f.scope === 'mvp' ? 'info' : 'muted'}>{f.scope === 'mvp' ? `MVP${f.milestone ? ` · M${f.milestone}` : ''}` : 'Later'}</Pill>
                  <Pill tone={f.basis === 'confirmed' ? 'ok' : 'warn'}>{f.basis === 'confirmed' ? 'you asked' : 'assumed'}</Pill>
                </span>
              </li>
            ))}
          </ul>
          {spec.assumptions.length > 0 && (
            <>
              <h5>Defaults Autopia chose</h5>
              <ul className="small pd-list">
                {spec.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}
          {spec.questions.length > 0 && (
            <>
              <h5>Decisions</h5>
              <ul className="small pd-list">
                {spec.questions.map((q) => (
                  <li key={q.id}>
                    {q.question} → <b>{q.answer ?? q.defaultAnswer}</b>
                    {!q.answer && <span className="faint"> (default)</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h4>Core journeys</h4>
          {spec.journeys.map((j) => (
            <div key={j.name} className="pd-journey">
              <b className="small">{j.name}</b>
              <ol className="small muted">
                {j.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
          <h4>Architecture</h4>
          <p className="small">
            <b>{spec.architecture.stack}</b>
          </p>
          <p className="small muted">{spec.architecture.rationale}</p>
          <p className="small">
            Data: {spec.architecture.data}
            <br />
            API: {spec.architecture.api}
          </p>
          <h4>Design direction</h4>
          <p className="small">{spec.design.direction}</p>
          <div className="pd-swatches">
            {spec.design.colors.map((c) => (
              <span key={c.name} className="pd-swatch" data-tip={`${c.name} ${c.value}`}>
                <i style={{ background: c.value }} />
                <span className="small">{c.name}</span>
              </span>
            ))}
          </div>
          <p className="small muted">
            {spec.design.typography} · {spec.design.layout}
          </p>
          {spec.risks.length > 0 && (
            <>
              <h5>Risks</h5>
              <ul className="small pd-list">
                {spec.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {deliverable && (
        <section className="card pd-deliverable">
          <header className="row between">
            <h4>Deliverable</h4>
            <div className="row gap">
              {deliverable.previewable && (
                <button className="btn btn-sm" onClick={() => actions.openPane('preview')}>
                  <Icon name="eye" size={12} /> Preview
                </button>
              )}
              <button className="btn btn-sm" onClick={() => actions.openPane('checks')}>
                <Icon name="shield" size={12} /> Quality
              </button>
            </div>
          </header>
          <div className="pd-grid">
            <div>
              <h5>Run it</h5>
              <ul className="pd-run">
                {deliverable.run.map((r) => (
                  <li key={r.command}>
                    <span className="faint small">{r.label}</span> <code>{r.command}</code>
                  </li>
                ))}
              </ul>
              <p className="small muted">In {project.path}</p>
              {deliverable.env.length > 0 && (
                <>
                  <h5>Configuration it reads</h5>
                  <p className="small mono">{deliverable.env.join(', ')}</p>
                </>
              )}
              <h5>Latest real check results</h5>
              <ul className="small pd-list">
                {deliverable.checks.map((c) => (
                  <li key={c.command}>
                    <span className="mono">{c.command}</span> <Pill tone={c.status === 'passed' ? 'ok' : c.status === 'failed' ? 'danger' : 'warn'}>{c.status}</Pill>
                  </li>
                ))}
                {!deliverable.checks.length && <li className="muted">No checks ran.</li>}
              </ul>
            </div>
            <div>
              <h5>Known limitations</h5>
              <ul className="small pd-list">
                {deliverable.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {!deliverable.limitations.length && <li className="muted">None recorded.</li>}
              </ul>
              {deliverable.decisions.length > 0 && (
                <>
                  <h5>Key decisions</h5>
                  <ul className="small pd-list">
                    {deliverable.decisions.map((d) => (
                      <li key={d.title}>
                        <b>{d.title}:</b> {d.text.split('\n')[0]}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h5>Effort (measured)</h5>
              <p className="small">
                {deliverable.commits} commits · {deliverable.files} files · {Math.round(deliverable.tokens / 1000)}k tokens · {money(deliverable.costUsd)} · {duration(0, deliverable.elapsedMs)} from first plan to last run
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
