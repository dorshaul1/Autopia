import { useEffect } from 'react'
import { replyTo, requestState } from '@shared/requestLifecycle'
import { actions, store, useApp } from '../../store'
import { Avatar, Icon } from '../common'
import { Markdown } from '../Markdown'

const DIRECTION: Record<string, string> = {
  replanned: 'Sent back to planning: the plan is being revised with this.',
  queued: 'Noted. Work that hasn’t started yet will follow it; finished work isn’t redone.',
  revision: 'Started: the team is making this change.'
}

/**
 * What became of something sent from the Command, without opening a chat. A short answer is simply here; anything more
 * is one click away. It reads real message state, and leaves on its own once there's nothing to wait for.
 */
export function Receipt() {
  const r = useApp((s) => s.receipt)
  const active = useApp((s) => s.activeProjectId)
  const messages = useApp((s) => s.messages)
  const deliveries = useApp((s) => s.deliveries)
  const tasks = useApp((s) => s.tasks)
  const approvals = useApp((s) => s.approvals)
  const employees = useApp((s) => s.employees)
  const panelOnThread = useApp((s) => s.panelOpen && s.sheet[s.sheet.length - 1]?.kind === 'conversation')
  // another product: its message isn't here, so nothing about it can show or leak
  const here = !!r && r.projectId === active
  const mine = here && r.kind === 'message' ? messages.find((m) => m.id === r.messageId) ?? null : null
  const delivery = mine?.deliveryId ? deliveries.find((d) => d.id === mine.deliveryId) ?? null : null
  const own = delivery ? Object.values(tasks).filter((t) => t.deliveryId === delivery.id && t.status !== 'proposed') : []
  const state = mine ? requestState(mine, delivery, own, Object.values(approvals).some((a) => a.status === 'pending' && (delivery ? a.projectId === delivery.projectId : false))) : null
  const reply = mine ? replyTo(messages, mine.id) : null
  const replied = reply?.status === 'answered' && reply.text
  const settled = r?.kind === 'direction' || (!!state && ['completed', 'failed', 'cancelled'].includes(state.stage) && (state.stage !== 'completed' || !replied))
  const dismiss = () => store.setState({ receipt: null })
  useEffect(() => {
    if (!settled || !r) return
    const t = setTimeout(dismiss, 6000)
    return () => clearTimeout(t)
  }, [settled, r])
  // the conversation is open and shows all of this already
  if (!r || !here || (panelOnThread && r.kind === 'message')) return null
  if (r.kind === 'message' && !mine) return null
  const who = employees.find((e) => e.id === reply?.employeeId) ?? null
  const long = replied && reply.text.length > 420
  return (
    <div className="toast receipt" role="status">
      <div className="receipt-head">
        {r.kind === 'direction' ? (
          <span className="receipt-state">
            <Icon name="check" size={12} /> {DIRECTION[r.outcome]}
          </span>
        ) : (
          <span className={`receipt-state st-${state!.stage}`}>
            {state!.stage === 'running' ? <span className="spinner spinner-sm" aria-hidden /> : <span className="pulse-dot" aria-hidden />}
            {who && <Avatar employee={who} size={16} />}
            {replied ? who?.name.split(' ')[0] ?? 'The team' : state!.label}
          </span>
        )}
        {r.kind === 'message' && (
          <button className="link small" onClick={() => (dismiss(), mine?.employeeId ? actions.talkTo(mine.employeeId) : actions.talkTo(null))}>
            Open conversation
          </button>
        )}
        {state?.kind === 'work' && (
          <button className="link small" onClick={() => (dismiss(), actions.goStage('overview'))}>
            Show work
          </button>
        )}
        <button className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={dismiss}>
          <Icon name="close" size={10} />
        </button>
      </div>
      {replied && (
        <div className="receipt-body msg-rich">
          <Markdown text={long ? `${reply.text.slice(0, 420).trimEnd()}…` : reply.text} />
        </div>
      )}
      {mine?.status === 'failed' && <div className="msg-error">{mine.error}</div>}
    </div>
  )
}
