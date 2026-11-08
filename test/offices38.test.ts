import { describe, expect, it } from 'vitest'
import { ROWS, allReachable, buildWalkGrid, deskPlacements, requiredSpots, useLayout, wallTiles, type OfficeLayout } from '../src/renderer/src/office/layout'
import { LAYOUTS } from '../src/renderer/src/office/offices'

/** Every spot people need, and which of them can't be reached from the entrance (for a clear failure). */
function unreachable(l: OfficeLayout): string[] {
  useLayout(l)
  const g = buildWalkGrid([...l.PLACEMENTS, ...deskPlacements(Object.keys(l.DESKS))])
  const start = { x: l.ENTRANCE.x + 1, y: ROWS - 2 }
  const seen = new Set([`${start.x},${start.y}`])
  const q = [start]
  while (q.length) {
    const p = q.shift()!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx
      const y = p.y + dy
      if (seen.has(`${x},${y}`) || !g[y]?.[x]) continue
      seen.add(`${x},${y}`)
      q.push({ x, y })
    }
  }
  return requiredSpots().filter((s) => !seen.has(`${s.x},${s.y}`)).map((s) => `${s.x},${s.y}`)
}

describe('every office is a complete, walkable office', () => {
  for (const [type, l] of Object.entries(LAYOUTS)) {
    it(`${type}: every seat and spot is reachable from the entrance, with or without a full team`, () => {
      expect(unreachable(l)).toEqual([])
      useLayout(l)
      expect(allReachable(buildWalkGrid([...l.PLACEMENTS, ...deskPlacements([])]))).toBe(true)
    })
    it(`${type}: nothing solid sits on a wall, and every room has a name and purpose`, () => {
      useLayout(l)
      const walls = wallTiles()
      const clash = l.PLACEMENTS.filter((p) => p.blocks).flatMap((p) => Array.from({ length: p.tw * p.th }, (_, i) => `${p.tx + (i % p.tw)},${p.ty + Math.floor(i / p.tw)}`)).filter((t) => walls.has(t))
      expect(clash).toEqual([])
      for (const z of Object.keys(l.ZONES)) expect(l.ZONE_LABEL[z as keyof typeof l.ZONES] && l.ZONE_PURPOSE[z as keyof typeof l.ZONES]).toBeTruthy()
    })
  }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OFFICE_TYPES, recommendOffice, teamFor } from '../src/shared/offices'
import { chooseAssignee, taskSkills } from '../src/shared/capabilities'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { FOUNDING_TEAM } from '../src/shared/roster'

describe('office types', () => {
  it('recommends the office from what you want to build', () => {
    expect(recommendOffice('A cosy farming game with seasons').type).toBe('studio')
    expect(recommendOffice('An AI agent that summarizes support tickets').type).toBe('lab')
    expect(recommendOffice('A SaaS dashboard for invoices').type).toBe('startup')
  })

  it('each office has its full specialised roster, with a planner and QA', () => {
    for (const def of Object.values(OFFICE_TYPES)) {
      expect(def.roles.filter((r) => r.role === 'pm')).toHaveLength(1)
      expect(def.roles.some((r) => r.kinds.includes('qa'))).toBe(true)
    }
    expect(OFFICE_TYPES.studio.roles.map((r) => r.title)).toEqual(['Game Director', 'Gameplay Programmer', 'Game Systems Designer', 'World Designer', 'Level Designer', 'Game Artist', 'Game QA Engineer'])
    expect(OFFICE_TYPES.lab.roles.map((r) => r.title)).toEqual(['AI Architect', 'AI Engineer', 'ML Engineer', 'Data Engineer', 'Research Engineer', 'MLOps Engineer', 'AI Evaluation Engineer'])
  })

  it('every project gets its own people: same project → same team; two projects of one type → different people', () => {
    const a = teamFor('studio', 'aaaaaaaa-1', 0)
    expect(teamFor('studio', 'aaaaaaaa-1', 0).map((e) => e.name)).toEqual(a.map((e) => e.name))
    const b = teamFor('studio', 'bbbbbbbb-2', 0)
    expect(new Set([...a, ...b].map((e) => e.id)).size).toBe(a.length + b.length)
    expect(a.map((e) => e.name)).not.toEqual(b.map((e) => e.name))
    // a new Tech Startup is its own copy of the original people (same faces, separate identity)
    const s = teamFor('startup', 'cccccccc-3', 0)
    expect(s.find((e) => e.name === 'Maya Okafor')?.id).toBe('emp-maya@cccccccc')
    expect(s.find((e) => e.name === 'Maya Okafor')?.appearance).toEqual(FOUNDING_TEAM[0].appearance)
  })

  it('specialised routing: game work goes to game specialists, AI work to AI specialists', () => {
    const studio = teamFor('studio', 'dddddddd-4', 0)
    const level = { kind: 'code' as const, title: 'Design level 2 with a tilemap and enemy encounters', description: '', files: [] }
    expect(chooseAssignee(studio, 'code', taskSkills(level), () => 0)?.employee.title).toBe('Level Designer')
    const physics = { kind: 'code' as const, title: 'Player physics, collision and controls in the game loop', description: '', files: [] }
    expect(chooseAssignee(studio, 'code', taskSkills(physics), () => 0)?.employee.title).toBe('Gameplay Programmer')
    const lab = teamFor('lab', 'eeeeeeee-5', 0)
    // evals belong to an evaluation specialist (Research or AI Evaluation), never to infra or data roles
    const evals = { kind: 'code' as const, title: 'Add an eval set with a golden set and accuracy metrics', description: '', files: [] }
    expect(['Research Engineer', 'AI Evaluation Engineer']).toContain(chooseAssignee(lab, 'code', taskSkills(evals), () => 0)?.employee.title)
    const etl = { kind: 'code' as const, title: 'Ingest the ticket dataset with an ETL pipeline', description: '', files: [] }
    expect(chooseAssignee(lab, 'code', taskSkills(etl), () => 0)?.employee.title).toBe('Data Engineer')
  })
})

describe('offices persist, and existing projects keep their office and team', () => {
  it('migrates, creates per-project teams, and removes them with the project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopia-offices-'))
    try {
      const file = join(dir, 'a.db')
      let repo = new Repo(openDatabase(file))
      repo.seedEmployees(FOUNDING_TEAM)
      const old = repo.createProject({ name: 'Old', path: join(dir, 'old'), goal: '', gitEnabled: false, baseBranch: null })
      const game = repo.createProject({ name: 'Game', path: join(dir, 'game'), goal: '', gitEnabled: false, baseBranch: null, officeType: 'studio' })
      repo = new Repo(openDatabase(file)) // restart
      expect(repo.project(old.id).officeType).toBe('startup')
      expect(repo.project(game.id).officeType).toBe('studio')
      const studioTeam = repo.employees().filter((e) => e.projectId === game.id)
      expect(studioTeam.map((e) => e.title)).toContain('Game Director')
      expect(repo.employees().filter((e) => !e.projectId).map((e) => e.id)).toEqual(FOUNDING_TEAM.map((e) => e.id)) // the original team is untouched
      repo.deleteProject(game.id)
      expect(repo.employees().some((e) => e.projectId === game.id)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
