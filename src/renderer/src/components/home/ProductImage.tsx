import { useEffect, useState, type ReactNode } from 'react'
import { OFFICE_TYPES } from '@shared/offices'
import type { Project } from '@shared/types'
import { OFFICE_PREVIEW } from './officeArt'

const seen = new Map<string, string | null>()
const watchers = new Set<() => void>()

/** There's a newer real picture of this product: everything showing it looks again. */
export function refreshProductImage(projectId: string): void {
  seen.delete(projectId)
  watchers.forEach((w) => w())
}

/**
 * The product itself, from its latest real capture. `none` is what stands in until one exists; by default that's the
 * office as a small identity mark. Where the product itself is expected, the caller passes something honest instead.
 */
export function ProductImage({ project, stamp, none }: { project: Pick<Project, 'id' | 'name' | 'officeType'>; /** Changes when there may be a newer capture. */ stamp?: unknown; none?: ReactNode }) {
  const [, redraw] = useState(0)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const w = () => redraw((n) => n + 1)
    watchers.add(w)
    return () => void watchers.delete(w)
  }, [])
  const known = seen.has(project.id)
  useEffect(() => {
    seen.delete(project.id)
  }, [project.id, stamp])
  useEffect(() => {
    let live = true
    if (seen.has(project.id)) return setLoaded(true)
    // an app still running an older main process has no pictures to offer
    void (window.autopia.productImage?.(project.id) ?? Promise.resolve(null)).then(
      (url) => {
        seen.set(project.id, url)
        if (live) setLoaded(true), redraw((n) => n + 1)
      },
      () => {
        seen.set(project.id, null)
        if (live) setLoaded(true), redraw((n) => n + 1)
      }
    )
    return () => {
      live = false
    }
  }, [project.id, stamp, known])
  const src = seen.get(project.id) ?? null
  if (src) return <img className="product-image" src={src} alt={`${project.name}, as last captured`} draggable={false} />
  if (!loaded && !seen.has(project.id)) return null
  if (none !== undefined) return <>{none}</>
  const type = project.officeType ?? 'startup'
  return <img className="product-image office-art" src={OFFICE_PREVIEW[type]} alt={`${OFFICE_TYPES[type].name} office`} draggable={false} />
}
