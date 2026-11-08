import { describe, expect, it } from 'vitest'
import { CAPABILITIES, expertisePrompt, selectExpertise } from '../src/main/skills/expertise'

const task = (title: string, kind: 'code' | 'design' | 'qa', size: 's' | 'm' | 'l', description = '') => ({ title, kind, size, description })
const ids = (t: ReturnType<typeof task>, office: 'startup' | 'studio' | 'lab' = 'startup', purpose = 'work') => selectExpertise({ task: t, office, purpose }).map((c) => c.id)

describe('choosing expertise', () => {
  it('a landing page gets design expertise, up to its size', () => {
    const got = ids(task('Landing page hero and brand visual language', 'design', 'l'))
    expect(got).toContain('art-direction')
    expect(got.length).toBeLessThanOrEqual(3)
  })
  it('a backend step gets backend expertise and nothing visual', () => {
    const got = ids(task('REST API endpoint for orders with database schema', 'code', 'm'))
    expect(got).toEqual(expect.arrayContaining(['api-design']))
    expect(got).not.toContain('art-direction')
  })
  it('it follows the work and the office, not the job title', () => {
    expect(ids(task('Player movement and combat feel', 'code', 'm'), 'studio')).toContain('game-feel')
    expect(ids(task('Player movement and combat feel', 'code', 'm'), 'startup')).not.toContain('game-feel')
    expect(ids(task('Evaluation set and scoring', 'code', 's'), 'lab')).toContain('ai-evaluation')
  })
  it('a small plain fix carries nothing, and a repair never does', () => {
    expect(ids(task('Fix the typo', 'code', 's'))).toEqual([])
    expect(ids(task('Landing page hero', 'design', 'l'), 'startup', 'fix')).toEqual([])
  })
  it('size limits what is loaded, and the whole catalog never is', () => {
    const everything = CAPABILITIES.map((c) => c.name).join(' ')
    expect(ids(task(`${everything} page form api animation`, 'design', 's'))).toHaveLength(1)
    expect(ids(task(`${everything} page form api animation`, 'design', 'l')).length).toBeLessThanOrEqual(3)
    const size = expertisePrompt(selectExpertise({ task: task('Landing page hero with animation', 'design', 'l'), office: 'startup', purpose: 'work' }), []).length
    expect(size).toBeLessThan(2200)
  })
})

describe('images', () => {
  const assets = CAPABILITIES.filter((c) => c.id === 'visual-assets')
  it('never pretends: says what is unavailable and to report it', () => {
    const p = expertisePrompt(assets, [])
    expect(p).toMatch(/No image generation is available/)
    expect(p).toMatch(/Never call anything generated/)
  })
  it('uses a real tool only if one is connected', () => {
    expect(expertisePrompt(assets, ['mcp__x__generate_image'])).toMatch(/available through mcp__x__generate_image/)
  })
})
