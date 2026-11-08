import { summaryLines } from '@shared/timeline'
import { requestState, threadWith } from '@shared/requestLifecycle'
import { readableEvent } from '@shared/activityText'
import { DOING_LABEL, doingOf } from '@shared/workActivity'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CAPABILITY_LABEL } from '@shared/capabilities'
import type { Approval, Delivery, EmployeeProfile, Message, Task } from '@shared/types'
import { countSteps, standLine } from '@shared/briefing'
import { collaboratorsOf, missionOf, taskActions } from '@shared/mission'
import { OFFICE_DOG, folkById } from '@shared/officeFolk'
import { DogAvatar } from '../WorldHud'
import { receptionistFor } from '../../office/reception'
import { PANEL_WIDTH, activeProject, actions, pendingApprovals, sortedRuns, sortedTasks, store, useApp, type SheetEntry, isSpace } from '../../store'
import { SessionPanel } from '../inspector/Inspector'
import { Markdown } from '../Markdown'
import { confirmAction } from '../ui'
import { routingLabel } from '@shared/steering'
import { ApprovalCard } from '../ApprovalDock'
import { Composer } from '../composer/Composer'
import { Avatar, Icon, Pill, TASK_LABEL, TASK_TONE, duration, money, timeAgo, useNaming, useTicker } from '../common'
import { officeActions, officeCamera } from '../../office/OfficeView'
import { HABIT_LABEL, profileFor } from '../../office/personality'
import { closeness, describePerson, dogLine, preferredBreaks, standoutTraits, type SuggestionId } from '../../office/people'
import { relationships } from '../../office/social'

const TITLE: Record<SheetEntry['kind'], string> = { conversation: 'Conversation', employee: 'Teammate', task: 'Task', log: 'Live log' }

function useFolk(id: string | null | undefined) {
  const office = useApp((s) => (s.activeProjectId && s.projects[s.activeProjectId]?.officeType) || 'startup')
  const kind = folkById(id, office)
  const desk = receptionistFor(office)
  return kind === 'dog' ? { kind, name: OFFICE_DOG.name, title: 'The office corgi' } : kind === 'desk' ? { kind, name: desk.name, title: desk.role, desk } : null
}

/** The front desk and the dog aren't on the team, but they can still be in the conversation. */
function FolkFace({ id, size }: { id: string | null; size: number }) {
  const folk = useFolk(id)
  if (folk?.kind === 'dog') return <DogAvatar size={size} />
  return folk?.desk ? <Avatar employee={{ id: folk.desk.id, appearance: folk.desk.appearance }} size={size} /> : null
}

function FolkName({ id, fallback, tip }: { id: string | null; fallback: string; tip?: string }) {
  const folk = useFolk(id)
  return <b data-tip={folk?.title ?? tip}>{folk?.name ?? fallback}</b>
}

/** Everyone, or one teammate: you can always get back to the whole picture. */
function ThreadTitle({ fallback, isThread }: { fallback: string; isThread: boolean }) {
  const id = useApp((s) => s.threadWith)
  const e = useApp((s) => s.employees.find((x) => x.id === id))
  const withId = useApp((s) => s.threadWith)
  const folk = useFolk(withId)
  if (isThread && folk)
    return (
      <div className="sheet-title thread-title">
        <button className="sheet-back" onClick={() => actions.talkTo(null)} data-tip="Back to everyone">
          <Icon name="back" size={12} />
        </button>
        <span className="thread-who">
          <FolkFace id={withId} size={18} /> {folk.name}
        </span>
      </div>
    )
  if (!isThread || !e) return <div className="sheet-title">{fallback}</div>
  return (
    <div className="sheet-title thread-title">
      <button className="sheet-back" onClick={() => actions.talkTo(null)} data-tip="Back to everyone">
        <Icon name="back" size={12} />
      </button>
      <button className="thread-who" onClick={() => actions.openSheet({ kind: 'employee', id: e.id })} data-tip={`${e.title}: see what they're doing`}>
        <Avatar employee={e} size={18} /> {e.name.split(' ')[0]}
      </button>
    </div>
  )
}

/** The side sheet: one context at a time, with Back to where you were. The office stays visible beside it. */
export function Sheet() {
  const open = useApp((s) => s.panelOpen && isSpace(s.view))
  const stack = useApp((s) => s.sheet)
  const project = useApp(activeProject)
  const top = stack[stack.length - 1]
  if (!project || !top) return null
  return (
    <aside className={`sheet${open ? '' : ' closing'}`} aria-label={TITLE[top.kind]}>
      <ResizeHandle />
      <header className="sheet-head">
        {stack.length > 1 ? (
          <button className="sheet-back" onClick={actions.backSheet} data-tip="Back (⌘[)">
            <Icon name="back" size={12} /> {TITLE[stack[stack.length - 2].kind]}
          </button>
        ) : (
          <ThreadTitle fallback={TITLE[top.kind]} isThread={top.kind === 'conversation'} />
        )}
        <span className="sheet-spacer" />
        <button className="icon-btn" onClick={() => store.setState({ panelOpen: false })} aria-label="Close panel" data-tip="Close (⌘\\)">
          <Icon name="close" size={13} />
        </button>
      </header>
      <div className="sheet-body" key={top.kind}>
        {top.kind === 'conversation' && <Conversation />}
        {top.kind === 'employee' && <EmployeeView id={top.id} />}
        {top.kind === 'task' && <TaskView id={top.id} />}
        {top.kind === 'log' && <LogView runId={top.runId} />}
      </div>
    </aside>
  )
}

// ── conversation ─────────────────────────────────────────────

type Item =
  | { kind: 'message'; at: number; message: Message }
  | { kind: 'request'; at: number; delivery: Delivery }
  | { kind: 'progress'; at: number; delivery: Delivery }
  | { kind: 'result'; at: number; delivery: Delivery }
  | { kind: 'approval'; at: number; approval: Approval }

const RESULT_LABEL: Record<Delivery['status'], string> = {
  implementing: 'In progress',
  validating: 'Checking',
  review: 'Ready to review',
  accepted: 'Accepted',
  revising: 'Changes requested',
  rejected: 'Discarded'
}

/** One continuous thread built from what already exists: your messages, plans, progress, decisions and results. */
/** Drag the panel's left edge to resize it; double-click to go back to the default width. Remembered. */
function ResizeHandle() {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, window.innerWidth - ev.clientX)))
      store.setState({ panelWidth: w })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      const w = store.getState().panelWidth
      try {
        if (w) localStorage.setItem('autopia.panelWidth', String(w))
      } catch {
        // storage unavailable: the width lasts for this session
      }
      officeCamera.reset()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div
      className="sheet-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onPointerDown={start}
      onDoubleClick={() => {
        store.setState({ panelWidth: null })
        try {
          localStorage.removeItem('autopia.panelWidth')
        } catch {
          // nothing stored
        }
        setTimeout(() => officeCamera.reset(), 80)
      }}
    />
  )
}

function Conversation() {
  const all = useApp((s) => s.messages)
  const withWho = useApp((s) => s.threadWith)
  const messages = useMemo(() => threadWith(all, withWho), [all, withWho])
  const [extra, setExtra] = useState(0)
  const reveal = useApp((s) => s.revealMessage)
  const deliveries = useApp((s) => s.deliveries)
  const approvals = useApp((s) => Object.values(s.approvals))
  const tasks = useApp(sortedTasks)
  const bottom = useRef<HTMLDivElement>(null)
  // you're looking at the conversation: everything in it has been seen
  useEffect(() => void (store.getState().unread && store.setState({ unread: 0 })), [messages])

  const items = useMemo(() => {
    const out: Item[] = []
    for (const m of messages) out.push({ kind: 'message', at: m.createdAt, message: m })
    if (withWho) return out.sort((a, b) => a.at - b.at)
    for (const d of [...deliveries].reverse()) {
      // requests sent through the Composer already appear as your message
      if (!messages.some((m) => m.deliveryId === d.id && m.role === 'user')) out.push({ kind: 'request', at: d.createdAt, delivery: d })
      if (tasks.some((t) => t.deliveryId === d.id && t.status !== 'proposed')) out.push({ kind: 'progress', at: d.createdAt + 1, delivery: d })
      if (d.completedAt) out.push({ kind: 'result', at: d.completedAt, delivery: d })
    }
    for (const a of approvals) if (a.status === 'pending' || a.kind === 'plan' || a.kind === 'question') out.push({ kind: 'approval', at: a.createdAt, approval: a })
    return out.sort((a, b) => a.at - b.at)
  }, [messages, deliveries, approvals, tasks, withWho])
  // a long history stays quick; nothing is lost, it's one click away
  const revealAt = reveal ? items.findIndex((i) => i.kind === 'message' && i.message.id === reveal) : -1
  const hidden = Math.min(Math.max(0, items.length - 80 - extra), revealAt >= 0 ? revealAt : Infinity)
  const shown = hidden ? items.slice(hidden) : items

  // new messages follow you only if you're at the bottom; reading further up, you keep your place
  const [away, setAway] = useState(false)
  const stick = useRef(true)
  const scroller = useRef<HTMLDivElement>(null)
  const gesture = useRef(0)
  const projectId = useApp((s) => s.activeProjectId)
  useLayoutEffect(() => {
    stick.current = true
    setAway(false)
  }, [projectId])
  // a search found this one: bring it into view and mark it, once
  useEffect(() => {
    if (!reveal) return
    // what a search found stays loaded after the search is done with it
    if (revealAt >= 0) setExtra(Math.max(extra, items.length - 80 - revealAt))
    const t = setTimeout(() => {
      const el = document.getElementById(`msg-${reveal}`)
      if (el) {
        stick.current = false
        setAway(true)
        el.scrollIntoView({ block: 'center' })
        el.classList.add('msg-found')
        setTimeout(() => el.classList.remove('msg-found'), 1800)
      }
      store.setState({ revealMessage: null })
    }, 80)
    return () => clearTimeout(t)
  }, [reveal])
  useLayoutEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length, projectId])
  // cards keep growing after they first render (answers typing out, details loading)
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (stick.current) bottom.current?.scrollIntoView({ block: 'end' })
    })
    for (const child of scroller.current?.children ?? []) ro.observe(child)
    return () => ro.disconnect()
  }, [items.length, projectId])

  return (
    <div className="conv">
      <div
        className="conv-scroll"
        ref={scroller}
        onWheel={() => (gesture.current = Date.now())}
        onPointerDown={() => (gesture.current = Date.now())}
        onKeyDown={() => (gesture.current = Date.now())}
        onScroll={(e) => {
          const el = e.currentTarget
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          // only you scrolling away counts: content changing under the list moves it too
          if (near) stick.current = true
          else if (Date.now() - gesture.current < 1500) {
            gesture.current = Date.now()
            stick.current = false
          } else if (stick.current) bottom.current?.scrollIntoView({ block: 'end' })
          setAway(!stick.current)
        }}
      >
        {hidden > 0 && (
          <button className="link small conv-earlier" onClick={() => setExtra(extra + 200)}>
            Show {Math.min(hidden, 200)} earlier{hidden > 200 ? ` of ${hidden.toLocaleString()}` : ''}
          </button>
        )}
        {!items.length && (
          <div className="conv-empty">
            <h4>{withWho ? 'Nothing between you two yet' : 'Tell the team what to build'}</h4>
            <p>They plan it if it needs a plan, build it, test it and show you the result. You can keep talking while they work.</p>
          </div>
        )}
        {shown.map((it) => (
          <ThreadItem key={`${it.kind}:${'message' in it ? it.message.id : 'delivery' in it ? it.delivery.id : it.approval.id}`} item={it} />
        ))}
        <div ref={bottom} />
      </div>
      <div className="conv-composer">
        {away && (
          <button className="conv-latest" onClick={() => bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })}>
            <Icon name="chevron" size={10} /> Latest
          </button>
        )}
        <Composer />
      </div>
    </div>
  )
}

function ThreadItem({ item }: { item: Item }) {
  const employees = useApp((s) => s.employees)
  if (item.kind === 'message') {
    const m = item.message
    if (m.role === 'user')
      return (
        <div id={`msg-${m.id}`} className={`msg msg-user${Date.now() - m.createdAt < 1500 ? ' msg-new' : ''}`}>
          <div className="msg-text">{m.text}</div>
          {m.attachments.length > 0 && <Attachments files={m.attachments} />}
          <MessageState m={m} />
          <div className={`msg-actions${m.status === 'failed' ? ' show' : ''}`}>
            <span className="msg-time">{timeAgo(m.createdAt)}</span>
            <CopyButton text={m.text} />
            {m.status === 'failed' && (
              <button className="link small" onClick={() => void retryMessage(m)}>
                <Icon name="retry" size={11} /> Retry
              </button>
            )}
          </div>
          {m.status === 'failed' && !/^Stopped/.test(m.error ?? '') && <div className="msg-error">{m.error}</div>}
        </div>
      )
    const who = employees.find((e) => e.id === m.employeeId) ?? null
    return (
      <div id={`msg-${m.id}`} className="msg msg-team">
        <span className="msg-avatar">{who ? <Avatar employee={who} size={24} /> : <FolkFace id={m.employeeId} size={24} />}</span>
        <div className="msg-meta">
          <FolkName id={m.employeeId} fallback={who ? who.name.split(' ')[0] : 'Team'} tip={who?.title} />
          <span className="faint">{timeAgo(m.createdAt)}</span>
        </div>
        {m.status === 'working' && (
          <div className="msg-text msg-working">
            {m.text && <div className="msg-stream">{m.text}</div>}
            <TypingDots />
            {m.text ? 'Still working' : 'Working on it'}
            {m.runId && (
              <button className="link small" onClick={() => actions.openSheet({ kind: 'log', runId: m.runId! })}>
                Watch
              </button>
            )}
            <button className="link small" onClick={() => void actions.run(() => window.autopia.stopMessage(m.id))}>
              <Icon name="stop" size={10} /> Stop
            </button>
          </div>
        )}
        {m.status === 'answered' && <AnsweredText message={m} />}
        {m.status === 'failed' && <div className="msg-error">Couldn’t answer: {m.error}</div>}
        {m.runId && m.status !== 'working' && <WhatItDid runId={m.runId} />}
        {m.status !== 'working' && (
          <div className="msg-actions">
            <button className="link small" onClick={() => replyTo(who?.name.split(' ')[0] ?? 'Team', m.text, who?.id ?? null)}>
              <Icon name="reply" size={11} /> Reply
            </button>
            {m.status === 'answered' && <CopyButton text={m.text} />}
          </div>
        )}
      </div>
    )
  }
  if (item.kind === 'request')
    return (
      <div className="msg msg-user">
        <div className="msg-meta">You · {timeAgo(item.at)} · request #{item.delivery.number}</div>
        <div className="msg-text">{item.delivery.request}</div>
      </div>
    )
  if (item.kind === 'progress') return <Progress delivery={item.delivery} />
  if (item.kind === 'result') return <ResultCard delivery={item.delivery} />
  const a = item.approval
  if (a.status === 'pending') return <div className="thread-card">{<ApprovalCard approval={a} more={0} />}</div>
  return <SystemRow icon={a.kind === 'plan' ? 'check' : 'chat'} text={`${a.title} · ${a.resolution?.startsWith('revise') ? 'you asked for changes' : a.resolution ?? 'resolved'}`} />
}

/** Where something you asked stands, from what's recorded: a question being answered, or real work under way. */
function MessageState({ m }: { m: Message }) {
  const deliveries = useApp((s) => s.deliveries)
  const tasks = useApp((s) => s.tasks)
  const approvals = useApp((s) => s.approvals)
  const delivery = m.deliveryId ? deliveries.find((d) => d.id === m.deliveryId) ?? null : null
  const own = delivery ? Object.values(tasks).filter((t) => t.deliveryId === delivery.id && t.status !== 'proposed') : []
  const state = requestState(m, delivery, own, !!delivery && Object.values(approvals).some((a) => a.status === 'pending' && (!a.taskId || own.some((t) => t.id === a.taskId))))
  // an answer below says it all; a message that simply went through says nothing
  if (state.kind === 'answer' && (state.stage === 'completed' || state.stage === 'running')) return null
  if (state.stage === 'submitted') return null
  const label = routingLabel(m.status, m.routing) ?? state.label
  return state.deliveryId ? (
    <button className={`msg-state msg-state-link st-${state.stage}`} onClick={() => actions.goStage('overview')}>
      {state.stage === 'running' && <span className="spinner spinner-sm" aria-hidden />}
      {label} <Icon name="chevron" size={9} />
    </button>
  ) : (
    <span className={`msg-state st-${state.stage}`}>{label}</span>
  )
}

/** What Claude Code did to get to this answer: there on demand, in plain words. */
function WhatItDid({ runId }: { runId: string }) {
  const events = useApp((s) => s.events[runId])
  const project = useApp(activeProject)
  const run = useApp((s) => s.runs[runId])
  const [open, setOpen] = useState(false)
  const lines = (events ?? []).flatMap((e) => {
    const said = e.kind === 'tool_use' || e.kind === 'system' || e.kind === 'stderr' || e.isError ? readableEvent(e, run?.cwd ?? project?.path ?? '') : null
    return said ? [{ id: e.id, text: said, bad: !!e.isError }] : []
  })
  return (
    <div className="msg-did">
      <button
        className="link small"
        aria-expanded={open}
        onClick={() => {
          if (!events) void actions.loadEvents(runId)
          setOpen(!open)
        }}
      >
        <Icon name="activity" size={11} /> What it did
      </button>
      {open && (
        <div className="msg-did-list">
          {!events && <span className="faint">Loading…</span>}
          {events && !lines.length && <span className="faint">It answered without using any tools.</span>}
          {lines.slice(0, 40).map((l) => (
            <div key={l.id} className={l.bad ? 'bad-text' : ''}>
              {l.text}
            </div>
          ))}
          <button className="link small" onClick={() => actions.openSheet({ kind: 'log', runId })}>
            Full log
          </button>
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="link small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        })
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={11} /> {done ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Attached images show as thumbnails; other files as chips. */
function Attachments({ files }: { files: string[] }) {
  const project = useApp(activeProject)
  return (
    <div className="msg-files">
      {files.map((a) => {
        const name = a.split('/').pop()!.replace(/^\d+-/, '')
        const image = /\.(png|jpe?g|gif|webp)$/i.test(a)
        return image && project ? (
          <Thumb key={a} projectId={project.id} rel={a} name={name} />
        ) : (
          <span key={a} className="msg-file">
            <Icon name="file" size={11} /> {name}
          </span>
        )
      })}
    </div>
  )
}

function Thumb({ projectId, rel, name }: { projectId: string; rel: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    // an app started before this feature has no preview call: show the file name instead
    if (typeof window.autopia.attachmentImage !== 'function') return
    window.autopia
      .attachmentImage(projectId, rel)
      .then((u) => live && setSrc(u))
      .catch(() => {})
    return () => void (live = false)
  }, [projectId, rel])
  return src ? <img className="msg-thumb" src={src} alt={name} /> : <span className="msg-file">{name}</span>
}

/** Reply to a message: the composer shows what you're answering and sends it along as context. */
function replyTo(who: string, text: string, employeeId: string | null) {
  store.setState((s) => ({ replyTo: { who, text }, target: { ...s.target, employeeId: employeeId ?? s.target.employeeId }, composerFocus: s.composerFocus + 1 }))
}

async function retryMessage(m: Message) {
  await actions.run(() => window.autopia.sendMessage({ projectId: m.projectId, intent: m.intent, text: m.text, attachments: m.attachments, employeeId: m.employeeId, taskId: m.taskId, deliveryId: m.deliveryId }))
}

/** Long agent-written text stays readable: the start, and the rest on request. */
function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420 || text.split('\n').length > 7
  return (
    <>
      <p className={`small pre${long && !open ? ' clamped' : ''}`}>{text}</p>
      {long && (
        <button className="link small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

function TypingDots() {
  return (
    <span className="typing" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

/**
 * A reply that just arrived gets a brief typing moment before it appears, so an instant answer reads like
 * someone answering. Only for replies arriving now: history, and reduced motion, show right away.
 */
function AnsweredText({ message: m }: { message: Message }) {
  const [typing, setTyping] = useState(() => Date.now() - m.createdAt < 1500 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!typing) return
    const t = setTimeout(() => setTyping(false), Math.min(1100, 450 + m.text.length * 5))
    return () => clearTimeout(t)
  }, [typing, m.text.length])
  // the bubble grows when the text appears: keep the newest message in view
  useEffect(() => {
    if (!typing) box.current?.scrollIntoView({ block: 'nearest' })
  }, [typing])
  return typing ? (
    <div className="msg-text msg-working" role="status" aria-label="Typing">
      <TypingDots />
    </div>
  ) : (
    <div ref={box} className="msg-text msg-rich msg-arrive">
      <Markdown text={m.text} />
    </div>
  )
}

function SystemRow({ icon, text, live }: { icon: 'check' | 'chat' | 'alert' | 'activity'; text: string; live?: boolean }) {
  return (
    <div className="sys-row">
      {live ? <span className="spinner" /> : <Icon name={icon} size={12} />}
      <span>{text}</span>
    </div>
  )
}

/**
 * The chat keeps one concise, live line per request: where the work stands and who is on it, linked
 * to the Execution view (plans, stages, dependencies, assignments). No stage lists in the timeline.
 */
function Progress({ delivery }: { delivery: Delivery }) {
  const tasks = useApp(sortedTasks).filter((t) => t.deliveryId === delivery.id && t.status !== 'proposed')
  const employees = useApp((s) => s.employees)
  const counts = countSteps(tasks)
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'merging')
  const people = [...new Set(active.map((t) => t.assigneeId))].map((id) => employees.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e)
  // a spinner means something is really running: with everyone stopped on a blocker, it's waiting for you
  const stopped = delivery.status === 'implementing' && !active.length && counts.stuck > 0
  const working = (delivery.status === 'implementing' || delivery.status === 'validating') && !stopped
  return (
    <button className={`work-line${working ? ' live' : ''}${counts.stuck ? ' stuck' : ''}`} onClick={() => actions.goStage('overview')}>
      {working ? <span className="spinner" /> : <Icon name={counts.stuck ? 'alert' : 'check'} size={12} />}
      <span className="work-text">
        <b>{stopped ? 'Waiting for you' : delivery.status === 'validating' ? 'Verifying it for real' : delivery.verification?.state === 'fixing' ? 'Fixing what failed' : working ? (active.length ? `${people.map((e) => e.name.split(' ')[0]).join(', ')} ${people.length === 1 ? 'is' : 'are'} working` : 'Working on it') : counts.done === counts.total ? 'Work done' : 'Work'}</b>
        <span className="faint"> · {counts.done === counts.total ? `${counts.total} step${counts.total === 1 ? '' : 's'}` : standLine(counts)}</span>
      </span>
      <span className="work-people">
        {people.slice(0, 4).map((e) => (
          <Avatar key={e.id} employee={e} size={16} />
        ))}
      </span>
      <span className="link small">See the work ›</span>
    </button>
  )
}

function ResultCard({ delivery }: { delivery: Delivery }) {
  const review = delivery.status === 'review'
  const open = () => actions.openDelivery(delivery.id)
  return (
    <div className={`result-card${review ? ' ready' : ''}`}>
      <div className="row between">
        <strong>Result #{delivery.number}</strong>
        {review && delivery.verification && (delivery.verification.state === 'failed' || delivery.verification.state === 'blocked') ? (
          <Pill tone="danger">{delivery.verification.state === 'blocked' ? 'Blocked' : 'Needs fixes'}</Pill>
        ) : (
          <Pill tone={review ? 'warn' : delivery.status === 'accepted' ? 'ok' : 'muted'}>{RESULT_LABEL[delivery.status]}</Pill>
        )}
      </div>
      {delivery.summary && (
        <ul className="result-summary">
          {summaryLines(delivery.summary, delivery.verification?.state === 'verified')
            .slice(0, 4)
            .map((l) => (
              <li key={l}>{l}</li>
            ))}
        </ul>
      )}
      {delivery.limitations.length > 0 && <div className="small warn-text">{delivery.limitations.length === 1 ? '1 thing' : `${delivery.limitations.length} things`} to check before accepting</div>}
      <div className="row gap">
        <button className={`btn btn-sm${review ? ' btn-primary' : ''}`} onClick={open}>
          <Icon name="eye" size={12} /> {review ? 'Review it' : 'Open it'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => actions.compose({ deliveryId: delivery.id })}>
          Request a change
        </button>
      </div>
    </div>
  )
}

// ── teammate ─────────────────────────────────────────────────

function EmployeeView({ id }: { id: string }) {
  const e = useApp((s) => s.employees.find((x) => x.id === id))
  const status = useApp((s) => s.statuses[id])
  const tasks = useApp(sortedTasks)
  const projects = useApp((s) => s.projects)
  const deliveries = useApp((s) => s.deliveries)
  const indicators = useApp((s) => s.indicators)
  if (!e) return <div className="sheet-pad muted">This teammate is no longer on the team.</div>
  const current = status?.taskId ? tasks.find((t) => t.id === status.taskId) : null
  const recent = tasks.filter((t) => t.assigneeId === id && t.status === 'done').slice(-4).reverse()
  const toReview = deliveries.find((d) => d.status === 'review' && recent.some((t) => t.deliveryId === d.id))
  const working = status && status.activity !== 'idle'
  const need = indicators.find((x) => x.employeeId === id)
  const real = tasks.filter((t) => t.status !== 'proposed' && t.status !== 'cancelled')
  const progress = { done: real.filter((t) => t.status === 'done').length, total: real.length }
  const upcoming = tasks.filter((t) => t.assigneeId === id && ['pending', 'failed', 'interrupted'].includes(t.status))
  const together = collaboratorsOf(id, real)
  const employees = store.getState().employees
  return (
    <div className="sheet-pad">
      <div className="who">
        <Avatar employee={e} size={44} />
        <div>
          <h3>{e.name}</h3>
          <div className="muted small">{e.title}</div>
        </div>
      </div>
      <section className="sheet-section">
        <div className="section-label">Now</div>
        <p className="now-line">
          <b>{status?.needsYou ? 'Waiting for you' : doingOf(status) ? DOING_LABEL[doingOf(status)!] : 'Available'}</b>
          {working && status?.projectId && projects[status.projectId] ? ` on ${projects[status.projectId].name}` : ''}
        </p>
        {current && (
          <button className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: current.id })}>
            <span>
              {current.title}
            </span>
            <Icon name="chevron" size={10} />
          </button>
        )}
        {current && progress.total > 1 && <p className="small faint">Step {progress.done + 1 > progress.total ? progress.total : progress.done + 1} of {progress.total} in this project</p>}
        {working && status?.detail && <p className="small muted mono-line">{status.detail}</p>}
        {current?.lastError && status?.activity === 'error' && <p className="small msg-error">{current.lastError.slice(0, 240)}</p>}
        {status?.needsYou && !need && (
          <button className="row-btn rv-ready" onClick={() => actions.openSheet({ kind: 'conversation' })}>
            <span>
              <b>Answer in the conversation</b>
            </span>
            <Icon name="chevron" size={10} />
          </button>
        )}
        {need && (
          <button className="row-btn rv-ready" onClick={() => void actions.openAttention(need)}>
            <span>
              <b>{need.label}</b>
            </span>
            <Icon name="chevron" size={10} />
          </button>
        )}
        {working && status?.reason && <p className="small faint">{status.reason}</p>}
      </section>
      {toReview && (
        <button className="row-btn rv-ready" onClick={() => actions.openDelivery(toReview.id)}>
          <span>
            <b>Result #{toReview.number} is ready to review</b>
          </span>
          <Icon name="chevron" size={10} />
        </button>
      )}
      <div className="action-row">
        <button className="btn btn-sm btn-primary" onClick={() => actions.talkTo(id)}>
          Message {e.name.split(' ')[0]}
        </button>
        {status?.runId && (
          <button className="btn btn-sm" onClick={() => actions.openSheet({ kind: 'log', runId: status.runId! })}>
            <Icon name="activity" size={12} /> Watch live
          </button>
        )}
        <FollowButton id={id} />
        {current && ['running', 'pending', 'interrupted', 'failed'].includes(current.status) && typeof window.autopia.stopTask === 'function' && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              if (await confirmAction({ title: `Stop ${e.name.split(' ')[0]}’s step?`, body: `“${current.title}” stops now and won’t start again. Anything not finished in it is dropped; finished steps stay.`, action: 'Stop this step', danger: true })) void actions.run(() => window.autopia.stopTask(current.id))
            }}
          >
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
      </div>
      {upcoming.length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Next for {e.name.split(' ')[0]}</div>
          {upcoming.map((t) => (
            <button key={t.id} className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
              <span>{t.title}</span>
              <span className="faint small">{TASK_LABEL[t.status]}</span>
            </button>
          ))}
        </section>
      )}
      {together.length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Works with, on this product</div>
          {together.slice(0, 4).map((c) => {
            const other = employees.find((x) => x.id === c.employeeId)
            return other ? (
              <button key={c.employeeId} className="row-btn" onClick={() => actions.openSheet({ kind: 'employee', id: c.employeeId })}>
                <span className="row gap"><Avatar employee={other} size={16} /> {other.name.split(' ')[0]}</span>
                <span className="faint small">{[c.handedTo ? `${c.handedTo} built on ${e.name.split(' ')[0]}’s work` : '', c.receivedFrom ? `${e.name.split(' ')[0]} built on ${c.receivedFrom}` : ''].filter(Boolean).join(' · ')}</span>
              </button>
            ) : null
          })}
        </section>
      )}
      <Personality id={id} />
      <SuggestBreak id={id} />
      <TeammateRecord id={id} />
      {recent.length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Recently finished here</div>
          {recent.map((t) => (
            <button key={t.id} className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
              <span>{t.title}</span>
              <span className="faint small">{t.finishedAt ? timeAgo(t.finishedAt) : ''}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

// ── task ─────────────────────────────────────────────────────

function TaskView({ id }: { id: string }) {
  const task = useApp((s) => s.tasks[id] as Task | undefined)
  const all = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const runs = useApp(sortedRuns)
  const approvals = useApp(pendingApprovals)
  const statuses = useApp((s) => s.statuses)
  const project = useApp(activeProject)
  const naming = useNaming()
  useTicker(task?.status === 'running')
  if (!task) return <div className="sheet-pad muted">This step belongs to another product.</div>
  const owner = employees.find((e) => e.id === task.assigneeId)
  const attempts = runs.filter((r) => r.taskId === id)
  const lastRun = attempts[0]
  const decision = approvals.find((a) => a.taskId === id)
  const can = taskActions(task)
  const item = [...Object.values(missionOf({ tasks: all, approvals, paused: project?.paused, busyName: (e) => (statuses[e] && ['working', 'testing'].includes(statuses[e].activity) ? naming.nameOf(e) : null), nameOf: naming.nameOf }))].flat().find((i) => i.task.id === id)
  const before = task.dependsOn.flatMap((d) => all.find((t) => t.id === d) ?? [])
  const afterIt = all.filter((t) => t.dependsOn.includes(id))
  const here = statuses[task.assigneeId]?.taskId === id ? statuses[task.assigneeId] : null
  const stopIt = async () => {
    if (await confirmAction({ title: 'Stop this step?', body: `“${task.title}” stops now and won’t start again. Anything not finished in it is left out.`, action: 'Stop it', danger: true })) await actions.run(() => window.autopia.stopTask(task.id))
  }
  return (
    <div className="sheet-pad td">
      <div className="row between">
        {owner ? (
          <button className="who who-sm" onClick={() => actions.openSheet({ kind: 'employee', id: owner.id })}>
            <Avatar employee={owner} size={20} /> <span>{owner.name}</span>
          </button>
        ) : (
          <span className="faint small">Step</span>
        )}
        <Pill tone={TASK_TONE[task.status]} pulse={task.status === 'running'}>
          {TASK_LABEL[task.status]}
        </Pill>
      </div>
      <h3 className="td-title">{task.title}</h3>
      {item?.reason && !decision && <p className={`small td-why${item.state === 'needsYou' || item.state === 'blocked' ? ' bad-text' : ' muted'}`}>{naming.human(item.reason)}</p>}
      {here?.detail && <p className="small muted mono-line">{here.detail}</p>}
      {decision && <div className="thread-card">{<ApprovalCard approval={decision} more={0} />}</div>}
      {task.recovery && task.status === 'interrupted' && task.recovery.preserved.length > 0 && (
        <ul className="small muted td-preserved">
          {task.recovery.preserved.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      <div className="action-row">
        {can.retry && !decision && (
          <button className="btn btn-sm btn-primary" onClick={() => actions.run(() => window.autopia.retryTask(task.id))}>
            <Icon name="retry" size={12} /> Try again
          </button>
        )}
        {lastRun && (
          <button className="btn btn-sm" onClick={() => actions.openSheet({ kind: 'log', runId: lastRun.id })}>
            <Icon name="activity" size={12} /> {task.status === 'running' ? 'Watch live' : 'Session log'}
          </button>
        )}
        {task.deliveryId && task.status === 'done' && (
          <button className="btn btn-sm" onClick={() => actions.openDelivery(task.deliveryId!)}>
            <Icon name="eye" size={12} /> See the result
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => (actions.openSheet({ kind: 'conversation' }), actions.compose({ taskId: task.id }))}>
          Ask about this
        </button>
        {can.stop && !decision && (
          <button className="btn btn-sm btn-ghost" onClick={() => void stopIt()}>
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
      </div>

      {(can.instruct || can.correct) && <TaskInstruction task={task} />}

      <section className="sheet-section">
        <div className="section-label">What it does</div>
        <LongText text={task.description} />
        <div className="section-label">Done when</div>
        <LongText text={task.acceptance} />
        {task.rationale && (
          <>
            <div className="section-label">Why this step</div>
            <LongText text={task.rationale} />
          </>
        )}
      </section>

      {can.priority && (
        <section className="sheet-section">
          <div className="section-label">Who</div>
          <label className="td-owner small">
            <span className="muted">Owner</span>
            <select className="select select-sm" value={task.assigneeId} onChange={(ev) => actions.run(() => window.autopia.reassignTask(task.id, ev.target.value))}>
              {employees.filter((e) => e.kinds.includes(task.kind)).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {(before.length > 0 || afterIt.length > 0) && (
        <section className="sheet-section">
          {before.length > 0 && <div className="section-label">Builds on</div>}
          {before.map((t) => (
            <button key={t.id} className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
              <span>{t.title}</span>
              <span className="faint small">{TASK_LABEL[t.status]}</span>
            </button>
          ))}
          {afterIt.length > 0 && <div className="section-label">Waiting on this</div>}
          {afterIt.map((t) => (
            <button key={t.id} className="row-btn" onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
              <span>{t.title}</span>
              <span className="faint small">{TASK_LABEL[t.status]}</span>
            </button>
          ))}
        </section>
      )}

      {task.lastError && task.status !== 'done' && !item?.reason?.includes(task.lastError.split('\n')[0].slice(0, 60)) && <div className="callout callout-danger small">{naming.human(task.lastError.split('\n')[0])}</div>}

      {task.resultSummary && (
        <section className="sheet-section">
          <div className="section-label">What was done</div>
          <LongText text={naming.human(task.resultSummary)} />
        </section>
      )}
      {(task.criteria ?? []).length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Requirements, as the teammate reported them</div>
          <ul className="check-list">
            {task.criteria.map((c) => (
              <li key={c.criterion}>
                <Icon name={c.met ? 'check' : 'close'} size={11} /> <span>{c.criterion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {task.checks.length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Checks</div>
          <ul className="check-list">
            {task.checks.map((c) => (
              <li key={c.command}>
                <Icon name={c.status === 'passed' ? 'check' : c.status === 'failed' ? 'close' : 'alert'} size={11} /> <span className="mono">{c.command}</span>
                <span className="faint small">{c.status === 'missing' ? 'not run' : c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {task.changedFiles.length > 0 && (
        <section className="sheet-section">
          <div className="section-label">Files changed</div>
          {task.changedFiles.slice(0, 12).map((f) => {
            const path = f.replace(/^\S+\s+/, '')
            return (
              <button key={f} className="row-btn mono small" onClick={() => store.setState({ view: 'workspace', section: 'files', openFilePath: path })}>
                <span>{path}</span>
              </button>
            )
          })}
          {task.changedFiles.length > 12 && <p className="small faint">and {task.changedFiles.length - 12} more</p>}
        </section>
      )}
      {lastRun && <details className="sheet-section td-activity"><summary className="section-label">What it did{attempts.length > 1 ? ` · ${attempts.length} attempts` : ''}</summary>{attempts.length > 1 && (
        <ul className="td-attempts small">
          {attempts.map((r) => (
            <li key={r.id}>
              <button className="link small" onClick={() => actions.openSheet({ kind: 'log', runId: r.id })}>{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</button>
              <span className="faint"> · {r.status}{r.endedAt ? ` · ${duration(r.startedAt, r.endedAt)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}<WhatItDid runId={lastRun.id} /></details>}
    </div>
  )
}

/** Tell the team about this step. What you asked and what's confirmed stay apart: the state comes from the record. */
function TaskInstruction({ task }: { task: Task }) {
  const project = useApp(activeProject)
  const messages = useApp((s) => s.messages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const said = messages.filter((m) => m.role === 'user' && (m.routing?.targets.some((t) => t.taskId === task.id) || (m.taskId === task.id && m.intent !== 'ask')))
  const done = task.status === 'done'
  const send = async () => {
    if (!project || !text.trim()) return
    setSending(true)
    const openNow = store.getState().deliveries.some((d) => ['implementing', 'validating'].includes(d.status))
    // a finished step, with nothing else open, becomes a new request about it. Everything else stays with the work
    const sent = await actions.run(() => window.autopia.sendMessage({ projectId: project.id, intent: done && !openNow ? 'change' : 'note', text: text.trim(), attachments: [], employeeId: null, taskId: task.id, deliveryId: null, instruction: true }))
    setSending(false)
    if (sent) setText('')
  }
  return (
    <section className="sheet-section td-instruct">
      <label className="section-label" htmlFor={`instruct-${task.id}`}>{done ? 'Ask for a correction' : task.status === 'running' ? 'Add an instruction' : 'Add or refine what’s needed'}</label>
      <textarea
        id={`instruct-${task.id}`}
        className="input"
        rows={2}
        value={text}
        disabled={sending}
        placeholder={done ? 'What should be different?' : 'What should the team know about this step?'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
        }}
      />
      {text.trim() && (
        <div className="row between td-send">
          <span className="small faint">{done ? 'Starts new work on this.' : task.status === 'running' ? 'Reaches it at the next safe moment. Nothing is interrupted.' : 'Goes in when this step starts.'}</span>
          <button className="btn btn-sm btn-primary" disabled={sending} onClick={() => void send()} data-tip="⌘↵">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
      {said.length > 0 && (
        <ul className="td-said">
          {said.slice(-4).map((m) => (
            <li key={m.id} className="small">
              <span>{m.text.slice(0, 200)}</span>
              <span className="faint">{routingLabel(m.status, m.routing) ?? 'Sent'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── project ──────────────────────────────────────────────────

function LogView({ runId }: { runId: string }) {
  useEffect(() => {
    store.setState({ focusedRunId: runId })
    if (!store.getState().events[runId]) void actions.loadEvents(runId)
  }, [runId])
  return (
    <div className="sheet-log">
      <SessionPanel runId={runId} />
    </div>
  )
}

/** Find them in the office, and keep following as they move (moving the camera yourself stops it). */
function FollowButton({ id }: { id: string }) {
  const following = useApp((s) => s.followingId === id)
  return (
    <button
      className={`btn btn-sm btn-ghost${following ? ' active' : ''}`}
      aria-pressed={following}
      onClick={() => (following ? officeCamera.stopFollowing() : officeCamera.focusEmployee(id))}
      data-tip={following ? 'Following. Drag or scroll the office to stop.' : 'Find them in the office and follow'}
    >
      <Icon name="target" size={12} /> {following ? 'Following' : 'Follow'}
    </button>
  )
}

/**
 * Who they are, from the same personality the office simulates: a short description, the traits
 * that stand out, favourite breaks, habits, the colleagues they know best and how they are with Puffy.
 */
/** Who they are and what they've really done, across every project. Fetched only when opened. */
function TeammateRecord({ id }: { id: string }) {
  const e = useApp((s) => s.employees.find((x) => x.id === id))
  const activity = useApp((s) => s.statuses[id]?.activity)
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    void window.autopia.employeeProfile(id).then((p) => live && setProfile(p))
    return () => {
      live = false
    }
  }, [id, open, activity])
  if (!e) return null
  return (
    <details className="sheet-section teammate-record" onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary className="section-label">Background and record</summary>
      <p className="small">{e.bio}</p>
      <p className="small muted">{e.specialization}</p>
      <div className="caps">
        {e.capabilities.map((c) => (
          <span key={c} className="cap">
            {CAPABILITY_LABEL[c]}
          </span>
        ))}
      </div>
      {profile && (
        <>
          <div className="emp-stats">
            <div>
              <strong>{profile.stats.shipped}</strong>
              <span>shipped</span>
            </div>
            <div>
              <strong>{profile.stats.sessions}</strong>
              <span>sessions</span>
            </div>
            <div>
              <strong>{profile.stats.avgTaskMs ? duration(0, profile.stats.avgTaskMs) : '—'}</strong>
              <span>avg step</span>
            </div>
            <div>
              <strong>{profile.stats.checkPassRate === null ? '—' : `${Math.round(profile.stats.checkPassRate * 100)}%`}</strong>
              <span>checks passed</span>
            </div>
            <div>
              <strong>{money(profile.stats.costUsd)}</strong>
              <span>spend</span>
            </div>
          </div>
          {profile.history.length === 0 ? (
            <p className="small muted">No assignments yet.</p>
          ) : (
            profile.history.map((h) => (
              <button key={h.taskId} className="row-btn" onClick={() => void actions.openProject(h.projectId).then(() => actions.openSheet({ kind: 'task', id: h.taskId }))}>
                <span>
                  {h.title}
                  <span className="faint small"> · {h.projectName}</span>
                </span>
                <Pill tone={TASK_TONE[h.status]}>{TASK_LABEL[h.status]}</Pill>
              </button>
            ))
          )}
        </>
      )}
    </details>
  )
}

function Personality({ id }: { id: string }) {
  const e = useApp((s) => s.employees.find((x) => x.id === id))
  const team = useApp((s) => s.employees)
  useTicker(true, 8000) // friendships grow slowly; a gentle refresh is enough
  if (!e) return null
  const p = profileFor(e)
  const first = e.name.split(' ')[0]
  const friends = relationships
    .favorites(id, team.map((x) => x.id))
    .slice(0, 3)
    .map((fid) => ({ e: team.find((x) => x.id === fid)!, f: relationships.familiarity(id, fid) }))
    .filter((x) => x.e)
  return (
    <section className="sheet-section persona">
      <div className="section-label">Personality</div>
      <p className="persona-line">{describePerson(first, p)}</p>
      <div className="persona-chips">
        {standoutTraits(p.traits).map((c) => (
          <span key={c.key} className="persona-chip" style={{ ['--s' as string]: c.strength.toFixed(2) }}>
            {c.word}
          </span>
        ))}
      </div>
      <dl className="persona-facts">
        <dt>Favourite breaks</dt>
        <dd>{preferredBreaks(p).join(', ')}</dd>
        <dt>Habits</dt>
        <dd>{p.habits.map((h) => HABIT_LABEL[h]).join(' · ')}</dd>
        <dt>Knows best</dt>
        <dd className="persona-friends">
          {friends.map(({ e: f, f: fam }) => (
            <button key={f.id} className="persona-friend" onClick={() => actions.select(f.id)} data-tip={`${closeness(fam)} · open ${f.name.split(' ')[0]}'s profile`}>
              <Avatar employee={f} size={18} />
              <span>{f.name.split(' ')[0]}</span>
              <span className="faint">{closeness(fam)}</span>
            </button>
          ))}
        </dd>
        <dt>Puffy</dt>
        <dd>{dogLine(first, p.traits, relationships.dogFamiliarity(id))}</dd>
      </dl>
    </section>
  )
}

/** Suggest a break. Only what the office can actually do right now; real work always comes first. */
function SuggestBreak({ id }: { id: string }) {
  const activity = useApp((s) => s.statuses[id]?.activity ?? 'idle')
  const [reply, setReply] = useState<{ text: string; tone: string } | null>(null)
  useTicker(true, 2000) // availability changes as people move around
  useEffect(() => setReply(null), [id, activity])
  const options = officeActions.suggestionOptions(id)
  const busy = activity !== 'idle'
  const suggest = (what: SuggestionId) => {
    const r = officeActions.suggest(id, what)
    setReply({ text: r.text, tone: r.answer })
  }
  return (
    <section className="sheet-section">
      <div className="section-label">Suggest a break</div>
      {busy ? (
        <p className="small muted">On real work right now. Breaks wait until it's done.</p>
      ) : (
        <div className="suggest-grid">
          {options.map((o) => (
            <button key={o.id} className="suggest-btn" disabled={!o.ok} onClick={() => suggest(o.id)} data-tip={o.why ?? o.label}>
              <Icon name={o.icon} size={12} />
              {o.label}
            </button>
          ))}
        </div>
      )}
      {reply && <p className={`suggest-reply t-${reply.tone}`}>{reply.text}</p>}
    </section>
  )
}
