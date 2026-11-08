import { useEffect, useState } from 'react'
import { CAPTURE_WORDS, type Capture } from '@shared/studio'
import { actions } from '../../store'
import { Icon, timeAgo } from '../common'
import { Segmented } from '../ui'

const cache = new Map<string, string>()

/** The picture itself, from the file. No file, no picture. */
export function useCaptureImage(projectId: string, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(path ? cache.get(`${projectId}:${path}`) ?? null : null)
  useEffect(() => {
    if (!path) return setUrl(null)
    const key = `${projectId}:${path}`
    const known = cache.get(key)
    if (known) return setUrl(known)
    setUrl(null)
    let live = true
    void window.autopia.studioImage(projectId, path).then(
      (u) => {
        if (cache.size > 24) cache.delete(cache.keys().next().value!)
        cache.set(key, u)
        if (live) setUrl(u)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [projectId, path])
  return url
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const nameOf = (c: Capture) => `${CAPTURE_WORDS[c.source]} · ${timeAgo(c.at)}${c.width ? ` · ${c.width}px` : ''}`

function Side({ projectId, capture, captures, onPick, label }: { projectId: string; capture: Capture; captures: Capture[]; onPick: (c: Capture) => void; label: string }) {
  const url = useCaptureImage(projectId, capture.path)
  return (
    <figure className="cmp-side">
      <figcaption>
        <select className="select select-ghost" aria-label={label} value={capture.path} onChange={(e) => onPick(captures.find((c) => c.path === e.target.value)!)}>
          {captures.map((c) => (
            <option key={`${c.path}:${c.source}`} value={c.path}>
              {nameOf(c)}
            </option>
          ))}
        </select>
        <CaptureFacts capture={capture} />
      </figcaption>
      <div className="cmp-frame">{url ? <img src={url} alt={`${CAPTURE_WORDS[capture.source]}, ${when(capture.at)}`} /> : <span className="spinner" />}</div>
    </figure>
  )
}

function CaptureFacts({ capture }: { capture: Capture }) {
  return (
    <span className="small faint cmp-facts">
      {when(capture.at)}
      {capture.page ? ` · ${capture.page}` : ''}
      {capture.deliveryId && capture.deliveryNumber !== null && (
        <>
          {' · '}
          <button className="link small" onClick={() => actions.openDelivery(capture.deliveryId!)}>
            Result #{capture.deliveryNumber}
          </button>
        </>
      )}
      {capture.taskId && (
        <>
          {' · '}
          <button className="link small" onClick={() => actions.openSheet({ kind: 'task', id: capture.taskId! })}>
            The task
          </button>
        </>
      )}
    </span>
  )
}

/** Two real captures, next to each other or in the same place. Autopia says when they were taken, never what changed. */
export function Compare({ projectId, captures, pair, onPair }: { projectId: string; captures: Capture[]; pair: [Capture, Capture]; onPair: (p: [Capture, Capture]) => void }) {
  const [view, setView] = useState<'side' | 'swap'>('side')
  const [showing, setShowing] = useState<0 | 1>(1)
  useEffect(() => {
    if (view !== 'swap') return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setShowing(0)
      if (e.key === 'ArrowRight') setShowing(1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view])
  const [a, b] = pair
  const url = useCaptureImage(projectId, pair[showing].path)
  // the other one loads too, so switching is instant
  useCaptureImage(projectId, pair[showing === 0 ? 1 : 0].path)
  const shown = pair[showing]
  return (
    <div className="cmp">
      <div className="cmp-bar">
        <Segmented
          label="How to compare"
          value={view}
          onChange={setView}
          options={[
            { value: 'side', label: 'Side by side' },
            { value: 'swap', label: 'In place' }
          ]}
        />
        {view === 'swap' && (
          <Segmented
            label="Which capture"
            value={String(showing)}
            onChange={(v) => setShowing(v === '0' ? 0 : 1)}
            options={[
              { value: '0', label: 'Earlier' },
              { value: '1', label: 'Later' }
            ]}
          />
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => onPair([b, a])} data-tip="Swap the two">
          <Icon name="move" size={12} /> Swap
        </button>
        {a.width !== b.width && <span className="small warn-text">These were taken at different widths.</span>}
      </div>
      {view === 'side' ? (
        <div className="cmp-sides">
          <Side projectId={projectId} capture={a} captures={captures} label="First capture" onPick={(c) => onPair([c, b])} />
          <Side projectId={projectId} capture={b} captures={captures} label="Second capture" onPick={(c) => onPair([a, c])} />
        </div>
      ) : (
        <figure className="cmp-side cmp-one">
          <figcaption>
            <strong className="small">{CAPTURE_WORDS[shown.source]}</strong>
            <CaptureFacts capture={shown} />
          </figcaption>
          <div className="cmp-frame">{url ? <img src={url} alt={`${CAPTURE_WORDS[shown.source]}, ${when(shown.at)}`} /> : <span className="spinner" />}</div>
        </figure>
      )}
    </div>
  )
}
