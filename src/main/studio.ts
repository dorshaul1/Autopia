// The real pictures of a product and how to open what can't run inside Autopia. Reads and writes only under the
// project's .autopia folder, which never reaches git. Nothing here starts a process of its own.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import { cropOf, isCapturePath, type Capture, type LaunchOption, type RelRect } from '@shared/studio'
import type { Delivery, Project, QualityReport } from '@shared/types'
import { excludeAutopiaDir } from './preview'

const INDEX = '.autopia/screenshots/captures.json'
const MAX_KEPT = 300

type Stored = Omit<Capture, 'deliveryNumber'>

function stored(project: Project): Stored[] {
  try {
    const list = JSON.parse(readFileSync(join(project.path, INDEX), 'utf8')) as Stored[]
    return Array.isArray(list) ? list.filter((c) => isCapturePath(c.path)) : []
  } catch {
    return []
  }
}

/** Remembers a capture and what it belongs to. The picture itself is already on disk. */
export function recordCapture(project: Project, capture: Stored): void {
  const file = join(project.path, INDEX)
  mkdirSync(join(project.path, '.autopia', 'screenshots'), { recursive: true })
  excludeAutopiaDir(project.path)
  writeFileSync(file, JSON.stringify([...stored(project), capture].slice(-MAX_KEPT), null, 1))
}

/** Every real picture of this product, newest first. A file that has gone is simply not listed. */
export function listCaptures(project: Project, reports: QualityReport[], deliveries: Delivery[]): Capture[] {
  const number = (id: string | null) => deliveries.find((d) => d.id === id)?.number ?? null
  const own = stored(project).map((c) => ({ ...c, deliveryNumber: number(c.deliveryId) }))
  const checks: Capture[] = reports
    .filter((r) => r.kind === 'visual' && r.status === 'done')
    .flatMap((r) =>
      r.shots.map((s) => {
        const size = sizeOf(project, s.path)
        return { path: s.path, at: r.endedAt ?? r.startedAt, source: 'check' as const, width: size?.width ?? s.width, height: size?.height ?? 0, page: null, deliveryId: r.deliveryId, deliveryNumber: number(r.deliveryId), taskId: null }
      })
    )
  return [...own, ...checks].filter((c) => isCapturePath(c.path) && existsSync(join(project.path, c.path))).sort((a, b) => b.at - a.at)
}

function sizeOf(project: Project, rel: string): { width: number; height: number } | null {
  const file = join(project.path, rel)
  if (!existsSync(file)) return null
  const size = nativeImage.createFromPath(file).getSize()
  return size.width ? size : null
}

export function captureImage(project: Project, rel: string): string {
  if (!isCapturePath(rel)) throw new Error('Unknown capture')
  return `data:image/png;base64,${readFileSync(join(project.path, rel)).toString('base64')}`
}

/** Saves the marked part of a picture you're looking at: from that very picture, not a newer one. */
export function cropCapture(project: Project, rel: string, mark: RelRect): string {
  if (!isCapturePath(rel)) throw new Error('Unknown capture')
  const image = nativeImage.createFromPath(join(project.path, rel))
  const size = image.getSize()
  if (!size.width) throw new Error('That capture can’t be read')
  const out = `.autopia/screenshots/mark-${Date.now()}-${Math.round(Math.random() * 1e4)}.png`
  mkdirSync(join(project.path, '.autopia', 'screenshots'), { recursive: true })
  excludeAutopiaDir(project.path)
  writeFileSync(join(project.path, out), image.crop(cropOf(mark, size)).toPNG())
  return out
}

const safeList = (dir: string): string[] => {
  try {
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : []
  } catch {
    return []
  }
}

const OUTSIDE = 'It runs outside Autopia, so the Studio can’t see or capture it.'

/** What can really be opened from this folder, by whatever your Mac opens it with. Found on disk, never assumed. */
export function launchOptions(project: Project): LaunchOption[] {
  const out: LaunchOption[] = []
  const top = safeList(project.path)
  if (top.includes('project.godot')) out.push({ id: 'engine:godot', label: 'Open in Godot', path: 'project.godot', note: `Opens the project with Godot, if you have it. ${OUTSIDE}` })
  for (const f of top.filter((n) => n.endsWith('.uproject')).slice(0, 1)) out.push({ id: 'engine:unreal', label: 'Open in Unreal', path: f, note: `Opens the project with Unreal Engine, if you have it. ${OUTSIDE}` })
  for (const f of top.filter((n) => n.endsWith('.love')).slice(0, 1)) out.push({ id: 'engine:love', label: 'Play with LÖVE', path: f, note: `Opens the game with LÖVE, if you have it. ${OUTSIDE}` })
  const workspace = top.find((n) => n.endsWith('.xcworkspace')) ?? top.find((n) => n.endsWith('.xcodeproj'))
  if (workspace) out.push({ id: 'xcode', label: 'Open in Xcode', path: workspace, note: `Build and run it from Xcode. ${OUTSIDE}` })
  for (const dir of ['build', 'dist', 'out', 'release', 'target/release', 'build/Release', 'build/Debug']) {
    for (const f of safeList(join(project.path, dir)).filter((n) => n.endsWith('.app')).slice(0, 2)) {
      out.push({ id: `app:${dir}/${f}`, label: `Open ${f.replace(/\.app$/, '')}`, path: `${dir}/${f}`, note: `This runs the project’s own code on your Mac. ${OUTSIDE}` })
    }
  }
  for (const f of top.filter((n) => n.endsWith('.ipynb')).slice(0, 2)) out.push({ id: `notebook:${f}`, label: `Open ${f}`, path: f, note: `Opens the notebook with whatever your Mac uses for it. ${OUTSIDE}` })
  return out
}

/** Things Autopia found but can't open for you. Saying so beats a dead button. */
export function launchLimits(project: Project): string[] {
  const top = safeList(project.path)
  const out: string[] = []
  if (top.includes('ProjectSettings') && top.includes('Assets')) out.push('This is a Unity project: open its folder from Unity Hub to run it.')
  return out
}
