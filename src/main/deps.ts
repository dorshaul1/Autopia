// Whether a folder can actually run its project: every declared package is really installed there, at
// the version the lockfile asks for. Read from the filesystem, nothing is run.
//
// Teammates work in temporary git worktrees. node_modules is git-ignored, so what they install never
// reaches the project folder (only commits do) and disappears with the worktree. The preview runs in
// the project folder, so this check is the only truth about whether it can start: a task reporting a
// successful install says nothing about it, and neither does node_modules merely existing (one left by
// an older package.json or an interrupted install fails with ERR_MODULE_NOT_FOUND).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DependencyState } from '@shared/runtime'

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** null when the folder has no readable package.json (nothing to install). */
export function dependencyState(dir: string): DependencyState | null {
  const pkg = readJson<Manifest>(join(dir, 'package.json'))
  if (!pkg) return null
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  const lock = readJson<{ packages?: Record<string, { version?: string }> }>(join(dir, 'package-lock.json'))
  const missing: string[] = []
  const outdated: string[] = []
  for (const name of declared) {
    const installed = readJson<{ version?: string }>(join(dir, 'node_modules', name, 'package.json'))
    if (!installed) {
      missing.push(name)
      continue
    }
    const wanted = lock?.packages?.[`node_modules/${name}`]?.version
    if (wanted && installed.version && wanted !== installed.version) outdated.push(name)
  }
  return { declared: declared.length, installedFolder: existsSync(join(dir, 'node_modules')), missing, outdated, ok: !missing.length && !outdated.length }
}
