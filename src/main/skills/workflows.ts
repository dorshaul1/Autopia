// Autopia's built-in engineering methods (original, concise) and deterministic routing.
// One primary method per task, at most two domain guides, nothing loaded "just in case".

import type { OfficeType } from '@shared/offices'
import type { Task } from '@shared/types'
import { ARCH_SIGNALS, SECURITY_SIGNALS } from '@shared/signals'

export { SECURITY_SIGNALS }

export type Route = 'debugging' | 'test-first' | 'spec' | 'security' | 'frontend' | 'react' | 'architecture'

export interface Workflow {
  id: string
  route: Route
  name: string
  /** primary = how to work (exactly one at most); domain = what to watch for (stackable, max two). */
  role: 'primary' | 'domain'
  when: string
  text: string
}

export const WORKFLOWS: Workflow[] = [
  {
    id: 'systematic-debugging',
    route: 'debugging',
    name: 'Systematic debugging',
    role: 'primary',
    when: 'Bug fixes, failing checks, revisions of broken behaviour',
    text: 'Debug systematically: reproduce the failure and read the exact error; find where behaviour diverges from what is expected; state the root cause in one sentence before changing code; make the smallest fix that addresses the cause, not the symptom; add or update a test that fails without the fix; re-run the checks. Never hide a failure with retries, broad try/catch, or skipped tests.'
  },
  {
    id: 'spec-first',
    route: 'spec',
    name: 'Spec first',
    role: 'primary',
    when: 'Large or complex single tasks',
    text: 'Before coding, settle the interface, data shapes, edge cases and how you will verify it. Build in small steps that each leave the project working, and run the relevant check after each meaningful step rather than once at the end. Put the key interface in your summary.'
  },
  {
    id: 'test-first',
    route: 'test-first',
    name: 'Test first',
    role: 'primary',
    when: 'Logic changes in projects that already have a test runner',
    text: 'Test first for logic: write or extend a focused test for the required behaviour (with at least one edge case), confirm it fails, then implement until it passes. Test behaviour through public functions, keep tests deterministic and fast, and follow the existing test layout. Skip this for pure styling or copy changes.'
  },
  {
    id: 'security-review',
    route: 'security',
    name: 'Security pass',
    role: 'domain',
    when: 'Authentication, user input, secrets, files, network, payments',
    text: 'Before you finish, do a security pass: validate and bound all external input; never build SQL, shell or HTML from untrusted strings (use parameters or escaping); keep secrets out of code, logs and the client; check authorization on every privileged path; prefer deny-by-default; avoid new dependencies for small things. Name any residual risk in your summary.'
  },
  {
    id: 'frontend-quality',
    route: 'frontend',
    name: 'Interface quality',
    role: 'domain',
    when: 'Interface and styling work',
    text: 'Interface quality: use the existing design tokens, spacing and type scale (or establish a small, consistent set); clear hierarchy with restraint, not decoration; real empty, loading and error states; responsive from 360px wide; semantic HTML, labelled controls, visible focus, sufficient contrast. No placeholder text or fake data presented as finished.'
  },
  {
    id: 'react-practices',
    route: 'react',
    name: 'React practices',
    role: 'domain',
    when: 'Projects using React',
    text: "React: small, pure components; derive values instead of duplicating state; effects only to sync with external systems; stable keys; memoize only where it measurably matters; colocate state; type props. Follow the project's existing routing, state and styling patterns."
  },
  {
    id: 'architecture-change',
    route: 'architecture',
    name: 'Structural change',
    role: 'domain',
    when: 'Migrations, schema, API or module boundary changes',
    text: 'For structural changes: stay backward compatible or migrate data explicitly; change one boundary at a time; update every call site in the same task; keep the build green; record a significant decision (what, why, alternatives) in your structured result.'
  }
]

const BUG_SIGNALS = /\b(bug|fix(es|ed)?|broken|crash\w*|error|fail(s|ing|ure)?|regression|doesn'?t work|not working|wrong|incorrect|exception)\b/i
const UI_FILES = /\.(css|scss|html|vue|svelte|tsx|jsx)$|(^|\/)(components?|pages|views|styles?)\/[^/]+\.(m?[jt]s)$/i

export interface RouteContext {
  /** A QA step in this request looks at it independently afterwards. */
  reviewedLater?: boolean
  office?: OfficeType
  /** The product's direction, when it has set one. */
  direction?: string
  imageTools?: string[]
  task: Pick<Task, 'title' | 'description' | 'kind' | 'size' | 'files'>
  /** Retry/fix runs and revisions of failures lean to debugging. */
  purpose: 'work' | 'fix' | 'retry' | 'revision'
  complexity: 'simple' | 'medium' | 'complex' | null
  hasTests: boolean
  react: boolean
}

export interface RouteDecision {
  primary: Route | null
  domains: Route[]
  risk: 'low' | 'normal' | 'high'
  reasons: string[]
  /** The reason for each route chosen, so each skill can say why it was picked. */
  why: Partial<Record<Route, string>>
}

/** Said in the title, it's interface work even before anyone has named a file. */
const UI_WORDS = /\b(ui|ux|interface|components?|pages?|screens?|layout|styl(e|es|ing)|css|buttons?|forms?|modals?|responsive|redesign|navbar|dashboard)\b/i
const REACT_WORDS = /\b(react|next\.?js|jsx|tsx|hooks?)\b/i

/** Deterministic routing: which method leads, which domain guides apply, and how risky the task is. */
export function routeTask(c: RouteContext): RouteDecision {
  const text = `${c.task.title}\n${c.task.description}`
  const reasons: string[] = []
  const why: RouteDecision['why'] = {}
  const say = (r: Route, reason: string) => {
    why[r] = reason
    reasons.push(reason)
  }
  const security = SECURITY_SIGNALS.test(text)
  const arch = ARCH_SIGNALS.test(text)
  const ui = c.task.kind === 'design' || c.task.files.some((f) => UI_FILES.test(f)) || UI_WORDS.test(c.task.title)
  const logicFiles = c.task.files.some((f) => /\.(m?[jt]s|py|go|rs)$/.test(f) && !/\.(tsx|jsx)$/.test(f))

  let primary: Route | null = null
  if (c.purpose === 'fix' || c.purpose === 'retry' || BUG_SIGNALS.test(c.task.title)) {
    primary = 'debugging'
    say('debugging', c.purpose === 'fix' ? 'a check failed' : 'the task describes a defect')
  } else if (c.task.size === 'l' || c.complexity === 'complex') {
    primary = 'spec'
    say('spec', 'large or complex task')
  } else if (c.task.kind === 'code' && c.hasTests && (logicFiles || /\b(function|logic|calculat\w*|pars\w*|validat\w*|test)\b/i.test(text))) {
    primary = 'test-first'
    say('test-first', 'logic change in a project with tests')
  }

  const domains: Route[] = []
  if (security) (domains.push('security'), say('security', 'touches security-sensitive areas'))
  if (arch && domains.length < 2) (domains.push('architecture'), say('architecture', 'structural change'))
  if (ui && (c.react || REACT_WORDS.test(c.task.title)) && domains.length < 2) (domains.push('react'), say('react', 'React interface work'))
  if (ui && domains.length < 2) (domains.push('frontend'), say('frontend', 'interface work'))

  const risk: RouteDecision['risk'] = security || arch || c.task.size === 'l' ? 'high' : c.task.kind === 'design' && !logicFiles ? 'low' : 'normal'
  return { primary, domains, risk, reasons, why }
}
