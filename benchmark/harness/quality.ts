// Quality benchmark (no AI calls). Visual scenarios run Autopia's real visual QA (offscreen rendering
// at 375/768/1280 px) on fixture sites inside the running app; decision scenarios run the real
// readiness / completion / repair logic on recorded-shape fixtures. Results append to
// benchmark/results/quality.jsonl.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDriver } from './autopia'
import { classifyFindings, correctable, recommendations } from '../../src/main/quality/findings'
import { repairStopReason } from '../../src/main/quality/readiness'
import { finding, qualityWorld } from './qualityWorld'
import { BENCH_ROOT } from './scenarios'

interface Finding {
  dimension: string
  severity: string
  rule: string
  message: string
  file: string | null
  width: number | null
  certainty?: string
}

/** What each site must (and must not) produce. `defects` are rules that must be reported as real. */
const SITES = [
  { id: 'q03-responsive-layout', site: 'responsive', defects: ['page-overflow'], note: 'a 920px row of plans on a 375px phone' },
  // the default email input is under 24px tall: a real (minor) target-size issue, allowed but not required
  { id: 'q04-accessibility', site: 'a11y', defects: ['no-name', 'img-alt', 'contrast'], allowed: ['tap-target'], note: 'unlabelled email input and icon button, image without alt, #b5b5b5 text on white' },
  { id: 'q06-no-false-positives', site: 'clean', defects: [], note: 'dark theme, text over a positioned background, two visually-hidden patterns, external font, literal innerHTML' }
]

/** A finding counts as a reported defect unless the engine itself marks it as suspected or advice. */
const reportedAsDefect = (f: Finding) => (f.certainty ?? 'verified') === 'verified' && f.severity !== 'info'

export async function visualScenarios(log: (m: string) => void) {
  const app = await AppDriver.connect()
  const root = mkdtempSync(join(tmpdir(), 'autopia-bench-quality-'))
  const rows = []
  try {
    for (const s of SITES) {
      const dir = join(root, s.site)
      mkdirSync(dir, { recursive: true })
      cpSync(join(BENCH_ROOT, 'quality', 'sites', s.site), dir, { recursive: true })
      const p = await app.call<{ id: string }>('createProject', { name: `bench ${s.id}`, goal: 'quality benchmark fixture', mode: 'open', directory: dir, initGit: false })
      try {
        const r = await app.call<{ status: string; findings: Finding[]; error: string | null; note: string | null }>('runVisualQa', p.id, null)
        const defects = r.findings.filter(reportedAsDefect)
        const found = s.defects.filter((rule) => defects.some((f) => f.rule === rule))
        const falsePositives = defects.filter((f) => !s.defects.includes(f.rule) && !('allowed' in s && (s.allowed as string[]).includes(f.rule)))
        rows.push({ scenario: s.id, status: r.status, expected: s.defects, found, reportedDefects: defects.length, falsePositives: falsePositives.map((f) => `${f.rule}@${f.file ?? '-'}#${f.width}`), all: r.findings.map((f) => `${f.certainty ?? '-'}:${f.severity}:${f.rule}@${f.file ?? '-'}#${f.width}`) })
        log(`${s.id.padEnd(26)} ${r.status.padEnd(6)} defects found ${found.length}/${s.defects.length} · findings reported as defects ${defects.length} · false positives ${falsePositives.length}${r.error ? ` · ${r.error}` : ''}`)
        for (const f of falsePositives) log(`    false positive: ${f.rule} ${f.file ?? ''} at ${f.width}px: ${f.message.slice(0, 90)}`)
      } finally {
        await app.call('deleteProject', p.id).catch(() => undefined)
      }
    }
  } finally {
    app.close()
    rmSync(root, { recursive: true, force: true })
  }
  return rows
}

/**
 * Decision scenarios on the real QualityEngine and readiness logic, with real files and a real
 * database. Each returns what happened and whether it is what a careful engineer would do.
 */
export async function decisionScenarios(): Promise<{ scenario: string; pass: boolean; observed: string }[]> {
  const out: { scenario: string; pass: boolean; observed: string }[] = []
  const run = async (scenario: string, f: (w: ReturnType<typeof qualityWorld>) => Promise<[boolean, string]> | [boolean, string]) => {
    const w = qualityWorld()
    try {
      const [pass, observed] = await f(w)
      out.push({ scenario, pass, observed })
    } catch (e) {
      out.push({ scenario, pass: false, observed: `error: ${(e as Error).message}` })
    } finally {
      w.close()
    }
  }
  const SAFE = 'export const add = (a, b) => a + b\n'

  await run('q01-functional-regression', async (w) => {
    const d = w.delivery()
    w.task(d, { files: { 'lib/add.js': SAFE }, checks: [{ command: 'npm test', status: 'failed', ok: false, output: 'not ok 1 - adds' }] })
    await w.engine.audit(w.project, d.id)
    const c = w.engine.readiness(w.project.id, d.id).completion
    return [c.status === 'failed' && c.failed.some((x) => x.includes('npm test')), `${c.status}: ${c.failed.join('; ')}`]
  })
  await run('q02-failing-test-fixed', async (w) => {
    const first = repairStopReason('assert 3 == 4', null, 0, 2)
    const d = w.delivery()
    w.task(d, { files: { 'lib/add.js': SAFE }, checks: [{ command: 'npm test', status: 'passed' }] })
    await w.engine.audit(w.project, d.id)
    const c = w.engine.readiness(w.project.id, d.id).completion
    return [first === null && c.status === 'verified', `repair allowed: ${first === null}; after the fix: ${c.status}`]
  })
  await run('q05-partial-requirement', async (w) => {
    const d = w.delivery()
    w.task(d, { files: { 'lib/add.js': SAFE }, checks: [{ command: 'npm test', status: 'passed' }], criteria: [{ criterion: 'Search filters live', met: false, evidence: 'not wired' }, { criterion: 'List shows recipes', met: true, evidence: 'test' }] })
    await w.engine.audit(w.project, d.id)
    const c = w.engine.readiness(w.project.id, d.id).completion
    return [c.status === 'partial', `${c.status}: ${c.headline}`]
  })
  await run('q07-bounded-correction', async (w) => {
    const d = w.delivery()
    // a secrets file in the change set is a certain, high-severity defect
    w.task(d, { files: { 'lib/add.js': SAFE, '.env': 'API_KEY=abc' }, checks: [{ command: 'npm test', status: 'passed' }] })
    for (let i = 0; i < 3; i++) await w.engine.onReview(w.project, w.repo.delivery(d.id))
    const corr = w.engine.correction(d.id)
    return [w.corrections.length === 1 && !!corr?.outcome?.remaining.length, `correction sessions requested: ${w.corrections.length}; still unresolved after it: ${corr?.outcome?.remaining.join(', ') || 'none'}`]
  })
  await run('q08-out-of-scope', () => {
    const before = [finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'footer p' })]
    const now = classifyFindings([finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'footer p' }), finding({ rule: 'no-name', dimension: 'accessibility', file: 'button.icon' })], before, true)
    const fix = correctable(now).map((f) => f.rule)
    const rec = recommendations(now).map((f) => f.rule)
    return [fix.join() === 'no-name' && rec.join() === 'contrast', `corrected automatically: ${fix.join(', ') || 'none'}; suggested only: ${rec.join(', ') || 'none'}`]
  })
  await run('q09-unverified-reported', async (w) => {
    const d = w.delivery()
    w.task(d, { files: { 'lib/add.js': SAFE } })
    await w.engine.audit(w.project, d.id)
    const c = w.engine.readiness(w.project.id, d.id).completion
    return [c.status !== 'verified' && c.unverified.length > 0, `${c.status}; unverified: ${c.unverified.join('; ')}`]
  })
  await run('q10-quality-after-correction', async (w) => {
    const d = w.delivery()
    w.task(d, { files: { 'lib/add.js': SAFE, '.env': 'API_KEY=abc' }, checks: [{ command: 'npm test', status: 'passed' }] })
    await w.engine.onReview(w.project, w.repo.delivery(d.id))
    // the "fix" removes .env but adds another secrets file: a regression the correction introduced
    w.remove('.env')
    w.task(d, { files: { 'config/server.pem': '-----BEGIN PRIVATE KEY-----' }, checks: [{ command: 'npm test', status: 'passed' }] })
    w.repo.updateTask(w.repo.tasks(w.project.id)[0].id, { changedFiles: ['A lib/add.js'] })
    await w.engine.onReview(w.project, w.repo.delivery(d.id))
    const o = w.engine.correction(d.id)?.outcome
    const c = w.engine.readiness(w.project.id, d.id).completion
    return [!!o && o.fixed.length === 1 && o.introduced.length === 1 && c.limitations.some((l) => l.includes('introduced')), `fixed ${o?.fixed.join(', ')}; introduced ${o?.introduced.join(', ')}; status ${c.status}`]
  })
  return out
}

export async function qualityBench(log: (m: string) => void, label: string, decisionsOnly = false): Promise<void> {
  log(`Quality benchmark (${label}), no AI calls\n`)
  const decisions = await decisionScenarios()
  for (const d of decisions) log(`${d.pass ? 'PASS' : 'FAIL'}  ${d.scenario.padEnd(30)} ${d.observed}`)
  log('')
  const visual = decisionsOnly ? [] : await visualScenarios(log)
  appendFileSync(join(BENCH_ROOT, 'results', 'quality.jsonl'), JSON.stringify({ at: new Date().toISOString(), label, decisions, visual }) + '\n')
}
