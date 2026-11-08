// Settings defaults and limits, shared so the UI validates with the same rules the main process enforces.

import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  model: '',
  planningModel: '',
  maxParallel: 4,
  preferSubscription: false,
  autoResumeAfterLimit: false,
  permissionProfile: 'standard',
  effort: 'auto',
  modelStrategy: 'adaptive',
  maxFixAttempts: 2,
  memoryRetentionDays: 60,
  eventRetentionDays: 30,
  autoResolve: true,
  autoApprove: false,
  desktopNotifications: 'important',
  quietMode: false
}

/** Inclusive numeric limits (whole numbers unless noted). */
export const LIMITS = {
  maxParallel: [1, 8],
  maxFixAttempts: [0, 5],
  memoryRetentionDays: [7, 365],
  eventRetentionDays: [3, 365]
} as const satisfies Partial<Record<keyof Settings, readonly [number, number]>>

/** Plain-language problems with a draft, keyed by field; empty when it can be saved. */
export function settingsErrors(s: Settings): Partial<Record<keyof Settings, string>> {
  const out: Partial<Record<keyof Settings, string>> = {}
  for (const [k, [lo, hi]] of Object.entries(LIMITS) as [keyof typeof LIMITS, readonly [number, number]][]) {
    const v = s[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) out[k] = 'Enter a number'
    else if (v < lo || v > hi) out[k] = `Use a value from ${lo} to ${hi}`
    else if (!Number.isInteger(v)) out[k] = 'Use a whole number'
  }
  if (s.modelStrategy === 'fixed' && /\s/.test(s.model.trim())) out.model = 'A model name has no spaces (e.g. sonnet)'
  if (s.modelStrategy === 'fixed' && /\s/.test(s.planningModel.trim())) out.planningModel = 'A model name has no spaces (e.g. opus)'
  return out
}

export type SettingsGroup = 'work' | 'notifications' | 'memory'

/** Which choices each page owns. Restoring one page never touches another, and permissions and billing never reset this way. */
const GROUP_KEYS: Record<SettingsGroup, (keyof Settings)[]> = {
  work: ['autoApprove', 'autoResolve', 'autoResumeAfterLimit', 'maxParallel', 'modelStrategy', 'model', 'planningModel', 'effort', 'maxFixAttempts'],
  notifications: ['desktopNotifications', 'quietMode'],
  memory: ['memoryRetentionDays', 'eventRetentionDays']
}

export function defaultsForSection(group: SettingsGroup): Partial<Settings> {
  return Object.fromEntries(GROUP_KEYS[group].map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<Settings>
}

export function sectionAtDefaults(group: SettingsGroup, s: Settings): boolean {
  return GROUP_KEYS[group].every((k) => Object.is(s[k], DEFAULT_SETTINGS[k]))
}

/** What really changed and can be saved. A value that can't be right stays back, and the rest still goes. */
export function settingsPatch(draft: Settings, saved: Settings): Partial<Settings> {
  const errors = settingsErrors(draft)
  const out: Partial<Settings> = {}
  for (const k of Object.keys(draft) as (keyof Settings)[]) if (!errors[k] && !Object.is(draft[k], saved[k])) (out as Record<string, unknown>)[k] = draft[k]
  return out
}

const CHOICES: Partial<Record<keyof Settings, readonly unknown[]>> = {
  permissionProfile: ['standard', 'full'],
  effort: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
  modelStrategy: ['adaptive', 'fixed'],
  desktopNotifications: ['important', 'all', 'off']
}

/**
 * What's stored, made safe to read: a value from an older version or a damaged record reads as its default, without
 * rewriting anything, and every value that's still good stays exactly as you chose it.
 */
export function readableSettings(stored: Record<string, unknown>): Settings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(k in stored)) continue
    const v = stored[k]
    const choices = CHOICES[k]
    if (choices ? choices.includes(v) : typeof v === typeof DEFAULT_SETTINGS[k]) out[k] = v
  }
  const s = out as unknown as Settings
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) if (settingsErrors(s)[k]) (s[k] as number) = DEFAULT_SETTINGS[k]
  return s
}

/** What Claude Code said about an MCP server, in words. Anything it says that isn't known here is shown as it said it. */
export function mcpWord(status: string): { word: string; tone: 'ready' | 'danger' | 'attention' | 'quiet' | 'live' } {
  switch (status) {
    case 'connected':
      return { word: 'Connected', tone: 'ready' }
    case 'failed':
      return { word: 'Couldn’t start. Run claude mcp list in a terminal to see why.', tone: 'danger' }
    case 'needs-auth':
      return { word: 'Needs signing in. Run /mcp in Claude Code.', tone: 'attention' }
    case 'pending':
      return { word: 'Starting', tone: 'live' }
    case 'disabled':
      return { word: 'Turned off', tone: 'quiet' }
    default:
      return { word: status, tone: 'quiet' }
  }
}
