import { describe, expect, it } from 'vitest'
import { finding, qualityWorld } from '../benchmark/harness/qualityWorld'
import { Memory } from '../src/main/memory/memory'
import { classifyFindings, correctable, correctionOutcome, recommendations } from '../src/main/quality/findings'
import { contrastRatio, resolveContrast, visualFindings, type PageAudit } from '../src/main/quality/visual'

const SAFE = 'export const add = (a, b) => a + b\n'
const audit = (p: Partial<PageAudit> = {}): PageAudit => ({
  docWidth: 375, overflow: [], clipped: [], lowContrast: [], unlabeled: [], smallTargets: [], noAlt: [], broken: [],
  noLang: false, noTitle: false, noH1: false, headingSkip: null, blank: false, domNodes: 10, loadMs: 5, transferBytes: 0, requests: 1, ...p
})

describe('finding classification and priority', () => {
  it('grades measured defects as verified, pattern matches as suspected, style hints as advice; explicit certainty wins', () => {
    const g = classifyFindings(
      [
        finding({ rule: 'no-name', dimension: 'accessibility' }),
        finding({ rule: 'html-injection', dimension: 'security', file: 'app.js' }),
        finding({ rule: 'heading-skip', dimension: 'accessibility', severity: 'info' }),
        finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', certainty: 'suspected' })
      ],
      null,
      true
    )
    const by = (r: string) => g.find((f) => f.rule === r)!
    expect(by('no-name').certainty).toBe('verified')
    expect(by('html-injection')).toMatchObject({ certainty: 'suspected', fix: expect.stringContaining('textContent') })
    expect(by('heading-skip').certainty).toBe('advice')
    expect(by('contrast').certainty).toBe('suspected')
  })

  it('ranks by impact × certainty × scope, and merges duplicates', () => {
    const g = classifyFindings(
      [
        finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'p' }),
        finding({ rule: 'html-injection', dimension: 'security', file: 'app.js' }),
        finding({ rule: 'no-name', dimension: 'accessibility', file: 'button' }),
        finding({ rule: 'no-name', dimension: 'accessibility', file: 'button', width: 768 })
      ],
      null,
      true
    )
    expect(g.map((f) => f.rule)).toEqual(['no-name', 'html-injection', 'contrast'])
    expect(g[0].count).toBe(2)
  })
})

describe('visual QA evidence', () => {
  it('reports one overflow root cause, with the offending element as evidence', () => {
    const f = visualFindings([
      { width: 375, audit: audit({ docWidth: 936, overflow: [{ sel: 'div.plans', by: 561 }] }), consoleErrors: [], failedRequests: [] },
      { width: 768, audit: audit({ docWidth: 936, overflow: [{ sel: 'div.plans', by: 168 }] }), consoleErrors: [], failedRequests: [] },
      { width: 1280, audit: audit({ docWidth: 1280 }), consoleErrors: [], failedRequests: [] }
    ])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule: 'page-overflow', file: 'div.plans', width: 375, message: 'The page scrolls sideways at 375 and 768px.', evidence: 'Wider than the viewport: div.plans (+561px)' })
  })

  it('does not report sandbox-blocked external resources as product defects', () => {
    const f = visualFindings([{ width: 375, audit: audit(), consoleErrors: [], failedRequests: ['net::ERR_CACHE_MISS https://fonts.gstatic.com/x.woff2', '404 /app.css'] }], 'http://127.0.0.1:5000')
    expect(f.find((x) => x.rule === 'external-resource')).toMatchObject({ severity: 'info', certainty: 'suspected' })
    expect(f.find((x) => x.rule === 'failed-request')?.message).toBe('Request failed: 404 /app.css')
  })

  it('re-checks contrast on the real pixels when the background was only assumed', () => {
    // a 10×10 frame painted rgb(61,138,46) (mid green) with white text measured "against white"
    const bitmap = Buffer.alloc(10 * 10 * 4)
    for (let i = 0; i < 100; i++) bitmap.set([46, 138, 61, 255], i * 4) // BGRA
    const white = { sel: 'h1', ratio: 1.03, need: 4.5, assumed: true, fg: [255, 255, 255], rect: [0, 0, 10, 10] }
    const darkGreen = { ...white, sel: 'p', fg: [20, 60, 20] }
    const big = { ...white, sel: 'span.temp', need: 3 }
    const out = resolveContrast([white, darkGreen, big], bitmap, { width: 10, height: 10 }, 10)
    expect(out.map((c) => c.sel)).toEqual(['h1', 'p'])
    expect(out[0]).toMatchObject({ measured: true, ratio: Math.round(contrastRatio([255, 255, 255], [61, 138, 46]) * 100) / 100 })
    // an issue measured against a known background is untouched
    expect(resolveContrast([{ sel: 'x', ratio: 2, need: 4.5 }], bitmap, { width: 10, height: 10 }, 10)).toEqual([{ sel: 'x', ratio: 2, need: 4.5 }])
  })
})

describe('correction boundaries and recommendations', () => {
  it('corrects only verified, serious defects this work introduced', () => {
    const before = [finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'footer p' })]
    const now = classifyFindings(
      [
        finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'footer p' }),
        finding({ rule: 'no-name', dimension: 'accessibility', file: 'button.icon' }),
        finding({ rule: 'html-injection', dimension: 'security', file: 'app.js' }),
        finding({ rule: 'tap-target', dimension: 'accessibility', severity: 'low', file: 'input' })
      ],
      before,
      true
    )
    expect(correctable(now).map((f) => f.rule)).toEqual(['no-name'])
    expect(recommendations(now).map((f) => f.rule)).toEqual(['contrast'])
  })

  it('keeps at most three suggestions and never suggests a suspicion', () => {
    const many = classifyFindings(
      ['no-h1', 'heading-skip', 'deep-clone', 'large-file', 'empty-catch'].map((rule, i) => finding({ rule, severity: 'info', file: `f${i}` })).concat(finding({ rule: 'eval', dimension: 'security', file: 'a.js' })),
      null,
      true
    )
    const r = recommendations(many)
    expect(r).toHaveLength(3)
    expect(r.every((f) => f.certainty === 'advice')).toBe(true)
  })

  it('tells what a correction fixed, left and introduced', () => {
    const after = classifyFindings([finding({ rule: 'no-name', file: 'b' }), finding({ rule: 'page-overflow' })], null, true)
    expect(correctionOutcome(['no-name|a', 'no-name|b'], after, ['no-name|a', 'no-name|b', 'contrast|p'])).toEqual({ fixed: ['no-name|a'], remaining: ['no-name|b'], introduced: ['page-overflow|'] })
  })
})

describe('review: one bounded correction, then an honest report', () => {
  it('sends verified defects back once, never again, and reports what remains', async () => {
    const w = qualityWorld()
    try {
      const d = w.delivery()
      w.task(d, { files: { 'lib/add.js': SAFE, '.env': 'API_KEY=abc' }, checks: [{ command: 'npm test', status: 'passed' }] })
      for (let i = 0; i < 3; i++) await w.engine.onReview(w.project, w.repo.delivery(d.id))
      expect(w.corrections).toHaveLength(1)
      expect(w.corrections[0].map((f) => f.rule)).toEqual(['secret-file'])
      const c = w.engine.readiness(w.project.id, d.id).completion
      expect(c.status).toBe('failed')
      expect(c.limitations).toContain('The automatic fix did not resolve: secret-file (.env)')
    } finally {
      w.close()
    }
  })

  it('does not correct when it may not run now (paused, over budget, no Claude Code), and says nothing was attempted', async () => {
    const w = qualityWorld()
    try {
      w.setCorrectionAllowed(false)
      const d = w.delivery()
      w.task(d, { files: { '.env': 'API_KEY=abc' }, checks: [{ command: 'npm test', status: 'passed' }] })
      await w.engine.onReview(w.project, w.repo.delivery(d.id))
      expect(w.engine.correction(d.id)).toBeNull()
      expect(w.engine.readiness(w.project.id, d.id).completion.correction).toBeNull()
    } finally {
      w.close()
    }
  })

  it('never auto-corrects a suspicion (a regex match can be safe code)', async () => {
    const w = qualityWorld()
    try {
      const d = w.delivery()
      w.task(d, { files: { 'app.js': 'el.innerHTML = template(user)\n' }, checks: [{ command: 'npm test', status: 'passed' }] })
      await w.engine.onReview(w.project, w.repo.delivery(d.id))
      expect(w.corrections).toHaveLength(0)
      const r = w.engine.readiness(w.project.id, d.id)
      expect(r.dimensions.find((x) => x.dimension === 'security')?.status).toBe('not_checked')
      expect(r.completion.status).toBe('limited')
      expect(r.completion.limitations.some((l) => l.startsWith('To confirm: HTML built from a non-literal value'))).toBe(true)
    } finally {
      w.close()
    }
  })
})

describe('completion status', () => {
  const status = async (setup: (w: ReturnType<typeof qualityWorld>, d: ReturnType<ReturnType<typeof qualityWorld>['delivery']>) => void) => {
    const w = qualityWorld()
    try {
      const d = w.delivery()
      setup(w, d)
      await w.engine.audit(w.project, d.id)
      return w.engine.readiness(w.project.id, d.id).completion
    } finally {
      w.close()
    }
  }
  it('verified only when every applicable check ran and passed', async () => {
    expect((await status((w, d) => w.task(d, { files: { 'a.js': SAFE }, checks: [{ status: 'passed' }] }))).status).toBe('verified')
  })
  it('failed when a check failed', async () => {
    expect((await status((w, d) => w.task(d, { files: { 'a.js': SAFE }, checks: [{ status: 'failed', ok: false }] }))).status).toBe('failed')
  })
  it('partial when a requirement is not met or a task did not finish', async () => {
    expect((await status((w, d) => w.task(d, { files: { 'a.js': SAFE }, checks: [{ status: 'passed' }], criteria: [{ criterion: 'search', met: false, evidence: '' }] }))).status).toBe('partial')
    expect((await status((w, d) => (w.task(d, { files: { 'a.js': SAFE }, checks: [{ status: 'passed' }] }), w.task(d, { status: 'failed' })))).status).toBe('partial')
  })
  it('blocked when a check could not run because of policy or a declined permission', async () => {
    expect((await status((w, d) => w.task(d, { files: { 'a.js': SAFE }, checks: [{ status: 'blocked', ok: false }] }))).status).toBe('blocked')
  })
  it('limited, with the reason, when something was not verified', async () => {
    const c = await status((w, d) => w.task(d, { files: { 'a.js': SAFE } }))
    expect(c.status).toBe('limited')
    expect(c.unverified).toContain('Tests: not checked')
  })
})

describe('learning from quality outcomes', () => {
  it('turns a defect measured in two results into a lesson; one occurrence or unconfirmed findings never do', () => {
    const w = qualityWorld()
    try {
      const memory = new Memory(w.repo)
      const contrast = finding({ rule: 'contrast', dimension: 'accessibility', severity: 'medium', file: 'a.btn-primary', certainty: 'verified', fix: 'Darken the text.' })
      const d1 = w.delivery()
      w.visualReport(d1, [contrast, finding({ rule: 'clipped', severity: 'low', certainty: 'suspected' })])
      expect(memory.lessons(w.project.id).filter((l) => l.topic.startsWith('lesson:quality:'))).toHaveLength(0)
      const d2 = w.delivery()
      w.visualReport(d2, [contrast])
      // an ungraded (older) report never counts
      w.visualReport(w.delivery(), [finding({ rule: 'no-name', file: 'x' })])
      const lessons = memory.lessons(w.project.id).filter((l) => l.topic.startsWith('lesson:quality:'))
      expect(lessons).toHaveLength(1)
      expect(lessons[0]).toMatchObject({ title: 'Review QA found "contrast" in 2 results', audience: 'agents' })
      expect(lessons[0].text).toContain('Fix: Darken the text.')
    } finally {
      w.close()
    }
  })
})

describe('older reports', () => {
  it('grades contrast from before background measurement as unconfirmed, never as a verified failure', async () => {
    const { readiness } = await import('../src/main/quality/readiness')
    const w = qualityWorld()
    try {
      const d = w.delivery()
      w.task(d, { files: { 'index.html': '<p>x</p>' }, checks: [{ status: 'passed' }], kind: 'design' })
      const old = { dimension: 'accessibility' as const, severity: 'medium' as const, rule: 'contrast', message: 'Text contrast 1.03:1 (needs 4.5:1).', file: 'h1', line: null, width: 375, count: 1 }
      w.visualReport(d, [old])
      const r = readiness(w.repo.delivery(d.id), w.repo.tasks(w.project.id), [], w.repo.qualityReports(w.project.id), [], true)
      expect(r.findings[0].certainty).toBe('suspected')
      expect(r.completion.limitations.some((l) => l.includes('1.03'))).toBe(false)
    } finally {
      w.close()
    }
  })
})

describe('legacy regrading', () => {
  it('turns an old sandbox-blocked font request into an external-resource note', async () => {
    const { regradeLegacy } = await import('../src/main/quality/findings')
    const old = finding({ rule: 'failed-request', severity: 'medium', message: 'Request failed: net::ERR_CACHE_MISS https://fonts.gstatic.com/s/inter/x.woff2' })
    expect(regradeLegacy(old)).toMatchObject({ rule: 'external-resource', severity: 'info', certainty: 'suspected', message: 'Not loaded during QA (external hosts are not contacted): fonts.gstatic.com' })
    const local = finding({ rule: 'failed-request', severity: 'medium', message: 'Request failed: 404 /app.css' })
    expect(regradeLegacy(local)).toBe(local)
  })
})
