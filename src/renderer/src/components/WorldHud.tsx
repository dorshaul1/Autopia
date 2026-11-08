import { useEffect, useRef, useState } from 'react'
import { Switch, useDismiss } from './ui'
import { daylight } from '../office/art/environment'
import { ZONE_LABEL, type ZoneId } from '../office/layout'
import { officeCamera } from '../office/OfficeView'
import { officeSound, type SoundPrefs } from '../office/sound'
import { receptionistFor } from '../office/reception'
import { DOG } from '../office/dog'
import { DOG_COLS, DOG_H, DOG_ROW, DOG_W, corgiSheet } from '../office/art/corgi'
import { actions, store, useApp } from '../store'
import { CustomizeStatus } from './OfficeCustomize'
import { OfficeHint } from './home/FirstRun'
import { ACTIVITY_LABEL, ACTIVITY_TONE, Avatar, Icon, useTicker } from './common'

const ROOMS: ZoneId[] = ['workspace', 'meeting', 'studio', 'focus', 'kitchen', 'lounge', 'reception', 'booths', 'play', 'supply']

/** Game-world controls: team dock, room navigation, camera and the office clock. */
export function WorldHud() {
  return (
    <>
      <OfficeClock />
      <TeamDockWhenNotCustomizing />
      <CameraDock />
      <CustomizeStatus />
      <OfficeHint />
    </>
  )
}

/** Customizing is about the room: the team steps out of the way until you're done. */
function TeamDockWhenNotCustomizing() {
  return useApp((s) => s.editOffice) ? null : <TeamDock />
}

function OfficeClock() {
  useTicker(true, 30_000)
  const now = new Date()
  const light = daylight(now)
  return (
    <div className="hud hud-clock" data-tip="Local time drives the office daylight">
      <Icon name={light > 0.5 ? 'sun' : 'moon'} size={13} />
      <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  )
}

function TeamDock() {
  // the office in view decides who staffs the front desk and whether there is a dog
  const officeType = useApp((s) => (s.activeProjectId && s.projects[s.activeProjectId]?.officeType) || 'startup')
  const front = receptionistFor(officeType)
  const employees = useApp((s) => s.employees)
  const statuses = useApp((s) => s.statuses)
  const selected = useApp((s) => s.selectedEmployeeId)
  const deskOpen = useApp((s) => s.inspect === 'receptionist')
  const [open, setOpen] = useState(() => readDockOpen())
  const working = employees.filter((e) => (statuses[e.id]?.activity ?? 'idle') !== 'idle').length
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(DOCK_KEY, open ? 'closed' : 'open')
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
  }
  const dock = useRef<HTMLDivElement>(null)
  // publish the dock's height so the Composer above it never overlaps, whatever the dock holds
  if (!open) {
    return (
      <div className="hud hud-team collapsed" ref={dock}>
        <button className="team-toggle" onClick={toggle} aria-expanded={false} aria-label="Show the team" data-tip="Show the team">
          <Icon name="users" size={14} />
          <span className="team-chip-name">Team</span>
          {working > 0 && <span className="team-count">{working} working</span>}
          <Icon name="chevron" size={11} />
        </button>
      </div>
    )
  }
  return (
    <div className="hud hud-team" ref={dock}>
      {employees.map((e) => {
        const st = statuses[e.id]
        const activity = st?.activity ?? 'idle'
        return (
          <button
            key={e.id}
            className={`team-chip${selected === e.id ? ' active' : ''}`}
            onClick={() => actions.select(selected === e.id ? null : e.id)}
            data-tip={`${e.name} · ${ACTIVITY_LABEL[activity]}${st?.detail && activity !== 'idle' ? ` — ${st.detail}` : ''}`}
          >
            <Avatar employee={e} size={30} ring={activity === 'idle' ? null : ACTIVITY_TONE[activity]} />
            <span className="team-chip-name">{e.name.split(' ')[0]}</span>
          </button>
        )
      })}
      {/* office staff, not a teammate: no work reaches them, so no status ring */}
      <span className="team-sep" aria-hidden />
      <button
        className={`team-chip${deskOpen ? ' active' : ''}`}
        onClick={() => {
          if (deskOpen) return store.setState({ inspect: null })
          officeCamera.focusRoom('receptionist')
          store.setState({ inspect: 'receptionist' })
        }}
        data-tip={`${front.name} · ${front.role}. Not on the team, but happy to chat.`}
      >
        <Avatar employee={{ id: front.id, appearance: front.appearance }} size={30} />
        <span className="team-chip-name">{front.name}</span>
      </button>
      {officeType === 'startup' && (
        <button className="team-chip" onClick={() => (officeCamera.focusCorgi(), actions.talkTo(DOG.id))} data-tip={`${DOG.name} · the office corgi. Click to say hi.`}>
          <DogAvatar size={30} />
          <span className="team-chip-name">{DOG.name}</span>
        </button>
      )}
      <button className="team-toggle" onClick={toggle} aria-expanded={true} aria-label="Hide the team" data-tip="Hide the team">
        <Icon name="chevron" size={11} />
      </button>
    </div>
  )
}

const DOCK_KEY = 'autopia:teamDock'
function readDockOpen(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== 'closed'
  } catch {
    return true
  }
}

let dogSheet: HTMLCanvasElement | null = null

/** Puffy's face for the dock: her sitting frame, cropped to head and chest. */
export function DogAvatar({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    dogSheet ??= corgiSheet()
    const ctx = ref.current!.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const i = DOG_ROW.sit * DOG_COLS
    // the sitting pose's head sits in the upper middle of its cell
    ctx.drawImage(dogSheet, (i % DOG_COLS) * DOG_W + 4, Math.floor(i / DOG_COLS) * DOG_H + 4, 20, 20, 0, 0, 80, 80)
  }, [])
  return (
    <span className="avatar" style={{ width: size, height: size, ['--role' as string]: 'var(--role-pet)' }}>
      <canvas ref={ref} width={80} height={80} />
    </span>
  )
}

function CameraDock() {
  const [rooms, setRooms] = useState(false)
  const [sound, setSound] = useState(false)
  const editing = useApp((s) => s.editOffice)
  const dock = useRef<HTMLDivElement>(null)
  useDismiss(dock, rooms || sound, () => (setRooms(false), setSound(false)))
  return (
    <div className="hud hud-camera" ref={dock}>
      <div className="hud-group">
        <button className={`hud-customize${editing ? ' active' : ''}`} onClick={() => actions.setCustomizing(!editing)} data-tip={editing ? 'Finish customizing' : 'Customize office'} aria-label="Customize office" aria-pressed={editing}>
          <Icon name="paintbrush" />
        </button>
        <button className={sound ? 'active' : ''} onClick={() => setSound(!sound)} data-tip="Office sound" aria-label="Office sound">
          <Icon name={officeSound.prefs.enabled ? 'sound' : 'mute'} />
        </button>
      </div>
      {sound && <SoundPanel />}
      <div className="hud-group">
        <button onClick={officeCamera.zoomOut} data-tip="Zoom out" aria-label="Zoom out">
          <Icon name="zoomOut" />
        </button>
        <button onClick={officeCamera.zoomIn} data-tip="Zoom in" aria-label="Zoom in">
          <Icon name="zoomIn" />
        </button>
        <button onClick={officeCamera.reset} data-tip="Fit office (0)" aria-label="Fit office">
          <Icon name="fit" />
        </button>
      </div>
      <div className="hud-group">
        <button className={rooms ? 'active' : ''} onClick={() => setRooms(!rooms)} data-tip="Jump to a room" aria-label="Jump to a room">
          <Icon name="target" />
        </button>
      </div>
      {rooms && !sound && (
        <div className="hud-rooms">
          {ROOMS.map((z) => (
            <button
              key={z}
              onClick={() => {
                officeCamera.focusZone(z)
                setRooms(false)
              }}
            >
              {ZONE_LABEL[z]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Ambient sound is optional, local and synthesized; it starts muted on every launch. */
function SoundPanel() {
  const [p, setP] = useState<SoundPrefs>(officeSound.prefs)
  const update = (next: SoundPrefs) => {
    setP(next)
    officeSound.apply(next)
  }
  return (
    <div className="hud-rooms hud-sound">
      <Switch className="hud-toggle" checked={p.enabled} onChange={(v) => update({ ...p, enabled: v })} label="Office sound" />
      <label className="hud-slider">
        <span>Ambience</span>
        <input type="range" min={0} max={1} step={0.05} value={p.ambience} disabled={!p.enabled} onChange={(e) => update({ ...p, ambience: Number(e.target.value) })} />
      </label>
      <label className="hud-slider">
        <span>Effects</span>
        <input type="range" min={0} max={1} step={0.05} value={p.effects} disabled={!p.enabled} onChange={(e) => update({ ...p, effects: Number(e.target.value) })} />
      </label>
      <p className="hud-note">Room tone, keyboards of people really working, footsteps, coffee, doors and appliances. Pauses when Autopia is in the background.</p>
    </div>
  )
}
