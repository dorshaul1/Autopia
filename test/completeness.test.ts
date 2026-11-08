import { describe, expect, it } from 'vitest'
import { COMPLETENESS_RULES, completenessFindings, completenessRules, probeSummary, productKindOf, type InteractionProbe, type ProbedPage } from '../src/shared/completeness'
import { selectExpertise } from '../src/main/skills/expertise'
import { productContext, specFromPlan, type ProductOutput } from '../src/main/product/product'
import { craftOf } from '../src/main/orchestrator/prompts'

const page = (text: string, more: Partial<ProbedPage> = {}): ProbedPage => ({ path: '/', status: 200, text, mediaCount: 0, repeats: [], sameImage: null, ...more })
const probe = (more: Partial<InteractionProbe> = {}): InteractionProbe => ({ pages: [page('Ember Roasters. Small lots from Huila, roasted on Tuesdays.')], total: 3, tried: 3, unknown: 0, dead: [], crashed: [], brokenLinks: [], missingAnchors: [], placeholderLinks: [], forms: [], junkAfter: [], canvas: null, dataFailure: null, ranOut: false, ...more })
const rules = (p: InteractionProbe, given = '') => completenessFindings(p, given).map((f) => f.rule)

describe('product kinds', () => {
  it('picks the standard from the office and the brief', () => {
    expect(productKindOf('a top down escape', 'studio')).toBe('game')
    expect(productKindOf('anything', 'lab')).toBe('ai')
    expect(productKindOf('Build a landing page for a SaaS', 'startup')).toBe('website')
    expect(productKindOf('Build a small task tracker web app', 'startup')).toBe('saas')
    expect(productKindOf('A site for my bakery', 'startup')).toBe('website')
    expect(productKindOf('Rename a thing', 'startup')).toBe('other')
  })
  it('sends only the matching standard', () => {
    expect(completenessRules('game')).toMatch(/complete loop/)
    expect(completenessRules('game')).not.toMatch(/landing page/)
    expect(completenessRules('other')).toMatch(/essentials/)
  })
})

describe('reading what really happened', () => {
  it('a working product has no findings', () => expect(completenessFindings(probe())).toEqual([]))
  it('groups dead controls per page instead of one finding each', () => {
    const f = completenessFindings(probe({ dead: [{ page: '/', label: 'Buy', kind: 'control' }, { page: '/', label: 'Add', kind: 'control' }] }))
    expect(f).toHaveLength(1)
    expect(f[0].message).toMatch(/2 controls/)
    expect(f[0].certainty).toBe('verified')
  })
  it('keeps things that only look clickable separate', () => {
    const f = completenessFindings(probe({ dead: [{ page: '/', label: 'Card', kind: 'looks-clickable' }, { page: '/', label: 'Buy', kind: 'control' }] }))
    expect(f).toHaveLength(2)
    expect(f.map((x) => x.file)).toContain('/ (looks clickable)')
  })
  it('reports forms, errors, links and junk', () => {
    expect(rules(probe({ forms: [{ page: '/', label: 'Join', outcome: 'dead' }] }))).toEqual(['form-dead'])
    expect(rules(probe({ forms: [{ page: '/', label: 'Join', outcome: 'reloads' }] }))).toEqual(['form-reloads'])
    expect(rules(probe({ forms: [{ page: '/', label: 'Join', outcome: 'unknown' }, { page: '/', label: 'X', outcome: 'works' }] }))).toEqual([])
    expect(rules(probe({ brokenLinks: [{ page: '/', label: 'Shop', href: '/shop', status: 404 }] }))).toEqual(['broken-link'])
    expect(rules(probe({ junkAfter: [{ page: '/', label: 'Add', match: 'NaN' }] }))).toEqual(['junk-text'])
    expect(rules(probe({ pages: [page('Total: $NaN today')] }))).toEqual(['junk-text'])
  })
  it('names a thrown error once', () => {
    const f = completenessFindings(probe({ crashed: [{ page: '/', label: 'Export', error: 'x' }, { page: '/', label: 'Export', error: 'x' }] }))
    expect(f[0].message).toBe('Using “Export” throws an error.')
  })
  it('finds placeholder and filler copy', () => {
    expect(rules(probe({ pages: [page('Lorem ipsum dolor')] }))).toContain('placeholder-copy')
    expect(rules(probe({ pages: [page('Feature 1 is great. Feature 2 too.')] }))).toEqual(['numbered-filler'])
    expect(rules(probe({ pages: [page('Blog coming soon')] }))).toEqual(['unfinished-screen'])
  })
  it('does not call ordinary words placeholders', () => {
    expect(rules(probe({ pages: [page('Plan 1 of our launch. A TODO list app with Feature flags, 4 stars of the show')] }))).not.toContain('placeholder-copy')
    expect(rules(probe({ pages: [page('Step 1. Step 2. Step 3.')] }))).toEqual([])
  })
  it('what the person wrote is theirs', () => {
    expect(rules(probe({ pages: [page('Welcome to Acme')] }))).toEqual(['placeholder-copy'])
    expect(rules(probe({ pages: [page('Welcome to Acme')] }), 'a site for Acme Tools')).toEqual([])
    expect(rules(probe({ pages: [page('Trusted by 500 bakeries')] }), 'we are trusted by 500 bakeries')).toEqual([])
  })
  it('invented claims are fine once labelled, and flagged when not', () => {
    expect(rules(probe({ pages: [page('Trusted by 10,000+ teams. 4.9 stars.')] }))).toEqual(['invented-claim', 'invented-claim'])
    expect(rules(probe({ pages: [page('Trusted by 10,000+ teams. 4.9 stars. Demo store with sample reviews.')] }))).toEqual([])
    // the label can be on any page of the product
    expect(rules(probe({ pages: [page('Trusted by 10,000+ teams'), page('This is a fictional brand', { path: '/about' })] }))).toEqual([])
  })
  it('reports repetition', () => {
    expect(rules(probe({ pages: [page('x'.repeat(10), { repeats: [{ text: 'Our beans are sourced from the finest farms', count: 4 }] })] }))).toEqual(['repeated-copy'])
    expect(rules(probe({ pages: [page('x'.repeat(10), { sameImage: { src: 'a.png', count: 5 } })] }))).toEqual(['repeated-image'])
  })
  it('a canvas that moves but cannot be judged is not a finding', () => {
    expect(rules(probe({ canvas: 'animated' }))).toEqual([])
    expect(rules(probe({ canvas: 'responds' }))).toEqual([])
    expect(rules(probe({ canvas: 'static' }))).toEqual(['game-no-response'])
  })
  it('data failure', () => {
    expect(rules(probe({ dataFailure: { blank: false, stuck: false, exception: null } }))).toEqual([])
    expect(rules(probe({ dataFailure: { blank: false, stuck: true, exception: null } }))).toEqual(['no-error-state'])
    expect(rules(probe({ dataFailure: { blank: true, stuck: false, exception: null } }))).toEqual(['no-error-state'])
  })
  it('every finding belongs to the scope rule', () => {
    const all = completenessFindings(probe({ dead: [{ page: '/', label: 'a', kind: 'control' }], crashed: [{ page: '/', label: 'a', error: 'e' }], brokenLinks: [{ page: '/', label: 'a', href: '/b', status: 404 }], missingAnchors: [{ page: '/', label: 'a', href: '#b' }], placeholderLinks: [{ page: '/', label: 'a', href: 'https://example.com' }], forms: [{ page: '/', label: 'a', outcome: 'dead' }], canvas: 'static', dataFailure: { blank: true, stuck: false, exception: null } }))
    for (const f of all) expect(COMPLETENESS_RULES.has(f.rule)).toBe(true)
  })
  it('says what was and wasn’t exercised', () => {
    expect(probeSummary(probe({ tried: 2, total: 9, unknown: 1, ranOut: true }))).toMatch(/2 of 9.*couldn't be judged.*time limit/)
  })
})

describe('the plan reaches the people building it', () => {
  const output = { vision: 'V', users: ['u'], journeys: [{ name: 'Buy beans', steps: ['Browse', 'Add to cart'] }], features: [], assumptions: [], constraints: [], architecture: { stack: 's', rationale: 'r', data: 'd', api: 'none' }, design: { direction: 'd', typography: 't', colors: [], layout: 'l', components: 'c', accessibility: 'a' }, milestones: [{ n: 1, title: 'M', goal: 'G', acceptance: ['A'] }], risks: [], questions: [], completeness: { essentials: ['Buy leads somewhere'], content: 'Ember Roasters, Huila $18', notBuilding: ['accounts'] } } as unknown as ProductOutput
  it('journeys, essentials and shared facts are in every brief', () => {
    const text = productContext(specFromPlan('p', output, null), 1)
    expect(text).toMatch(/Buy beans \(Browse > Add to cart\)/)
    expect(text).toMatch(/Buy leads somewhere/)
    expect(text).toMatch(/Ember Roasters, Huila \$18/)
    expect(text).toMatch(/Not building: accounts/)
  })
  it('an older project without it still works', () => {
    const { completeness: _, ...old } = output as unknown as Record<string, unknown>
    expect(productContext(specFromPlan('p', old as unknown as ProductOutput, null), 1)).toMatch(/Buy beans/)
  })
  it('a replan keeps what was decided if it says nothing new', () => {
    const { completeness: _, ...old } = output as unknown as Record<string, unknown>
    expect(specFromPlan('p', old as unknown as ProductOutput, specFromPlan('p', output, null)).completeness?.content).toMatch(/Ember/)
  })
})

describe('people and methods', () => {
  it('builders are told it has to really work, QA is told what counts as a defect', () => {
    expect(craftOf({ title: 'Frontend Developer' }, 'code')).toMatch(/really work/)
    expect(craftOf({ title: 'QA Engineer' }, 'qa')).toMatch(/does nothing/)
  })
  it('content work gets the content method; a small unrelated fix gets none', () => {
    const pick = (title: string, size: 's' | 'm', office = 'startup', kind: 'code' | 'design' = 'design') => selectExpertise({ task: { title, description: '', kind, size }, office: office as 'startup', purpose: 'work' }).map((c) => c.id)
    expect(pick('Write the about story and pricing copy', 'm')).toContain('real-content')
    expect(pick('Build the analytics dashboard charts', 'm', 'startup', 'code')).toContain('coherent-data')
    expect(pick('Build the game loop and enemy waves', 'm', 'studio', 'code')).toContain('game-content')
    expect(pick('Fix the off-by-one in pagination', 's', 'startup', 'code')).toEqual([])
  })
})
