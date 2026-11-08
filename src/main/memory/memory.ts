import { plural } from '@shared/friendlyError'
import { originOf } from '@shared/knowledge'
// The company's long-term memory for one machine: compact, topic-keyed project facts with provenance,
// deterministic retrieval within a size budget, freshness checks against the repository, and lessons
// computed from real history. No AI calls: every operation here is local and cheap.

import { createHash } from 'node:crypto'
import type { Picked, SourceCandidate } from '@shared/inspect'
import type { CodeGraphInfo, HistoryStat, KnowledgeEntry, KnowledgeKind, Lesson, MemoryIndexInfo, MemoryReport, Project, QualityFinding, RunEvent, Settings, Task } from '@shared/types'
import type { Repo } from '../db/repo'
import { head as gitHead } from '../git/review'
import { buildCodeMap, changedSource, languageOf, parseSource, type MapRow } from './codeGraph'
import { indexRepository, listFiles, TEST_FILE, type FileScan } from './indexer'
import { redact } from './secrets'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveLoginEnv } from '../claude/cli'

const execFileAsync = promisify(execFile)
const AUTO_KINDS: KnowledgeKind[] = ['stack', 'module', 'workflow', 'dependency', 'convention']
const PURPOSE = 'purpose:project'
const STOP = new Set('the and for with that this from into your are was were will have has not but all any can should when then than them they their what which while where who how add make use using also more less into onto out new old file files code'.split(' '))

export interface ContextQuery {
  purpose: 'plan' | 'task'
  text: string
  files: string[]
  taskKind?: Task['kind']
  size?: Task['size']
  /** Topics that must be included whatever their relevance score (e.g. handoffs of a task's dependencies). */
  pinned?: string[]
  /** Files the request itself names or clearly refers to (see matchTargets); used when the task lists none. */
  targets?: Target[]
}

export interface ContextPack {
  text: string
  ids: string[]
  chars: number
  /** Files matched from the request, when any. */
  targets?: string[]
}

/** A file the request refers to, and the deterministic reason it matched. */
export interface Target {
  file: string
  why: string
}

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/** A memory file matches a task file exactly, by directory, or by glob prefix. */
export function fileMatch(a: string, b: string): boolean {
  const strip = (x: string) => x.replace(/\*.*$/, '').replace(/\/$/, '')
  const A = strip(a)
  const B = strip(b)
  if (!A || !B) return false
  return A === B || A.startsWith(`${B}/`) || B.startsWith(`${A}/`)
}

/** Deterministic relevance: file overlap first, then shared words, then a small prior per kind. */
export function scoreEntry(e: KnowledgeEntry, q: ContextQuery, qWords: Set<string>): number {
  if (e.status === 'archived' || e.topic.startsWith('lesson:founder:')) return 0
  // what a task builds on still reaches it after later work moved its files on; it's labelled as such
  if (q.pinned?.includes(e.topic)) return 100
  if (e.status !== 'active') return 0
  if (e.topic === PURPOSE) return 60
  // what you decided holds whatever the task is about, whether or not it shares a word with it
  if (e.author === 'user' && e.kind === 'decision') return 55
  // what you said you always want applies to everything
  if (e.topic.startsWith('preference:')) return 50
  // what tasks agreed to share: everyone building on it needs it, whatever they're working on
  if (e.topic.startsWith('contract:') && e.status === 'active') return 40
  if ((e.topic === 'direction:project' || e.topic === 'direction:constraints') && e.status === 'active') return 45
  if (e.topic.startsWith('assumption:')) return 44
  const overlap = q.files.some((f) => e.files.some((g) => fileMatch(f, g))) || e.files.some((g) => q.text.includes(g.split('/').pop() ?? '\u0000'))
  const shared = [...words(`${e.title} ${e.text} ${e.topic}`)].filter((w) => qWords.has(w)).length
  let s = (overlap ? 5 : 0) + Math.min(3, shared * 0.6)
  const prior: Record<KnowledgeKind, [number, number]> = {
    // [planning prior, task prior]
    stack: [4, 1.5],
    module: [3, 1.6], // the layout is small and saves agents from listing directories
    workflow: [3, q.taskKind === 'design' ? 0.8 : 2],
    dependency: [1, 0.3],
    convention: [2, 2],
    architecture: [3, 2],
    decision: [2, overlap || shared >= 2 ? 2 : 0],
    limitation: [1.5, overlap || shared >= 2 ? 1.5 : 0],
    completed: [1, overlap ? 1.5 : 0],
    handoff: [0.5, overlap ? 2.5 : 0],
    lesson: [1.5, overlap || shared >= 1 ? 1.5 : 0]
  }
  s += prior[e.kind][q.purpose === 'plan' ? 0 : 1]
  // each specialist gets their own part of what's known
  if (q.taskKind && q.taskKind !== 'design' && e.topic === 'convention:design-direction' && !overlap && !/\b(ui|page|screen|component|css|style|frontend|layout|view|menu|hud)\b/i.test(q.text)) s -= 2
  if (q.taskKind === 'qa' && (e.kind === 'limitation' || e.kind === 'completed')) s += 1
  if (e.confidence === 'user') s += 1
  return s
}

const GRAPH_MAX_FILES = 20_000
const BUDGET = { plan: 2400, s: 1000, m: 1500, l: 2000 }
// what you decided and what tasks agreed to share have their own room, so neither crowds out the other or the rest
const FOUNDER_ROOM = 1800
const CONTRACT_ROOM = 1400

const VERBS = new Set('get set use make create build add new format parse render handle update delete remove load save fetch read write with from has is to on'.split(' '))
const VAGUE = new Set('Index App Main Config Data Type Types Error Page Layout Item List Props State Context Provider Base Default Utils Helper'.split(' '))
const stemWord = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/**
 * What already exists for this request, from exported names: `formatPrice` for "show the price", `Button`
 * for "add a button". Only names, never a claim that it fits, so the agent looks before writing another.
 */
export function existingFor(symbols: Record<string, string[]>, text: string, exclude: string[], max = 6): { file: string; name: string }[] {
  const asked = new Set((text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).map(stemWord))
  const out: { file: string; name: string; score: number }[] = []
  for (const [file, names] of Object.entries(symbols)) {
    if (TEST_FILE.test(file) || exclude.some((f) => fileMatch(f, file))) continue
    for (const name of names) {
      const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().split(' ').filter(Boolean).map(stemWord)
      const hits = parts.filter((p) => p.length >= 4 && !VERBS.has(p) && asked.has(p))
      if (!hits.length || hits.length * 2 < parts.length) continue
      if (parts.length === 1 && (!/^[A-Z]/.test(name) || VAGUE.has(name))) continue
      out.push({ file, name, score: hits.length / parts.length })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(({ file, name }) => ({ file, name }))
}

/** A lasting wish in your own words ("always...", "never...", "from now on..."), or null. Questions don't count. */
export function preferenceIn(text: string): string | null {
  for (const raw of text.split(/(?<=[.!\n])\s+/)) {
    const s = raw.trim()
    if (s.length >= 8 && s.length <= 240 && !s.endsWith('?') && !/\bnever mind\b/i.test(s) && /\b(always|never|from now on|going forward|don'?t ever|do not ever|as a rule)\b/i.test(s)) return s
  }
  return null
}

const HEDGE = /\b(maybe|perhaps|might|could|should we|shall we|what if|not sure|i think|i guess|wondering|consider|how about|would it|possibly|if we|do we)\b/i
const STATED = /\b(we|i)('ve| have)? decided\b|^(my |our |the )?decision\s*(is|:)|\blet'?s (go with|stick with|use)\b|\bwe('ll| will|'re| are)( going to)? (use|using|go with|going with|stick with|sticking with)\b|\buse\b.+\binstead of\b|\b(we|i) (do not|don'?t|no longer) (want|need|use)\b/i

/** A decision you stated outright, or null. Questions, maybes and suggestions stay what they are. */
export function decisionIn(text: string): string | null {
  for (const raw of text.split(/(?<=[.!\n])\s+/)) {
    const s = raw.trim()
    if (s.length >= 8 && s.length <= 240 && !s.endsWith('?') && !HEDGE.test(s) && STATED.test(s)) return s
  }
  return null
}

/** What a statement says is over: "Postgres instead of SQLite" → sqlite. Only ever a name you wrote. */
export function replacedBy(said: string): string | null {
  // the name ends where the sentence moves on: "euros on the page" is about euros
  const end = String.raw`(.+?)(?=\s+(?:on|in|for|at|from|to|across|throughout|when|because|since|anymore|any more)\b|[,.;!\n]|$)`
  const m = new RegExp(String.raw`\binstead of\s+${end}`, 'i').exec(said) ?? new RegExp(String.raw`\b(?:no longer|don'?t|do not|stop)\s+(?:use|using|want|need)\s+${end}`, 'i').exec(said)
  const name = m?.[1].replace(/^(the|a|an|any|our)\s+/i, '').trim()
  return name && name.length >= 3 && name.split(/\s+/).length <= 4 ? name : null
}

const mentions = (text: string, name: string) => new RegExp(`(^|[^\\w@/-])${name.replace(/[.*+?^\${}()|[\]\\/]/g, '\\$&')}($|[^\\w-])`, 'i').test(text)

const POLES = new Set("always never use using don't dont not no longer avoid stop from now going forward ever rule".split(' '))
const NEGATED = /\b(never|don'?t|do not|no longer|avoid|stop|not|without)\b/i
const gist = (s: string) => new Set([...words(s)].filter((w) => !POLES.has(w)))
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length / Math.max(1, new Set([...a, ...b]).size)

/** The same thing said the opposite way: "always use tabs" and "never use tabs". Unrelated statements never match. */
export function contradicts(a: string, b: string): boolean {
  return NEGATED.test(a) !== NEGATED.test(b) && overlap(gist(a), gist(b)) >= 0.6
}

/** The same question asked again, near enough that its answer still applies. */
export function sameQuestion(a: string, b: string): boolean {
  return overlap(words(a), words(b)) >= 0.8
}

/**
 * Why a decision or description can no longer be taken at its word: something it names has left the project. Judged
 * only from what really left since the last look, so a plan naming files that don't exist yet isn't flagged.
 */
export function goneFrom(e: Pick<KnowledgeEntry, 'text' | 'title' | 'files'>, removedFiles: string[], removedDeps: string[]): string | null {
  const file = removedFiles.find((f) => e.files.includes(f) || e.text.includes(f))
  if (file) return `${file} no longer exists`
  const dep = removedDeps.find((d) => d.length >= 3 && mentions(`${e.title} ${e.text}`, d))
  return dep ? `${dep} is no longer a dependency` : null
}

/** Builds the prompt section from the highest-scoring entries that fit the budget. */
/** Direct relationships of the task's files: what they import and what imports them (deterministic). */
export function relationships(graph: Record<string, string[]>, files: string[], max = 6): string[] {
  const targets = Object.keys(graph).concat(Object.values(graph).flat()).filter((f, i, a) => a.indexOf(f) === i && files.some((q) => fileMatch(q, f)))
  return targets.slice(0, max).map((f) => {
    const imports = graph[f] ?? []
    const usedBy = Object.entries(graph).filter(([, deps]) => deps.includes(f)).map(([k]) => k)
    return `- ${f}${imports.length ? ` imports ${imports.slice(0, 5).join(', ')}` : ''}${usedBy.length ? `${imports.length ? ';' : ''} used by ${usedBy.slice(0, 5).join(', ')}` : ''}`
  }).filter((l) => /imports|used by/.test(l))
}

/** A stored import graph read back from the database: anything malformed is dropped, never trusted. */
export function sanitizeGraph(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
  return out
}

/**
 * Files a request refers to, without AI: paths it names, file names, exported symbols it mentions and
 * file stems used as words ("the cart total" → lib/cart.js). Strongest evidence first, at most `max`.
 */
export function matchTargets(text: string, files: string[], symbols: Record<string, string[]>, max = 6): Target[] {
  const out = new Map<string, string>()
  const add = (file: string, why: string) => out.size < max && !out.has(file) && out.set(file, why)
  const source = files.filter((f) => !TEST_FILE.test(f))
  // 1. paths and file names written in the request
  for (const m of text.matchAll(/[\w./-]*[\w-]\.[a-z]{1,5}\b/gi)) {
    const token = m[0].replace(/^\.?\//, '')
    if (files.includes(token)) add(token, 'named in the request')
    else if (!token.includes('/')) {
      // a bare file name counts only when it is unambiguous
      const same = files.filter((f) => f.split('/').pop() === token)
      if (same.length === 1) add(same[0], 'named in the request')
    }
  }
  // 2. exported symbols the request mentions (only distinctive ones: exported by at most two files)
  const owners = new Map<string, string[]>()
  for (const [f, names] of Object.entries(symbols)) if (!TEST_FILE.test(f)) for (const n of names) owners.set(n, [...(owners.get(n) ?? []), f])
  for (const m of text.matchAll(/[A-Za-z_$][\w$]{3,}/g)) {
    const who = owners.get(m[0])
    // camelCase/snake_case names are code; a plain lowercase word only when written as code (`name` or name()
    const after = text[m.index! + m[0].length]
    const distinctive = /[A-Z_$\d]/.test(m[0].slice(1)) || text[m.index! - 1] === '`' || after === '(' || after === '`'
    if (who && who.length <= 2 && distinctive) who.forEach((f) => add(f, `defines \`${m[0]}\``))
  }
  // 3. weakest evidence, only when the request names no path or symbol: a file stem used as a word
  // ("the todo CLI", "the cart total"); unique stems only
  if (out.size) return [...out].map(([file, why]) => ({ file, why }))
  const stems = new Map<string, string[]>()
  for (const f of source) {
    const stem = (f.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase()
    if (stem.length >= 4 && !/^(index|main|app|utils?|helpers?|types|config|constants)$/.test(stem)) stems.set(stem, [...(stems.get(stem) ?? []), f])
  }
  for (const w of new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])) {
    const hit = stems.get(w)
    if (hit && hit.length === 1) add(hit[0], `"${w}" in the request`)
  }
  return [...out].map(([file, why]) => ({ file, why }))
}

/**
 * The public surface of the files a task touches, as the rest of the code uses it: which exported names
 * other files import, and from where. These are the contracts a change must keep (or update everywhere).
 */
export function reliedOn(uses: Record<string, Record<string, string[]>>, files: string[], max = 4): string[] {
  const byTarget = new Map<string, Map<string, string[]>>()
  for (const [importer, targets] of Object.entries(uses)) {
    for (const [target, names] of Object.entries(targets)) {
      if (!files.some((f) => fileMatch(f, target)) || files.some((f) => fileMatch(f, importer))) continue
      const m = byTarget.get(target) ?? new Map<string, string[]>()
      for (const n of names) m.set(n, [...(m.get(n) ?? []), importer])
      byTarget.set(target, m)
    }
  }
  return [...byTarget.entries()].slice(0, max).map(([target, m]) => `- ${target}: ${[...m.entries()].slice(0, 6).map(([n, who]) => `${n} (used by ${who.slice(0, 3).join(', ')}${who.length > 3 ? ` +${who.length - 3}` : ''})`).join(', ')}`)
}

/** A stored importer → target → names map read back from the database: malformed parts are dropped. */
export function sanitizeUses(raw: unknown): Record<string, Record<string, string[]>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, string[]>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = sanitizeGraph(v)
  return out
}

export function buildContext(entries: KnowledgeEntry[], q: ContextQuery, commit: string | null, rawGraph: unknown = {}, rawUses: unknown = {}, rawSymbols: unknown = {}): ContextPack {
  const uses = sanitizeUses(rawUses)
  const graph = sanitizeGraph(rawGraph)
  const targets = q.targets ?? []
  if (targets.length) q = { ...q, files: [...new Set([...q.files, ...targets.map((t) => t.file)])] }
  const qWords = words(`${q.text} ${q.files.join(' ')}`)
  const ranked = entries
    .map((e) => ({ e, s: scoreEntry(e, q, qWords) }))
    .filter((x) => x.s >= 1.5)
    .sort((a, b) => b.s - a.s || b.e.updatedAt - a.e.updatedAt)
  const budget = q.purpose === 'plan' ? BUDGET.plan : BUDGET[q.size ?? 'm']
  const groups: Record<'repo' | 'plan' | 'decisions' | 'assumptions' | 'reported' | 'yours', string[]> = { repo: [], plan: [], decisions: [], assumptions: [], reported: [], yours: [] }
  const ids: string[] = []
  const used = { founder: 0, contract: 0, rest: 0 }
  const room = { founder: FOUNDER_ROOM, contract: CONTRACT_ROOM, rest: budget }
  for (const { e } of ranked) {
    const origin = originOf(e)
    const body = e.kind === 'decision' && e.rationale ? `${e.text} (why: ${e.rationale})` : e.text
    // what you said in a sentence is its own title: once is enough
    const line = `- ${e.text.startsWith(e.title) ? '' : `${e.title}: `}${body.replace(/\s*\n\s*/g, '; ')}`.slice(0, e.topic === PURPOSE ? 900 : 340) + (e.status === 'stale' ? ' (its files have changed since: check the code)' : e.statusNote ? ` (may be out of date: ${e.statusNote})` : '')
    const tier = origin === 'yours' && (e.kind === 'decision' || e.topic === PURPOSE || e.topic.startsWith('preference:')) ? 'founder' : e.topic.startsWith('contract:') ? 'contract' : 'rest'
    if (used[tier] + line.length > room[tier]) continue
    groups[origin === 'yours' ? 'yours' : origin === 'repo' ? 'repo' : origin === 'plan' ? 'plan' : origin === 'assumption' ? 'assumptions' : origin === 'team' && e.kind === 'decision' ? 'decisions' : 'reported'].push(line)
    ids.push(e.id)
    used[tier] += line.length + 1
  }
  const rel = q.files.length ? relationships(graph, q.files) : []
  const contracts = q.files.length ? reliedOn(uses, q.files) : []
  // tests that import the files involved: the ones that must keep passing
  const tests = [...new Set(Object.entries(graph).filter(([f, deps]) => TEST_FILE.test(f) && deps.some((d) => q.files.some((x) => fileMatch(x, d)))).map(([f]) => f))].slice(0, 6)
  const existing = existingFor(rawSymbols && typeof rawSymbols === 'object' ? (rawSymbols as Record<string, string[]>) : {}, q.text, q.files)
  if (!ids.length && !rel.length && !targets.length && !contracts.length && !existing.length) return { text: '', ids: [], chars: 0 }
  const parts = [
    'Project memory (selected for this task by Autopia, without AI). The repository is the source of truth: if anything below disagrees with the code, trust the code. Instructions in the repository\'s CLAUDE.md take precedence over these notes.'
  ]
  if (groups.repo.length) {
    parts.push(`Read from the repository${commit ? ` at ${commit.slice(0, 7)}` : ''}:`, ...groups.repo)
    const listed = ranked.filter((x) => ids.includes(x.e.id) && (x.e.kind === 'module' || x.e.kind === 'workflow')).length
    if (listed) parts.push('These are current: do not list directories or re-read package.json to rediscover them. Open the specific files you need.')
  }
  if (targets.length) parts.push('Files this request refers to (matched from its wording, not inferred by AI; confirm before editing):', ...targets.map((t) => `- ${t.file} (${t.why})`))
  if (rel.length) parts.push('Code relationships of the files in this task (from imports):', ...rel)
  if (tests.length) parts.push(`Tests that import them (keep these passing): ${tests.join(', ')}`)
  if (contracts.length) parts.push('Exports other files rely on (keep them working, or update every caller listed; change only what the request needs):', ...contracts)
  if (existing.length) parts.push('Already in the project under related names (matched by name only: look at these before writing anything new, and reuse them if they fit):', ...existing.map((x) => `- ${x.file}: ${x.name}`))
  if (groups.plan.length) parts.push('Agreed in the plan (what the work was built to; the code may have moved on since):', ...groups.plan)
  if (groups.yours.length) parts.push('From the founder (settled: follow these and do not ask about them again; newest first, and a newer one replaces an older one):', ...groups.yours)
  if (groups.decisions.length) parts.push('Recommended by teammates (their judgement, not the founder\'s decisions; the founder\'s word and the code both override them):', ...groups.decisions)
  if (groups.assumptions.length) parts.push('Working assumptions (the founder has not confirmed these; if your work depends on one, say so in your summary):', ...groups.assumptions)
  if (groups.reported.length) parts.push('From previous work (teammates\' accounts; confirm in the code before relying on them):', ...groups.reported)
  const text = parts.join('\n')
  return { text, ids, chars: text.length, ...(targets.length ? { targets: targets.map((t) => t.file) } : {}) }
}

/**
 * Git-compatible blob hashes computed in-process (identical to `git hash-object` for ordinary files), so
 * freshness works with or without git and spawns nothing. A missing or unreadable file hashes to ''.
 */
export function blobHashes(root: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of files.slice(0, 40)) {
    if (isAbsolute(f) || f.split('/').includes('..')) continue
    try {
      const b = readFileSync(join(root, f))
      out[f] = createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')
    } catch {
      out[f] = ''
    }
  }
  return out
}

/** Why a fact no longer matches the files it describes, or null if they are unchanged. */
export function freshnessNote(recorded: Record<string, string>, now: Record<string, string>, known: string[]): string | null {
  const changed = Object.keys(recorded).filter((f) => (recorded[f] ?? '') !== (now[f] ?? ''))
  if (!changed.length) return null
  const removed = changed.filter((f) => !now[f] && recorded[f])
  const more = changed.length > 1 ? ` (+${changed.length - 1} more)` : ''
  if (removed.length) {
    const name = removed[0].split('/').pop()
    const moved = known.find((k) => k !== removed[0] && k.split('/').pop() === name)
    return `${removed[0]} no longer exists${moved ? `; a file with the same name is at ${moved}` : ''}${more}`
  }
  return `${changed[0]} changed since this was recorded${more}`
}

const subjectOf = (title: string) => (/^([^:—–]{3,40})[:—–]/.exec(title)?.[1] ?? '').trim().toLowerCase()

/**
 * Two decisions conflict when they are about the same thing (same "Subject:" title prefix, or shared
 * files and mostly the same title words) but say different things. Deliberately conservative: an
 * unrelated pair is never flagged.
 */
export function decisionsConflict(a: { title: string; text: string; files: string[] }, b: { title: string; text: string; files: string[] }): boolean {
  if (a.text.trim().toLowerCase() === b.text.trim().toLowerCase()) return false
  const sa = subjectOf(a.title)
  // a plan's contracts are all "Shared contract: …": each is its own thing, not a rival of the last
  if (sa && sa !== 'shared contract' && sa === subjectOf(b.title)) return true
  const shared = a.files.some((f) => b.files.some((g) => fileMatch(f, g)))
  if (!shared) return false
  const wa = words(a.title)
  const wb = words(b.title)
  const inter = [...wa].filter((w) => wb.has(w)).length
  return inter / Math.max(1, new Set([...wa, ...wb]).size) >= 0.5
}

export class Memory {
  private graphSync = new Map<string, Promise<void>>()
  private graphAgain = new Set<string>()
  constructor(private repo: Repo) {}

  private async stateKey(project: Project): Promise<string> {
    if (!project.gitEnabled) return `nogit:${Date.now() >> 16}` // re-index at most every ~65s without git
    const env = await resolveLoginEnv()
    const head = (await gitHead(project.path)) ?? ''
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: project.path, env }).catch(() => ({ stdout: '' }))
    return `${head}:${createHash('sha1').update(stdout).digest('hex').slice(0, 12)}`
  }

  indexInfo(projectId: string): MemoryIndexInfo {
    const graph = this.repo.meta<CodeGraphInfo>(`code-graph:${projectId}`) ?? undefined
    const info = this.repo.meta<MemoryIndexInfo>(`memory-index:${projectId}`)
    if (info) return { ...info, graph }
    return { graph, commit: null, indexedAt: null, files: 0, skippedSecrets: 0, hasClaudeMd: false }
  }

  /**
   * Incremental refresh: does nothing unless HEAD or the working tree changed. Re-derives the
   * repository facts and marks other knowledge stale when the files it describes changed.
   */
  async refresh(project: Project, force = false): Promise<MemoryIndexInfo> {
    await this.repair(project)
    const key = await this.stateKey(project)
    const prev = this.repo.meta<string>(`memory-key:${project.id}`)
    // a project from before the code map, or one reopened: the map checks itself file by file
    if (!this.repo.meta(`code-graph:${project.id}`)) void this.syncGraph(project)
    if (!force && prev === key) return this.indexInfo(project.id)
    const commit = project.gitEnabled ? await gitHead(project.path) : null
    const prevScan = this.repo.meta<Record<string, FileScan>>(`memory-scan:${project.id}`)
    const result = await indexRepository(project.path, project.gitEnabled, prevScan && typeof prevScan === 'object' && !Array.isArray(prevScan) ? prevScan : {})
    const depsBefore = this.repo.meta<string[]>(`memory-deps:${project.id}`) ?? []
    const depsNow = dependencyNames(project.path)
    this.repo.setMeta(`memory-deps:${project.id}`, depsNow)
    const removedFiles = Object.keys(prevScan && typeof prevScan === 'object' ? prevScan : {}).filter((f) => !(f in result.scan) && !existsSync(join(project.path, f)))
    this.repo.setMeta(`memory-graph:${project.id}`, result.graph)
    this.repo.setMeta(`memory-symbols:${project.id}`, result.symbols)
    this.repo.setMeta(`memory-uses:${project.id}`, result.uses)
    this.repo.setMeta(`memory-scan:${project.id}`, result.scan)
    const produced = new Set<string>()
    for (const f of result.facts) {
      produced.add(f.topic)
      const hashes = f.files.length ? blobHashes(project.path, f.files) : {}
      this.repo.upsertKnowledge({
        projectId: project.id,
        kind: f.kind,
        topic: f.topic,
        title: f.title,
        text: f.text,
        rationale: null,
        alternatives: null,
        files: f.files,
        hashes,
        commit,
        source: 'repository index',
        confidence: 'verified',
        status: 'active',
        author: 'system'
      })
    }
    for (const e of this.repo.knowledge(project.id)) {
      // facts the index no longer produces are gone from the repo
      if (e.author === 'system' && AUTO_KINDS.includes(e.kind) && !produced.has(e.topic)) this.repo.deleteKnowledge(e.id)
    }
    await this.checkFreshness(project)
    this.checkNamed(project, removedFiles, depsBefore.filter((d) => !depsNow.includes(d)))
    const info: MemoryIndexInfo = { commit, indexedAt: Date.now(), files: result.files, skippedSecrets: result.skippedSecrets, hasClaudeMd: result.hasClaudeMd }
    this.repo.setMeta(`memory-index:${project.id}`, info)
    this.repo.setMeta(`memory-key:${project.id}`, key)
    void this.syncGraph(project)
    return info
  }

  /**
   * Any non-index entry whose files changed or disappeared since it was recorded becomes stale, with the
   * reason (never silently trusted). Works with or without git.
   */
  private async checkFreshness(project: Project): Promise<void> {
    const known = Object.keys(this.repo.meta<Record<string, unknown>>(`memory-scan:${project.id}`) ?? {})
    for (const e of this.repo.knowledge(project.id)) {
      // active entries are checked; stale ones from before reasons were recorded get theirs filled in
      const unexplained = e.status === 'stale' && !e.statusNote
      if ((e.status !== 'active' && !unexplained) || !e.files.length || (e.author === 'system' && AUTO_KINDS.includes(e.kind))) continue
      const recorded = e.hashes && typeof e.hashes === 'object' ? e.hashes : {}
      if (!Object.keys(recorded).length) continue
      const note = freshnessNote(recorded, blobHashes(project.path, Object.keys(recorded)), known)
      if (note) this.repo.setKnowledgeStatus(e.id, 'stale', note)
    }
  }

  /**
   * Decisions and descriptions aren't tied to every edit of their files, but they do stop being true when what they
   * name leaves the project. A team note stops being shared; yours keeps standing, flagged, for you to settle.
   */
  private checkNamed(project: Project, removedFiles: string[], removedDeps: string[]): void {
    if (!removedFiles.length && !removedDeps.length) return
    for (const e of this.repo.knowledge(project.id)) {
      if (e.status !== 'active' || e.statusNote || e.topic === PURPOSE || !['decision', 'architecture', 'convention', 'limitation'].includes(e.kind) || (e.author === 'system' && AUTO_KINDS.includes(e.kind))) continue
      const note = goneFrom(e, removedFiles, removedDeps)
      if (note) this.repo.setKnowledgeStatus(e.id, e.author === 'user' ? 'active' : 'stale', note)
    }
  }

  /** Once per project: puts back the plan's contracts that each newer one wrongly archived, and notes what the product is. */
  private async repair(project: Project): Promise<void> {
    const key = `memory-repair-66:${project.id}`
    if (this.repo.meta(key)) return
    this.repo.setMeta(key, true)
    for (const e of this.repo.knowledge(project.id)) {
      if (e.topic.startsWith('contract:') && e.status === 'archived' && e.statusNote?.startsWith('Superseded by "Shared contract')) this.repo.setKnowledgeStatus(e.id, 'active')
    }
    const first = this.repo.deliveries(project.id).reduce<{ number: number; request: string } | null>((a, d) => (!a || d.number < a.number ? d : a), null)
    if (first && this.repo.productSpec(project.id)) await this.rememberPurpose(project, first.request)
  }

  /**
   * The founder's call on an entry. "Still true" on a stale entry re-confirms it against the files as
   * they are now, so it is not marked stale again until they change again.
   */
  setStatus(project: Project, e: KnowledgeEntry, status: KnowledgeEntry['status']): void {
    if (status === 'active' && Object.keys(e.hashes).length) this.repo.setKnowledgeHashes(e.id, blobHashes(project.path, Object.keys(e.hashes)))
    this.repo.setKnowledgeStatus(e.id, status)
  }

  /** Files the request refers to (see matchTargets), from the current index. */
  async targets(project: Project, text: string): Promise<Target[]> {
    await this.refresh(project).catch(() => undefined)
    const scan = this.repo.meta<Record<string, unknown>>(`memory-scan:${project.id}`) ?? {}
    const symbols = this.repo.meta<Record<string, string[]>>(`memory-symbols:${project.id}`) ?? {}
    return matchTargets(text, Object.keys(scan), symbols && typeof symbols === 'object' ? symbols : {})
  }

  /** Write or update a fact from work (agent) or the founder. Secrets are redacted before storage. */
  async remember(
    project: Project,
    e: { kind: KnowledgeKind; topic?: string; title: string; text: string; files: string[]; source: string; rationale?: string | null; alternatives?: string | null },
    author: 'agent' | 'user' | 'system' = 'agent'
  ): Promise<KnowledgeEntry | null> {
    const text = redact(e.text.trim()).slice(0, 900)
    if (!text) return null
    const files = [...new Set(e.files.filter(Boolean))].slice(0, 20)
    // decisions, lessons and summaries name affected areas; editing those files doesn't invalidate them
    const tracked = !['decision', 'lesson', 'architecture'].includes(e.kind)
    const hashes = tracked && files.length ? blobHashes(project.path, files) : {}
    const topic = e.topic ?? `${e.kind}:${slug(redact(e.title))}`
    const all = this.repo.knowledge(project.id)
    const existing = all.find((x) => x.topic === topic)
    // never let an agent overwrite what the founder wrote
    if (existing?.author === 'user' && author !== 'user') return existing
    // a decision that contradicts an active one: the founder's always stands (the new one waits for
    // their call); otherwise the newer decision supersedes the older, which is kept as history
    const rivals = e.kind === 'decision' ? all.filter((x) => x.kind === 'decision' && x.status === 'active' && x.topic !== topic && decisionsConflict(x, { title: e.title, text, files })) : []
    const rival = rivals.find((x) => x.author === 'user') ?? rivals[0]
    const blocked = rival?.author === 'user' && author !== 'user'
    // you changed your mind about the same thing: the earlier answer stays as history
    if (existing && existing.author === 'user' && author === 'user' && e.kind === 'decision' && existing.text !== text) {
      const { id: _i, uses: _u, lastUsedAt: _l, createdAt: _c, updatedAt: _a, stale: _s, ...kept } = existing
      this.repo.upsertKnowledge({ ...kept, topic: `${topic}~${existing.updatedAt}`, status: 'archived', statusNote: 'You later changed this' })
    }
    const saved = this.repo.upsertKnowledge({
      projectId: project.id,
      kind: e.kind,
      topic,
      title: redact(e.title).slice(0, 120),
      text,
      rationale: e.rationale ? redact(e.rationale).slice(0, 600) : null,
      alternatives: e.alternatives ? redact(e.alternatives).slice(0, 400) : null,
      files,
      hashes,
      commit: project.gitEnabled ? await gitHead(project.path) : null,
      source: e.source,
      confidence: author === 'user' ? 'user' : author === 'system' ? 'verified' : 'reported',
      status: blocked ? 'stale' : 'active',
      statusNote: blocked ? `Conflicts with your decision "${rival!.title}". Not shared with the team unless you mark it still true.` : null,
      author
    })
    if (!blocked) for (const r of rivals) this.repo.setKnowledgeStatus(r.id, 'archived', `Superseded by "${saved.title}" (${e.source})`)
    return saved
  }

  /** Keeps a lasting wish from a message you sent. Yours, so no agent can overwrite it. */
  async rememberPreference(project: Project, text: string): Promise<KnowledgeEntry | null> {
    const found = preferenceIn(text)
    const wish = found && redact(found)
    return wish ? this.remember(project, { kind: 'convention', topic: `preference:${slug(wish).slice(0, 60)}`, title: wish.slice(0, 80), text: wish, files: [], source: 'Your message' }, 'user') : null
  }

  /** What you said in a message, if it settles something, and what that ends. Yours, so no agent can overwrite it. */
  async rememberSaid(project: Project, text: string): Promise<{ entry: KnowledgeEntry; said: string; replaced: string[] } | null> {
    const wish = preferenceIn(text)
    const stated = wish ?? decisionIn(text)
    if (!stated) return null
    // the note's key is made from these words too, so nothing secret can get in that way
    const said = redact(stated)
    const entry = wish
      ? await this.rememberPreference(project, text)
      : await this.remember(project, { kind: 'decision', topic: `decision:said:${slug(said)}`, title: said.slice(0, 80), text: said, files: [], source: 'Your message' }, 'user')
    if (!entry) return null
    const over = replacedBy(said)
    const replaced: string[] = []
    for (const x of this.repo.knowledge(project.id)) {
      if (x.id === entry.id || x.status === 'archived' || x.topic === PURPOSE || (x.author === 'system' && AUTO_KINDS.includes(x.kind)) || !['decision', 'architecture', 'convention', 'limitation'].includes(x.kind)) continue
      if (!(over && mentions(`${x.title} ${x.text}`, over)) && !(x.author === 'user' && contradicts(x.text, said))) continue
      // yours is replaced outright, and kept as history; the team's stops being shared until someone looks
      this.repo.setKnowledgeStatus(x.id, x.author === 'user' ? 'archived' : 'stale', x.author === 'user' ? `Superseded by "${said.slice(0, 80)}" (your message)` : `You later said: "${said.slice(0, 120)}"`)
      replaced.push(x.title)
    }
    return { entry, said, replaced }
  }

  /** What you answered when someone asked, so nobody has to ask again. Never what auto mode chose on your behalf. */
  async rememberAnswer(project: Project, question: string, answer: string, source: string): Promise<KnowledgeEntry | null> {
    const asked = redact(question).replace(/\s+/g, ' ').trim()
    const settled = this.repo.knowledge(project.id).find((e) => e.topic === `assumption:${slug(asked)}`)
    if (settled) this.repo.setKnowledgeStatus(settled.id, 'archived', 'You answered it')
    return this.remember(project, { kind: 'decision', topic: `decision:answer:${slug(asked)}`, title: asked.slice(0, 120), text: answer, files: [], source }, 'user')
  }

  /** What the plan goes ahead on because you weren't asked, or left it: open, and labelled so. */
  async rememberAssumption(project: Project, question: string, assumed: string, source: string): Promise<KnowledgeEntry | null> {
    const asked = redact(question).replace(/\s+/g, ' ').trim()
    if (this.answeredBefore(project.id, asked)) return null
    return this.remember(project, { kind: 'decision', topic: `assumption:${slug(asked)}`, title: asked.slice(0, 120), text: assumed, files: [], source })
  }

  /** What a product is for, from the first thing you asked. Later requests move the work on; they don't change this. */
  async rememberPurpose(project: Project, request: string): Promise<KnowledgeEntry | null> {
    if (!request.trim() || this.repo.knowledge(project.id).some((e) => e.topic === PURPOSE)) return null
    return this.remember(project, { kind: 'architecture', topic: PURPOSE, title: 'What this product is', text: request, files: [], source: 'Your first request' }, 'user')
  }

  /** If you've already answered this, your answer. */
  answeredBefore(projectId: string, question: string): string | null {
    return this.repo.knowledge(projectId).find((e) => e.topic.startsWith('decision:answer:') && e.status === 'active' && sameQuestion(e.title, question))?.text ?? null
  }

  /** What you've settled since a session last started: it won't see this in its opening any more. */
  decidedSince(projectId: string, since: number): string {
    const lines = this.repo.knowledge(projectId).filter((e) => e.author === 'user' && e.status === 'active' && e.updatedAt > since && (e.kind === 'decision' || e.topic.startsWith('preference:'))).map((e) => `- ${e.text.startsWith(e.title) ? '' : `${e.title}: `}${e.text}`.slice(0, 340))
    return lines.length ? ['Since this session started, the founder settled the following. It takes priority over anything earlier:', ...lines].join('\n') : ''
  }

  /**
   * What the code and earlier decisions say about planned work, before anyone starts: files much of the
   * project leans on, something like it that already exists, decisions it runs into, notes gone stale.
   */
  planRisks(projectId: string, tasks: Pick<Task, 'id' | 'key' | 'title' | 'description' | 'files' | 'dependsOn'>[]): string[] {
    const graph = sanitizeGraph(this.repo.meta<unknown>(`memory-graph:${projectId}`) ?? {})
    const raw = this.repo.meta<unknown>(`memory-symbols:${projectId}`)
    const symbols = raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    const entries = this.repo.knowledge(projectId)
    const out: string[] = []
    const symbolRows = this.repo.codeSymbols(projectId)
    const usersOf = (file: string) => new Set(symbolRows.filter((r) => r.file === file && r.exported).flatMap((r) => this.repo.codeRefFiles(projectId, r.name)).filter((f) => f !== file))
    const importers = (file: string) => [...new Set([...Object.entries(graph).filter(([f, deps]) => f !== file && deps.includes(file)).map(([f]) => f), ...usersOf(file)])]
    // planned side by side, but one's files use what the other's define: they should agree the interface first
    for (const a of tasks) {
      for (const b of tasks) {
        if (a === b || b.dependsOn.includes(a.id) || a.dependsOn.includes(b.id)) continue
        const used = a.files.find((f) => { const u = usersOf(f); return b.files.some((g) => [...u].some((x) => fileMatch(g, x))) })
        if (used) out.push(`${a.key} and ${b.key} run side by side, but ${b.key} uses what ${used} defines: a change there could break it.`)
      }
    }
    for (const t of tasks) {
      for (const f of t.files) {
        const who = importers(f)
        if (who.length >= 3) out.push(`${t.key} changes ${f}, which ${who.length} other files import, so a mistake there spreads.`)
      }
      if (/\b(add|build|create|implement|new|write)\b/i.test(t.title)) {
        const similar = existingFor(symbols, t.title, t.files, 2)
        if (similar.length) out.push(`${t.key} “${t.title}” may repeat what exists: ${similar.map((s) => `${s.name} in ${s.file}`).join(', ')}.`)
      }
      const said = words(`${t.title} ${t.description}`)
      for (const e of entries) {
        // standing preferences reach every agent anyway; they aren't a risk of this plan
        if (e.kind !== 'decision') continue
        const touched = t.files.some((f) => e.files.some((g) => fileMatch(f, g)))
        const close = [...words(e.title)].filter((w) => said.has(w)).length >= 2
        if (e.status === 'active' && (touched || (e.author === 'user' && close))) out.push(`${t.key} runs into an earlier decision: “${e.title}”.`)
        if (e.status === 'stale' && touched) out.push(`Notes about what ${t.key} touches are out of date: “${e.title}”.`)
      }
    }
    return [...new Set(out)].slice(0, 6)
  }

  /**
   * Brings the code map up to date in the background: only files whose size, time and content moved are parsed,
   * and it yields between batches, so a large repository is usable while it's still being read. Reads the project
   * folder only, never a task's working copy, so unfinished branches can't get mixed in.
   */
  syncGraph(project: Project): Promise<void> {
    const running = this.graphSync.get(project.id)
    if (running) {
      this.graphAgain.add(project.id)
      return running
    }
    const job = this.runGraphSync(project)
      .catch((err) => console.warn('[code map]', (err as Error).message))
      .finally(() => {
        this.graphSync.delete(project.id)
        if (this.graphAgain.delete(project.id)) void this.syncGraph(project)
      })
    this.graphSync.set(project.id, job)
    return job
  }

  private async runGraphSync(project: Project): Promise<void> {
    const started = Date.now()
    const all = (await listFiles(project.path, project.gitEnabled)).filter((f) => languageOf(f) && !f.split('/').some((p) => p === 'node_modules' || p === 'vendor' || p === 'dist' || p === 'build' || p === 'out' || p.startsWith('.')))
    const files = all.sort().slice(0, GRAPH_MAX_FILES)
    const known = this.repo.codeFiles(project.id)
    const present = new Set(files)
    for (const f of known.keys()) if (!present.has(f)) this.repo.dropCodeFile(project.id, f)
    let parsed = 0
    let busyMs = 0
    for (const f of files) {
      const t = Date.now()
      const c = changedSource(project.path, f, known.get(f))
      if (!c) {
        this.repo.dropCodeFile(project.id, f)
        continue
      }
      if (c.same) continue
      const out = c.text === null ? null : await parseSource(f, c.text).catch(() => null)
      this.repo.saveCodeFile(project.id, f, { mtime: c.mtime, size: c.size, hash: c.hash }, out)
      parsed++
      busyMs += Date.now() - t
      if (busyMs > 15) {
        busyMs = 0
        await new Promise((r) => setImmediate(r))
      }
    }
    const symbols = this.repo.codeSymbols(project.id).length
    this.repo.setMeta(`code-graph:${project.id}`, { files: files.length, symbols, parsed, ms: Date.now() - started, at: Date.now(), complete: all.length <= GRAPH_MAX_FILES } satisfies CodeGraphInfo)
  }

  /**
   * Where something on screen may come from. What the framework reports counts only if that file really is in
   * this project; everything else is labelled as a search result. Empty means nobody knows, which is fine.
   */
  async locate(project: Project, picked: Picked): Promise<SourceCandidate[]> {
    if (picked.kind !== 'element') return []
    const e = picked.element
    const out = new Map<string, SourceCandidate>()
    const root = project.path.replace(/\/$/, '')
    // the framework's first answer is where this element is written; the rest only contain it
    let first = true
    for (const r of e.reported) {
      const file = (r.file.startsWith(`${root}/`) ? r.file.slice(root.length + 1) : r.file).replace(/^\.?\//, '')
      if (isAbsolute(file) || file.startsWith('..') || !existsSync(join(root, file)) || out.has(file)) continue
      out.set(file, first ? { file, line: r.line, confidence: 'exact', why: `${r.framework} reported it` } : { file, line: r.line, confidence: 'likely', why: 'renders it, further up' })
      first = false
    }
    const rows = this.repo.codeSymbols(project.id)
    for (const name of e.components) {
      for (const r of rows.filter((x) => x.name === name && x.kind !== 'method' && !TEST_FILE.test(x.file)).slice(0, 2)) if (!out.has(r.file)) out.set(r.file, { file: r.file, line: r.line, confidence: 'likely', why: `defines ${name}` })
    }
    // what's on screen, as written in the code
    const needles = [e.id && `id="${e.id}"`, e.attrs['data-testid'], e.snapshot.text.length >= 4 && e.snapshot.text.length <= 80 ? e.snapshot.text : null, ...e.classes.filter((c) => c.length >= 4 && !/^(css|sc|jsx)-/.test(c)).slice(0, 3)].filter((x): x is string => !!x)
    if (needles.length && out.size < 5) {
      const files = (await listFiles(project.path, project.gitEnabled).catch(() => [] as string[])).filter((f) => /\.(html?|css|scss|vue|svelte|m?[jt]sx?)$/.test(f) && !TEST_FILE.test(f) && !f.split('/').some((p) => p === 'node_modules' || p === 'dist' || p === 'build' || p === 'out' || p.startsWith('.'))).slice(0, 1500)
      let read = 0
      for (const f of files) {
        if (out.size >= 5) break
        try {
          const text = readFileSync(join(root, f), 'utf8')
          const hit = needles.find((n) => text.includes(n))
          if (hit && !out.has(f)) out.set(f, { file: f, line: text.slice(0, text.indexOf(hit)).split('\n').length, confidence: 'likely', why: `contains “${hit.slice(0, 30)}”` })
        } catch {
          // unreadable: skip it
        }
        if (++read % 40 === 0) await new Promise((r) => setImmediate(r))
      }
    }
    return [...out.values()].slice(0, 5)
  }

  /** The code-map lines for this request, from what it names and the files it's about. Empty if the map has nothing. */
  codeMap(projectId: string, q: { text: string; files: string[] }, budget = 1400): string[] {
    const rows = this.repo.codeSymbols(projectId)
    if (!rows.length) return []
    const picked = new Map<string, MapRow>()
    const add = (r: (typeof rows)[number]) => picked.set(`${r.file}:${r.name}:${r.line}`, r as MapRow)
    const named = new Set(q.text.match(/[A-Za-z_$][\w$]{3,}/g) ?? [])
    for (const r of rows) if (r.kind !== 'route' && named.has(r.name) && /[A-Z_]/.test(r.name.slice(1))) add(r)
    for (const r of rows) if (r.kind === 'route' && q.text.includes(r.name.split(' ')[1])) add(r)
    for (const f of q.files) rows.filter((r) => fileMatch(f, r.file) && r.kind !== 'method').slice(0, 8).forEach(add)
    const byFile: Record<string, string[]> = {}
    for (const r of rows) if (r.kind !== 'route' && (r.exported || r.kind === 'class')) (byFile[r.file] ??= []).push(r.name)
    for (const x of existingFor(byFile, q.text, q.files)) {
      const r = rows.find((y) => y.file === x.file && y.name === x.name)
      if (r) add(r)
    }
    return buildCodeMap([...picked.values()].slice(0, 16), (name) => this.repo.codeRefFiles(projectId, name), (f) => TEST_FILE.test(f), budget)
  }

  /** Context for one prompt; records what was used so the founder can see it and savings can be measured. */
  async retrieve(project: Project, q: ContextQuery & { match?: boolean }): Promise<ContextPack> {
    await this.refresh(project).catch(() => undefined)
    // a task without planned files (direct, light, a plan's first look): match the request to the code
    if (!q.files.length && !q.targets && q.match !== false) q = { ...q, targets: await this.targets(project, q.text) }
    // just merged or just opened: a moment for the map to catch up, never a wait that holds up work
    const syncing = this.graphSync.get(project.id)
    if (syncing) await Promise.race([syncing, new Promise((r) => setTimeout(r, 1500))])
    const map = this.codeMap(project.id, q)
    const pack = buildContext(this.repo.knowledge(project.id), q, this.indexInfo(project.id).commit, this.repo.meta<unknown>(`memory-graph:${project.id}`) ?? {}, this.repo.meta<unknown>(`memory-uses:${project.id}`) ?? {}, map.length ? {} : (this.repo.meta<unknown>(`memory-symbols:${project.id}`) ?? {}))
    if (map.length) {
      const text = `${pack.text ? `${pack.text}\n` : ''}Code map (parsed from this project, not inferred by AI; start here instead of searching the tree, read these line ranges rather than whole files, and confirm in the source since lines may have moved):\n${map.join('\n')}`
      if (pack.ids.length) this.repo.markKnowledgeUsed(pack.ids)
      return { ...pack, text, chars: text.length }
    }
    if (pack.ids.length) this.repo.markKnowledgeUsed(pack.ids)
    return pack
  }

  // ── learning from history (deterministic) ──────────────────────

  lessons(projectId: string): Lesson[] {
    const tasks = this.repo.tasks(projectId)
    const out: Lesson[] = []
    // repeated validation failures, and whether they were resolved later
    const fails = new Map<string, { n: number; keys: Set<string>; last: string; resolved: boolean }>()
    const record = (cmd: string, ok: boolean, key: string, output: string) => {
      const c = fails.get(cmd) ?? { n: 0, keys: new Set(), last: '', resolved: false }
      if (!ok) {
        c.n++
        c.keys.add(key)
        c.last = output.split('\n').find((l) => /fail|error|not ok|assert/i.test(l))?.trim().slice(0, 140) ?? c.last
        c.resolved = false
      } else if (c.n) c.resolved = true
      fails.set(cmd, c)
    }
    for (const v of [...this.repo.validations(projectId, 500)].reverse()) {
      const t = tasks.find((x) => x.deliveryId === v.deliveryId)
      for (const c of v.checks) if (c.status === 'passed' || c.status === 'failed') record(c.command.replace(/\s+2>&1$/, ''), c.status === 'passed', v.trigger === 'manual' ? 'manual' : (t?.key ?? 'task'), c.output)
    }
    for (const [cmd, c] of fails) {
      if (c.n < 2) continue
      out.push({
        topic: `lesson:fail:${slug(cmd)}`,
        title: `\`${cmd}\` has failed ${c.n} times`,
        text: `Failed in ${[...c.keys].join(', ')}.${c.last ? ` Last failure: ${c.last}.` : ''} ${c.resolved ? 'It passed again afterwards.' : 'Not yet seen passing since.'} Run it before submitting.`,
        evidence: c.n,
        audience: 'agents'
      })
    }
    // files involved in merge conflicts more than once
    const conflicted = tasks.filter((t) => t.conflicts > 0)
    const hot = new Map<string, string[]>()
    for (const t of conflicted) for (const f of t.changedFiles.map((x) => x.replace(/^\S+\s+/, ''))) hot.set(f, [...(hot.get(f) ?? []), t.key])
    for (const [f, keys] of hot) {
      if (keys.length < 2) continue
      out.push({
        topic: `lesson:conflict:${slug(f)}`,
        title: `${f} causes merge conflicts`,
        text: `${f} was in conflicted merges in ${keys.join(', ')}. Autopia no longer runs two tasks that touch it at the same time; keep edits to it small.`,
        evidence: keys.length,
        audience: 'agents'
      })
    }
    // defects review QA measured in two or more results (graded reports only, so old false positives never become lessons)
    const recurring = new Map<string, { deliveries: Set<string>; f: QualityFinding }>()
    for (const r of this.repo.qualityReports(projectId, 200)) {
      if (r.status !== 'done' || !r.deliveryId) continue
      for (const f of r.findings) {
        if (f.certainty !== 'verified' || f.severity === 'info' || f.severity === 'low') continue
        const k = `${f.rule}|${f.file ?? ''}`
        const e = recurring.get(k) ?? { deliveries: new Set<string>(), f }
        e.deliveries.add(r.deliveryId)
        recurring.set(k, e)
      }
    }
    for (const [k, { deliveries, f }] of recurring) {
      if (deliveries.size < 2) continue
      out.push({
        topic: `lesson:quality:${slug(k)}`,
        title: `Review QA found "${f.rule}" in ${deliveries.size} results`,
        text: `${f.message}${f.file ? ` (${f.file})` : ''}${f.fix ? ` Fix: ${f.fix}` : ''} Check for it before submitting.`,
        evidence: deliveries.size,
        audience: 'agents'
      })
    }
    // recurring blockers and how they were resolved (from the founder's decisions)
    const failures = this.repo.approvalsOfKind(projectId, 'task_failed').filter((a) => a.status === 'resolved')
    const byCause = new Map<string, { n: number; retried: number; resolvedAfterRetry: number }>()
    for (const a of failures) {
      const cause = a.body.split('\n')[0].replace(/[0-9a-f]{7,}|\d+/g, '#').slice(0, 90)
      const c = byCause.get(cause) ?? { n: 0, retried: 0, resolvedAfterRetry: 0 }
      c.n++
      if (a.resolution === 'retry') {
        c.retried++
        if (a.taskId && tasks.find((t) => t.id === a.taskId)?.status === 'done') c.resolvedAfterRetry++
      }
      byCause.set(cause, c)
    }
    for (const [cause, c] of byCause) {
      if (c.n < 2) continue
      out.push({
        topic: `lesson:blocker:${slug(cause)}`,
        title: `Recurring blocker: ${cause}`,
        text: `Happened ${c.n} times; retried ${plural(c.retried, 'time')}, ${c.resolvedAfterRetry} of which then finished.`,
        evidence: c.n,
        audience: 'agents'
      })
    }
    // permission prompts that repeat: a founder-facing insight, never sent to agents
    const asks = new Map<string, number>()
    for (const a of this.repo.approvalsOfKind(projectId, 'permission')) {
      try {
        const subject = (JSON.parse(a.body) as { subject?: string }).subject?.replace(/\s+2>&1$/, '')
        if (subject) asks.set(subject, (asks.get(subject) ?? 0) + 1)
      } catch {
        // malformed approval body: ignore
      }
    }
    for (const [cmd, n] of asks) {
      if (n < 3) continue
      out.push({
        topic: `lesson:founder:ask:${slug(cmd)}`,
        title: `Claude Code asked to run \`${cmd}\` ${n} times`,
        text: 'Each ask pauses an agent until you answer. If your organization allows it, an administrator can add an allow rule for this command to the managed policy.',
        evidence: n,
        audience: 'founder'
      })
    }
    return out
  }

  /** Lessons for agents are kept as compact entries (updated in place, never duplicated). */
  async recordLessons(project: Project): Promise<void> {
    for (const l of this.lessons(project.id)) {
      if (l.audience !== 'agents') continue
      const files = l.topic.startsWith('lesson:conflict:') ? [l.title.split(' ')[0]] : []
      await this.remember(project, { kind: 'lesson', topic: l.topic, title: l.title, text: l.text, files, source: `history (${l.evidence} occurrences)` }, 'system')
    }
  }

  /** Files that repeatedly conflicted: the scheduler never runs two tasks touching them at once. */
  hotFiles(projectId: string): string[] {
    return this.lessons(projectId)
      .filter((l) => l.topic.startsWith('lesson:conflict:'))
      .map((l) => l.title.split(' ')[0])
  }

  /** Real medians per task size and kind; only used as a rough guide when n ≥ 3. */
  stats(projectId: string): HistoryStat[] {
    const tasks = this.repo.tasks(projectId).filter((t) => t.status === 'done' && t.startedAt && t.finishedAt)
    const runs = this.repo.allRuns(projectId)
    const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
    const groups = new Map<string, Task[]>()
    for (const t of tasks) groups.set(`${t.kind} · size ${t.size.toUpperCase()}`, [...(groups.get(`${t.kind} · size ${t.size.toUpperCase()}`) ?? []), t])
    return [...groups.entries()].map(([label, ts]) => {
      const rs = (t: Task) => runs.filter((r) => r.taskId === t.id)
      return {
        label,
        n: ts.length,
        medianMs: median(ts.map((t) => t.finishedAt! - t.startedAt!)),
        medianCostUsd: median(ts.map((t) => rs(t).reduce((n, r) => n + (r.costUsd ?? 0), 0))),
        medianTokens: median(ts.map((t) => rs(t).reduce((n, r) => n + (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0) + (r.outputTokens ?? 0), 0)).filter((n) => n > 0))
      }
    })
  }

  /**
   * Where the project stands, for a planner starting fresh (after a restart or a new request): open
   * blockers and work left unfinished. Read from Autopia's own records; nothing is inferred.
   */
  projectStatus(projectId: string): string {
    const tasks = this.repo.tasks(projectId)
    const open = this.repo.pendingApprovals(projectId).filter((a) => a.kind === 'task_failed' || a.kind === 'unverified' || a.kind === 'budget')
    const unfinished = tasks.filter((t) => t.status === 'failed' || t.status === 'interrupted' || (t.status === 'cancelled' && !t.finishedAt))
    const lines = [
      ...open.slice(0, 3).map((a) => `- Waiting on the founder: ${a.title}`),
      ...unfinished.filter((t) => !open.some((a) => a.taskId === t.id)).slice(0, 4).map((t) => `- Not finished: ${t.key} ${t.title} (${t.status}${t.lastError ? `: ${oneLine(t.lastError, 100)}` : ''})`)
    ]
    const accepted = this.repo.knowledge(projectId).filter((e) => e.kind === 'completed' && e.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((e) => e.title.slice(0, 70))
    if (accepted.length) lines.push(`- You accepted, most recent first: ${accepted.join('; ')}`.slice(0, 520))
    return lines.length ? ['Where the project stands (Autopia records; for awareness: plan only what the goal asks):', ...lines].join('\n') : ''
  }

  /** One line for the planner when there is enough history (n ≥ 3); otherwise nothing. */
  planningHistory(projectId: string): string {
    const lines = this.stats(projectId)
      .filter((s) => s.n >= 3 && s.medianMs)
      .map((s) => `${s.label}: median ${Math.round(s.medianMs! / 60000) || '<1'} min (n=${s.n})`)
    return lines.length ? `Observed in this project so far (a rough guide, not a rule): ${lines.join('; ')}.` : ''
  }

  /** Exploration calls per implementation run, with and without memory context (observational). */
  exploration(projectId: string): MemoryReport['exploration'] {
    const runs = this.repo.allRuns(projectId).filter((r) => r.kind === 'task' && r.purpose === 'work' && r.status === 'succeeded')
    // recount from the activity log when it is still there (summaries survive retention pruning)
    const calls = (runId: string, stored: number | null) => {
      const evs = this.repo.events(runId)
      return evs.length ? countExploration(evs) : (stored ?? 0)
    }
    const agg = (rs: typeof runs) => ({
      runs: rs.length,
      avgCalls: rs.length ? Math.round((rs.reduce((n, r) => n + calls(r.id, r.exploreCalls), 0) / rs.length) * 10) / 10 : 0,
      avgInputTokens: rs.some((r) => r.inputTokens != null)
        ? Math.round(rs.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0), 0) / rs.length)
        : null
    })
    return { withContext: agg(runs.filter((r) => (r.contextChars ?? 0) > 0)), without: agg(runs.filter((r) => !r.contextChars)) }
  }

  report(projectId: string): MemoryReport {
    const tasks = this.repo.tasks(projectId)
    return {
      index: this.indexInfo(projectId),
      entries: this.repo.knowledge(projectId),
      lessons: this.lessons(projectId),
      stats: this.stats(projectId),
      exploration: this.exploration(projectId),
      usage: this.repo
        .allRuns(projectId)
        .filter((r) => r.contextIds.length)
        .reverse()
        .slice(0, 30)
        .map((r) => ({
          runId: r.id,
          taskKey: tasks.find((t) => t.id === r.taskId)?.key ?? (r.kind === 'planning' ? 'Plan' : null),
          employeeId: r.employeeId,
          contextChars: r.contextChars ?? 0,
          contextIds: r.contextIds,
          exploreCalls: (() => {
            const evs = this.repo.events(r.id)
            return evs.length ? countExploration(evs) : r.exploreCalls
          })(),
          at: r.startedAt
        }))
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────

  /**
   * Keeps memory compact: archives stale or long-unused agent notes and trims old completion notes.
   * Founder-written notes are never archived or deleted here.
   */
  cleanup(projectId: string, settings: Settings): { archived: number; merged: number } {
    const now = Date.now()
    const cutoff = now - settings.memoryRetentionDays * 86_400_000
    let archived = 0
    let merged = 0
    const entries = this.repo.knowledge(projectId)
    const seen = new Map<string, KnowledgeEntry>()
    for (const e of entries) {
      if (e.author === 'user' || e.status === 'archived') continue
      // identical text under different topics: keep the most used
      const key = `${e.kind}|${e.text.trim().toLowerCase()}`
      const twin = seen.get(key)
      if (twin) {
        this.repo.setKnowledgeStatus(e.uses > twin.uses ? twin.id : e.id, 'archived')
        merged++
        continue
      }
      seen.set(key, e)
      const idle = Math.max(e.lastUsedAt ?? 0, e.updatedAt) < cutoff
      const staleLong = e.status === 'stale' && e.updatedAt < now - 14 * 86_400_000
      if (!AUTO_KINDS.includes(e.kind) && (idle || staleLong)) {
        this.repo.setKnowledgeStatus(e.id, 'archived')
        archived++
      }
    }
    // at most 40 completion notes and 30 handoffs stay active (the most recently useful ones)
    for (const [kind, max] of [
      ['completed', 40],
      ['handoff', 30]
    ] as const) {
      const active = this.repo
        .knowledge(projectId)
        .filter((e) => e.kind === kind && e.status === 'active' && e.author !== 'user')
        .sort((a, b) => Math.max(b.lastUsedAt ?? 0, b.updatedAt) - Math.max(a.lastUsedAt ?? 0, a.updatedAt))
      for (const e of active.slice(max)) {
        this.repo.setKnowledgeStatus(e.id, 'archived')
        archived++
      }
    }
    return { archived, merged }
  }
}

/** What the project says it depends on, by name. */
function dependencyNames(root: string): string[] {
  const read = (f: string) => {
    try {
      return readFileSync(join(root, f), 'utf8')
    } catch {
      return ''
    }
  }
  const out: string[] = []
  try {
    const pkg = JSON.parse(read('package.json') || '{}') as Record<string, Record<string, string> | undefined>
    out.push(...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}))
  } catch {
    // a broken manifest says nothing either way
  }
  for (const l of read('requirements.txt').split('\n')) {
    const name = /^[A-Za-z0-9][\w.-]*/.exec(l.trim())?.[0]
    if (name) out.push(name)
  }
  return [...new Set(out)]
}

/**
 * Repository surveying in a run: searches (Glob/Grep/LS), listing or printing commands, and reads of
 * files the run never edits. Reading the files you are about to change is work, not exploration.
 */
export function countExploration(events: RunEvent[]): number {
  const uses = events.filter((e) => e.kind === 'tool_use')
  const target = (e: RunEvent) => e.summary.replace(/^(Read|Edit|Write|MultiEdit)\s+/, '').trim()
  const edited = new Set(uses.filter((e) => e.toolName === 'Edit' || e.toolName === 'Write' || e.toolName === 'MultiEdit').map(target))
  return uses.filter(
    (e) =>
      e.toolName === 'Glob' ||
      e.toolName === 'Grep' ||
      e.toolName === 'LS' ||
      (e.toolName === 'Read' && !edited.has(target(e))) ||
      (e.toolName === 'Bash' && /^\$ (ls|find|tree|cat|head|grep|rg)\b/.test(e.summary))
  ).length
}
