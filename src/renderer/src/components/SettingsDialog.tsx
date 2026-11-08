import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loading, Segmented, Switch, confirmAction } from './ui'
import type { CapabilityStatus, PolicyReport, Settings } from '@shared/types'
import { activeProject, actions, store, useApp, type SettingsSection } from '../store'
import { replayFirstRun } from './home/firstRunStage'
import { LIMITS, defaultsForSection, mcpWord, settingsErrors, settingsPatch, sectionAtDefaults, type SettingsGroup } from '@shared/settings'
import { isNewer, NO_CAPABILITIES, type ClaudeCapabilities } from '@shared/claudeCode'
import { friendlyError } from '@shared/friendlyError'
import { Icon, Pill, type Tone } from './common'
import { ConnectClaude } from './home/ConnectClaude'
import { FocusShell, type FocusNavItem } from './shell/FocusShell'
import { Skills } from './Skills'

const SECTIONS: FocusNavItem<SettingsSection>[] = [
  { id: 'claude', label: 'Claude Code', icon: 'terminal' },
  { id: 'skills', label: 'Skills', icon: 'brain' },
  { id: 'permissions', label: 'Permissions', icon: 'shield' },
  { id: 'work', label: 'How the team works', icon: 'users' },
  { id: 'notifications', label: 'Notifications', icon: 'inbox' },
  { id: 'memory', label: 'Memory and history', icon: 'book' }
]

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string }

const TYPING_MS = 350

/**
 * Sends only what really changed, and only says Saved once Autopia confirms it. A value that can't be right stays on screen
 * and isn't sent, and nothing pending is lost when you leave the page.
 */
function useSettings() {
  const settings = useApp((s) => s.settings)
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const latest = useRef({ draft, settings })
  latest.current = { draft, settings }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback(async () => {
    const { draft: d, settings: s } = latest.current
    if (!d || !s) return
    const patch = settingsPatch(d, s)
    if (!Object.keys(patch).length) return
    setState({ kind: 'saving' })
    try {
      const next = await window.autopia.updateSettings(patch)
      store.setState({ settings: next })
      setState({ kind: 'saved' })
    } catch (err) {
      setState({ kind: 'failed', message: friendlyError(String((err as Error).message ?? err)).message })
      // what teammates may do never shows a choice that isn't in force
      setDraft((cur) => (cur ? { ...cur, permissionProfile: s.permissionProfile } : cur))
    }
  }, [])

  // a change from somewhere else (the status bar, the notification center) reaches what you haven't touched
  const seen = useRef(settings)
  useEffect(() => {
    const before = seen.current
    seen.current = settings
    if (!settings) return
    setDraft((d) => {
      if (!d || !before) return settings
      const merged = { ...d }
      for (const k of Object.keys(settings) as (keyof Settings)[]) if (Object.is(d[k], before[k])) (merged as Record<string, unknown>)[k] = settings[k]
      return merged
    })
  }, [settings])

  useEffect(() => {
    if (state.kind !== 'saved') return
    const t = setTimeout(() => setState({ kind: 'idle' }), 1800)
    return () => clearTimeout(t)
  }, [state])

  // leaving before the pause is up still saves it
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      void send()
    },
    [send]
  )

  const apply = (values: Partial<Settings>, wait: number) => {
    const next = latest.current.draft ? { ...latest.current.draft, ...values } : null
    // what gets sent is this, whenever React gets round to drawing it
    latest.current.draft = next
    setDraft(next)
    setState({ kind: 'idle' })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void send(), wait)
  }
  const change = <K extends keyof Settings>(k: K, v: Settings[K], typing = false) => {
    apply({ [k]: v } as Partial<Settings>, typing ? TYPING_MS : 0)
  }
  const replace = (values: Partial<Settings>) => {
    apply(values, 0)
  }
  return { settings, draft, state, change, replace, retry: send }
}

/** Settings grouped by what you came to change. The rest stays out of the way until you ask for it. */
export function SettingsView() {
  const section = useApp((s) => s.settingsSection)
  const { settings, draft, state, change, replace, retry } = useSettings()
  if (!draft || !settings) return <Loading>Loading settings…</Loading>
  const errors = settingsErrors(draft)
  const invalid = Object.keys(errors).length > 0
  const num = (k: keyof typeof LIMITS, label: string, help: string, unit = '') => (
    <div className={`field${errors[k] ? ' has-error' : ''}`}>
      <label className="label" htmlFor={`set-${k}`}>
        {label}
      </label>
      <div className="field-row">
        <input id={`set-${k}`} className="input field-num" type="number" min={LIMITS[k][0]} max={LIMITS[k][1]} value={Number.isFinite(draft[k] as number) ? (draft[k] as number) : ''} onChange={(e) => change(k, e.target.value === '' ? NaN : Number(e.target.value), true)} aria-invalid={!!errors[k]} aria-describedby={`set-${k}-help`} />
        {unit && <span className="muted small">{unit}</span>}
      </div>
      <p id={`set-${k}-help`} className={`small ${errors[k] ? 'bad-text' : 'muted'}`}>
        {errors[k] ?? help}
      </p>
    </div>
  )
  const group: SettingsGroup | null = section === 'work' || section === 'notifications' || section === 'memory' ? section : null

  return (
    <FocusShell items={SECTIONS} active={section} onSelect={(id) => store.setState({ settingsSection: id })}>
      <div className="ws-scroll ws-pad settings">
        {section === 'claude' && <ClaudeSection draft={draft} change={change} />}
        {section === 'skills' && <Skills />}
        {section === 'permissions' && <PermissionsSection draft={draft} change={change} />}
        {section === 'work' && <WorkSection draft={draft} change={change} errors={errors} num={num} />}
        {section === 'notifications' && <NotificationsSection draft={draft} change={change} />}
        {section === 'memory' && <MemorySection num={num} />}
        <div className="save-bar">
          <span className={`small ${invalid || state.kind === 'failed' ? 'bad-text' : 'muted'}`} role="status">
            {state.kind === 'failed' ? `Not saved. ${state.message}` : invalid ? 'Not saved: fix the highlighted value first.' : state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? 'Saved' : 'Changes save as you make them.'}
          </span>
          {state.kind === 'failed' && (
            <button className="btn btn-sm" onClick={() => void retry()}>
              Try again
            </button>
          )}
          {group && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={sectionAtDefaults(group, draft)}
              onClick={async () => {
                if (await confirmAction({ title: 'Restore this page’s defaults?', body: 'Only the choices on this page change. Permissions and your other pages stay as they are.', action: 'Restore defaults' })) replace(defaultsForSection(group))
              }}
            >
              Restore defaults
            </button>
          )}
        </div>
      </div>
    </FocusShell>
  )
}

type Change = <K extends keyof Settings>(k: K, v: Settings[K], typing?: boolean) => void

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="set-fold">
      <summary>{title}</summary>
      <div className="set-fold-body">{children}</div>
    </details>
  )
}

// ── Claude Code ─────────────────────────────────────────────

/** What this Mac's Claude Code really offers, asked of Claude Code itself. Nothing here configures it. */
/** With a product open the tips are in its office; with none, back to Home. */
const isSpaceHome = () => !store.getState().activeProjectId

function ClaudeSection({ draft, change }: { draft: Settings; change: Change }) {
  const claude = useApp((s) => s.claude)
  const projectId = useApp((s) => s.activeProjectId)
  const [caps, setCaps] = useState<ClaudeCapabilities | null>(null)
  const [latest, setLatest] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [copied, setCopied] = useState(false)
  const report = usePolicy()
  const ask = useCallback(
    (fresh: boolean) => {
      setCaps(null)
      void window.autopia.claudeOverview(projectId, fresh).then(setCaps, () => setCaps(NO_CAPABILITIES))
    },
    [projectId]
  )
  useEffect(() => {
    if (!claude?.available) return
    ask(false)
    void window.autopia.claudeLatest().then(setLatest, () => undefined)
  }, [claude?.available, ask])
  const recheck = async () => {
    setChecking(true)
    const info = await actions.run(() => window.autopia.refreshClaude())
    if (info) store.setState({ claude: info })
    ask(true)
    setChecking(false)
  }
  const update = async () => {
    setUpdating(true)
    await actions.run(() => window.autopia.updateClaude())
    await recheck()
    setUpdating(false)
  }
  const details = [`Claude Code: ${claude?.version ?? 'not found'}`, `Where: ${claude?.path ?? 'not found'}`, `Problem: ${claude?.error ?? 'none'}`, `Permission mode: ${report?.mode?.reported ?? report?.mode?.requested ?? 'unknown'}`, `Organization policy: ${report?.managedFile ? 'yes' : 'none found'}`, `MCP servers: ${caps?.mcpServers.map((m) => `${m.name} (${m.status})`).join(', ') || 'none reported'}`].join('\n')
  const models = caps?.models.filter((m) => m.value && m.value !== 'default') ?? []

  return (
    <>
      <h3>Claude Code</h3>
      <p className="muted small">Every task runs through the Claude Code on this Mac, with its own sign-in and your organization’s policy.</p>
      <ConnectClaude />
      <p className="muted small">
        New to the office?{' '}
        <button className="link small" onClick={() => (replayFirstRun(), store.setState({ view: isSpaceHome() ? 'home' : 'office' }))}>
          Show the office tips again
        </button>
      </p>
      {claude?.available && (
        <>
          <dl className="set-facts">
            <div>
              <dt>Models it offers</dt>
              <dd>{!caps ? <span className="faint">Asking Claude Code…</span> : models.length ? models.map((m) => m.label).join(', ') : 'Claude Code didn’t list any.'}</dd>
            </div>
            {claude.allowedModels && (
              <div>
                <dt>Your organization allows</dt>
                <dd>{claude.allowedModels.join(', ')}</dd>
              </div>
            )}
            <div>
              <dt>Commands and agents</dt>
              <dd>{!caps ? <span className="faint">Asking Claude Code…</span> : `${caps.commands.length} commands, ${caps.agents.length} agents. Type / in a message to use them.`}</dd>
            </div>
          </dl>
          {isNewer(latest, caps?.version ?? claude.version ?? null) && (
            <div className="set-note">
              <span className="small">Claude Code {latest} is out. You have {claude.version?.split(' ')[0]}.</span>
              <button className="btn btn-sm" disabled={updating} onClick={() => void update()}>
                {updating ? 'Updating…' : 'Update'}
              </button>
            </div>
          )}

          <h4>MCP servers</h4>
          <McpList caps={caps} managedOnly={!!report?.flags.managedMcpOnly} />
          <p className="small faint">They’re set up in Claude Code, not here. Autopia adds none and shows what Claude Code reports for {projectId ? 'this product' : 'a new session'}.</p>
        </>
      )}

      <h4>Billing</h4>
      <Switch className="check" checked={draft.preferSubscription} onChange={(v) => change('preferSubscription', v)}>
        <span>
          <strong>Use my Claude plan even if an API key is set</strong> Teammates’ sessions then can’t switch to pay-as-you-go by accident. Off: Claude Code decides, as it does in your terminal.
        </span>
      </Switch>

      <Fold title="Troubleshooting">
        <pre className="set-diag">{details}</pre>
        <div className="row gap">
          <button className="btn btn-sm" disabled={checking} onClick={() => void recheck()}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              void navigator.clipboard.writeText(details).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))
            }}
          >
            {copied ? 'Copied' : 'Copy these details'}
          </button>
        </div>
      </Fold>
    </>
  )
}

function McpList({ caps, managedOnly }: { caps: ClaudeCapabilities | null; managedOnly: boolean }) {
  if (!caps) return <p className="small faint">Asking Claude Code…</p>
  return (
    <>
      {managedOnly && <p className="small muted">Your organization only allows the MCP servers it has approved.</p>}
      {caps.mcpServers.length === 0 ? (
        <p className="small muted">Claude Code reports none.</p>
      ) : (
        <ul className="set-mcp">
          {caps.mcpServers.map((m) => {
            const w = mcpWord(m.status)
            return (
              <li key={m.name}>
                <span className={`pulse-dot tone-${w.tone}`} aria-hidden />
                <span className="mono small set-mcp-name">{m.name}</span>
                <span className="small muted">{w.word}</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// ── permissions ─────────────────────────────────────────────

const STATUS: Record<CapabilityStatus, { label: string; tone: Tone }> = {
  allowed: { label: 'Allowed', tone: 'ok' },
  approval: { label: 'Asks you', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'danger' },
  unsupported: { label: 'Not available', tone: 'muted' },
  unknown: { label: 'Not known yet', tone: 'muted' }
}

const GROUP_ORDER: CapabilityStatus[] = ['approval', 'blocked', 'unsupported', 'unknown', 'allowed']

function usePolicy() {
  const claude = useApp((s) => s.claude)
  const [report, setReport] = useState<PolicyReport | null>(null)
  useEffect(() => {
    void actions.run(() => window.autopia.policy()).then((r) => r && setReport(r))
  }, [claude])
  return report
}

/** What Claude Code will really let the team do here, and why. Native prompts and your organization's rules decide; this only shows them. */
function PermissionsSection({ draft, change }: { draft: Settings; change: Change }) {
  const claude = useApp((s) => s.claude)
  const loaded = usePolicy()
  const [probed, setProbed] = useState<PolicyReport | null>(null)
  const [testing, setTesting] = useState(false)
  const report = probed ?? loaded
  const noBypass = !!claude?.restrictions.some((r) => /Full-access mode/.test(r))
  const runTest = async () => {
    setTesting(true)
    const r = await actions.run(() => window.autopia.runPolicyProbe())
    if (r) setProbed(r)
    setTesting(false)
  }
  const pickFull = async () => {
    if (await confirmAction({ title: 'Let teammates do everything without asking?', body: 'They skip Claude Code’s permission prompts inside their working copies. Only for projects you fully trust.', action: 'Allow everything', danger: true })) change('permissionProfile', 'full')
  }
  const mode = report?.mode
  const modeMismatch = mode?.reported && mode.reported !== mode.requested
  return (
    <>
      <h3>Permissions</h3>
      <p className="muted small">When Claude Code needs your OK, Autopia stops and shows you the exact command. Your organization’s rules always win.</p>
      <div className="field">
        <span className="label">What teammates may do without asking</span>
        <div className="radio-group">
          <label className="check">
            <input type="radio" checked={draft.permissionProfile === 'standard'} onChange={() => change('permissionProfile', 'standard')} />
            <span>
              <strong>Edit files in their own copy</strong> Recommended. Every command follows your Claude Code rules: allowed ones run, the rest ask you, denied ones never run.
            </span>
          </label>
          <label className={`check${noBypass ? ' disabled' : ''}`}>
            <input type="radio" disabled={noBypass} checked={draft.permissionProfile === 'full'} onChange={() => void pickFull()} />
            <span>
              <strong>Everything, without asking</strong> {noBypass ? <em className="muted">Your organization turned this off.</em> : 'Only for projects you fully trust.'}
            </span>
          </label>
        </div>
      </div>

      {!report ? (
        <p className="small faint">Reading your Claude Code rules…</p>
      ) : (
        <>
          {GROUP_ORDER.map((status) => {
            const rows = report.capabilities.filter((c) => c.status === status)
            if (!rows.length) return null
            return (
              <section key={status} className="set-perms">
                <h4>
                  <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
                </h4>
                <ul>
                  {rows.map((c) => (
                    <li key={c.id}>
                      <strong>{c.label}</strong>
                      <span className="small muted">{c.detail.replace(/\s*\((?:allowManaged\w+|disableBypass\w+)\)/, '')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {[...new Set(report.capabilities.map((c) => c.remediation).filter(Boolean))].map((fix) => (
            <p key={fix} className="perm-fix">{fix}</p>
          ))}
          <div className="set-note">
            <span className="small muted">
              {report.probe ? `Tested for real ${new Date(report.probe.at).toLocaleString()}${report.probe.error ? `. ${report.probe.error}` : '.'}` : 'This is worked out from your rules. A live test confirms it on this Mac.'}
            </span>
            <button className="btn btn-sm" disabled={testing || !claude?.available} onClick={() => void runTest()} data-tip="One short Claude Code session in a temporary folder tries a few harmless commands. Anything that asks for approval is declined and recorded, not run.">
              {testing ? 'Testing…' : report.probe ? 'Test again' : 'Run a live test'}
            </button>
          </div>
          <Fold title={report.managedFile ? 'Your organization’s rules' : 'Technical details'}>
            <dl className="set-facts">
              <div>
                <dt>Permission mode</dt>
                <dd className={modeMismatch ? 'warn-text' : undefined}>
                  {mode?.reported ?? mode?.requested}
                  {mode?.reported ? (modeMismatch ? ` (Autopia asked for ${mode.requested})` : ', as Claude Code reports it') : ', as requested'}
                </dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{report.managedFile ? 'Managed by your organization' : 'No managed policy found'}</dd>
              </div>
              {report.flags.managedRulesOnly && (
                <div>
                  <dt>Rules</dt>
                  <dd>Only your organization’s rules apply</dd>
                </div>
              )}
            </dl>
            <div className="perm-rules">
              <div>
                <strong className="ok-text">Allow ({report.rules.allow.length})</strong>
                <p className="mono">{report.rules.allow.join('  ') || 'None'}</p>
              </div>
              <div>
                <strong className="bad-text">Deny ({report.rules.deny.length})</strong>
                <p className="mono">{report.rules.deny.join('  ') || 'None'}</p>
              </div>
            </div>
          </Fold>
        </>
      )}
    </>
  )
}

// ── how the team works ──────────────────────────────────────

function WorkSection({ draft, change, errors, num }: { draft: Settings; change: Change; errors: Partial<Record<keyof Settings, string>>; num: (k: keyof typeof LIMITS, label: string, help: string, unit?: string) => ReactNode }) {
  const claude = useApp((s) => s.claude)
  return (
    <>
      <h3>How the team works</h3>
      <p className="muted small">It works well as it is. Change these only if you want it to ask less or run differently.</p>
      <Switch className="check" checked={draft.autoApprove} onChange={(v) => change('autoApprove', v)}>
        <span>
          <strong>Auto mode</strong> Plans start without your OK, teammates use their judgment on questions, and work whose checks couldn’t run is accepted, marked unverified. Claude Code’s permission prompts still come to you.
        </span>
      </Switch>
      <Switch className="check" checked={draft.autoResolve} onChange={(v) => change('autoResolve', v)}>
        <span>
          <strong>Sort out routine hiccups</strong> Continue an interrupted session, or retry once after a missing dependency. Failing checks, permissions and your own changes still come to you.
        </span>
      </Switch>
      <Switch className="check" checked={draft.autoResumeAfterLimit} onChange={(v) => change('autoResumeAfterLimit', v)}>
        <span>
          <strong>Continue after a usage limit resets</strong> Only when Claude Code reported the exact time. Off: you continue with one click.
        </span>
      </Switch>
      <div className="field-grid">{num('maxParallel', 'Teammates working at once', 'More is faster on big plans, and uses your Claude plan faster.')}</div>

      <div className="field">
        <span className="label">Claude model</span>
        <Segmented
          label="Choosing a model"
          value={draft.modelStrategy}
          onChange={(v) => change('modelStrategy', v)}
          options={[
            { value: 'adaptive', label: 'The strongest model (recommended)' },
            { value: 'fixed', label: 'Always the same (choose it)' }
          ]}
        />
        {draft.modelStrategy === 'adaptive' ? (
          <p className="muted small">Planning, building and fixing use the strongest model your plan allows. Quick answers use a lighter one. Choose “Always the same” to pick the model yourself.</p>
        ) : (
          <div className="field-pair">
            <div className={`field${errors.model ? ' has-error' : ''}`}>
              <label className="label" htmlFor="set-model">Model for building</label>
              <input id="set-model" className="input" list="set-models" value={draft.model} placeholder="Claude Code’s default" spellCheck={false} onChange={(e) => change('model', e.target.value, true)} aria-invalid={!!errors.model} />
              {errors.model && <p className="small bad-text">{errors.model}</p>}
            </div>
            <div className={`field${errors.planningModel ? ' has-error' : ''}`}>
              <label className="label" htmlFor="set-plan-model">Model for planning</label>
              <input id="set-plan-model" className="input" list="set-models" value={draft.planningModel} placeholder="Same as building" spellCheck={false} onChange={(e) => change('planningModel', e.target.value, true)} aria-invalid={!!errors.planningModel} />
              {errors.planningModel && <p className="small bad-text">{errors.planningModel}</p>}
            </div>
            <datalist id="set-models">
              {(claude?.allowedModels ?? ['opus', 'sonnet', 'haiku']).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}
      </div>

      <Fold title="Effort and repairs">
        <div className="field">
          <label className="label" htmlFor="set-effort">Effort</label>
          <select id="set-effort" className="select" value={draft.effort} onChange={(e) => change('effort', e.target.value as Settings['effort'])}>
            <option value="auto">Automatic (recommended)</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
            <option value="max">Max</option>
          </select>
          <p className="muted small">How hard Claude Code thinks while building. Higher is slower and uses more of your plan.</p>
        </div>
        <div className="field-grid">{num('maxFixAttempts', 'Automatic repair attempts', 'How many times a teammate may fix a failing check before asking you.')}</div>
      </Fold>
    </>
  )
}

function NotificationsSection({ draft, change }: { draft: Settings; change: Change }) {
  return (
    <>
      <h3>Notifications</h3>
      <p className="muted small">Desktop notifications appear while Autopia is in the background, and are always silent. Everything also collects in the notification center.</p>
      <div className="field">
        <span className="label">Tell me</span>
        <Segmented
          label="Tell me"
          value={draft.desktopNotifications}
          onChange={(v) => change('desktopNotifications', v)}
          options={[
            { value: 'important', label: 'When I’m needed (recommended)' },
            { value: 'all', label: 'Also when work finishes' },
            { value: 'off', label: 'Never' }
          ]}
        />
      </div>
      <Switch className="check" checked={draft.quietMode} onChange={(v) => change('quietMode', v)}>
        <span>
          <strong>Quiet mode, for now</strong> A pause on top of the choice above. It’s also a switch in the notification center.
        </span>
      </Switch>
    </>
  )
}

function MemorySection({ num }: { num: (k: keyof typeof LIMITS, label: string, help: string, unit?: string) => ReactNode }) {
  const project = useApp(activeProject)
  return (
    <>
      <h3>Memory and history</h3>
      <p className="muted small">What the team remembers about each product, and how long detailed logs are kept. Notes you write yourself are never removed automatically.</p>
      <div className="field-grid">
        {num('memoryRetentionDays', 'Forget unused team notes after', 'Notes the team wrote and hasn’t used since are archived, not deleted.', 'days')}
        {num('eventRetentionDays', 'Keep detailed session logs for', 'After this, tool output is dropped. Summaries and results stay.', 'days')}
      </div>
      {project && (
        <button className="link small" onClick={() => actions.goStage('memory')}>
          <Icon name="book" size={11} /> Open {project.name}’s memory
        </button>
      )}
    </>
  )
}
