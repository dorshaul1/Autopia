import { useEffect, useState } from 'react'
import { productPulse } from '@shared/productPulse'
import type { Project } from '@shared/types'
import { actions, attentionItems, store, useApp } from '../../store'
import { Icon } from '../common'
import { ProductImage } from '../home/ProductImage'
import { ProductMenu } from './ProductMenu'
import { usePopover } from '../ui'

const NARROW = '(max-width: 1279px)'

/** Below this width the labels give way to the work; the status dots stay. */
function useCollapsed(): boolean {
  const pref = useApp((s) => s.railCollapsed)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const q = window.matchMedia(NARROW)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return pref || narrow
}

/** Every product you own and what it's doing, always in view. Everything else in the company is one step from here. */
export function Rail() {
  const view = useApp((s) => s.view)
  const projects = useApp((s) => s.projects)
  const waiting = useApp(attentionItems).length
  const collapsed = useCollapsed()
  const list = Object.values(projects).sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt)
  return (
    <nav className={`rail${collapsed ? ' collapsed' : ''}`} aria-label="Your studio">
      <div className="rail-drag" />
      <div className="rail-top">
        <button className={`rail-link${view === 'home' ? ' active' : ''}`} aria-current={view === 'home' ? 'page' : undefined} data-tip={collapsed ? 'Home (⌘0)' : undefined} onClick={() => store.setState({ view: 'home' })}>
          <Icon name="overview" size={15} />
          <span className="rail-label">Home</span>
          {waiting > 0 && <span className="rail-count" aria-label={`${waiting} need you`}>{waiting}</span>}
        </button>
        <button className="icon-btn rail-toggle" aria-pressed={collapsed} aria-label={collapsed ? 'Show labels' : 'Hide labels'} data-tip={collapsed ? 'Show labels (⌘B)' : 'Hide labels (⌘B)'} onClick={() => actions.setRail(!store.getState().railCollapsed)}>
          <Icon name="panel" size={15} />
        </button>
      </div>
      <div className="rail-head">
        <span className="rail-label">Products</span>
        <button className="icon-btn icon-btn-sm" aria-label="New product" data-tip="New product (⌘N)" onClick={() => actions.startNew()}>
          <Icon name="plus" size={12} />
        </button>
      </div>
      <div
        className="rail-products"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.rail-product-open')]
          const at = rows.indexOf(document.activeElement as HTMLElement)
          if (at < 0) return
          e.preventDefault()
          rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus()
        }}
      >
        {list.map((p) => (
          <ProductRow key={p.id} project={p} collapsed={collapsed} />
        ))}
        {!list.length && <p className="rail-empty rail-label">Your products will appear here.</p>}
      </div>
      <div className="rail-foot">
        <button className={`rail-link${view === 'settings' ? ' active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} data-tip={collapsed ? 'Settings (⌘,)' : undefined} onClick={() => store.setState({ view: 'settings' })}>
          <Icon name="gear" size={15} />
          <span className="rail-label">Settings</span>
        </button>
      </div>
    </nav>
  )
}

function ProductRow({ project: p, collapsed }: { project: Project; collapsed: boolean }) {
  const active = useApp((s) => s.activeProjectId === p.id && ['office', 'result', 'workspace'].includes(s.view))
  // counted from real session state and what's really waiting, across every project
  const working = useApp((s) => Object.values(s.statuses).filter((x) => x.projectId === p.id && x.runId && x.activity !== 'idle' && x.activity !== 'waiting').length)
  const needsYou = useApp((s) => attentionItems(s).filter((a) => a.projectId === p.id).length)
  const toReview = useApp((s) => new Set(s.indicators.filter((x) => x.projectId === p.id && x.kind === 'review').map((x) => x.deliveryId)).size)
  const pulse = productPulse({ phase: p.phase, paused: p.paused, needsYou, working, toReview })
  const pop = usePopover()
  const { open, setOpen, ref, triggerProps } = pop
  void open
  return (
    <div className={`rail-product${active ? ' active' : ''}`} ref={ref} onContextMenu={(e) => (e.preventDefault(), setOpen(true))}>
      <button className="rail-product-open" aria-current={active ? 'page' : undefined} aria-label={`${p.name}: ${pulse.label}`} data-tip={collapsed ? `${p.name} · ${pulse.label}` : undefined} onClick={() => actions.goToProduct(p.id)}>
        <span className="rail-thumb">
          <ProductImage project={p} stamp={p.phase} />
          <span className={`pulse-dot tone-${pulse.tone}`} aria-hidden />
        </span>
        <span className="rail-text rail-label">
          <span className="rail-name">{p.name}</span>
          <span className={`rail-state tone-${pulse.tone}`}>{pulse.label}</span>
        </span>
      </button>
      {!collapsed && (
        <button className="icon-btn icon-btn-sm rail-more" {...triggerProps} aria-label={`More for ${p.name}`}>
          <Icon name="more" size={12} />
        </button>
      )}
      <ProductMenu project={p} pop={pop} />
    </div>
  )
}
