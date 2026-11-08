import type { DeliveryStatus } from '@shared/types'
import { activeProject, useApp, type WorkspaceSection } from '../../store'
import { Inspector } from '../inspector/Inspector'
import { Icon } from '../common'
import { FileBrowser } from '../FileBrowser'
import { Insights } from '../Insights'
import { Knowledge } from './Knowledge'
import { Product } from './Product'
import { ProjectHome } from '../home/ProjectHome'
import { Operations } from '../operations/Operations'

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  implementing: 'In progress',
  validating: 'Checking',
  review: 'Ready to review',
  accepted: 'Accepted',
  revising: 'Changes requested',
  rejected: 'Discarded'
}

export const DELIVERY_TONE: Record<DeliveryStatus, 'info' | 'warn' | 'ok' | 'danger' | 'muted'> = {
  implementing: 'info',
  validating: 'info',
  review: 'warn',
  accepted: 'ok',
  revising: 'muted',
  rejected: 'danger'
}

const KNOWN: WorkspaceSection[] = ['product', 'overview', 'activity', 'files', 'operations', 'knowledge', 'insights']

/** What a stage shows when it's one of the product's records. The header chooses; this just draws it. */
export function Workspace() {
  const project = useApp(activeProject)
  const raw = useApp((s) => s.section)
  const hasProduct = useApp((s) => !!s.product)
  if (!project) return null
  // a window can remember a place that no longer exists: the Overview is where that work went
  const section: WorkspaceSection = (raw === 'product' && !hasProduct) || !KNOWN.includes(raw) ? 'overview' : raw
  return (
    <div className="fv">
      <section className="fv-main">
        {section === 'overview' && <ProjectHome />}
        {section === 'product' && <Product />}
        {section === 'insights' && (
          <div className="ws-scroll ws-page">
            <Insights />
          </div>
        )}
        {section === 'activity' && (
          <Inspector />
        )}
        {section === 'files' && (
          <div className="ws-scroll ws-page">
            <button className="fv-path fv-path-corner" onClick={() => window.autopia.revealInFinder(project.id, '')} data-tip={`${project.path} · Show in Finder`}>
              <Icon name={project.gitEnabled ? 'branch' : 'folder'} size={11} /> {project.gitEnabled ? project.baseBranch : 'no git'}
            </button>
            <FileBrowser key={project.id} />
          </div>
        )}
        {section === 'operations' && (
          <div className="ws-scroll ws-page">
            <Operations />
          </div>
        )}
        {section === 'knowledge' && <Knowledge />}
      </section>
    </div>
  )
}


