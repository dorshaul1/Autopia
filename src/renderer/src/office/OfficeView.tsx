import type { OfficeType } from '@shared/offices'
import { useLayout } from './layout'
import { LAYOUTS } from './offices'
import Phaser from 'phaser'
import '@fontsource/silkscreen/400.css'
import { useEffect, useRef, useState } from 'react'
import type { ZoneId } from './layout'
import type { LoungeChannel } from './screens'
import type { SuggestionId } from './people'
import { useApp } from '../store'
import { deviceScale } from './camera'
import { OfficeScene } from './OfficeScene'

/** The running office, set only once its scene has finished building (never a half-started one). */
let activeScene: OfficeScene | null = null
/** Whether the office should be paused (another view is in front); applied to each new office too. */
let paused = false

/** A touch over 60: at exactly 60, two 120Hz frames fall just short of the limit and it settles at 40. */
const FOCUSED_FPS = 65
/** The office keeps living while you work elsewhere, at a rate that leaves the machine to the team. */
function setFrameLimit(fps: number): void {
  const loop = activeScene?.game?.loop as unknown as { fpsLimit: number; _limitRate: number } | undefined
  if (!loop) return
  loop.fpsLimit = fps
  loop._limitRate = 1000 / fps
}
// Dev-only handle for scripted performance checks.
if (import.meta.env.DEV) Object.assign(window, { __officeLoop: () => activeScene?.game?.loop })
window.addEventListener('blur', () => setFrameLimit(20))
window.addEventListener('focus', () => setFrameLimit(FOCUSED_FPS))

function applyPaused(): void {
  const loop = activeScene?.game?.loop
  if (!loop) return
  if (paused) loop.sleep()
  else loop.wake()
}

/** Imperative controls the React HUD uses to drive the world (camera and cosmetic actions). */
export const officeCamera = {
  zoomIn: () => activeScene?.zoomBy(1.2),
  zoomOut: () => activeScene?.zoomBy(1 / 1.2),
  reset: () => activeScene?.fitCamera(),
  focusEmployee: (id: string) => activeScene?.focusEmployee(id),
  focusRoom: (id: string) => activeScene?.focusRoom(id),
  focusZone: (zone: ZoneId) => activeScene?.focusZone(zone),
  focusCorgi: () => activeScene?.focusCorgi(),
  stopFollowing: () => activeScene?.stopFollowing(),
  setPaused: (p: boolean) => {
    paused = p
    applyPaused()
  }
}

export const officeActions = {
  startMatch: (game: 'pong' | 'foosball' | 'hotfix') => activeScene?.startMatch(game) ?? null,
  endMatch: (id: string | null, youWon: boolean) => activeScene?.endMatch(id, youWon) ?? null,
  brewCoffee: () => activeScene?.brewCoffee() ?? null,
  feedFish: () => activeScene?.feedFish(),
  occupants: (zone: ZoneId) => activeScene?.occupants(zone) ?? [],
  printTestPage: () => activeScene?.printSheet(),
  heatLunch: () => activeScene?.heatLunch() ?? false,
  loungeChannel: (): LoungeChannel => activeScene?.loungeChannel ?? 'auto',
  setLoungeChannel: (c: LoungeChannel) => activeScene?.setLoungeChannel(c),
  lightsIn: (zone: ZoneId) => activeScene?.lightsIn(zone) ?? 'auto',
  setLights: (zone: ZoneId, mode: 'auto' | 'on' | 'off') => activeScene?.setLights(zone, mode),
  fitNear: (key: string, tx: number, ty: number, self?: string) => activeScene?.fitNear(key, tx, ty, self ?? null) ?? null,
  wallHasRoom: (key: string) => activeScene?.wallHasRoom(key) ?? true,
  suggestionOptions: (id: string) => activeScene?.suggestionOptions(id) ?? [],
  suggest: (id: string, what: SuggestionId, partnerId?: string) => activeScene?.suggest(id, what, partnerId) ?? { answer: 'unavailable' as const, text: 'The office isn’t open.' }
}

/**
 * Rebuilds the office when the team, seating or decor style changes (new hires get a furnished
 * workstation). Rearranged decor is applied live by the scene and doesn't need a rebuild.
 */
export function OfficeView() {
  // everything you personalise changes the live scene in place; only the team or seating rebuilds it
  const seating = useApp((s) => s.employees.map((e) => `${e.id}@${e.deskId}`).join('|') )
  // each project lives in its own office: its type picks the floor plan and art the scene is built from
  const office = useApp((s) => `${s.activeProjectId ?? '-'}:${(s.activeProjectId && s.projects[s.activeProjectId]?.officeType) || 'startup'}`)
  const ds = useDeviceScale()
  const view = useApp((s) => s.view)
  const key = `${office}|${seating}@${ds}`
  // building a whole office is heavy, so it waits until someone goes there; the words get a frame to show first
  const [built, setBuilt] = useState<string | null>(null)
  useEffect(() => {
    if (view !== 'office' || built === key) return
    const t = setTimeout(() => setBuilt(key), 30)
    return () => clearTimeout(t)
  }, [view, key, built])
  if (built !== key) return view === 'office' ? <div className="office-opening">Opening the office…</div> : null
  return <OfficeCanvas key={key} ds={ds} type={office.split(':')[1] as OfficeType} />
}

/** Canvas density for the current display; changes when the window moves to another screen. */
function useDeviceScale(): number {
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])
  return deviceScale(dpr)
}

function OfficeCanvas({ ds, type }: { ds: number; type: OfficeType }) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)

  useEffect(() => {
    useLayout(LAYOUTS[type] ?? LAYOUTS.startup)
    const scene = new OfficeScene()
    // render at the display's density (CSS size × scale), shown at CSS size: crisp, evenly sized pixels
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: host.current!,
      backgroundColor: '#12110e',
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      // We own sizing (ResizeObserver below); Phaser's RESIZE mode lags a step behind panel toggles.
      scale: { mode: Phaser.Scale.NONE, width: (host.current!.clientWidth || 800) * ds, height: (host.current!.clientHeight || 600) * ds, zoom: 1 / ds },
      banner: false,
      fps: { target: 60, limit: FOCUSED_FPS, smoothStep: true },
      // office sound is our own (office/sound.ts); Phaser's audio would only add a second context
      audio: { noAudio: true },
      scene: []
    })
    const onReady = () => {
      activeScene = scene
      applyPaused()
      // Dev-only handle for scripted visual checks (camera framing, screenshots).
      if (import.meta.env.DEV) (window as unknown as { __office: OfficeScene }).__office = scene
    }
    game.scene.add('office', scene, true, { overlay: overlay.current!, onReady })
    // Phaser only listens to window resizes; the stage also changes size when the panel toggles.
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) game.scale.resize(Math.round(width) * ds, Math.round(height) * ds)
    })
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      if (activeScene === scene) activeScene = null
      game.destroy(true)
    }
  }, [ds])

  return (
    <div className="office">
      <div ref={host} className="office-canvas" />
      <div ref={overlay} className="office-overlay" />
    </div>
  )
}
