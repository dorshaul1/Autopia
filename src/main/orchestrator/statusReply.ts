// The instant reply to a note for the team: that the team got it, and where the work really stands
// (what is done and where its files are, who is on what, what waits for you, how to see it running).
// Deterministic, from records only: no AI call, nothing claimed that the task states don't show.

import { shortCommand } from '@shared/checks'
import { firstName } from '@shared/naming'
import type { Approval, Employee, EmployeeStatus, Project, Task } from '@shared/types'

export interface StatusFacts {
  project: Pick<Project, 'name' | 'path' | 'phase' | 'gitEnabled' | 'baseBranch'>
  tasks: Pick<Task, 'id' | 'title' | 'status' | 'assigneeId' | 'changedFiles' | 'deliveryId'>[]
  approvals: Pick<Approval, 'kind' | 'taskId' | 'title' | 'body'>[]
  employees: Pick<Employee, 'id' | 'name'>[]
  statuses: Pick<EmployeeStatus, 'employeeId' | 'activity' | 'taskId' | 'detail'>[]
  /** Whether the project has something Autopia can run as a preview. */
  previewable: boolean
  /** Whether a preview is running now. */
  previewRunning: boolean
}

const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`

function permissionSubject(body: string): string {
  try {
    return (JSON.parse(body) as { subject?: string }).subject ?? body
  } catch {
    return body
  }
}

export function statusReply(f: StatusFacts): string {
  const name = (id: string | null | undefined) => firstName(f.employees.find((e) => e.id === id)?.name) ?? 'A teammate'
  const live = f.tasks.filter((t) => t.status !== 'proposed' && t.status !== 'cancelled')
  const done = live.filter((t) => t.status === 'done')
  const active = live.filter((t) => t.status === 'running' || t.status === 'merging')
  const stuck = live.filter((t) => t.status === 'failed' || t.status === 'interrupted')
  const waiting = live.filter((t) => t.status === 'pending')
  const lines: string[] = []

  if (!live.length) {
    lines.push(f.project.phase === 'planning' ? 'The team is still planning; work starts once the plan is ready.' : 'Nothing is being built right now.')
    return lines.join('\n')
  }
  // files only land in the project folder once a step is finished and merged
  if (done.length) {
    const files = new Set(done.flatMap((t) => t.changedFiles)).size
    lines.push(`Done: ${done.length} of ${live.length} steps${files ? `, ${files} file${files === 1 ? '' : 's'} in the project folder` : ''}.`)
  } else {
    lines.push('Nothing is finished yet. Files reach the project folder as each step is done.')
  }
  for (const t of active) {
    const perm = f.approvals.find((a) => a.kind === 'permission' && a.taskId === t.id)
    const st = f.statuses.find((s) => s.employeeId === t.assigneeId)
    if (perm) lines.push(`${name(t.assigneeId)} is on ${quote(t.title)} and needs your OK to run \`${shortCommand(permissionSubject(perm.body), 60)}\`.`)
    else lines.push(`${name(t.assigneeId)} is working on ${quote(t.title)}${st?.detail ? ` (${st.detail})` : ''}.`)
  }
  const perms = f.approvals.filter((a) => a.kind === 'permission')
  if (perms.length && !active.some((t) => perms.some((a) => a.taskId === t.id))) lines.push(`${perms.length} permission request${perms.length === 1 ? ' is' : 's are'} waiting for you.`)
  for (const t of stuck) lines.push(`${name(t.assigneeId)}'s ${quote(t.title)} ${t.status === 'interrupted' ? 'was interrupted and can continue' : 'is stuck'}; see its card to decide.`)
  if (waiting.length) lines.push(`${waiting.length} more step${waiting.length === 1 ? '' : 's'} up next.`)
  if (f.previewRunning) lines.push('The preview is running: open it in Results.')
  else if (f.previewable && done.length) lines.push('To see it running, open Preview in Results.')
  return lines.join('\n')
}

/** The answer to a note: it got there, plus only what's waiting on you. The line above the composer has the rest. */
export function noteReply(f: StatusFacts, to?: string[]): string {
  const waiting = f.approvals.filter((a) => a.kind === 'permission').length
  const who = [...new Set(to ?? [])]
  const head = !to ? 'Got it: the team sees this in their next step.' : who.length ? `Got it: passing this to ${who.length <= 2 ? who.join(' and ') : `${who[0]} and ${who.length - 1} others`}. The others keep working.` : 'Got it, noted. Steps that start from here on will see it.'
  return `${head}${waiting ? ` ${waiting === 1 ? 'One permission request is' : `${waiting} permission requests are`} waiting for you.` : ''}`
}

/** The instant answer to a greeting, a thanks or a stray word: says where things stand, starts nothing. */
export function quickReply(text: string, f: { tasks: Pick<Task, 'title' | 'status' | 'assigneeId'>[]; employees: Pick<Employee, 'id' | 'name'>[]; review: number | null }): string {
  const t = text.trim().toLowerCase()
  const opener = /^(how are you|what'?s up|whats up|מה קורה)/.test(t)
    ? 'Doing well, thanks! '
    : /^(hi|hey|hello|hiya|yo|sup|howdy|shalom|good |morning|how are|what'?s up|שלום|היי|הי|מה קורה)/.test(t)
    ? 'Hi! '
    : /^(thanks?|thx|ty|cheers|תודה)/.test(t)
      ? 'You’re welcome. '
      : /^(ok|k$|cool|nice|great|good|awesome|perfect|got it|sure|yes|yep|no|nope|lol|bye|אוקי|סבבה|יופי|מעולה|כן|לא)/.test(t)
        ? ''
        : 'I’m not sure what you’d like me to do with that, so I didn’t start anything. '
  const active = f.tasks.filter((x) => x.status === 'running' || x.status === 'merging')
  const state = active.length
    ? `${firstName(f.employees.find((e) => e.id === active[0].assigneeId)?.name) ?? 'A teammate'} is working on ${quote(active[0].title)}${active.length > 1 ? ` and ${active.length - 1} more` : ''}.`
    : f.review
      ? `Result #${f.review} is waiting for your review.`
      : 'Nobody is working right now.'
  if (/^(bug|bugs|broken|error|errors|crash|crashed|issue|problem|help|באג|שגיאה|עזרה|בעיה)[\s!.,?…]*$/.test(t)) return `What went wrong? Tell me what you saw, or attach a screenshot, and the team will fix it. ${state}`
  // only a message that says nothing needs the nudge; a greeting just gets a greeting
  return opener.startsWith('I’m not sure') ? `${opener}${state} Tell me what you’d like changed, or ask about the project.` : `${opener}${state}`
}
