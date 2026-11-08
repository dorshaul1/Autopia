// Claude Code's own usage-limit signals and billing mode, read from official CLI outputs only:
// `rate_limit_event` messages in the stream-json output (status, which limit, reset time, extra usage)
// and `claude auth status`. Nothing is scraped, estimated or invented: when Claude Code doesn't report
// a number, there is no number. Pure functions; the orchestrator keeps the state.

export interface LimitState {
  /** Which limit, as Claude Code names it (e.g. five_hour, seven_day, seven_day_opus). */
  type: string
  /** allowed | allowed_warning | rejected (as reported). */
  status: string
  /** When this window resets (ms), if reported. */
  resetsAt: number | null
  /** 0…1 if (and only if) Claude Code reported it. */
  utilization: number | null
  seenAt: number
}

export interface UsageState {
  limits: Record<string, LimitState>
  /** Extra (pay-as-you-go) usage beyond the plan, as reported: on, off and why. */
  extra: { status: string | null; reason: string | null; using: boolean } | null
  updatedAt: number | null
  /** Work is held because a real usage limit was reached. */
  hold: { type: string | null; until: number | null; since: number } | null
}

export const EMPTY_USAGE: UsageState = { limits: {}, extra: null, updatedAt: null, hold: null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Epoch seconds or ms → ms. */
const toMs = (v: number | null) => (v === null ? null : v < 1e12 ? v * 1000 : v)

/** Fold one `rate_limit_info` from the stream into the state. */
export function applyRateLimit(state: UsageState, info: Record<string, unknown>, now: number): UsageState {
  const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : 'unknown'
  const status = typeof info.status === 'string' ? info.status : 'unknown'
  const util = num(info.utilization)
  const limits = { ...state.limits, [type]: { type, status, resetsAt: toMs(num(info.resetsAt)), utilization: util !== null && util >= 0 && util <= 1 ? util : null, seenAt: now } }
  const extra =
    'overageStatus' in info || 'isUsingOverage' in info
      ? { status: typeof info.overageStatus === 'string' ? info.overageStatus : null, reason: typeof info.overageDisabledReason === 'string' ? info.overageDisabledReason : null, using: info.isUsingOverage === true }
      : state.extra
  return { ...state, limits, extra, updatedAt: now }
}

/** A limit that blocks work right now (reported as rejected, and not yet past its reset). */
export function activeLimit(state: UsageState, now: number): LimitState | null {
  const hit = Object.values(state.limits).filter((l) => l.status === 'rejected' && (l.resetsAt === null || l.resetsAt > now))
  return hit.sort((a, b) => (b.resetsAt ?? Infinity) - (a.resetsAt ?? Infinity))[0] ?? null
}

/** Claude Code's usage-limit messages (subscription or API). */
export function isUsageLimitError(text: string): boolean {
  return /usage limit (reached|exceeded)|limit reached\|\d{9,}|you('ve| have) (hit|reached) your (usage )?limit|out of (extra )?usage|rate[_ ]limit(ed|_error| exceeded)|\b429\b|too many requests/i.test(text)
}

/** The reset time when the error carries one ("…limit reached|1793638800"). */
export function resetFromError(text: string): number | null {
  const m = /\|(\d{9,13})\b/.exec(text)
  return m ? toMs(Number(m[1])) : null
}

// ── billing mode ───────────────────────────────────────────────

/** Environment variables that change who Claude Code bills (only their names are ever looked at). */
export const BILLING_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'] as const

export function billingVarsIn(env: Record<string, string | undefined>): string[] {
  return BILLING_VARS.filter((k) => typeof env[k] === 'string' && env[k]!.trim() !== '')
}

export type BillingMode = 'subscription' | 'api' | 'cloud' | 'unknown'

export interface Billing {
  mode: BillingMode
  /** Plan name from `claude auth status` (e.g. pro, max), for subscriptions. */
  plan: string | null
  /** Plain warnings about unexpected charges. */
  warnings: string[]
  /** Variables Autopia is set to leave out of agents' environment (your explicit choice in Settings). */
  ignored: string[]
}

/**
 * Who pays for agents' Claude Code sessions, from the CLI's own account status, the environment it
 * runs in and (when seen) the session's reported key source. An API key in the environment would
 * normally take precedence over a subscription login: that's the pay-as-you-go surprise to warn about.
 */
export function billingFor(
  account: { loggedIn: boolean; method: string | null; plan: string | null } | null | undefined,
  vars: string[],
  apiKeySource: string | null,
  ignoreApiKeys: boolean
): Billing {
  const keyVars = vars.filter((v) => v === 'ANTHROPIC_API_KEY' || v === 'ANTHROPIC_AUTH_TOKEN')
  const cloud = vars.find((v) => v.startsWith('CLAUDE_CODE_USE_'))
  const ignored = ignoreApiKeys ? keyVars : []
  const activeKeys = keyVars.filter((v) => !ignored.includes(v))
  const subscription = !!account?.loggedIn && /claude\.ai|oauth|subscription/i.test(account.method ?? '')
  const warnings: string[] = []
  if (cloud) return { mode: 'cloud', plan: null, warnings: [`${cloud} is set: Claude Code bills your cloud provider, not a Claude plan.`], ignored }
  if (activeKeys.length) {
    if (subscription) warnings.push(`${activeKeys.join(' and ')} ${activeKeys.length > 1 ? 'are' : 'is'} set: Claude Code will bill that API key (pay-as-you-go) instead of your ${account?.plan ? `${account.plan} ` : ''}subscription.`)
    return { mode: 'api', plan: null, warnings, ignored }
  }
  if (apiKeySource && /api[_ ]?key|apiKeyHelper|ANTHROPIC/i.test(apiKeySource) && !/none/i.test(apiKeySource)) return { mode: 'api', plan: null, warnings, ignored }
  if (subscription) return { mode: 'subscription', plan: account?.plan ?? null, warnings, ignored }
  if (account?.loggedIn) return { mode: 'api', plan: null, warnings, ignored }
  return { mode: 'unknown', plan: null, warnings: account === null ? [] : ['Claude Code is not signed in. Run `claude auth login` in a terminal.'], ignored }
}

/** Leave API-key variables out of an agent's environment (only when you chose that in Settings). */
export function withoutApiKeys(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env }
  delete out.ANTHROPIC_API_KEY
  delete out.ANTHROPIC_AUTH_TOKEN
  return out
}
