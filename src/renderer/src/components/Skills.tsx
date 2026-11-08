import { useEffect, useState } from 'react'
import { SKILL_GROUPS, type SkillEntry, type SkillUse } from '@shared/skills'
import type { SkillInstall, SkillsReport } from '@shared/types'
import { Dialog, Loading, Switch } from './ui'
import { actions } from '../store'
import { Icon, Pill, timeAgo } from './common'

const USE_WORD: Record<SkillUse['how'], string> = { given: 'Given to the task', offered: 'Offered to the task', loaded: 'Loaded, not called', invoked: 'Really used' }

/**
 * Autopia picks skills for each task by itself. This is only where you say which ones it may pick from, add your
 * own, and see what really happened. Nothing is discovered or fetched unless you point at it.
 */
export function Skills() {
  const [report, setReport] = useState<SkillsReport | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const load = () => window.autopia.skillsReport().then(setReport)
  useEffect(() => {
    void load()
  }, [])
  const run = async (fn: () => Promise<unknown>) => {
    await actions.run(fn)
    await load()
  }
  if (!report) return <Loading>Loading skills…</Loading>

  const q = query.trim().toLowerCase()
  const shown = report.skills.filter((s) => !q || `${s.name} ${s.about}`.toLowerCase().includes(q))
  const groups: [string, SkillEntry[]][] = [['Yours', shown.filter((s) => s.origin === 'external')], ...SKILL_GROUPS.map((g) => [g, shown.filter((s) => s.group === g)] as [string, SkillEntry[]])]
  const install: SkillInstall | null = report.installs.find((i) => i.id === reviewing) ?? null
  const on = report.skills.filter((s) => s.state === 'on').length

  return (
    <div className="sk">
      <header className="sk-head">
        <div>
          <h2>Skills</h2>
          <p className="muted">The team picks the right ones for each task on its own. {on} of {report.skills.length} are on, and a skill only loads when a task needs it.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setInstalling(true)}>
          <Icon name="plus" size={13} /> Install external skill
        </button>
      </header>

      <input className="input sk-search" type="search" value={query} placeholder="Search skills" aria-label="Search skills" onChange={(e) => setQuery(e.target.value)} />

      {report.orgManaged && <p className="small muted sk-org"><Icon name="shield" size={12} /> Your organization’s policy applies to some skills. Those can’t be turned on here.</p>}

      {groups.map(([name, list]) =>
        list.length ? (
          <section key={name} className="sk-group">
            <h3>{name}</h3>
            <ul>
              {list.map((s) => (
                <SkillRow key={s.id} skill={s} open={open === s.id} onOpen={() => setOpen(open === s.id ? null : s.id)} onToggle={(v) => run(() => window.autopia.setSkillEnabled(s.id, v))} onReview={() => setReviewing(s.id)} onRemove={() => run(() => window.autopia.removeSkill(s.id))} />
              ))}
            </ul>
          </section>
        ) : null
      )}
      {!shown.length && <p className="muted small">No skill matches “{query}”.</p>}

      <div className="sk-personal">
        <Switch ariaLabel="Also use my personal Claude Code skills" checked={report.scope === 'personal'} onChange={(v) => run(() => window.autopia.setSkillScope(v ? 'personal' : 'routed'))} />
        <div>
          <strong className="small">Also use my personal Claude Code skills</strong>
          <p className="small muted">
            {report.personalSkills.length ? `${report.personalSkills.length} found on this Mac. ` : ''}
            They come from your own Claude Code setup and load in every session, so Autopia doesn’t choose them per task.
          </p>
        </div>
      </div>

      {installing && (
        <InstallDialog
          onClose={() => setInstalling(false)}
          onInstalled={(id) => {
            setInstalling(false)
            void load().then(() => setReviewing(id))
          }}
        />
      )}
      {install && <Review install={install} onClose={() => setReviewing(null)} onDone={(fn) => run(fn).then(() => setReviewing(null))} />}
    </div>
  )
}

function SkillRow({ skill: s, open, onOpen, onToggle, onReview, onRemove }: { skill: SkillEntry; open: boolean; onOpen: () => void; onToggle: (on: boolean) => void; onReview: () => void; onRemove: () => void }) {
  return (
    <li className={`sk-row${s.state === 'off' || s.state === 'blocked' ? ' off' : ''}`}>
      <div className="sk-line">
        <button className="sk-open" onClick={onOpen} aria-expanded={open}>
          <span className="sk-name">{s.name}</span>
          <span className="sk-about small muted">{s.about}</span>
        </button>
        {s.origin === 'external' && <span className="chip">External</span>}
        {s.usage.selected > 0 && <span className="small faint sk-last">{timeAgo(s.usage.last!)}</span>}
        {s.state === 'review' ? (
          <button className="btn btn-sm btn-primary" onClick={onReview}>
            Review
          </button>
        ) : s.state === 'blocked' ? (
          <Pill tone="muted">Blocked by your organization</Pill>
        ) : (
          <Switch checked={s.state === 'on'} ariaLabel={s.name} tip={s.state === 'on' ? 'The team may use this' : 'The team won’t use this'} onChange={onToggle} />
        )}
      </div>
      {open && (
        <div className="sk-detail">
          {s.usage.selected === 0 ? (
            <p className="small muted">{s.state === 'review' ? 'Not usable until you review it.' : 'No task has needed it yet.'}</p>
          ) : (
            <>
              <p className="small muted">
                {s.origin === 'built-in' && s.id !== 'reviewer'
                  ? `Given to ${s.usage.selected} ${s.usage.selected === 1 ? 'run' : 'runs'}. Its guidance goes into the task’s instructions, so there is no record of it being called.`
                  : `Offered to ${s.usage.selected} ${s.usage.selected === 1 ? 'run' : 'runs'}, really used in ${s.usage.invoked}.`}
              </p>
              <ul className="sk-uses">
                {s.recent.map((u) => (
                  <li key={u.runId} className="small">
                    <span className="sk-use-what">{u.taskTitle ?? 'A conversation'}</span>
                    <span className="faint">
                      {u.projectName} · {timeAgo(u.at)} · {USE_WORD[u.how]}
                      {u.why ? ` · because ${u.why}` : ''}
                    </span>
                    {u.taskId && (
                      <button
                        className="link small"
                        onClick={() => {
                          void actions.openProject(u.projectId).then(() => actions.openSheet({ kind: 'task', id: u.taskId! }))
                        }}
                      >
                        Open
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.origin === 'external' && (
            <div className="sk-ext">
              <span className="small faint mono sk-source">{s.source}</span>
              {s.hasScripts && <span className="small warn-text">Contains scripts. They only run under your permission rules.</span>}
              <span className="grow" />
              {s.state !== 'review' && (
                <button className="btn btn-sm btn-ghost" onClick={onReview}>
                  See its files
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={onRemove}>
                <Icon name="trash" size={12} /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Only from where you point. It arrives switched off, and goes through the same review either way. */
function InstallDialog({ onClose, onInstalled }: { onClose: () => void; onInstalled: (id: string) => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (fn: () => Promise<SkillInstall | null>) => {
    setBusy(true)
    const done = await actions.run(fn)
    setBusy(false)
    if (done) onInstalled(done.id)
  }
  return (
    <Dialog onClose={onClose}>
      <h3>Install an external skill</h3>
      <p className="small muted">You’ll see what’s inside and approve it before the team can use it. Autopia never runs its files.</p>
      <button className="btn sk-pick" disabled={busy} onClick={() => void go(() => window.autopia.importLocalSkill(undefined))}>
        <Icon name="folder" size={13} /> Choose a folder on this Mac
      </button>
      <label className="small sk-link">
        Or paste a GitHub link to a skill folder
        <input className="input" value={link} disabled={busy} spellCheck={false} placeholder="https://github.com/owner/repo/tree/main/skills/name" onChange={(e) => setLink(e.target.value)} />
      </label>
      <div className="row gap right">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || !link.trim()} onClick={() => void go(() => window.autopia.installSkillFromGitHub(link.trim()))}>
          {busy ? 'Fetching…' : 'Fetch for review'}
        </button>
      </div>
    </Dialog>
  )
}

function Review({ install, onClose, onDone }: { install: SkillInstall; onClose: () => void; onDone: (fn: () => Promise<unknown>) => void }) {
  const blocked = install.findings.some((f) => f.severity === 'danger')
  const pending = install.status === 'reviewing' || install.status === 'rejected'
  return (
    <Dialog onClose={onClose} wide>
      <h3>{pending ? 'Review this skill' : 'What’s in this skill'}</h3>
      <p className="faint small mono">
        {install.repo === 'local' ? install.path : `github.com/${install.repo}`} {install.repo === 'local' ? '' : `@ ${install.sha.slice(0, 12)}`} · {install.files.length} files
      </p>
      <h4>What the safety check found</h4>
      {install.findings.length ? (
        <ul className="findings">
          {install.findings.map((f, i) => (
            <li key={i} className={f.severity}>
              <Pill tone={f.severity === 'danger' ? 'danger' : f.severity === 'warn' ? 'warn' : 'info'}>{f.severity === 'danger' ? 'Blocks it' : f.severity === 'warn' ? 'Worth a look' : 'Note'}</Pill> <span className="mono small">{f.file}</span> {f.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">No scripts, network calls, hooks or injection patterns found. Read the instructions below anyway.</p>
      )}
      <details className="sk-files">
        <summary className="small">Files</summary>
        <ul className="small mono files-list">
          {install.files.map((f) => (
            <li key={f.path}>
              {f.path} <span className="faint">{(f.bytes / 1024).toFixed(1)} KB</span>
            </li>
          ))}
        </ul>
      </details>
      <h4>Its instructions</h4>
      <pre className="skill-md">{install.skillMd || '(empty)'}</pre>
      {pending && (
        <div className="row gap right">
          <button className="btn btn-danger" onClick={() => onDone(() => window.autopia.removeSkill(install.id))}>
            Reject and delete
          </button>
          <button className="btn btn-primary" disabled={blocked} data-tip={blocked ? 'The safety check blocks this one' : undefined} onClick={() => onDone(() => window.autopia.approveSkill(install.id))}>
            Approve and turn on
          </button>
        </div>
      )}
    </Dialog>
  )
}
