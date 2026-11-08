// What makes a product finished rather than just good-looking: the standard planners work to for each kind of
// product, and how to read what really happened when Autopia used the running app. The judging here is pure and
// decides without AI; main/quality/interactions.ts does the clicking.

import type { QualityFinding } from './types'

export type ProductKind = 'website' | 'saas' | 'game' | 'ai' | 'other'

const GAME = /\b(game|arcade|platformer|roguelike|puzzle|shooter|rpg|top[- ]down|sidescroller)\b/i
const AI = /\b(chat ?bot|llm|gpt|rag|ai (assistant|agent|tool|app|product|writer|tutor)|summari[sz]er|prompt)\b/i
const PAGE = /\b(landing page|home ?page|portfolio|blog|marketing (site|page)|brochure)\b/i
const APP = /\b(app|application|dashboard|tracker|crm|saas|platform|planner|manager|portal|admin|journal|booking|inventory)\b/i
const SITE = /\b(website|web ?site|site|shop|store|restaurant|caf[eé]|bakery|studio site)\b/i

/** Only the matching standard is sent to the planner, so nobody pays for the other three. */
export function productKindOf(goal: string, office: string): ProductKind {
  if (office === 'studio' || GAME.test(goal)) return 'game'
  if (office === 'lab' || AI.test(goal)) return 'ai'
  if (PAGE.test(goal)) return 'website'
  if (APP.test(goal)) return 'saas'
  if (SITE.test(goal)) return 'website'
  return 'other'
}

const STANDARD: Record<ProductKind, string> = {
  website:
    'This is a website. Write original copy in the brand\'s own voice, with specifics a real visitor needs (what it is, what it costs, where and how to get it). Navigation goes somewhere real. Every call to action ends somewhere real: a section, a working form with a confirmation, or a cart clearly labelled as a demo. Images are one family. A landing page stays a landing page: no accounts, checkout or admin unless asked.',
  saas:
    'This is an application. Sample data is one coherent world: the same people, projects and dates everywhere, and dashboard figures calculated from that data, never typed in. Creating, editing and removing really work and survive a reload. A first run with no data shows a useful empty state that says what to do next. Sample data is visibly labelled and easy to clear.',
  game:
    'This is a game. It has a complete loop: start, play, win or lose, and go again without reloading. Difficulty develops across distinct stages or waves, with enough variety that the second minute differs from the first. Every action has visible feedback, progress is visible, and the world\'s names and details fit its fantasy.',
  ai:
    'This is an AI product. Input and output are obvious, with useful examples to try. Empty input, input that is too long and a failed or slow model each get a clear message. It says plainly what is generated and how far to trust it. With no key configured it says so, or runs a demo clearly labelled as canned. Never connect a paid service silently.',
  other: ''
}

/** The planner's part: what complete means for this product, decided once, in the plan it already writes. */
export function completenessRules(kind: ProductKind): string {
  return [
    '- Fill `completeness`. `essentials`: what someone using this would expect to work though nobody said so, only what the request really implies (somewhere for "Buy" to lead, a tracker that survives a reload). `notBuilding`: tempting extras you are leaving out, because a small product stays small. `content`: the one set of fictional facts every screen uses (names, people, prices, places, dates).',
    '- Put that content in the foundation task as a real data file listed in `foundation.contracts`, so parallel tasks read the same facts instead of each inventing their own.',
    '- Invented details are fiction: never claim real customers, reviews, awards, press, partners, certifications or statistics unless the founder gave them. Keep sample content believable and label it as sample where a visitor could take it for real.',
    STANDARD[kind] ? `- ${STANDARD[kind]}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export interface ProbedPage {
  path: string
  status: number | null
  text: string
  mediaCount: number
  /** Long passages repeated word for word on this page. */
  repeats: { text: string; count: number }[]
  sameImage: { src: string; count: number } | null
}

export interface InteractionProbe {
  pages: ProbedPage[]
  /** Controls found on the pages visited, after skipping identical repeats and links to other sites. */
  total: number
  tried: number
  /** Tried, but the page changes by itself, so "nothing happened" can't be told apart. */
  unknown: number
  dead: { page: string; label: string; kind: 'control' | 'link' | 'looks-clickable' }[]
  crashed: { page: string; label: string; error: string }[]
  brokenLinks: { page: string; label: string; href: string; status: number }[]
  missingAnchors: { page: string; label: string; href: string }[]
  placeholderLinks: { page: string; label: string; href: string }[]
  forms: { page: string; label: string; outcome: 'works' | 'dead' | 'reloads' | 'unknown' }[]
  /** Text like "undefined" or "NaN" that appeared after using something. */
  junkAfter: { page: string; label: string; match: string }[]
  canvas: 'responds' | 'animated' | 'static' | null
  /** How the page behaved when its data couldn't load; null if it loads no data. */
  dataFailure: { blank: boolean; stuck: boolean; exception: string | null } | null
  /** Stopped at the time limit: what's untried is unknown, not fine. */
  ranOut: boolean
}

const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/
const PLACEHOLDERS: [RegExp, string][] = [
  [/lorem ipsum|dolor sit amet/i, 'lorem ipsum'],
  [/\b(john|jane) doe\b/i, 'a stand-in name'],
  [/\bacme\b/i, 'the stand-in name Acme'],
  [/\byour (company|name|brand|logo|title|headline|text|tagline)( goes)? here\b/i, 'fill-in-the-blank copy'],
  [/\b(placeholder|sample text|example text|dummy text|text goes here)\b/i, 'placeholder text'],
  [/\b(TODO:|FIXME|TBD)(?=\W|$)/, 'an unfinished note'],
  [/\b123[-. ]456[-. ]7890\b/, 'a stand-in phone number'],
  [/\b(asdf|foo bar|test test)\b/i, 'test text']
]
const NUMBERED = /\b(Item|Product|Feature|User|Project|Card|Title|Task|Plan|Option) ([1-9])\b/g
const UNFINISHED = /\b(coming soon|under construction|not implemented|work in progress)\b/i
const CLAIMS: [RegExp, string][] = [
  [/\b(trusted|used|loved|chosen) by (over |more than )?[\d,.]+[kKmM]?\+?/i, 'a customer count'],
  [/\b[\d,.]+[kKmM]?\+ (happy |satisfied )?(customers|users|clients|businesses|companies|teams)\b/i, 'a customer count'],
  [/\bas (seen|featured) (in|on)\b/i, 'press coverage'],
  [/\baward[- ]winning\b/i, 'an award'],
  [/\b[1-5](\.\d)? ?(out of 5|\/ ?5|stars?)\b/i, 'a star rating'],
  [/\b99\.\d+% uptime\b/i, 'an uptime figure'],
  [/\b(SOC ?2|HIPAA|ISO 27001|GDPR[- ]compliant|PCI[- ]compliant)\b/, 'a certification']
]
/** Saying it's a demo is what makes invented details honest. */
const LABELLED = /\b(demo|sample|fictional|fictitious|illustrative|made[- ]up|concept (site|project|brand)|not a real)\b/i

/** Every rule below: these describe the whole product, so a small change doesn't have to fix what it didn't touch. */
export const COMPLETENESS_RULES = new Set(['dead-control', 'click-error', 'broken-link', 'missing-anchor', 'placeholder-link', 'form-dead', 'form-reloads', 'junk-text', 'placeholder-copy', 'numbered-filler', 'unfinished-screen', 'invented-claim', 'repeated-copy', 'repeated-image', 'blank-route', 'game-no-response', 'no-error-state'])

const some = (items: string[], n = 4) => `${items.slice(0, n).map((x) => `“${x}”`).join(', ')}${items.length > n ? ` and ${items.length - n} more` : ''}`

/**
 * What happened, as findings. `given` is what the person themselves wrote: words and numbers from the brief are
 * theirs, never placeholders or invented claims. Every finding comes from something measured on the running app.
 */
export function completenessFindings(p: InteractionProbe, given = ''): QualityFinding[] {
  const out: QualityFinding[] = []
  const add = (rule: string, severity: 'high' | 'medium', page: string | null, message: string, fix: string, evidence: string) => out.push({ dimension: 'visual', severity, rule, message, fix, file: page, line: null, width: null, count: 1, certainty: 'verified', evidence })
  const byPage = <T extends { page: string }>(items: T[]) => {
    const m = new Map<string, T[]>()
    for (const i of items) m.set(i.page, [...(m.get(i.page) ?? []), i])
    return [...m.entries()]
  }

  for (const [page, list] of byPage(p.dead)) {
    const looks = list.filter((d) => d.kind === 'looks-clickable').map((d) => d.label)
    const real = list.filter((d) => d.kind !== 'looks-clickable').map((d) => d.label)
    if (real.length) add('dead-control', 'medium', page, `${real.length === 1 ? 'A control does' : `${real.length} controls do`} nothing when used: ${some(real)}.`, 'Make each one do what it says, or remove it. A link needs a real destination; a button needs a real outcome the person can see.', 'Clicked twice on a freshly loaded page: nothing on screen changed, and no data was sent or saved.')
    if (looks.length) add('dead-control', 'medium', `${page} (looks clickable)`, `${looks.length === 1 ? 'Something looks' : `${looks.length} things look`} clickable but ${looks.length === 1 ? 'does' : 'do'} nothing: ${some(looks)}.`, 'Give it a real outcome, or remove the pointer cursor so it stops promising one.', 'It shows a pointer cursor; clicking it twice changed nothing.')
  }
  for (const [page, list] of byPage(p.crashed)) add('click-error', 'high', page, `Using ${some([...new Set(list.map((c) => c.label))], 3)} throws an error.`, 'Fix the error so the action completes.', list[0].error.slice(0, 300))
  for (const [page, list] of byPage(p.brokenLinks)) add('broken-link', 'high', page, `${list.length === 1 ? 'A link leads' : `${list.length} links lead`} to a page that doesn't exist: ${some(list.map((l) => `${l.label} → ${l.href}`), 3)}.`, 'Build the page it promises, point it somewhere real, or remove the link.', list.map((l) => `${l.href} answered ${l.status}`).join(', ').slice(0, 300))
  for (const [page, list] of byPage(p.missingAnchors)) add('missing-anchor', 'medium', page, `${list.length === 1 ? 'A link points' : `${list.length} links point`} to a section that isn't there: ${some(list.map((l) => `${l.label} → ${l.href}`), 3)}.`, 'Give the section that id, or change the link.', 'No element on the page has that id, and clicking changed nothing.')
  for (const [page, list] of byPage(p.placeholderLinks)) add('placeholder-link', 'medium', page, `${some(list.map((l) => l.label), 3)} ${list.length === 1 ? 'links' : 'link'} to a stand-in address (${list[0].href}).`, 'Point it at something real, or remove it.', list.map((l) => l.href).join(', ').slice(0, 300))
  for (const f of p.forms) {
    if (f.outcome === 'dead') add('form-dead', 'high', f.page, `The form ${f.label ? `“${f.label}” ` : ''}does nothing when submitted.`, 'Handle it for real: save or send the data and confirm it. If nothing can be sent yet, say so honestly after submit.', 'Filled in with valid values and submitted: no message, no change, nothing sent or saved.')
    if (f.outcome === 'reloads') add('form-reloads', 'high', f.page, `The form ${f.label ? `“${f.label}” ` : ''}only reloads the page and loses what was typed.`, 'Handle the submit: keep the data, and confirm it to the person.', 'It has no action and nothing handles its submit.')
  }
  for (const j of p.junkAfter) add('junk-text', 'high', j.page, `Using “${j.label}” shows “${j.match}” on screen.`, 'Fix the missing value behind it.', `After using “${j.label}” the page text contained ${j.match}.`)

  const has = (re: RegExp) => re.test(given)
  const everything = p.pages.map((x) => x.text).join('\n')
  const labelled = LABELLED.test(everything)
  for (const page of p.pages) {
    const text = page.text
    const junk = text.match(JUNK)
    if (junk) add('junk-text', 'high', page.path, `The page shows “${junk[0]}” where a value should be.`, 'Fix the missing value behind it.', `Rendered text: …${text.slice(Math.max(0, junk.index! - 40), junk.index! + 40)}…`)
    if (page.status === null || page.status < 400) if (text.length < 3 && page.mediaCount === 0) add('blank-route', 'high', page.path, 'This page is blank.', 'Find out why nothing renders here.', 'No text or images were rendered.')
    for (const [re, what] of PLACEHOLDERS) {
      const m = text.match(re)
      if (m && !has(re)) add('placeholder-copy', 'high', page.path, `The page still shows ${what}: “${m[0]}”.`, 'Replace it with real content for this product.', `Rendered text: …${text.slice(Math.max(0, m.index! - 40), m.index! + 60)}…`)
    }
    const numbered = new Map<string, Set<string>>()
    for (const m of text.matchAll(NUMBERED)) numbered.set(m[1], (numbered.get(m[1]) ?? new Set()).add(m[2]))
    for (const [word, nums] of numbered) if (nums.size >= 2) add('numbered-filler', 'high', page.path, `The page uses numbered filler such as “${word} ${[...nums][0]}”.`, 'Give each one a real name that fits this product.', `${word} ${[...nums].slice(0, 4).join(', ')}`)
    const late = text.match(UNFINISHED)
    if (late && !has(UNFINISHED)) add('unfinished-screen', 'medium', page.path, `The page says “${late[0]}”.`, 'Finish it or remove the section. If it is deliberately for later, leave it out of the interface.', `Rendered text: …${text.slice(Math.max(0, late.index! - 40), late.index! + 60)}…`)
    if (!labelled) {
      const claimed = new Set<string>()
      for (const [re, what] of CLAIMS) {
        const m = text.match(re)
        if (m && !has(re) && !claimed.has(what) && claimed.add(what)) add('invented-claim', 'medium', page.path, `The page states ${what} (“${m[0]}”) with nothing saying it's fictional.`, 'Remove it, or label the content as sample. Real claims only come from the person who owns the business.', `Rendered text: …${text.slice(Math.max(0, m.index! - 40), m.index! + 60)}…`)
      }
    }
    for (const r of page.repeats.slice(0, 1)) add('repeated-copy', 'medium', page.path, `The same text appears ${r.count} times: “${r.text.slice(0, 70)}”.`, 'Write something specific for each one.', `${r.count} identical passages on one page.`)
    if (page.sameImage) add('repeated-image', 'medium', page.path, `The same image is used ${page.sameImage.count} times.`, 'Give each item its own image, or remove them.', page.sameImage.src.slice(-120))
  }

  if (p.canvas === 'static') add('game-no-response', 'high', p.pages[0]?.path ?? null, 'The canvas stays frozen: it does not animate or respond to clicks and keys.', 'Check the game starts, and that its input and loop are running.', 'Identical frames before and after clicking and pressing Enter, Space and the arrow keys.')
  const d = p.dataFailure
  if (d && (d.blank || d.stuck || d.exception)) add('no-error-state', 'medium', p.pages[0]?.path ?? null, d.blank ? 'When its data can’t load, the page goes blank.' : d.stuck ? 'When its data can’t load, the page stays on “loading” forever.' : 'When its data can’t load, the page throws an error instead of saying so.', 'Catch the failure and show what happened, with a way to try again.', d.exception ? d.exception.slice(0, 300) : 'Loaded with its data requests failing.')
  const seen = new Set<string>()
  return out.filter((f) => {
    const key = `${f.rule}|${f.file}|${f.message}`
    return !seen.has(key) && !!seen.add(key)
  })
}

/** One line of evidence for what was really exercised, so nobody reads silence as "all fine". */
export function probeSummary(p: InteractionProbe): string {
  const parts = [`Used ${p.tried} of ${p.total} controls on ${p.pages.length} page${p.pages.length === 1 ? '' : 's'}`]
  if (p.forms.length) parts.push(`submitted ${p.forms.length} form${p.forms.length === 1 ? '' : 's'}`)
  if (p.unknown) parts.push(`${p.unknown} couldn't be judged because the page changes by itself`)
  if (p.canvas) parts.push(`canvas ${p.canvas}`)
  if (p.ranOut) parts.push('stopped at the time limit')
  return parts.join(', ')
}
