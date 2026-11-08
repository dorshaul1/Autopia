import { useEffect, useState } from 'react'
import { Segmented, usePopover } from '../ui'
import { actions, store, useApp } from '../../store'
import { BoardList } from '../decisions/DecisionCenter'
import { Icon, timeAgo } from '../common'


/** What each open item offers as its one direct action (reusing the existing views). */

/**
 * The notification center: what needs you (decisions, results to review, failures, the usage limit),
 * grouped by project and actionable in place, plus recent history with read state. Items close on
 * their own once their cause is resolved; repeats of one condition are a single counted item.
 */
export function AttentionTray() {
  const board = useApp((s) => s.board)
  const notifications = useApp((s) => s.notifications)
  const projects = useApp((s) => s.projects)
  const employees = useApp((s) => s.employees)
  const quiet = useApp((s) => s.settings?.quietMode ?? false)
  const pop = usePopover()
  const { open, setOpen, ref } = pop
  const [tab, setTab] = useState<'needs' | 'recent'>('needs')
  const count = board.length
  const unread = notifications.filter((n) => !n.read).length
  const who = (id: string | null) => (id ? employees.find((e) => e.id === id) : undefined)
  const toggleQuiet = () => actions.run(async () => store.setState({ settings: await window.autopia.updateSettings({ quietMode: !quiet }) }))
  const markAll = () => {
    void window.autopia.markNotificationsRead('all')
    store.setState((s) => ({ notifications: s.notifications.map((x) => ({ ...x, read: true })) }))
  }
  return (
    <div className="attn-wrap" ref={ref}>
      <button className={`btn-bar attn-btn${count ? ' tone-warn' : ''}`} {...pop.triggerProps} aria-label={count ? `${count} need you` : 'Nothing needs you'}>
        <Icon name="inbox" size={13} />
        {count > 0 && <b>{count}</b>}
        {unread > 0 && !count && <span className="attn-unread" aria-label={`${unread} unread`} />}
      </button>
      {open && (
        <div className="popover attn-pop nc-pop" role="dialog" aria-label="Notifications">
          <div className="nc-head">
            <Segmented
              label="Notifications"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'needs', label: `Needs you${count ? ` · ${count}` : ''}` },
                { value: 'recent', label: `Recent${unread ? ` · ${unread > 99 ? '99+' : unread}` : ''}` }
              ]}
            />
            <button className={`btn-bar btn-bar-sm${quiet ? ' tone-ai' : ''}`} onClick={() => void toggleQuiet()} aria-pressed={quiet} data-tip={quiet ? 'Quiet mode is on: no desktop notifications. Everything still collects here.' : 'Quiet mode: pause desktop notifications (in-app items still collect here)'}>
              <Icon name="moon" size={11} /> {quiet ? 'Quiet' : 'Alerts on'}
            </button>
          </div>
          {tab === 'needs' ? (
            !board.length ? (
              <div className="attn-empty">Nothing needs you right now. Decisions, results to review, failures and usage limits show up here, and close by themselves once they’re settled.</div>
            ) : (
              <BoardList items={board} compact />
            )
          ) : (
            <>
              {!notifications.length ? (
                <div className="attn-empty">No notifications yet. Routine progress never notifies you.</div>
              ) : (
                <ul className="nc-recent">
                  {notifications.slice(0, 40).map((n) => (
                    <li key={n.id} className={n.read ? '' : 'unread'}>
                      <button onClick={() => (setOpen(false), void actions.openNotice(n))}>
                        <span className={`nc-dot c-${n.category}`} />
                        <span className="nc-text">
                          <span className="nc-title">
                            {n.title}
                            {n.count > 1 && <span className="faint"> ×{n.count}</span>}
                          </span>
                          <span className="nc-meta">
                            {[n.projectId ? projects[n.projectId]?.name : null, who(n.employeeId)?.name.split(' ')[0], timeAgo(n.updatedAt)].filter(Boolean).join(' · ')}
                            {n.resolvedAt && ['approval', 'question', 'blocked', 'failure', 'usage', 'interrupted', 'review'].includes(n.category) ? ' · resolved' : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {unread > 0 && (
                <div className="attn-foot">
                  <button className="link" onClick={markAll}>
                    Mark all read
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const LIMIT_NAME: Record<string, string> = {
  five_hour: '5-hour session',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly (Opus)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  overage: 'Extra usage'
}
const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  allowed: { label: 'Within limit', tone: 'ok' },
  allowed_warning: { label: 'Near the limit', tone: 'warn' },
  rejected: { label: 'Limit reached', tone: 'bad' }
}
const at = (ms: number) => {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString([], sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Your Claude plan usage, exactly as Claude Code reports it during sessions: which limit, its status
 * and when it resets. Claude Code doesn't report percentages, so none are shown. Plan usage is not a
 * session's context window.
 */
/**
 * Auto mode, like Claude Code's: plans are approved and routine blockers are handled without asking.
 * The boundaries stay: permissions, questions for you, unverified work, usage limits and your own
 * changes always wait for you.
 */
export function AutoMode() {
  const on = useApp((s) => s.settings?.autoApprove ?? false)
  const toggle = () =>
    actions.run(async () => {
      const settings = await window.autopia.updateSettings({ autoApprove: !on })
      store.setState({ settings })
    })
  return (
    <button
      className={`btn-bar${on ? ' tone-ok' : ''}`}
      aria-pressed={on}
      onClick={() => void toggle()}
      data-tip={
        on
          ? 'Auto mode is on: Autopia decides for you: plans start, teammates use their own judgment on questions, work whose checks couldn’t run is accepted (marked unverified), stuck work is retried once and work continues after a usage limit resets. Only Claude Code’s permission prompts from your policy still ask you. Click to turn off.'
          : 'Auto mode: let Autopia decide everything it would ask you (plans, questions, unverified work, retries, continuing after a usage limit). Claude Code’s permission prompts from your policy still ask you.'
      }
    >
      <Icon name={on ? 'play' : 'check'} size={11} /> {on ? 'Auto mode' : 'Ask first'}
    </button>
  )
}

export function UsageMeter() {
  const claude = useApp((s) => s.claude)
  const usage = useApp((s) => s.usage)
  const pop = usePopover()
  const { open, ref } = pop
  useEffect(() => {
    if (usage === null) void window.autopia.usage().then((u) => store.setState({ usage: u }))
  }, [usage])
  const billing = claude?.billing
  if (!claude?.available || !billing) return null
  const now = Date.now()
  const limits = (usage?.limits ?? []).filter((l) => l.resetsAt === null || l.resetsAt > now - 60_000 || l.status !== 'allowed')
  const hold = usage?.hold ?? null
  const worst = limits.some((l) => l.status === 'rejected' && (l.resetsAt ?? Infinity) > now) ? 'bad' : limits.some((l) => l.status === 'allowed_warning') ? 'warn' : 'ok'
  const tone = hold ? 'bad' : billing.warnings.length ? 'warn' : worst
  const plan = billing.plan ? billing.plan[0].toUpperCase() + billing.plan.slice(1) : null
  const modeLabel = billing.mode === 'subscription' ? `${plan ?? 'Claude'} plan` : billing.mode === 'api' ? 'API billing' : billing.mode === 'cloud' ? 'Cloud billing' : 'Claude usage'
  const label = hold ? (hold.until ? `Limit · resets ${at(hold.until)}` : 'Usage limit reached') : worst === 'warn' ? `${modeLabel} · near limit` : modeLabel
  return (
    <div className="attn-wrap usage-wrap" ref={ref}>
      <button className={`btn-bar usage-btn t-${tone}`} {...pop.triggerProps} aria-label="Claude usage">
        <span className={`usage-dot t-${tone}`} />
        {label}
      </button>
      {open && (
        <div className="popover attn-pop usage-pop" role="dialog" aria-label="Claude usage">
          <div className="usage-row head">
            <span>Billing</span>
            <b>
              {billing.mode === 'subscription'
                ? `Claude subscription${plan ? ` (${plan})` : ''}`
                : billing.mode === 'api'
                  ? 'API key (pay-as-you-go)'
                  : billing.mode === 'cloud'
                    ? 'Cloud provider'
                    : 'Unknown'}
            </b>
          </div>
          {billing.warnings.map((w) => (
            <p key={w} className="usage-warn">
              {w}
              {billing.mode === 'api' && ' You can switch this in Settings → “Use my Claude subscription even if an API key is set”.'}
            </p>
          ))}
          {billing.ignored.length > 0 && <p className="usage-note">Leaving {billing.ignored.join(', ')} out of teammates’ sessions (your setting).</p>}
          {hold && (
            <div className="usage-hold">
              <p>
                Work is paused at your usage limit{hold.until ? ` until ${at(hold.until)}` : ''}. Nothing was lost; each paused task continues its own session once.
              </p>
              <button className="btn btn-sm btn-primary" onClick={() => actions.run(() => window.autopia.resumeAfterLimit())} disabled={!!hold.until && hold.until > now} data-tip={hold.until && hold.until > now ? 'Available after the reset time' : 'Continue the paused work'}>
                Continue now
              </button>
            </div>
          )}
          <div className="usage-section">Plan limits (as Claude Code reported them)</div>
          {limits.length ? (
            limits.map((l) => {
              const st = STATUS[l.status] ?? { label: l.status, tone: 'warn' as const }
              return (
                <div key={l.type} className="usage-row">
                  <span>{LIMIT_NAME[l.type] ?? l.type.replace(/_/g, ' ')}</span>
                  <span className={`t-${st.tone}`}>
                    {st.label}
                    {l.utilization !== null ? ` · ${Math.round(l.utilization * 100)}%` : ''}
                    {l.resetsAt ? ` · resets ${at(l.resetsAt)}` : ''}
                  </span>
                </div>
              )
            })
          ) : (
            <p className="usage-note">No usage reported yet. Claude Code reports it during a session.</p>
          )}
          {usage?.extra && (
            <div className="usage-row">
              <span>Extra usage</span>
              <span>{usage.extra.using ? 'In use' : usage.extra.status === 'rejected' || usage.extra.reason ? `Off${usage.extra.reason === 'org_level_disabled' ? ' (disabled by your organization)' : ''}` : (usage.extra.status ?? 'Unknown')}</span>
            </div>
          )}
          {usage?.updatedAt && <p className="usage-note">Last reported {timeAgo(usage.updatedAt)}.</p>}
          <p className="usage-note">
            Claude Code reports status and reset times, not percentages. For exact numbers run <code>/usage</code> in Claude Code, or open your usage page. This is your
            plan’s usage, not a session’s context window.
          </p>
          <div className="row gap">
            <button className="btn btn-sm" onClick={() => void window.autopia.openUsagePage()}>
              Open usage page
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
