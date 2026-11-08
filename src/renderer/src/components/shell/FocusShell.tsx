import type { ReactNode } from 'react'
import { type IconName } from '../common'
import { Tabs } from '../ui'

export interface FocusNavItem<T extends string> {
  id: T
  label: string
  icon: IconName
  /** A small live indicator (count or dot) — only real state. */
  badge?: ReactNode
}

/**
 * The one layout under the top bar: an area's sections as a quiet row of tabs, then the content at full
 * width. The top bar is the way around; Esc returns to the office.
 */
export function FocusShell<T extends string>({
  aside,
  items,
  active,
  onSelect,
  children
}: {
  aside?: ReactNode
  items: FocusNavItem<T>[]
  active: T
  onSelect: (id: T) => void
  children: ReactNode
}) {
  return (
    <div className="fv">
      <div className="fv-nav">
        <Tabs
          label="Sections"
          value={active}
          onChange={onSelect}
          tabs={items.map((i) => ({
            value: i.id,
            icon: i.icon,
            label: (
              <>
                {i.label}
                {i.badge}
              </>
            )
          }))}
        />
        {aside && <div className="fv-aside">{aside}</div>}
      </div>
      <section className="fv-main">{children}</section>
    </div>
  )
}
