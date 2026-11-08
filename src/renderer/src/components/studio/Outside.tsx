import { useEffect, useState } from 'react'
import { SURFACE_WORDS, type Capture, type LaunchOption, type ProductSurface } from '@shared/studio'
import type { PreviewInfo, ProductDeliverable } from '@shared/types'
import { actions, useApp } from '../../store'
import { Icon } from '../common'
import { confirmAction } from '../ui'
import { useCaptureImage } from './Compare'
import { CheckList } from './Diagnostics'

/** A product that can't run inside Autopia: what really exists for it, and how to get at it. Never an empty browser. */
export function Outside({ preview, surface, captures }: { preview: PreviewInfo; surface: ProductSurface; captures: Capture[] }) {
  const [deliverable, setDeliverable] = useState<ProductDeliverable | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const latest = useApp((s) => s.deliveries.find((d) => d.status === 'review') ?? null)
  const [verifying, setVerifying] = useState(false)
  useEffect(() => {
    void window.autopia.productDeliverable(preview.projectId).then(setDeliverable, () => undefined)
  }, [preview.projectId])
  const newest = useCaptureImage(preview.projectId, captures[0]?.path ?? null)

  const launch = async (option: LaunchOption) => {
    if (!(await confirmAction({ title: `${option.label}?`, body: `${option.note} (${option.path})`, action: 'Open it' }))) return
    const done = await actions.run(() => window.autopia.studioLaunch(preview.projectId, option.id).then(() => true))
    if (done) setOpened(option.note)
  }
  const run = deliverable?.run ?? []
  const limitations = deliverable?.limitations ?? []

  return (
    <div className="st-outside">
      <header>
        <h2>{surface === 'game' ? 'Play it outside Autopia' : surface === 'native' ? 'Open it outside Autopia' : 'What it does'}</h2>
        <p className="muted">{SURFACE_WORDS[surface].idle} {preview.reason ?? ''}</p>
      </header>

      {preview.launch.length > 0 && (
        <section>
          <div className="row gap wrap">
            {preview.launch.map((l, i) => (
              <button key={l.id} className={`btn${i === 0 ? ' btn-primary' : ''}`} onClick={() => void launch(l)} data-tip={l.note}>
                <Icon name="reveal" size={12} /> {l.label}
              </button>
            ))}
          </div>
          {opened && <p className="small muted">Asked your Mac to open it. {opened}</p>}
        </section>
      )}
      {preview.limits.map((l) => (
        <p key={l} className="small warn-text">{l}</p>
      ))}

      {newest && (
        <section>
          <h4>Latest real capture</h4>
          <img className="st-outside-shot" src={newest} alt="The latest capture of the product" />
        </section>
      )}

      {run.length > 0 && (
        <section>
          <h4>Run it yourself</h4>
          <ul className="pd-run">
            {run.map((r) => (
              <li key={r.command}>
                <span className="faint small">{r.label}</span> <code>{r.command}</code>
                <button className="icon-btn" aria-label={`Copy ${r.command}`} data-tip="Copy" onClick={() => void navigator.clipboard.writeText(r.command)}>
                  <Icon name="file" size={10} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>The team’s last check results</h4>
        {deliverable ? <CheckList deliverable={deliverable} /> : <span className="spinner" />}
        {latest && (
          <button
            className="btn btn-sm"
            disabled={verifying}
            onClick={async () => {
              setVerifying(true)
              await actions.run(() => window.autopia.verifyDelivery(latest.id))
              setVerifying(false)
              void window.autopia.productDeliverable(preview.projectId).then(setDeliverable, () => undefined)
            }}
          >
            <Icon name="retry" size={12} /> {verifying ? 'Running it…' : 'Run it for real again'}
          </button>
        )}
      </section>

      {preview.artifacts.length > 0 && (
        <section>
          <h4>What’s in the folder</h4>
          <ul className="artifacts">
            {preview.artifacts.map((a) => (
              <li key={a.path}>
                <button className="link mono" onClick={() => void actions.run(() => window.autopia.revealInFinder(preview.projectId, a.path))} data-tip="Show in Finder">
                  {a.path}
                </button>
                <pre>{a.note}</pre>
              </li>
            ))}
          </ul>
        </section>
      )}

      {limitations.length > 0 && (
        <section>
          <h4>Worth knowing</h4>
          <ul className="rv-notes">
            {limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <button className="btn btn-sm st-outside-ask" onClick={() => actions.goStage('operations')}>
        <Icon name="play" size={12} /> Run it and check it
      </button>
      <button className="btn btn-sm st-outside-ask" onClick={() => actions.openCommand()}>
        <Icon name="chat" size={12} /> Ask for a change
      </button>
    </div>
  )
}
