import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OFFICE_TYPES, distinctLooks, teamFor, type OfficeType } from '../src/shared/offices'
import { whatsNext } from '../src/shared/whatsNext'

describe('a team you can tell apart', () => {
  for (const type of ['studio', 'lab'] as OfficeType[]) {
    it(`${type}: nobody shares a shirt or the same hair, across many projects`, () => {
      for (let i = 0; i < 40; i++) {
        const team = teamFor(type, `project-${i}-${type}`, 0)
        expect(new Set(team.map((e) => e.appearance.shirt)).size, `project ${i}`).toBe(team.length)
        expect(new Set(team.map((e) => `${e.appearance.hair}|${e.appearance.hairStyle}`)).size, `project ${i}`).toBe(team.length)
      }
    })
  }
  it('only duplicates change, the first keeps their look, and it stays the same', () => {
    const shirts = OFFICE_TYPES.studio.shirts
    const a = { skin: 's', hair: '#1f1612', hairStyle: 'short', shirt: shirts[0] } as never
    const b = { skin: 's', hair: '#1f1612', hairStyle: 'short', shirt: shirts[0] } as never
    const c = { skin: 's', hair: '#8e3b2f', hairStyle: 'bun', shirt: shirts[3] } as never
    const team = [{ appearance: a }, { appearance: b }, { appearance: c }]
    const told = distinctLooks(team, shirts)
    expect(told[0]).toBe(team[0])
    expect(told[2]).toBe(team[2])
    expect(told[1].appearance.shirt).not.toBe(shirts[0])
    expect(told[1].appearance.hair).not.toBe('#1f1612')
    expect(distinctLooks(team, shirts)).toEqual(told)
    expect(distinctLooks(told, shirts)).toEqual(told)
  })
  it('the original team keeps its faces', () => {
    const team = teamFor('startup', 'cccccccc-3', 0)
    expect(team.find((e) => e.name === 'Maya Okafor')?.appearance.hairStyle).toBe('curly')
  })
})

describe('never says someone is working when they are waiting', () => {
  const base = { project: { phase: 'executing', paused: false, lastError: null }, deliveries: [], nameOf: (id: string | null) => ({ i: 'Inés Navarro', k: 'Kenji Watanabe' })[id ?? ''] ?? null } as never as Parameters<typeof whatsNext>[0]
  const task = (id: string, assigneeId: string) => ({ id, title: id, status: 'running', assigneeId, lastError: null }) as never
  const prompt = { status: 'pending', kind: 'permission', title: 'x', taskId: 'a' } as never
  it('the one being held is paused', () => {
    expect(whatsNext({ ...base, tasks: [task('a', 'i')], approvals: [prompt] })?.detail).toBe('Inés is paused until you answer.')
  })
  it('only the others keep working', () => {
    expect(whatsNext({ ...base, tasks: [task('a', 'i'), task('b', 'k')], approvals: [prompt] })?.detail).toBe('Kenji keeps working meanwhile.')
  })
  it('a parallel tool can’t replace what you are being asked', () => {
    expect(readFileSync(join(__dirname, '../src/main/orchestrator/orchestrator.ts'), 'utf8')).toContain('detail: s.needsYou ? s.detail : ev.summary')
  })
})
