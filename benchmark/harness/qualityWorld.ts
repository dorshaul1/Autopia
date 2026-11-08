// A real, disposable quality world for deterministic checks: an in-memory Autopia database with the
// founding team, a project folder with real files, and the real QualityEngine. The only stand-in is
// the correction hook, which records what would be sent back to the team instead of starting a
// Claude Code session.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { QualityEngine } from '../../src/main/quality/engine'
import { FOUNDING_TEAM } from '../../src/shared/roster'
import type { CheckResult, CriterionReport, Delivery, QualityFinding, QualityReport, Task } from '../../src/shared/types'

export function qualityWorld() {
  const root = mkdtempSync(join(tmpdir(), 'autopia-quality-'))
  const db = openDatabase(':memory:')
  const repo = new Repo(db)
  repo.seedEmployees(FOUNDING_TEAM)
  const project = repo.createProject({ name: 'quality', path: root, goal: 'fixture', gitEnabled: false, baseBranch: null })
  const corrections: QualityFinding[][] = []
  let allowCorrection = true
  const engine = new QualityEngine(repo, { info: () => ({ kind: 'none', status: 'unavailable', error: null, url: null, logs: [], command: null }) } as never, () => {}, {
    designReview: async () => [], askToVerify: () => {},
    canRepair: () => false,
    repairVerification: () => null,
    busy: () => () => {},
    correct: (_p, _d, findings) => {
      if (!allowCorrection) return null
      corrections.push(findings)
      return `T${90 + corrections.length}`
    }
  })
  let n = 0
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return {
    root,
    repo,
    project,
    engine,
    corrections,
    setCorrectionAllowed: (v: boolean) => (allowCorrection = v),
    write,
    remove: (rel: string) => rmSync(join(root, rel), { force: true }),
    delivery: (): Delivery => repo.createDelivery({ projectId: project.id, parentId: null, kind: 'brief', request: 'fixture', baseSha: null, screenshot: null }),
    /** A finished task in the delivery that wrote `files` (with their contents) and ran `checks`. */
    task: (d: Delivery, p: { files?: Record<string, string>; checks?: Partial<CheckResult>[]; criteria?: CriterionReport[]; kind?: Task['kind']; status?: Task['status'] }): Task => {
      for (const [f, text] of Object.entries(p.files ?? {})) write(f, text)
      const t = repo.insertTask(project.id, { key: `T${++n}`, title: `task ${n}`, description: 'fixture', acceptance: 'works', kind: p.kind ?? 'code', assigneeId: FOUNDING_TEAM[1].id, dependsOnKeys: [] })
      const checks = (p.checks ?? []).map((c) => ({ command: 'npm test', status: 'passed', ok: true, ms: 10, output: '', at: Date.now(), ...c }) as CheckResult)
      return repo.updateTask(t.id, { deliveryId: d.id, status: p.status ?? 'done', changedFiles: Object.keys(p.files ?? {}).map((f) => `A ${f}`), checks, criteria: p.criteria ?? [], finishedAt: Date.now() })
    },
    /** Stores a finished visual report (what runVisualQa would have saved) for a delivery. */
    visualReport: (d: Delivery | null, findings: QualityFinding[], at = Date.now()): QualityReport => {
      const r: QualityReport = { id: `v${Math.random().toString(36).slice(2)}`, projectId: project.id, deliveryId: d?.id ?? null, kind: 'visual', status: 'done', findings, metrics: {}, shots: [{ width: 375, path: '.autopia/quality/x-375.png' }], note: null, error: null, startedAt: at, endedAt: at }
      repo.saveQualityReport(r)
      return r
    },
    close: () => {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}

export const finding = (p: Partial<QualityFinding> & Pick<QualityFinding, 'rule'>): QualityFinding => ({ dimension: 'visual', severity: 'high', message: p.rule, file: null, line: null, width: 375, count: 1, ...p })
