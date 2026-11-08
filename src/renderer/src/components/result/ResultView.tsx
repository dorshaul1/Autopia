import { useEffect, useMemo, useState } from 'react'
import { previewCrashed } from '@shared/runtime'
import { deliveryTitle } from '@shared/timeline'
import type { Delivery, PreviewInfo, Readiness, Task } from '@shared/types'
import { activeProject, actions, sortedTasks, store, useApp } from '../../store'
import { Icon, Pill, type Tone } from '../common'
import { Studio } from '../studio/Studio'
import { Deliveries } from '../deliveries/Deliveries'

/** One honest headline for a result, from its tasks and the evidence behind it. */
export function resultState(d: Delivery, tasks: Task[], r: Readiness | null, preview?: Pick<PreviewInfo, 'status' | 'error'> | null): { label: string; tone: Tone; detail: string } {
  const own = tasks.filter((t) => t.deliveryId === d.id && t.status !== 'proposed')
  const done = own.filter((t) => t.status === 'done').length
  const stuck = own.filter((t) => t.status === 'failed' || t.status === 'interrupted').length
  const skipped = own.filter((t) => t.status === 'cancelled').length
  const v = d.verification
  if (d.status === 'implementing' && v?.state === 'fixing') return { label: 'Fixing', tone: 'warn', detail: `It failed when run for real; the team is on it (repair ${v.attempts}). ${v.steps.find((s) => s.status === 'failed')?.detail ?? ''}` }
  if (d.status === 'validating') return { label: 'Verifying', tone: 'info', detail: v?.reason ?? (v?.steps.length ? `Checked so far: ${v.steps.map((s) => s.label.toLowerCase()).join(', ')}.` : 'Running it for real in the project folder.') }
  if (d.status === 'implementing') return { label: 'In progress', tone: 'info', detail: `${done} of ${own.length} tasks done so far.` }
  if (d.status === 'accepted') return { label: 'Accepted', tone: 'ok', detail: d.decisionNote ?? 'You accepted this result.' }
  if (d.status === 'rejected') return { label: 'Discarded', tone: 'muted', detail: d.decisionNote ?? 'You discarded this result.' }
  if (d.status === 'revising') return { label: 'Changes requested', tone: 'muted', detail: 'A newer result follows from your feedback.' }
  if (!done && own.length) return { label: 'Didn’t finish', tone: 'danger', detail: 'No task in this request finished, so there is nothing new to try yet.' }
  if (stuck || skipped) return { label: 'Partly done', tone: 'warn', detail: `${done} of ${own.length} tasks finished; ${stuck ? `${stuck} stopped` : ''}${stuck && skipped ? ', ' : ''}${skipped ? `${skipped} skipped` : ''}.` }
  // the running app outranks any recorded evidence: a crashed preview is never "ready"
  if (previewCrashed(preview)) return { label: 'Preview crashed', tone: 'danger', detail: preview?.error ?? 'The dev server stopped.' }
  // measured when it was run: agents finishing never overrides this
  if (v?.state === 'blocked') return { label: 'Blocked', tone: 'danger', detail: v.reason ?? 'It couldn’t be verified.' }
  if (v?.state === 'failed') return { label: 'Needs fixes', tone: 'danger', detail: v.reason ?? 'It failed when run for real.' }
  if (!r) return { label: 'Ready to review', tone: 'warn', detail: 'Checking the evidence…' }
  if (r.verdict === 'ready_with_exceptions' && r.completion.status === 'limited') return { label: 'Ready · with notes', tone: 'info', detail: 'Open items were accepted with a note.' }
  const c = r.completion
  if (c.status === 'verified') return { label: 'Ready · verified', tone: 'ok', detail: c.headline }
  if (c.status === 'failed') return { label: 'Needs fixes', tone: 'danger', detail: c.headline }
  if (c.status === 'partial') return { label: 'Partly done', tone: 'warn', detail: c.headline }
  if (c.status === 'blocked') return { label: 'Ready · checks blocked', tone: 'warn', detail: c.headline }
  return { label: 'Ready · with limitations', tone: 'warn', detail: c.headline }
}

/** Where a product's results live: the running product in Preview, the record of what was delivered in Deliveries. */
export function ResultView() {
  const pane = useApp((s) => s.resultPane)
  const id = useApp((s) => s.resultId)
  const deliveries = useApp((s) => s.deliveries)
  const target = useApp((s) => s.target)
  const d = deliveries.find((x) => x.id === id) ?? deliveries.find((x) => x.status === 'review') ?? deliveries.find((x) => x.completedAt) ?? null
  // keep the Composer aimed at this result while it's open
  useEffect(() => {
    if (d && target.deliveryId !== d.id) store.setState({ target: { newProject: false, employeeId: null, taskId: null, deliveryId: d.id } })
    // the Composer stops pointing at this result once you leave it
    return () => {
      const t = store.getState().target
      if (d && t.deliveryId === d.id) store.setState({ target: { ...t, deliveryId: null } })
    }
  }, [d?.id])
  if (pane !== 'preview') return <div className="rv"><Deliveries /></div>
  return <div className="rv"><Studio head={d ? <ResultStrip key={d.id} d={d} /> : undefined} /></div>
}

/** The detail, without saying the label again. */
export function detailAfter(label: string, detail: string): string {
  if (!detail.toLowerCase().startsWith(`${label.toLowerCase()}:`)) return detail
  const rest = detail.slice(label.length + 1).trim()
  return rest[0].toUpperCase() + rest.slice(1)
}

/** Above the running product: which result this is, where it stands, and the two things you might do about it. */
function ResultStrip({ d }: { d: Delivery }) {
  const project = useApp(activeProject)!
  const tasks = useApp(sortedTasks)
  const preview = useApp((s) => s.preview)
  const reports = useApp((s) => s.qualityReports.length)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [deciding, setDeciding] = useState(false)
  useEffect(() => {
    void window.autopia.readiness(project.id, d.id).then(setReadiness, () => setReadiness(null))
  }, [project.id, d.id, d.status, reports, preview?.status])
  const state = resultState(d, tasks, readiness, preview?.projectId === d.projectId ? preview : null)
  const incomplete = previewCrashed(preview?.projectId === d.projectId ? preview : null) || ['Blocked', 'Didn’t finish', 'Partly done', 'Needs fixes'].includes(state.label)
  const decide = async (decision: 'accept' | 'reject') => {
    setDeciding(true)
    await actions.run(() => window.autopia.decideDelivery(d.id, decision, null))
    setDeciding(false)
  }
  return (
    <header className="rv-head">
      <div className="rv-title">
        <h2>{deliveryTitle(d)}</h2>
        <div className="rv-status">
          <span className="small faint">Result #{d.number}</span>
          <Pill tone={state.tone}>{state.label}</Pill>
          <span className="muted small rv-status-detail" data-tip={state.detail}>{detailAfter(state.label, state.detail)}</span>
          <button className="link small" onClick={() => actions.openDelivery(d.id)}>
            Details
          </button>
        </div>
      </div>
      {d.status === 'review' && (
        <div className="row gap">
          <button className="btn btn-sm btn-ghost" disabled={deciding} onClick={() => void decide('reject')} data-tip="Marks this result as not wanted. Its changes stay in the project until you undo them.">
            Discard
          </button>
          <button className={`btn btn-sm${incomplete ? ' btn-ghost' : ' btn-primary'}`} disabled={deciding} onClick={() => void decide('accept')}>
            <Icon name="check" size={12} /> {incomplete ? 'Mark reviewed anyway' : 'Mark as reviewed'}
          </button>
        </div>
      )}
    </header>
  )
}

export function useLatestResult(): Delivery | null {
  const deliveries = useApp((s) => s.deliveries)
  return useMemo(() => deliveries.find((d) => d.status === 'review') ?? null, [deliveries])
}
