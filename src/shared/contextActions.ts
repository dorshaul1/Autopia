// What makes sense to do right now, from where you are and what's really happening. One list, shown in the status bar and
// at the top of ⌘K, so a control only appears when it applies and always means the same thing. No AI.

import type { Stage } from './stages'
import type { NextAction, WhatsNext } from './whatsNext'

export type ContextActionKind = NextAction | 'preview' | 'work' | 'message' | 'log'

export interface ContextAction {
  kind: ContextActionKind
  label: string
  primary?: boolean
  taskId?: string
  deliveryId?: string
  employeeId?: string
  runId?: string
}

export interface ContextInput {
  next: WhatsNext | null
  stage: Stage | null
  previewRunning: boolean
  /** What the side panel is showing. */
  panel: { kind: string; id?: string; runId?: string | null; name?: string } | null
  max?: number
}

const NEEDS_A_DECISION: NextAction[] = ['decide', 'review', 'retry', 'resume']

export function contextActions(x: ContextInput): ContextAction[] {
  const out: ContextAction[] = []
  const add = (a: ContextAction) => {
    if (!out.some((o) => o.kind === a.kind)) out.push(a)
  }
  if (x.next?.action) add({ kind: x.next.action.kind, label: x.next.action.label, taskId: x.next.action.taskId, deliveryId: x.next.action.deliveryId, primary: NEEDS_A_DECISION.includes(x.next.action.kind) })
  if (x.previewRunning && x.stage !== 'preview') add({ kind: 'preview', label: 'See it running' })
  if (x.next?.live && x.stage !== 'overview' && x.next.action?.kind !== 'execution') add({ kind: 'work', label: 'Show work' })
  if (x.panel?.kind === 'employee' && x.panel.id) add({ kind: 'message', label: `Message ${x.panel.name ?? 'them'}`, employeeId: x.panel.id })
  if (x.panel?.kind === 'task' && x.panel.runId) add({ kind: 'log', label: 'Open its log', runId: x.panel.runId })
  if (x.next?.also) add({ kind: x.next.also.kind, label: x.next.also.label })
  return out.slice(0, x.max ?? 3)
}

/** The line when nothing's going on: true, and it says what to do. */
export const QUIET_LINE = { fresh: 'Ready when you are', done: 'Nothing in progress' }
