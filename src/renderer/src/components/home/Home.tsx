import { useEffect, useMemo, useState } from 'react'
import { companyLine, greeting, productPulse } from '@shared/productPulse'
import { HUB_LABEL, hubGroups, type HubItem } from '@shared/projectHome'
import type { PortfolioItem } from '@shared/types'
import { actions, attentionItems, useApp } from '../../store'
import { ACTIVITY_TONE, Avatar, Icon, timeAgo } from '../common'
import { BoardList } from '../decisions/DecisionCenter'
import { ProductMenu } from '../shell/ProductMenu'
import { usePopover } from '../ui'
import { ConnectClaude } from './ConnectClaude'
import { Creator } from './Creator'
import { Welcome } from './FirstRun'
import { ProductImage } from './ProductImage'

type Row = HubItem & { item: PortfolioItem }

/** Where the day starts: every product, sorted by what it needs from you, and one place to begin something new. */
export function Home() {
  const board = useApp((st) => st.board)
  const projects = useApp((s) => s.projects)
  const waiting = useApp(attentionItems).length
  const toReview = useApp((s) => new Set(s.indicators.filter((x) => x.kind === 'review').map((x) => x.deliveryId)).size)
  const working = useApp((s) => Object.values(s.statuses).filter((x) => x.runId && x.activity !== 'idle' && x.activity !== 'waiting').length)
  const count = Object.keys(projects).length
  return (
    <div className="home">
      <div className="home-page">
        {count ? (
          <header className="home-hero">
            <h1>{`${greeting(new Date().getHours())}.`}</h1>
            <p>{companyLine({ products: count, needsYou: waiting, toReview, working })}</p>
          </header>
        ) : (
          <Welcome />
        )}
        <ConnectClaude />
        <Creator first={!count} />
        {waiting > 0 && (
          <section className="home-section">
            <h2>Waiting for your answer</h2>
            <BoardList items={board.filter((i) => i.type === 'decision')} />
          </section>
        )}
        {count > 0 && <Hub />}
      </div>
    </div>
  )
}

function Hub() {
  const [items, setItems] = useState<PortfolioItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [showOlder, setShowOlder] = useState(false)
  const projects = useApp((s) => s.projects)
  const statuses = useApp((s) => s.statuses)
  const tasks = useApp((s) => s.tasks)
  const indicators = useApp((s) => s.indicators)
  const load = () =>
    window.autopia.portfolio().then(
      (list) => (setItems(list), setFailed(false)),
      () => setFailed(true)
    )
  // Event-driven: refreshed when any project, task or teammate changes.
  useEffect(() => {
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [projects, statuses, tasks])
  const rows = useMemo<Row[]>(
    () =>
      (items ?? []).map((item) => ({
        item,
        id: item.project.id,
        name: projects[item.project.id]?.name ?? item.project.name,
        purpose: item.purpose,
        needsYou: item.pendingDecisions,
        working: item.activeEmployees.length,
        toReview: new Set(indicators.filter((x) => x.projectId === item.project.id && x.kind === 'review').map((x) => x.deliveryId)).size,
        blocked: item.blocked > 0 || item.project.phase === 'failed',
        at: item.lastActivity
      })),
    [items, indicators, projects]
  )
  const groups = hubGroups(rows, Date.now(), query)
  if (failed && !items)
    return (
      <section className="home-section">
        <p className="muted">Your products couldn't be loaded just now.</p>
        <button className="btn btn-sm" onClick={() => void load()}>
          Try again
        </button>
      </section>
    )
  if (!items)
    return (
      <section className="home-section" aria-busy>
        {Object.keys(projects).slice(0, 4).map((id) => (
          <div key={id} className="hub-row hub-loading" aria-hidden />
        ))}
      </section>
    )
  return (
    <>
      {rows.length > 6 && (
        <div className="hub-search">
          <Icon name="search" size={13} />
          <input aria-label="Find a product" placeholder="Find a product" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {!groups.length && <p className="muted home-section">Nothing matches “{query}”.</p>}
      {groups.map(({ group, items: list }) => {
        const folded = group === 'older' && !showOlder && !query
        return (
          <section key={group} className="home-section">
            <h2>{HUB_LABEL[group]}</h2>
            {folded ? (
              <button className="link small" onClick={() => setShowOlder(true)}>
                Show {list.length} {list.length === 1 ? 'product' : 'products'}
              </button>
            ) : (
              <ul className="hub-list">
                {list.map((r) => (
                  <HubRow key={r.id} row={r} statuses={statuses} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}

function HubRow({ row, statuses }: { row: Row; statuses: ReturnType<typeof useApp<Record<string, import('@shared/types').EmployeeStatus>>> }) {
  const everyone = useApp((s) => s.allEmployees)
  const p = useApp((s) => s.projects[row.id]) ?? row.item.project
  const pop = usePopover()
  const pulse = productPulse({ phase: p.phase, paused: p.paused, needsYou: row.needsYou, working: row.working, toReview: row.toReview })
  const last = row.item.latest
  return (
    <li className="hub-row" ref={pop.ref as unknown as React.Ref<HTMLLIElement>} onContextMenu={(e) => (e.preventDefault(), pop.setOpen(true))}>
      <button className="hub-open" onClick={() => void actions.goToProduct(row.id, true)}>
        <span className="hub-thumb">
          <ProductImage project={p} stamp={last?.at} />
          <span className={`pulse-dot tone-${pulse.tone}`} aria-hidden />
        </span>
        <span className="hub-text">
          <span className="hub-name">{row.name}</span>
          {row.purpose && <span className="hub-purpose">{row.purpose}</span>}
          <span className="hub-meta">
            <span className={`hub-state tone-${pulse.tone}`}>{pulse.label}</span>
            {last && (
              <span>
                {' '}
                · Result #{last.number} {timeAgo(last.at)}
              </span>
            )}
            {!last && row.at > 0 && <span> · {timeAgo(row.at)}</span>}
          </span>
        </span>
      </button>
      <span className="hub-team">
        {row.item.activeEmployees.slice(0, 3).map((id) => {
          const e = everyone.find((x) => x.id === id)
          return e ? <Avatar key={id} employee={e} size={20} ring={ACTIVITY_TONE[statuses[id]?.activity ?? 'idle']} /> : null
        })}
      </span>
      <button className="icon-btn icon-btn-sm hub-more" {...pop.triggerProps} aria-label={`More for ${row.name}`}>
        <Icon name="more" size={13} />
      </button>
      <ProductMenu project={p} pop={pop} />
    </li>
  )
}
