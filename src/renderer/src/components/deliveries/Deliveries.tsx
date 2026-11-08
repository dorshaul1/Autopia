import { useEffect, useMemo, useState } from 'react'
import { previewCrashed } from '@shared/runtime'
import type { Capture } from '@shared/studio'
import { REVIEW_WORD, checkChanges, deliveryTitle, deliveryWord, picturesOf, reviewStateOf, summaryLines, timelineOf, type TimelineEntry } from '@shared/timeline'
import type { ChangeSet, Delivery, EvidenceStatus, Readiness } from '@shared/types'
import { activeProject, actions, sortedTasks, store, useApp, type ResultPane } from '../../store'
import { Avatar, Icon, timeAgo, useNaming, type Tone } from '../common'
import { resultState, detailAfter } from '../result/ResultView'
import { Compare, useCaptureImage } from '../studio/Compare'
import { EmptyState, Loading, Skeleton, confirmAction } from '../ui'
import { Quality } from '../workspace/Quality'
import { Changes } from '../workspace/Review'

const DIM_TONE: Record<EvidenceStatus, Tone> = { verified: 'ok', failed: 'danger', not_checked: 'warn', blocked: 'warn', na: 'muted' }
const DIM_WORD: Record<EvidenceStatus, string> = { verified: 'Passed', failed: 'Failed', not_checked: 'Not checked', blocked: 'Couldn’t run', na: '' }

const VIEWS: { value: ResultPane; label: string }[] = [
  { value: 'all', label: 'The delivery' },
  { value: 'changes', label: 'What changed' },
  { value: 'checks', label: 'The evidence' }
]

/** Everything your company has delivered on this product: its history on the left, one result presented in full on the right. */
export function Deliveries() {
  const project = useApp(activeProject)!
  const id = useApp((s) => s.resultId)
  const deliveries = useApp((s) => s.deliveries)
  const spec = useApp((s) => s.product)
  const pane = useApp((s) => s.resultPane)
  const [marks, setMarks] = useState<string[]>([])
  useEffect(() => {
    void window.autopia.deliveryMarks?.(project.id).then(setMarks, () => setMarks([]))
  }, [project.id])
  const groups = useMemo(() => timelineOf({ deliveries, milestones: spec?.milestones, marks, now: Date.now() }), [deliveries, spec, marks])
  const d = deliveries.find((x) => x.id === id) ?? deliveries.find((x) => x.status === 'review') ?? deliveries.find((x) => x.completedAt) ?? deliveries[0] ?? null

  if (!d) return <EmptyState icon="review" title="Nothing delivered yet" body="When the team finishes a request, it’s presented here with what was built, how it was checked, and what’s left." />
  return (
    <div className="dl">
      <nav
        className="dl-time"
        aria-label="Deliveries over time"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.dl-entry')]
          const at = rows.indexOf(document.activeElement as HTMLElement)
          if (at < 0) return
          e.preventDefault()
          rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus()
        }}
      >
        {groups.map((g) => (
          <section key={g.label}>
            <h3>{g.label}</h3>
            <ol>
              {g.entries.map((e) => (
                <Entry key={e.id} entry={e} active={e.type === 'delivery' && e.id === d.id} />
              ))}
            </ol>
          </section>
        ))}
      </nav>
      <main className="dl-main">
        <div className="dl-views" role="tablist" aria-label="This delivery">
          {VIEWS.map((v) => (
            <button key={v.value} role="tab" aria-selected={pane === v.value} className={pane === v.value ? 'on' : ''} onClick={() => actions.openPane(v.value)}>
              {v.label}
            </button>
          ))}
        </div>
        {pane === 'checks' ? (
          <div className="dl-scroll"><Quality /></div>
        ) : pane === 'changes' ? (
          <ChangesPane key={d.id} d={d} />
        ) : (
          <div className="dl-scroll">
            <DeliveryView key={d.id} d={d} marked={marks.includes(d.id)} onMark={setMarks} />
          </div>
        )}
      </main>
    </div>
  )
}

function Entry({ entry: e, active }: { entry: TimelineEntry; active: boolean }) {
  if (e.type === 'milestone') {
    return (
      <li className="dl-mile">
        <Icon name="flag" size={11} /> <span className="small">Milestone {e.n} reached: {e.title}</span>
      </li>
    )
  }
  return (
    <li>
      <button className={`dl-entry st-${e.state}${active ? ' on' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => store.setState({ resultId: e.id, resultPane: store.getState().resultPane === 'preview' ? 'all' : store.getState().resultPane })}>
        <span className="dl-dot" aria-hidden />
        <span className="dl-entry-text">
          <span className="dl-entry-title">
            {e.marked && <Icon name="flag" size={10} />} {e.title}
          </span>
          <span className="small faint">
            {e.word} · #{e.delivery.number} · {e.state === 'awaiting' || e.state === 'working' ? REVIEW_WORD[e.state] : timeAgo(e.at)}
          </span>
        </span>
      </button>
    </li>
  )
}

function ChangesPane({ d }: { d: Delivery }) {
  const project = useApp(activeProject)!
  const [changes, setChanges] = useState<ChangeSet | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.autopia.changes(project.id, d.id).then(
      (c) => live && setChanges(c),
      (e: Error) => live && setFailed(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
    return () => {
      live = false
    }
  }, [project.id, d.id, d.headSha])
  if (failed) return <div className="dl-scroll"><p className="small muted dl-pad">The changes couldn’t be read: {failed}</p></div>
  if (!changes) return <Loading>Reading what changed…</Loading>
  if (!changes.files.length) return <EmptyState icon="code" title="No changes on record" body="This result didn’t record any file changes." />
  return <div className="dl-changes"><Changes set={changes} /></div>
}

/** One result, presented the way a good company presents finished work: what it is, whether it holds up, what's left. */
function DeliveryView({ d, marked, onMark }: { d: Delivery; marked: boolean; onMark: (m: string[]) => void }) {
  const naming = useNaming()
  const project = useApp(activeProject)!
  const deliveries = useApp((s) => s.deliveries)
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const preview = useApp((s) => s.preview)
  const reports = useApp((s) => s.qualityReports.length)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [comparing, setComparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    void window.autopia.readiness(project.id, d.id).then(setReadiness, () => setReadiness(null))
    void window.autopia.studioCaptures?.(project.id).then(setCaptures, () => setCaptures([]))
  }, [project.id, d.id, d.status, reports, preview?.status])

  const here = preview?.projectId === d.projectId ? preview : null
  const state = resultState(d, tasks, readiness, here)
  const review = reviewStateOf(d)
  const incomplete = previewCrashed(here) || ['Blocked', 'Didn’t finish', 'Partly done', 'Needs fixes'].includes(state.label)
  const own = tasks.filter((t) => t.deliveryId === d.id && t.status !== 'proposed')
  const team = [...new Set(own.map((t) => t.assigneeId))].flatMap((id) => employees.find((e) => e.id === id) ?? [])
  const lines = summaryLines(d.summary, d.verification?.state === 'verified')
  const pics = picturesOf(d, captures, deliveries)
  const applicable = readiness?.dimensions.filter((x) => x.applies) ?? []
  const parent = deliveries.find((x) => x.id === d.parentId) ?? null
  const followUps = deliveries.filter((x) => x.parentId === d.id).sort((a, b) => a.number - b.number)
  const previous = parent ?? [...deliveries].filter((x) => x.number < d.number && x.completedAt).sort((a, b) => b.number - a.number)[0] ?? null
  const diffs = previous ? checkChanges(tasks.filter((t) => t.deliveryId === previous.id).flatMap((t) => t.checks), own.flatMap((t) => t.checks)) : []
  const notes = readiness ? [...readiness.completion.failed, ...readiness.completion.limitations] : d.limitations
  const canTry = !!preview && preview.kind !== 'none' && preview.expects !== 'process'

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(true)
    await actions.run(() => window.autopia.decideDelivery(d.id, decision, null))
    setBusy(false)
  }
  const undo = async () => {
    if (!(await confirmAction({ title: `Undo the changes from result #${d.number}?`, body: 'Autopia adds commits that revert them; nothing is deleted from history. It refuses if you have uncommitted changes in those files or a later result built on them.', action: 'Undo the changes', danger: true }))) return
    setBusy(true)
    await actions.run(() => window.autopia.undoDelivery(d.id))
    setBusy(false)
  }
  const mark = async () => {
    const next = await actions.run(() => window.autopia.setDeliveryMark(d.id, !marked))
    if (next) onMark(next)
  }
  const runVisual = async () => {
    setChecking(true)
    await actions.run(() => window.autopia.runVisualQa(project.id, d.id))
    setChecking(false)
    void window.autopia.readiness(project.id, d.id).then(setReadiness)
  }

  return (
    <article className="dv">
      <header className="dv-hero">
        <p className="dv-eyebrow small">
          {deliveryWord(d)} · Result #{d.number}
          {d.completedAt ? ` · ${new Date(d.completedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}
        </p>
        <h1>{deliveryTitle(d)}</h1>
        <div className="dv-state">
          <span className={`dv-review st-${review}`}>{REVIEW_WORD[review]}</span>
          {review !== 'working' && <span className={`small dv-evidence tone-${state.tone}`}>{state.label.replace(/^Ready · /, '').replace(/^Ready to review$/, 'Evidence still loading')}</span>}
        </div>
        <p className="small muted dv-detail">{detailAfter(state.label, state.detail)}</p>
        {team.length > 0 && (
          <p className="dv-team small muted">
            {team.map((e) => (
              <button key={e.id} className="dv-who" onClick={() => actions.openSheet({ kind: 'employee', id: e.id })}>
                <Avatar employee={e} size={18} /> {e.name.split(' ')[0]}
              </button>
            ))}
          </p>
        )}
        {(parent || followUps.length > 0) && (
          <p className="small dv-links">
            {parent && (
              <button className="link small" onClick={() => store.setState({ resultId: parent.id })}>
                Changes result #{parent.number}
              </button>
            )}
            {followUps.map((f) => (
              <button key={f.id} className="link small" onClick={() => store.setState({ resultId: f.id })}>
                Led to result #{f.number}: {REVIEW_WORD[reviewStateOf(f)].toLowerCase()}
              </button>
            ))}
          </p>
        )}
        <div className="dv-actions">
          {canTry && (
            <button className={`btn btn-sm${review === 'awaiting' && !incomplete ? ' btn-primary' : ''}`} onClick={() => actions.openResult(d.id)}>
              <Icon name="eye" size={12} /> Try it
            </button>
          )}
          {review !== 'discarded' && (
            <button className="btn btn-sm" onClick={() => actions.compose({ deliveryId: d.id })}>
              Ask for a change
            </button>
          )}
          {d.status === 'review' && (
            <button className={`btn btn-sm${!incomplete && !canTry ? ' btn-primary' : ''}`} disabled={busy} onClick={() => void decide('accept')} data-tip={incomplete ? 'You’re marking it reviewed even though the evidence isn’t clean' : undefined}>
              <Icon name="check" size={12} /> {incomplete ? 'Mark reviewed anyway' : 'Mark as reviewed'}
            </button>
          )}
          {(d.verification?.state === 'failed' || d.verification?.state === 'blocked') && d.status === 'review' && (
            <button className="btn btn-sm" onClick={() => void actions.run(() => window.autopia.verifyDelivery(d.id))} data-tip="Run it for real again, with a fresh repair budget">
              <Icon name="retry" size={12} /> Check it again
            </button>
          )}
          {pics.pair && (
            <button className="btn btn-sm btn-ghost" aria-expanded={comparing} onClick={() => setComparing(!comparing)}>
              <Icon name="compare" size={12} /> {comparing ? 'Hide comparison' : 'Compare'}
            </button>
          )}
          <span className="dv-actions-end">
          {d.completedAt && (
            <button className={`icon-btn dv-mark${marked ? ' on' : ''}`} aria-pressed={marked} aria-label={marked ? 'Not a milestone' : 'Mark as a milestone'} data-tip={marked ? 'Marked as a milestone' : 'Mark as a milestone'} onClick={() => void mark()}>
              <Icon name="flag" size={13} />
            </button>
          )}
          {d.status === 'review' && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void decide('reject')} data-tip="Marks this result as not wanted. Its changes stay in the project until you undo them.">
              Discard
            </button>
          )}
          {d.status === 'rejected' && !/^Undone:/m.test(d.decisionNote ?? '') && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void undo()} data-tip="Reverts this result’s changes with new commits. History is kept.">
              Undo its changes
            </button>
          )}
          </span>
        </div>
      </header>

      {comparing && pics.pair ? (
        <section className="dv-compare" aria-label="Comparison">
          <p className="small muted">{pics.source}. Both are real captures; which is better is for you to say.</p>
          <ComparePair projectId={project.id} captures={captures} initial={pics.pair} />
        </section>
      ) : (
        <Picture projectId={project.id} capture={pics.own} working={review === 'working'} />
      )}


      <section className="dv-sec">
        <h2>What was built</h2>
        {lines.length ? (
          <ul className="dv-built">
            {lines.slice(0, 8).map((l) => (
              <li key={l}>{naming.human(l)}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{own.length ? 'The team didn’t leave a summary for this one.' : 'Nothing has been built for this request yet.'}</p>
        )}
        {own.length > 0 && (
          <details className="dv-steps">
            <summary className="small muted">
              {own.filter((t) => t.status === 'done').length} of {own.length} {own.length === 1 ? 'step' : 'steps'} finished
            </summary>
            {own.map((t) => (
              <button key={t.id} className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
                <span>{t.title}</span>
                <span className="faint small">{naming.nameOf(t.assigneeId)}</span>
              </button>
            ))}
          </details>
        )}
      </section>

      <section className="dv-sec">
        <h2>Does it work?</h2>
        {!readiness ? (
          <Skeleton lines={4} label="Reading the evidence" />
        ) : applicable.length ? (
          <ul className="rv-checks">
            {applicable.map((x) => (
              <li key={x.dimension}>
                <span className={`rv-dot tone-${x.exception ? 'info' : DIM_TONE[x.status]}`} />
                <span className="rv-check-name">{x.label}</span>
                <span className="rv-check-word">{x.exception ? 'Accepted with a note' : DIM_WORD[x.status]}</span>
                {x.evidence[0] && <span className="rv-check-ev">{x.evidence[0]}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No checks applied to this result, so nothing has been verified.</p>
        )}
        {applicable.some((x) => (x.dimension === 'visual' || x.dimension === 'accessibility') && x.status === 'not_checked' && !x.exception) && canTry && (
          <button className="btn btn-sm" disabled={checking} onClick={() => void runVisual()} data-tip="Opens the app in a hidden window at phone, tablet and desktop widths and checks layout and accessibility. No AI.">
            {checking ? 'Checking the interface…' : 'Check the interface now'}
          </button>
        )}
        {readiness?.completion.correction?.outcome && (
          <p className="muted small">
            {((o) => `Before handing this over, ${naming.ownerOf(readiness.completion.correction!.taskKey) ?? 'a teammate'} fixed ${o.fixed.length} of ${o.fixed.length + o.remaining.length} defect(s) review QA measured${o.introduced.length ? `, but introduced ${o.introduced.length} new one(s)` : ''}.`)(readiness.completion.correction.outcome)}
          </p>
        )}
        {diffs.length > 0 && previous && (
          <div className="dv-diffs small">
            <p className="muted">Compared with result #{previous.number}:</p>
            <ul>
              {diffs.slice(0, 6).map((c) => (
                <li key={c.command}>
                  <span className="mono">{c.command}</span> <span className="faint">{c.was ? `${c.was} → ${c.now}` : `${c.now}, not run before`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button className="link small" onClick={() => actions.openPane('checks')}>
          All the evidence
        </button>
      </section>

      {notes.length > 0 && (
        <section className="dv-sec">
          <h2>Worth checking</h2>
          <ul className="dv-built dv-notes">
            {notes.map((l) => (
              <li key={l}>{naming.human(l.replace(/^(T[\d.]+) changed the interface; Autopia did not inspect it visually\. Check it in Preview\./, '$1 changed the interface and hasn’t been checked visually yet. Look at it in the preview.'))}</li>
            ))}
          </ul>
        </section>
      )}

      {readiness && readiness.completion.recommendations.length > 0 && (
        <section className="dv-sec">
          <h2>Suggestions</h2>
          <p className="faint small">Outside what you asked for, so nothing was changed.</p>
          <ul className="dv-built">
            {readiness.completion.recommendations.map((f) => (
              <li key={`${f.message}${f.file ?? ''}`}>
                {f.message}
                {f.file ? <span className="faint"> · {f.file}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="dv-tech small">
        <summary>Technical details</summary>
        <dl>
          {d.baseSha && (
            <>
              <dt>Commits</dt>
              <dd className="mono">{d.baseSha.slice(0, 8)} → {d.headSha?.slice(0, 8) ?? 'not finished'}</dd>
            </>
          )}
          <dt>Started</dt>
          <dd>{new Date(d.createdAt).toLocaleString()}</dd>
          {d.strategy && (
            <>
              <dt>How it was run</dt>
              <dd>{d.strategy}</dd>
            </>
          )}
          {d.decisionNote && (
            <>
              <dt>Your note</dt>
              <dd>{d.decisionNote}</dd>
            </>
          )}
          <dt />
          <dd className="dv-tech-links">
            <button className="link small" onClick={() => actions.goStage('logs')}>
              Every session
            </button>
            <button className="link small" onClick={() => actions.talkTo(null)}>
              The conversation
            </button>
          </dd>
        </dl>
      </details>
    </article>
  )
}

function Picture({ projectId, capture, working }: { projectId: string; capture: Capture | null; working: boolean }) {
  const url = useCaptureImage(projectId, capture?.path ?? null)
  if (!capture) return <p className="dv-nopic small muted">{working ? 'A picture appears here once there’s something to look at.' : 'No picture was captured for this result.'}</p>
  return (
    <figure className="dv-pic">
      {url ? <img src={url} alt="This result, as captured" /> : <span className="spinner" />}
      <figcaption className="small faint">
        {capture.source === 'check' ? 'From the visual check' : capture.source === 'after' ? 'After your change' : capture.source === 'before' ? 'Before your change' : 'Your capture'} · {timeAgo(capture.at)}
        {capture.width ? ` · ${capture.width}px wide` : ''}
      </figcaption>
    </figure>
  )
}

function ComparePair({ projectId, captures, initial }: { projectId: string; captures: Capture[]; initial: [Capture, Capture] }) {
  const [pair, setPair] = useState(initial)
  return <Compare projectId={projectId} captures={captures} pair={pair} onPair={setPair} />
}
