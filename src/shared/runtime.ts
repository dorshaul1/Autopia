// What is known about the app actually running, from the real preview and the real project folder.
// Tests passing in a task's temporary worktree are not this evidence: the result only counts as working
// if the folder you run it from does.

import type { DeliveryVerification } from './delivery'
import type { PreviewInfo } from './types'

export interface DependencyState {
  declared: number
  /** node_modules exists at all (it can exist and still be missing packages). */
  installedFolder: boolean
  missing: string[]
  outdated: string[]
  ok: boolean
}

export interface RuntimeEvidence {
  status: 'verified' | 'failed' | 'not_checked' | 'blocked'
  note: string
  /** Each step of a recorded verification, as evidence. */
  details?: string[]
  /** Checks it ran in the project folder: they count for their own dimensions too. */
  checks?: { command: string; status: 'passed' | 'failed' | 'blocked' }[]
  /** Nothing is wrong, the app just hasn't run from the project folder: visual QA on it also proves it did. */
  notRunYet?: boolean
}

const some = (names: string[]) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`

/** Why the project folder can't run yet, in plain words; null when it can. */
export function dependencyProblem(d: DependencyState | null): string | null {
  if (!d || d.ok) return null
  if (!d.installedFolder) return 'Dependencies aren’t installed in the project folder yet (teammates install them only in their temporary working copies).'
  if (d.missing.length) return `The project folder is missing ${some(d.missing)}: its installed dependencies are older than package.json, or an install was interrupted.`
  return `The project folder has outdated versions of ${some(d.outdated)}.`
}

/** null when there's nothing to run: no preview, or a static site Autopia serves itself. */
export function runtimeEvidence(preview: Pick<PreviewInfo, 'kind' | 'status' | 'error' | 'url'>, deps: DependencyState | null, verification: DeliveryVerification | null = null): RuntimeEvidence | null {
  // what is happening right now outranks any record
  if (preview.kind !== 'none' && (preview.status === 'crashed' || (preview.status === 'stopped' && preview.error))) return { status: 'failed', note: `The preview crashed: ${preview.error ?? 'the dev server stopped'}` }
  if (verification && verification.state !== 'verifying' && verification.state !== 'fixing' && verification.steps.length) {
    const steps = verification.steps
    const base = {
      details: steps.map((s) => `${s.label}: ${s.status === 'passed' ? s.detail : `${s.status}. ${s.detail}`}`),
      checks: steps.filter((s) => s.command && ['typecheck', 'build', 'test'].includes(s.id) && s.status !== 'skipped').map((s) => ({ command: s.command!, status: s.status as 'passed' | 'failed' | 'blocked' }))
    }
    if (verification.state === 'verified') return { ...base, status: 'verified', note: `Run for real in the project folder: ${steps.filter((s) => s.status === 'passed').map((s) => s.label.toLowerCase()).join(', ')}.` }
    return { ...base, status: verification.state === 'blocked' ? 'blocked' : 'failed', note: verification.reason ?? 'It didn’t pass when run for real.' }
  }
  if (preview.kind === 'none') return null
  if (preview.status === 'running') return { status: 'verified', note: `The app is running from the project folder at ${preview.url}` }
  if (preview.kind === 'script') {
    const problem = dependencyProblem(deps)
    if (problem) return { status: 'not_checked', note: `${problem} Start the preview to install them and run the app.` }
    return { status: 'not_checked', note: 'The app hasn’t been run from the project folder yet: checks passed in a temporary working copy. Start the preview to confirm it runs.', notRunYet: true }
  }
  return null
}

/** The live preview overrides any "ready" label: a crashed app is never presented as working. */
export function previewCrashed(preview: Pick<PreviewInfo, 'status' | 'error'> | null | undefined): boolean {
  return !!preview && (preview.status === 'crashed' || (preview.status === 'stopped' && !!preview.error))
}
