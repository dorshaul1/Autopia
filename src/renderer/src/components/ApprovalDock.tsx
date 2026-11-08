import { useEffect, useState, type MouseEvent } from 'react'
import type { Approval, ApprovalDecision } from '@shared/types'
import { criticalPath } from '@shared/graph'
import { briefingRisks, stagesOf } from '@shared/briefing'
import { activeProject, actions, sortedTasks, store, useApp } from '../store'
import { Avatar, Icon, useNaming } from './common'
import { DecisionCard, useBoardItem } from './decisions/DecisionCenter'

/** Dev-only audit of decision clicks: records whether each came from a real (trusted) user event. */
function audit(e: MouseEvent, decision: ApprovalDecision): void {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __decisionLog?: unknown[] }
  ;(w.__decisionLog ??= []).push({ at: new Date().toISOString(), trusted: e.nativeEvent.isTrusted, decision })
}

function PlanCard({ approval, more }: { approval: Approval; more: number }) {
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const project = useApp(activeProject)
  const [revising, setRevising] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const product = useApp((s) => s.product)
  const naming = useNaming()
  const [codeRisks, setCodeRisks] = useState<string[]>([])
  const planFor = approval.kind === 'plan' ? approval.projectId : null
  useEffect(() => {
    if (planFor) void window.autopia.planRisks(planFor).then(setCodeRisks, () => undefined)
  }, [planFor, approval.id])
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const decide = async (e: MouseEvent, decision: ApprovalDecision) => {
    audit(e, decision)
    setBusy(true)
    await actions.run(() => window.autopia.resolveApproval(approval.id, decision))
    setBusy(false)
  }

  {
    const proposed = tasks.filter((t) => t.status === 'proposed')
    const critical = criticalPath(proposed)
    const team = [...new Set(proposed.map((t) => t.assigneeId))].map((id) => employees.find((e) => e.id === id)).filter(Boolean)
    const checks = [...new Set(proposed.flatMap((t) => t.validation))]
    const stages = stagesOf(proposed)
    const widest = Math.max(0, ...stages.map((st) => new Set(st.tasks.map((t) => t.assigneeId)).size))
    const risks = [...briefingRisks(proposed, product, naming.nameOf), ...codeRisks]
    return (
      <div className="approval">
        <div className="approval-head">
          <span className="approval-icon warn">
            <Icon name="flag" />
          </span>
          <div className="approval-titles">
            <div className="approval-kicker">Plan ready — needs your OK{more > 0 && ` · +${more} more`}</div>
            <h3>{approval.title}</h3>
          </div>
        </div>
        <div className="plan-meta">
          {project?.complexity && <span className={`cx cx-${project.complexity}`}>{project.complexity}</span>}
          <span>
            {proposed.length} task{proposed.length > 1 ? 's' : ''} · team of {team.length}
          </span>
          <span className="plan-team">
            {team.map((e) => (
              <Avatar key={e!.id} employee={e!} size={18} />
            ))}
          </span>
          {stages.length > 1 && (
            <span className="muted" data-tip="Steps in one stage run side by side; each stage builds on the one before">
              {stages.length} stages{widest > 1 ? ` · up to ${widest} at once` : ''}
            </span>
          )}
        </div>
        <p className={`approval-body${expanded ? ' expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
          {approval.body}
        </p>
        {product && product.questions.length > 0 && (
          <div className="plan-questions">
            <div className="approval-kicker">Decisions for you · Autopia uses the default if you leave one</div>
            {product.questions.map((q) => (
              <label key={q.id} className="plan-q">
                <span>
                  <b>{q.question}</b> <span className="muted small">{q.why}</span>
                </span>
                <select className="select" value={answers[q.id] ?? q.answer ?? q.defaultAnswer} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                  {[...new Set([q.defaultAnswer, ...q.options])].map((o) => (
                    <option key={o} value={o}>
                      {o}
                      {o === q.defaultAnswer ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {product && (
          <button className="btn btn-sm btn-ghost plan-brief" onClick={() => store.setState({ view: 'workspace', section: 'product' })}>
            <Icon name="target" size={12} /> Product brief: {product.features.filter((f) => f.scope === 'mvp').length} MVP features · {product.milestones.length} milestone(s) · {product.assumptions.length} assumption(s)
          </button>
        )}
        {risks.length > 0 && (
          <div className="brief-risks">
            <div className="approval-kicker">Worth knowing</div>
            <ul>
              {risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <ol className="plan-list">
          {stages.flatMap((st) => st.tasks).map((t) => {
            const e = employees.find((m) => m.id === t.assigneeId)
            const deps = t.dependsOn.map((d) => tasks.find((x) => x.id === d)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => naming.refOf(x, 28))
            return (
              <li key={t.id}>
                <div className="plan-row">
                  {e && <Avatar employee={e} size={22} />}
                  <div className="plan-main">
                    <span className="plan-task" title={t.title}>
                      {t.title}
                    </span>
                    <span className="plan-row-meta" title={deps.length ? `After ${deps.join(', ')}` : undefined}>
                      {[naming.nameOf(t.assigneeId) ?? t.kind, t.milestone ? `Milestone ${t.milestone}` : null, SIZE_WORD[t.size], deps.length ? `after ${deps.join(', ')}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {critical.has(t.id) && proposed.length > 1 && (
                    <span className="tag tag-caps tag-accent" data-tip="On the critical path: drives total completion time">
                      critical
                    </span>
                  )}
                </div>
                {expanded && (
                  <div className="plan-detail">
                    {t.rationale && <div>Why: {t.rationale}</div>}
                    {t.files.length > 0 && <div className="mono">files: {t.files.join(', ')}</div>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {checks.length > 0 && (
          <div className="plan-checks" data-tip="Agents run these with Claude Code's Bash tool under your permission policy; Autopia records each exit status">
            <Icon name="check" size={12} /> Checks: <span className="mono">{checks.join(' · ')}</span>
          </div>
        )}
        {revising ? (
          <div className="revise">
            <textarea
              autoFocus
              className="goal"
              rows={2}
              placeholder="What should Maya change?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="row gap end">
              <button className="btn btn-ghost" onClick={() => setRevising(false)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !feedback.trim()}
                onClick={(e) => decide(e, { kind: 'plan', action: 'revise', feedback: feedback.trim() })}
              >
                Update the plan
              </button>
            </div>
          </div>
        ) : (
          <div className="row gap end">
            <button className="btn" disabled={busy} onClick={() => setRevising(true)}>
              Change the plan
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={(e) => decide(e, { kind: 'plan', action: 'approve', ...(product?.questions.length ? { answers: Object.fromEntries(product.questions.map((q) => [q.id, answers[q.id] ?? q.answer ?? q.defaultAnswer])) } : {}) })}>
              <Icon name="play" size={12} /> Start building
            </button>
          </div>
        )}
      </div>
    )
  }

}

/** A decision in context: a plan gets its full review, anything else the same card as everywhere. */
export function ApprovalCard({ approval, more }: { approval: Approval; more: number }) {
  const item = useBoardItem(approval)
  return approval.kind === 'plan' ? <PlanCard approval={approval} more={more} /> : <DecisionCard item={item} />
}

const SIZE_WORD: Record<string, string> = { s: 'small', m: 'medium', l: 'large' }

