// Is this Mac ready to build? One answer, from what was actually checked, for Home, the Creator and Settings.
// Finding Claude Code doesn't prove you're signed in, so "couldn't tell" is its own answer, and never reads as connected.

import type { ClaudeInfo } from './types'

export type ReadinessState = 'checking' | 'missing' | 'outdated' | 'broken' | 'signedOut' | 'unconfirmed' | 'ready'

export interface Readiness {
  state: ReadinessState
  /** A request can be started. "Couldn't tell" doesn't block: if it really isn't signed in, the first request says so. */
  canStart: boolean
  title: string
  body: string
  /** A command worth running in a terminal, shown ready to copy. */
  command: string | null
  /** The original message, for anyone who wants it. Never the headline. */
  detail: string | null
}

export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'
export const UPDATE_COMMAND = 'claude update'

export function readinessOf(claude: ClaudeInfo | null): Readiness {
  if (!claude || (!claude.available && claude.error === null)) {
    return { state: 'checking', canStart: false, title: 'Looking for Claude Code…', body: '', command: null, detail: null }
  }
  if (!claude.available) {
    const detail = claude.error
    if (!claude.path) {
      return {
        state: 'missing',
        canStart: false,
        title: 'One thing first: Claude Code',
        body: 'Your team works through Claude Code, Anthropic’s official tool. Install it, run claude once to sign in, and come back. This page will notice. It takes a couple of minutes, and Autopia never installs anything for you.',
        command: INSTALL_COMMAND,
        detail
      }
    }
    if (/lacks /.test(detail ?? '')) {
      return { state: 'outdated', canStart: false, title: 'Claude Code needs an update', body: `You have version ${claude.version?.split(' ')[0] ?? 'unknown'}, which is missing something your team depends on. Update it in a terminal, and this page will notice.`, command: UPDATE_COMMAND, detail }
    }
    return { state: 'broken', canStart: false, title: 'Claude Code is installed, but won’t start', body: 'Autopia found it and couldn’t run it. Reinstalling usually fixes this. Then this page will notice.', command: INSTALL_COMMAND, detail }
  }
  const account = claude.account
  if (account?.loggedIn === false) {
    return { state: 'signedOut', canStart: false, title: 'Connect your Claude account', body: 'Your team works on your own Claude plan or API account, with its usage limits. Sign-in is Claude Code’s own, in your browser. Autopia never sees your password.', command: null, detail: null }
  }
  if (!account) {
    return { state: 'unconfirmed', canStart: true, title: 'Claude Code is here, but couldn’t confirm you’re signed in', body: '', command: null, detail: null }
  }
  return { state: 'ready', canStart: true, title: 'Claude Code is ready', body: '', command: null, detail: null }
}

/** Who gets the first-run touches: only someone who started with no products. An existing user never has this set. */
export type FirstRunStage = 'new' | 'done' | null
export const FIRST_RUN_KEY = 'autopia:first-run'

export function firstRunOnLaunch(stored: string | null, projectCount: number): FirstRunStage {
  if (stored === 'new' || stored === 'done') return stored
  return projectCount === 0 ? 'new' : null
}
