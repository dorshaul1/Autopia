import { useEffect, useRef, useState } from 'react'
import { TYPE_WORD, type OpsConfig } from '@shared/environment'
import { OP_WORD, failureLines, launchReadiness, opSignature, problemsNow, summaryWords, versionFits, type CheckView, type OpProblem, type OpState, type ReadyState } from '@shared/operations'
import type { Task, ValidationRun } from '@shared/types'
import { activeProject, actions, opsChecks, store, useApp } from '../../store'
import { Icon, duration, timeAgo, useTicker, type IconName } from '../common'
import { rememberOk, okd } from '../studio/Studio'
import { confirmAction } from '../ui'

const UNKNOWN_ICON: IconName = 'help'
const STATE_TONE: Record<OpState, string> = { not_run: 'quiet', running: 'live', passed: 'ready', failed: 'danger', cancelled: 'quiet', unavailable: 'quiet', interrupted: 'attention' }
const READY_ICON: Record<ReadyState, IconName> = { ok: 'check', problem: 'alert', unknown: UNKNOWN_ICON, na: UNKNOWN_ICON }
const REFRESH_MS = 10_000

const list = (words: string[]) => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

/** Whether this project can run, what's running, whether its checks hold for the code as it is now, and what's next. */
export function Operations() {
  const project = useApp(activeProject)!
  const ops = useApp((s) => s.ops)
  const checks = useApp(opsChecks)
  const preview = useApp((s) => s.preview)
  const deliveries = useApp((s) => s.deliveries)
  const intent = useApp((s) => s.opsIntent)
  const [showWhy, setShowWhy] = useState(false)
  const problems = problemsNow({ preview, checks })

  useEffect(() => {
    void actions.refreshOps()
    const t = setInterval(() => void actions.refreshOps(), REFRESH_MS)
    const onFocus = () => void actions.refreshOps()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [project.id])

  const runCheck = async (id: string, command: string, label: string) => {
    const allowed = useOk(command)
    if (!allowed && !(await confirmAction({ title: `Run ${label.toLowerCase()}?`, body: `Autopia will run ${command} in ${project.path}. It’s this project’s own code, on this Mac, with no AI involved.`, action: 'Run it' }))) return
    await actions.run(() => window.autopia.opsRun(project.id, id, true))
  }
  const start = async () => {
    if (!preview) return
    if (preview.kind === 'script' && !okd(project.id, preview.command)) {
      const ok = await confirmAction({ title: 'Run this project’s own code?', body: `Autopia will run ${preview.command} in ${project.path}, on this Mac only. It keeps running until you stop it or quit Autopia.`, action: 'Run it' })
      if (!ok) return
      rememberOk(project.id, preview.command)
    }
    await actions.run(() => window.autopia.previewStart(project.id, preview.kind === 'script'))
  }
  const useOk = (command: string) => !!store.getState().ops?.allowed.includes(command)

  // ⌘K's "Run the tests" lands here, so it asks in one place
  const handled = useRef<unknown>(null)
  useEffect(() => {
    if (!intent || !ops || handled.current === intent) return
    handled.current = intent
    store.setState({ opsIntent: null })
    if (intent.kind === 'start') void start()
    else if (intent.kind === 'stop') void actions.run(() => window.autopia.previewStop(project.id))
    else if (intent.kind === 'restart') void actions.run(() => window.autopia.previewRestart(project.id, true))
    else if (intent.kind === 'all') void runAll()
    else {
      const c = checks.find((x) => x.command.kind === intent.kind)
      if (c && c.state !== 'running' && c.state !== 'unavailable') void runCheck(c.command.id, c.command.command, c.command.label)
    }
  }, [intent, ops])

  const runnable = checks.filter((c) => c.state !== 'running' && c.state !== 'unavailable')
  const runAll = async () => {
    const need = runnable.filter((c) => !useOk(c.command.command))
    if (need.length && !(await confirmAction({ title: `Run ${runnable.length} checks?`, body: `Autopia will run these in ${project.path}, on this Mac, with no AI involved:\n${runnable.map((c) => c.command.command).join('\n')}`, action: 'Run them' }))) return
    // one after another: two builds in one folder can trip over each other
    for (const c of runnable) {
      const v = await actions.run(() => window.autopia.opsRun(project.id, c.command.id, true))
      if (!v) return
      await waitFor(v.id)
    }
  }

  if (!ops) {
    return (
      <div className="ops ops-loading" role="status">
        <span className="spinner" /> Reading the project folder…
      </div>
    )
  }
  const env = ops.environment
  const readiness = launchReadiness({
    env,
    checks,
    dependencies: ops.dependencyProblem,
    depsOk: ops.depsDeclared ? !ops.dependencyProblem : null,
    missingEnv: ops.missingEnv,
    envNames: ops.envNames,
    uncommitted: ops.uncommitted,
    hasGit: ops.hasGit,
    artifacts: ops.artifacts,
    delivery: deliveries[0] ?? null,
    openQuality: ops.openQuality,
    crashed: preview?.status === 'crashed' ? preview.error : null,
    package: ops.package
  })
  const stack = list([...env.frameworks.slice(0, 3), ...env.languages.slice(0, 2)])

  return (
    <div className="ops">
      <header className="ops-head">
        <h2>
          {TYPE_WORD[env.type]}
          {stack ? <span className="ops-stack">, using {stack}</span> : null}
        </h2>
        <p className="muted small">
          {env.because}{' '}
          <button className="link small" aria-expanded={showWhy} onClick={() => setShowWhy(!showWhy)}>
            {showWhy ? 'Hide what Autopia found' : 'What Autopia found'}
          </button>
        </p>
        {showWhy && (
          <dl className="ops-found small">
            {ops.runtimes.map((r) => {
              const fits = versionFits(r.wants, r.version)
              return (
                <div key={r.name}>
                  <dt>{r.name}</dt>
                  <dd className={!r.found || fits === false ? 'warn-text' : ''}>
                    {!r.found ? `Not found on this Mac (${r.from} asks for it)` : `${r.version ?? 'Installed'}${r.wants ? `, and it asks for ${r.wants}` : ''}${fits === false ? ': that doesn’t match' : ''}`}
                  </dd>
                </div>
              )
            })}
            {env.packageManager && (
              <div>
                <dt>Packages</dt>
                <dd>{env.packageManager}</dd>
              </div>
            )}
            {env.docs.length > 0 && (
              <div>
                <dt>Documents</dt>
                <dd>{env.docs.join(', ')}</dd>
              </div>
            )}
          </dl>
        )}
        {env.problems.map((p) => (
          <p key={p} className="small warn-text">{p}</p>
        ))}
        {env.limits.map((l) => (
          <p key={l} className="small muted">{l}</p>
        ))}
      </header>

      {problems.length > 0 && (
        <section className="ops-section" aria-label="What needs attention">
          {problems.map((p) => (
            <Problem key={p.id} problem={p} projectId={project.id} checks={checks} logs={preview?.logs ?? []} fixes={ops.fixes} uncommitted={ops.uncommitted} />
          ))}
        </section>
      )}

      <RunSection onStart={() => void start()} />

      <section className="ops-section" aria-label="Checks">
        <div className="ops-section-head">
          <h3>Checks</h3>
          {runnable.length > 1 && (
            <button className="btn btn-sm" onClick={() => void runAll()}>
              <Icon name="play" size={11} /> Run all
            </button>
          )}
        </div>
        {ops.dependencyProblem && <InstallRow problem={ops.dependencyProblem} onRun={() => env.install && void runCheck('install', env.install.command, 'Install')} command={env.install?.command ?? null} />}
        {checks.length === 0 ? (
          <p className="muted small">Autopia found no build, test or type-check command in this project. If it has one, add it under Your commands, below.</p>
        ) : (
          <ul className="ops-checks">
            {checks.map((c) => (
              <CheckRow key={c.command.id} view={c} denied={ops.denied.includes(c.command.command)} missing={ops.missing.includes(c.command.command.split(' ')[0])} onRun={() => void runCheck(c.command.id, c.command.command, c.command.label)} />
            ))}
          </ul>
        )}
      </section>

      <section className="ops-section" aria-label="Launch readiness">
        <div className="ops-section-head">
          <h3>Ready to launch?</h3>
        </div>
        <p className={`ops-verdict ops-verdict-${readiness.verdict}`}>{readiness.headline}</p>
        <ul className="ops-ready">
          {readiness.items.map((i) => (
            <li key={i.id} className={`ops-ready-${i.state}`}>
              <Icon name={READY_ICON[i.state]} size={12} />
              <span className="ops-ready-label">{i.label}</span>
              <span className="muted small">{i.detail}</span>
            </li>
          ))}
        </ul>
        <p className="small faint">Autopia never publishes or deploys anything. How and where this goes live stays with you.</p>
      </section>

      <YourCommands />
    </div>
  )
}

const waitFor = (id: string) =>
  new Promise<void>((resolve) => {
    const un = store.subscribe((s) => {
      const v = s.validations.find((x) => x.id === id)
      if (!v || v.status !== 'running') {
        un()
        resolve()
      }
    })
  })

function RunSection({ onStart }: { onStart: () => void }) {
  const project = useApp(activeProject)!
  const preview = useApp((s) => s.preview)
  const ops = useApp((s) => s.ops)!
  const [showLog, setShowLog] = useState(false)
  const log = useRef<HTMLPreElement>(null)
  useTicker(preview?.status === 'running')
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [showLog, preview?.logs.length])
  if (!preview) return null
  const options = ops.environment.run
  const page = preview.kind !== 'none' && preview.expects !== 'process'
  const missing = preview.command ? ops.missing.includes(preview.command.split(' ')[0]) : false
  const blocked = !!preview.command && preview.command.split(' && ').some((c) => ops.denied.includes(c))
  const live = preview.status === 'running' || preview.status === 'starting'
  if (preview.kind === 'none') {
    const type = ops.environment.type
    const elsewhere = ops.environment.limits.length > 0 || preview.limits.length > 0
    return (
      <section className="ops-section" aria-label="Run">
        <div className="ops-section-head">
          <h3>Run</h3>
        </div>
        {!elsewhere && <p className="muted small">{type === 'library' ? 'A library doesn’t run by itself. Its checks, below, are what show it works.' : 'Autopia found no command that runs this. If you know it, add it under Your commands, below.'}</p>}
        {preview.launch.length > 0 && (
          <div className="row gap wrap">
            <button className="btn btn-sm" onClick={() => actions.goStage('preview')}>
              <Icon name="reveal" size={11} /> Open it outside Autopia
            </button>
          </div>
        )}
      </section>
    )
  }
  const word = { running: page ? 'Running' : 'Running, with no page to show', starting: 'Starting', stopping: 'Stopping', stopped: 'Not running', crashed: 'Stopped by itself', unavailable: 'Not available' }[preview.status]
  const tone = preview.status === 'crashed' ? 'danger' : live || preview.status === 'stopping' ? 'live' : 'quiet'
  return (
    <section className="ops-section" aria-label="Run">
      <div className="ops-section-head">
        <h3>Run</h3>
      </div>
      <div className="ops-run" role="group" aria-label={`The app: ${word}`}>
        <span className={`pulse-dot tone-${tone}`} aria-hidden />
        <div className="ops-run-text">
          <strong>{word}</strong>
          <span className="small muted">
            {preview.status === 'running' && preview.url ? `${preview.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}
            {preview.status === 'running' && preview.startedAt ? `${preview.url ? ' · ' : ''}up ${duration(preview.startedAt, null)}` : ''}
            {preview.status === 'stopped' && preview.finished ? preview.finished : ''}
            {preview.status === 'stopped' && !preview.finished && preview.error ? preview.error : ''}
          </span>
          {preview.command ? <code className="small ops-command">{preview.command}</code> : <span className="small faint">Plain pages, served read-only by Autopia. None of the project’s code runs.</span>}
        </div>
        <div className="ops-run-actions">
          {preview.status === 'running' && page && (
            <button className="btn btn-sm" onClick={() => actions.goStage('preview')}>
              <Icon name="eye" size={11} /> Open preview
            </button>
          )}
          {live && (
            <button className="btn btn-sm" onClick={() => void actions.run(() => window.autopia.previewRestart(project.id, true))}>
              <Icon name="retry" size={11} /> Restart
            </button>
          )}
          {live && (
            <button className="btn btn-sm" onClick={() => void actions.run(() => window.autopia.previewStop(project.id))}>
              <Icon name="stop" size={11} /> Stop
            </button>
          )}
          {!live && preview.status !== 'stopping' && (
            <button className="btn btn-sm btn-primary" disabled={missing || blocked} onClick={onStart} data-tip={missing ? `${preview.command!.split(' ')[0]} isn’t on this Mac` : blocked ? 'Your organization’s policy denies this' : undefined}>
              <Icon name="play" size={11} /> {preview.status === 'crashed' ? 'Start again' : 'Start'}
            </button>
          )}
        </div>
      </div>
      {missing && <p className="small warn-text">{preview.command!.split(' ')[0]} isn’t on this Mac, or Autopia can’t find it, so this can’t run yet.</p>}
      {preview.reason && <p className="small warn-text">{preview.reason}</p>}
      {options.length > 1 && !live && (
        <label className="ops-choose small">
          <span className="muted">Run with</span>
          <select className="select select-ghost" aria-label="Which command runs it" value={preview.command?.split(' && ').pop() ?? ''} onChange={(e) => void actions.saveOpsConfig({ ...ops.config, run: e.target.value, expects: options.find((o) => o.command === e.target.value)?.expects })}>
            {options.map((o) => (
              <option key={o.command} value={o.command}>
                {o.label} ({o.command})
              </option>
            ))}
          </select>
        </label>
      )}
      {preview.logs.length > 0 && (
        <>
          <button className="link small" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
            {showLog ? 'Hide its output' : 'Show its output'}
          </button>
          {showLog && <pre ref={log} className="ops-output" tabIndex={0}>{preview.logs.join('\n')}</pre>}
        </>
      )}
    </section>
  )
}

function InstallRow({ problem, command, onRun }: { problem: string; command: string | null; onRun: () => void }) {
  const running = useApp((s) => s.validations.some((v) => v.status === 'running' && v.command === command))
  return (
    <div className="ops-install">
      <Icon name="alert" size={12} />
      <span className="small">{problem}</span>
      {command && (
        <button className="btn btn-sm" disabled={running} onClick={onRun}>
          {running ? 'Installing…' : `Run ${command}`}
        </button>
      )}
    </div>
  )
}

function CheckRow({ view, denied, missing, onRun }: { view: CheckView; denied: boolean; missing: boolean; onRun: () => void }) {
  const { command, state, run, check, stale, summary } = view
  const [open, setOpen] = useState(false)
  const history = useApp((s) => s.validations.filter((v) => v.trigger === 'ops' && v.command === command.command && v.status !== 'running').slice(0, 5))
  useTicker(state === 'running')
  const output = state === 'running' ? (run?.live ?? '') : (check?.output ?? '')
  const tail = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (tail.current) tail.current.scrollTop = tail.current.scrollHeight
  }, [output, open])
  const when = run?.endedAt ?? run?.startedAt
  const elsewhere = run?.trigger === 'task'
  const line = denied
    ? 'Your organization’s policy doesn’t allow this.'
    : missing
      ? `${command.command.split(' ')[0]} isn’t on this Mac.`
      : state === 'running'
        ? `Running for ${duration(run!.startedAt, null)}`
        : view.verifiedBy
          ? `When result #${view.verifiedBy} was run for real, on this same code.`
          : state === 'not_run'
          ? `From ${command.from}.`
          : `${summary ? `${summaryWords(summary, command.command)} · ` : ''}${when ? timeAgo(when) : ''}${check?.ms ? ` · took ${(check.ms / 1000).toFixed(1)}s` : ''}`
  const word = denied || missing ? OP_WORD.unavailable : stale && elsewhere ? `${OP_WORD[state]} in the team’s copy` : OP_WORD[state]
  return (
    <li className={`ops-check${open ? ' open' : ''}`}>
      <div className="ops-check-row">
        <span className={`pulse-dot tone-${denied || missing ? 'quiet' : stale ? 'quiet' : STATE_TONE[state]}`} aria-hidden />
        <div className="ops-check-text">
          <strong>{command.label}</strong>
          <span className="small muted">
            {word}
            {stale ? (elsewhere ? '. Not run here on this code' : ', on older code') : ''}
          </span>
          <span className="small faint">{line}</span>
        </div>
        <code className="small ops-command">{command.command}</code>
        <div className="ops-run-actions">
          {output && (
            <button className="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide output' : 'Output'}
            </button>
          )}
          {state === 'running' ? (
            <button className="btn btn-sm" onClick={() => void actions.run(() => window.autopia.opsCancel(run!.id))}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-sm" disabled={denied || missing} onClick={onRun}>
              {state === 'not_run' ? 'Run' : 'Run again'}
            </button>
          )}
        </div>
      </div>
      {run?.error && <p className="small warn-text ops-check-note">{run.error}</p>}
      {open && output && <pre ref={tail} className="ops-output" tabIndex={0}>{output}</pre>}
      {open && history.length > 1 && (
        <ul className="ops-history small">
          {history.map((v) => (
            <HistoryRow key={v.id} run={v} />
          ))}
        </ul>
      )}
    </li>
  )
}

function HistoryRow({ run }: { run: ValidationRun }) {
  const word = run.status === 'passed' ? 'Passed' : run.status === 'failed' ? 'Failed' : run.status === 'cancelled' ? 'Cancelled' : 'Interrupted'
  const first = run.status === 'failed' ? failureLines(run.checks[0]?.output ?? '', 1)[0] : null
  return (
    <li>
      <span className={run.status === 'failed' ? 'bad-text' : 'muted'}>{word}</span> <span className="faint">{timeAgo(run.endedAt ?? run.startedAt)}</span>
      {first ? <span className="faint mono"> {first.slice(0, 90)}</span> : null}
    </li>
  )
}

const OPEN_TASK: Task['status'][] = ['pending', 'running', 'merging', 'proposed', 'interrupted']

function Problem({ problem, projectId, checks, logs, fixes, uncommitted }: { problem: OpProblem; projectId: string; checks: CheckView[]; logs: string[]; fixes: Record<string, string>; uncommitted: number | null }) {
  const tasks = useApp((s) => s.tasks)
  const [busy, setBusy] = useState(false)
  const view = checks.find((c) => c.command.id === problem.id)
  const signature = problem.source === 'process' ? opSignature(problem.command ?? 'run', logs.slice(-40).join('\n')) : opSignature(problem.command ?? '', view?.check?.output ?? '')
  const task = fixes[signature] ? tasks[fixes[signature]] : undefined
  const on = task && OPEN_TASK.includes(task.status)
  const ask = async () => {
    setBusy(true)
    await actions.run(() => window.autopia.opsFix(projectId, problem.source === 'process' ? { source: 'process' } : { source: 'check', validationId: view!.run!.id }))
    await actions.refreshOps()
    setBusy(false)
  }
  return (
    <article className="ops-problem">
      <Icon name="alert" size={14} />
      <div className="ops-problem-text">
        <strong>{problem.what}</strong>
        <p className="small mono">{problem.said}</p>
        {problem.lines.length > 1 && <pre className="ops-lines small">{problem.lines.slice(1, 6).join('\n')}</pre>}
        {task && !on && (
          <p className="small muted">
            <button className="link small" onClick={() => actions.openSheet({ kind: 'task', id: task.id })}>{task.key}</button>
            {task.status === 'done' ? ' finished, and it still fails the same way.' : ' stopped before fixing this.'}
          </p>
        )}
        {!on && !problem.outside && !!uncommitted && <p className="small warn-text">The team starts from the last commit. Your {uncommitted} uncommitted file{uncommitted === 1 ? ' isn’t' : 's aren’t'} in their copy, so they may not see this failure.</p>}
      </div>
      {problem.outside ? null : on ? (
        <button className="btn btn-sm" onClick={() => actions.openSheet({ kind: 'task', id: task!.id })}>
          {task!.key} is on it
        </button>
      ) : (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void ask()}>
          {task ? 'Ask again' : 'Ask the team to fix it'}
        </button>
      )}
    </article>
  )
}

const FIELDS: { key: Exclude<keyof OpsConfig, 'expects'>; label: string; placeholder: string }[] = [
  { key: 'run', label: 'Run', placeholder: 'For example: python3 server.py --port $PORT' },
  { key: 'build', label: 'Build', placeholder: 'For example: make release' },
  { key: 'test', label: 'Tests', placeholder: 'For example: ./run-tests.sh' },
  { key: 'typecheck', label: 'Types', placeholder: 'For example: mypy src' },
  { key: 'lint', label: 'Lint', placeholder: 'For example: ruff check .' }
]

/** When what Autopia worked out isn't right. It's kept in .autopia, so the project's own files stay as they are. */
function YourCommands() {
  const ops = useApp((s) => s.ops)!
  const projectId = useApp((s) => s.activeProjectId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<OpsConfig>(ops.config ?? {})
  useEffect(() => setDraft(ops.config ?? {}), [projectId])
  const dirty = JSON.stringify(draft) !== JSON.stringify(ops.config ?? {})
  return (
    <section className="ops-section ops-yours">
      <button className="link small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide your commands' : ops.config ? 'Your commands' : 'Autopia got a command wrong, or missed one'}
      </button>
      {open && (
        <form
          className="ops-form"
          onSubmit={(e) => {
            e.preventDefault()
            void actions.saveOpsConfig(draft)
          }}
        >
          <p className="small muted">Saved in this project’s .autopia folder, which never reaches git. The project’s own files stay as they are. Autopia still shows you each command before it runs for the first time.</p>
          {FIELDS.map((f) => (
            <label key={f.key} className="ops-field small">
              <span>{f.label}</span>
              <input className="input mono" value={draft[f.key] ?? ''} placeholder={f.placeholder} spellCheck={false} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value || undefined })} />
            </label>
          ))}
          <label className="ops-field small">
            <span>When it runs</span>
            <select className="select" value={draft.expects ?? 'process'} onChange={(e) => setDraft({ ...draft, expects: e.target.value as OpsConfig['expects'] })}>
              <option value="port">It serves a page ($PORT is a free port)</option>
              <option value="process">It just keeps running, with no page</option>
            </select>
          </label>
          <div className="row gap">
            <button className="btn btn-sm btn-primary" type="submit" disabled={!dirty}>
              Save
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
