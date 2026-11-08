import { useCallback, useEffect, useState } from 'react'
import type { FileContent, FsEntry } from '@shared/types'
import { activeProject, actions, sortedTasks, store, useApp } from '../store'
import { Icon } from './common'

export function FileBrowser() {
  const project = useApp(activeProject)!
  const tasks = useApp(sortedTasks)
  const requested = useApp((s) => s.openFilePath)
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [file, setFile] = useState<FileContent | null>(null)

  const changed = new Set(tasks.flatMap((t) => t.changedFiles.map((f) => f.split(' ').slice(1).join(' '))))
  // refresh the listing when tasks finish so new files appear
  const doneCount = tasks.filter((t) => t.status === 'done').length

  const load = useCallback(
    async (rel: string) => {
      const list = await actions.run(() => window.autopia.listDir(project.id, rel))
      if (list) {
        setEntries(list)
        setDir(rel)
      }
    },
    [project.id]
  )

  const open = useCallback(
    async (rel: string) => {
      const content = await actions.run(() => window.autopia.readFile(project.id, rel))
      if (content) setFile(content)
    },
    [project.id]
  )

  useEffect(() => {
    void load(dir)
  }, [load, doneCount]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!requested) return
    store.setState({ openFilePath: null })
    const parent = requested.includes('/') ? requested.slice(0, requested.lastIndexOf('/')) : ''
    void load(parent).then(() => open(requested))
  }, [requested, load, open])

  const crumbs = dir ? dir.split('/') : []

  if (file) {
    const lines = file.content.split('\n')
    return (
      <div className="viewer">
        <header className="viewer-head">
          <button className="icon-btn" onClick={() => setFile(null)} title="Back" aria-label="Back to files">
            <Icon name="back" />
          </button>
          <span className="viewer-path">{file.relPath}</span>
          <button className="icon-btn" aria-label="Show in Finder" onClick={() => window.autopia.revealInFinder(project.id, file.relPath)} title="Reveal in Finder">
            <Icon name="reveal" />
          </button>
        </header>
        {file.binary ? (
          <div className="empty">Binary file ({file.size.toLocaleString()} bytes)</div>
        ) : (
          <pre className="code">
            {lines.map((l, i) => (
              <div key={i} className="code-line">
                <span className="ln">{i + 1}</span>
                <span>{l ? highlight(l) : ' '}</span>
              </div>
            ))}
            {file.truncated && <div className="muted">… truncated ({file.size.toLocaleString()} bytes)</div>}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="files-browser">
      <div className="crumbs">
        <button className="link" onClick={() => load('')}>
          {project.name}
        </button>
        {crumbs.map((c, i) => (
          <span key={i}>
            {' / '}
            <button className="link" onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>
              {c}
            </button>
          </span>
        ))}
      </div>
      {entries.length === 0 && <div className="empty small">This folder is empty.</div>}
      <ul className="entries">
        {dir && (
          <li onClick={() => load(crumbs.slice(0, -1).join('/'))}>
            <Icon name="back" /> ..
          </li>
        )}
        {entries.map((e) => (
          <li key={e.relPath} onClick={() => (e.isDir ? load(e.relPath) : open(e.relPath))}>
            <span className={`ficon ${e.isDir ? 'dir' : `ext-${e.name.split('.').pop()?.toLowerCase()}`}`}>
              <Icon name={e.isDir ? 'folder' : 'file'} size={13} />
            </span>
            <span className="entry-name">{e.name}</span>
            {changed.has(e.relPath) && <span className="badge badge-ok">changed</span>}
            {!e.isDir && <span className="muted small">{formatSize(e.size)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const KEYWORDS = new Set(
  'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of interface type enum public private protected readonly static def lambda pass None True False self fn pub use mod struct impl match null undefined true false this'.split(' ')
)
const TOKEN = /(\/\/.*$|#(?!!).*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g

/** Tiny, dependency-free highlighter: comments, strings, numbers and keywords. */
function highlight(line: string) {
  const out: (string | JSX.Element)[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const t = m[0]
    const cls = t.startsWith('//') || t.startsWith('#') ? 'tk-c' : /^["'`]/.test(t) ? 'tk-s' : /^\d/.test(t) ? 'tk-n' : KEYWORDS.has(t) ? 'tk-k' : null
    out.push(cls ? <span key={m.index} className={cls}>{t}</span> : t)
    last = m.index + t.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
