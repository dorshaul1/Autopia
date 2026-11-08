import { useEffect, useRef, useState } from 'react'
import { relRect, type Capture, type RelRect } from '@shared/studio'
import type { Notes } from './Notes'
import { useCaptureImage } from './Compare'

/**
 * A real picture you can mark: click for a spot, drag for an area. Works on whatever can't be pointed at live: a
 * canvas, a game, a page that isn't running. Marks are fractions of the picture, so they stay put at any size.
 */
export function Markup({ projectId, capture, notes }: { projectId: string; capture: Capture; notes: Notes }) {
  const url = useCaptureImage(projectId, capture.path)
  const img = useRef<HTMLImageElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<RelRect | null>(null)
  useEffect(() => setDraft(null), [capture.path])

  const at = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const box = () => {
    const r = img.current!.getBoundingClientRect()
    return { width: r.width, height: r.height }
  }
  const natural = () => ({ width: img.current!.naturalWidth, height: img.current!.naturalHeight })
  const marks = notes.items.filter((i) => i.capture?.path === capture.path && i.mark)

  if (!url) return <div className="st-center"><span className="spinner" /></div>
  return (
    <div className="mk">
      <div
        className="mk-canvas"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('.mk-mark')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setStart(at(e))
          setDraft(null)
        }}
        onPointerMove={(e) => {
          if (start) setDraft(relRect(start, at(e), box()))
        }}
        onPointerUp={(e) => {
          if (!start) return
          const mark = relRect(start, at(e), box())
          setStart(null)
          setDraft(null)
          if (mark) void notes.addMark(capture, mark, natural())
        }}
        onPointerCancel={() => {
          setStart(null)
          setDraft(null)
        }}
      >
        <img ref={img} src={url} alt="A capture of the product" draggable={false} />
        {marks.map((item) => {
          const m = item.mark!
          const n = notes.items.indexOf(item) + 1
          const spot = !m.width && !m.height
          return (
            <button
              key={item.id}
              className={`mk-mark${spot ? ' spot' : ''}${notes.focusId === item.id ? ' on' : ''}`}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: spot ? undefined : `${m.width * 100}%`, height: spot ? undefined : `${m.height * 100}%` }}
              onClick={() => notes.setFocusId(item.id)}
              aria-label={`Note ${n}`}
            >
              <span className="st-n">{n}</span>
            </button>
          )
        })}
        {draft && (draft.width > 0 || draft.height > 0) && <span className="mk-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}
      </div>
    </div>
  )
}
