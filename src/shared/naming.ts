// How tasks are named to people: by who does them and what they are ("Maya's “Add the login form”"),
// never by internal keys like T3. Keys stay internal (prompts, branches, ids).

import type { Task } from './types'

export const firstName = (name: string | null | undefined): string | null => (name ? name.split(' ')[0] : null)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

type Named = Pick<Task, 'key' | 'title' | 'assigneeId'>

/** "Maya's “Add the login form”" (or just the quoted title when nobody is known). */
export function taskRef(task: Named, nameOf: (employeeId: string) => string | null, max = 48): string {
  const who = nameOf(task.assigneeId)
  const title = `“${clip(task.title.trim(), max)}”`
  return who ? `${who}'s ${title}` : title
}

const KEY = /\bT\d+(?:\.(?:q|\d+))*\b/g
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrites a message for people: every key of a known task becomes who and what it is. "T3 Add login"
 * or "T3: Add login" (key with its own title) collapses to one reference; "T3: failed" (key as a
 * subject) reads "Maya: failed". Text without known keys is returned unchanged.
 */
export function humanizeKeys(text: string, tasks: Named[], nameOf: (employeeId: string) => string | null): string {
  if (!text || !KEY.test(text)) return text
  KEY.lastIndex = 0
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  let out = text
  // a key followed by its own title: one reference, not both
  for (const t of tasks) {
    if (!out.includes(t.key)) continue
    const title = t.title.trim()
    if (title) out = out.replace(new RegExp(`\\b${esc(t.key)}(?:[ :·—-]+\\s*)“?${esc(title)}”?`, 'g'), taskRef(t, nameOf))
  }
  // a key that starts a sentence as its subject ("T3: …", "T3 was …"): the person
  out = out.replace(new RegExp(`(^|\\n|\\. )(${KEY.source})(?=[: ])`, 'g'), (m, lead: string, key: string) => {
    const t = byKey.get(key)
    return t ? `${lead}${nameOf(t.assigneeId) ?? taskRef(t, nameOf)}` : m
  })
  // any other mention: who and what
  return out.replace(KEY, (key) => {
    const t = byKey.get(key)
    return t ? taskRef(t, nameOf) : key
  })
}
