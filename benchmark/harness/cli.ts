// Autopia engineering benchmark.
//   npm run bench -- list
//   npm run bench -- validate [scenario…]           deterministic, no AI: fixtures fail, reference solutions pass
//   npm run bench -- plan [scenario…] --mode direct|autopia-minimal|autopia|both|all [--repeat n]   budget preview, runs nothing
//   npm run bench -- run [scenario…] --mode direct|autopia-minimal|autopia|all --label NAME --approve-usd N [--repeat n] [--keep]
//   npm run bench -- report                         summary of recorded live runs
//   npm run bench -- memory [--legacy] [--label L]    deterministic project-memory benchmark (no AI)
//   npm run bench -- quality [--label L]             quality decisions and real visual QA on fixtures (no AI; app running)
//   npm run bench -- replay                         re-evaluate recorded runs' check evidence (needs the app running)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAutopia } from './autopia'
import { runDirect } from './direct'
import { memoryBench } from './memory'
import { qualityBench } from './quality'
import { replay } from './replay'
import { appendRecord, readRecords, summarise, type Mode } from './results'
import { applySolution, createSandbox, removeSandbox, runChecks } from './sandbox'
import { BENCH_ROOT, loadScenarios, stepChecks } from './scenarios'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
const log = (m: string) => console.log(m)

async function validate(): Promise<void> {
  const out: { scenario: string; initialFails: boolean; failing: string[]; solutionPasses: boolean; stepsPass: boolean; ms: number }[] = []
  for (const s of loadScenarios(positional)) {
    const t0 = Date.now()
    // 1. the untouched fixture must fail its final checks (otherwise the scenario measures nothing)
    const fresh = createSandbox(s)
    const before = await runChecks(s, fresh, s.verify)
    removeSandbox(fresh)
    // 2. a reference solution must pass every check (otherwise the scenario is unachievable or the checks are wrong)
    const solved = createSandbox(s)
    applySolution(s, solved)
    const after = await runChecks(s, solved, s.verify)
    const steps = []
    for (let i = 0; i < s.steps.length; i++) steps.push(stepChecks(s, i).length ? await runChecks(s, solved, stepChecks(s, i)) : [])
    removeSandbox(solved)
    const row = {
      scenario: s.id,
      initialFails: before.some((c) => !c.ok),
      failing: before.filter((c) => !c.ok).map((c) => c.command),
      solutionPasses: after.every((c) => c.ok),
      stepsPass: steps.flat().every((c) => c.ok),
      ms: Date.now() - t0
    }
    out.push(row)
    const ok = row.initialFails && row.solutionPasses && row.stepsPass
    log(`${ok ? 'VALID  ' : 'INVALID'} ${s.id}  initial: ${row.initialFails ? 'fails' : 'PASSES (bad)'} · reference: ${row.solutionPasses && row.stepsPass ? 'passes' : 'FAILS (bad)'}  (${row.ms} ms)`)
    if (!row.solutionPasses || !row.stepsPass) for (const c of [...after, ...steps.flat()].filter((c) => !c.ok)) log(`    ✗ ${c.command}\n${c.tail.replace(/^/gm, '      ')}`)
  }
  writeFileSync(join(BENCH_ROOT, 'results', 'validation.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, scenarios: out }, null, 2) + '\n')
  if (out.some((r) => !(r.initialFails && r.solutionPasses && r.stepsPass))) process.exit(1)
}

function modes(): Mode[] {
  const m = flag('mode') ?? 'both'
  if (m === 'both') return ['direct', 'autopia']
  if (m === 'all') return ['direct', 'autopia-minimal', 'autopia']
  if (m !== 'direct' && m !== 'autopia' && m !== 'autopia-minimal') throw new Error('--mode must be direct, autopia-minimal, autopia, both or all')
  return [m]
}

function plan(): number {
  const scenarios = loadScenarios(positional)
  const repeat = Number(flag('repeat') ?? 1)
  let max = 0
  for (const s of scenarios) log(`${s.id.padEnd(28)} ${s.size.padEnd(6)} ${s.steps.length} step(s)  cap $${s.budget.usd.toFixed(2)} / ${s.budget.minutes} min per run`)
  max = scenarios.reduce((a, s) => a + s.budget.usd, 0) * modes().length * repeat
  log(`\n${scenarios.length} scenario(s) × ${modes().join('+')} × ${repeat} repeat(s): hard cap $${max.toFixed(2)} (each run is stopped at its own cap).`)
  return max
}

async function run(): Promise<void> {
  const label = flag('label')
  if (!label) throw new Error('--label is required (e.g. baseline)')
  const approved = Number(flag('approve-usd'))
  const cap = plan()
  // never start paid work without an explicit approval that covers the worst case
  if (!(approved >= cap)) throw new Error(`Refusing to run: the worst case is $${cap.toFixed(2)}; pass --approve-usd ${Math.ceil(cap)} or more to approve it.`)
  const repeat = Number(flag('repeat') ?? 1)
  let spent = 0
  for (let k = 0; k < repeat; k++) {
    for (const s of loadScenarios(positional)) {
      for (const mode of modes()) {
        if (spent + s.budget.usd > approved) return log(`Stopping: the next run could exceed the approved $${approved}.`)
        log(`\n▶ ${s.id} · ${mode} · ${label}`)
        const sb = createSandbox(s)
        const rec = mode === 'direct' ? await runDirect(s, sb, label, log) : await runAutopia(s, sb, label, log, mode === 'autopia-minimal')
        spent += rec.costUsd
        appendRecord(rec)
        log(`  ${rec.pass ? 'PASS' : 'FAIL'}  ${(rec.wallMs / 60000).toFixed(1)} min · $${rec.costUsd.toFixed(2)} · ${rec.sessions} session(s) · ${rec.turns} turns${rec.error ? ` · ${rec.error}` : ''}`)
        for (const c of rec.checks.filter((c) => !c.ok)) log(`    ✗ ${c.command}`)
        if (flag('keep') === undefined && !argv.includes('--keep')) removeSandbox(sb)
        else log(`  kept ${sb.repo}`)
      }
    }
  }
  log(`\nTotal spent: $${spent.toFixed(2)} of $${approved} approved.`)
}

const main: Record<string, () => unknown> = {
  list: () => loadScenarios().forEach((s) => log(`${s.id.padEnd(28)} ${s.category.padEnd(12)} ${s.title}`)),
  validate,
  plan,
  run,
  report: () => log(summarise(readRecords())),
  replay: () => replay(log),
  quality: () => qualityBench(log, flag('label') ?? 'current', argv.includes('--decisions-only')),
  memory: () => memoryBench(log, argv.includes('--legacy'), flag('label') ?? (argv.includes('--legacy') ? 'legacy' : 'current'))
}
if (!main[cmd]) {
  log('usage: bench <list|validate|plan|run|report|replay|memory|quality> [scenario…] [--mode direct|autopia|both] [--label L] [--approve-usd N] [--repeat n] [--keep]')
  process.exit(2)
}
Promise.resolve(main[cmd]()).catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
