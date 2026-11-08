// Where something the team knows came from. What you decided, what the repository shows, what a plan agreed and what a
// teammate recommended aren't equally binding, so nothing gets to read as more certain than it is.

import type { KnowledgeEntry } from './types'

export type KnowledgeOrigin = 'yours' | 'repo' | 'plan' | 'team' | 'assumption' | 'history'

const PLANNED = /^(contract:|direction:|architecture:structure$|decision:product-stack$|convention:design-direction$)/

export function originOf(e: Pick<KnowledgeEntry, 'author' | 'confidence' | 'kind' | 'topic'>): KnowledgeOrigin {
  if (e.author === 'user') return 'yours'
  if (e.topic.startsWith('assumption:')) return 'assumption'
  if (PLANNED.test(e.topic)) return 'plan'
  if (e.kind === 'lesson') return 'history'
  return e.confidence === 'verified' ? 'repo' : 'team'
}

export const ORIGIN_LABEL: Record<KnowledgeOrigin, string> = {
  yours: 'yours',
  repo: 'read from the repo',
  plan: 'agreed in the plan',
  team: 'team recommendation',
  assumption: 'assumption, not confirmed',
  history: 'from history'
}
