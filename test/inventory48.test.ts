import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { companyLine, greeting, productPulse } from '../src/shared/productPulse'

const root = join(__dirname, '../src/renderer/src')
const inventory = readFileSync(join(__dirname, '../docs/TRANSFORMATION_INVENTORY.md'), 'utf8')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))

describe('nothing leaves the product unnoticed', () => {
  it('every component has a row in the inventory', () => {
    const missing = walk(join(root, 'components'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => relative(join(root, 'components'), f))
      .filter((f) => !inventory.includes(f) && !inventory.includes(f.split('/').pop()!))
    expect(missing).toEqual([])
  })
  it('every view, section, pane and panel kind has one too', () => {
    const store = readFileSync(join(root, 'store.ts'), 'utf8')
    const union = (name: string) => [...(new RegExp(`${name}[^\\n]*`).exec(store)?.[0] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    const panel = union('export type SheetEntry =')
    const names = [...union("view: 'home'"), ...union('export type WorkspaceSection ='), ...union('export type ResultPane ='), ...panel]
    expect(names.length).toBeGreaterThan(10)
    const known: Record<string, string> = { home: 'Home', office: 'Office', workspace: 'workspace', company: 'Company', result: 'result', settings: 'Settings' }
    for (const n of names) expect(inventory, n).toContain(known[n] ?? n)
  })
  it('every roadmap phase from 49 to 61 is planned', () => {
    const plan = readFileSync(join(__dirname, '../docs/AUTOPIA_NEXT.md'), 'utf8')
    for (let n = 49; n <= 61; n++) expect(plan, String(n)).toMatch(new RegExp(`\\| ${n} `))
  })
})

describe('where a product stands', () => {
  const base = { phase: 'new' as const, paused: false, needsYou: 0, working: 0, toReview: 0 }
  it('what needs you comes first', () => {
    expect(productPulse({ ...base, phase: 'executing', working: 3, needsYou: 1 })).toEqual({ tone: 'attention', label: 'Needs you' })
    expect(productPulse({ ...base, needsYou: 2 }).label).toBe('2 things need you')
  })
  it('then trouble, then what is ready, then what is happening', () => {
    expect(productPulse({ ...base, phase: 'failed', toReview: 1 }).tone).toBe('danger')
    expect(productPulse({ ...base, phase: 'executing', toReview: 1, working: 1 }).tone).toBe('ready')
    expect(productPulse({ ...base, phase: 'executing', working: 2 }).label).toBe('2 teammates working')
    expect(productPulse({ ...base, phase: 'planning' }).tone).toBe('live')
  })
  it('never says work is happening when it is not', () => {
    expect(productPulse({ ...base, phase: 'executing', paused: true }).label).toBe('Paused')
    expect(productPulse({ ...base, phase: 'completed' }).label).toBe('Up to date')
    expect(productPulse(base).label).toBe('Not started')
  })
  it('Home says only what the state shows', () => {
    expect(companyLine({ products: 0, needsYou: 0, toReview: 0, working: 0 })).toMatch(/Tell your team/)
    expect(companyLine({ products: 2, needsYou: 0, toReview: 0, working: 0 })).toMatch(/All quiet/)
    expect(companyLine({ products: 2, needsYou: 1, toReview: 2, working: 1 })).toBe('1 thing needs you, 2 results are ready to review and 1 teammate is working.')
    expect(greeting(9)).toBe('Good morning')
  })
})
