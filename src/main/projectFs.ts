import { mkdirSync, readdirSync, realpathSync, statSync, existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { FileContent, FsEntry } from '@shared/types'

const MAX_READ = 512 * 1024
const HIDDEN = new Set(['.git', '.DS_Store'])

/** Resolves `relPath` inside `root`, refusing anything that escapes it (incl. via symlinks). */
export function safeResolve(root: string, relPath: string): string {
  const realRoot = realpathSync(root)
  const target = resolve(realRoot, relPath || '.')
  const real = existsSync(target) ? realpathSync(target) : target
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error('Path is outside the project')
  return real
}

export function listDir(root: string, relPath: string): FsEntry[] {
  const dir = safeResolve(root, relPath)
  const realRoot = realpathSync(root)
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => !HIDDEN.has(d.name))
    .map((d) => {
      const full = join(dir, d.name)
      let size = 0
      let isDir = d.isDirectory()
      try {
        const st = statSync(full)
        size = st.size
        isDir = st.isDirectory()
      } catch {
        // broken symlink: list it, but as an empty file
      }
      return { name: d.name, relPath: relative(realRoot, full), isDir, size }
    })
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

export async function readFile(root: string, relPath: string): Promise<FileContent> {
  const file = safeResolve(root, relPath)
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(size, MAX_READ)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    const binary = buf.subarray(0, 8000).includes(0)
    return { relPath, size, truncated: size > MAX_READ, binary, content: binary ? '' : buf.toString('utf8') }
  } finally {
    await fh.close()
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  )
}

export function prepareNewProjectDir(parent: string, name: string): string {
  // a name you've used before is no reason to stop: the new one gets the next free folder, and the old one is untouched
  const base = join(parent, slugify(name))
  let dir = base
  for (let n = 2; existsSync(dir) && readdirSync(dir).length; n++) dir = `${base}-${n}`
  mkdirSync(dir, { recursive: true })
  return dir
}
