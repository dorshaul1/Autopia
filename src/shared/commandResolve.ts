// What pressing Enter in the Command will do, decided here without AI. Words that plainly name something local just do
// it; everything else goes to the team, whose own intelligence works out what you mean.

export interface CommandEntry {
  id: string
  label: string
  /** Other ways of saying it. */
  aliases?: string[]
  /** Something you can simply name: "preview", "open settings". Tasks and people are found, not assumed. */
  direct?: boolean
}

const VERBS = /^(please\s+)?(open|show|go to|goto|take me to|view|switch to|see)\s+(me\s+)?(the\s+|my\s+)?/
const clean = (s: string) => s.toLowerCase().replace(/[.!?…]+$/, '').replace(/\s+/g, ' ').trim()
const bare = (s: string) => clean(s).replace(VERBS, '').replace(/^the\s+/, '')

/** The entry this text plainly names. Only the whole phrase counts: "add a preview button" is a request. */
export function exactCommand<T extends CommandEntry>(text: string, entries: T[]): T | null {
  const said = clean(text)
  if (!said) return null
  const named = bare(text)
  return entries.find((e) => e.direct && [e.label, ...(e.aliases ?? [])].some((n) => clean(n) === said || clean(n) === named)) ?? null
}

export function searchCommands<T extends CommandEntry>(text: string, entries: T[], limit = 8): T[] {
  const q = clean(text)
  if (!q) return []
  const words = q.split(' ')
  const hay = (e: T) => [e.label, ...(e.aliases ?? [])].join(' ').toLowerCase()
  const starts = entries.filter((e) => e.label.toLowerCase().startsWith(q))
  const all = entries.filter((e) => !starts.includes(e) && words.every((w) => hay(e).includes(w)))
  return [...starts, ...all].slice(0, limit)
}

export interface Target {
  id: string
  name: string
}

/** A word being typed that aims the message: @someone or #T2. */
export function typingTarget(text: string): { kind: '@' | '#'; query: string } | null {
  const m = /(?:^|\s)([@#])([\w-]*)$/.exec(text)
  return m ? { kind: m[1] as '@' | '#', query: m[2].toLowerCase() } : null
}

/** That word gone, once it has become a chip. */
export const withoutTyped = (text: string) => text.replace(/(?:^|\s)[@#][\w-]*$/, '').trimEnd()

/** The plain sentence under the input, so nothing surprises you. Says only what's known before anything runs. */
export function outcomeLine(x: { hasText: boolean; local: string | null; direct: boolean; intent: string; to: string | null; task: string | null; result: number | null; product: string | null; direction: boolean }): string {
  if (!x.product) return x.hasText ? 'Starts something new from this, after you confirm the details.' : 'Find anything, or describe something new.'
  if (!x.hasText) return `Everything here is about ${x.product}.`
  if (x.local) return `${x.local} Nothing is sent, and no AI is used.`
  if (x.direct) return `Goes straight to Claude Code as you wrote it. It asks before acting in ${x.product}'s folder.`
  if (x.direction) return 'Changes where the product is heading. Plans under review get revised; work already finished isn’t redone.'
  const who = x.to ?? 'the team'
  const about = x.task ? ` about ${x.task}` : x.result ? ` about result #${x.result}` : ''
  if (x.intent === 'ask') return `A question for ${who}${about}. They answer; nothing changes.`
  if (x.intent === 'note') return `Reaches ${who} while they work${about}, without restarting anything.`
  if (x.intent === 'reply') return `Your answer to the plan waiting for you.`
  return `A request for ${who}${about}. Big changes get a plan for your OK first.`
}
