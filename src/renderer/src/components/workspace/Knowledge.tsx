import { useEffect, useState } from 'react'
import { Dialog, Loading, Switch, confirmAction } from '../ui'
import { ORIGIN_LABEL, originOf, type KnowledgeOrigin } from '@shared/knowledge'
import type { KnowledgeEntry, KnowledgeKind, MemoryReport } from '@shared/types'
import { activeProject, actions, useApp } from '../../store'
import { Icon, timeAgo } from '../common'

const KIND_LABEL: Record<KnowledgeKind, string> = {
  stack: 'Stack',
  module: 'Layout',
  workflow: 'Workflow',
  dependency: 'Dependencies',
  convention: 'Conventions',
  architecture: 'Architecture',
  decision: 'Decision',
  limitation: 'Known limitation',
  completed: 'Completed work',
  handoff: 'Handoff',
  lesson: 'Lesson'
}

const ORIGIN_STYLE: Record<KnowledgeOrigin, string> = { yours: 'conf-user', repo: 'conf-verified', plan: 'conf-reported', team: 'conf-reported', assumption: 'conf-stale', history: 'conf-reported' }

const staleWord = (note: string | null) => (note?.startsWith('Conflicts') ? 'conflicts with your decision' : note?.startsWith('You later') ? 'you changed this' : note?.includes('no longer') ? 'out of date' : 'stale · files changed')

/** What the team goes by on this project, and what's still open, before any of the detail. */
function Understanding({ entries }: { entries: KnowledgeEntry[] }) {
  const live = entries.filter((e) => e.status === 'active')
  const purpose = live.find((e) => e.topic === 'purpose:project')
  const yours = live.filter((e) => e.author === 'user' && e.topic !== 'purpose:project' && (e.kind === 'decision' || e.topic.startsWith('preference:'))).sort((a, b) => b.updatedAt - a.updatedAt)
  const open = live.filter((e) => e.topic.startsWith('assumption:'))
  const check = entries.filter((e) => (e.status === 'stale' && (e.kind === 'decision' || e.kind === 'architecture')) || (e.status === 'active' && e.author === 'user' && e.statusNote))
  if (!purpose && !yours.length && !open.length && !check.length) return null
  const list = (title: string, items: KnowledgeEntry[], line: (e: KnowledgeEntry) => string) =>
    items.length > 0 && (
      <div>
        <h4>{title}</h4>
        <ul>
          {items.slice(0, 5).map((e) => (
            <li key={e.id}>{line(e)}</li>
          ))}
        </ul>
        {items.length > 5 && <p className="muted small">and {items.length - 5} more below</p>}
      </div>
    )
  return (
    <section className="mem-know" aria-label="What the team goes by">
      {purpose && <p className="mem-purpose">{purpose.text}</p>}
      <div className="mem-know-grid">
        {list('You decided', yours, (e) => (e.text.startsWith(e.title) ? e.text : `${e.title} ${e.text}`))}
        {list('Not confirmed yet', open, (e) => (e.text.startsWith(e.title) ? e.text : `${e.title} Going with: ${e.text}`))}
        {list('Needs a look', check, (e) => `${e.title}: ${e.statusNote ?? 'its files changed'}`)}
      </div>
      <p className="muted small">If any of this is wrong, tell the team in your own words, like “use Postgres instead of SQLite”. The newer word wins and the old one is kept as history.</p>
    </section>
  )
}

/**
 * The company's memory of this project: what Autopia read from the repository, what the team decided
 * and reported, what history shows, and exactly which notes each task was given.
 */
export function Knowledge() {
  const project = useApp(activeProject)!
  const deliveries = useApp((s) => s.deliveries)
  const [report, setReport] = useState<MemoryReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Partial<KnowledgeEntry> | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = () => window.autopia.memoryReport(project.id).then(setReport)
  useEffect(() => {
    void load()
  }, [project.id, deliveries])

  if (!report) return <Loading>Loading memory…</Loading>
  const visible = report.entries.filter((e) => showArchived || e.status !== 'archived')
  const auto = visible.filter((e) => ['stack', 'module', 'workflow', 'dependency', 'convention'].includes(e.kind))
  const architecture = visible.filter((e) => e.kind === 'architecture')
  const decisions = visible.filter((e) => e.kind === 'decision')
  const notes = visible.filter((e) => ['completed', 'handoff', 'limitation'].includes(e.kind))

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true)
    await actions.run(fn)
    await load()
    setBusy(false)
  }

  return (
    <div className="ws-scroll ws-pad memory">
      <header className="mem-head">
        <div>
          <h3>Memory</h3>
          <p className="muted small">
            What the team knows about this product. It’s checked against the project, and the code always wins.
          </p>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => window.autopia.reindexMemory(project.id))} data-tip="Read the project again and check every note against the current files">
          <Icon name="refresh" size={12} /> Re-check
        </button>
      </header>

      <Understanding entries={report.entries} />
      {report.index.hasClaudeMd && (
        <div className="callout callout-info small">This repository has a CLAUDE.md. Claude Code reads it itself, so Autopia never copies it into prompts and its instructions take precedence over these notes.</div>
      )}

      <section className="mem-part">
        <header className="mem-part-head">
          <h4>Decisions</h4>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ kind: 'decision', title: '', text: '', rationale: '', alternatives: '', files: [] })}>
            <Icon name="plus" size={12} /> Record a decision
          </button>
        </header>
        <div className="mem-list">
          {decisions.map((e) => (
            <Entry key={e.id} e={e} onChanged={load} onEdit={setEditing} adr />
          ))}
          {!decisions.length && <p className="muted small">None yet. The team records only the significant ones, and anything you decide in the conversation lands here.</p>}
        </div>
      </section>

      <details className="mem-part">
        <summary>
          How the project is built <span className="faint">{auto.length + architecture.length}</span>
        </summary>
        <div className="mem-grid">
          {[...auto, ...architecture].map((e) => (
            <Entry key={e.id} e={e} onChanged={load} onEdit={setEditing} />
          ))}
          {!auto.length && !architecture.length && <p className="muted small">Nothing read yet. Press Re-check.</p>}
        </div>
      </details>

      <details className="mem-part">
        <summary>
          Work notes <span className="faint">{notes.length}</span>
        </summary>
        <div className="mem-list">
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ kind: 'convention', title: '', text: '', files: [] })}>
            <Icon name="plus" size={12} /> Add a note
          </button>
          {notes.map((e) => (
            <Entry key={e.id} e={e} onChanged={load} onEdit={setEditing} />
          ))}
          {!notes.length && <p className="muted small">Handoffs, accepted work and known limitations appear here as the team delivers.</p>}
        </div>
      </details>

      <footer className="mem-foot">
        <Switch className="mem-toggle" checked={showArchived} onChange={setShowArchived} label="Show history" />
        <button
          className="link small"
          disabled={busy}
          onClick={async () => {
            if (!(await confirmAction({ title: `Reset memory for ${project.name}?`, body: 'Notes written by Autopia and the team are deleted. Your own notes are kept.', action: 'Reset memory', danger: true }))) return
            void run(() => window.autopia.resetMemory(project.id, false))
          }}
        >
          Reset memory
        </button>
      </footer>

      {editing && (
        <Editor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function Entry({ e, onChanged, onEdit, adr }: { e: KnowledgeEntry; onChanged: () => void; onEdit: (e: KnowledgeEntry) => void; adr?: boolean }) {
  const set = (status: KnowledgeEntry['status']) => actions.run(() => window.autopia.setKnowledgeStatus(e.id, status)).then(onChanged)
  const remove = async () => {
    const mine = e.author === 'user'
    if (mine && !(await confirmAction({ title: 'Delete this note?', body: 'You wrote it, and this can’t be undone.', action: 'Delete note', danger: true }))) return
    await actions.run(() => window.autopia.forgetKnowledge(e.id, mine))
    onChanged()
  }
  return (
    <article className={`mem-entry mem-${e.status}`}>
      <header>
        <span className="mem-kind">{KIND_LABEL[e.kind]}</span>
        <span className={`conf ${ORIGIN_STYLE[originOf(e)]}`}>{ORIGIN_LABEL[originOf(e)]}</span>
        {e.status === 'stale' && <span className="conf conf-stale">{staleWord(e.statusNote)}</span>}
        {e.status === 'active' && e.statusNote && <span className="conf conf-stale">may be out of date</span>}
        {e.status === 'archived' && <span className="conf">archived</span>}
        <span className="grow" />
        <span className="mem-meta">
          {e.uses > 0 && `used ${e.uses}× · `}
          {timeAgo(e.updatedAt)}
        </span>
      </header>
      <h4>{e.title}</h4>
      {e.text !== e.title && <p className="mem-text">{e.text}</p>}
      {e.statusNote && <p className="mem-why">{e.statusNote}</p>}
      {adr && e.rationale && (
        <p className="mem-why">
          <strong>Why:</strong> {e.rationale}
        </p>
      )}
      {adr && e.alternatives && (
        <p className="mem-why">
          <strong>Considered:</strong> {e.alternatives}
        </p>
      )}
      <footer>
        <span className="mem-source">{e.source}</span>
        {e.files.length > 0 && <span className="mono mem-files">{e.files.slice(0, 4).join(', ')}{e.files.length > 4 ? ` +${e.files.length - 4}` : ''}</span>}
        {e.commit && <span className="mono mem-files">@{e.commit.slice(0, 7)}</span>}
        <span className="grow" />
        {e.author !== 'system' && (
          <button className="link" onClick={() => onEdit(e)}>
            correct
          </button>
        )}
        {(e.status === 'stale' || (e.status === 'active' && e.statusNote)) && (
          <button className="link" onClick={() => set('active')} data-tip="You checked it against the current code and it still holds">
            still true
          </button>
        )}
        {e.status === 'archived' ? (
          <button className="link" onClick={() => set('active')}>
            restore
          </button>
        ) : (
          e.author !== 'system' && (
            <button className="link" onClick={() => set('archived')}>
              {adr ? 'superseded' : 'archive'}
            </button>
          )
        )}
        {e.author !== 'system' && (
          <button className="link danger" onClick={remove}>
            delete
          </button>
        )}
      </footer>
    </article>
  )
}

function Editor({ initial, onClose, onSaved }: { initial: Partial<KnowledgeEntry>; onClose: () => void; onSaved: () => void }) {
  const project = useApp(activeProject)!
  const [kind, setKind] = useState<KnowledgeKind>(initial.kind ?? 'convention')
  const [title, setTitle] = useState(initial.title ?? '')
  const [text, setText] = useState(initial.text ?? '')
  const [why, setWhy] = useState(initial.rationale ?? '')
  const [alt, setAlt] = useState(initial.alternatives ?? '')
  const [files, setFiles] = useState((initial.files ?? []).join(', '))
  const save = async () => {
    const r = await actions.run(() =>
      window.autopia.editKnowledge(project.id, {
        id: initial.id ?? null,
        kind,
        title,
        text,
        rationale: why || null,
        alternatives: alt || null,
        files: files.split(',').map((f) => f.trim()).filter(Boolean)
      })
    )
    if (r !== undefined) onSaved()
  }
  return (
    <Dialog onClose={onClose}>
      <h2>{initial.id ? 'Correct a note' : kind === 'decision' ? 'Record a decision' : 'Add a note'}</h2>
      <p className="muted small">Your notes are marked as yours, shared with the team when relevant, and never overwritten or cleaned up automatically.</p>
      {!initial.id && (
        <>
          <label className="label">Kind</label>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
            <option value="convention">Convention</option>
            <option value="decision">Decision</option>
            <option value="limitation">Known limitation</option>
            <option value="architecture">Architecture</option>
          </select>
        </>
      )}
      <label className="label">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'decision' ? 'e.g. Keep the app framework-free' : 'e.g. CSS uses BEM class names'} />
      <label className="label">{kind === 'decision' ? 'Decision' : 'Text'}</label>
      <textarea className="goal" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      {kind === 'decision' && (
        <>
          <label className="label">Why</label>
          <textarea className="goal" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          <label className="label">Alternatives considered</label>
          <input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </>
      )}
      <label className="label">Affected files or folders (comma separated, optional)</label>
      <input className="input mono" value={files} onChange={(e) => setFiles(e.target.value)} placeholder="public/app.js, src/" />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!title.trim() || !text.trim()} onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  )
}
