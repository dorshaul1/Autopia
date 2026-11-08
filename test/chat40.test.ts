import { describe, expect, it } from 'vitest'
import { isStatusQuestion, messageStateLabel, resolveIntent } from '../src/shared/composer'
import { enqueue, take } from '../src/main/orchestrator/steer'
import { steerPrompt } from '../src/main/orchestrator/prompts'

const base = { text: '', newProject: false, busy: false, planPending: false, delivered: false, employeeId: null }

describe('automatic intent (no mode to pick)', () => {
  it('answers questions in every state, even while the team is busy or a plan waits', () => {
    for (const ctx of [base, { ...base, busy: true }, { ...base, planPending: true }, { ...base, delivered: true }]) {
      expect(resolveIntent({ ...ctx, text: 'Why does the list reload twice?' })).toBe('ask')
      expect(resolveIntent({ ...ctx, text: "what's happening" })).toBe('ask')
    }
  })
  it('routes everything else from the real state', () => {
    expect(resolveIntent({ ...base, newProject: true, text: 'Why not a habit tracker?' })).toBe('build')
    expect(resolveIntent({ ...base, planPending: true, text: 'Skip the README task' })).toBe('reply')
    expect(resolveIntent({ ...base, busy: true, text: 'Use blue for the header' })).toBe('note')
    expect(resolveIntent({ ...base, text: 'Plan a settings page' })).toBe('plan')
    expect(resolveIntent({ ...base, delivered: true, text: 'Add a dark mode' })).toBe('change')
    expect(resolveIntent({ ...base, text: 'Add a dark mode' })).toBe('build')
  })
  it('recognizes status questions without a question mark, but not requests that mention status', () => {
    expect(isStatusQuestion('status')).toBe(true)
    expect(isStatusQuestion('who is working on it')).toBe(true)
    expect(isStatusQuestion('why did it fail')).toBe(true)
    expect(isStatusQuestion('Add a dark mode toggle')).toBe(false)
  })
})

describe('message states', () => {
  it('always says where a message stands', () => {
    expect(messageStateLabel('queued', 'note')).toBe('queued for the session that’s running')
    expect(messageStateLabel('delivered', 'note')).toBe('delivered to the team')
    expect(messageStateLabel('working', 'ask')).toBe('being answered')
    expect(messageStateLabel('answered', 'ask')).toBe('answered')
    expect(messageStateLabel('failed', 'build')).toBe('failed')
    expect(messageStateLabel('sent', 'reply')).toBe('plan feedback')
    expect(messageStateLabel('sent', 'change')).toBe('change request')
  })
})

describe('steering running sessions', () => {
  it('keeps messages per task, in order, and delivers each exactly once', () => {
    let q = enqueue({}, 't1', { messageId: 'm1', text: 'blue header' })
    q = enqueue(q, 't2', { messageId: 'm2', text: 'other task' })
    q = enqueue(q, 't1', { messageId: 'm3', text: 'and a footer' })
    q = enqueue(q, 't1', { messageId: 'm3', text: 'and a footer' }) // a resend is not a duplicate
    const first = take(q, 't1')
    expect(first.items.map((m) => m.messageId)).toEqual(['m1', 'm3'])
    expect(take(first.rest, 't1').items).toEqual([])
    expect(first.rest.t2).toHaveLength(1)
  })
  it('never drops an instruction, however many you send', () => {
    let q = {}
    for (let i = 0; i < 10; i++) q = enqueue(q, 't', { messageId: `m${i}`, text: String(i) })
    expect(take(q, 't').items).toHaveLength(10)
  })
  it('asks the running session to adjust, not restart', () => {
    const p = steerPrompt(['Use blue for the header'])
    expect(p).toMatch(/- Use blue for the header/)
    expect(p).toMatch(/rather than starting over/)
  })
})
