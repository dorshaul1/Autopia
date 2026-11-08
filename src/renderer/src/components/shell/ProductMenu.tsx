import { useState } from 'react'
import type { Project } from '@shared/types'
import { actions } from '../../store'
import { Icon } from '../common'
import { DeleteProject } from '../ProjectActions'
import { Dialog, menuKeys, usePopover } from '../ui'

/** Everything you can do to a product as a whole. The same menu wherever a product appears. */
export function ProductMenu({ project: p, pop }: { project: Project; pop: ReturnType<typeof usePopover> }) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(p.name)
  const [deleting, setDeleting] = useState(false)
  const close = () => pop.setOpen(false)
  return (
    <>
      {pop.open && (
        <div className="popover menu-list product-menu" role="menu" onKeyDown={menuKeys}>
          <button role="menuitem" onClick={() => (close(), setDraft(p.name), setRenaming(true))}>
            <Icon name="edit" size={12} /> Rename…
          </button>
          <button role="menuitem" onClick={() => (close(), void actions.run(() => window.autopia.setProjectControls(p.id, { paused: !p.paused })))}>
            <Icon name={p.paused ? 'play' : 'stop'} size={12} /> {p.paused ? 'Resume work' : 'Pause work'}
          </button>
          <button role="menuitem" onClick={() => (close(), void window.autopia.revealInFinder(p.id, ''))}>
            <Icon name="folder" size={12} /> Show in Finder
          </button>
          <div className="popover-sep" />
          <button role="menuitem" className="danger" onClick={() => (close(), setDeleting(true))}>
            <Icon name="trash" size={12} /> Delete…
          </button>
        </div>
      )}
      {renaming && (
        <Dialog title={`Rename ${p.name}`} onClose={() => setRenaming(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (await actions.run(() => window.autopia.renameProject(p.id, draft))) setRenaming(false)
            }}
          >
            <input className="input" autoFocus aria-label="Name" value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!draft.trim()}>
                Rename
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleting && <DeleteProject project={p} onClose={() => setDeleting(false)} />}
    </>
  )
}
