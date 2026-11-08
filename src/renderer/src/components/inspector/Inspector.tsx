import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cleanPaths, readableEvent } from '@shared/activityText'
import { inspectFilter, logWindow, sessionFacts, type InspectView } from '@shared/decisions'
import { runSkillsLine } from '@shared/skills'
import type { Run, RunEvent } from '@shared/types'
import { actions, sortedRuns, store, useApp } from '../../store'
import { Avatar, Icon, duration, money, timeAgo, toolIcon, useTicker, type IconName } from '../common'
import { Segmented } from '../ui'

const RUN_WORD: Record<Run['status'], string> = { running: 'Running', succeeded: 'Finished', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted' }
const PAGE = 300

const VIEWS: { value: InspectView; label: string }[] = [
  { value: 'story', label: 'What happened' },
  { value: 'tools', label: 'Tools' },
  { value: 'problems', label: 'Problems' },
  { value: 'decisions', label: 'Your decisions' },
  { value: 'everything', label: 'Everything' }
]

/** Every Claude Code session on this product: a readable account first, the raw record on request. */
export function Inspector() {
  const runs = useApp(sortedRuns)
  const focused = useApp((s) => s.focusedRunId)
  const run = runs.find((r) => r.id === focused) ?? runs[0]
  if (!runs.length) {
    return (
      <div className="ins-empty">
        <h2>No sessions yet</h2>
        <p className="muted">When the team starts work, every Claude Code session is recorded here: what it did, what it changed, and anything that went wrong.</p>
      </div>
    )
  }
  return (
    <div className="ins">
      <nav className="ins-runs" aria-label="Sessions">
        {runs.slice(0, 60).map((r) => (
          <RunRow key={r.id} run={r} active={r.id === run.id} />
        ))}
      </nav>
      <RunDetail key={run.id} runId={run.id} />
    </div>
  )
}

/** One session in the side panel. */
export function SessionPanel({ runId }: { runId: string }) {
  return (
    <div className="ins-panel">
      <RunDetail key={runId} runId={runId} />
    </div>
  )
}

function RunRow({ run, active }: { run: Run; active: boolean }) {
  const employee = useApp((s) => s.employees.find((e) => e.id === run.employeeId))
  const task = useApp((s) => (run.taskId ? s.tasks[run.taskId] : null))
  return (
    <button className={`ins-run${active ? ' on' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => store.setState({ focusedRunId: run.id })}>
      {employee && <Avatar employee={employee} size={20} />}
      <span className="ins-run-text">
        <span className="ins-run-title">{titleOf(run, task?.title)}</span>
        <span className="small faint">
          {employee?.name.split(' ')[0]} · {timeAgo(run.startedAt)}
        </span>
      </span>
      <span className={`ins-dot st-${run.status}`} aria-label={RUN_WORD[run.status]} />
    </button>
  )
}

const titleOf = (run: Run, task?: string | null) => (run.kind === 'planning' ? 'Planning' : run.kind === 'ask' ? 'A reply to you' : (task ?? 'Session'))

function RunDetail({ runId }: { runId: string }) {
  const run = useApp((s) => s.runs[runId] as Run | undefined)
  const events = useApp((s) => s.events[runId])
  const employee = useApp((s) => s.employees.find((e) => e.id === run?.employeeId))
  const task = useApp((s) => (run?.taskId ? s.tasks[run.taskId] : null))
  const waiting = useApp((s) => (run ? Object.values(s.statuses).some((x) => x.runId === run.id && x.needsYou) : false))
  const [view, setView] = useState<InspectView>('story')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [technical, setTechnical] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useTicker(run?.status === 'running')
  useEffect(() => {
    if (!events) void actions.loadEvents(runId)
  }, [runId, events])

  const all = events ?? []
  const facts = useMemo(() => sessionFacts(all), [all])
  const q = query.trim().toLowerCase()
  const matching = useMemo(() => all.filter((e) => inspectFilter(view, e) && (!q || `${e.summary} ${e.toolName ?? ''} ${e.detail ?? ''}`.toLowerCase().includes(q))), [all, view, q])
  const { rows, hidden } = logWindow(matching, shown)
  useEffect(() => setShown(PAGE), [view, q])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [rows.length, view])

  if (!run) return <div className="ins-detail muted small">This session belongs to another product.</div>
  const skills = run.skills ? runSkillsLine(run.skills) : null
  const state = waiting ? 'Waiting for you' : RUN_WORD[run.status]
  const lastTool = run.status === 'running' ? [...all].reverse().find((e) => e.kind === 'tool_use' || e.kind === 'tool_result') : null
  const inProgress = lastTool?.kind === 'tool_use' ? lastTool.id : null
  return (
    <section className="ins-detail">
      <header className="ins-head">
        {employee && <Avatar employee={employee} size={30} />}
        <div className="ins-head-text">
          <h3>{titleOf(run, task?.title)}</h3>
          <p className="small muted">
            {[employee?.name.split(' ')[0], state, duration(run.startedAt, run.endedAt), run.model].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="ins-links">
          {task && (
            <button className="btn btn-sm btn-ghost" onClick={() => actions.openSheet({ kind: 'task', id: task.id })}>
              The step
            </button>
          )}
          {task?.deliveryId && task.status === 'done' && (
            <button className="btn btn-sm btn-ghost" onClick={() => actions.openDelivery(task.deliveryId!)}>
              The result
            </button>
          )}
        </div>
      </header>

      {run.error && run.status !== 'running' && <div className="callout callout-danger small">{run.error}</div>}

      <dl className="ins-facts small">
        <div>
          <dt>Tools used</dt>
          <dd>{facts.toolCalls ? `${facts.toolCalls} calls: ${facts.tools.slice(0, 4).map((t) => `${t.name} ${t.count}`).join(', ')}${facts.tools.length > 4 ? ` and ${facts.tools.length - 4} more` : ''}` : 'None recorded'}</dd>
        </div>
        {facts.files.length > 0 && (
          <div>
            <dt>Files it wrote</dt>
            <dd className="mono">
              {facts.files.slice(0, 4).map((f) => cleanPaths(f, run.cwd)).join(', ')}
              {facts.files.length > 4 ? ` and ${facts.files.length - 4} more` : ''}
            </dd>
          </div>
        )}
        {skills && skills.given.length > 0 && (
          <div>
            <dt>Skills given</dt>
            <dd>{skills.given.join(', ')}</dd>
          </div>
        )}
        {skills && skills.used.length > 0 && (
          <div>
            <dt>Really used</dt>
            <dd>{skills.used.join(', ')}</dd>
          </div>
        )}
        {facts.mcp.length > 0 && (
          <div>
            <dt>Connected tools</dt>
            <dd>{facts.mcp.join(', ')}</dd>
          </div>
        )}
        {facts.problems > 0 && (
          <div>
            <dt>Problems</dt>
            <dd>
              <button className="link small" onClick={() => setView('problems')}>
                {facts.problems} recorded
              </button>
            </dd>
          </div>
        )}
      </dl>

      <div className="ins-tools">
        <Segmented label="Show" value={view} onChange={setView} options={VIEWS} />
        <input className="input ins-search" type="search" value={query} placeholder="Search this session" aria-label="Search this session" onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div
        className="ins-log"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!events && <p className="small muted">Reading the record…</p>}
        {events && !matching.length && <p className="small muted">{q ? `Nothing here matches “${query}”.` : view === 'problems' ? 'No problems recorded in this session.' : view === 'decisions' ? 'You weren’t asked anything in this session.' : 'Nothing recorded yet.'}</p>}
        {hidden > 0 && (
          <button className="link small ins-more" onClick={() => setShown(shown + PAGE)}>
            Show earlier ({hidden.toLocaleString()} more)
          </button>
        )}
        {rows.map((e) => (
          <EventRow key={e.id} event={e} cwd={run.cwd} raw={view === 'everything'} inProgress={e.id === inProgress} />
        ))}
        {run.status === 'running' && !waiting && (
          <p className="ins-live small muted">
            <span className="spinner spinner-sm" aria-hidden /> Still working
          </p>
        )}
      </div>

      <details className="ins-tech small" open={technical} onToggle={(e) => setTechnical(e.currentTarget.open)}>
        <summary>Technical details</summary>
        <dl>
          <dt>Session</dt>
          <dd className="mono">{run.sessionId ?? 'Not reported'}</dd>
          <dt>Folder</dt>
          <dd className="mono">{run.cwd}</dd>
          <dt>Started</dt>
          <dd>{new Date(run.startedAt).toLocaleString()}</dd>
          {run.numTurns != null && (
            <>
              <dt>Turns</dt>
              <dd>{run.numTurns}</dd>
            </>
          )}
          {run.inputTokens != null && (
            <>
              <dt>Tokens</dt>
              <dd>{((run.inputTokens ?? 0) + (run.outputTokens ?? 0) + (run.cacheReadTokens ?? 0) + (run.cacheWriteTokens ?? 0)).toLocaleString()}, as reported by Claude Code</dd>
            </>
          )}
          {run.costUsd != null && (
            <>
              <dt>API-equivalent</dt>
              <dd>{money(run.costUsd)}</dd>
            </>
          )}
          {run.effort && (
            <>
              <dt>Effort</dt>
              <dd>{run.effort}</dd>
            </>
          )}
        </dl>
      </details>
    </section>
  )
}

const KIND_ICON: Partial<Record<RunEvent['kind'], IconName>> = { init: 'play', thinking: 'brain', text: 'chat', result: 'flag', stderr: 'alert', error: 'alert', system: 'bolt' }

const EventRow = memo(function EventRow({ event, cwd, raw, inProgress }: { event: RunEvent; cwd: string; raw: boolean; inProgress: boolean }) {
  const [open, setOpen] = useState(false)
  const readable = readableEvent(event, cwd)
  const summary = raw ? (readable ?? cleanPaths(event.summary, cwd)) : readable
  const detail = event.detail ? cleanPaths(event.detail, cwd) : null
  const expandable = !!detail && detail !== summary
  if (summary === null) return null
  const icon = event.kind === 'tool_use' || event.kind === 'tool_result' ? toolIcon(event.toolName) : (KIND_ICON[event.kind] ?? 'bolt')
  const line = (
    <>
      <span className="ins-ev-icon">
        <Icon name={icon} size={12} />
      </span>
      <span className="ins-ev-text">{summary}</span>
      {inProgress && <span className="small muted">In progress</span>}
      <time className="small faint">{new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
    </>
  )
  return (
    <div className={`ins-ev${event.isError ? ' bad' : ''}`}>
      {expandable ? (
        <button className="ins-ev-line" aria-expanded={open} onClick={() => setOpen(!open)}>
          {line}
        </button>
      ) : (
        <div className="ins-ev-line">{line}</div>
      )}
      {open && detail && <pre className="ins-ev-detail">{detail}</pre>}
    </div>
  )
})
