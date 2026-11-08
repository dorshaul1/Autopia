import { describe, expect, it } from 'vitest'
import { parseTalk, pickResponder, understand, voiceOf } from '../src/shared/conversation'
import { affectedTasks, parseCommand, planRouting, routingLabel, routingStatus, wouldCycle, type SteerTask } from '../src/shared/steering'
import { isStatusQuestion } from '../src/shared/composer'

const t = (key: string, title: string, assigneeId: string, files: string[] = [], description = ''): SteerTask => ({ id: key.toLowerCase(), key, title, description, files, changedFiles: [], assigneeId })
const people = [{ id: 'theo', name: 'Theo Lindqvist' }, { id: 'ines', name: 'Inés Duarte' }]
const header = t('T1', 'Build the header navigation', 'ines', ['src/Header.tsx'])
const api = t('T2', 'Billing API endpoints', 'theo', ['server/billing.ts'])
const about = t('T3', 'About page copy', 'ines', ['about.html'])

describe('which work a message concerns', () => {
  it('names win: a teammate or a step', () => {
    expect(affectedTasks('Theo, use cents for amounts', [header, api], people)).toMatchObject({ scope: 'named', tasks: [api] })
    expect(affectedTasks('T1 needs a logo', [header, api], people)).toMatchObject({ scope: 'named', tasks: [header] })
  })
  it('words and files find the workstream, and the rest stay undisturbed', () => {
    expect(affectedTasks('Make the header navigation sticky', [header, api], people)).toMatchObject({ scope: 'matched', tasks: [header] })
    expect(affectedTasks('billing.ts should round up', [header, api], people)).toMatchObject({ scope: 'matched', tasks: [api] })
  })
  it('a message about everything, or nothing in particular, reaches everyone', () => {
    expect(affectedTasks('Use a dark background on both', [header, api], people).scope).toBe('everyone')
    expect(affectedTasks('Prefer shorter sentences', [header, api], people).scope).toBe('everyone')
  })
})

describe('routing a message', () => {
  const base = { running: [api], upcoming: [about], finished: [header], people }
  it('only the affected session hears it', () => {
    expect(planRouting({ ...base, text: 'Billing API should use cents' })).toMatchObject({ reach: [api], upcoming: [], revisit: [] })
  })
  it('a change to finished work is never lost: it gets revisited', () => {
    expect(planRouting({ ...base, text: 'Make the header navigation sticky' })).toMatchObject({ reach: [], revisit: [header] })
  })
  it('a change for everyone covers running, upcoming and finished work', () => {
    expect(planRouting({ ...base, text: 'Use dark colors everywhere' })).toMatchObject({ reach: [api], upcoming: [about], revisit: [header] })
  })
  it('a remark changes nothing that is finished', () => {
    expect(planRouting({ ...base, text: 'fyi nice progress everyone' }).revisit).toEqual([])
  })
  it('addressed to someone, it goes only to them', () => {
    expect(planRouting({ ...base, text: 'Use tabs', onlyEmployeeId: 'theo' })).toMatchObject({ reach: [api], upcoming: [], revisit: [] })
  })
})

describe('instructions Autopia carries out itself', () => {
  const open = [header, api, about]
  it('cancels, reorders, prioritizes and reassigns', () => {
    expect(parseCommand('skip the about page', open, people)).toMatchObject({ kind: 'cancel', task: about })
    expect(parseCommand('Cancel T2.', open, people)).toMatchObject({ kind: 'cancel', task: api })
    expect(parseCommand('please do the billing api first', open, people)).toMatchObject({ kind: 'prioritize', task: api })
    expect(parseCommand('billing api is urgent', open, people)).toMatchObject({ kind: 'prioritize', task: api })
    expect(parseCommand('do T3 before T2', open, people)).toMatchObject({ kind: 'order', first: about, then: api })
    expect(parseCommand('do T3 after T2', open, people)).toMatchObject({ kind: 'order', first: api, then: about })
    expect(parseCommand('give the about copy to Theo', open, people)).toMatchObject({ kind: 'assign', task: about, employee: { id: 'theo' } })
    expect(parseCommand('let Theo handle T1', open, people)).toMatchObject({ kind: 'assign', task: header })
  })
  it('asks instead of guessing between two steps', () => {
    const r = parseCommand('cancel the page', [t('T4', 'Contact form', 'a'), t('T5', 'Contact map', 'a')], people)
    expect(r).toBeNull() // "page" says nothing
    expect(parseCommand('cancel contact', [t('T4', 'Contact form', 'a'), t('T5', 'Contact map', 'a')], people)).toMatchObject({ kind: 'clarify', verb: 'cancel' })
  })
  it('leaves ordinary edits alone: they are instructions for a session', () => {
    expect(parseCommand('remove the footer from the header', open, people)).toBeNull()
    expect(parseCommand('skip animations', open, people)).toBeNull()
    expect(parseCommand('use dark colors', open, people)).toBeNull()
  })
  it('refuses an order that would deadlock', () => {
    expect(wouldCycle([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: [] }], 'b', 'a')).toBe(true)
    expect(wouldCycle([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: [] }], 'b', 'a')).toBe(false)
  })
})

describe('what you see under your message', () => {
  const target = (name: string, state: 'queued' | 'delivered' | 'applied' | 'released') => ({ taskId: name, key: 'T1', name, state })
  it('never reads further along than the slowest target', () => {
    expect(routingStatus({ targets: [target('Theo', 'queued')] })).toBe('queued')
    expect(routingStatus({ targets: [target('Theo', 'delivered'), target('Inés', 'queued')] })).toBe('delivered')
    expect(routingStatus({ targets: [target('Theo', 'applied'), target('Inés', 'delivered')] })).toBe('delivered')
    expect(routingStatus({ targets: [target('Theo', 'applied')] })).toBe('applied')
    expect(routingStatus({ targets: [target('Theo', 'released')] })).toBe('sent')
  })
  it('says who', () => {
    expect(routingLabel('queued', { targets: [target('Theo', 'queued')] })).toBe('queued for Theo')
    expect(routingLabel('delivered', { targets: [target('Theo', 'delivered'), target('Inés', 'queued')] })).toBe('reached Theo; queued for Inés')
    expect(routingLabel('applied', { targets: [target('Theo', 'applied')] })).toBe('applied by Theo')
    expect(routingLabel('clarify', null)).toBe('needs your answer')
  })
  it('answers "what is X doing" from the records', () => {
    expect(isStatusQuestion("what's Theo doing?")).toBe(true)
    expect(isStatusQuestion('what is Inés working on')).toBe(true)
  })
})

describe('one input', () => {
  const team = [{ id: 'maya', name: 'Maya Okafor', role: 'pm' as const, kinds: [] }, { id: 'theo', name: 'Theo Lindqvist', role: 'lead_dev' as const, kinds: ['code' as const] }, { id: 'ines', name: 'Inés Navarro', role: 'designer' as const, kinds: ['design' as const] }, { id: 'kenji', name: 'Kenji Watanabe', role: 'qa' as const, kinds: ['qa' as const] }]
  const base = { team, tasks: [], recent: [], now: 1000 }
  it('only a clear instruction starts work without asking', () => {
    expect(understand('Add a contact page to the site')).toBe('work')
    expect(understand('hi')).toBe('talk')
    expect(understand('I was thinking about a contact page')).toBe('talk')
    expect(understand('the header looks broken')).toBe('talk')
    expect(understand('fix it')).toBe('talk')
    expect(understand('Add it now?')).toBe('talk')
    expect(understand("what's happening")).toBe('status')
  })
  it('the right person answers', () => {
    expect(pickResponder({ ...base, text: 'hi' })).toMatchObject({ id: 'maya', why: 'lead' })
    expect(pickResponder({ ...base, text: 'hey theo' })).toMatchObject({ id: 'theo', why: 'addressed' })
    expect(pickResponder({ ...base, text: 'hi', employeeId: 'kenji' })).toMatchObject({ id: 'kenji', why: 'addressed' })
    expect(pickResponder({ ...base, text: 'is the font too small?' })).toMatchObject({ id: 'ines', why: 'expertise' })
    expect(pickResponder({ ...base, text: 'are the tests flaky?' })).toMatchObject({ id: 'kenji', why: 'expertise' })
    expect(pickResponder({ ...base, text: 'why is the api slow' })).toMatchObject({ id: 'theo', why: 'expertise' })
  })
  it('a conversation stays with whoever you were talking to', () => {
    const recent = [{ role: 'autopia' as const, employeeId: 'ines', createdAt: 900 }]
    expect(pickResponder({ ...base, recent, text: 'and then?' })).toMatchObject({ id: 'ines', why: 'continuing' })
    expect(pickResponder({ ...base, recent, text: 'and the colors?' })).toMatchObject({ id: 'ines', why: 'continuing' })
    expect(pickResponder({ ...base, recent, text: 'and the api?' })).toMatchObject({ id: 'theo', why: 'expertise' })
    expect(pickResponder({ ...base, recent, now: 10_000_000, text: 'and then?' })).toMatchObject({ id: 'maya', why: 'lead' })
  })
  it('people sound like themselves, everywhere and differently', () => {
    expect(voiceOf({ id: 'emp-theo@abc' })).toEqual(voiceOf({ id: 'emp-theo' }))
    expect(voiceOf({ id: 'emp-theo' })).not.toEqual(voiceOf({ id: 'emp-ines' }))
    expect(voiceOf({ id: 'emp-5e55-2' })).toEqual(voiceOf({ id: 'emp-5e55-2' }))
  })
  it('never starts work on a vague answer', () => {
    expect(parseTalk({ reply: 'on it', action: 'new_work', request: '', handoff: null })?.action).toBe('clarify')
    expect(parseTalk({ reply: 'hello', action: 'whatever', request: null, handoff: null })?.action).toBe('none')
    expect(parseTalk({ reply: ' ', action: 'none' })).toBeNull()
    expect(parseTalk(null)).toBeNull()
  })
})

describe('names with accents', () => {
  const team = [{ id: 'ines', name: 'Inés Navarro', role: 'designer' as const, kinds: ['design' as const] }, { id: 'maya', name: 'Maya Okafor', role: 'pm' as const, kinds: [] }]
  it('"ines" is Inés, everywhere', () => {
    expect(pickResponder({ text: 'hi ines', team, tasks: [], recent: [], now: 0 })).toMatchObject({ id: 'ines', why: 'addressed' })
    expect(affectedTasks('ines, make it blue', [header, api], [{ id: 'ines', name: 'Inés Duarte' }])).toMatchObject({ scope: 'named', tasks: [header] })
    expect(parseCommand('let Ines handle T2', [header, api], [{ id: 'ines', name: 'Inés Duarte' }])).toMatchObject({ kind: 'assign', task: api })
  })
})
