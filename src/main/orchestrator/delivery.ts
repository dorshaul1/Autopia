// Pure helpers for the delivery lifecycle: what was delivered, what is known to be missing, which
// checks a project supports, and how a revision is scoped. No I/O except reading package files.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHECK_STATUS_LABEL, baseCheck, shortCommand } from '@shared/checks'
import type { DeliveryVerification } from '@shared/delivery'
import { clip } from '@shared/friendlyError'
import type { Delivery, Project, Task } from '@shared/types'

/** One line per finished task, in the agents' own words (their structured summaries). */
export function deliverySummary(tasks: Task[]): string {
  return tasks
    .filter((t) => t.status === 'done')
    .map((t) => `${t.key} ${t.title}: ${clip((t.resultSummary ?? 'done').split('\n')[0], 600)}`)
    .join('\n')
}

/** Everything a reviewer should know is not fully done or verified. Nothing here is softened. */
/** A check a teammate couldn't run stops being a limitation once Autopia ran it for real and it passed. */
export function settledByRun(limits: string[], v: Pick<DeliveryVerification, 'steps'> | null | undefined): string[] {
  const passed = new Set((v?.steps ?? []).filter((s) => s.status === 'passed' && s.command).map((s) => baseCheck(s.command!)))
  return limits.filter((l) => {
    const named = /`([^`]+)`/.exec(l)?.[1]
    return !(named && /declined|blocked|not run|could not run/i.test(l) && passed.has(baseCheck(named.replace(/…$/, ''))))
  })
}

export function deliveryLimitations(tasks: Task[]): string[] {
  const out: string[] = []
  for (const t of tasks) {
    if (t.status === 'cancelled') out.push(`${t.key} ${t.title} was skipped.`)
    if (t.status === 'failed' || t.status === 'interrupted') out.push(`${t.key} ${t.title} did not finish: ${(t.lastError ?? '').split('\n')[0].slice(0, 160)}`)
    if (t.status !== 'done') continue
    const bad = t.checks.filter((c) => c.status !== 'passed')
    for (const c of bad) out.push(`${t.key}: \`${shortCommand(c.command)}\` ${CHECK_STATUS_LABEL[c.status]}${c.status === 'failed' ? '' : ' — accepted without this verification'}.`)
    if (!t.checks.length && t.kind !== 'design') out.push(`${t.key}: no automated checks were run for this task.`)
    if (t.kind === 'design') out.push(`${t.key} changed the interface; Autopia did not inspect it visually. Check it in Preview.`)
  }
  return out
}

/** Checks the project itself declares (package scripts, pytest), cheapest first. */
export function projectChecks(project: Project): string[] {
  const out: string[] = []
  const pkgPath = join(project.path, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const scripts: Record<string, string> = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}
      for (const s of ['lint', 'typecheck', 'type-check', 'test', 'build']) {
        const cmd = scripts[s]
        if (!cmd || /no test specified/.test(cmd)) continue
        out.push(s === 'test' ? 'npm test' : `npm run ${s}`)
      }
    } catch {
      // unreadable package.json: no declared checks
    }
  }
  if (existsSync(join(project.path, 'pytest.ini')) || existsSync(join(project.path, 'tests'))) {
    if (existsSync(join(project.path, 'pyproject.toml')) || existsSync(join(project.path, 'pytest.ini'))) out.push('python3 -m pytest -q')
  }
  return out
}

export interface RevisionScope {
  title: string
  description: string
  files: string[]
  validation: string[]
}

/**
 * The smallest useful scope for a follow-up: the founder's words, what the previous delivery did,
 * the files it touched, and the checks that already guard them. No repository re-exploration.
 */
export function revisionScope(request: string, parent: Delivery | null, parentTasks: Task[], changed: string[], screenshot: string | null, referenced: Task | null): RevisionScope {
  const first = request.split(/(?<=[.!?])\s|\n/)[0].trim()
  const title = first.length > 70 ? `${first.slice(0, 67)}…` : first || 'Revision'
  const lines: string[] = []
  if (parent) {
    lines.push(`This is a revision of delivery #${parent.number} ("${parent.request.split('\n')[0].slice(0, 120)}").`)
    if (parent.summary) lines.push('', 'What that delivery implemented:', parent.summary.slice(0, 900))
  }
  if (referenced) lines.push('', `The founder refers to ${referenced.key} "${referenced.title}": ${(referenced.resultSummary ?? '').slice(0, 400)}`)
  if (changed.length) lines.push('', `Files involved: ${changed.slice(0, 12).join(', ')}`)
  if (screenshot) lines.push('', `The founder attached a screenshot of the area they mean: ${screenshot} (in your working directory). Read it before changing anything.`)
  lines.push('', "The founder's request:", request.trim(), '', 'Change only what the request needs; keep everything else as it is.')
  const validation = [...new Set(parentTasks.flatMap((t) => t.validation))].slice(0, 4)
  return { title, description: lines.join('\n'), files: changed.slice(0, 12), validation }
}

export interface UndoContext {
  gitEnabled: boolean
  status: Delivery['status']
  hasCommits: boolean
  alreadyUndone: boolean
  /** The team is planning or working on this project. */
  busy: boolean
  /** The project is on its base branch. */
  onBase: boolean
  merges: number
  /** Files this result changed. */
  files: string[]
  /** Your uncommitted changes in the project folder. */
  dirty: string[]
  /** Later results (not undone) and the files they changed. */
  later: { number: number; files: string[] }[]
}

/**
 * Why a discarded result cannot be undone safely right now, or null when it can. Undo only ever adds
 * revert commits; it never resets, never touches your uncommitted work, and never undoes part of a
 * later result.
 */
export function undoBlocker(c: UndoContext): string | null {
  if (!c.gitEnabled) return "This project isn't a git repository, so its changes can't be reverted safely."
  if (c.status !== 'rejected') return 'Only a result you discarded can be undone.'
  if (c.alreadyUndone) return 'Its changes were already undone.'
  if (!c.hasCommits) return 'This result has no recorded commits to revert.'
  if (c.busy) return 'The team is working on this project. Undo it once the work has finished.'
  if (!c.onBase) return "The project isn't on its main branch. Switch back to it first."
  if (!c.merges) return 'Nothing from this result was merged, so there is nothing to undo.'
  const mine = c.dirty.filter((f) => c.files.includes(f))
  if (mine.length) return `You have uncommitted changes in ${mine.slice(0, 4).join(', ')}. Commit or stash them first; Autopia never overwrites your work.`
  const clash = c.later.find((l) => l.files.some((f) => c.files.includes(f)))
  if (clash) return `Result #${clash.number}, made after this one, also changed ${clash.files.filter((f) => c.files.includes(f)).slice(0, 3).join(', ')}. Undoing this one would undo parts of it too.`
  return null
}
