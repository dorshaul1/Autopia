// Where one thing you asked stands, read only from what's recorded. Nothing here estimates, and nothing says "running"
// until the backend does. It also keeps a conversational answer apart from real development work.

import type { Delivery, Message, Task } from './types'

export type RequestStage = 'submitted' | 'accepted' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export interface RequestState {
  stage: RequestStage
  label: string
  /** Is this development work, or just a conversation? */
  kind: 'answer' | 'work' | 'note'
  deliveryId?: string
}

export function requestState(m: Pick<Message, 'status' | 'intent' | 'error' | 'deliveryId'>, delivery: Pick<Delivery, 'id' | 'status' | 'number'> | null, tasks: Pick<Task, 'status'>[], waitingOnYou: boolean): RequestState {
  const stoppedByYou = /stopped by you|stopped before/i.test(m.error ?? '')
  if (m.status === 'failed') return stoppedByYou ? { stage: 'cancelled', label: 'Stopped', kind: 'answer' } : { stage: 'failed', label: 'Didn’t go through', kind: 'answer' }
  if (delivery) {
    const base = { kind: 'work' as const, deliveryId: delivery.id }
    if (waitingOnYou) return { ...base, stage: 'waiting', label: 'Waiting for you' }
    switch (delivery.status) {
      case 'implementing':
        if (tasks.some((t) => t.status === 'running' || t.status === 'merging')) return { ...base, stage: 'running', label: 'In progress' }
        if (tasks.some((t) => t.status === 'failed' || t.status === 'interrupted')) return { ...base, stage: 'failed', label: 'Stopped' }
        return { ...base, stage: tasks.length ? 'queued' : 'accepted', label: tasks.length ? 'Waiting for a free teammate' : 'Accepted' }
      case 'validating':
        return { ...base, stage: 'running', label: 'Being verified' }
      case 'review':
        return { ...base, stage: 'completed', label: `Result #${delivery.number} ready` }
      case 'accepted':
        return { ...base, stage: 'completed', label: `Result #${delivery.number} accepted` }
      case 'revising':
        return { ...base, stage: 'completed', label: `Result #${delivery.number}, changes asked for` }
      case 'rejected':
        return { ...base, stage: 'cancelled', label: `Result #${delivery.number} discarded` }
    }
  }
  switch (m.status) {
    case 'working':
      return { stage: 'running', label: m.intent === 'ask' ? 'Being answered' : 'In progress', kind: m.intent === 'ask' ? 'answer' : 'work' }
    case 'queued':
      return { stage: 'queued', label: 'Queued for the session that’s running', kind: 'note' }
    case 'delivered':
      return { stage: 'accepted', label: 'Reached the team', kind: 'note' }
    case 'applied':
      return { stage: 'completed', label: 'Applied', kind: 'note' }
    case 'clarify':
      return { stage: 'waiting', label: 'They asked what you meant', kind: 'answer' }
    case 'answered':
      return { stage: 'completed', label: 'Answered', kind: 'answer' }
    default:
      return { stage: 'submitted', label: 'Sent', kind: m.intent === 'ask' ? 'answer' : 'note' }
  }
}

/** The reply to a message: the next thing the team said after it. */
export function replyTo<T extends Pick<Message, 'id' | 'role' | 'intent'>>(messages: T[], id: string): T | null {
  const at = messages.findIndex((m) => m.id === id)
  if (at < 0) return null
  return messages.slice(at + 1).find((m) => m.role === 'autopia' && m.intent === 'ask') ?? null
}

/** One teammate's side of the conversation: what they said and what was said to them. */
export function threadWith<T extends Pick<Message, 'employeeId'>>(messages: T[], employeeId: string | null): T[] {
  return employeeId ? messages.filter((m) => m.employeeId === employeeId) : messages
}
