import type { Complexity, RoleId, Triage } from './types'

// Local, deterministic triage of a brief. Costs no tokens; the founder can always override it.

const AREAS: Record<string, RegExp> = {
  frontend: /\b(ui|ux|frontend|front-end|css|style|styling|layout|page|component|landing|design|theme|responsive|html|react|button|form)\b/i,
  backend: /\b(api|backend|back-end|server|endpoint|database|db|sql|schema|auth|authentication|queue|worker|cron)\b/i,
  data: /\b(migration|etl|pipeline|analytics|report|csv|import|export)\b/i,
  infra: /\b(deploy|docker|ci|cd|kubernetes|terraform|infrastructure|build system)\b/i,
  testing: /\b(tests?|testing|coverage|e2e|qa)\b/i,
  docs: /\b(readme|docs|documentation)\b/i
}

const HEAVY = /\b(architecture|refactor|rewrite|migrate|multi-?tenant|real-?time|integration|microservices?|end-to-end|full-?stack|platform|several|multiple|system)\b/gi

export function triageBrief(goal: string): Triage {
  const text = goal.trim()
  const words = text ? text.split(/\s+/).length : 0
  const items = text.split('\n').filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length
  const areas = Object.entries(AREAS)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k)
  const heavy = new Set((text.match(HEAVY) ?? []).map((m) => m.toLowerCase())).size

  const reasons: string[] = []
  let complexity: Complexity
  if (words > 160 || areas.length >= 4 || heavy >= 2 || items >= 6) {
    complexity = 'complex'
    if (words > 160) reasons.push(`long brief (${words} words)`)
    if (areas.length >= 4) reasons.push(`spans ${areas.length} areas: ${areas.join(', ')}`)
    if (heavy >= 2) reasons.push('architectural scope')
    if (items >= 6) reasons.push(`${items} listed requirements`)
  } else if (words <= 60 && areas.filter((a) => a !== 'docs').length <= 1 && items <= 3 && heavy === 0) {
    complexity = 'simple'
    reasons.push(words <= 25 ? 'short, focused brief' : `compact brief (${words} words)`)
    reasons.push(areas.length ? `single area: ${areas[0]}` : 'single deliverable')
  } else {
    complexity = 'medium'
    if (areas.length > 1) reasons.push(`touches ${areas.join(' + ')}`)
    if (items > 3) reasons.push(`${items} listed requirements`)
    if (heavy) reasons.push('some cross-cutting scope')
    if (!reasons.length) reasons.push(`moderate brief (${words} words)`)
  }

  const fe = AREAS.frontend.test(text)
  const be = AREAS.backend.test(text) || AREAS.data.test(text) || AREAS.infra.test(text)
  const role: RoleId = fe && !be ? 'designer' : 'lead_dev'
  // A focused medium change (one deliverable, at most two areas, no architectural scope) is cheaper and
  // no less safe as one owner who plans their own steps than as a planning meeting plus an approval wait.
  // Separate workstreams that could run in parallel are what make a team plan worth its overhead.
  const focused = complexity === 'medium' && words <= 120 && items <= 5 && heavy === 0 && !(fe && be)
  const strategy = complexity === 'simple' ? 'direct' : focused ? 'light' : 'plan'
  if (strategy === 'light') reasons.push('one deliverable: the owner plans the steps in-session')
  return { complexity, strategy, role, reasons }
}
