import { useEffect, useRef, useState } from 'react'
import { masksExitStatus } from '@shared/checks'
import { diagnosticsOf, fixRequest } from '@shared/studio'
import type { PreviewInfo, ProductDeliverable } from '@shared/types'
import { prefillDraft } from '../composer/Composer'
import { actions } from '../../store'
import { Icon, timeAgo } from '../common'
import { Tabs } from '../ui'

/** Starts a request about something that went wrong. It waits in the command bar for you to read and send. */
export function askToFix(projectId: string, problem: string, page: string | null): void {
  prefillDraft(`command:${projectId}`, fixRequest(problem, page))
  actions.openCommand()
}

export function CheckList({ deliverable }: { deliverable: ProductDeliverable }) {
  const checks = deliverable.checks.filter((c) => !masksExitStatus(c.command))
  if (!checks.length) return <p className="muted small">The team hasn’t run any checks for this product yet.</p>
  return (
    <>
    <ul className="rv-checks">
      {checks.map((c) => (
        <li key={c.command}>
          <span className={`rv-dot tone-${c.status === 'passed' ? 'ok' : c.status === 'failed' ? 'danger' : 'warn'}`} />
          <span className="rv-check-name mono">{c.command}</span>
          <span className="rv-check-word">{c.status === 'missing' ? 'not run' : c.status} · {timeAgo(c.at)}</span>
        </li>
      ))}
    </ul>
    <button className="link small" onClick={() => actions.goStage('operations')}>Run them on the code as it is now</button>
    </>
  )
}

/** What the page and its server really said, beside the running product instead of over it. */
export function Diagnostics({ preview, onClose }: { preview: PreviewInfo; onClose: () => void }) {
  const { problems, errors, warnings, output } = diagnosticsOf(preview.logs)
  const [tab, setTab] = useState<'problems' | 'output' | 'checks'>(errors ? 'problems' : 'output')
  const [deliverable, setDeliverable] = useState<ProductDeliverable | null>(null)
  const tail = useRef<HTMLPreElement>(null)
  useEffect(() => {
    void window.autopia.productDeliverable(preview.projectId).then(setDeliverable, () => undefined)
  }, [preview.projectId])
  useEffect(() => {
    if (tail.current) tail.current.scrollTop = tail.current.scrollHeight
  }, [tab, preview.logs.length])
  const count = errors + warnings

  return (
    <section className="st-drawer" aria-label="What it reports">
      <div className="st-drawer-head">
        <Tabs
          label="What it reports"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'problems', label: count ? `Problems (${count})` : 'Problems' },
            { value: 'output', label: 'Server output' },
            { value: 'checks', label: 'Checks' }
          ]}
        />
        <span className="grow" />
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="st-drawer-body">
        {tab === 'problems' &&
          (problems.length ? (
            <ul className="st-problems">
              {problems.map((p) => (
                <li key={`${p.level}:${p.text}`} className={p.level}>
                  <Icon name="alert" size={12} />
                  <span className="st-problem-text mono">
                    {p.text}
                    {p.count > 1 ? <span className="faint"> ×{p.count}</span> : null}
                  </span>
                  {p.level === 'error' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => askToFix(preview.projectId, p.text, preview.page)}>
                      Ask to fix
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nothing reported since it started. That only covers what the page and server print, so it isn’t proof that all is well.</p>
          ))}
        {tab === 'output' && <pre ref={tail} className="st-output">{output.join('\n') || 'No output yet.'}</pre>}
        {tab === 'checks' && (deliverable ? <CheckList deliverable={deliverable} /> : <span className="spinner" />)}
      </div>
    </section>
  )
}
