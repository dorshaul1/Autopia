import { copiesByVersion, isNewer } from '../src/shared/claudeCode'
import { describe, expect, it } from 'vitest'
import { exactCommand, outcomeLine, searchCommands, typingTarget, withoutTyped, type CommandEntry } from '../src/shared/commandResolve'
import { replyTo, requestState, threadWith } from '../src/shared/requestLifecycle'

const entries: CommandEntry[] = [
  { id: 'preview', label: 'Preview', aliases: ['running app'], direct: true },
  { id: 'settings', label: 'Settings', aliases: ['preferences'], direct: true },
  { id: 'task', label: 'Add a preview button', direct: false },
  { id: 'delete', label: 'Delete this product', direct: true }
]
const exact = (t: string) => exactCommand(t, entries)?.id ?? null

describe('words that plainly name something local', () => {
  it('just do it, however you say it', () => {
    for (const t of ['preview', 'Preview', 'open preview', 'Open the preview.', 'go to preview', 'show me the preview', 'please open the running app']) expect(exact(t), t).toBe('preview')
    expect(exact('settings')).toBe('settings')
  })
  it('anything more is a request for the team', () => {
    for (const t of ['add a preview button', 'preview looks broken', 'why is the preview slow?', 'fix settings', 'open the preview and fix the header']) expect(exact(t), t).toBeNull()
  })
  it('a task is found, never run by naming it', () => expect(exact('add a preview button')).toBeNull())
  it('search finds, and never decides', () => {
    expect(searchCommands('prev', entries).map((e) => e.id)).toContain('preview')
    expect(searchCommands('', entries)).toEqual([])
  })
})

describe('aiming', () => {
  it('sees @ and # only while being typed', () => {
    expect(typingTarget('ask @the')).toEqual({ kind: '@', query: 'the' })
    expect(typingTarget('#')).toEqual({ kind: '#', query: '' })
    expect(typingTarget('me@example.com hello')).toBeNull()
    expect(typingTarget('issue #12 is bad')).toBeNull()
  })
  it('the word goes once it is a chip', () => expect(withoutTyped('fix this @the')).toBe('fix this'))
})

describe('what Enter will do, said first', () => {
  const base = { hasText: true, local: null, direct: false, intent: 'build', to: null, task: null, result: null, product: 'Ember', direction: false }
  it('says when nothing is sent', () => expect(outcomeLine({ ...base, local: 'Preview.' })).toMatch(/no AI/))
  it('tells a question from a request', () => {
    expect(outcomeLine({ ...base, intent: 'ask' })).toMatch(/nothing changes/)
    expect(outcomeLine(base)).toMatch(/plan for your OK/)
    expect(outcomeLine({ ...base, intent: 'note' })).toMatch(/without restarting/)
  })
  it('names who and what', () => expect(outcomeLine({ ...base, intent: 'ask', to: 'Theo', task: 'T2' })).toMatch(/Theo about T2/))
  it('warns that direct goes to the folder', () => expect(outcomeLine({ ...base, direct: true })).toMatch(/asks before acting/))
  it('outside a product, nothing can be sent to one', () => expect(outcomeLine({ ...base, product: null })).toMatch(/after you confirm/))
})

describe('where a request stands', () => {
  const m = (o: object) => ({ status: 'sent', intent: 'build', error: null, deliveryId: null, ...o }) as never
  const d = (status: string) => ({ id: 'd', status, number: 3 }) as never
  const none: { status: string }[] = []
  it('never says running before something is', () => {
    expect(requestState(m({}), null, [], false).stage).toBe('submitted')
    expect(requestState(m({}), d('implementing'), [], false).stage).toBe('accepted')
    expect(requestState(m({}), d('implementing'), [{ status: 'pending' }] as never, false).stage).toBe('queued')
    expect(requestState(m({}), d('implementing'), [{ status: 'running' }] as never, false).stage).toBe('running')
  })
  it('stopping is not failing', () => {
    expect(requestState(m({ status: 'failed', error: 'Stopped by you' }), null, none as never, false).stage).toBe('cancelled')
    expect(requestState(m({ status: 'failed', error: 'boom' }), null, none as never, false).stage).toBe('failed')
  })
  it('waiting on you outranks the rest', () => expect(requestState(m({}), d('implementing'), [{ status: 'running' }] as never, true).stage).toBe('waiting'))
  it('work that stopped says so', () => expect(requestState(m({}), d('implementing'), [{ status: 'failed' }] as never, false).label).toBe('Stopped'))
  it('finishes with the result', () => expect(requestState(m({}), d('review'), [], false)).toMatchObject({ stage: 'completed', label: 'Result #3 ready', kind: 'work', deliveryId: 'd' }))
  it('keeps an answer apart from work', () => {
    expect(requestState(m({ intent: 'ask', status: 'answered' }), null, [], false).kind).toBe('answer')
    expect(requestState(m({ status: 'working', intent: 'ask' }), null, [], false)).toMatchObject({ stage: 'running', label: 'Being answered', kind: 'answer' })
  })
  it('notes say how far they got', () => {
    expect(requestState(m({ status: 'queued' }), null, [], false).stage).toBe('queued')
    expect(requestState(m({ status: 'delivered' }), null, [], false).stage).toBe('accepted')
    expect(requestState(m({ status: 'applied' }), null, [], false).stage).toBe('completed')
  })
})

describe('threads', () => {
  const msgs = [{ id: '1', role: 'user', intent: 'ask', employeeId: 'a' }, { id: '2', role: 'autopia', intent: 'ask', employeeId: 'a' }, { id: '3', role: 'user', intent: 'ask', employeeId: null }, { id: '4', role: 'autopia', intent: 'note', employeeId: 'b' }] as never[]
  it('one teammate or everyone', () => {
    expect(threadWith(msgs, 'a')).toHaveLength(2)
    expect(threadWith(msgs, null)).toHaveLength(4)
  })
  it('finds the reply, not a note', () => {
    expect((replyTo(msgs as { id: string; role: 'user'; intent: 'ask' }[], '1') as unknown as { id: string }).id).toBe('2')
    expect(replyTo(msgs as { id: string; role: 'user'; intent: 'ask' }[], '3')).toBeNull()
  })
})

describe('is Claude Code behind?', () => {
  it('compares versions number by number', () => {
    expect(isNewer('2.1.280', '2.1.235 (Claude Code)')).toBe(true)
    expect(isNewer('2.1.235', '2.1.235')).toBe(false)
    expect(isNewer('2.1.99', '2.1.235')).toBe(false)
    expect(isNewer('3.0.0', '2.9.9')).toBe(true)
  })
  it('says nothing when it can’t tell', () => {
    expect(isNewer(null, '2.1.235')).toBe(false)
    expect(isNewer('2.1.280', null)).toBe(false)
    expect(isNewer('latest', '2.1.235')).toBe(false)
  })
})

describe('which Claude Code', () => {
  it('newest first, wherever it is', () => {
    const list = [{ path: 'path', version: '2.1.235' }, { path: 'desktop', version: '2.1.309' }, { path: 'vscode', version: '2.1.304' }, { path: 'unknown', version: '0.0.0' }]
    expect(copiesByVersion(list).map((c) => c.path)).toEqual(['desktop', 'vscode', 'path', 'unknown'])
  })
})
