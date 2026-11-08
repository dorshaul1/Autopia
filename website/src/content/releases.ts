// What can be downloaded, decided in one place. The page never invents a link: a button exists only when a real
// file does. Connect a distribution provider by setting AUTOPIA_RELEASE_BASE_URL at build time (docs/DISTRIBUTION.md).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Artifact {
  file: string
  platform: 'mac-arm64' | 'mac-x64' | 'win-x64' | 'linux-x64'
  format: 'dmg' | 'zip' | 'exe' | 'AppImage'
  version: string
  bytes: number
  sha256: string
  /** Launched from the packaged build and checked by scripts/smoke-package.mjs. */
  verified: boolean
  /** Signed with a real developer certificate and notarized. Ad-hoc signatures don't count. */
  publiclySigned: boolean
}

interface Manifest {
  version: string
  builtAt: string
  artifacts: Artifact[]
}

export type Availability = 'public' | 'local' | 'none'

export interface Download extends Artifact {
  url: string
  availability: Exclude<Availability, 'none'>
}

export interface PlatformRow {
  id: Artifact['platform']
  label: string
  status: string
  supported: boolean
}

function readManifest(): Manifest | null {
  const path = join(process.cwd(), 'data/releases.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest
  } catch {
    return null
  }
}

/** Only a real https address counts; anything else means nothing is public. */
function publicBase(): string | null {
  const base = process.env.AUTOPIA_RELEASE_BASE_URL?.trim()
  return base && /^https:\/\/[^/\s]+\//.test(`${base.replace(/\/$/, '')}/`) ? base.replace(/\/$/, '') : null
}

export function resolveDownloads(): { availability: Availability; primary: Download | null; downloads: Download[]; version: string | null } {
  const manifest = readManifest()
  const verified = (manifest?.artifacts ?? []).filter((a) => a.verified)
  const base = publicBase()
  const downloads = verified.flatMap<Download>((a) => {
    if (base) return [{ ...a, url: `${base}/${encodeURIComponent(a.file)}`, availability: 'public' as const }]
    // local builds are only ever offered by the local development server
    if (import.meta.env.DEV) return [{ ...a, url: `/__local-downloads/${encodeURIComponent(a.file)}`, availability: 'local' as const }]
    return []
  })
  const primary = downloads.find((d) => d.format === 'dmg') ?? downloads[0] ?? null
  return { availability: primary?.availability ?? 'none', primary, downloads, version: manifest?.version ?? null }
}

/** What's actually been built and tested, platform by platform. Update only with evidence (docs/CAPABILITIES.md). */
export const PLATFORMS: PlatformRow[] = [
  { id: 'mac-arm64', label: 'macOS, Apple Silicon', status: 'Built and tested here', supported: true },
  { id: 'mac-x64', label: 'macOS, Intel', status: 'Not built or tested yet', supported: false },
  { id: 'win-x64', label: 'Windows', status: 'Not supported yet', supported: false },
  { id: 'linux-x64', label: 'Linux', status: 'Not supported yet', supported: false }
]

export const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`
