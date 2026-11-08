import { describe, expect, it } from 'vitest'
import { EMPTY_USAGE, activeLimit, applyRateLimit, billingFor, billingVarsIn, isUsageLimitError, resetFromError, withoutApiKeys } from '../src/main/claude/usage'
import { parseStreamLine } from '../src/main/claude/streamParser'
import { diagnose } from '../src/main/director/blockers'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

// a real rate_limit_event's info, as Claude Code 2.1 sent it
const real = { status: 'allowed', resetsAt: 1793638800, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false }

describe('usage limits come only from what Claude Code reports', () => {
  it('folds a real rate_limit_event without inventing a percentage', () => {
    const s = applyRateLimit(EMPTY_USAGE, real, 1000)
    expect(s.limits.five_hour).toEqual({ type: 'five_hour', status: 'allowed', resetsAt: 1793638800_000, utilization: null, seenAt: 1000 })
    expect(s.extra).toEqual({ status: 'rejected', reason: 'org_level_disabled', using: false })
    expect(s.updatedAt).toBe(1000)
  })

  it('keeps a reported utilization only when it is a real fraction', () => {
    expect(applyRateLimit(EMPTY_USAGE, { ...real, utilization: 0.42 }, 0).limits.five_hour.utilization).toBe(0.42)
    expect(applyRateLimit(EMPTY_USAGE, { ...real, utilization: 7 }, 0).limits.five_hour.utilization).toBeNull()
  })

  it('a rejected limit blocks work until its reset passes', () => {
    const s = applyRateLimit(EMPTY_USAGE, { ...real, status: 'rejected', rateLimitType: 'seven_day' }, 0)
    expect(activeLimit(s, 1793638800_000 - 1)?.type).toBe('seven_day')
    expect(activeLimit(s, 1793638800_000 + 1)).toBeNull()
    expect(activeLimit(applyRateLimit(EMPTY_USAGE, real, 0), 0)).toBeNull()
  })

  it('recognises Claude Code usage-limit errors and their reset time', () => {
    expect(isUsageLimitError('Claude AI usage limit reached|1793638800')).toBe(true)
    expect(isUsageLimitError("You've hit your limit · resets 5pm")).toBe(true)
    expect(isUsageLimitError('API Error: 429 rate_limit_error')).toBe(true)
    expect(isUsageLimitError('TypeError: cannot read properties of undefined')).toBe(false)
    expect(resetFromError('Claude AI usage limit reached|1793638800')).toBe(1793638800_000)
    expect(resetFromError("You've hit your limit")).toBeNull()
  })

  it('the stream parser surfaces rate_limit_event', () => {
    const evs = parseStreamLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: real }), '/tmp')
    expect(evs.some((e) => e.kind === 'rateLimit')).toBe(true)
  })
})

describe('billing mode', () => {
  const sub = { loggedIn: true, method: 'claude.ai', plan: 'max' }

  it('a claude.ai login with no API key is the subscription', () => {
    expect(billingFor(sub, [], null, false)).toEqual({ mode: 'subscription', plan: 'max', warnings: [], ignored: [] })
  })

  it('an API key in the environment wins over the subscription, with a warning', () => {
    const b = billingFor(sub, ['ANTHROPIC_API_KEY'], null, false)
    expect(b.mode).toBe('api')
    expect(b.warnings[0]).toMatch(/ANTHROPIC_API_KEY is set.*pay-as-you-go.*max subscription/)
  })

  it('leaving API keys out (your choice) keeps the subscription', () => {
    expect(billingFor(sub, ['ANTHROPIC_API_KEY'], null, true)).toMatchObject({ mode: 'subscription', ignored: ['ANTHROPIC_API_KEY'] })
    expect(withoutApiKeys({ ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', PATH: '/bin' })).toEqual({ PATH: '/bin' })
  })

  it('cloud providers and signed-out states are named honestly', () => {
    expect(billingFor(sub, ['CLAUDE_CODE_USE_BEDROCK'], null, false).mode).toBe('cloud')
    expect(billingFor({ loggedIn: false, method: null, plan: null }, [], null, false)).toMatchObject({ mode: 'unknown' })
    expect(billingFor(null, [], null, false)).toEqual({ mode: 'unknown', plan: null, warnings: [], ignored: [] })
  })

  it('only looks at variable names, and ignores empty ones', () => {
    expect(billingVarsIn({ ANTHROPIC_API_KEY: ' ', CLAUDE_CODE_USE_VERTEX: '1', OTHER: 'x' })).toEqual(['CLAUDE_CODE_USE_VERTEX'])
  })
})

describe('no budgets, and no automatic paid or limit workarounds', () => {
  it('settings carry no budget and both new choices default off', () => {
    expect('maxBudgetUsdPerRun' in DEFAULT_SETTINGS).toBe(false)
    expect(DEFAULT_SETTINGS.preferSubscription).toBe(false)
    expect(DEFAULT_SETTINGS.autoResumeAfterLimit).toBe(false)
    // auto mode is opt-in, like Claude Code's
    expect(DEFAULT_SETTINGS.autoApprove).toBe(false)
  })

  it('a task paused at a usage limit is never auto-resumed by the director', () => {
    const dx = diagnose({ status: 'interrupted', lastError: 'Paused at your Claude usage limit (resets Tue 17:00)', repairStop: null } as never, null)
    expect(dx.kind).toBe('usage_limit')
    expect(dx.autoAction).toBeNull()
    expect(diagnose({ status: 'interrupted', lastError: 'Interrupted: app closed', repairStop: null } as never, null).autoAction).toBe('resume')
  })
})
