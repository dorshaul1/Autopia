// What the installed Claude Code offers and how Autopia reaches it. The lists come from Claude Code itself at run
// time, so a capability added to the CLI shows up here without a change to Autopia.

export interface ClaudeCommand {
  name: string
  description: string
  argumentHint: string
}

export interface ClaudeCapabilities {
  commands: ClaudeCommand[]
  agents: string[]
  models: { value: string; label: string; about: string }[]
  /** The installed version, and the newest one published (null if that couldn't be checked). */
  version: string | null
  latest: string | null
  mcpServers: { name: string; status: string }[]
}

export const NO_CAPABILITIES: ClaudeCapabilities = { commands: [], agents: [], models: [], mcpServers: [], version: null, latest: null }

/** Is a newer Claude Code published? Compared number by number; anything unreadable says no rather than guess. */
export function isNewer(latest: string | null, installed: string | null): boolean {
  const parts = (v: string) => v.split('.').map((n) => parseInt(n, 10))
  if (!latest || !installed) return false
  const a = parts(latest)
  const b = parts(installed.split(' ')[0])
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Autopia's one addition: anything at all, straight to Claude Code with nothing added to it. */
export const DIRECT_COMMAND: ClaudeCommand = { name: 'claude', description: 'Talk to Claude Code directly, with every tool it has', argumentHint: 'what you want' }

/**
 * A message meant for Claude Code itself, or null for the team. Only names it really has count, so a message that
 * merely starts with a slash, like a path, still goes to the team.
 */
export function directCommand(text: string, known: string[]): { prompt: string } | null {
  const t = text.trim()
  const m = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(t)
  if (!m) return null
  if (m[1] === DIRECT_COMMAND.name) return m[2]?.trim() ? { prompt: m[2].trim() } : null
  return known.includes(m[1]) ? { prompt: t } : null
}

/** What the "/" menu shows for what's typed so far; null when the menu shouldn't be open. */
export function commandMatches(text: string, caps: ClaudeCapabilities, limit = 6): ClaudeCommand[] | null {
  const m = /^\/([\w:.-]*)$/.exec(text)
  if (!m) return null
  const q = m[1].toLowerCase()
  const all = [DIRECT_COMMAND, ...caps.commands]
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q))
  const within = q ? all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)) : []
  return [...starts, ...within].slice(0, limit)
}

export interface NativeQuestion {
  question: string
  header?: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

const MANY = 'You can pick more than one.'

/** A question as readable text: the first line is the question, wherever it's shown. */
export function questionBody(q: NativeQuestion): string {
  return [q.question, ...(q.options ?? []).map((o) => `• ${o.label}${o.description ? ` — ${o.description}` : ''}`), ...(q.multiSelect ? [MANY] : [])].join('\n')
}

/** The choices back out of that text, for the buttons. */
export function questionChoices(body: string): { question: string; options: { label: string; description: string }[]; multiSelect: boolean } {
  const lines = body.split('\n')
  const options = lines.filter((l) => l.startsWith('• ')).map((l) => {
    const [label, ...rest] = l.slice(2).split(' — ')
    return { label, description: rest.join(' — ') }
  })
  return { question: lines.filter((l) => !l.startsWith('• ') && l !== MANY).join('\n'), options, multiSelect: lines.includes(MANY) }
}

/** Newest first. */
export function copiesByVersion<T extends { version: string }>(copies: T[]): T[] {
  return [...copies].sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0))
}
