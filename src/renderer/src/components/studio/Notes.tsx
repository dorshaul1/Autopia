import { useEffect, useRef, useState } from 'react'
import { compareSnapshots, describePick, feedbackStatus, type FeedbackItem } from '@shared/inspect'
import type { Capture, RelRect } from '@shared/studio'
import { actions, useApp } from '../../store'
import { Icon, Pill, timeAgo } from '../common'

const keyOf = (projectId: string) => `autopia:visual-feedback:${projectId}`
function load(projectId: string): FeedbackItem[] {
  try {
    return JSON.parse(localStorage.getItem(keyOf(projectId)) ?? '[]') as FeedbackItem[]
  } catch {
    return []
  }
}
function save(projectId: string, items: FeedbackItem[]): void {
  try {
    localStorage.setItem(keyOf(projectId), JSON.stringify(items))
  } catch {
    // storage unavailable: the list lasts for this session only
  }
}

/**
 * Everything you've said about what you can see, wherever you said it: pointing at the live page or marking a
 * picture of it. One list, one way to the team. The list lives per product and survives a restart.
 */
export function useNotes(projectId: string, running: boolean, onCaptured: () => void) {
  const [items, setItemsState] = useState<FeedbackItem[]>(() => load(projectId))
  const [pointing, setPointing] = useState(false)
  const [sending, setSending] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const tasks = useApp((s) => s.tasks)
  const checking = useRef(new Set<string>())
  const setItems = (next: FeedbackItem[] | ((p: FeedbackItem[]) => FeedbackItem[])) =>
    setItemsState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      save(projectId, value)
      return value
    })

  useEffect(() => () => void window.autopia.previewInspectCancel(projectId), [projectId])

  // numbered dots on the live page for what you pointed at there; gone once a change is settled
  const onPage = items.filter((i) => !i.check && !i.capture)
  useEffect(() => {
    if (!running) return
    void window.autopia.previewMarkers(projectId, onPage.map((i) => ({ n: items.indexOf(i) + 1, selector: i.pick.kind === 'element' ? i.pick.element.selector : null, rect: i.pick.rect })))
    return () => void window.autopia.previewMarkers(projectId, [])
  }, [projectId, running, JSON.stringify(onPage.map((i) => i.id))])

  // a finished change: show it, then measure what the page really does now, and keep a picture of it
  useEffect(() => {
    if (!running) return
    for (const item of items) {
      if (!item.taskId || item.check || tasks[item.taskId]?.status !== 'done' || checking.current.has(item.id)) continue
      checking.current.add(item.id)
      void (async () => {
        await window.autopia.previewReload(projectId)
        await new Promise((r) => setTimeout(r, 1800))
        const pick = item.pick
        const check =
          pick.kind !== 'element'
            ? ({ state: 'unknown', why: 'a marked area can’t be measured, so have a look' } as const)
            : pick.element.opaque
              ? ({ state: 'unknown', why: 'it draws its own content, so have a look' } as const)
              : await window.autopia.previewElement(projectId, pick.element.selector).then((now) => (now === undefined ? ({ state: 'unknown', why: 'the page couldn’t be read' } as const) : compareSnapshots(pick.element.snapshot, now)))
        setItems((list) => list.map((x) => (x.id === item.id ? { ...x, check } : x)))
        await window.autopia.studioCapture(projectId, { source: 'after', taskId: item.taskId }).then(onCaptured, () => undefined)
      })()
    }
  }, [items, tasks, projectId, running])

  const add = (item: Omit<FeedbackItem, 'id' | 'note' | 'sources' | 'taskId' | 'check'>) => {
    const id = crypto.randomUUID()
    setItems((list) => [...list, { ...item, id, note: '', sources: [], taskId: null, check: null }])
    setFocusId(id)
  }

  /** Waits for you to click or drag in the page. The page gets none of it. */
  const point = async () => {
    setPointing(true)
    const pick = await actions.run(() => window.autopia.previewInspect(projectId))
    setPointing(false)
    if (!pick) return
    const shot = await window.autopia.previewScreenshot(projectId, pick.rect).catch(() => null)
    add({ pick, shot: shot?.path ?? null })
  }
  const cancelPoint = () => void window.autopia.previewInspectCancel(projectId)

  /** A mark on a picture, kept as fractions of it. The crop comes from that very picture. */
  const addMark = async (capture: Capture, mark: RelRect, size: { width: number; height: number }) => {
    const shot = await actions.run(() => window.autopia.studioCrop(projectId, capture.path, mark))
    const rect = { x: mark.x * size.width, y: mark.y * size.height, width: mark.width * size.width, height: mark.height * size.height }
    add({ pick: { kind: 'region', rect, page: capture.page ?? '' }, shot: shot ?? null, capture: { path: capture.path, at: capture.at }, mark })
  }

  const drafts = items.filter((i) => !i.taskId)
  const ready = drafts.filter((i) => i.note.trim())
  const send = async () => {
    setSending(true)
    const sent = await actions.run(() => window.autopia.sendVisualFeedback(projectId, ready))
    setSending(false)
    if (!sent) return
    setItems((list) => list.map((i) => sent.find((s) => s.id === i.id) ?? i))
    // nothing has changed yet: this is the page as it was when you asked
    if (running) for (const taskId of new Set(sent.flatMap((s) => s.taskId ?? []))) void window.autopia.studioCapture(projectId, { source: 'before', taskId }).then(onCaptured, () => undefined)
  }
  return { items, setItems, drafts, ready, pointing, sending, focusId, setFocusId, point, cancelPoint, addMark, send }
}

export type Notes = ReturnType<typeof useNotes>

/** Review what you've said before it goes, then follow each one through to the page. */
export function NotesTray({ notes, captures, onCompare, onClose }: { notes: Notes; captures: Capture[]; onCompare: (taskId: string) => void; onClose: () => void }) {
  const tasks = useApp((s) => s.tasks)
  const { items, setItems, drafts, ready, sending, focusId, setFocusId, send } = notes
  const fields = useRef(new Map<string, HTMLTextAreaElement>())
  useEffect(() => {
    if (focusId) fields.current.get(focusId)?.focus()
  }, [focusId])
  const waiting = drafts.length - ready.length

  return (
    <aside className="st-notes" aria-label="Your notes">
      <div className="st-notes-head">
        <strong>Your notes</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Hide your notes" data-tip="Hide. Nothing is lost.">
          <Icon name="close" size={12} />
        </button>
      </div>
      {!items.length && <p className="small muted st-notes-empty">Point at something in the app, or mark up a picture of it. Say what should change, and send it all together.</p>}
      <ol className="st-note-list">
        {items.map((item, n) => {
          const status = feedbackStatus(item, item.taskId ? tasks[item.taskId]?.status ?? null : null)
          const canCompare = !!item.taskId && captures.some((c) => c.taskId === item.taskId && c.source === 'after') && captures.some((c) => c.taskId === item.taskId && c.source === 'before')
          return (
            <li key={item.id} className={`st-note${focusId === item.id ? ' on' : ''}`}>
              <div className="st-note-head">
                <span className="st-n">{n + 1}</span>
                <span className="st-note-what small" title={describePick(item.pick)}>
                  {item.capture ? `On a capture from ${timeAgo(item.capture.at)}` : describePick(item.pick)}
                </span>
                {(!item.taskId || item.check) && (
                  <button className="icon-btn" aria-label={`Remove note ${n + 1}`} onClick={() => setItems((l) => l.filter((x) => x.id !== item.id))}>
                    <Icon name="close" size={10} />
                  </button>
                )}
              </div>
              {item.taskId ? (
                <>
                  <p className="small">{item.note}</p>
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {item.sources[0] && (
                    <p className="small faint st-note-src">
                      {item.sources[0].file}
                      {item.sources[0].line ? `:${item.sources[0].line}` : ''} · {item.sources[0].confidence === 'exact' ? 'reported by the framework' : 'a guess from searching the code'}
                    </p>
                  )}
                  <div className="row gap">
                    <button className="link small" onClick={() => actions.openSheet({ kind: 'task', id: item.taskId! })}>
                      Follow it
                    </button>
                    {canCompare && (
                      <button className="link small" onClick={() => onCompare(item.taskId!)}>
                        Before and after
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <textarea
                  ref={(el) => {
                    if (el) fields.current.set(item.id, el)
                    else fields.current.delete(item.id)
                  }}
                  className="input"
                  rows={2}
                  value={item.note}
                  aria-label={`What should change for note ${n + 1}`}
                  placeholder="What should change?"
                  onFocus={() => setFocusId(item.id)}
                  onChange={(e) => setItems((l) => l.map((x) => (x.id === item.id ? { ...x, note: e.target.value } : x)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready.length && !sending) void send()
                  }}
                />
              )}
            </li>
          )
        })}
      </ol>
      {drafts.length > 0 && (
        <div className="st-notes-foot">
          {waiting > 0 && <span className="small faint">{waiting === 1 ? 'One note still needs words.' : `${waiting} notes still need words.`} Only notes with words are sent.</span>}
          <button className="btn btn-sm btn-primary" disabled={!ready.length || sending} onClick={() => void send()} data-tip="⌘↵">
            {sending ? 'Sending…' : ready.length > 1 ? `Send ${ready.length} changes to the team` : 'Send to the team'}
          </button>
        </div>
      )}
    </aside>
  )
}
