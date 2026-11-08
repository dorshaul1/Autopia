import { describe, expect, it } from 'vitest'
import { noteReply, statusReply, type StatusFacts } from '../src/main/orchestrator/statusReply'

const base: StatusFacts = {
  project: { name: 'Tasks', path: '/Users/me/Autopia/tasks', phase: 'executing', gitEnabled: true, baseBranch: 'main' },
  tasks: [
    { id: 't1', title: 'Scaffold app', status: 'done', assigneeId: 'theo', changedFiles: ['A package.json', 'A src/main.ts'], deliveryId: 'd' },
    { id: 't2', title: 'Design tokens', status: 'done', assigneeId: 'ines', changedFiles: ['A src/main.ts', 'A src/styles.css'], deliveryId: 'd' },
    { id: 't3', title: 'Dashboard list and task CRUD form', status: 'running', assigneeId: 'ines', changedFiles: [], deliveryId: 'd' },
    { id: 't4', title: 'QA', status: 'pending', assigneeId: 'kenji', changedFiles: [], deliveryId: 'd' }
  ],
  approvals: [{ kind: 'permission', taskId: 't3', title: 'Inés wants to run a command', body: JSON.stringify({ tool: 'Bash', subject: 'npm run typecheck' }) }],
  employees: [
    { id: 'theo', name: 'Theo Lindqvist' },
    { id: 'ines', name: 'Inés Duarte' },
    { id: 'kenji', name: 'Kenji Watanabe' }
  ],
  statuses: [],
  previewable: true,
  previewRunning: false
}

describe('a note always gets an answer, from real state only', () => {
  it('says what is done and where the files are, and what is waiting for you', () => {
    const r = statusReply(base)
    expect(r).toContain('Done: 2 of 4 steps, 3 files in the project folder.')
    expect(r).toContain('Inés is on “Dashboard list and task CRUD form” and needs your OK to run `npm run typecheck`.')
    expect(r).toContain('1 more step up next.')
    expect(r).toContain('open Preview in Results')
    expect(r).not.toContain('/Users/me')
  })

  it('before anything is merged, says why there are no files or preview yet', () => {
    const r = statusReply({ ...base, tasks: base.tasks.map((t) => ({ ...t, status: t.status === 'done' ? 'pending' : t.status })), approvals: [] })
    expect(r).toContain('Nothing is finished yet. Files reach the project folder as each step is done.')
    expect(r).not.toMatch(/Done:/)
  })

  it('answers a note in one line, naming only what waits on you', () => {
    expect(noteReply(base)).toBe('Got it: the team sees this in their next step. One permission request is waiting for you.')
    expect(noteReply({ ...base, approvals: [] })).toBe('Got it: the team sees this in their next step.')
  })
})
