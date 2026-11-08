import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { resolveLoginEnv } from '../claude/cli'

const execFileAsync = promisify(execFile)

export class GitError extends Error {}

async function git(cwd: string, args: string[]): Promise<string> {
  const env = await resolveLoginEnv()
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 16 * 1024 * 1024 })
    return stdout.trimEnd() // not trim(): the first line of `status --porcelain` can start with a meaningful space
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    throw new GitError(`git ${args.slice(0, 2).join(' ')} failed: ${(e.stderr || e.message).trim()}`)
  }
}

let identityArgs: string[] | null = null

/** Use the user's git identity; fall back to an Autopia identity only if none is configured. */
async function identity(cwd: string): Promise<string[]> {
  if (identityArgs) return identityArgs
  const email = await git(cwd, ['config', 'user.email']).catch(() => '')
  identityArgs = email ? [] : ['-c', 'user.name=Autopia', '-c', 'user.email=autopia@localhost']
  return identityArgs
}

export async function isRepo(path: string): Promise<boolean> {
  try {
    return (await git(path, ['rev-parse', '--is-inside-work-tree'])) === 'true'
  } catch {
    return false
  }
}

export async function hasCommits(path: string): Promise<boolean> {
  try {
    await git(path, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

export async function currentBranch(path: string): Promise<string> {
  return git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/** Initializes a repo if needed and guarantees at least one commit so worktrees can branch from it. */
export async function ensureRepo(path: string): Promise<string> {
  if (!(await isRepo(path))) await git(path, ['init', '-b', 'main'])
  if (!(await hasCommits(path))) {
    await git(path, ['add', '-A'])
    await git(path, [...(await identity(path)), 'commit', '--allow-empty', '-m', 'Initial commit (Autopia)'])
  }
  return currentBranch(path)
}

export async function createWorktree(repo: string, dir: string, branch: string, base: string): Promise<void> {
  mkdirSync(dirname(dir), { recursive: true })
  // A stale branch/worktree from an interrupted run would block creation; clear it first.
  await removeWorktree(repo, dir, branch)
  await git(repo, ['worktree', 'add', '-b', branch, dir, base])
}

/**
 * Anything still running from a task's working copy (an agent's dev server it never stopped) would
 * outlive the copy it runs from. Matched by the worktree's own path, which only its processes have.
 */
export async function stopWorktreeProcesses(dir: string): Promise<number> {
  if (!dir) return 0
  const pattern = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out = await execFileAsync('pgrep', ['-f', pattern]).then(
    (r) => r.stdout,
    () => ''
  )
  const pids = out.split('\n').map(Number).filter((p) => p && p !== process.pid)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  return pids.length
}

export async function removeWorktree(repo: string, dir: string, branch: string): Promise<void> {
  await stopWorktreeProcesses(dir)
  await git(repo, ['worktree', 'remove', '--force', dir]).catch(() => undefined)
  await git(repo, ['worktree', 'prune']).catch(() => undefined)
  await git(repo, ['branch', '-D', branch]).catch(() => undefined)
}

/** Removes only Autopia's working directory for a task; the branch (and any unmerged work) stays. */
export async function removeWorktreeKeepBranch(repo: string, dir: string): Promise<void> {
  await stopWorktreeProcesses(dir)
  await git(repo, ['worktree', 'remove', '--force', dir]).catch(() => undefined)
  await git(repo, ['worktree', 'prune']).catch(() => undefined)
}

/** Commits everything in `dir`. Returns false if there was nothing to commit. */
/** Installed dependencies are never committed by Autopia, whatever the project's .gitignore says. */
export const NEVER_COMMIT = /(^|\/)(node_modules|\.venv|__pycache__)(\/|$)/

export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, ['add', '-A'])
  let staged = (await git(dir, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean)
  const deps = staged.filter((f) => NEVER_COMMIT.test(f))
  // unstage dependency files (keeps them on disk); batched to stay under argument limits
  for (let i = 0; i < deps.length; i += 200) await git(dir, ['reset', '-q', '--', ...deps.slice(i, i + 200)])
  if (deps.length) staged = staged.filter((f) => !NEVER_COMMIT.test(f))
  if (!staged.length) return false
  await git(dir, [...(await identity(dir)), 'commit', '-m', message])
  return true
}

export interface ChangedFile {
  status: string
  path: string
}

export async function changedFiles(dir: string, base: string): Promise<ChangedFile[]> {
  const out = await git(dir, ['diff', '--name-status', `${base}...HEAD`])
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split('\t')
      return { status, path: rest[rest.length - 1] }
    })
}

export async function headSha(dir: string): Promise<string> {
  return git(dir, ['rev-parse', 'HEAD'])
}

/**
 * Merges a task branch into the project's checked-out base branch. Refuses if the user has
 * switched branches; aborts cleanly on conflicts so the working tree is never left half-merged.
 */
export async function mergeIntoBase(repo: string, base: string, branch: string, message: string): Promise<void> {
  const current = await currentBranch(repo)
  if (current !== base) {
    throw new GitError(`Project is on branch "${current}" but tasks merge into "${base}". Switch back to "${base}" and retry.`)
  }
  try {
    await git(repo, [...(await identity(repo)), 'merge', '--no-ff', '-m', message, branch])
  } catch (err) {
    await git(repo, ['merge', '--abort']).catch(() => undefined)
    throw err
  }
}

/**
 * Detects merge conflicts between the base branch and a task branch without touching any working
 * tree (git ≥ 2.38). Returns conflicted paths, or null if this git cannot answer.
 */
export async function predictConflicts(repo: string, base: string, branch: string): Promise<string[] | null> {
  const env = await resolveLoginEnv()
  return new Promise((resolve) => {
    execFile('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch], { cwd: repo, env }, (err, stdout) => {
      if (!err) return resolve([])
      // execFile reports the exit status on `code`; merge-tree exits 1 when there are conflicts
      const code = (err as unknown as { code?: number | string }).code
      if (code === 1) return resolve(stdout.split('\n').slice(1).filter(Boolean))
      resolve(null)
    })
  })
}

/** Merges the latest base into a task worktree, leaving conflict markers for the agent to resolve. */
export async function mergeBaseIntoWorktree(dir: string, base: string): Promise<string[]> {
  try {
    await git(dir, [...(await identity(dir)), 'merge', '--no-ff', '--no-edit', base])
    return []
  } catch {
    const out = await git(dir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    return out.split('\n').filter(Boolean)
  }
}

/** Merge commits that brought work into the base branch between two points, newest first. */
export async function mergesBetween(repo: string, from: string, to: string): Promise<string[]> {
  const out = await git(repo, ['rev-list', '--merges', '--first-parent', `${from}..${to}`])
  return out.split('\n').filter(Boolean)
}

/** Files that differ between two commits. */
export async function filesBetween(repo: string, from: string, to: string): Promise<string[]> {
  const out = await git(repo, ['diff', '--name-only', from, to])
  return out.split('\n').filter(Boolean)
}

/**
 * Reverts merge commits (newest first) with new commits: history is kept and nothing is reset. On any
 * conflict the revert in progress is aborted and the error is thrown, leaving the branch as it was
 * before that commit (earlier reverts in this call stay; the caller reports them).
 */
export async function revertMerges(repo: string, shas: string[]): Promise<string[]> {
  const done: string[] = []
  for (const sha of shas) {
    try {
      await git(repo, [...(await identity(repo)), 'revert', '-m', '1', '--no-edit', sha])
      done.push(sha)
    } catch (err) {
      await git(repo, ['revert', '--abort']).catch(() => undefined)
      throw new GitError(`${(err as Error).message}${done.length ? ` (already reverted: ${done.map((s) => s.slice(0, 7)).join(', ')})` : ''}`)
    }
  }
  return done
}

/** Files with uncommitted changes in the user's working copy. */
export async function dirtyFiles(repo: string): Promise<string[]> {
  const out = await git(repo, ['status', '--porcelain']).catch(() => '')
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').pop()!.trim())
}

export async function hasConflictMarkers(dir: string): Promise<boolean> {
  const out = await git(dir, ['diff', '--check']).catch((e: Error) => e.message)
  return /conflict marker/i.test(out)
}

// ── recovery facts (read-only, except re-attaching a kept branch) ──

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false
  )
}

/** Commits on `branch` that `base` doesn't have. */
export async function commitsAhead(repo: string, base: string, branch: string): Promise<number> {
  return Number(await git(repo, ['rev-list', '--count', `${base}..${branch}`]).catch(() => '0')) || 0
}

/** Uncommitted paths in a working tree (tracked changes and new files). */
export async function uncommittedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ['status', '--porcelain', '--untracked-files=normal'])
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^.* -> /, ''))
    .filter((f) => !NEVER_COMMIT.test(f) && !f.startsWith('.autopia/'))
}

/** Whether `base` already has this exact merge commit (the step after it may not have been recorded). */
export async function hasMergeCommit(repo: string, base: string, message: string): Promise<boolean> {
  const out = await git(repo, ['log', base, '--merges', '-n', '1', '--fixed-strings', `--grep=${message}`, '--format=%H']).catch(() => '')
  return out.length > 0
}

/** Re-attaches a kept task branch as its worktree (never resets or deletes anything). */
export async function attachWorktree(repo: string, dir: string, branch: string): Promise<void> {
  mkdirSync(dirname(dir), { recursive: true })
  await git(repo, ['worktree', 'prune']).catch(() => undefined)
  await git(repo, ['worktree', 'add', dir, branch])
}

/** git's own summary of what a worktree changes compared with `base` (committed and uncommitted). */
export async function diffStat(dir: string, base: string): Promise<string> {
  return git(dir, ['diff', '--stat=120', base]).catch(() => '')
}

/** Is there a Git that actually runs? macOS ships a stand-in until the developer tools are installed, and it fails here. */
export async function available(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}
