// One honest line for "where does this stand and what happens next", from real state only. Shown beside
// the composer so you never have to work out which panel to look at. No AI, nothing guessed.

import type { Approval, Delivery, Project, Task } from './types'

export type NextAction = 'stop' | 'resume' | 'pause' | 'decide' | 'cancel_planning' | 'retry' | 'open_task' | 'review' | 'execution'

export interface WhatsNext {
  tone: 'info' | 'warn' | 'danger' | 'ok' | 'muted'
  /** A spinner: something is actively happening without you. */
  live?: boolean
  text: string
  /** Why, or what follows. */
  detail?: string
  action?: { kind: NextAction; label: string; taskId?: string; deliveryId?: string }
  /** A second, quieter action. */
  also?: { kind: NextAction; label: string }
}

const first = (name: string | undefined) => name?.split(' ')[0]
const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names[0]} and ${names.length - 1} others`)

/** null when nothing is going on and nothing is waiting: the conversation speaks for itself. */
export function whatsNext(x: {
  project: Pick<Project, 'phase' | 'paused' | 'lastError'>
  approvals: (Pick<Approval, 'status' | 'kind' | 'title'> & Partial<Pick<Approval, 'taskId'>>)[]
  deliveries: (Pick<Delivery, 'id' | 'number' | 'status' | 'verification'> & Partial<Pick<Delivery, 'limitations'>>)[]
  tasks: Pick<Task, 'id' | 'title' | 'status' | 'assigneeId' | 'lastError'>[]
  nameOf: (employeeId: string) => string | undefined
}): WhatsNext | null {
  const { project, tasks } = x
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'merging')
  const people = [...new Set(running.map((t) => first(x.nameOf(t.assigneeId)) ?? 'A teammate'))]
  const pending = x.approvals.filter((a) => a.status === 'pending')
  const stuck = tasks.find((t) => t.status === 'failed' || t.status === 'interrupted')
  const validating = x.deliveries.find((d) => d.status === 'validating')
  const fixing = x.deliveries.find((d) => d.status === 'implementing' && d.verification?.state === 'fixing')
  const review = x.deliveries.find((d) => d.status === 'review')

  // what only you can do comes first
  if (pending.length) {
    const a = pending[0]
    // whoever a live prompt is holding isn't working: they're waiting for you
    const held = new Set(pending.filter((p) => p.kind === 'permission' || p.kind === 'question').map((p) => p.taskId))
    const others = [...new Set(running.filter((t) => !held.has(t.id)).map((t) => first(x.nameOf(t.assigneeId)) ?? 'A teammate'))]
    const what = a.kind === 'plan' ? 'The plan is ready for your OK' : a.kind === 'question' ? 'A teammate has a question' : a.kind === 'verify' ? 'Autopia needs your OK to run the result' : a.kind === 'permission' ? 'A teammate needs your permission' : 'Waiting for your decision'
    return { tone: 'warn', text: pending.length > 1 ? `${pending.length} decisions are waiting for you` : what, detail: others.length ? `${list(others)} keep${others.length === 1 ? 's' : ''} working meanwhile.` : running.length ? `${list(people)} ${people.length === 1 ? 'is' : 'are'} paused until you answer.` : a.kind === 'task_failed' ? 'Its work is kept. Autopia continues it by itself when that’s safe.' : 'Nothing moves until you answer.', action: { kind: 'decide', label: 'Show me' } }
  }
  if (project.paused) return { tone: 'muted', text: 'Paused', detail: running.length ? 'What’s running finishes; nothing new starts.' : 'Nothing new starts until you resume.', action: { kind: 'resume', label: 'Resume' } }
  if (stuck && !running.length) {
    return { tone: 'danger', text: `“${stuck.title.slice(0, 48)}” ${stuck.status === 'interrupted' ? 'was interrupted' : 'stopped'}`, detail: stuck.lastError?.split('\n')[0].slice(0, 140) ?? 'Try it again, or tell the team what to change.', action: { kind: 'retry', label: 'Try again', taskId: stuck.id }, also: { kind: 'open_task', label: 'Details' } }
  }
  if (project.phase === 'planning') return { tone: 'info', live: true, text: 'Planning', detail: 'You’ll see the plan here before anyone builds.', action: { kind: 'cancel_planning', label: 'Cancel' } }
  if (validating) return { tone: 'info', live: true, text: 'Verifying it for real', detail: 'Installing, running the checks, starting the app and loading the page.', action: { kind: 'execution', label: 'Details' } }
  if (fixing && running.length) return { tone: 'warn', live: true, text: `${list(people)} ${people.length === 1 ? 'is' : 'are'} fixing what failed`, detail: 'It’s verified again as soon as the fix is in.', action: { kind: 'stop', label: 'Stop' }, also: { kind: 'execution', label: 'Details' } }
  if (running.length) return { tone: 'info', live: true, text: `${list(people)} ${people.length === 1 ? 'is' : 'are'} working`, detail: 'Message the team any time: it reaches them without restarting.', action: { kind: 'stop', label: 'Stop' }, also: { kind: 'execution', label: 'Details' } }
  if (review) {
    const v = review.verification
    if (v?.state === 'failed' || v?.state === 'blocked') return { tone: 'danger', text: `Result #${review.number} ${v.state === 'blocked' ? 'is blocked' : 'needs fixes'}`, detail: v.reason?.slice(0, 160), action: { kind: 'review', label: 'See why', deliveryId: review.id } }
    const gaps = review.limitations?.length ?? 0
    if (gaps) return { tone: 'warn', text: `Result #${review.number} is ready, with ${gaps === 1 ? '1 thing' : `${gaps} things`} to check`, detail: 'Not everything was verified: look before you accept it.', action: { kind: 'review', label: 'Review', deliveryId: review.id } }
    return { tone: 'ok', text: `Result #${review.number} is ready for you`, detail: 'Try it, then accept it or ask for changes.', action: { kind: 'review', label: 'Review', deliveryId: review.id } }
  }
  if (project.phase === 'blocked' || project.phase === 'failed') return { tone: 'muted', text: 'Work stopped', detail: project.lastError?.split('\n')[0].slice(0, 140) ?? 'Send a request to pick it up again.' }
  return null
}
