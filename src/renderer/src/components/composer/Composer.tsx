import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { resolveIntent } from '@shared/composer'
import { commandMatches, NO_CAPABILITIES, type ClaudeCapabilities } from '@shared/claudeCode'
import type { MessageIntent } from '@shared/types'
import { activeProject, actions, pendingApprovals, store, useApp, type ComposerTarget } from '../../store'
import { Avatar, Icon } from '../common'
import { useDismiss } from '../ui'

// ── drafts: one per target, shared by the dock, the expanded editor and the conversation ──

interface Draft {
  text: string
  attachments: string[]
  intent: MessageIntent | null
}
const EMPTY: Draft = { text: '', attachments: [], intent: null }
export const EMPTY_DRAFT = EMPTY
const KEY = 'autopia:drafts'

const drafts = createStore<{ map: Record<string, Draft> }>(() => {
  try {
    return { map: JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Draft> }
  } catch {
    return { map: {} }
  }
})
let saveTimer: ReturnType<typeof setTimeout> | null = null
drafts.subscribe((s) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s.map))
    } catch {
      // storage unavailable: drafts stay in memory for this session
    }
  }, 300)
})

export const draftKey = (projectId: string | null, t: ComposerTarget) => (t.newProject || !projectId ? 'new' : [projectId, t.employeeId ?? '', t.taskId ?? ''].join(':'))
export const hasDraft = (projectId: string) => Object.entries(drafts.getState().map).some(([k, d]) => k.startsWith(`${projectId}:`) && d.text.trim())
/** Adds a file (e.g. a preview capture) to the draft for a target, so the next send carries it. */
/** Starts a message for you: what you'd otherwise retype, like the error you're looking at. Never replaces what you wrote. */
export const prefillDraft = (key: string, text: string) => drafts.setState((s) => ({ map: { ...s.map, [key]: { ...(s.map[key] ?? EMPTY), text: s.map[key]?.text.trim() ? `${s.map[key].text}\n\n${text}` : text } } }))
export const useDraft = (key: string) => useStore(drafts, (s) => s.map[key] ?? EMPTY)
export const readDraft = (key: string): Draft | undefined => drafts.getState().map[key]
export const setDraft = (key: string, patch: Partial<Draft>) => drafts.setState((s) => ({ map: { ...s.map, [key]: { ...(s.map[key] ?? EMPTY), ...patch } } }))
export const clearDraft = (key: string) =>
  drafts.setState((s) => {
    const { [key]: _gone, ...rest } = s.map
    void _gone
    return { map: rest }
  })

export const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

/**
 * The one place you talk to the company. Shows where a message goes and what will happen before
 * you send it; every send goes through the existing request, change, note, plan and question flows.
 */
export function Composer() {
  const project = useApp(activeProject)
  const target = useApp((s) => s.target)
  const employees = useApp((s) => s.employees)
  const tasks = useApp((s) => s.tasks)
  const deliveries = useApp((s) => s.deliveries)
  const approvals = useApp(pendingApprovals)
  const focusTick = useApp((s) => s.composerFocus)
  const newProject = target.newProject || !project
  const key = draftKey(project?.id ?? null, { ...target, newProject })
  const draft = useStore(drafts, (s) => s.map[key] ?? EMPTY)
  const [busy, setBusy] = useState(false)
  const [mention, setMention] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [caps, setCaps] = useState<ClaudeCapabilities>(NO_CAPABILITIES)
  const [menuGone, setMenuGone] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(box, mention !== null, () => setMention(null))

  const employee = target.employeeId ? employees.find((e) => e.id === target.employeeId) ?? null : null
  const task = target.taskId ? tasks[target.taskId] ?? null : null
  const result = target.deliveryId ? deliveries.find((d) => d.id === target.deliveryId) ?? null : null
  const delivered = deliveries.some((d) => d.status === 'review' || d.status === 'accepted')
  const busyTeam = !!project && (project.phase === 'planning' || project.phase === 'executing' || deliveries.some((d) => d.status === 'implementing' || d.status === 'validating'))
  // a first reading from your words and the project's state; the team settles anything unclear (no modes)
  const auto = useMemo(
    () => resolveIntent({ text: draft.text, hasFiles: draft.attachments.length > 0, newProject, busy: busyTeam, planPending: approvals.some((a) => a.kind === 'plan'), delivered, employeeId: target.employeeId }),
    [draft.text, newProject, busyTeam, approvals, delivered, target.employeeId]
  )
  const intent: MessageIntent = newProject ? 'build' : auto
  const reply = useApp((s) => s.replyTo)

  useEffect(() => {
    if (focusTick) ref.current?.focus()
  }, [focusTick])
  useEffect(() => {
    // grow with the text, within the variant's limits
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [draft.text])

  const attach = async (files: File[]) => {
    if (!project || newProject) return store.setState({ error: 'Images can be attached once the project exists. Send your idea first.' })
    for (const f of files.slice(0, 5)) {
      const rel = await actions.run(async () => window.autopia.saveAttachment(project.id, f.name || 'pasted', await readDataUrl(f)))
      if (rel) setDraft(key, { attachments: [...(drafts.getState().map[key]?.attachments ?? []), rel] })
    }
  }

  const send = async () => {
    const text = draft.text.trim()
    if (!text || busy) return
    setBusy(true)
    // a reply carries what it answers, so the team (and the session) keep the context
    const withReply = reply ? `Replying to ${reply.who}: “${reply.text.slice(0, 280)}”\n\n${text}` : text
    const msg = await actions.run(() =>
      window.autopia.sendMessage({
        projectId: newProject ? null : project!.id,
        intent,
        text: withReply,
        attachments: draft.attachments,
        employeeId: target.employeeId,
        taskId: target.taskId,
        deliveryId: target.deliveryId
      })
    )
    setBusy(false)
    if (!msg) return // the error toast explains; the draft is kept
    clearDraft(key)
    store.setState({ replyTo: null })
    if (msg.projectId !== project?.id) await actions.openProject(msg.projectId)
    actions.openSheet({ kind: 'conversation' })
    // the conversation's composer takes focus so a follow-up is one keystroke away
    store.setState((s) => ({ composerFocus: s.composerFocus + 1 }))
  }

  const commands = newProject || menuGone ? null : commandMatches(draft.text, caps)
  const wantsCommands = !newProject && draft.text.startsWith('/')
  const capsFor = project?.id
  useEffect(() => {
    if (!wantsCommands || !capsFor) return
    let live = true
    void window.autopia.claudeCapabilities(capsFor).then((c) => live && setCaps(c), () => undefined)
    return () => {
      live = false
    }
  }, [wantsCommands, capsFor])

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commands?.length && (e.key === 'Escape' || e.key === 'Tab')) {
      e.preventDefault()
      if (e.key === 'Tab') onChange(`/${commands[0].name} `)
      else setMenuGone(true)
      return
    }
    if (mention !== null && (e.key === 'Escape' || e.key === 'Tab')) {
      e.preventDefault()
      if (e.key === 'Tab') pickMention(mentionList[0]?.id)
      else setMention(null)
      return
    }
    const sendKey = e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing
    if (sendKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape') {
      ref.current?.blur()
    }
  }

  const onChange = (text: string) => {
    setDraft(key, { text })
    if (!text.startsWith('/')) setMenuGone(false)
    const m = /(?:^|\s)@(\w*)$/.exec(text)
    setMention(m ? m[1] : null)
  }
  const mentionList = mention === null ? [] : employees.filter((e) => e.name.toLowerCase().startsWith(mention.toLowerCase()) || e.title.toLowerCase().includes(mention.toLowerCase())).slice(0, 5)
  const pickMention = (id: string | undefined) => {
    if (!id) return setMention(null)
    setDraft(key, { text: draft.text.replace(/@(\w*)$/, '').trimEnd() + ' ' })
    setMention(null)
    actions.compose({ ...target, newProject: false, employeeId: id })
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files]
    if (files.length) {
      e.preventDefault()
      void attach(files)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void attach([...e.dataTransfer.files])
  }

  const placeholder = newProject
    ? 'Describe what you want to build'
    : intent === 'ask'
      ? `Ask about ${project!.name}`
      : busyTeam
        ? 'Message the team…'
        : delivered
          ? `Ask for a change to ${project!.name}`
          : `Describe what ${project!.name} should do`

  return (
    <div className={`cmp cmp-thread${dragging ? ' cmp-drop' : ''}`} onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div className="cmp-head">
        {employee && (
          <span className="cmp-chip cmp-context">
            <Avatar employee={employee} size={14} /> {employee.name.split(' ')[0]}
            <button aria-label={`Stop addressing ${employee.name}`} onClick={() => actions.compose({ ...target, employeeId: null })}>
              <Icon name="close" size={9} />
            </button>
          </span>
        )}
        {task && (
          <span className="cmp-chip cmp-context">
            {task.title.slice(0, 32)}
            <button aria-label="Remove task" onClick={() => actions.compose({ ...target, taskId: null })}>
              <Icon name="close" size={9} />
            </button>
          </span>
        )}
        {result && (
          <span className="cmp-chip cmp-context">
            Result #{result.number}
            <button aria-label="Remove result" onClick={() => actions.compose({ ...target, deliveryId: null })}>
              <Icon name="close" size={9} />
            </button>
          </span>
        )}
      </div>

      {reply && (
        <div className="cmp-reply">
          <Icon name="chat" size={11} />
          <span className="cmp-reply-text">
            Replying to <b>{reply.who}</b>: {reply.text.slice(0, 120)}
          </span>
          <button aria-label="Cancel reply" onClick={() => store.setState({ replyTo: null })}>
            <Icon name="close" size={9} />
          </button>
        </div>
      )}
      {draft.attachments.length > 0 && (
        <div className="cmp-files">
          {draft.attachments.map((a) => (
            <span key={a} className="cmp-chip cmp-context">
              <Icon name="file" size={11} /> {a.split('/').pop()!.replace(/^\d+-/, '')}
              <button aria-label="Remove attachment" onClick={() => setDraft(key, { attachments: draft.attachments.filter((x) => x !== a) })}>
                <Icon name="close" size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="cmp-body" ref={box}>
        <textarea
          ref={ref}
          rows={1}
          value={draft.text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          aria-label="Message"
          aria-busy={busy}
          readOnly={busy}
        />
        {mentionList.length > 0 && (
          <div className="cmp-menu cmp-mentions" role="listbox">
            {mentionList.map((e) => (
              <button key={e.id} role="option" onMouseDown={(ev) => (ev.preventDefault(), pickMention(e.id))}>
                <Avatar employee={e} size={16} /> {e.name} <span className="faint">{e.title}</span>
              </button>
            ))}
          </div>
        )}
        {commands && commands.length > 0 && (
          <div className="cmp-menu cmp-mentions cmp-commands" role="listbox" aria-label="Claude Code commands">
            {commands.map((c) => (
              <button key={c.name} role="option" onMouseDown={(ev) => (ev.preventDefault(), onChange(`/${c.name} `), ref.current?.focus())}>
                <span className="cmp-command-name">/{c.name}</span>
                <span className="faint cmp-command-about">{c.description}</span>
              </button>
            ))}
            <div className="cmp-commands-foot faint small">Goes straight to Claude Code, which asks before it acts.{caps.mcpServers.length ? ` MCP: ${caps.mcpServers.filter((m) => m.status === 'connected').length} of ${caps.mcpServers.length} connected.` : ''}</div>
          </div>
        )}
        <div className="cmp-actions">
          <label className={`cmp-icon${newProject ? ' disabled' : ''}`} data-tip={newProject ? 'Attach files once the project exists' : 'Attach images or files (or paste / drop them)'}>
            <input type="file" accept="image/*,.txt,.md,.json,.csv,.tsv,.pdf,.log,.yaml,.yml,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.sql,.sh,.toml" multiple hidden disabled={newProject} onChange={(e) => (void attach([...(e.target.files ?? [])]), (e.target.value = ''))} />
            <Icon name="plus" size={14} />
          </label>
          <button className="cmp-send" disabled={!draft.text.trim() || busy} onClick={() => void send()} aria-label="Send" data-tip="Send (↵) · New line (⇧↵)">
            {busy ? <span className="spinner spinner-sm" /> : <Icon name="arrowUp" size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
