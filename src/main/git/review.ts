// Read-only git inspection for the review workspace: diffs, commits, attribution, uncommitted work.
// Nothing here writes to the repository.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChangeSet, DiffFile, DiffHunk, Task } from '@shared/types'
import { resolveLoginEnv } from '../claude/cli'

const execFileAsync = promisify(execFile)
const MAX_LINES_PER_FILE = 1500

async function git(cwd: string, args: string[]): Promise<string> {
  const env = await resolveLoginEnv()
  const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/** Parses `git diff` unified output (with --no-color) into files and hunks. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let lines = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/)
      file = { path: m?.[2] ?? raw.slice(11), oldPath: null, status: 'M', additions: 0, deletions: 0, binary: false, truncated: false, hunks: [] }
      files.push(file)
      hunk = null
      lines = 0
      continue
    }
    if (!file) continue
    if (raw.startsWith('new file mode')) file.status = 'A'
    else if (raw.startsWith('deleted file mode')) file.status = 'D'
    else if (raw.startsWith('rename from ')) {
      file.status = 'R'
      file.oldPath = raw.slice(12)
    } else if (raw.startsWith('Binary files ')) file.binary = true
    else if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
      oldNo = Number(m?.[1] ?? 0)
      newNo = Number(m?.[2] ?? 0)
      hunk = { header: raw, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk && !raw.startsWith('\\')) {
      const t = raw[0]
      if (t !== '+' && t !== '-' && t !== ' ') continue
      if (raw.startsWith('+++') || raw.startsWith('---')) {
        if (!hunk.lines.length) continue
      }
      if (t === '+') file.additions++
      if (t === '-') file.deletions++
      if (++lines > MAX_LINES_PER_FILE) {
        file.truncated = true
        continue
      }
      hunk.lines.push({ t, text: raw.slice(1), oldNo: t === '+' ? null : oldNo, newNo: t === '-' ? null : newNo })
      if (t !== '+') oldNo++
      if (t !== '-') newNo++
    }
  }
  return files
}

/**
 * Changes between two commits, with per-task attribution taken from Autopia's own `Merge Tn:` merge
 * commits (first-parent history), and the founder's uncommitted edits listed separately.
 */
export async function changeSet(repo: string, base: string | null, head: string | null, tasks: Task[]): Promise<ChangeSet> {
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim() || null
  const to = head ?? (await git(repo, ['rev-parse', 'HEAD'])).trim()
  const from = base ?? (await git(repo, ['rev-list', '--max-parents=0', to])).trim().split('\n').pop()!
  const range = `${from}..${to}`
  const diff = from === to ? '' : await git(repo, ['diff', '--no-color', '--no-ext-diff', '-M', range])
  const files = parseDiff(diff)

  const log = from === to ? '' : await git(repo, ['log', '--first-parent', '--format=%H%x1f%s%x1f%an%x1f%at', range])
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, subject, author, at] = l.split('\x1f')
      const key = subject.match(/^Merge (T\d+):/)?.[1] ?? null
      return { sha, subject, author, at: Number(at) * 1000, taskKey: key && byKey.has(key) ? key : null }
    })

  const byTask: ChangeSet['byTask'] = []
  for (const c of commits) {
    const task = c.taskKey ? byKey.get(c.taskKey) : null
    if (!task) continue
    const names = (await git(repo, ['diff', '--name-only', `${c.sha}^1`, c.sha]).catch(() => '')).split('\n').filter(Boolean)
    byTask.push({ taskId: task.id, key: task.key, title: task.title, employeeId: task.assigneeId, files: names })
  }

  const uncommitted = (await git(repo, ['status', '--porcelain']).catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3).split(' -> ').pop()!.trim() }))
    .filter((u) => !u.path.startsWith('.autopia/'))

  return { base: from, head: to, branch, commits, files, byTask, uncommitted, note: null }
}

/** The founder's uncommitted edits as a diff against HEAD (shown read-only). */
export async function uncommittedDiff(repo: string): Promise<DiffFile[]> {
  const text = await git(repo, ['diff', '--no-color', '--no-ext-diff', 'HEAD']).catch(() => '')
  return parseDiff(text)
}

export async function head(repo: string): Promise<string | null> {
  return (await git(repo, ['rev-parse', 'HEAD']).catch(() => '')).trim() || null
}

/** git blob hash per file (missing files map to ''), used to detect stale project knowledge. */
export async function fileHashes(repo: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of files.slice(0, 40)) out[f] = (await git(repo, ['hash-object', '--', f]).catch(() => '')).trim()
  return out
}
