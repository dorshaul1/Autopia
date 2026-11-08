import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Employee, EmployeeActivity, ProjectPhase, RoleId, TaskStatus } from '@shared/types'
import { CELL_H, CELL_W, ROW, characterSheet } from '../office/art/characters'
import { firstName, humanizeKeys, taskRef } from '@shared/naming'
import { useApp } from '../store'

export const PHASE_LABEL: Record<ProjectPhase, string> = {
  new: 'Not started',
  planning: 'Planning',
  awaiting_plan_approval: 'Plan ready',
  executing: 'Building',
  blocked: 'Needs you',
  completed: 'Done',
  failed: 'Stopped'
}

export const PHASE_TONE: Record<ProjectPhase, Tone> = {
  new: 'muted',
  planning: 'info',
  awaiting_plan_approval: 'warn',
  executing: 'info',
  blocked: 'danger',
  completed: 'ok',
  failed: 'danger'
}

export const TASK_LABEL: Record<TaskStatus, string> = {
  proposed: 'Proposed',
  pending: 'Waiting',
  running: 'In progress',
  merging: 'Finishing up',
  done: 'Done',
  failed: 'Needs you',
  cancelled: 'Skipped',
  interrupted: 'Paused'
}

export const TASK_TONE: Record<TaskStatus, Tone> = {
  proposed: 'muted',
  pending: 'muted',
  running: 'info',
  merging: 'info',
  done: 'ok',
  failed: 'danger',
  cancelled: 'muted',
  interrupted: 'warn'
}

export const ACTIVITY_LABEL: Record<EmployeeActivity, string> = {
  idle: 'Available',
  meeting: 'Planning',
  working: 'Building',
  testing: 'Testing',
  reviewing: 'Reviewing',
  waiting: 'Waiting for you',
  error: 'Blocked'
}

export const ACTIVITY_TONE: Record<EmployeeActivity, Tone> = {
  idle: 'muted',
  meeting: 'info',
  working: 'info',
  testing: 'ok',
  reviewing: 'info',
  waiting: 'warn',
  error: 'danger'
}

export const ROLE_COLOR: Record<RoleId, string> = {
  pm: 'var(--role-pm)',
  lead_dev: 'var(--role-lead)',
  designer: 'var(--role-designer)',
  qa: 'var(--role-tester)',
  engineer: 'var(--role-engineer)'
}

export type Tone = 'muted' | 'info' | 'ok' | 'warn' | 'danger'

/**
 * Naming for people: who does a task and what it is, never keys like T3. `human` rewrites any text
 * that still mentions keys (older records, agents' own summaries) for the project in view.
 */
export function useNaming() {
  const tasks = useApp((s) => s.tasks)
  const employees = useApp((s) => s.employees)
  return useMemo(() => {
    const list = Object.values(tasks)
    const byKey = new Map(list.map((t) => [t.key, t]))
    const nameOf = (id: string | null | undefined) => (id ? firstName(employees.find((e) => e.id === id)?.name) : null)
    return {
      nameOf,
      human: (text: string | null | undefined) => humanizeKeys(text ?? '', list, nameOf),
      /** "Maya's “Add the login form”" for a key (or the key itself when it isn't in this project). */
      ref: (key: string | null | undefined, max?: number) => {
        const t = key ? byKey.get(key) : undefined
        return t ? taskRef(t, nameOf, max) : (key ?? '')
      },
      refOf: (t: { key: string; title: string; assigneeId: string }, max?: number) => taskRef(t, nameOf, max),
      /** First name of whoever does the task with this key. */
      ownerOf: (key: string | null | undefined) => nameOf(key ? byKey.get(key)?.assigneeId : null)
    }
  }, [tasks, employees])
}

export function Pill({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className={`pill-dot${pulse ? ' pulse' : ''}`} />
      {children}
    </span>
  )
}

const avatarCache = new Map<string, HTMLCanvasElement>()

/** Anyone drawn as an office character: a teammate, or office staff like the receptionist. */
type Person = Pick<Employee, 'id' | 'appearance'> & { role?: Employee['role'] }

function sheetFor(employee: Person): HTMLCanvasElement {
  const key = `${employee.id}:${JSON.stringify(employee.appearance)}`
  let sheet = avatarCache.get(key)
  if (!sheet) {
    sheet = characterSheet(employee.appearance)
    avatarCache.set(key, sheet)
  }
  return sheet
}

/** The employee's real in-game sprite (head and shoulders), rendered crisp. */
export function Avatar({ employee, size = 36, ring }: { employee: Person; size?: number; ring?: Tone | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(sheetFor(employee), 0, ROW.down * CELL_H, CELL_W, 22, 0, 0, c.width, c.height)
  }, [employee])
  return (
    <span className={`avatar${ring ? ` ring-${ring}` : ''}`} style={{ width: size, height: size, ['--role' as string]: employee.role ? ROLE_COLOR[employee.role] : 'var(--border-subtle)' }}>
      <canvas ref={ref} width={CELL_W * 4} height={22 * 4} />
    </span>
  )
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function duration(from: number, to: number | null): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const money = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)

/** Re-render every `ms` while `active`, for live timers. */
export function useTicker(active: boolean, ms = 1000): void {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [active, ms])
}

const PATHS: Record<string, string> = {
  plus: 'M8 3v10M3 8h10',
  code: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  camera: 'M2 5h3l1.2-1.5h3.6L11 5h3v7.5H2zM8 6.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z',
  review: 'M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8.5l1.5 1.5 3-3',
  flask: 'M6 2h4M6.5 2v4.2L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L9.5 6.2V2M4.8 9.5h6.4',
  book: 'M3 2.5h4.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.2 1.2 0 0 0-1.2-1.2H3zM13 2.5H9.7M13 2.5v9.8H9',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  monitor: 'M2 3h12v8H2zM6 13.5h4M8 11v2.5',
  tablet: 'M4 1.5h8v13H4zM7.5 12.5h1',
  phone: 'M5 1.5h6v13H5zM7.5 12.5h1',
  crop: 'M4 1.5V12h10.5M1.5 4H12v10.5',
  compare: 'M2.5 3h4.5v10H2.5zM9 3h4.5M9 13h4.5M13.5 3v10M9 3v10',
  thumb: 'M5 7l2.5-5.5a1.5 1.5 0 0 1 1.5 1.5V6h4a1 1 0 0 1 1 1.2l-1 5.5a1 1 0 0 1-1 .8H5zM2 7h3v6.5H2z',
  move: 'M8 1.5v13M1.5 8h13M8 1.5l-2 2M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2',
  // Lucide "paintbrush" (ISC licence), drawn on its own 24-unit grid
  paintbrush: 'm14.622 17.897-10.68-2.913M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0zM9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15',
  sound: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8',
  mute: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 6l3 4M14 6l-3 4',
  gear: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  panel: 'M2.5 3.5h11v9h-11zM10 3.5v9',
  zoomIn: 'M7 3v8M3 7h8M11 11l3 3',
  zoomOut: 'M3 7h8M11 11l3 3',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
  file: 'M4 2h5l3 3v9H4zM9 2v3h3',
  back: 'M10 3L5 8l5 5',
  close: 'M4 4l8 8M12 4l-8 8',
  reveal: 'M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4',
  chevron: 'M4 6l4 4 4-4',
  more: 'M3.5 7.25v1.5M8 7.25v1.5M12.5 7.25v1.5',
  overview: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  tasks: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5',
  activity: 'M1.5 8h3l2-5 3 10 2-5h3',
  files: 'M2.5 3h4l1.5 1.5h5.5v8.5h-11z',
  target: 'M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  play: 'M5 3.5v9l7-4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  reply: 'M6.5 4 2.5 7.5l4 3.5M2.5 7.5h6.5a4 4 0 0 1 4 4v1',
  focus: 'M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3',
  retry: 'M3 8a5 5 0 1 0 1.5-3.5M3 2.5v3h3',
  skip: 'M3.5 3.5l5 4.5-5 4.5zM11.5 3.5v9',
  check: 'M3 8.5l3 3 7-7',
  help: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.5 6.3a1.6 1.6 0 1 1 2.3 1.6c-.5.3-.8.6-.8 1.2M8 11.2v.3',
  bolt: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z',
  read: 'M2 3.5h4.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H2zM14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14z',
  edit: 'M10.5 2.5l3 3L6 13H3v-3z',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5',
  terminal: 'M2.5 3h11v10h-11zM5 6.5l2 1.5-2 1.5M8.5 10H11',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.5 10.5L14 14',
  chat: 'M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z',
  brain: 'M6 3a2 2 0 0 0-2 2 2 2 0 0 0-1 3.5A2 2 0 0 0 5 12h1V3zM10 3a2 2 0 0 1 2 2 2 2 0 0 1 1 3.5A2 2 0 0 1 11 12h-1V3z',
  flag: 'M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8',
  alert: 'M8 2l6.5 11.5h-13zM8 6.5v3.5M8 11.5v.5',
  coffee: 'M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7h1.5a1.5 1.5 0 0 1 0 3H11M5.5 2.5v1.5M8 2v2',
  fish: 'M2 8c2-3 6-3.5 9 0-3 3.5-7 3-9 0zM11 8l3-2.5v5zM5.5 7.5v.5',
  user: 'M8 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 14c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5',
  sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z',
  bell: 'M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3',
  building: 'M2.5 14V3.5h7V14M9.5 7h4V14M4.5 6h1M7 6h.5M4.5 8.5h1M7 8.5h.5M4.5 11h1M7 11h.5M11 9.5h.5M11 12h.5M1.5 14h13',
  users: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 7a2 2 0 1 0 0-4M12 9.5c1.5.4 2.5 1.7 2.5 4',
  arrowUp: 'M8 13V3M4 7l4-4 4 4',
  arrowDown: 'M8 3v10M4 9l4 4 4-4',
  inbox: 'M2 9.5l1.5-6h9l1.5 6v4H2zM2 9.5h3.5l1 1.5h3l1-1.5H14',
  shield: 'M8 1.5l5.5 2v4.5c0 3.5-2.5 5.5-5.5 6.5-3-1-5.5-3-5.5-6.5V3.5z',
  branch: 'M5 2.5v8M5 10.5a2 2 0 1 0 0 3 2 2 0 0 0 0-3zM11 4.5a2 2 0 1 0 0-.1M11 6.5c0 3-6 2-6 4'
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox={name === 'paintbrush' ? '0 0 24 24' : '0 0 16 16'}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'paintbrush' ? 2.1 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={size ? { width: size, height: size } : undefined}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Icon for a tool call, derived from the real tool name. */
export function toolIcon(tool: string | null | undefined): IconName {
  switch (tool) {
    case 'Read':
      return 'read'
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit'
    case 'Bash':
      return 'terminal'
    case 'Glob':
    case 'Grep':
    case 'WebSearch':
      return 'search'
    case 'TodoWrite':
      return 'tasks'
    case 'StructuredOutput':
      return 'flag'
    default:
      return 'bolt'
  }
}
