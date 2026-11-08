import { useMemo, useState } from 'react'
import type { ChangeSet, DiffFile } from '@shared/types'
import { activeProject, useApp } from '../../store'
import { Avatar, Icon, timeAgo } from '../common'
import { langFor, tokenize } from './highlight'


export function Changes({ set }: { set: ChangeSet }) {
  const employees = useApp((s) => s.employees)
  const project = useApp(activeProject)!
  const [active, setActive] = useState<string | null>(set.files[0]?.path ?? null)
  const [showMine, setShowMine] = useState(false)
  const [mine, setMine] = useState<DiffFile[] | null>(null)
  const owner = useMemo(() => {
    const m = new Map<string, { key: string; employeeId: string }>()
    for (const t of set.byTask) for (const f of t.files) m.set(f, { key: t.key, employeeId: t.employeeId })
    return m
  }, [set])
  const totals = set.files.reduce((n, f) => ({ a: n.a + f.additions, d: n.d + f.deletions }), { a: 0, d: 0 })
  const file = set.files.find((f) => f.path === active) ?? set.files[0]

  return (
    <section className="changes">
      <div className="changes-head">
        <span className="section-label">Changes</span>
        <span className="muted small">
          {set.files.length} file{set.files.length === 1 ? '' : 's'} · <span className="ok-text">+{totals.a}</span> <span className="bad-text">−{totals.d}</span>
          {set.branch && ` · ${set.branch}`}
          {set.base && set.head && ` · ${set.base.slice(0, 7)}..${set.head.slice(0, 7)}`}
        </span>
        {set.uncommitted.length > 0 && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              setShowMine(!showMine)
              if (!mine) setMine(await window.autopia.uncommittedDiff(project.id))
            }}
            data-tip="Your own uncommitted edits. Autopia never commits, resets or overwrites them."
          >
            <Icon name="shield" size={12} /> Your uncommitted changes ({set.uncommitted.length})
          </button>
        )}
      </div>
      {set.note && <div className="callout callout-info small">{set.note}</div>}
      {set.commits.length > 0 && (
        <ul className="commits">
          {set.commits.map((c) => (
            <li key={c.sha}>
              <span className="mono muted">{c.sha.slice(0, 7)}</span>
              <span>{c.subject}</span>
              <span className="muted small">
                {c.author} · {timeAgo(c.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showMine && mine && (
        <div className="mine">
          <div className="callout callout-info small">These are your edits in the working copy. They are shown for context only and are left exactly as they are.</div>
          {mine.map((f) => (
            <DiffBody key={f.path} file={f} />
          ))}
        </div>
      )}
      {set.files.length > 0 && (
        <div className="diff-layout">
          <ul className="diff-files">
            {set.files.map((f) => {
              const o = owner.get(f.path)
              const e = o && employees.find((x) => x.id === o.employeeId)
              return (
                <li key={f.path} className={f.path === file?.path ? 'active' : ''} onClick={() => setActive(f.path)}>
                  <span className={`fstat fstat-${f.status}`}>{f.status}</span>
                  <span className="diff-path" title={f.path}>
                    {f.path}
                  </span>
                  {e && <Avatar employee={e} size={16} />}
                  <span className="diff-counts">
                    <span className="ok-text">+{f.additions}</span> <span className="bad-text">−{f.deletions}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {file && <DiffBody file={file} attribution={owner.get(file.path) ?? null} />}
        </div>
      )}
    </section>
  )
}

function DiffBody({ file, attribution }: { file: DiffFile; attribution?: { key: string; employeeId: string } | null }) {
  const lang = langFor(file.path)
  const employees = useApp((s) => s.employees)
  const e = attribution && employees.find((x) => x.id === attribution.employeeId)
  return (
    <div className="diff">
      <div className="diff-title">
        <span className="mono">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        {e && (
          <span className="muted small">
            {e.name.split(' ')[0]}
          </span>
        )}
      </div>
      {file.binary ? (
        <div className="diff-note">Binary file</div>
      ) : !file.hunks.length ? (
        <div className="diff-note">No line changes to show</div>
      ) : (
        <table className="diff-table">
          <tbody>
            {file.hunks.map((h, hi) => [
              <tr key={`h${hi}`} className="diff-hunk">
                <td colSpan={3}>{h.header}</td>
              </tr>,
              ...h.lines.map((l, li) => (
                <tr key={`${hi}:${li}`} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>
                  <td className="ln">{l.oldNo ?? ''}</td>
                  <td className="ln">{l.newNo ?? ''}</td>
                  <td className="code">
                    <span className="sign">{l.t === ' ' ? ' ' : l.t}</span>
                    {tokenize(l.text, lang).map((tk, ti) => (
                      <span key={ti} className={`tk-${tk.t}`}>
                        {tk.v}
                      </span>
                    ))}
                  </td>
                </tr>
              ))
            ])}
          </tbody>
        </table>
      )}
      {file.truncated && <div className="diff-note">Long diff truncated at 1,500 lines.</div>}
    </div>
  )
}
