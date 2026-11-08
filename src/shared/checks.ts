import type { CheckResult, CheckStatus } from './types'

export const ERROR_LINE = /\b\w*Error\b|\berror\b|\bfail(ed|ure)?\b|✖|✗|×|cannot find|not found|exception|traceback|panic|assert/i
export const NOISE = /^\s*(at\s|npm (ERR!|error) (code|path|command|A complete log|$)|node_modules\/|>\s|ℹ\s|#\s|✖ failing tests)|Test Files |^\s*$/

/**
 * Long output cut down to what a repair needs. Test runners print the failures first and a summary last, so keeping
 * only the end hands over "3 failed" without saying which, and whoever repairs it has to run everything again to find out.
 */
export function keepFailures(output: string, max = 3000): string {
  if (output.length <= max) return output
  const lines = output.split('\n')
  const end = output.slice(-Math.floor(max / 4))
  const picked = new Set<number>()
  lines.forEach((l, i) => {
    if (!NOISE.test(l) && ERROR_LINE.test(l)) for (let j = i; j < Math.min(i + 5, lines.length); j++) picked.add(j)
  })
  if (!picked.size) return output.slice(-max)
  const kept: string[] = []
  let used = end.length
  let last = -2
  for (const i of [...picked].sort((a, b) => a - b)) {
    const line = lines[i].slice(0, 240)
    if (used + line.length + 2 > max) break
    if (i !== last + 1 && kept.length) kept.push('…')
    kept.push(line)
    used += line.length + 2
    last = i
  }
  return `${kept.join('\n')}\n…\n${end}`
}

/** One Bash call an agent made through Claude Code, with the CLI-reported outcome. */
export interface BashEvidence {
  command: string
  isError: boolean
  output: string
  ms: number
  at: number
  /** The founder declined this call in Autopia. */
  founderDenied: boolean
  /** Claude Code listed this call in permission_denials. */
  policyDenied: boolean
}

const POLICY_DENIAL = /^Permission to use \S+ with command .* has been denied\.?$|requires approval|blocked by (?:your )?(?:organization|policy)/im

const norm = (c: string) => c.replace(/\s+/g, ' ').trim().replace(/\s+2>&1$/, '')

/** Splits a command on top-level `&&`, leaving quoted text alone. */
function andChain(command: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '&' && command[i + 1] === '&') {
      parts.push(cur)
      cur = ''
      i++
      continue
    }
    cur += c
  }
  return [...parts, cur].map(norm)
}

/** `;`, `||` or a background `&` anywhere at top level means the call's exit status may not be the chain's. */
const LOOSE_CHAIN = /;|\|\||(^|[^&>])&(?![&>])/

/**
 * How a Bash call `ran` relates to the required check:
 * - 'status': `ran` is the check (optionally after `cd dir &&`-style prefixes or with `2>&1`), so the
 *   call's exit status is the check's.
 * - 'passOnly': the check is an earlier step of an `a && b && c` chain. If the chain exited 0, every step
 *   did; if it failed, which step failed is unknown.
 * Pipes, `;` and `|| true` hide a failure, so they never count as evidence.
 */
export function checkMatch(required: string, ran: string): 'status' | 'passOnly' | null {
  const want = norm(required)
  const parts = andChain(norm(ran))
  const at = parts.lastIndexOf(want)
  if (at === parts.length - 1) return 'status'
  if (at < 0 || LOOSE_CHAIN.test(norm(ran).replace(/'[^']*'|"[^"]*"/g, ''))) return null
  return 'passOnly'
}

/** True when `ran` is evidence for `required` whatever its outcome (see checkMatch). */
export function runsCheck(required: string, ran: string): boolean {
  return checkMatch(required, ran) === 'status'
}

export function evidenceStatus(e: BashEvidence): CheckStatus {
  if (e.founderDenied) return 'denied'
  if (e.policyDenied || (e.isError && POLICY_DENIAL.test(e.output.trim()))) return 'blocked'
  return e.isError ? 'failed' : 'passed'
}

const VERIFY = /\b(test|tests|build|lint|check|typecheck|tsc|pytest|jest|vitest|mocha|cargo|go test|make|node --test)\b/

/**
 * Verification commands the agent tried that were declined or blocked and never later passed. They
 * become required checks, so refusing one can never let the work count as verified by omission.
 * Founder declines always count; policy blocks count when the command looks like verification
 * (agents also probe things like `git log` that say nothing about the work).
 */
export function refusedChecks(evidence: BashEvidence[]): string[] {
  const out = new Set<string>()
  for (const e of evidence) {
    const s = evidenceStatus(e)
    // starting a server isn't pass or fail, so refusing it can't leave a check undone
    if (isLongRunning(e.command)) continue
    if (s === 'denied' || (s === 'blocked' && VERIFY.test(e.command))) out.add(norm(e.command))
    if (s === 'passed') out.delete(norm(e.command))
  }
  return [...out]
}

/**
 * The latest attempt at each required command decides its status; no attempt means "missing". A passing
 * `a && b` chain proves each step passed. A failing chain proves nothing about its earlier steps, so the
 * check counts as not run (never as an older, possibly stale pass).
 */
export function evaluateChecks(required: string[], evidence: BashEvidence[]): CheckResult[] {
  return required.map((command) => {
    let hit: BashEvidence | undefined
    for (let i = evidence.length - 1; i >= 0 && !hit; i--) {
      const m = checkMatch(command, evidence[i].command)
      if (m === 'passOnly' && evidenceStatus(evidence[i]) === 'failed') break
      if (m) hit = evidence[i]
    }
    if (!hit) return { command, status: 'missing', ok: false, ms: 0, output: 'The agent did not run this command.', at: Date.now() }
    const status = evidenceStatus(hit)
    return { command, status, ok: status === 'passed', ms: hit.ms, output: keepFailures(hit.output), at: hit.at }
  })
}

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  passed: 'passed',
  failed: 'failed',
  blocked: 'blocked by policy',
  denied: 'declined by you',
  missing: 'not run'
}

/** Older records predate `status`. */
export function checkStatus(c: Pick<CheckResult, 'ok'> & { status?: CheckStatus }): CheckStatus {
  return c.status ?? (c.ok ? 'passed' : 'failed')
}

/** `cd x && npm test 2>&1` and `npm run test` are one check. */
export function checkKey(command: string): string {
  return command.trim().replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, '').replace(/\s*2>&1\s*$/, '').replace(/^(npm|pnpm|yarn|bun)\s+(test|t)\b/, '$1 run test').replace(/\s+/g, ' ')
}

/** A command for reading, not running: no `cd worktree &&`, first line only, cut to size. An agent's script can be pages long. */
export function shortCommand(command: string, max = 80): string {
  const line = command.trim().replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, '').split('\n')[0].replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * One-off shell checks an agent invents: they read a file or run a throwaway script. Every one stops to ask
 * you for permission, and a pass proves nothing the real run doesn't. Plans don't get to require them.
 */
export function isThrowawayCheck(command: string): boolean {
  const c = command.trim().replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, '')
  return /^(grep|egrep|fgrep|rg|cat|ls|head|tail|wc|stat|file|find|test|tidy|for|while|echo|sed|awk|\[)(\s|$)/.test(c) || /(^|\s)(node (-e|--eval|--check)|python3? (-c|-\s)|npx (-y |--yes )?(html-validate|htmlhint|tidy|http-server|serve))(\s|$)|<<-?\s*['"]?\w|<\(/.test(c)
}

/** Servers and watchers never exit, so they can never be a pass/fail check. */
export function isLongRunning(command: string): boolean {
  const c = norm(command)
    .replace(/^cd \S+ && /, '')
    .replace(/^([A-Z_][A-Z0-9_]*=\S+\s+)+/, '')
    .replace(/^timeout\s+\S+\s+/, '')
  return /^(npm (start|run (dev|serve|start|preview|watch))|yarn (start|dev|serve)|pnpm (start|dev|serve)|npx (vite|serve|http-server|live-server|nodemon|next (dev|start))|nodemon\b|node (\S*\/)?(server|index|app|main)\.m?js$|python3? -m http\.server|flask run|uvicorn\b)/.test(c) || /--watch\b/.test(c)
}

const SETUP = /^(npm (install|i|ci)|yarn( install)?|pnpm (install|i)|pip3? install|python3? -m pip install|open)(\s|$)/

/**
 * Turns the checks an agent says it ran into commands Autopia can match: compound `a && b` claims
 * become their parts, and notes, servers and prose are dropped (they are not pass/fail commands).
 */
export function normalizeClaims(claimed: string[]): string[] {
  const out: string[] = []
  for (const raw of claimed) {
    const c = norm(raw)
    if (!c || c.length > 240 || /\n/.test(raw)) continue
    // "cmd (background; confirmed …)" or "cmd — note": keep only real commands
    if (/\s\((?:[^()]*\s){3,}[^()]*\)/.test(c) || /\s[—–]\s/.test(c)) continue
    // `a; echo $?`, `a || true` and pipes report the last command's status, so they can never fail: not evidence
    if (masksExitStatus(c)) continue
    // installing dependencies or opening a file is setup, not a pass/fail check of the work
    if (SETUP.test(c)) continue
    const parts = c.split(' && ').map((p) => p.trim()).filter(Boolean)
    for (const p of parts.length > 1 && !parts[0].startsWith('cd ') ? parts : [c]) if (!isLongRunning(p)) out.push(p)
  }
  return [...new Set(out)]
}

/** `a; echo $?`, `a || true` and pipes report the last command's status, so they can never fail. */
export function masksExitStatus(command: string): boolean {
  return /;|\|\||(^|\s)\|(\s|$)/.test(command.replace(/'[^']*'|"[^"]*"/g, ''))
}

/** The command under any pipe, so `npm test | grep x` and `npm test` count as the same check. */
export function baseCheck(command: string): string {
  return checkKey(command.split(/\s\|\s/)[0])
}

/** A check someone couldn't run stops mattering once the same command really ran here and passed. */
export function withoutSettled<T extends { command: string; status: CheckStatus }>(checks: T[]): T[] {
  const passed = new Set(checks.filter((c) => c.status === 'passed').map((c) => baseCheck(c.command)))
  return checks.filter((c) => !((c.status === 'denied' || c.status === 'blocked' || c.status === 'missing') && passed.has(baseCheck(c.command))))
}
