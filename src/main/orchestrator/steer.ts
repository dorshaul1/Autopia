// Messages you send while a teammate is working reach their running session right away when it can take
// them, otherwise when its turn ends. The queue is plain data (kept in meta by the orchestrator, so a restart
// never loses it): per task, in the order you sent them, each delivered exactly once.

export interface SteerItem {
  messageId: string
  text: string
  /** It's in the session's conversation (Claude Code echoed it back), so it isn't sent again. */
  delivered?: boolean
  /** Written to the session, not yet echoed back. */
  sent?: boolean
  /** The task hasn't started: it gets this in its first prompt. */
  viaPrompt?: boolean
}
export type SteerQueue = Record<string, SteerItem[]>

export function enqueue(q: SteerQueue, taskId: string, item: SteerItem): SteerQueue {
  const mine = (q[taskId] ?? []).filter((m) => m.messageId !== item.messageId)
  return { ...q, [taskId]: [...mine, item] }
}

/** Everything waiting for this task, and the queue without it. */
export function take(q: SteerQueue, taskId: string): { items: SteerItem[]; rest: SteerQueue } {
  const items = q[taskId] ?? []
  if (!items.length) return { items, rest: q }
  const rest = { ...q }
  delete rest[taskId]
  return { items, rest }
}
