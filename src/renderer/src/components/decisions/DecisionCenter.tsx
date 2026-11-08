import { clip, friendlyError } from '@shared/friendlyError'
import { useState } from 'react'
import { questionChoices } from '@shared/claudeCode'
import { DECISION_WORD, NATIVE_QUESTION, alreadySettled, decisionKind, decisionOptions, impactLine, parsePermission, type BoardDecision, type BoardItem, type DecisionOption } from '@shared/decisions'
import type { Approval, ApprovalDecision, AttentionCategory, Notification, TaskRecovery } from '@shared/types'
import { actions, store, useApp } from '../../store'
import { timeAgo, useNaming } from '../common'
import { confirmAction } from '../ui'

/** Why an interrupted step stopped and what is kept (verified from its record and git). */
export function RecoveryNote({ recovery }: { recovery: TaskRecovery }) {
  return (
    <div className="dk-recovery small">
      {recovery.preserved.length > 0 && (
        <>
          <b>Kept safe</b>
          <ul>
            {recovery.preserved.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      {recovery.count > 1 && <p className="muted">Interrupted {recovery.count} times in a row.</p>}
    </div>
  )
}

/** Goes where it came from, whichever product is open now. */
async function openItem(projectId: string, taskId: string | null, deliveryId?: string | null): Promise<void> {
  await actions.openAttention({ projectId, taskId, deliveryId: deliveryId ?? null })
}

/**
 * One decision, the same everywhere it appears. Says what it is, what it holds up and what the choices are; the
 * technical detail is one click away. It only leaves the list when the backend says it's settled.
 */
export function DecisionCard({ item, compact = false }: { item: BoardDecision; compact?: boolean }) {
  const { approval: a, task, live, impact, run, diagnosis } = item
  const who = useApp((s) => s.allEmployees.find((e) => e.id === item.employeeId) ?? s.employees.find((e) => e.id === item.employeeId))
  const holdUntil = useApp((s) => s.usage?.hold?.until ?? null)
  const autoMode = useApp((s) => s.settings?.autoApprove ?? false)
  const naming = useNaming()
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const kind = decisionKind(a, task)
  const first = who?.name.split(' ')[0] ?? null
  const perm = a.kind === 'permission' ? parsePermission(a.body) : null
  const recovery = kind === 'interrupted' ? task?.recovery ?? null : null
  const options = decisionOptions(a, { live, recovery, interrupted: kind === 'interrupted', holdUntil, autoMode })
  const gone = (a.kind === 'permission' || (a.kind === 'question' && NATIVE_QUESTION.test(a.title))) && live === false

  const send = async (decision: ApprovalDecision, confirm?: string) => {
    if (confirm && !(await confirmAction({ title: 'Are you sure?', body: confirm, action: 'Yes, do it', danger: true }))) return
    setBusy(true)
    try {
      await window.autopia.resolveApproval(a.id, decision)
    } catch (err) {
      const message = (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      if (alreadySettled(message)) setSettled(message)
      else store.setState({ error: message })
    }
    setBusy(false)
    void actions.refreshBoard()
  }
  const summary = perm ? null : a.kind === 'question' ? null : naming.human(friendlyError((diagnosis?.summary ?? task?.lastError ?? a.body).split('\n').find((l) => l.trim()) ?? '').message).slice(0, 220)

  return (
    <article className={`dk${compact ? ' compact' : ''} dk-${kind}`}>
      <header className="dk-head">
        <span className="dk-kind">{DECISION_WORD[kind]}</span>
        <span className="faint small dk-where">
          {item.projectName}
          {first ? ` · ${first}` : ''} · {timeAgo(a.createdAt)}
        </span>
      </header>
      <h4 className="dk-title">{naming.human(task && kind !== 'permission' && a.kind !== 'question' ? task.title : a.title)}</h4>
      {perm && (
        <pre className="dk-subject">
          <span>{perm.tool}</span> {perm.subject}
        </pre>
      )}
      {perm?.reason && <p className="small dk-text">{perm.reason}</p>}
      {summary && <p className="small dk-text">{summary}</p>}
      {diagnosis?.recommendation && !summary?.includes(diagnosis.recommendation.split(',')[0]) && <p className="small muted dk-text">{diagnosis.recommendation}</p>}
      {recovery && <RecoveryNote recovery={recovery} />}

      {settled ? (
        <p className="small muted dk-text">{settled}</p>
      ) : gone ? (
        <p className="small muted dk-text">The session behind this has ended, so there’s nothing left to answer.</p>
      ) : (
        <p className="small muted dk-impact">{impactLine(impact, first, kind)}</p>
      )}

      {a.kind === 'question' && !gone && !settled && <QuestionAnswer body={a.body} busy={busy} onSend={(answer) => void send({ kind: 'question', answer })} />}
      {a.kind === 'verify' && <pre className="dk-subject">{a.body}</pre>}

      <div className="dk-actions">
        <button className="link small" aria-expanded={details} onClick={() => setDetails(!details)}>
          {details ? 'Hide details' : 'Details'}
        </button>
        {a.kind !== 'permission' && (task || a.kind === 'plan' || a.kind === 'question') && (
          <button className="link small" onClick={() => void openItem(a.projectId, a.kind === 'plan' ? null : a.taskId)}>
            {a.kind === 'plan' ? 'Review the plan' : task ? 'Open the step' : 'Open the conversation'}
          </button>
        )}
        <span className="grow" />
        {!settled &&
          options.map((o: DecisionOption) => (
            <button key={o.label} className={`btn btn-sm${o.primary ? ' btn-primary' : ' btn-ghost'}`} disabled={busy || o.disabled} data-tip={o.tip} onClick={() => void send(o.decision, o.confirm)}>
              {o.label}
            </button>
          ))}
      </div>

      {details && (
        <dl className="dk-details small">
          {run?.sessionId && (
            <>
              <dt>Session</dt>
              <dd className="mono">{run.sessionId}</dd>
            </>
          )}
          {run && (
            <>
              <dt>Folder</dt>
              <dd className="mono">{run.cwd}</dd>
            </>
          )}
          {task && (
            <>
              <dt>Step</dt>
              <dd>{task.key} · {task.title}</dd>
            </>
          )}
          {perm && (
            <>
              <dt>Tool</dt>
              <dd className="mono">{perm.tool}</dd>
            </>
          )}
          {diagnosis && (
            <>
              <dt>Cause</dt>
              <dd>{diagnosis.reason}</dd>
            </>
          )}
          <dt>Recorded</dt>
          <dd className="dk-raw">
            <pre>{perm ? perm.subject : a.body}</pre>
          </dd>
          {run && (
            <>
              <dt />
              <dd>
                <button
                  className="link small"
                  onClick={() =>
                    void actions.openAttention({ projectId: a.projectId }).then(() => actions.openSheet({ kind: 'log', runId: run.id }))
                  }
                >
                  See what this session did
                </button>
              </dd>
            </>
          )}
        </dl>
      )}
    </article>
  )
}

/** Keeps the question's own shape: its choices, single or several, with your own words as the alternative. */
function QuestionAnswer({ body, busy, onSend }: { body: string; busy: boolean; onSend: (answer: string) => void }) {
  const q = questionChoices(body)
  const [picked, setPicked] = useState<string[]>([])
  const [own, setOwn] = useState('')
  const answer = [...picked, own.trim()].filter(Boolean).join(', ')
  return (
    <div className="dk-question">
      <p className="dk-q-text">{q.question}</p>
      {q.options.length > 0 && (
        <div className="dk-choices" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label="Choices">
          {q.options.map((o) => {
            const on = picked.includes(o.label)
            return (
              <button
                key={o.label}
                className={`dk-choice${on ? ' on' : ''}`}
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={on}
                disabled={busy}
                onClick={() => setPicked(q.multiSelect ? (on ? picked.filter((x) => x !== o.label) : [...picked, o.label]) : on ? [] : [o.label])}
              >
                <span className="dk-choice-label">{o.label}</span>
                {o.description && <span className="small muted">{o.description}</span>}
              </button>
            )
          })}
        </div>
      )}
      <textarea
        className="input"
        rows={2}
        value={own}
        disabled={busy}
        aria-label="Your answer"
        placeholder={q.options.length ? 'Or say it in your own words' : 'Your answer'}
        onChange={(e) => setOwn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer) onSend(answer)
        }}
      />
      <div className="row end">
        <button className="btn btn-sm btn-primary" disabled={busy || !answer} onClick={() => onSend(answer)} data-tip="⌘↵">
          {busy ? 'Sending…' : 'Send answer'}
        </button>
      </div>
    </div>
  )
}

const NOTICE_WORD: Record<AttentionCategory, string> = { approval: 'Decision', question: 'Question', blocked: 'Blocked', failure: 'Failed', usage: 'Usage limit', interrupted: 'Interrupted', review: 'Ready to review', outcome: 'Done', info: 'Update' }
const NOTICE_ACTION: Partial<Record<AttentionCategory, string>> = { review: 'Open the result', failure: 'Inspect', usage: 'See usage' }

function NoticeCard({ n, projectName }: { n: Notification; projectName: string | null }) {
  return (
    <article className={`dk dk-notice compact c-${n.category}`}>
      <header className="dk-head">
        <span className="dk-kind">{NOTICE_WORD[n.category]}</span>
        <span className="faint small dk-where">
          {[projectName, timeAgo(n.updatedAt), n.count > 1 ? `×${n.count}` : null].filter(Boolean).join(' · ')}
        </span>
      </header>
      <h4 className="dk-title">{n.title}</h4>
      {n.body && <p className="small muted dk-text">{clip(n.body.split('\n')[0], 180)}</p>}
      <div className="dk-actions">
        <span className="grow" />
        <button className="btn btn-sm" onClick={() => (n.category === 'usage' ? void window.autopia.openUsagePage() : void actions.openNotice(n))}>
          {NOTICE_ACTION[n.category] ?? 'Open'}
        </button>
      </div>
    </article>
  )
}

export function BoardRow({ item, compact }: { item: BoardItem; compact?: boolean }) {
  if (item.type === 'decision') return <DecisionCard item={item} compact={compact} />
  if (item.type === 'notice') return <NoticeCard n={item.notification} projectName={item.projectName} />
  return (
    <article className="dk compact dk-clarify">
      <header className="dk-head">
        <span className="dk-kind">Needs your answer</span>
        <span className="faint small dk-where">
          {item.projectName} · {timeAgo(item.at)}
        </span>
      </header>
      <h4 className="dk-title">{clip(item.text, 160)}</h4>
      <p className="small muted dk-text">Autopia wasn’t sure what this meant, or which work it was about.</p>
      <div className="dk-actions">
        <span className="grow" />
        <button className="btn btn-sm" onClick={() => void openItem(item.projectId, null)}>
          Open the conversation
        </button>
      </div>
    </article>
  )
}

/** Arrow keys between items, wherever the list is. */
export function BoardList({ items, compact }: { items: BoardItem[]; compact?: boolean }) {
  return (
    <div
      className="dk-list"
      onKeyDown={(e) => {
        if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || (e.target as HTMLElement).closest('textarea, input, select')) return
        const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.dk')]
        const at = cards.findIndex((c) => c.contains(document.activeElement))
        if (at < 0) return
        e.preventDefault()
        cards[(at + (e.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length].querySelector<HTMLElement>('button:not([disabled])')?.focus()
      }}
    >
      {items.map((i) => (
        <BoardRow key={i.id} item={i} compact={compact} />
      ))}
    </div>
  )
}

/** Everything that needs you across every product, and what's running without you. */
/** The board's own entry for this decision, or a plain one until the board catches up. */
export function useBoardItem(a: Approval): BoardDecision {
  const found = useApp((s) => s.board.find((i) => i.type === 'decision' && i.id === a.id)) as BoardDecision | undefined
  const projectName = useApp((s) => s.projects[a.projectId]?.name ?? '')
  const task = useApp((s) => (a.taskId ? s.tasks[a.taskId] : undefined))
  return (
    found ?? {
      type: 'decision',
      id: a.id,
      approval: a,
      projectName,
      employeeId: task?.assigneeId ?? null,
      task: task ? { id: task.id, key: task.key, title: task.title, status: task.status, assigneeId: task.assigneeId, lastError: task.lastError, recovery: task.recovery } : null,
      live: null,
      impact: { holds: a.taskId ? 'task' : 'nothing', waiting: 0 },
      run: null,
      diagnosis: null
    }
  )
}
