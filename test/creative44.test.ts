import { describe, expect, it } from 'vitest'
import { directionFindings } from '../src/main/quality/direction'
import { craftOf } from '../src/main/orchestrator/prompts'
import { selectExpertise } from '../src/main/skills/expertise'

const direction = { audience: 'a', personality: 'warm', concept: 'origin stories', explored: [], standards: ['editorial'], avoid: ['generic'], assets: [] }
const design = { direction: 'x', typography: 'Fraunces with Karla', colors: [{ name: 'bean', value: '#3b2417' }, { name: 'cream', value: '#f4ece1' }], layout: '', components: '', accessibility: '' }
const spec = { direction, design } as never
const rules = (files: { path: string; text: string }[]) => directionFindings(spec, files).map((f) => f.rule)

describe('did the code follow the direction', () => {
  it('a project with no direction is left alone', () => {
    expect(directionFindings({ design } as never, [{ path: 'a.css', text: 'lorem ipsum' }])).toEqual([])
  })
  it('catches placeholders, with the file and line', () => {
    const f = directionFindings(spec, [{ path: 'a.html', text: 'x\nLorem ipsum\n<img src="https://picsum.photos/200">' }])
    expect(f.map((x) => x.rule)).toEqual(expect.arrayContaining(['direction-placeholder-text', 'direction-placeholder-image']))
    expect(f[0]).toMatchObject({ file: 'a.html', line: 2, certainty: 'verified' })
  })
  it('notices a palette that was promised and never used', () => {
    expect(rules([{ path: 'a.css', text: 'a{color:#000}' }])).toContain('direction-palette-unused')
    expect(rules([{ path: 'a.css', text: 'a{color:#3B2417}' }])).not.toContain('direction-palette-unused')
  })
  it('notices default fonts, and accepts real or tokenised ones', () => {
    expect(rules([{ path: 'a.css', text: 'a{font-family: Arial, sans-serif}' }])).toContain('direction-default-type')
    expect(rules([{ path: 'a.css', text: 'a{font-family: "Fraunces", serif}' }])).not.toContain('direction-default-type')
    expect(rules([{ path: 'a.css', text: 'a{font-family: var(--font-display)}' }])).not.toContain('direction-default-type')
  })
  it('catches the default AI gradient unless purple was the idea', () => {
    expect(rules([{ path: 'a.css', text: 'background:linear-gradient(#667eea,#764ba2)' }])).toContain('direction-generic-gradient')
    expect(directionFindings({ design, direction: { ...direction, personality: 'purple dream' } } as never, [{ path: 'a.css', text: '#667eea' }]).map((f) => f.rule)).not.toContain('direction-generic-gradient')
  })
  it('motion must respect reduced-motion', () => {
    expect(rules([{ path: 'a.css', text: 'a{transition: all .2s}' }])).toContain('direction-reduced-motion')
    expect(rules([{ path: 'a.css', text: 'a{transition: all .2s} @media (prefers-reduced-motion: reduce){a{transition:none}}' }])).not.toContain('direction-reduced-motion')
  })
  it('tests do not count', () => {
    expect(rules([{ path: 'a.css', text: '#3b2417' }, { path: 'x.test.js', text: 'lorem ipsum' }])).not.toContain('direction-placeholder-text')
  })
})

describe('each person works to their discipline', () => {
  it('different titles get different standards, everyone gets judgment', () => {
    const a = craftOf({ title: 'UI/UX Designer' }, 'design')
    const b = craftOf({ title: 'Backend Developer' }, 'code')
    const c = craftOf({ title: 'Gameplay Programmer' }, 'code')
    expect(new Set([a, b, c]).size).toBe(3)
    for (const x of [a, b, c]) expect(x).toMatch(/Use your judgment/)
    expect(craftOf({ title: 'QA Engineer' }, 'qa')).toMatch(/break it/)
  })
  it('a product with a direction brings art direction to design work, even when the words are not there', () => {
    const task = { title: 'Pricing section', kind: 'design' as const, size: 'm' as const, description: '' }
    expect(selectExpertise({ task, office: 'startup', purpose: 'work', direction: 'warm editorial' }).map((c) => c.id)).toContain('art-direction')
    expect(selectExpertise({ task, office: 'startup', purpose: 'work' }).map((c) => c.id)).not.toContain('art-direction')
  })
})
