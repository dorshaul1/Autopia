// Deterministic quality planning: before a task starts, decide which dimensions need evidence and how
// that evidence will be produced. Small changes get focused checks; risky or large ones get explicit
// acceptance criteria and a broader plan. No AI call is made here.

import type { QualityDimension, QualityPlan, QualityPlanItem, Task } from '@shared/types'
import { SECURITY_SIGNALS } from '../skills/workflows'

export const DIMENSION_LABEL: Record<QualityDimension, string> = {
  requirements: 'Requirements',
  runtime: 'Runs for real',
  tests: 'Tests',
  static: 'Lint & types',
  build: 'Build',
  security: 'Security',
  accessibility: 'Accessibility',
  visual: 'Layout checks',
  interaction: 'Really used',
  design: 'Design review',
  performance: 'Performance',
  review: 'Independent review'
}

const UI = /\.(css|scss|html|vue|svelte|tsx|jsx)$|(^|\/)(components?|pages|views|styles?)\//i
const CODE = /\.(m?[jt]sx?|cjs|py|go|rs|rb|java|kt|php|cs)$/i
const PERF_SIGNALS = /\b(perf\w*|slow|fast(er)?|latency|render(s|ing)? (too )?often|bundle size|memory|leak|optimi[sz]\w*|large (list|data)|pagination|virtuali[sz]\w*)\b/i

export interface PlanContext {
  task: Pick<Task, 'title' | 'description' | 'acceptance' | 'kind' | 'size' | 'files' | 'validation'>
  risk: 'low' | 'normal' | 'high'
  /** Checks the project itself declares (npm test, npm run lint …). */
  projectChecks: string[]
  hasTests: boolean
  /** The project can be previewed in a browser (static or dev script). */
  previewable: boolean
  reviewerAvailable: boolean
}

/** Splits free-form acceptance text into criteria; keeps the author's words. */
export function splitCriteria(acceptance: string): string[] {
  return acceptance
    .split(/\n|;|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((s) => s.length > 3)
    .slice(0, 6)
}

export function qualityPlan(c: PlanContext): QualityPlan {
  const text = `${c.task.title}\n${c.task.description}\n${c.task.acceptance}`
  const files = c.task.files
  const ui = c.task.kind === 'design' || files.some((f) => UI.test(f)) || /\b(ui|page|screen|layout|button|style|css|responsive|header|form|game\w*|hud|menu)\b/i.test(c.task.title)
  const code = c.task.kind !== 'design' || files.some((f) => CODE.test(f) && !UI.test(f))
  const security = SECURITY_SIGNALS.test(text)
  const perf = PERF_SIGNALS.test(text)
  const broad = c.risk === 'high' || c.task.size === 'l'
  const has = (re: RegExp) => c.projectChecks.find((x) => re.test(x))
  const testCmd = has(/\btest\b|pytest/)
  const lintCmd = has(/lint/)
  const typeCmd = has(/type-?check|tsc/)
  const buildCmd = has(/build/)

  const item = (dimension: QualityDimension, applies: boolean, how: string, reason: string): QualityPlanItem => ({ dimension, applies, how, reason })
  const items: QualityPlanItem[] = [
    item(
      'requirements',
      true,
      broad ? 'The agent reports each acceptance criterion with evidence; checks must pass for it to count as verified' : 'Covered by the task checks',
      broad ? 'Large or high-risk work needs explicit criteria' : 'Small change: the checks are the criteria'
    ),
    item(
      'tests',
      code && (!!testCmd || c.task.validation.length > 0),
      testCmd ?? c.task.validation[0] ?? 'No test runner',
      !code ? 'No logic change' : testCmd || c.task.validation.length ? 'The project has tests that cover this' : 'The project declares no test command'
    ),
    item(
      'static',
      code && !!(lintCmd || typeCmd) && (broad || c.task.size !== 's'),
      [lintCmd, typeCmd].filter(Boolean).join(', ') || 'No lint or type-check script',
      !(lintCmd || typeCmd) ? 'Not configured in this project' : broad || c.task.size !== 's' ? 'Change is large enough to warrant it' : 'Small change: tests are enough'
    ),
    item('build', !!buildCmd && broad, buildCmd ?? 'No build script', !buildCmd ? 'No build script' : broad ? 'Broad change: confirm it still builds' : 'Built before delivery only when needed'),
    item(
      'security',
      security || code,
      security ? 'Static security audit of changed files, security pass in the agent method, reviewer subagent' : 'Static security audit of changed files',
      security ? 'Touches security-sensitive areas' : 'Every code change gets the cheap static audit'
    ),
    item('accessibility', ui && c.previewable, 'Automated audit of the rendered page (labels, alt text, contrast, tap targets)', ui ? (c.previewable ? 'User-facing change' : 'No browser preview for this project') : 'No user-facing change'),
    item('visual', ui && c.previewable, 'Real screenshots at 375, 768 and 1280 px, then really using it: every control, link and form on the pages it reaches', ui ? (c.previewable ? 'User-facing change' : 'No browser preview for this project') : 'No user-facing change'),
    item(
      'performance',
      perf && c.previewable,
      'Measured page load, DOM size and transfer size from the running preview',
      perf ? (c.previewable ? 'The task is about performance' : 'Nothing to measure without a preview') : 'No evidence of a performance concern; not optimised speculatively'
    ),
    item(
      'review',
      c.risk === 'high' && c.reviewerAvailable,
      'Read-only reviewer subagent, used when the implementer decides it is worth it',
      c.risk === 'high' ? (c.reviewerAvailable ? 'High risk' : 'Reviewer disabled') : 'Not worth the extra session for this risk level'
    )
  ]
  return { scope: broad ? 'broad' : 'focused', risk: c.risk, items, criteria: broad ? splitCriteria(c.task.acceptance) : [] }
}

/** The short instruction block for the agent: only what applies, so trivial tasks stay short. */
export function planPrompt(plan: QualityPlan): string {
  if (plan.scope === 'focused') return ''
  const lines = ['Quality plan (broad: high risk or large):']
  for (const i of plan.items.filter((x) => x.applies && x.dimension !== 'requirements')) lines.push(`- ${DIMENSION_LABEL[i.dimension]}: ${i.how}`)
  if (plan.criteria.length) {
    lines.push('Acceptance criteria. In your structured result, report each one in `criteria` with met true/false and the concrete evidence (a command you ran, a file and line):')
    plan.criteria.forEach((c, n) => lines.push(`${n + 1}. ${c}`))
  }
  return lines.join('\n')
}
