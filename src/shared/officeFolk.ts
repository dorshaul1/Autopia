// The people in the office who aren't on the delivery team: whoever runs the front desk, and the dog. You can talk to
// them, but no work is ever assigned to them. The dog only barks, and that never costs a token.

import type { OfficeType } from './offices'
import { plainWords } from './steering'

export const OFFICE_DOG = { id: 'office:corgi', name: 'Puffy' }

export const FRONT_DESK: Record<OfficeType, { id: string; name: string; role: string }> = {
  startup: { id: 'reception:rachel', name: 'Rachel', role: 'Office manager & reception' },
  studio: { id: 'reception:mika', name: 'Mika', role: 'Studio manager & front desk' },
  lab: { id: 'reception:nadia', name: 'Nadia', role: 'Lab coordinator & front desk' }
}

/** Only the startup office has a dog. */
export const dogIn = (office: OfficeType) => (office === 'startup' ? OFFICE_DOG : null)
export const frontDeskOf = (office: OfficeType) => FRONT_DESK[office] ?? FRONT_DESK.startup

export type Folk = 'dog' | 'desk'

export function folkById(id: string | null | undefined, office: OfficeType): Folk | null {
  if (!id) return null
  if (id === dogIn(office)?.id) return 'dog'
  return id === frontDeskOf(office).id ? 'desk' : null
}

const GREETING = '(?:hi|hey|hello|hiya|yo|good morning|good evening|good boy|good girl|שלום|היי)'

/**
 * Whether this message is said to someone, not just about them: "rachel", "hi puffy", "puffy, sit", "@puffy", "thanks,
 * rachel". "Add a puffy dog to the page" and "Rachel's photo should be bigger" are about something else.
 */
function saysTo(text: string, name: string): boolean {
  const t = text.trim().toLowerCase()
  const n = name.toLowerCase()
  return new RegExp(`^@?${n}(?![\\p{L}\\p{N}'’])|^${GREETING}[\\s,]+@?${n}(?![\\p{L}\\p{N}'’])|,\\s*@?${n}[\\s!.?…]*$|\\s@${n}(?![\\p{L}\\p{N}])`, 'iu').test(t)
}

/** Who this message is for, if it's one of them. A teammate with the same name comes first. */
export function folkAddressed(x: { text: string; employeeId?: string | null; office: OfficeType; team: { name: string }[] }): Folk | null {
  const thread = folkById(x.employeeId, x.office)
  if (thread) return thread
  // said to someone else on purpose
  if (x.employeeId) return null
  const taken = (name: string) => x.team.some((p) => plainWords(p.name)[0] === name.toLowerCase())
  const dog = dogIn(x.office)
  if (dog && !taken(dog.name) && saysTo(x.text, dog.name)) return 'dog'
  const desk = frontDeskOf(x.office)
  return !taken(desk.name) && saysTo(x.text, desk.name) ? 'desk' : null
}

const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7)

const BARKS = ['Woof!', 'Woof woof!', 'Arf!', 'Arf arf arf!', 'Ruff.', 'Bork!', 'Woof. Woof.', 'Awoooo!', 'Yip yip!', 'Boof.']
const HAPPY = ['Arf arf arf arf!', 'WOOF! Woof woof woof!', 'Yip yip yip!', 'Awoooo! Arf!']
const ASKING = ['Woof?', 'Ruff?', 'Arf? Woof?', 'Boof?']

/** Puffy's whole vocabulary. The same words in a different turn can get a different bark, but never a human word. */
export function barkReply(text: string, turn = 0): string {
  const seed = hash(text) + turn
  const list = /\b(treat|ball|walk|fetch|good (boy|girl|dog)|who'?s a good)\b/i.test(text) ? HAPPY : text.trim().endsWith('?') ? ASKING : BARKS
  return list[seed % list.length]
}
