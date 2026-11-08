import type { SearchHit } from '@shared/types'
import { overlapLine } from '@shared/mission'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { commandMatches, NO_CAPABILITIES, type ClaudeCapabilities } from '@shared/claudeCode'
import { resolveIntent } from '@shared/composer'
import { exactCommand, outcomeLine, searchCommands, typingTarget, withoutTyped, type CommandEntry } from '@shared/commandResolve'
import { STAGE_LABEL, type Stage } from '@shared/stages'
import { activeProject, actions, isSpace, pendingApprovals, sortedTasks, store, useApp, type OpsIntentKind } from '../../store'
import { Avatar, Icon, type IconName } from '../common'
import { clearDraft, EMPTY_DRAFT, readDataUrl, readDraft, setDraft, useDraft } from '../composer/Composer'
import { useContextActions } from './useContextActions'

interface Cmd extends CommandEntry {
  group: string
  hint?: string
  icon: IconName
  employeeId?: string
  run: () => void | Promise<unknown>
}

const STAGE_ALIASES: Partial<Record<Stage, string[]>> = {
  cost: ['cost', 'time', 'spending', 'money', 'stats', 'timeline'],
  overview: ['home of this product', 'summary', 'tasks', 'work', 'who is doing what', 'plan', 'mission control'],
  office: ['the team', 'team at work'],
  preview: ['running app', 'the app', 'product'],
  review: ['review', 'changes', 'diff', 'deliveries', 'timeline', 'history'],
  logs: ['session logs', 'activity'],
  operations: ['run', 'build', 'tests', 'launch', 'readiness', 'release', 'ready to launch', 'dev server', 'processes'],
  brief: ['product brief']
}

/**
 * The one place to ask, tell or find anything. It works out what Enter does as you type and says so first; local actions
 * use no AI, and anything else goes through the same request path as the conversation.
 */
const HIT_GROUP: Record<SearchHit['kind'], string> = { task: 'Tasks', delivery: 'Deliveries', message: 'Conversations', employee: 'Team', file: 'Files' }
const HIT_ICON: Record<SearchHit['kind'], IconName> = { task: 'tasks', delivery: 'review', message: 'chat', employee: 'user', file: 'file' }

export function Command() {
  const open = useApp((s) => s.palette)
  if (!open) return null
  return <CommandSurface />
}

function CommandSurface() {
  const view = useApp((s) => s.view)
  const inProduct = useApp(activeProject)
  const project = isSpace(view) ? inProduct : null
  const projects = useApp((s) => s.projects)
  const tasks = useApp(sortedTasks)
  const employees = useApp((s) => s.employees)
  const approvals = useApp(pendingApprovals)
  const deliveries = useApp((s) => s.deliveries)
  const mode = useApp((s) => s.commandMode)
  const opsReady = useApp((s) => s.ops?.environment)
  const previewStatus = useApp((s) => s.preview?.status)
  const context = useContextActions()
  const key = `command:${project?.id ?? 'none'}`
  const draft = useDraft(key)
  const text = draft.text
  // what this is aimed at starts from what you're looking at, and each piece can be taken off
  const [aim, setAim] = useState(() => {
    const s = store.getState()
    const top = s.panelOpen ? s.sheet[s.sheet.length - 1] : null
    return { employeeId: s.target.employeeId ?? (top?.kind === 'employee' ? top.id : null), taskId: s.target.taskId ?? (top?.kind === 'task' ? top.id : null), deliveryId: s.commandMode === 'direction' ? null : s.target.deliveryId }
  })
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [caps, setCaps] = useState<ClaudeCapabilities>(NO_CAPABILITIES)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const close = () => {
    store.setState({ palette: false, commandMode: null })
    returnFocus.current?.focus?.()
  }
  useEffect(() => input.current?.focus(), [])
  useEffect(() => void actions.refreshOps(), [])
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])
  const slash = !!project && text.startsWith('/')
  useEffect(() => {
    if (slash && project) void window.autopia.claudeCapabilities(project.id).then(setCaps, () => undefined)
  }, [slash, project?.id])

  const go = (s: Stage) => () => actions.goStage(s)
  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = []
    const add = (c: Omit<Cmd, 'direct'> & { direct?: boolean }) => list.push({ direct: true, ...c })
    add({ id: 'home', group: 'Go to', label: 'Home', aliases: ['all products', 'needs you', 'decisions'], hint: '⌘0', icon: 'overview', run: () => store.setState({ view: 'home' }) })
    add({ id: 'new', group: 'Go to', label: 'New product', aliases: ['new project', 'start something new'], hint: '⌘N', icon: 'plus', run: () => actions.startNew() })
    add({ id: 'folder', group: 'Go to', label: 'Open a folder', aliases: ['open folder', 'open an existing folder'], icon: 'folder', run: () => void actions.openFolder() })
    add({ id: 'settings', group: 'Go to', label: 'Settings', aliases: ['preferences'], hint: '⌘,', icon: 'gear', run: () => store.setState({ view: 'settings' }) })
    add({ id: 'set:claude', group: 'Settings', label: 'Claude Code', aliases: ['claude code settings', 'mcp', 'mcp servers', 'sign in', 'account', 'setup help', 'getting started', 'help', 'install'], icon: 'terminal', run: () => store.setState({ view: 'settings', settingsSection: 'claude' }) })
    add({ id: 'set:permissions', group: 'Settings', label: 'Permissions', aliases: ['what can the team do', 'policy', 'full access'], icon: 'shield', run: () => store.setState({ view: 'settings', settingsSection: 'permissions' }) })
    add({ id: 'set:work', group: 'Settings', label: 'How the team works', aliases: ['auto mode', 'models', 'effort', 'teammates at once'], icon: 'users', run: () => store.setState({ view: 'settings', settingsSection: 'work' }) })
    add({ id: 'set:notifications', group: 'Settings', label: 'Notifications', aliases: ['quiet mode'], icon: 'inbox', run: () => store.setState({ view: 'settings', settingsSection: 'notifications' }) })
    add({ id: 'skills', group: 'Settings', label: 'Skills', icon: 'brain', run: () => store.setState({ view: 'settings', settingsSection: 'skills' }) })
    add({ id: 'shortcuts', group: 'Go to', label: 'Keyboard shortcuts', aliases: ['shortcuts'], hint: '?', icon: 'bolt', run: () => store.setState({ showShortcuts: true }) })
    if (project) {
      const stages: [Stage, IconName, string?][] = [['overview', 'overview', '⌘1'], ['office', 'building', '⌘2'], ['preview', 'eye', '⌘3'], ['review', 'code', '⌘4'], ['files', 'files'], ['operations', 'play'], ['memory', 'book'], ['logs', 'activity'], ['cost', 'bolt']]
      for (const [s, icon, hint] of stages) add({ id: `stage:${s}`, group: project.name, label: STAGE_LABEL[s], aliases: STAGE_ALIASES[s], hint, icon, run: go(s) })
      // only what this project can really do
      const ops = store.getState().ops
      const previewNow = store.getState().preview
      const doOp = (kind: OpsIntentKind) => () => (actions.goStage('operations'), store.setState({ opsIntent: { kind } }))
      for (const c of ops?.environment.checks ?? []) add({ id: `op:${c.id}`, group: project.name, label: c.kind === 'test' ? 'Run the tests' : c.kind === 'build' ? 'Run the build' : c.kind === 'typecheck' ? 'Check the types' : 'Run the linter', aliases: [c.kind, c.command, c.kind === 'test' ? 'run tests' : c.kind === 'build' ? 'build it' : 'check'], hint: c.command, icon: 'play', run: doOp(c.kind as OpsIntentKind) })
      if ((ops?.environment.checks.length ?? 0) > 1) add({ id: 'op:all', group: project.name, label: 'Run all the checks', aliases: ['run checks', 'check everything', 'verify'], icon: 'play', run: doOp('all') })
      if (previewNow && previewNow.kind !== 'none') {
        const live = previewNow.status === 'running' || previewNow.status === 'starting'
        if (live) {
          add({ id: 'op:stop', group: project.name, label: 'Stop the app', aliases: ['stop the server', 'stop dev server'], icon: 'stop', run: doOp('stop') })
          add({ id: 'op:restart', group: project.name, label: 'Restart the app', aliases: ['restart the server', 'restart dev server'], icon: 'retry', run: doOp('restart') })
        } else add({ id: 'op:start', group: project.name, label: 'Start the app', aliases: ['run the app', 'start the server', 'start dev server'], icon: 'play', run: doOp('start') })
      }
      add({ id: 'conversation', group: project.name, label: 'Team conversation', aliases: ['conversation', 'chat'], hint: '⌘\\', icon: 'chat', run: () => actions.talkTo(null) })
      add({ id: 'pause', group: project.name, label: project.paused ? 'Resume work' : 'Pause work', icon: project.paused ? 'play' : 'stop', run: () => actions.run(() => window.autopia.setProjectControls(project.id, { paused: !project.paused })) })
      add({ id: 'stop', group: project.name, label: 'Stop the team', aliases: ['stop work', 'stop everything'], icon: 'stop', run: () => context.run({ kind: 'stop', label: 'Stop' }) })
      add({ id: 'delete', group: project.name, label: 'Delete this product', aliases: ['delete product', 'delete this project', 'delete project'], icon: 'trash', run: () => store.setState({ deletingProduct: project.id }) })
      for (const t of tasks.filter((x) => x.status !== 'proposed')) add({ id: `task:${t.id}`, direct: false, group: 'Tasks', label: t.title, aliases: [t.key], hint: `${t.key} · ${employees.find((e) => e.id === t.assigneeId)?.name.split(' ')[0] ?? ''}`, icon: 'tasks', run: () => actions.openSheet({ kind: 'task', id: t.id }) })
      for (const e of employees) add({ id: `emp:${e.id}`, direct: false, group: 'Team', label: e.name, aliases: [e.title, `talk to ${e.name.split(' ')[0]}`, `chat with ${e.name.split(' ')[0]}`, `message ${e.name.split(' ')[0]}`], hint: e.title, icon: 'user', employeeId: e.id, run: () => actions.talkTo(e.id) })
    }
    for (const p of Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt)) if (p.id !== project?.id) add({ id: `project:${p.id}`, direct: false, group: 'Products', label: p.name, icon: 'folder', run: () => actions.goToProduct(p.id) })
    return list
  }, [project, projects, tasks, employees, opsReady, previewStatus])

  const typed = typingTarget(text)
  const say = text.trim()
  const direction = mode === 'direction' && !!project
  const local = direction || typed || slash ? null : exactCommand(say, commands)
  const delivered = deliveries.some((d) => d.status === 'review' || d.status === 'accepted')
  const busyTeam = !!project && (project.phase === 'planning' || project.phase === 'executing' || deliveries.some((d) => d.status === 'implementing' || d.status === 'validating'))
  const intent = project ? resolveIntent({ text: say, hasFiles: draft.attachments.length > 0, newProject: false, busy: busyTeam, planPending: approvals.some((a) => a.kind === 'plan'), delivered, employeeId: aim.employeeId, taskId: aim.taskId, deliveryId: aim.deliveryId } as never) : 'build'
  const person = employees.find((e) => e.id === aim.employeeId) ?? null
  const task = tasks.find((t) => t.id === aim.taskId) ?? null
  const result = deliveries.find((d) => d.id === aim.deliveryId) ?? null

  // what the list offers: to aim while aiming, its commands after a slash, otherwise matches and what makes sense now
  type Row = { id: string; label: string; hint?: string; group: string; icon: IconName; primary?: boolean; run: () => void | Promise<unknown>; employeeId?: string }
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (typed?.kind === '@') {
      const plain = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      const fits = employees.filter((x) => plain(`${x.name} ${x.title}`).includes(plain(typed.query)))
      // their name first: @ine is Inés before it's an engineer
      const byName = [...fits.filter((x) => plain(x.name).startsWith(plain(typed.query))), ...fits.filter((x) => !plain(x.name).startsWith(plain(typed.query)))]
      for (const e of byName.slice(0, 7)) out.push({ id: `aim:${e.id}`, group: 'Send to', label: e.name, hint: e.title, icon: 'user', employeeId: e.id, run: () => (setAim((a) => ({ ...a, employeeId: e.id })), setDraft(key, { text: withoutTyped(text) + ' ' }), input.current?.focus()) })
      return out
    }
    if (typed?.kind === '#') {
      for (const t of tasks.filter((x) => x.status !== 'proposed' && `${x.key} ${x.title}`.toLowerCase().includes(typed.query)).slice(0, 7)) out.push({ id: `aim:${t.id}`, group: 'About', label: t.title, hint: t.key, icon: 'tasks', run: () => (setAim((a) => ({ ...a, taskId: t.id })), setDraft(key, { text: withoutTyped(text) + ' ' }), input.current?.focus()) })
      return out
    }
    // still choosing the command: complete it. Once it's written, Enter sends it
    const choosing = slash && /^\/\S*$/.test(text) && !caps.commands.some((c) => `/${c.name}` === text)
    if (choosing) for (const c of commandMatches(text, caps, 7) ?? []) out.push({ id: `slash:${c.name}`, group: 'Claude Code', label: `/${c.name}`, hint: c.description, icon: 'terminal', run: () => (setDraft(key, { text: `/${c.name} ` }), input.current?.focus()) })
    if (say && !slash) {
      if (local) out.push({ id: `cmd:${local.id}`, group: 'Do it', label: local.label, hint: local.hint, icon: (local as Cmd).icon, run: (local as Cmd).run })
      if (project) out.push({ id: 'send', group: 'Send', label: direction ? 'Change the direction' : person ? `Send to ${person.name.split(' ')[0]}` : intent === 'ask' ? 'Ask the team' : 'Tell the team', icon: 'chat', primary: true, run: () => send() })
      else out.push({ id: 'create', group: 'Start', label: 'Start something new with this', icon: 'plus', primary: true, run: () => (actions.startNew(), store.setState({ creatorText: say }), clearDraft(key)) })
      for (const c of searchCommands(say, commands).filter((c) => c.id !== local?.id)) out.push({ id: `cmd:${c.id}`, group: c.group, label: c.label, hint: c.hint, icon: c.icon, employeeId: c.employeeId, run: c.run })
    } else if (slash && project && !choosing) {
      out.push({ id: 'send', group: 'Send', label: 'Send to Claude Code', icon: 'terminal', primary: true, run: () => send() })
    } else if (!say) {
      if (project) for (const a of context.list) out.push({ id: `now:${a.kind}`, group: 'Right now', label: a.label, icon: 'bolt', run: () => context.run(a) })
      const pick = commands.filter((c) => (project ? c.id.startsWith('stage:') || c.id === 'home' || c.id === 'conversation' : !['back', 'focus'].includes(c.id) && !c.id.startsWith('emp:'))).slice(0, 7)
      for (const c of pick) out.push({ id: `cmd:${c.id}`, group: c.group, label: c.label, hint: c.hint, icon: c.icon, run: c.run })
      if (project) for (const e of employees.slice(0, 3)) out.push({ id: `emp:${e.id}`, group: 'Talk to', label: e.name.split(' ')[0], hint: e.title, icon: 'user', employeeId: e.id, run: () => actions.talkTo(e.id) })
    }
    return out
  }, [typed?.kind, typed?.query, slash, say, local, commands, caps, context.list, project, person, intent, direction])

  // what's on record, across every product: asked a moment after you stop typing, and only the latest answer counts
  const [found, setFound] = useState<SearchHit[]>([])
  useEffect(() => {
    if (say.length < 2 || slash || typed || direction || typeof window.autopia.search !== 'function') return setFound([])
    let live = true
    const t = setTimeout(() => void window.autopia.search(say).then((h) => live && setFound(h), () => undefined), 90)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [say, slash, !!typed, direction])
  const allRows = useMemo<Row[]>(() => {
    const seen = new Set(rows.map((r) => r.id.replace(/^cmd:(task:|emp:)?/, '')))
    const hits = found.filter((h) => !seen.has(h.id)).map((h): Row => ({ id: `hit:${h.kind}:${h.id}`, group: HIT_GROUP[h.kind], label: h.title, hint: h.projectId === project?.id ? undefined : h.projectName, icon: HIT_ICON[h.kind], run: () => actions.openHit(h) }))
    return [...rows, ...hits]
  }, [rows, found, project?.id])
  useEffect(() => setIndex(0), [say, typed?.kind])
  const safe = Math.min(index, Math.max(0, allRows.length - 1))
  useEffect(() => {
    document.getElementById(`cmd-${allRows[safe]?.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [safe])

  async function send() {
    if (!project || busy || !say) return
    setBusy(true)
    const sentTo = project.id
    if (direction) {
      const r = await actions.run(() => window.autopia.productFeedback(sentTo, say))
      setBusy(false)
      if (!r) return
      clearDraft(key)
      store.setState({ receipt: { kind: 'direction', projectId: sentTo, outcome: r } })
      return close()
    }
    const msg = await actions.run(() => window.autopia.sendMessage({ projectId: sentTo, intent, text: say, attachments: draft.attachments, employeeId: aim.employeeId, taskId: aim.taskId, deliveryId: aim.deliveryId }))
    setBusy(false)
    if (!msg) return // the error shows; your words stay
    clearDraft(key)
    store.setState({ receipt: { kind: 'message', projectId: sentTo, messageId: msg.id } })
    close()
  }
  const runAt = (i: number) => {
    const r = allRows[i]
    if (!r) return
    const stays = r.id.startsWith('aim:') || r.id.startsWith('slash:')
    const result = r.run()
    if (r.id !== 'send' && !stays) {
      clearDraft(key)
      close()
    }
    return result
  }
  const attach = async (files: File[]) => {
    if (!project) return store.setState({ error: 'Files can be attached once you’re in a product.' })
    for (const f of files.slice(0, 5)) {
      const rel = await actions.run(async () => window.autopia.saveAttachment(project.id, f.name || 'pasted', await readDataUrl(f)))
      if (rel) setDraft(key, { attachments: [...(draftNow(key).attachments), rel] })
    }
  }
  const line = outcomeLine({ hasText: !!say, local: allRows[safe]?.id === `cmd:${local?.id}` && local ? `${local.label}.` : null, direct: slash, intent, to: person?.name.split(' ')[0] ?? null, task: task?.key ?? null, result: result?.number ?? null, product: project?.name ?? null, direction })
  const groups = allRows.reduce<{ group: string; rows: { row: Row; i: number }[] }[]>((acc, row, i) => {
    const last = acc[acc.length - 1]
    if (last?.group === row.group) last.rows.push({ row, i })
    else acc.push({ group: row.group, rows: [{ row, i }] })
    return acc
  }, [])

  return (
    <div className="cmd-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={`cmd${dragging ? ' cmd-drop' : ''}`}
        role="dialog"
        aria-label="Command"
        onDragOver={(e: DragEvent) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => (e.preventDefault(), setDragging(false), void attach([...e.dataTransfer.files]))}
      >
        {(project || person || task || result || draft.attachments.length > 0) && (
          <div className="cmd-context" aria-label="What this is about">
            {project && <span className="cmd-chip cmd-chip-product">{project.name}</span>}
            {direction && <span className="cmd-chip">Direction</span>}
            {person && (
              <span className="cmd-chip">
                <Avatar employee={person} size={14} /> {person.name.split(' ')[0]}
                <button aria-label={`Stop addressing ${person.name}`} onClick={() => setAim((a) => ({ ...a, employeeId: null }))}>
                  <Icon name="close" size={9} />
                </button>
              </span>
            )}
            {task && (
              <span className="cmd-chip">
                {task.key} {task.title.slice(0, 28)}
                <button aria-label="Not about this task" onClick={() => setAim((a) => ({ ...a, taskId: null }))}>
                  <Icon name="close" size={9} />
                </button>
              </span>
            )}
            {result && (
              <span className="cmd-chip">
                Result #{result.number}
                <button aria-label="Not about this result" onClick={() => setAim((a) => ({ ...a, deliveryId: null }))}>
                  <Icon name="close" size={9} />
                </button>
              </span>
            )}
            {draft.attachments.map((a) => (
              <span key={a} className="cmd-chip">
                <Icon name="file" size={11} /> {a.split('/').pop()!.replace(/^\d+-/, '')}
                <button aria-label="Remove attachment" onClick={() => setDraft(key, { attachments: draft.attachments.filter((x) => x !== a) })}>
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="cmd-input">
          <Icon name="search" size={15} />
          <textarea
            ref={input}
            rows={1}
            value={text}
            readOnly={busy}
            role="combobox"
            aria-expanded={allRows.length > 0}
            aria-controls="cmd-list"
            aria-activedescendant={allRows[safe] ? `cmd-${allRows[safe].id}` : undefined}
            aria-label="Ask, tell or find anything"
            placeholder={direction ? 'A new goal, a requirement, what matters most…' : project ? `Ask, tell the team, or find anything. @ someone, # a task, / Claude Code` : 'Find anything, or describe something new'}
            onChange={(e) => setDraft(key, { text: e.target.value })}
            onPaste={(e: ClipboardEvent) => {
              const files = [...e.clipboardData.files]
              if (files.length) {
                e.preventDefault()
                void attach(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') return e.preventDefault(), setIndex((safe + 1) % Math.max(1, allRows.length))
              if (e.key === 'ArrowUp') return e.preventDefault(), setIndex((safe - 1 + allRows.length) % Math.max(1, allRows.length))
              if (e.key === 'Escape') return e.preventDefault(), e.stopPropagation(), close()
              if (e.key === 'Tab' && (typed || slash) && allRows[safe]) return e.preventDefault(), void runAt(safe)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                // ⌘↵ is always "send it", whatever it looks like
                if ((e.metaKey || e.ctrlKey) && project && say) return void send()
                void runAt(safe)
              }
            }}
          />
          {project && (
            <label className="icon-btn" data-tip="Attach images or files (or paste or drop them)">
              <input type="file" accept="image/*,.txt,.md,.json,.csv,.tsv,.pdf,.log,.yaml,.yml,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.sql,.sh,.toml" multiple hidden onChange={(e) => (void attach([...(e.target.files ?? [])]), (e.target.value = ''))} />
              <Icon name="plus" size={13} />
            </label>
          )}
        </div>
        {allRows.length > 0 && (
          <div className="cmd-list" id="cmd-list" role="listbox" aria-label="What you can do">
            {groups.map((g) => (
              <div key={g.group} role="group" aria-label={g.group}>
                <div className="cmd-group">{g.group}</div>
                {g.rows.map(({ row, i }) => (
                  <button key={row.id} id={`cmd-${row.id}`} role="option" aria-selected={i === safe} className={`cmd-row${i === safe ? ' selected' : ''}`} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => void runAt(i)}>
                    {row.employeeId && employees.find((x) => x.id === row.employeeId) ? <Avatar employee={employees.find((x) => x.id === row.employeeId)!} size={18} /> : <Icon name={row.icon} size={14} />}
                    <span className="cmd-label">{row.label}</span>
                    {row.hint && <span className="cmd-hint">{row.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="cmd-foot">
          <span className="cmd-says" aria-live="polite">{(!local && !slash && overlapLine(text, tasks, employees)) || line}</span>
          <span className="cmd-keys">
            <kbd>↵</kbd> {busy ? 'Sending…' : 'run'}
            {project && say && (
              <>
                <kbd>⌘↵</kbd> send
              </>
            )}
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

const draftNow = (key: string) => readDraft(key) ?? EMPTY_DRAFT
