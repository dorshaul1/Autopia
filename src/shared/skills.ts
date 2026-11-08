// What the Skills screen and the routing share. Pure and token-free: nothing here calls a model, and nothing here
// claims a skill was used unless a run recorded it.

import type { RunSkills } from './types'

export const SKILL_GROUPS = ['Ways of working', 'Interface and design', 'Engineering', 'Games', 'AI and data', 'Quality'] as const
export type SkillGroup = (typeof SKILL_GROUPS)[number]

/** Every built-in skill in plain words. A test keeps this in step with the skills themselves. */
export const SKILL_ABOUT: Record<string, { group: SkillGroup; about: string }> = {
  'systematic-debugging': { group: 'Ways of working', about: 'Finds the real cause of a bug before changing anything.' },
  'spec-first': { group: 'Ways of working', about: 'Settles the plan first on large or complex work.' },
  'test-first': { group: 'Ways of working', about: 'Writes a failing test first for changes in logic.' },
  'frontend-quality': { group: 'Interface and design', about: 'Consistent spacing, type and every interface state.' },
  'react-practices': { group: 'Interface and design', about: 'Small components and clean state in React projects.' },
  'art-direction': { group: 'Interface and design', about: 'A distinct visual direction for brand and landing work.' },
  'typography-layout': { group: 'Interface and design', about: 'Type pairing, hierarchy and page composition.' },
  'product-ux': { group: 'Interface and design', about: 'Flows designed around what the person came to do.' },
  'interface-states': { group: 'Interface and design', about: 'Loading, empty, error and full states for data views.' },
  motion: { group: 'Interface and design', about: 'Motion that explains what changed.' },
  'visual-assets': { group: 'Interface and design', about: 'Original images and icons the product really needs.' },
  'responsive-accessible': { group: 'Interface and design', about: 'Works at every width, by keyboard and with a screen reader.' },
  'frontend-engineering': { group: 'Interface and design', about: 'State, rendering and bundle care in the browser.' },
  'real-content': { group: 'Interface and design', about: 'Writing that sounds like this business, not filler.' },
  'security-review': { group: 'Engineering', about: 'Checks input, secrets, files and access before finishing.' },
  'architecture-change': { group: 'Engineering', about: 'Safe migrations and changes to APIs and module boundaries.' },
  'api-design': { group: 'Engineering', about: 'Clear endpoints, status codes and errors, designed from the caller.' },
  'data-modeling': { group: 'Engineering', about: 'Schemas and migrations that protect the real rules.' },
  reliability: { group: 'Engineering', about: 'Timeouts, retries and failure handling for real conditions.' },
  performance: { group: 'Engineering', about: 'Measures first, then fixes what is really slow.' },
  'coherent-data': { group: 'Engineering', about: 'Sample data that adds up and looks believable.' },
  'game-feel': { group: 'Games', about: 'Responsive controls and satisfying feedback.' },
  'level-progression': { group: 'Games', about: 'Difficulty, progression and balance.' },
  'game-art': { group: 'Games', about: 'One consistent art style across the game.' },
  'game-content': { group: 'Games', about: 'A complete loop from start to win or lose.' },
  'ai-evaluation': { group: 'AI and data', about: 'Defines what good means, then measures it.' },
  'data-quality': { group: 'AI and data', about: 'Validates data at the boundary and handles bad rows.' },
  'ai-behaviour': { group: 'AI and data', about: 'Honest, understandable behaviour from AI features.' },
  'qa-journeys': { group: 'Quality', about: 'Tests real journeys the way a person would.' },
  reviewer: { group: 'Quality', about: 'A second, read-only look at high-risk changes.' }
}

/**
 * Where a skill stands. selected: Autopia gave or offered it to a run. loaded: Claude Code reported it in the session.
 * invoked: the agent really called it. Built-in text has no invocation to observe, so it can only ever be "given".
 */
export type SkillUseKind = 'given' | 'offered' | 'loaded' | 'invoked'

export interface SkillUse {
  runId: string
  projectId: string
  projectName: string
  taskId: string | null
  taskTitle: string | null
  at: number
  how: SkillUseKind
  /** Null when the run didn't record why. Never reconstructed afterwards. */
  why: string | null
}

export interface SkillEntry {
  id: string
  name: string
  about: string
  group: SkillGroup | 'External'
  origin: 'built-in' | 'external'
  /** blocked: your organization's policy. review: installed, not approved, and never given to anyone. */
  state: 'on' | 'off' | 'review' | 'blocked'
  source: string | null
  hasScripts: boolean
  usage: { selected: number; loaded: number; invoked: number; last: number | null }
  recent: SkillUse[]
}

/** Whether a managed deny rule covers the Skill tool for this skill. The toggle can never override it. */
export function skillBlocked(deny: string[], name: string): boolean {
  return deny.some((rule) => {
    const r = rule.trim()
    if (r === 'Skill' || r === 'Skill(*)') return true
    const m = /^Skill\((.+)\)$/.exec(r)
    if (!m) return false
    const pattern = m[1].replace(/:\*$/, '')
    return pattern === name || pattern === `autopia-skills:${name}`
  })
}

const stem = (w: string) => (w.length > 3 && !/(ss|is|us)$/.test(w) ? w.replace(/s$/, '') : w)
const STOP = new Set(
  'a an and any are as at be been before best by can code do does during every for from general guide guidelines help how if in into is it its like make more must need needs of on or our practices project projects review reviewing should skill skills so task tasks that the their them this to tool tools use used user users using via what when where which while who why will with work working write writing you your'.split(' ').map(stem)
)

const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[a-z][a-z0-9+#.-]*[a-z0-9+#]|[a-z]/g) ?? []).map(stem)

/** The words that say what a skill is about, from its own name and description. */
export function skillKeywords(name: string, description: string): Set<string> {
  return new Set(wordsOf(`${name.replace(/[-_]/g, ' ')} ${description}`).filter((w) => w.length > 2 && !STOP.has(w)))
}

/**
 * How well a task fits a skill, using the skill's own metadata. A word in the title counts most; a passing mention
 * in a long description doesn't reach the bar by itself. Returns the words, so the reason can be shown as it is.
 */
export function skillRelevance(task: { title: string; description: string }, keywords: Set<string>): { score: number; words: string[] } {
  const title = new Set(wordsOf(task.title))
  const body = new Set(wordsOf(task.description))
  const inTitle = [...keywords].filter((k) => title.has(k))
  const inBody = [...keywords].filter((k) => body.has(k) && !title.has(k))
  return { score: inTitle.length * 3 + Math.min(inBody.length, 3), words: [...inTitle, ...inBody].slice(0, 3) }
}

export const SKILL_MATCH_BAR = 3
export const MAX_EXTERNAL_PER_RUN = 2

/** Name and description from a SKILL.md's own frontmatter. */
export function skillFrontmatter(md: string): { name: string | null; description: string | null } {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? ''
  const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.+)$`, 'm').exec(head)?.[1].trim().replace(/^["']|["']$/g, '') ?? null
  return { name: field('name'), description: field('description') }
}

/** A link you pasted, as what it points at. Only GitHub, because that's what can be pinned to a commit. */
export function parseSkillSource(input: string): { owner: string; repo: string; branch: string | null; path: string } | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
  const seg = url.pathname.split('/').filter(Boolean)
  if (seg.length < 2) return null
  const clean = (s: string) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..'
  const repo = seg[1].replace(/\.git$/, '')
  if (!clean(seg[0]) || !clean(repo)) return null
  if (seg.length === 2) return { owner: seg[0], repo, branch: null, path: '' }
  if (seg[2] !== 'tree' || seg.length < 4) return null
  const rest = seg.slice(4)
  if (!clean(seg[3]) || rest.some((s) => !clean(s))) return null
  return { owner: seg[0], repo, branch: seg[3], path: rest.join('/') }
}

/** For a task's detail: names rather than ids, and what was given kept apart from what was really used. */
export function runSkillsLine(s: RunSkills): { given: string[]; used: string[] } {
  const label = (id: string) => s.labels?.[id] ?? id
  const given = [...new Set([s.primary, ...s.domains, ...(s.expertise ?? []), ...s.skills, ...s.subagents].filter((x): x is string => !!x))].map(label)
  const used = [...new Set([...(s.invoked ?? []), ...(s.subagentsUsed ?? [])])].map((n) => label(n.replace(/^autopia-skills:/, '')))
  return { given, used }
}
