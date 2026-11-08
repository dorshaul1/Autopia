import { DOING_LABEL, doingOf } from '@shared/workActivity'
import { useRef, useState, type ReactNode } from 'react'
import { DESKS, INTERACTIVES, ZONE_LABEL, ZONE_PURPOSE, type ZoneId } from '../office/layout'
import { officeActions, officeCamera } from '../office/OfficeView'
import { LOUNGE_CHANNELS } from '../office/screens'
import { RECEPTIONIST, receptionDigest } from '../office/reception'
import { activeProject, actions, sortedRuns, sortedTasks, store, useApp } from '../store'
import { ACTIVITY_LABEL, ACTIVITY_TONE, Avatar, Icon, PHASE_LABEL, Pill, money } from './common'
import { useDismiss } from './ui'

/** Card anchored to a clicked world object; the scene keeps it positioned. Shows only real data. */
export function WorldInspector() {
  const id = useApp((s) => s.inspect)
  const item = INTERACTIVES.find((i) => i.id === id)
  const card = useRef<HTMLDivElement>(null)
  // the office decides for itself what a click on it means; the front desk chip toggles this card
  useDismiss(card, !!item, () => store.setState({ inspect: null }), (t) => t.tagName === 'CANVAS' || !!t.closest('.team-chip'))
  if (!item) return null
  return (
    <div id="world-inspector" className="hud inspector" ref={card}>
      <button className="inspector-close" aria-label="Close" onClick={() => store.setState({ inspect: null })}>
        <Icon name="close" size={12} />
      </button>
      <div className="inspector-title">{item.label}</div>
      <InspectorBody id={item.id} />
    </div>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="inspector-row">
      <span>{k}</span>
      <span>{children}</span>
    </div>
  )
}

function InspectorBody({ id }: { id: string }) {
  const s = useApp((st) => st)
  const project = useApp(activeProject)
  const tasks = useApp(sortedTasks)
  const runs = useApp(sortedRuns)
  const [note, setNote] = useState<string | null>(null)

  if (id.startsWith('room:')) return <RoomBody zone={id.slice(5) as ZoneId} />

  if (id.startsWith('desk:')) {
    const deskId = id.slice(5)
    const e = s.employees.find((m) => m.deskId === deskId)
    if (!e || !DESKS[deskId]) return null
    const st = s.statuses[e.id]
    const activity = st?.activity ?? 'idle'
    const task = st?.taskId ? s.tasks[st.taskId] : null
    return (
      <>
        <div className="inspector-person">
          <Avatar employee={e} size={28} />
          <div>
            <div className="inspector-name">{e.name}</div>
            <Pill tone={ACTIVITY_TONE[activity]} pulse={activity === 'working' || activity === 'testing'}>
              {doingOf(st) ? DOING_LABEL[doingOf(st)!] : ACTIVITY_LABEL[activity]}
            </Pill>
          </div>
        </div>
        {task && <Row k="Task">{task.title}</Row>}
        {st?.detail && activity !== 'idle' && <div className="inspector-mono">{st.detail}</div>}
        <div className="inspector-actions">
          <button onClick={() => actions.select(e.id)}>Details</button>
          {st?.runId && <button onClick={() => actions.openSheet({ kind: 'log', runId: st.runId! })}>Live log</button>}
        </div>
      </>
    )
  }

  if (id === 'meeting') {
    const planning = runs.find((r) => r.kind === 'planning')
    return (
      <>
        <Row k="Status">{project?.phase === 'planning' ? 'Planning in progress' : 'Free'}</Row>
        {planning && <Row k="Last planning">{`${planning.status} · ${planning.costUsd != null ? money(planning.costUsd) : '—'}`}</Row>}
        {project?.planSummary && <p className="inspector-text">{project.planSummary}</p>}
        <div className="inspector-actions">
          {planning && <button onClick={() => actions.openSheet({ kind: 'log', runId: planning.id })}>Planning log</button>}
        </div>
      </>
    )
  }

  if (id === 'kanban') {
    const count = (f: (t: (typeof tasks)[number]) => boolean) => tasks.filter(f).length
    return (
      <>
        <Row k="To do">{count((t) => t.status === 'pending' || t.status === 'proposed')}</Row>
        <Row k="Doing">{count((t) => t.status === 'running' || t.status === 'merging')}</Row>
        <Row k="Done">{count((t) => t.status === 'done' || t.status === 'cancelled')}</Row>
        {count((t) => t.status === 'failed' || t.status === 'interrupted') > 0 && (
          <Row k="Blocked">{count((t) => t.status === 'failed' || t.status === 'interrupted')}</Row>
        )}
        <div className="inspector-actions">
          <button onClick={() => actions.openSheet({ kind: 'conversation' })}>See current work</button>
        </div>
      </>
    )
  }

  if (id === 'coffee') {
    return (
      <>
        <p className="inspector-text">Two-group espresso machine. Purely for morale: brewing never uses Claude.</p>
        {note && <div className="inspector-mono">{note}</div>}
        <div className="inspector-actions">
          <button
            onClick={() => {
              const who = officeActions.brewCoffee()
              setNote(who ? `${who} is grabbing a cup.` : 'Brewing… everyone is busy right now.')
            }}
          >
            <Icon name="coffee" size={12} /> Brew a coffee
          </button>
        </div>
      </>
    )
  }

  if (id === 'aquarium') {
    return (
      <>
        <p className="inspector-text">Four fish, zero merge conflicts.</p>
        <div className="inspector-actions">
          <button onClick={() => officeActions.feedFish()}>
            <Icon name="fish" size={12} /> Feed the fish
          </button>
        </div>
      </>
    )
  }

  if (id === 'roadmap') {
    const projects = Object.values(s.projects).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)
    return (
      <>
        <p className="inspector-text">One row per product: plan, approve, build, verify, ship.</p>
        {projects.map((p) => (
          <Row key={p.id} k={p.name}>
            {PHASE_LABEL[p.phase]}
          </Row>
        ))}
        <div className="inspector-actions">
          <button onClick={() => store.setState({ view: 'home' })}>All products</button>
        </div>
      </>
    )
  }

  if (id === 'focus') {
    const consult = Object.values(s.statuses).find((st) => st.activity === 'reviewing' && st.detail?.startsWith('Answering'))
    const who = consult && s.employees.find((e) => e.id === consult.employeeId)
    return (
      <>
        <Row k="Status">{consult ? 'Consultation in progress' : 'Free'}</Row>
        {who && <Row k="Answering">{`${who.name.split(' ')[0]} · ${consult!.detail}`}</Row>}
        <p className="inspector-text">Teammates meet here when one asks another for design or architecture input. Each consultation is a real, read-only Claude Code session.</p>
        {consult?.runId && (
          <div className="inspector-actions">
            <button onClick={() => actions.openSheet({ kind: 'log', runId: consult.runId! })}>Live log</button>
          </div>
        )}
      </>
    )
  }

  if (id === 'printer') {
    return (
      <>
        <p className="inspector-text">Multifunction printer and shredder. People stop by between tasks; nothing is actually printed.</p>
        <div className="inspector-actions">
          <button onClick={() => officeActions.printTestPage()}>Print a test page</button>
        </div>
      </>
    )
  }

  if (id === 'loungeTv') return <LoungeTv />

  if (id === 'receptionist') return <FrontDesk />

  if (id === 'microwave') {
    return (
      <>
        <p className="inspector-text">Shared microwave. Six seconds, one ding.</p>
        {note && <div className="inspector-mono">{note}</div>}
        <div className="inspector-actions">
          <button onClick={() => setNote(officeActions.heatLunch() ? 'Heating… stand back.' : 'Already running.')}>Heat up lunch</button>
        </div>
      </>
    )
  }

  if (id === 'fridge') {
    return (
      <Notes
        intro="Notes on the door:"
        lines={['Label your lunch. — Ops', 'Whoever ate my yogurt: git blame is coming.', 'Oat milk is a shared resource. Please release it.']}
      />
    )
  }

  if (id === 'menu') {
    return (
      <Notes
        intro="Today's menu:"
        lines={['Espresso — compiles in 25 s', 'Flat white — zero merge conflicts', 'Cold brew — runs overnight, like the nightly build', 'Decaf — ask in #ops']}
      />
    )
  }

  if (id === 'whiteboard') {
    return (
      <Notes
        intro="Still on the board from the last retro:"
        lines={['Definition of done: works on more than one machine', 'Estimate × π ≈ actual', 'Naming things → next sprint', 'DO NOT ERASE']}
      />
    )
  }

  if (id === 'moodboard') {
    const designer = s.employees.find((e) => e.capabilities.includes('ui-design'))
    return <p className="inspector-text">{designer ? `${designer.name.split(' ')[0]}'s moodboard: references, swatches and sketches for the studio.` : 'References, swatches and sketches.'}</p>
  }

  if (id === 'sign') {
    const projects = Object.values(s.projects)
    const shipped = projects.filter((p) => p.phase === 'completed').length
    const spend = runs.reduce((n, r) => n + (r.costUsd ?? 0), 0)
    return (
      <>
        <Row k="Projects">{projects.length}</Row>
        <Row k="Shipped">{shipped}</Row>
        {project && <Row k="Current">{`${project.name} · ${PHASE_LABEL[project.phase]}`}</Row>}
        {project && <Row k="Spend (current)">{money(spend)}</Row>}
      </>
    )
  }
  return null
}

/** The front desk: a short digest of what the app already knows. Whoever sits here can chat, but takes on no work. */
function FrontDesk() {
  const s = useApp((st) => st)
  const d = receptionDigest(s)
  const openNeeds = async (projectId: string) => {
    if (store.getState().activeProjectId !== projectId) await actions.openProject(projectId)
    actions.openSheet({ kind: 'conversation' })
  }
  const quiet = !d.needs.length && !d.ready.length && !d.working.length && !d.finished.length
  return (
    <>
      <p className="inspector-text">{RECEPTIONIST.role}. Keeps an eye on the front desk; not on the team, and no work goes to this desk.</p>
      <button className="btn btn-sm" onClick={() => actions.talkTo(RECEPTIONIST.id)}>
        Message {RECEPTIONIST.name}
      </button>
      {d.needs.length > 0 && (
        <div className="desk-section">
          <div className="desk-head attn">Needs you · {d.needs.length}</div>
          {d.needs.slice(0, 3).map((n) => (
            <button key={n.id} className="desk-item" onClick={() => void openNeeds(n.projectId)} data-tip={n.title}>
              <span>{n.title}</span>
              <span className="desk-meta">{n.project}</span>
            </button>
          ))}
        </div>
      )}
      {d.ready.length > 0 && (
        <div className="desk-section">
          <div className="desk-head">Ready to review</div>
          {d.ready.map((r) => (
            <button key={r.id} className="desk-item" onClick={() => actions.openResult(r.id)} data-tip={r.request}>
              <span>Result #{r.number}</span>
              <span className="desk-meta">{r.request}</span>
            </button>
          ))}
        </div>
      )}
      <div className="desk-section">
        <div className="desk-head">In the office now</div>
        {d.working.length ? (
          d.working.slice(0, 4).map((w) => (
            <button key={w.id} className="desk-item" onClick={() => actions.select(w.id)} data-tip={w.detail ?? undefined}>
              <span>{w.name}</span>
              <span className="desk-meta">{w.detail ?? 'Working'}</span>
            </button>
          ))
        ) : (
          <div className="desk-empty">Nobody is on a task right now.</div>
        )}
      </div>
      {d.finished.length > 0 && (
        <div className="desk-section">
          <div className="desk-head">Recently finished</div>
          {d.finished.map((f) => (
            // the whole title wraps (two lines), shows in full on hover, and opens the task
            <button key={f.id} className="desk-item" onClick={() => actions.openSheet({ kind: 'task', id: f.id })} data-tip={`${f.label} · Open the task`}>
              <span>{f.label}</span>
              <span className="desk-meta">{f.who ?? ''}</span>
            </button>
          ))}
        </div>
      )}
      {quiet && <div className="desk-empty">All quiet: nothing waiting on you and nothing finished yet.</div>}
    </>
  )
}

/** Handwritten office notes: decoration, clearly not project data. */
function Notes({ intro, lines }: { intro: string; lines: string[] }) {
  return (
    <>
      <p className="inspector-text">{intro}</p>
      <ul className="inspector-notes">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  )
}

/** The lounge TV: the founder picks the channel. The team channel shows only real activity. */
function LoungeTv() {
  const [channel, setChannel] = useState(officeActions.loungeChannel())
  const hint = {
    auto: 'Shows the game whenever someone is playing in the lounge.',
    team: 'Who is on real work right now, and the current project’s real task progress.',
    skyline: 'A quiet city view that follows the office daylight.',
    off: 'Standby.'
  }[channel]
  return (
    <>
      <p className="inspector-text">{hint}</p>
      <div className="inspector-actions" role="group" aria-label="TV channel">
        {LOUNGE_CHANNELS.map((c) => (
          <button
            key={c.id}
            aria-pressed={channel === c.id}
            onClick={() => {
              officeActions.setLoungeChannel(c.id)
              setChannel(c.id)
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </>
  )
}

function LightSwitch({ zone }: { zone: ZoneId }) {
  const [mode, setMode] = useState(officeActions.lightsIn(zone))
  const label = { auto: 'Auto', on: 'On', off: 'Off' } as const
  return (
    <div className="inspector-select">
      <span>Lights</span>
      <div className="inspector-actions inspector-segment" role="group" aria-label="Lights">
        {(['auto', 'on', 'off'] as const).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              officeActions.setLights(zone, m)
              setMode(m)
            }}
          >
            {label[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Room card: what the room is for, who's in it now, and anything real happening there. */
function RoomBody({ zone }: { zone: ZoneId }) {
  const employees = useApp((s) => s.employees)
  const statuses = useApp((s) => s.statuses)
  const project = useApp(activeProject)
  const here = officeActions.occupants(zone).map((id) => employees.find((e) => e.id === id)).filter(Boolean)
  const working = here.filter((e) => (statuses[e!.id]?.activity ?? 'idle') !== 'idle')
  return (
    <>
      <p className="inspector-text">{ZONE_PURPOSE[zone]}</p>
      <Row k="Here now">{here.length ? here.map((e) => e!.name.split(' ')[0]).join(', ') : 'Nobody'}</Row>
      {working.length > 0 && <Row k="On real work">{working.map((e) => e!.name.split(' ')[0]).join(', ')}</Row>}
      {zone === 'meeting' && <Row k="Planning">{project?.phase === 'planning' ? 'In progress' : 'Not in session'}</Row>}
      <LightSwitch key={zone} zone={zone} />
      <div className="inspector-actions">
        <button onClick={() => officeCamera.focusZone(zone)}>Zoom to {ZONE_LABEL[zone]}</button>
      </div>
    </>
  )
}
