// Turns raw audit and visual-QA findings into evidence-graded, prioritised findings: how certain each
// one is, what to do about it, whether it belongs to the work under review, and which ones are safe to
// correct autonomously. Pure and deterministic (unit-tested); no AI.

import type { FindingCertainty, QualityFinding } from '@shared/types'

interface RuleMeta {
  /** How certain a finding of this rule is when the engine did not say otherwise. */
  certainty: FindingCertainty
  fix: string
}

// Static audit rules are pattern matches on added lines: they can be safe in context (suspected).
// Visual rules are measured on the rendered page (verified). Style hints are advice.
const META: Record<string, RuleMeta> = {
  eval: { certainty: 'suspected', fix: 'Replace eval / new Function with explicit parsing or a lookup table.' },
  'html-injection': { certainty: 'suspected', fix: 'Set text with textContent, or escape every value before building HTML.' },
  'react-html': { certainty: 'suspected', fix: 'Sanitise the HTML (e.g. DOMPurify) or render it as elements.' },
  'shell-injection': { certainty: 'suspected', fix: 'Pass arguments as an array (execFile/spawn without a shell).' },
  'sql-concat': { certainty: 'suspected', fix: 'Use placeholders / prepared statements for every value.' },
  'tls-off': { certainty: 'verified', fix: 'Remove the override; trust the right CA instead.' },
  'path-traversal': { certainty: 'suspected', fix: 'Resolve the path and reject anything outside the allowed folder.' },
  'cors-any': { certainty: 'suspected', fix: 'Allow only the origins that need access.' },
  'weak-random': { certainty: 'suspected', fix: 'Use crypto.randomUUID() or crypto.getRandomValues().' },
  'insecure-http': { certainty: 'suspected', fix: 'Use https:// for remote hosts.' },
  pickle: { certainty: 'suspected', fix: 'Use JSON or yaml.safe_load for untrusted data.' },
  'secret-file': { certainty: 'verified', fix: 'Remove the file from the change, add it to .gitignore and rotate its values.' },
  'hardcoded-secret': { certainty: 'suspected', fix: 'Read the value from the environment; rotate it if it was real.' },
  'empty-catch': { certainty: 'advice', fix: 'Handle or report the error instead of ignoring it.' },
  'bare-except': { certainty: 'advice', fix: 'Catch the specific exception you expect.' },
  'interval-leak': { certainty: 'suspected', fix: 'Clear the interval when it is no longer needed.' },
  'listener-leak': { certainty: 'suspected', fix: 'Remove the listener in the cleanup / unmount path.' },
  'deep-clone': { certainty: 'advice', fix: 'Use structuredClone().' },
  'large-file': { certainty: 'advice', fix: 'Split the file by responsibility.' },
  'blank-page': { certainty: 'verified', fix: 'Check the console errors and failed requests for why nothing rendered.' },
  'page-overflow': { certainty: 'verified', fix: 'Let the widest element shrink or wrap (max-width: 100%, flex-wrap, minmax() columns), or scroll it inside its own container.' },
  'element-overflow': { certainty: 'verified', fix: 'Constrain the element to its container (max-width: 100%, wrapping, or overflow-x: auto on a wrapper).' },
  clipped: { certainty: 'suspected', fix: 'Let the container grow with its content, or truncate deliberately with an ellipsis and a full-text title.' },
  contrast: { certainty: 'verified', fix: 'Darken or lighten the text (or its background) until it reaches the required ratio.' },
  'no-name': { certainty: 'verified', fix: 'Give the control a visible <label for>, or an aria-label when it is icon-only.' },
  'tap-target': { certainty: 'verified', fix: 'Make the control at least 24×24 px (44×44 px is comfortable on touch).' },
  'img-alt': { certainty: 'verified', fix: 'Add alt text that says what the image shows, or alt="" if it is decorative.' },
  'broken-image': { certainty: 'verified', fix: 'Fix the image path or ship the missing file.' },
  'html-lang': { certainty: 'verified', fix: 'Add lang="…" to <html>.' },
  title: { certainty: 'verified', fix: 'Add a descriptive <title>.' },
  'no-h1': { certainty: 'advice', fix: 'Start the page with one <h1>.' },
  'heading-skip': { certainty: 'advice', fix: 'Use heading levels in order.' },
  'console-error': { certainty: 'verified', fix: 'Fix the error shown in the console.' },
  'failed-request': { certainty: 'verified', fix: 'Fix the URL or ship the missing resource.' },
  'broken-import': { certainty: 'verified', fix: 'Restore the export, or update every importer to the new name (and run the project checks).' },
  'external-resource': { certainty: 'suspected', fix: 'Nothing to fix here: check it in a normal browser, or host the asset locally.' }
}

const SEVERITY = { high: 100, medium: 40, low: 10, info: 2 }
const CERTAINTY: Record<FindingCertainty, number> = { verified: 1, suspected: 0.5, advice: 0.2 }

const keyOf = (f: QualityFinding) => `${f.rule}|${f.file ?? ''}`

/**
 * Grades findings: certainty (an explicit one from the engine wins), suggested fix, scope and priority,
 * then merges duplicates and sorts by priority. `previous` holds the findings of the last report before
 * this work: anything already there is pre-existing (out of scope); with no earlier report, `scope`
 * decides (true when the work could have caused it).
 */
export function classifyFindings(findings: QualityFinding[], previous: QualityFinding[] | null, scope: boolean | null): QualityFinding[] {
  const before = new Set((previous ?? []).map(keyOf))
  const out = new Map<string, QualityFinding>()
  for (const f of findings) {
    const meta = META[f.rule]
    const certainty = f.certainty ?? meta?.certainty ?? 'suspected'
    const inScope = previous ? !before.has(keyOf(f)) : scope
    const priority = Math.round(SEVERITY[f.severity] * CERTAINTY[certainty] * (inScope === false ? 0.5 : 1) + Math.min(f.count, 5))
    const graded: QualityFinding = { ...f, certainty, fix: f.fix ?? meta?.fix ?? null, evidence: f.evidence ?? null, inScope, priority }
    const prev = out.get(keyOf(f))
    if (!prev || prev.priority! < priority) out.set(keyOf(f), prev ? { ...graded, count: prev.count + f.count } : graded)
    else prev.count += f.count
  }
  return [...out.values()].sort((a, b) => b.priority! - a.priority! || a.rule.localeCompare(b.rule))
}

/**
 * A finding from a report made before findings were graded, re-read under today's rules: its contrast
 * reading never recorded whether the background was measured or assumed (unconfirmed), and a failed
 * request to an external host was the QA sandbox, not the product.
 */
export function regradeLegacy(f: QualityFinding): QualityFinding {
  if (f.certainty) return f
  if (f.rule === 'contrast') return { ...f, certainty: 'suspected' }
  const ext = f.rule === 'failed-request' ? /https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])([^/\s:]+)/.exec(f.message) : null
  if (ext) return { ...f, rule: 'external-resource', severity: 'info', certainty: 'suspected', message: `Not loaded during QA (external hosts are not contacted): ${ext[1]}` }
  return f
}

/** Defects safe to correct without asking: measured, serious enough, and caused by this work. */
export function correctable(findings: QualityFinding[]): QualityFinding[] {
  return findings.filter((f) => f.certainty === 'verified' && (f.severity === 'high' || f.severity === 'medium') && f.inScope === true)
}

/**
 * At most `max` improvement suggestions: real issues outside this work's scope (never fixed
 * automatically), then advice. Suspicions are not recommendations; they stay in the report.
 */
export function recommendations(findings: QualityFinding[], max = 3): QualityFinding[] {
  const outside = findings.filter((f) => f.inScope === false && f.certainty === 'verified' && f.severity !== 'info')
  const advice = findings.filter((f) => f.certainty === 'advice')
  return [...outside, ...advice].slice(0, max)
}

/** Stable identity of a finding across reports (for "fixed", "still there" and "introduced"). */
export function findingKeys(findings: QualityFinding[]): string[] {
  return [...new Set(findings.map(keyOf))]
}

/**
 * Outcome of one autonomous correction: what it fixed, what remains, and what it introduced (a
 * regression the correction caused). Compared by finding identity on the same kind of evidence.
 */
export function correctionOutcome(targeted: string[], after: QualityFinding[], beforeAll: string[]): { fixed: string[]; remaining: string[]; introduced: string[] } {
  const now = new Set(findingKeys(after.filter((f) => f.certainty === 'verified' && f.severity !== 'info' && f.severity !== 'low')))
  const known = new Set(beforeAll)
  return {
    fixed: targeted.filter((k) => !now.has(k)),
    remaining: targeted.filter((k) => now.has(k)),
    introduced: [...now].filter((k) => !known.has(k))
  }
}

export const describeKey = (k: string) => {
  const [rule, file] = k.split('|')
  return file ? `${rule} (${file})` : rule
}
