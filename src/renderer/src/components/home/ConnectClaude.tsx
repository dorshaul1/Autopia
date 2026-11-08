import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '@shared/friendlyError'
import { readinessOf } from '@shared/readiness'
import { store, useApp } from '../../store'
import { Icon } from '../common'

/** A command to run in a terminal, one click from the clipboard. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="connect-cmd">
      <code>{command}</code>
      <button
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * Whose Claude this is, before anything runs on it. It only ever reads what Claude Code says, and sign-in is Claude Code's
 * own. Anything missing takes the front of the page with what to do about it; once connected it's a quiet line you can check.
 */
export function ConnectClaude() {
  const claude = useApp((s) => s.claude)
  const ready = readinessOf(claude)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [still, setStill] = useState(false)
  const needed = !ready.canStart && ready.state !== 'checking'
  const checkingRef = useRef(false)

  const check = async (quiet = false) => {
    if (checkingRef.current) return
    checkingRef.current = true
    if (!quiet) {
      setChecking(true)
      setStill(false)
    }
    try {
      const c = await window.autopia.refreshClaude()
      store.setState({ claude: c })
      if (!quiet) setStill(!readinessOf(c).canStart)
    } catch (err) {
      if (!quiet) setError(friendlyError(String((err as Error).message ?? err)).message)
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }
  // you went off to a terminal to set it up: coming back is enough
  useEffect(() => {
    if (!needed || busy) return
    const onFocus = () => void check(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [needed, busy]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancelled = useRef(false)
  const connect = async () => {
    cancelled.current = false
    setBusy(true)
    setError(null)
    try {
      const c = await window.autopia.connectClaude()
      store.setState({ claude: c })
      // walking away isn't a failure, so nothing is said about it
      if (c.account?.loggedIn === false && !cancelled.current) setError('Sign-in didn’t finish. Try again, or run claude in a terminal and sign in there.')
    } catch (err) {
      setError(friendlyError(String((err as Error).message ?? err)).message)
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => {
    cancelled.current = true
    void window.autopia.cancelConnectClaude()
  }

  if (ready.state === 'checking')
    return (
      <div className="connect-line connect-checking" role="status">
        <span className="spinner spinner-sm" aria-hidden />
        <span>{ready.title}</span>
      </div>
    )
  if (needed)
    return (
      <section className="connect connect-needed" aria-label={ready.title}>
        <b>{ready.title}</b>
        <p>{ready.body}</p>
        {ready.command && <CopyCommand command={ready.command} />}
        {still && !checking && <p className="small warn-text">Not yet. If you’ve just finished, open a new terminal, run claude once, then check again.</p>}
        {error && (
          <p className="bad-text small" role="alert">
            {error}
          </p>
        )}
        {ready.state === 'signedOut' ? (
          <div className="row gap">
            <button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Waiting for your browser…' : 'Connect Claude'}
            </button>
            {busy && (
              <button className="btn" onClick={cancel}>
                Cancel
              </button>
            )}
            {!busy && (
              <button className="btn" disabled={checking} onClick={() => void check()}>
                {checking ? 'Checking…' : 'I’ve signed in'}
              </button>
            )}
          </div>
        ) : (
          <div className="row gap">
            <button className="btn btn-primary" disabled={checking} onClick={() => void check()}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
            <button className="btn" onClick={() => void window.autopia.openClaudeInstall()}>
              Open the install guide
            </button>
          </div>
        )}
        {ready.detail && (
          <details className="connect-detail">
            <summary>Technical details</summary>
            <code>{ready.detail}</code>
          </details>
        )}
      </section>
    )
  const plan = claude!.account?.plan
  return (
    <div className="connect-line">
      <Icon name={ready.state === 'ready' ? 'check' : 'alert'} size={11} />
      <span>
        {ready.state === 'ready' ? (
          <>
            Claude Code {claude!.version?.split(' ')[0]}
            {claude!.account?.email && ` · ${claude!.account.email}`}
            {plan && ` · ${plan[0].toUpperCase()}${plan.slice(1)}`}
          </>
        ) : (
          `${ready.title}. You can still start; if it isn’t, your first request will say so.`
        )}
      </span>
      {ready.state === 'unconfirmed' && (
        <button className="link small" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      )}
      <button className="link small" disabled={busy} onClick={() => void connect()}>
        {busy ? 'Waiting for your browser…' : ready.state === 'ready' ? 'Use another account' : 'Sign in'}
      </button>
      {busy && (
        <button className="link small" onClick={cancel}>
          Cancel
        </button>
      )}
      {error && <span className="bad-text">{error}</span>}
    </div>
  )
}
