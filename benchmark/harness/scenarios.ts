import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BENCH_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
export const SCENARIO_DIR = join(BENCH_ROOT, 'scenarios')

export interface Step {
  request: string
  /** Checks that must pass after this step (defaults to the scenario's final checks on the last step). */
  verify?: string[]
  /** Kill the session this many seconds in, then resume it (recovery scenarios). */
  interrupt?: { afterSeconds: number }
}

export interface Scenario {
  id: string
  title: string
  category: string
  size: 'small' | 'medium' | 'large'
  steps: Step[]
  acceptance: string[]
  /** Final, independent verification. Runs in the result repo with BENCH_REPO / BENCH_VERIFY set. */
  verify: string[]
  budget: { usd: number; minutes: number }
  /** Directories, resolved. */
  dir: string
  repo: string
  hidden: string
  solution: string
}

export function loadScenarios(filter?: string[]): Scenario[] {
  const all = readdirSync(SCENARIO_DIR)
    .filter((d) => existsSync(join(SCENARIO_DIR, d, 'scenario.json')))
    .sort()
    .map((d) => {
      const dir = join(SCENARIO_DIR, d)
      const s = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8')) as Omit<Scenario, 'dir' | 'repo' | 'hidden' | 'solution'>
      if (s.id !== d) throw new Error(`${d}: id must match its folder`)
      return { ...s, dir, repo: join(dir, 'repo'), hidden: join(dir, 'verify'), solution: join(dir, 'solution') }
    })
  if (!filter?.length) return all
  const picked = all.filter((s) => filter.some((f) => s.id === f || s.id.startsWith(f) || s.category === f))
  if (!picked.length) throw new Error(`No scenario matches ${filter.join(', ')}`)
  return picked
}

/** Checks for a step: its own, or the final checks for the last step. */
export function stepChecks(s: Scenario, i: number): string[] {
  return s.steps[i].verify ?? (i === s.steps.length - 1 ? s.verify : [])
}
