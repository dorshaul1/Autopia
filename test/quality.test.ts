import { describe, expect, it } from 'vitest'
import { auditDiff, wholeFiles } from '../src/main/quality/audit'
import { qualityPlan, splitCriteria } from '../src/main/quality/plan'
import { checkDimension, failureSignature, readiness, repairBudget } from '../src/main/quality/readiness'
import { visualFindings } from '../src/main/quality/visual'
import type { Delivery, QualityReport, Task } from '../src/shared/types'

const base = { title: 'Add countLabel', description: 'Format the item count', acceptance: 'Shows "1 item"', kind: 'code' as const, size: 's' as const, files: ['public/list.js'], validation: [] }
const checks = ['npm run lint', 'npm test', 'npm run build']

describe('quality planning', () => {
  it('keeps small changes focused and makes risky ones broad with criteria', () => {
    const small = qualityPlan({ task: base, risk: 'normal', projectChecks: checks, hasTests: true, previewable: true, reviewerAvailable: true })
    expect(small.scope).toBe('focused')
    expect(small.criteria).toEqual([])
    const on = (p: typeof small) => p.items.filter((i) => i.applies).map((i) => i.dimension)
    expect(on(small)).toEqual(['requirements', 'tests', 'security'])
    const big = qualityPlan({
      task: { ...base, title: 'Add login with password hashing', size: 'l', acceptance: '- Passwords are hashed\n- Wrong password is rejected' },
      risk: 'high',
      projectChecks: checks,
      hasTests: true,
      previewable: true,
      reviewerAvailable: true
    })
    expect(big.scope).toBe('broad')
    expect(big.criteria).toEqual(['Passwords are hashed', 'Wrong password is rejected'])
    expect(on(big)).toEqual(expect.arrayContaining(['static', 'build', 'review', 'security']))
  })

  it('plans visual and accessibility QA only for previewable user-facing work, and no speculative performance work', () => {
    const ui = qualityPlan({ task: { ...base, title: 'Restyle the header', kind: 'design', files: ['public/style.css'] }, risk: 'low', projectChecks: checks, hasTests: true, previewable: true, reviewerAvailable: false })
    const on = ui.items.filter((i) => i.applies).map((i) => i.dimension)
    expect(on).toEqual(expect.arrayContaining(['visual', 'accessibility']))
    expect(on).not.toContain('performance')
    const cli = qualityPlan({ task: { ...base, title: 'Restyle the header', kind: 'design' }, risk: 'low', projectChecks: [], hasTests: false, previewable: false, reviewerAvailable: false })
    expect(cli.items.find((i) => i.dimension === 'visual')!.applies).toBe(false)
  })

  it('splits acceptance text into criteria', () => {
    expect(splitCriteria('1. It works. It is fast\n- Handles empty input')).toEqual(['It works.', 'It is fast', 'Handles empty input'])
  })
})

describe('static audit', () => {
  const diff = (path: string, text: string) => wholeFiles([path], () => text)
  it('finds concrete risks in added lines only, with file and line', () => {
    const f = auditDiff(
      [
        ...diff('server.js', "const q = `SELECT * FROM users WHERE id = ${id}`\ndb.query(`SELECT * FROM t WHERE a = ${a}`)\nexec(`rm ${file}`)\nconst apiKey = 'sk-live-1234567890abcdefghij'\n"),
        ...diff('public/app.js', 'el.innerHTML = item.text\nel.innerHTML = "<b>static</b>"\nsetInterval(tick, 1000)\n')
      ],
      () => null
    )
    const rules = f.map((x) => `${x.rule}@${x.file}:${x.line}`)
    expect(rules).toEqual(expect.arrayContaining(['sql-concat@server.js:2', 'shell-injection@server.js:3', 'hardcoded-secret@server.js:4', 'html-injection@public/app.js:1', 'interval-leak@public/app.js:3']))
    expect(rules).not.toContain('html-injection@public/app.js:2')
  })

  it('respects cleanup in the same file and env-sourced secrets', () => {
    const f = auditDiff(diff('a.js', 'const t = setInterval(f, 5)\nclearInterval(t)\nconst token = process.env.API_TOKEN_VALUE\n'), () => 'const t = setInterval(f, 5)\nclearInterval(t)')
    expect(f).toEqual([])
  })
})

describe('repair budgets', () => {
  it('treats the same failure with different timings as unchanged', () => {
    const a = failureSignature({ command: 'npm test', output: '✖ adds items (1.2ms)\nAssertionError: expected 2 to equal 3\n at /tmp/x/list.test.js:10:5' })
    const b = failureSignature({ command: 'npm test', output: '✖ adds items (0.8ms)\nAssertionError: expected 2 to equal 3\n at /tmp/y/list.test.js:10:5' })
    const c = failureSignature({ command: 'npm test', output: '✖ removes items (1ms)\nAssertionError: expected 1 to equal 0' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('gives low-risk work one attempt and others the configured maximum', () => {
    expect(repairBudget('low', 3)).toBe(1)
    expect(repairBudget('high', 3)).toBe(3)
  })
  it('maps check commands to dimensions', () => {
    expect(checkDimension('npm run lint')).toBe('static')
    expect(checkDimension('npx tsc --noEmit')).toBe('static')
    expect(checkDimension('npm run build')).toBe('build')
    expect(checkDimension('npm test')).toBe('tests')
  })
})

describe('readiness', () => {
  const d = { id: 'd1', projectId: 'p', number: 1 } as Delivery
  const task = (p: Partial<Task>): Task =>
    ({ id: 't1', key: 'T1', title: 'x', kind: 'code', status: 'done', deliveryId: 'd1', checks: [], criteria: [], fixAttempts: 0, repairStop: null, files: [], qualityPlan: null, ...p }) as Task
  const passed = { command: 'npm test', status: 'passed' as const, ok: true, ms: 1, output: '', at: 1 }
  const audit = (findings: QualityReport['findings'] = []): QualityReport => ({ id: 'a', projectId: 'p', deliveryId: 'd1', kind: 'audit', status: 'done', findings, metrics: {}, shots: [], note: null, error: null, startedAt: 1, endedAt: 2 })

  it('is ready only when every applicable dimension has passing evidence', () => {
    const r = readiness(d, [task({ checks: [passed] })], [], [audit()], [], false)
    expect(r.verdict).toBe('ready')
    expect(r.dimensions.find((x) => x.dimension === 'tests')!.status).toBe('verified')
    expect(r.dimensions.find((x) => x.dimension === 'visual')!.status).toBe('na')
  })

  it('never calls unrun or blocked checks verified', () => {
    const r = readiness(d, [task({ checks: [{ ...passed, status: 'blocked', ok: false }] })], [], [], [], false)
    expect(r.verdict).toBe('unverified')
    expect(r.dimensions.find((x) => x.dimension === 'tests')!.status).toBe('blocked')
    expect(r.dimensions.find((x) => x.dimension === 'security')!.status).toBe('not_checked')
  })

  it('fails on a certain high-severity finding; a pattern match needs confirming; documented exceptions make it ready with exceptions', () => {
    const certain = { dimension: 'security' as const, severity: 'high' as const, rule: 'tls-off', message: 'TLS off', file: 'a.js', line: 1, width: null, count: 1 }
    expect(readiness(d, [task({ checks: [passed] })], [], [audit([certain])], [], false).verdict).toBe('not_ready')
    // a regex match on eval can be safe code: security is "to confirm", never silently verified, never a hard fail
    const pattern = { ...certain, rule: 'eval', message: 'eval' }
    const r = readiness(d, [task({ checks: [passed] })], [], [audit([pattern])], [], false)
    expect(r.verdict).toBe('unverified')
    expect(r.dimensions.find((x) => x.dimension === 'security')!.status).toBe('not_checked')
    const ok = readiness(d, [task({ checks: [passed] })], [], [audit([pattern])], [{ id: 'e', deliveryId: 'd1', dimension: 'security', note: 'Internal tool, input is trusted', createdAt: 1 }], false)
    expect(ok.verdict).toBe('ready_with_exceptions')
  })

  it('credits a later passing repair that names an unmet criterion', () => {
    const t2 = task({ id: 't2', key: 'T2', finishedAt: 1, checks: [passed], criteria: [{ criterion: 'Typing in search filters the list live', met: false, evidence: 'could not run it' }] })
    const t8 = task({ id: 't8', key: 'T8', finishedAt: 2, checks: [passed], description: 'Fix:\n- T2 criterion not met: Typing in search filters the list live' })
    const r = readiness(d, [t2, t8], [], [audit()], [], false)
    expect(r.dimensions.find((x) => x.dimension === 'requirements')!.status).toBe('verified')
  })

  it('requires a visual check for finished interface work when the project can be previewed', () => {
    const r = readiness(d, [task({ kind: 'design', checks: [passed] })], [], [audit()], [], true)
    expect(r.dimensions.find((x) => x.dimension === 'visual')!.status).toBe('not_checked')
    expect(r.verdict).toBe('unverified')
  })

  it('treats an unmet reported criterion as a failed requirement', () => {
    const r = readiness(d, [task({ checks: [passed], criteria: [{ criterion: 'Handles empty input', met: false, evidence: 'not done' }] })], [], [audit()], [], false)
    expect(r.dimensions.find((x) => x.dimension === 'requirements')!.status).toBe('failed')
  })
})

describe('visual findings', () => {
  const audit = { docWidth: 375, overflow: [], clipped: [], lowContrast: [], unlabeled: [], smallTargets: [], noAlt: [], broken: [], noLang: false, noTitle: false, noH1: false, headingSkip: null, blank: false, domNodes: 40, loadMs: 50, transferBytes: 1000, requests: 3 }
  it('reports sideways scrolling, unlabeled controls and console errors, deduplicated across widths', () => {
    const f = visualFindings([
      { width: 375, audit: { ...audit, docWidth: 420, unlabeled: ['button.x'] }, consoleErrors: ['Uncaught TypeError: x'], failedRequests: [] },
      { width: 768, audit: { ...audit, docWidth: 768, unlabeled: ['button.x'] }, consoleErrors: ['Uncaught TypeError: x'], failedRequests: [] }
    ])
    expect(f.map((x) => `${x.rule}:${x.count}`)).toEqual(expect.arrayContaining(['page-overflow:1', 'no-name:2', 'console-error:2']))
    expect(f.find((x) => x.rule === 'no-name')!.width).toBe(375)
  })
})
