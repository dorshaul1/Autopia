// Autopia's shared UI primitives. Every control in the app is one of these (or uses their class
// names, documented in docs/DESIGN_SYSTEM.md): one look, one set of states, one keyboard behavior.
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from '../common'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ── Button ────────────────────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Shows a spinner and blocks clicks while an action runs. */
  loading?: boolean
  block?: boolean
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, loading, block, active, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', variant !== 'secondary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', active && 'active', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner spinner-sm" aria-hidden /> : icon && <Icon name={icon} size={size === 'lg' ? 15 : 13} />}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Required: names the action for screen readers and the tooltip. */
  label: string
  /** Tooltip text when it should say more than the label. */
  tip?: string
  size?: 'sm' | 'md'
  active?: boolean
  danger?: boolean
  iconSize?: number
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, tip, size = 'md', active, danger, iconSize, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx('icon-btn', size === 'sm' && 'icon-btn-sm', active && 'active', danger && 'danger', className)} aria-label={label} data-tip={tip ?? label} {...rest}>
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 12 : 14)} />
    </button>
  )
})

// ── Badge, Chip, Callout, Card ────────────────────────────────────────────────────────────────

export type Tone = 'muted' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'

/** A count. */
export function Badge({ tone, children, label }: { tone?: 'ok' | 'warn' | 'accent'; children: ReactNode; label?: string }) {
  return (
    <span className={cx('badge', tone && `badge-${tone}`)} aria-label={label}>
      {children}
    </span>
  )
}

/** A tag: a skill, a trait, a file. */
export function Chip({ tone, caps, children, className, tip }: { tone?: Exclude<Tone, 'muted'>; caps?: boolean; children: ReactNode; className?: string; tip?: string }) {
  return (
    <span className={cx('chip', tone && `chip-${tone}`, caps && 'chip-caps', className)} data-tip={tip}>
      {children}
    </span>
  )
}

export function Callout({ tone = 'info', children, className }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode; className?: string }) {
  return (
    <div className={cx('callout', `callout-${tone}`, className)} role={tone === 'danger' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

export function Card({ title, actions, children, className, onClick }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section className={cx('card', onClick && 'card-interactive', className)} onClick={onClick}>
      {(title || actions) && (
        <header className="card-head">
          {title && <div className="card-title">{title}</div>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md'; label?: string }) {
  return <span className={cx('spinner', size === 'sm' && 'spinner-sm')} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

/** Nothing here yet, or something went wrong: what it is and, if there is one, what to do. */
export function EmptyState({ icon, title, body, action, tone, className }: { icon?: IconName; title: ReactNode; body?: ReactNode; action?: ReactNode; tone?: 'danger'; className?: string }) {
  return (
    <div className={cx('empty-state', tone && `empty-state-${tone}`, className)} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && (
        <span className="empty-state-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="empty-state-title">{title}</div>
      {body && <div className="empty-state-body">{body}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

/** The shape of what's coming, so nothing jumps when it arrives. Says nothing about progress. */
export function Skeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ width: `${88 - ((i * 23) % 40)}%` }} />
      ))}
    </div>
  )
}

/** Keeps something on screen a moment after it should go, so it can leave instead of vanishing. */
export function useLinger(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(on)
  useEffect(() => {
    if (on) return setShown(true)
    const t = setTimeout(() => setShown(false), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on || shown
}

/** Waiting for data. */
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <div className="loading" role="status">
      <span className="spinner spinner-sm" aria-hidden />
      {children}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>
}

// ── Form controls ─────────────────────────────────────────────────────────────────────────────

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { size?: 'sm' | 'md'; invalid?: boolean }>(function Input({ className, size, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx('input', size === 'sm' && 'input-sm', className)} aria-invalid={invalid || undefined} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('select', className)} {...rest}>
      {children}
    </select>
  )
})

/** A label, its control, and a hint or an error under it (linked for screen readers). */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: (ids: { id: string; describedBy?: string }) => ReactNode; className?: string }) {
  const id = useId()
  const note = error || hint ? `${id}-note` : undefined
  return (
    <div className={cx('field', error && 'has-error', className)}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: note })}
      {error ? (
        <p className="field-error" id={note}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={note}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** On/off. A real switch: role, state, Space/Enter, visible focus. */
export function Switch({ checked, onChange, label, children, disabled, tip, className, ariaLabel }: { ariaLabel?: string; checked: boolean; onChange: (next: boolean) => void; label?: ReactNode; children?: ReactNode; disabled?: boolean; tip?: string; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} className={cx('switch', className)} disabled={disabled} data-tip={tip} onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden />
      <span className="switch-label">{children ?? label}</span>
    </button>
  )
}

// ── Choice groups: Segmented and Tabs (roving focus, arrow keys) ──────────────────────────────

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  icon?: IconName
  tip?: string
  disabled?: boolean
}

/** Moves focus and selection with the arrow keys, Home and End, like native radio groups. */
function useRoving<T extends string>(options: Choice<T>[], value: T, onChange: (v: T) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? enabled[(i + 1) % enabled.length] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? enabled[(i - 1 + enabled.length) % enabled.length] : e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1] : null
    if (!next) return
    e.preventDefault()
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus())
  }
  return { ref, onKeyDown }
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'sm', iconOnly, className }: { value: T; options: Choice<T>[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; iconOnly?: boolean; className?: string }) {
  const roving = useRoving(options, value, onChange)
  return (
    <div ref={roving.ref} className={cx('segmented', size === 'sm' && 'segmented-sm', iconOnly && 'segmented-icon', className)} role="radiogroup" aria-label={label} onKeyDown={roving.onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          data-tip={o.tip}
          aria-label={iconOnly && typeof o.label === 'string' ? o.label : undefined}
          className={o.value === value ? 'active' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={12} />}
          {!iconOnly && o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange, label, className }: { value: T; tabs: Choice<T>[]; onChange: (v: T) => void; label: string; className?: string }) {
  const roving = useRoving(tabs, value, onChange)
  return (
    <div ref={roving.ref} className={cx('tabs', className)} role="tablist" aria-label={label} onKeyDown={roving.onKeyDown}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" data-value={t.value} aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} className={cx('tab', t.value === value && 'active')} disabled={t.disabled} data-tip={t.tip} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Overlays: Dialog, Popover, Menu, Toast ────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog: Escape and the backdrop close it (when dismissable), focus moves in and stays in
 * (Tab cycles), and returns to whatever opened it.
 */
export function Dialog({ onClose, title, description, children, actions, wide, dismissable = true, className, labelledBy }: { onClose: () => void; title?: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; wide?: boolean; dismissable?: boolean; className?: string; labelledBy?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // read while rendering: a child's autoFocus has already moved focus by the time effects run
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    const el = box.current
    // focus the first field, else the dialog itself (never a destructive button by default)
    const first = el?.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
    ;(first ?? el)?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
    if (!items.length) return
    const [first, last] = [items[0], items[items.length - 1]]
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()} onKeyDown={onKeyDown}>
      <div ref={box} className={cx('modal', wide && 'modal-wide', className)} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? titleId : undefined)} tabIndex={-1}>
        {title && <h2 id={titleId}>{title}</h2>}
        {description && <p className="muted">{description}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

interface ConfirmRequest {
  title: string
  body?: ReactNode
  action: string
  danger?: boolean
  resolve: (ok: boolean) => void
}
const confirmListeners = new Set<(r: ConfirmRequest | null) => void>()

/** Asks before something that can't be taken back. Resolves true only on the explicit action. */
export function confirmAction(r: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => confirmListeners.forEach((l) => l({ ...r, resolve })))
}

/** Mounted once, at the root of the app. */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  useEffect(() => {
    confirmListeners.add(setReq)
    return () => void confirmListeners.delete(setReq)
  }, [])
  if (!req) return null
  const done = (ok: boolean) => (req.resolve(ok), setReq(null))
  return (
    <Dialog
      onClose={() => done(false)}
      title={req.title}
      description={req.body}
      actions={
        <>
          <Button variant="ghost" onClick={() => done(false)}>
            Cancel
          </Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
            {req.action}
          </Button>
        </>
      }
    />
  )
}

/**
 * Open/close state for a popover anchored to a trigger: closes on an outside click or Escape
 * (returning focus to the trigger), and wires aria-expanded on the trigger.
 */
/**
 * Anything floating closes when you click elsewhere, press Escape, or move to another window (which is also
 * what a click in the native preview looks like from here). `keep` names clicks that decide for themselves.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void, keep?: (target: Element) => boolean): void {
  const latest = useRef({ close, keep })
  latest.current = { close, keep }
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || latest.current.keep?.(t)) return
      latest.current.close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      latest.current.close()
      ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
    }
    const onBlur = () => latest.current.close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [active, ref])
}

export function usePopover<T extends HTMLElement = HTMLDivElement>(): { open: boolean; setOpen: (o: boolean) => void; toggle: () => void; ref: RefObject<T>; triggerProps: { 'aria-expanded': boolean; 'aria-haspopup': true; onClick: () => void } } {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)
  useDismiss(ref, open, () => setOpen(false))
  const toggle = useCallback(() => setOpen((o) => !o), [])
  return { open, setOpen, toggle, ref, triggerProps: { 'aria-expanded': open, 'aria-haspopup': true, onClick: toggle } }
}

/** Arrow keys, Home and End move between a menu's items. Spread onto the menu element. */
export function menuKeys(e: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), .menu-item:not(:disabled)')]
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items[next].focus()
}

export function Toast({ tone = 'info', children, onClose, className }: { tone?: 'info' | 'error' | 'attn' | 'result'; children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className={cx('toast', tone !== 'info' && `toast-${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
      {onClose && <IconButton icon="close" label="Dismiss" size="sm" onClick={onClose} />}
    </div>
  )
}
