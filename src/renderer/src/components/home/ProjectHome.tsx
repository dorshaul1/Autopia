import { useEffect, useMemo } from 'react'
import { opsLine } from '@shared/operations'
import { openLabel, productOverview, purposeOf } from '@shared/projectHome'
import { REVIEW_WORD, reviewStateOf } from '@shared/timeline'
import { activeProject, actions, opsChecks, sortedTasks, useApp } from '../../store'
import { Icon, timeAgo } from '../common'
import { MissionControl } from '../mission/MissionControl'
import { SeeTheOffice } from './FirstRun'
import { ProductImage } from './ProductImage'

/**
 * The one page for a product: what it is, what's happening, what needs you, and where to see it. Every section is earned: nothing appears unless the records
 * show it, so a brand new product and a busy one look properly different.
 */
export function ProjectHome() {
  const project = useApp(activeProject)!
  const tasks = useApp(sortedTasks)
  const deliveries = useApp((s) => s.deliveries)
  const approvals = useApp((s) => s.approvals)
  const spec = useApp((s) => s.product)
  const lastSeen = useApp((s) => s.lastSeen)
  const preview = useApp((s) => s.preview)
  const o = useMemo(
    () => productOverview({ project, tasks, deliveries, approvals: Object.values(approvals).filter((a) => a.projectId === project.id), lastSeen, now: Date.now() }),
    [project, tasks, deliveries, approvals, lastSeen]
  )
  const purpose = purposeOf(spec?.vision, project.goal)
  const talk = () => actions.talkTo(null)
  const isWeb = !!preview && preview.kind !== 'none' && preview.expects !== 'process'
  const checks = useApp(opsChecks)
  const line = opsLine(preview, checks)
  useEffect(() => void actions.refreshOps(), [project.id])
  return (
    <div className="ws-scroll">
      <div className="ph">
        <header className="ph-hero">
          <h1>{project.name}</h1>
          {purpose ? <p className="ph-purpose">{purpose}</p> : <p className="ph-purpose faint">No brief yet. Tell the team what this should become.</p>}
          {project.paused && <div className="ph-meta"><span className="warn-text">Paused</span></div>}
          <SeeTheOffice />
        </header>

        {line && (
          <button className={`ph-ops tone-${line.tone}`} onClick={() => actions.goStage('operations')}>
            <span className={`pulse-dot tone-${line.tone === 'danger' ? 'danger' : line.tone === 'ok' ? 'ready' : line.tone === 'info' ? 'live' : 'quiet'}`} aria-hidden />
            {line.text}
            <Icon name="chevron" size={10} />
          </button>
        )}

        {o.since && (
          <section className="ph-since" aria-label="While you were away">
            <h2>Since you were here {o.since.away} ago</h2>
            {o.since.finished.length === 0 && o.since.results.length === 0 ? (
              <p>Nothing changed.{o.moment === 'idle' || o.moment === 'ready' ? ' It’s as you left it.' : ''}</p>
            ) : (
              <p>
                {o.since.finished.length > 0 && `${o.since.finished.length} ${o.since.finished.length === 1 ? 'task' : 'tasks'} finished. `}
                {o.since.results.length > 0 && `${o.since.results.length} new ${o.since.results.length === 1 ? 'delivery' : 'deliveries'}.`}
              </p>
            )}
          </section>
        )}

        <div className="ph-grid">
          <div className="ph-main">
            {o.moment === 'fresh' && (
              <section className="ph-section">
                <h2>Get started</h2>
                <p className="muted">Tell the team what you want. They'll work out the rest, and ask only if they have to.</p>
                <button className="btn btn-primary" onClick={talk}>
                  <Icon name="chat" size={12} /> Tell the team
                </button>
              </section>
            )}

            <MissionControl />
          </div>

          <div className="ph-side">
            <figure className="ph-product">
              <button className="ph-shot" onClick={() => actions.goStage(isWeb || o.latest ? 'preview' : 'office')} aria-label={isWeb || o.latest ? `${openLabel(project.officeType)} ` : 'See the team at work'}>
                <ProductImage
                  project={project}
                  stamp={o.latest?.completedAt}
                  none={
                    o.moment === 'fresh' || !o.latest ? undefined : (
                      <span className="ph-noshot">
                        <Icon name="eye" size={18} />
                        {`No picture of it yet. ${openLabel(project.officeType)} once and it appears here.`}
                      </span>
                    )
                  }
                />
              </button>
              <figcaption>
                {o.latest ? (
                  <span>
                    Result #{o.latest.number}, {REVIEW_WORD[reviewStateOf(o.latest)].toLowerCase()} · {timeAgo(o.latest.completedAt!)}
                  </span>
                ) : o.moment === 'fresh' ? (
                  <span>Nothing built yet. This is the office where it’ll happen.</span>
                ) : (
                  <span>The first result appears here.</span>
                )}
                {(preview?.status === 'running' || isWeb) && !deliveries.some((d) => d.status === 'review') && (
                  <button className="btn btn-sm" onClick={() => actions.goStage('preview')}>
                    {openLabel(project.officeType)}
                  </button>
                )}
              </figcaption>
            </figure>

            <Direction fresh={o.moment === 'fresh'} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The product's direction in plain words, and one place to change it. It goes through the same paths as any request. */
function Direction({ fresh }: { fresh: boolean }) {
  const spec = useApp((s) => s.product)
  if (fresh && !spec) return null
  const milestones = spec?.milestones ?? []
  const done = milestones.filter((m) => m.status === 'done').length
  return (
    <section className="ph-section ph-direction">
      <h2>Direction</h2>
      {milestones.length > 0 && (
        <p className="muted">
          Milestone {Math.min(done + 1, milestones.length)} of {milestones.length}: {milestones[Math.min(done, milestones.length - 1)].title}
        </p>
      )}
      {spec?.completeness?.notBuilding.length ? <p className="faint small">Not building: {spec.completeness.notBuilding.join(', ')}.</p> : null}
      {spec && spec.changes.length > 0 && <p className="faint small">Last change from you: “{spec.changes[spec.changes.length - 1].request.split('\n')[0].slice(0, 90)}”</p>}
      <button className="btn btn-sm" onClick={() => actions.openCommand('direction')}>
        Change the direction
      </button>
      {spec && (
        <button className="link small" onClick={() => actions.goStage('brief')}>
          The full brief
        </button>
      )}
    </section>
  )
}
