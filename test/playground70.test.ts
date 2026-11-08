import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { H, W, landing, newPong, replayPoint, stepPong, type PongEvent } from '../src/renderer/src/office/games/pong'
import { FH, FW, newFoos, stepFoos, type FoosEvent } from '../src/renderer/src/office/games/foosball'
import { HH, LANES, laneX, newHotfix, stepHotfix, type HotfixEvent } from '../src/renderer/src/office/games/hotfix'

const FRAME = 1000 / 60

/** A person: reacts late, misjudges a little, more so as the ball speeds up. */
function pongMatch(seed: number, reactMs: number, skill: number, sloppy = 11) {
  const s = newPong(seed)
  let t = 0
  let aim = H / 2
  let next = 0
  let r = seed * 7919
  const noise = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2
  const events: PongEvent[] = []
  let longest = 0
  while (!s.over && t < 600_000) {
    if (t >= next) {
      next = t + reactMs
      const fast = Math.hypot(s.vx, s.vy) / 150
      aim = s.vx < 0 ? landing(s, 16) + noise() * sloppy * fast : H / 2
    }
    events.push(...stepPong(s, aim, FRAME, skill))
    longest = Math.max(longest, s.rally)
    expect(s.by).toBeGreaterThanOrEqual(0)
    expect(s.by).toBeLessThanOrEqual(H)
    t += FRAME
  }
  return { s, t, events, longest }
}

describe('ping pong', () => {
  it('a match ends, with the score the rules say, in a sensible time', () => {
    for (let seed = 1; seed < 15; seed++) {
      const { s, t, events } = pongMatch(seed, 140, 0.7)
      expect(s.over).toBe(true)
      expect(Math.max(s.you, s.them)).toBe(5)
      expect(Math.min(s.you, s.them)).toBeLessThan(5)
      expect(events.filter((e) => e === 'point-you').length).toBe(s.you)
      expect(t).toBeLessThan(240_000)
    }
  })
  it('the opponent is a real game: a good player usually wins, and has to work for it', () => {
    const games = Array.from({ length: 40 }, (_, i) => pongMatch(i + 100, 140, 0.7))
    const wins = games.filter((g) => g.s.you === 5).length
    const seconds = games.map((g) => g.t / 1000).sort((a, b) => a - b)
    console.log('pong: careful player wins', wins, '/40; median match', Math.round(seconds[20]), 's; longest rally', Math.max(...games.map((g) => g.longest)))
    const sloppy = Array.from({ length: 40 }, (_, i) => pongMatch(i + 300, 200, 0.7, 17)).filter((g) => g.s.you === 5).length
    console.log('pong: sloppy player wins', sloppy, '/40')
    expect(wins).toBeGreaterThan(10)
    expect(wins).toBeLessThan(39)
    expect(sloppy).toBeLessThan(wins)
    expect(seconds[20]).toBeLessThan(150)
    expect(Math.max(...games.map((g) => g.longest))).toBeGreaterThan(3)
  })
  it('standing still loses', () => {
    const s = newPong(5)
    for (let t = 0; t < 300_000 && !s.over; t += FRAME) stepPong(s, H / 2 + 60, FRAME)
    expect(s.them).toBe(5)
  })
  it('where it hits the paddle is where it goes, and it never leaves the table sideways', () => {
    const s = newPong(1)
    s.serveIn = 0
    Object.assign(s, { bx: 20, by: s.youY + 10, vx: -150, vy: 0 })
    const ev = stepPong(s, s.youY, FRAME)
    expect(ev).toContain('hit')
    expect(s.vx).toBeGreaterThan(0)
    expect(s.vy).toBeGreaterThan(0)
  })
  it('the same inputs always play out the same way', () => {
    expect(pongMatch(9, 140, 0.7).s).toEqual(pongMatch(9, 140, 0.7).s)
  })
  it('a stolen ball replays the point and scores nothing', () => {
    const s = newPong(1)
    Object.assign(s, { you: 2, them: 1, vx: 100 })
    replayPoint(s)
    expect([s.you, s.them, s.vx]).toEqual([2, 1, 0])
  })
  it('the paddle cannot teleport', () => {
    const s = newPong(1)
    const from = s.youY
    stepPong(s, 0, FRAME)
    expect(from - s.youY).toBeLessThan(6)
  })
})

function foosMatch(seed: number, skill = 0.6, sloppy = 12) {
  const s = newFoos(seed)
  const ev: FoosEvent[] = []
  let t = 0
  let tick = 0
  let aim = 0
  let next = 0
  let r = seed * 7919
  const noise = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2
  while (!s.over && t < 900_000) {
    // a person: follows the ball with the rod nearest it, a beat late and not quite exactly, and kicks when it's close
    const near = [20, 166].sort((a, b) => Math.abs(a - s.bx) - Math.abs(b - s.bx))[0]
    const men = near === 20 ? [0] : [-34, 0, 34]
    if (t >= next) {
      next = t + 170
      const man = men.reduce((b, m) => (Math.abs(s.by - FH / 2 - m - s.youY) < Math.abs(s.by - FH / 2 - b - s.youY) ? m : b), men[0])
      aim = s.by - FH / 2 - man + noise() * sloppy
    }
    const kick = Math.abs(s.bx - near) < 12 && tick++ % 20 === 0
    ev.push(...stepFoos(s, aim, kick, FRAME, skill))
    expect(s.by).toBeGreaterThanOrEqual(0)
    expect(s.by).toBeLessThanOrEqual(FH)
    t += FRAME
  }
  return { s, ev, t }
}

describe('foosball', () => {
  it('a match ends at three goals, in a sensible time', () => {
    for (let seed = 1; seed < 12; seed++) {
      const { s, t, ev } = foosMatch(seed)
      expect(s.over).toBe(true)
      expect(Math.max(s.you, s.them)).toBe(3)
      expect(ev.filter((e) => e === 'goal-you').length).toBe(s.you)
      expect(t).toBeLessThan(600_000)
    }
  })
  it('both sides really play: each scores across a set of matches, and each kicks', () => {
    const games = Array.from({ length: 20 }, (_, i) => foosMatch(i + 50))
    console.log('foos: you', games.reduce((n, g) => n + g.s.you, 0), 'them', games.reduce((n, g) => n + g.s.them, 0), 'wins', games.filter((g) => g.s.you === 3).length, '/20; median s', Math.round([...games.map((g) => g.t / 1000)].sort((a, b) => a - b)[10]))
    expect(games.reduce((n, g) => n + g.s.you, 0)).toBeGreaterThan(5)
    expect(games.reduce((n, g) => n + g.s.them, 0)).toBeGreaterThan(5)
    expect(games.some((g) => g.ev.includes('man'))).toBe(true)
  })
  it('a ball never gets stuck for good', () => {
    const s = newFoos(3)
    s.serveIn = 0
    Object.assign(s, { bx: FW / 2, by: 10, vx: 0, vy: 0 })
    for (let t = 0; t < 3000; t += FRAME) stepFoos(s, 0, false, FRAME, 0)
    expect(Math.hypot(s.vx, s.vy) + Math.abs(s.bx - FW / 2)).toBeGreaterThan(1)
  })
  it('a kick needs the man at the ball, and sends it the right way', () => {
    const s = newFoos(1)
    s.serveIn = 0
    Object.assign(s, { bx: 170, by: FH / 2, vx: 0, vy: 0, youY: 0 })
    stepFoos(s, 0, true, FRAME)
    expect(s.vx).toBeGreaterThan(200)
  })
})

describe('hotfix', () => {
  it('doing nothing loses three lives, and the game ends', () => {
    const s = newHotfix(1)
    const ev: HotfixEvent[] = []
    for (let t = 0; t < 120_000 && !s.over; t += FRAME) ev.push(...stepHotfix(s, 0, false, FRAME))
    expect(s.over).toBe(true)
    expect(s.lives).toBe(0)
    expect(ev.filter((e) => e === 'miss').length).toBe(3)
  })
  it('a patch squashes a bug in its lane, and only there', () => {
    const s = newHotfix(1)
    s.spawnIn = 99_999
    s.bugs = [{ id: 1, kind: 'bug', x: laneX(2), y: 60, lane: 2, hops: 0 }]
    s.patches = [{ x: laneX(3), y: 62 }]
    stepHotfix(s, 3, false, FRAME)
    expect(s.bugs.length).toBe(1)
    s.patches = [{ x: laneX(2), y: s.bugs[0].y + 2 }]
    const ev = stepHotfix(s, 2, false, FRAME)
    expect(ev).toContain('squash')
    expect(s.score).toBe(10)
  })
  it('patching the coffee spills it; catching it slows everything down', () => {
    const s = newHotfix(1)
    s.spawnIn = 99_999
    s.lane = 1
    s.bugs = [{ id: 1, kind: 'coffee', x: laneX(1), y: HH, lane: 1, hops: 0 }]
    expect(stepHotfix(s, 1, false, FRAME)).toContain('coffee')
    expect(s.calm).toBeGreaterThan(0)
    expect(s.lives).toBe(3)
  })
  it('a player chasing bugs survives longer than one who stands still, and it gets harder', () => {
    const play = (seed: number) => {
      const s = newHotfix(seed)
      for (let t = 0; t < 600_000 && !s.over; t += FRAME) {
        const target = [...s.bugs].filter((b) => b.kind !== 'coffee').sort((a, b) => b.y - a.y)[0]
        stepHotfix(s, target ? target.lane : s.lane, !!target && target.lane === s.lane, FRAME)
      }
      return s
    }
    const still = newHotfix(4)
    for (let t = 0; t < 600_000 && !still.over; t += FRAME) stepHotfix(still, LANES - 1, true, FRAME)
    const played = play(4)
    expect(played.elapsed).toBeGreaterThan(still.elapsed)
    expect(played.score).toBeGreaterThan(still.score)
    console.log('hotfix: chaser lasted', Math.round(played.elapsed / 1000), 's, score', played.score)
    expect(played.elapsed).toBeGreaterThan(30_000)
    // it does end: nobody plays this forever
    expect(played.over).toBe(true)
  })
  it('decaf is a gentler game', () => {
    const run = (decaf: boolean) => {
      const s = newHotfix(2, decaf)
      for (let t = 0; t < 600_000 && !s.over; t += FRAME) stepHotfix(s, 0, false, FRAME)
      return s.elapsed
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

it('sizes stay in step', () => expect([W, H]).toEqual([FW, FH]))

describe('in the office', () => {
  it('foosball fits in every office, without cutting anyone off from anywhere', async () => {
    const { allReachable, buildWalkGrid, useLayout } = await import('../src/renderer/src/office/layout')
    const { startupLayout } = await import('../src/renderer/src/office/offices/startup')
    const { studioLayout } = await import('../src/renderer/src/office/offices/studio')
    const { labLayout } = await import('../src/renderer/src/office/offices/lab')
    for (const l of [startupLayout, studioLayout, labLayout]) {
      useLayout(l)
      for (const k of ['pingpong', 'foosball', 'arcade']) expect(l.PLACEMENTS.some((p) => p.key === k), `${l.type} ${k}`).toBe(true)
      expect(allReachable(buildWalkGrid(l.PLACEMENTS)), l.type).toBe(true)
    }
    useLayout(startupLayout)
  })
  it('the right things open the right game, and most furniture stays furniture', async () => {
    const { gameFor, playfulLabel, propReaction } = await import('../src/renderer/src/office/games/playful')
    expect(gameFor('pingpong')).toBe('pong')
    expect(gameFor('foosball')).toBe('foosball')
    expect(gameFor('arcade')).toBe('hotfix')
    expect(gameFor('sofa')).toBeNull()
    expect(playfulLabel('sofa')).toBeNull()
    expect(playfulLabel('receptionDesk')).toBeNull()
    expect(propReaction('plant:fig', 12, () => 0.5)?.text).toContain('flowers')
    expect(propReaction('sofa', 1, () => 0.5)).toBeNull()
  })
  it('games touch nothing real: no project, no Claude, no network', () => {
    const dir = join(__dirname, '../src/renderer/src/office/games')
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/autopia\.|fetch\(|sendMessage|localStorage/)
    const host = readFileSync(join(__dirname, '../src/renderer/src/components/playground/Playground.tsx'), 'utf8')
    expect(host).not.toMatch(/window\.autopia|sendMessage|fetch\(/)
  })
})

describe('office life', () => {
  const profile = (over: object = {}, habits: string[] = []) => ({ traits: { sociability: 0.5, playfulness: 0.5, competitiveness: 0.5, curiosity: 0.5, focus: 0.5, quiet: 0.5, ...over }, habits }) as never
  it('weather holds for a few hours, is the same for everyone, and mostly it is fine', async () => {
    const { weatherAt } = await import('../src/renderer/src/office/life')
    expect(weatherAt(new Date(2026, 5, 10, 13, 5))).toBe(weatherAt(new Date(2026, 5, 10, 14, 55)))
    const seen: Record<string, number> = {}
    for (let d = 0; d < 360; d++) for (const h of [9, 12, 15]) { const w = weatherAt(new Date(2026, 0, 1 + d, h)); seen[w] = (seen[w] ?? 0) + 1 }
    expect(seen.clear).toBeGreaterThan(seen.rain + (seen.snow ?? 0))
    expect(seen.rain).toBeGreaterThan(0)
    expect(seen.snow).toBeGreaterThan(0)
    for (let d = 0; d < 60; d++) expect(weatherAt(new Date(2026, 6, 1 + d, 12))).not.toBe('snow')
  })
  it('people sound like themselves, and never mention work', async () => {
    const { clickLine } = await import('../src/renderer/src/office/life')
    const r = () => 0.5
    const lines = [clickLine(profile({ quiet: 0.9 }, ['loner']), 1, r), clickLine(profile({}, ['coffeeRegular']), 1, r), clickLine(profile({ competitiveness: 0.9 }), 1, r), clickLine(profile({}, ['dogPerson']), 1, r)]
    expect(new Set(lines.map((l) => l.line)).size).toBe(4)
    for (let i = 0; i < 40; i++) expect(clickLine(profile({ sociability: 0.9, playfulness: 0.9 }, ['chatty', 'gamer']), 1, () => i / 40).line).not.toMatch(/\b(task|bug|commit|deploy|test|shipped|finished|working on|code)\b/i)
    expect(clickLine(profile(), 12, r).line).toContain('charging')
  })
  it('rare events are never the same twice running, and need people who are free', async () => {
    const { nextRareEvent, rareGapMs } = await import('../src/renderer/src/office/life')
    const ctx = { idle: 5, someoneResting: true, hasDog: true, reducedMotion: false }
    const seen: string[] = []
    let x = 1
    const r = () => ((x = (x * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 200; i++) {
      const k = nextRareEvent(r, seen.slice(-4) as never, ctx)!
      expect(k).not.toBe(seen[seen.length - 1])
      seen.push(k)
    }
    expect(new Set(seen).size).toBe(6)
    // everyone's busy: nothing that needs a person can happen
    for (let i = 0; i < 40; i++) expect(['plane', 'puffySteal']).toContain(nextRareEvent(r, [], { idle: 0, someoneResting: false, hasDog: true, reducedMotion: false }))
    expect(nextRareEvent(r, [], { idle: 0, someoneResting: false, hasDog: false, reducedMotion: true })).toBeNull()
    for (let i = 0; i < 50; i++) expect(rareGapMs(r)).toBeGreaterThanOrEqual(5 * 60_000)
  })
  it('everyone’s routines include foosball, and it can be reached in every office', async () => {
    const { activity } = await import('../src/renderer/src/office/behavior')
    expect(activity('foosball')?.spots).toBe('foosball')
    const layouts = await Promise.all([import('../src/renderer/src/office/offices/startup'), import('../src/renderer/src/office/offices/studio'), import('../src/renderer/src/office/offices/lab')])
    const list = [layouts[0].startupLayout, layouts[1].studioLayout, layouts[2].labLayout]
    for (const l of list) expect(l.IDLE_SPOTS.foosball.length, l.type).toBe(2)
  })
})
