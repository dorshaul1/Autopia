import { useState } from 'react'
import type { Project } from '@shared/types'
import { actions } from '../store'
import { Dialog } from './ui'

export function DeleteProject({ project, onClose }: { project: Project; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [kept, setKept] = useState<string[] | null>(null)
  const working = project.phase === 'planning' || project.phase === 'executing'
  if (kept) {
    return (
      <Dialog onClose={onClose}>
        <h2>Product deleted</h2>
        <p className="muted">
          {project.name} is no longer in Autopia. Its folder is untouched{kept.length ? ', and these task branches with unmerged work stay in the repository:' : '.'}
        </p>
        {kept.length > 0 && <pre className="mono small">{kept.join('\n')}</pre>}
        <div className="row gap end">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog onClose={onClose}>
      <h2>Delete {project.name}?</h2>
      <p className="muted">
        This removes it from Autopia: its tasks, results, history and memory. It can’t be undone.
      </p>
      <div className="callout callout-info small">
        Your files stay exactly where they are in <span className="mono">{project.path}</span>, and any task branches are kept in the repository. You can open the folder
        again later as a new product.
      </div>
      {working && <div className="callout callout-warn small">The team is working on this. Deleting it stops their work first.</div>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await actions.run(() => window.autopia.deleteProject(project.id))
            setBusy(false)
            if (r) setKept(r.keptBranches)
          }}
        >
          Delete product
        </button>
      </div>
    </Dialog>
  )
}
