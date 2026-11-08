import type { Employee } from './types'

/** Workstations in the office. The first four are the founding desks; the rest open as the team grows. */
/**
 * Seating is automatic: founders keep their own desks and hires fill the next desks in order, so
 * every furnished desk has someone at it. Returns employeeId -> deskId.
 */
export function seatingPlan(team: { id: string; deskId: string; hiredAt: number }[]): Map<string, string> {
  const founders = new Map(FOUNDING_TEAM.map((f) => [f.id, f.deskId]))
  const plan = new Map<string, string>()
  for (const e of team) if (founders.has(e.id)) plan.set(e.id, founders.get(e.id)!)
  const free = DESK_IDS.filter((d) => ![...plan.values()].includes(d))
  for (const e of [...team].filter((x) => !founders.has(x.id)).sort((a, b) => a.hiredAt - b.hiredAt)) {
    const desk = free.shift()
    if (desk) plan.set(e.id, desk)
  }
  return plan
}

export const DESK_IDS = ['desk-pm', 'desk-dev', 'desk-design', 'desk-qa', 'desk-5', 'desk-6', 'desk-7', 'desk-8', 'desk-9', 'desk-10'] as const

/** The founding team. Seeded into SQLite on first launch; ids are stable. */
export const FOUNDING_TEAM: Employee[] = [
  {
    id: 'emp-maya',
    role: 'pm',
    name: 'Maya Okafor',
    title: 'Project Manager',
    bio: 'Turns fuzzy goals into crisp plans. Keeps the team unblocked and the founder informed.',
    deskId: 'desk-pm',
    specialization: 'Delivery planning and coordination',
    capabilities: ['planning', 'docs', 'architecture'],
    kinds: [],
    hiredAt: 0,
    appearance: {
      skin: '#8d5a3b',
      hair: '#1d1410',
      hairStyle: 'curly',
      shirt: '#d9a440',
      shirtAccent: '#b8862b',
      pants: '#2c3446',
      shoes: '#1a1a1f',
      accessory: 'earrings',
      outfit: 'blazer',
      inner: '#f4f1ea'
    }
  },
  {
    id: 'emp-theo',
    role: 'lead_dev',
    name: 'Theo Lindqvist',
    title: 'Lead Developer',
    bio: 'Systems thinker. Writes the architecture, then writes the code that proves it.',
    deskId: 'desk-dev',
    specialization: 'Systems, backend and architecture',
    capabilities: ['architecture', 'backend', 'api', 'data', 'testing', 'devops', 'docs', 'performance', 'security'],
    kinds: ['code'],
    hiredAt: 0,
    appearance: {
      skin: '#f0c8a4',
      hair: '#c9a15a',
      hairStyle: 'short',
      shirt: '#33476e',
      shirtAccent: '#e8e8ea',
      pants: '#3a4f7a',
      shoes: '#eeeeef',
      accessory: 'headphones',
      outfit: 'hoodie',
      inner: '#33476e'
    }
  },
  {
    id: 'emp-ines',
    role: 'designer',
    name: 'Inés Navarro',
    title: 'UI/UX Designer',
    bio: 'Pixel-perfect and user-obsessed. Designs interfaces and ships the front-end herself.',
    deskId: 'desk-design',
    specialization: 'Interface design and front-end',
    capabilities: ['ui-design', 'frontend', 'styling', 'accessibility', 'docs'],
    kinds: ['design', 'code'],
    hiredAt: 0,
    appearance: {
      skin: '#d9a07a',
      hair: '#7a2f2a',
      hairStyle: 'bun',
      shirt: '#2f8f7f',
      shirtAccent: '#22695d',
      pants: '#3b3346',
      shoes: '#c96a43',
      accessory: 'glasses',
      outfit: 'sweater',
      inner: '#2f8f7f'
    }
  },
  {
    id: 'emp-kenji',
    role: 'qa',
    name: 'Kenji Watanabe',
    title: 'QA Engineer',
    bio: 'Breaks things on purpose so users never do. Trusts tests, not vibes.',
    deskId: 'desk-qa',
    specialization: 'Verification and test automation',
    capabilities: ['qa', 'testing', 'performance', 'security'],
    kinds: ['qa', 'code'],
    hiredAt: 0,
    appearance: {
      skin: '#e8bf95',
      hair: '#26221f',
      hairStyle: 'buzz',
      shirt: '#6a4f8a',
      shirtAccent: '#c9b8e0',
      pants: '#2a2a2e',
      shoes: '#3d3d44',
      accessory: 'beanie',
      outfit: 'overshirt',
      inner: '#1f1f24'
    }
  }
]
