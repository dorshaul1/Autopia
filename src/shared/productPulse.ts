// The one line that says where a product stands, wherever it's shown. Decided from real state only, in order of what
// matters to you: what's waiting on you first, then what's ready, then what's happening.

import type { ProjectPhase } from './types'

export type PulseTone = 'attention' | 'danger' | 'ready' | 'live' | 'quiet' | 'done'

export interface Pulse {
  tone: PulseTone
  label: string
}

export function productPulse(x: { phase: ProjectPhase; paused: boolean; needsYou: number; working: number; toReview: number }): Pulse {
  if (x.needsYou) return { tone: 'attention', label: x.needsYou === 1 ? 'Needs you' : `${x.needsYou} things need you` }
  if (x.phase === 'failed') return { tone: 'danger', label: 'Stopped' }
  if (x.phase === 'blocked') return { tone: 'danger', label: 'Blocked' }
  if (x.toReview) return { tone: 'ready', label: 'Ready to review' }
  if (x.phase === 'awaiting_plan_approval') return { tone: 'attention', label: 'Plan ready' }
  if (x.paused) return { tone: 'quiet', label: 'Paused' }
  if (x.working) return { tone: 'live', label: x.working === 1 ? '1 teammate working' : `${x.working} teammates working` }
  if (x.phase === 'planning') return { tone: 'live', label: 'Planning' }
  if (x.phase === 'executing') return { tone: 'live', label: 'In progress' }
  if (x.phase === 'completed') return { tone: 'done', label: 'Up to date' }
  return { tone: 'quiet', label: 'Not started' }
}

/** Home's opening line, in plain words. Nothing is said that the state doesn't show. */
export function companyLine(x: { products: number; needsYou: number; toReview: number; working: number }): string {
  if (!x.products) return 'Tell your team what to build, and they’ll plan it, build it and show you the result.'
  const parts: string[] = []
  if (x.needsYou) parts.push(x.needsYou === 1 ? '1 thing needs you' : `${x.needsYou} things need you`)
  if (x.toReview) parts.push(x.toReview === 1 ? '1 result is ready to review' : `${x.toReview} results are ready to review`)
  if (x.working) parts.push(x.working === 1 ? '1 teammate is working' : `${x.working} teammates are working`)
  if (!parts.length) return 'All quiet. Nothing needs you right now.'
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

export function greeting(hour: number): string {
  return hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}
