import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentMilestone, milestoneStatus } from '../src/shared/product'
import { envVars, isProductIdea, productContext, specFromPlan, type ProductOutput } from '../src/main/product/product'
import { PRODUCT_PLAN_SCHEMA } from '../src/main/orchestrator/prompts'
import type { Task } from '../src/shared/types'

const out: ProductOutput = {
  vision: 'A recipe box for home cooks.',
  users: ['Home cooks'],
  journeys: [{ name: 'Save a recipe', steps: ['Open app', 'Add recipe', 'See it in the list'] }],
  features: [
    { id: 'F1', name: 'Recipes', description: 'CRUD', scope: 'mvp', basis: 'confirmed', milestone: 1 },
    { id: 'F2', name: 'Sharing', description: 'Share links', scope: 'later', basis: 'assumption', milestone: 2 }
  ],
  assumptions: ['Single user, no accounts'],
  constraints: [],
  architecture: { stack: 'Node + Express + vanilla JS', rationale: 'Small', data: 'JSON file', api: 'REST /api/recipes' },
  design: { direction: 'Warm kitchen notebook', typography: 'Serif headings', colors: [{ name: 'ink', value: '#222' }], layout: 'Two columns', components: 'Cards', accessibility: 'WCAG AA' },
  milestones: [
    { n: 2, title: 'Search', goal: 'Find recipes', acceptance: ['Search filters'] },
    { n: 1, title: 'Core', goal: 'Add and list', acceptance: ['Saved after reload'] }
  ],
  risks: [],
  questions: [{ id: 'Q1', question: 'Accounts?', why: 'Changes data model', options: ['No', 'Yes'], defaultAnswer: 'No' }]
}

const task = (p: Partial<Task>): Task => ({ id: Math.random().toString(), key: 'T1', status: 'pending', milestone: 1, finishedAt: null, ...p }) as Task

describe('product intake', () => {
  it('uses product mode for ideas on an empty repository, not for changes to existing code', () => {
    expect(isProductIdea('A habit tracker app with streaks and reminders', 0, false)).toBe(true)
    expect(isProductIdea('A habit tracker app with streaks and reminders', 40, false)).toBe(false)
    expect(isProductIdea('Fix the login bug', 0, false)).toBe(false)
    expect(isProductIdea('anything', 40, true)).toBe(true)
  })

  it('builds a spec with ordered milestones, later features unscheduled and answers kept across re-plans', () => {
    const s = specFromPlan('p', out, null)
    expect(s.milestones.map((m) => [m.n, m.title, m.status])).toEqual([
      [1, 'Core', 'pending'],
      [2, 'Search', 'pending']
    ])
    expect(s.features.find((f) => f.id === 'F2')!.milestone).toBeNull()
    const answered = { ...s, questions: s.questions.map((q) => ({ ...q, answer: 'Yes' })) }
    expect(specFromPlan('p', out, answered).questions[0].answer).toBe('Yes')
  })

  it('gives agents a concise brief including decisions and the milestone', () => {
    const s = specFromPlan('p', out, null)
    const text = productContext(s, 1)
    expect(text).toMatch(/Accounts\? → No \(default\)/)
    expect(text).toMatch(/milestone 1 "Core"/)
    expect(text.length).toBeLessThan(2200)
  })

  it('requires a milestone on every task in the product plan schema', () => {
    expect(PRODUCT_PLAN_SCHEMA.required).toContain('product')
    expect(PRODUCT_PLAN_SCHEMA.properties.tasks.items.required).toContain('milestone')
  })
})

describe('milestones', () => {
  const spec = specFromPlan('p', out, null)
  it('runs one milestone at a time and waits for its verification', () => {
    const tasks = [task({ key: 'T1', milestone: 1, status: 'running' }), task({ key: 'T2', milestone: 2 })]
    expect(currentMilestone(spec, tasks)).toBe(1)
    const finished = [task({ key: 'T1', milestone: 1, status: 'done' }), task({ key: 'T2', milestone: 2 })]
    expect(currentMilestone(spec, finished)).toBe(1) // not verified yet
    expect(milestoneStatus(spec.milestones[0], finished)).toBe('verifying')
    const gated = { ...spec, milestones: spec.milestones.map((m) => (m.n === 1 ? { ...m, gate: { verdict: 'passed' as const, evidence: [], at: 1, repairTaskKey: null } } : m)) }
    expect(currentMilestone(gated, finished)).toBe(2)
    expect(milestoneStatus(gated.milestones[0], finished)).toBe('done')
  })

  it('holds the next milestone while a gate repair is open', () => {
    const failed = { ...spec, milestones: spec.milestones.map((m) => (m.n === 1 ? { ...m, gate: { verdict: 'failed' as const, evidence: [], at: 1, repairTaskKey: 'T3' } } : m)) }
    const tasks = [task({ key: 'T1', milestone: 1, status: 'done' }), task({ key: 'T3', milestone: 1, status: 'running' }), task({ key: 'T2', milestone: 2 })]
    expect(currentMilestone(failed, tasks)).toBe(1)
  })
})

describe('deliverable', () => {
  it('lists configuration the code reads, without generic runtime variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopia-env-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'server.js'), 'const port = process.env.PORT; const db = process.env.DATABASE_URL\n')
    writeFileSync(join(dir, '.env.example'), 'SESSION_SECRET=\n')
    expect(envVars(dir)).toEqual(['DATABASE_URL', 'SESSION_SECRET'])
  })
})

describe('milestone repair flow', () => {
  const spec = specFromPlan('p', out, null)
  const failed = (at: number) => ({ ...spec, milestones: spec.milestones.map((m) => (m.n === 1 ? { ...m, gate: { verdict: 'failed' as const, evidence: [], at, repairTaskKey: 'T3' } } : m)) })
  const base = [task({ key: 'T1', milestone: 1, status: 'done' }), task({ key: 'T2', milestone: 2 })]
  it('waits for re-verification after a repair, and releases the milestone when the repair is skipped', () => {
    expect(currentMilestone(failed(10), [...base, task({ key: 'T3', milestone: 1, status: 'done', finishedAt: 20 })])).toBe(1)
    expect(currentMilestone(failed(30), [...base, task({ key: 'T3', milestone: 1, status: 'done', finishedAt: 20 })])).toBe(2)
    expect(currentMilestone(failed(10), [...base, task({ key: 'T3', milestone: 1, status: 'cancelled' })])).toBe(2)
  })
})

describe('vendored code', () => {
  it('is never audited', async () => {
    const { auditDiff, wholeFiles } = await import('../src/main/quality/audit')
    const f = auditDiff(wholeFiles(['node_modules/x/a.js', 'src/a.js'], (p) => (p.startsWith('node_modules') ? 'const password = "hunter2hunter2"' : 'ok()')), () => null)
    expect(f).toEqual([])
  })
})
