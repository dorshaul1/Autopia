import { useMemo, useState } from 'react'
import { stagesOf } from '@shared/briefing'
import { deliveryFacts, missionHeadline, missionOf, type WorkItem } from '@shared/mission'
import { DOING_LABEL, doingOf } from '@shared/workActivity'
import type { Delivery, Task } from '@shared/types'
import { activeProject, actions, pendingApprovals, sortedTasks, useApp } from '../../store'
import { Avatar, Icon, duration, useNaming, useTicker } from '../common'

const STATE_WORD: Record<WorkItem['state'], string> = { needsYou: 'Needs you', now: 'In progress', blocked: 'Blocked', ready: 'Ready', waiting: 'Waiting', planned: 'In the plan', done: 'Done', dropped: 'Stopped' }

/**
 * The work, read top to bottom in the order you'd ask about it: what needs you, what's happening, what's next, what's
 * done. A list, because the work is a sequence of sentences, not a board to manage. It lives on the Overview.
 */
export function MissionControl() {
  const project = useApp(activeProject)!
  const tasks = useApp(sortedTasks)
  const approvals = useApp(pendingApprovals)
  const deliveries = useApp((s) => s.deliveries)
  const employees = useApp((s) => s.employees)
  const statuses = useApp((s) => s.statuses)
  const product = useApp((s) => s.product)
  const [showOrder, setShowOrder] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [doneShown, setDoneShown] = useState(50)
  useTicker(tasks.some((t) => t.status === 'running'))

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name.split(' ')[0] ?? null
  const busyName = (id: string) => (statuses[id] && ['working', 'testing'].includes(statuses[id].activity) ? nameOf(id) : null)
  const mission = useMemo(() => missionOf({ tasks, approvals, paused: project.paused, busyName, nameOf }), [tasks, approvals, project.paused, statuses, employees])
  const toReview = deliveries.filter((d) => d.status === 'review')
  const open = deliveries.find((d) => d.status === 'implementing' || d.status === 'validating') ?? null
  const milestone = product?.milestones.find((m) => m.status === 'active' || m.status === 'verifying') ?? null

  const planning = project.phase === 'planning'
  if (!tasks.length) return planning ? <p className="muted">The team is planning this. You’ll see the plan before anyone builds.</p> : null

  const stages = open ? stagesOf(tasks.filter((t) => t.deliveryId === open.id && t.status !== 'proposed')) : []
  return (
    <div
      className="mc"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.mc-open')]
        const at = rows.indexOf(document.activeElement as HTMLElement)
        if (at < 0) return
        e.preventDefault()
        rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus()
      }}
    >
      <header className="mc-head">
        <div className="mc-headline">
          <h2>{missionHeadline(mission, nameOf, { paused: project.paused, toReview: toReview.length })}</h2>
          {(open || milestone) && (
            <p className="muted small mc-goal">
              {milestone ? `Milestone ${milestone.n} of ${product!.milestones.length}: ${milestone.title}` : open!.request.split('\n')[0].slice(0, 160)}
            </p>
          )}
        </div>
        {(project.phase === 'executing' || project.paused) && (
          <button
            className="btn btn-sm btn-ghost"
            data-tip={project.paused ? 'Let new work start again' : 'Nothing new starts. Work already running finishes.'}
            onClick={() => actions.run(() => window.autopia.setProjectControls(project.id, { paused: !project.paused }))}
          >
            <Icon name={project.paused ? 'play' : 'stop'} size={12} /> {project.paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </header>

      {toReview.map((d) => (
        <ReadyToReview key={d.id} delivery={d} tasks={tasks} />
      ))}

      <WorkGroup title="Needs you" items={mission.needsYou} tone="attention" />
      <WorkGroup title="Happening now" note={mission.now.length > 1 ? 'Side by side, each in its own copy of the project' : undefined} items={mission.now} />
      <WorkGroup title="Up next" items={mission.next} />
      <WorkGroup title="In the plan, waiting for your OK" items={mission.planned} />

      {stages.length > 1 && (
        <section className="mc-group">
          <button className="mc-disclose" aria-expanded={showOrder} onClick={() => setShowOrder(!showOrder)}>
            <Icon name="chevron" size={10} /> How these steps fit together
          </button>
          {showOrder && (
            <ol className="mc-order">
              {stages.map((st) => (
                <li key={st.n}>
                  <span className="small faint mc-order-n">{st.tasks.length > 1 ? 'Together' : st.n === 1 ? 'First' : 'Then'}</span>
                  <span className="mc-order-steps">
                    {st.tasks.map((t) => (
                      <button key={t.id} className={`mc-step st-${t.status}`} onClick={() => actions.openSheet({ kind: 'task', id: t.id })}>
                        {t.title}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {mission.done.length + mission.dropped.length > 0 && (
        <section className="mc-group">
          <button className="mc-disclose" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <Icon name="chevron" size={10} /> Finished <span className="faint">{mission.done.length}</span>
            {mission.dropped.length > 0 && <span className="faint"> · {mission.dropped.length} stopped</span>}
          </button>
          {showDone && <ul className="mc-list">{[...mission.done, ...mission.dropped].slice(0, doneShown).map((i) => <WorkRow key={i.task.id} item={i} />)}</ul>}
          {showDone && mission.done.length + mission.dropped.length > doneShown && (
            <button className="link small" onClick={() => setDoneShown(doneShown + 50)}>
              Show more
            </button>
          )}
        </section>
      )}

    </div>
  )
}

function WorkGroup({ title, note, items, tone }: { title: string; note?: string; items: WorkItem[]; tone?: 'attention' }) {
  if (!items.length) return null
  return (
    <section className={`mc-group${tone ? ` tone-${tone}` : ''}`}>
      <h3>
        {title} <span className="faint">{items.length}</span>
        {note && <span className="faint mc-note"> · {note}</span>}
      </h3>
      <ul className="mc-list">
        {items.map((i) => (
          <WorkRow key={i.task.id} item={i} />
        ))}
      </ul>
    </section>
  )
}

function WorkRow({ item: { task, state, reason, holding } }: { item: WorkItem }) {
  const employee = useApp((s) => s.employees.find((e) => e.id === task.assigneeId))
  const status = useApp((s) => s.statuses[task.assigneeId])
  const naming = useNaming()
  const here = status?.taskId === task.id ? status : null
  const doing = here && doingOf(here)
  const line =
    state === 'now'
      ? [reason ?? (doing ? DOING_LABEL[doing] : null), here?.detail].filter(Boolean).join(' · ')
      : state === 'done'
        ? task.resultSummary
          ? naming.human(task.resultSummary.split('\n')[0])
          : null
        : reason && naming.human(reason)
  return (
    <li className={`mc-row st-${state}`}>
      <button className="mc-open" onClick={() => actions.openSheet({ kind: 'task', id: task.id })}>
        {employee && <Avatar employee={employee} size={24} />}
        <span className="mc-text">
          <span className="mc-title">{task.title}</span>
          <span className="mc-line small">
            {line && employee && line.startsWith(employee.name.split(' ')[0]) ? line : `${employee ? employee.name.split(' ')[0] : 'Unassigned'}${line ? ` · ${line}` : ''}`}
          </span>
        </span>
        {holding.length > 0 && state !== 'done' && <span className="small faint mc-holding">{holding.length} {holding.length === 1 ? 'step waits' : 'steps wait'} on this</span>}
        {task.startedAt && state === 'now' && <span className="small faint mc-time">{duration(task.startedAt, null)}</span>}
        <span className={`mc-state small st-${state}`}>
          {state === 'now' && <span className="spinner spinner-sm" aria-hidden />}
          {STATE_WORD[state]}
        </span>
      </button>
    </li>
  )
}

/** What came out of a request, in facts, and the two ways to look at it. The result itself lives in Preview and Review. */
function ReadyToReview({ delivery: d, tasks }: { delivery: Delivery; tasks: Task[] }) {
  const f = deliveryFacts(d, tasks)
  const facts = [
    `${f.finished} of ${f.steps} ${f.steps === 1 ? 'step' : 'steps'} finished`,
    f.criteriaTotal ? `${f.criteriaMet} of ${f.criteriaTotal} requirements reported met` : null,
    f.checksTotal ? `${f.checksPassed} of ${f.checksTotal} checks passed` : 'no checks recorded',
    f.files ? `${f.files} ${f.files === 1 ? 'file' : 'files'} changed` : null,
    f.limitations ? `${f.limitations} worth checking` : null
  ].filter(Boolean)
  return (
    <section className="mc-ready" aria-label={`Result ${d.number} is ready`}>
      <div className="mc-ready-text">
        <strong>Result #{d.number} is ready for you</strong>
        <span className="small mc-ready-what">{d.request.split('\n')[0].slice(0, 160)}</span>
        <span className="small faint">{facts.join(' · ')}</span>
      </div>
      <div className="mc-ready-actions">
        <button className="btn btn-sm btn-primary" onClick={() => actions.openResult(d.id)}>
          <Icon name="eye" size={12} /> Try it
        </button>
        <button className="btn btn-sm" onClick={() => actions.openDelivery(d.id)}>
          Review
        </button>
      </div>
    </section>
  )
}
