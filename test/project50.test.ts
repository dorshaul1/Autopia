import { describe, expect, it } from 'vitest'
import { hubGroups, openLabel, OLDER_AFTER_MS, productOverview, purposeOf, RETURN_AFTER_MS, timeAway, type HubItem } from '../src/shared/projectHome'
import { projectNameFrom } from '../src/shared/composer'
import type { Delivery, Task } from '../src/shared/types'

const NOW = 1_800_000_000_000
const task = (o: Partial<Task>) => ({ id: 't', status: 'pending', finishedAt: null, ...o }) as Task
const delivery = (o: Partial<Delivery>) => ({ id: 'd', status: 'accepted', completedAt: NOW - 1000, number: 1, ...o }) as Delivery
const base = { project: { phase: 'new' as const, paused: false }, tasks: [] as Task[], deliveries: [] as Delivery[], approvals: [], lastSeen: null, now: NOW }

describe('names', () => {
  it('what you called it wins', () => {
    expect(projectNameFrom('A one page website for a fictional bakery called Crumb, with its hours')).toBe('Crumb')
    expect(projectNameFrom('An app named Night Runner for joggers')).toBe('Night Runner')
    expect(projectNameFrom('A small task tracker web app')).toBe('Task Tracker')
    expect(projectNameFrom('the so called thing')).toBe('So Called Thing')
  })
})

describe('where a product stands', () => {
  it('a new one is fresh and claims nothing', () => {
    const o = productOverview(base)
    expect(o.moment).toBe('fresh')
    expect(o.latest).toBeNull()
    expect(o.since).toBeNull()
  })
  it('a proposed plan is not work', () => expect(productOverview({ ...base, tasks: [task({ status: 'proposed' })] }).planned).toEqual([]))
  it('adapts to what is really going on', () => {
    expect(productOverview({ ...base, project: { phase: 'planning', paused: false } }).moment).toBe('planning')
    expect(productOverview({ ...base, tasks: [task({ status: 'running' }), task({ id: 'b', status: 'running' })] })).toMatchObject({ moment: 'working', active: { length: 2 } })
    expect(productOverview({ ...base, tasks: [task({ status: 'failed' })] }).moment).toBe('blocked')
    expect(productOverview({ ...base, project: { phase: 'failed', paused: false }, deliveries: [delivery({})] }).moment).toBe('blocked')
    expect(productOverview({ ...base, deliveries: [delivery({ status: 'review' })] }).moment).toBe('ready')
    expect(productOverview({ ...base, deliveries: [delivery({})] }).moment).toBe('idle')
  })
  it('what needs you outranks everything', () => {
    const o = productOverview({ ...base, tasks: [task({ status: 'running' })], approvals: [{ id: 'a', kind: 'question', title: 'q', body: '', status: 'pending' }] })
    expect(o.moment).toBe('needs_you')
    expect(o.active).toHaveLength(1)
  })
  it('recent results are newest first, unfinished ones left out', () => {
    const o = productOverview({ ...base, deliveries: [delivery({ id: 'old', completedAt: 1 }), delivery({ id: 'new', completedAt: 2 }), delivery({ id: 'going', completedAt: null, status: 'implementing' })] })
    expect(o.recent.map((d) => d.id)).toEqual(['new', 'old'])
  })
})

describe('coming back', () => {
  it('a moment away is nothing to report', () => expect(productOverview({ ...base, lastSeen: NOW - 60_000 }).since).toBeNull())
  it('counts only what happened since', () => {
    const seen = NOW - 5 * 3_600_000
    const o = productOverview({ ...base, lastSeen: seen, tasks: [task({ id: 'before', status: 'done', finishedAt: seen - 1 }), task({ id: 'after', status: 'done', finishedAt: seen + 1 })], deliveries: [delivery({ completedAt: seen + 2 })] })
    expect(o.since?.finished.map((t) => t.id)).toEqual(['after'])
    expect(o.since?.results).toHaveLength(1)
    expect(o.since?.away).toBe('5 hours')
  })
  it('after a long absence it says so even when nothing happened', () => {
    expect(productOverview({ ...base, lastSeen: NOW - RETURN_AFTER_MS }).since).toMatchObject({ finished: [], results: [] })
    expect(productOverview({ ...base, lastSeen: NOW - 2 * 3_600_000 }).since).toBeNull()
  })
  it('says how long in plain words', () => {
    expect(timeAway(3_600_000)).toBe('an hour')
    expect(timeAway(3 * 86_400_000)).toBe('3 days')
    expect(timeAway(21 * 86_400_000)).toBe('3 weeks')
    expect(timeAway(120 * 86_400_000)).toBe('4 months')
  })
})

describe('what a product is', () => {
  it('prefers the brief, then what you asked, one sentence', () => {
    expect(purposeOf('A bakery site for pre-orders. It has many parts.', 'x')).toBe('A bakery site for pre-orders.')
    expect(purposeOf(null, 'Build a tracker app')).toBe('Build a tracker app')
    expect(purposeOf(null, '')).toBe('')
  })
  it('never shows attachment plumbing', () => expect(purposeOf(null, 'Make it nice\n\nAttached (read these files): a.png')).toBe('Make it nice'))
  it('keeps abbreviations from cutting it too soon', () => expect(purposeOf(null, 'St. Louis bakery tracker for owners. More.')).toBe('St. Louis bakery tracker for owners.'))
  it('a game is played', () => {
    expect(openLabel('studio')).toBe('Play it')
    expect(openLabel('lab')).toBe('Try it')
    expect(openLabel('startup')).toBe('Open it')
  })
})

describe('the hub', () => {
  const item = (o: Partial<HubItem>): HubItem => ({ id: 'x', name: 'x', purpose: '', needsYou: 0, working: 0, toReview: 0, blocked: false, at: NOW, ...o })
  it('groups by what matters, in that order', () => {
    const g = hubGroups([item({ id: 'old', at: NOW - OLDER_AFTER_MS - 1 }), item({ id: 'quiet' }), item({ id: 'ready', toReview: 1 }), item({ id: 'busy', working: 2 }), item({ id: 'stuck', blocked: true }), item({ id: 'ask', needsYou: 1, working: 1 })], NOW)
    expect(g.map((x) => x.group)).toEqual(['attention', 'active', 'ready', 'recent', 'older'])
    expect(g[0].items.map((i) => i.id).sort()).toEqual(['ask', 'stuck'])
  })
  it('an old project that needs you is not hidden', () => expect(hubGroups([item({ at: 0, needsYou: 1 })], NOW)[0].group).toBe('attention'))
  it('finds by name or purpose', () => {
    const list = [item({ id: 'a', name: 'Ember' }), item({ id: 'b', name: 'Other', purpose: 'bakery site' })]
    expect(hubGroups(list, NOW, 'bake')[0].items.map((i) => i.id)).toEqual(['b'])
    expect(hubGroups(list, NOW, 'nope')).toEqual([])
  })
  it('newest first within a group', () => expect(hubGroups([item({ id: 'a', at: NOW - 5 }), item({ id: 'b', at: NOW })], NOW)[0].items[0].id).toBe('b'))
})
