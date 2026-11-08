// Office types: the kind of company a project lives in. Each type has its own office (layout and art,
// in the renderer), its own team roster with specialized roles, and its own development guidance for
// the same Claude Code orchestration. Every project gets an independent team, even when two projects
// share a type. Adding a type means adding an entry here plus a layout and art pack.

import { appearanceFor } from './capabilities'
import { FOUNDING_TEAM } from './roster'
import type { Appearance, Capability, Employee, RoleId, TaskKind } from './types'

export type OfficeType = 'startup' | 'studio' | 'lab'

export interface RoleTemplate {
  role: RoleId
  title: string
  specialization: string
  bio: string
  capabilities: Capability[]
  kinds: TaskKind[]
  deskId: string
  /** Cut and signature accessory, so each role reads at a glance (colours vary per person). */
  look: Pick<Appearance, 'outfit' | 'accessory'>
}

export interface OfficeTypeDef {
  id: OfficeType
  name: string
  /** One line for the picker. */
  tagline: string
  /** What it is for. */
  purpose: string
  /** Rooms you'll find there (shown in the picker). */
  highlights: string[]
  /** UI accent for cards and switcher chips. */
  accent: string
  roles: RoleTemplate[]
  names: string[]
  /** Shirt colours that fit the studio's look. */
  shirts: string[]
  /** Extra guidance for teammates' Claude Code sessions in this kind of company. */
  workGuidance: string
  /** Extra guidance for the planner. */
  planGuidance: string
}

const startupRoles: RoleTemplate[] = [
  { role: 'pm', title: 'Tech Lead', specialization: 'Planning, architecture and delivery', bio: 'Breaks goals into a plan the team can ship, and keeps the architecture honest.', capabilities: ['planning', 'architecture', 'docs'], kinds: [], deskId: 'desk-pm', look: { outfit: 'blazer', accessory: 'earrings' } },
  { role: 'lead_dev', title: 'Full-Stack Developer', specialization: 'End-to-end features', bio: 'Comfortable anywhere in the stack; owns features from database to button.', capabilities: ['architecture', 'backend', 'api', 'data', 'frontend', 'testing', 'devops', 'docs'], kinds: ['code'], deskId: 'desk-dev', look: { outfit: 'hoodie', accessory: 'headphones' } },
  { role: 'engineer', title: 'Frontend Developer', specialization: 'Browser apps and interaction', bio: 'Turns designs into fast, accessible interfaces.', capabilities: ['frontend', 'styling', 'accessibility', 'testing'], kinds: ['code', 'design'], deskId: 'desk-5', look: { outfit: 'overshirt', accessory: 'none' } },
  { role: 'engineer', title: 'Backend Developer', specialization: 'Services, APIs and data', bio: 'Builds reliable services and the tests that keep them that way.', capabilities: ['backend', 'api', 'data', 'security', 'performance', 'testing'], kinds: ['code'], deskId: 'desk-6', look: { outfit: 'sweater', accessory: 'glasses' } },
  { role: 'designer', title: 'UI/UX Designer', specialization: 'Interface design and front-end', bio: 'User-obsessed; designs the interface and ships the front-end too.', capabilities: ['ui-design', 'frontend', 'styling', 'accessibility', 'docs'], kinds: ['design', 'code'], deskId: 'desk-design', look: { outfit: 'sweater', accessory: 'glasses' } },
  { role: 'qa', title: 'QA Engineer', specialization: 'Verification and test automation', bio: 'Breaks things on purpose so users never do.', capabilities: ['qa', 'testing', 'performance', 'security'], kinds: ['qa', 'code'], deskId: 'desk-qa', look: { outfit: 'overshirt', accessory: 'beanie' } }
]

const studioRoles: RoleTemplate[] = [
  { role: 'pm', title: 'Game Director', specialization: 'Vision, scope and the vertical slice', bio: 'Keeps the game fun and the scope shippable; plans in playable milestones.', capabilities: ['planning', 'game-design', 'architecture', 'docs'], kinds: [], deskId: 'desk-pm', look: { outfit: 'blazer', accessory: 'headphones' } },
  { role: 'lead_dev', title: 'Gameplay Programmer', specialization: 'Game loop, input, physics and feel', bio: 'Makes it move right: fixed timesteps, tight controls, no dropped frames.', capabilities: ['gameplay', 'architecture', 'performance', 'frontend', 'testing'], kinds: ['code'], deskId: 'desk-dev', look: { outfit: 'hoodie', accessory: 'headphones' } },
  { role: 'engineer', title: 'Game Systems Designer', specialization: 'Rules, economy and balance', bio: 'Designs the systems and writes them as tunable, testable code.', capabilities: ['game-design', 'gameplay', 'data', 'testing'], kinds: ['code'], deskId: 'desk-5', look: { outfit: 'sweater', accessory: 'glasses' } },
  { role: 'engineer', title: 'World Designer', specialization: 'Worlds, maps and atmosphere', bio: 'Builds places worth exploring, from tilemaps to lighting.', capabilities: ['level-design', 'game-art', 'game-design'], kinds: ['design', 'code'], deskId: 'desk-6', look: { outfit: 'overshirt', accessory: 'beanie' } },
  { role: 'engineer', title: 'Level Designer', specialization: 'Encounters, pacing and difficulty', bio: 'Shapes every level so it teaches, challenges and rewards.', capabilities: ['level-design', 'gameplay', 'game-design', 'testing'], kinds: ['code', 'design'], deskId: 'desk-7', look: { outfit: 'hoodie', accessory: 'none' } },
  { role: 'designer', title: 'Game Artist', specialization: 'Sprites, UI and visual effects', bio: 'Pixels, palettes and juice; makes the game look like it feels.', capabilities: ['game-art', 'ui-design', 'styling', 'frontend'], kinds: ['design', 'code'], deskId: 'desk-design', look: { outfit: 'overshirt', accessory: 'earrings' } },
  { role: 'qa', title: 'Game QA Engineer', specialization: 'Playtesting, edge cases and performance', bio: 'Plays it a thousand ways and writes down exactly how it broke.', capabilities: ['qa', 'testing', 'gameplay', 'performance'], kinds: ['qa', 'code'], deskId: 'desk-qa', look: { outfit: 'hoodie', accessory: 'beanie' } }
]

const labRoles: RoleTemplate[] = [
  { role: 'pm', title: 'AI Architect', specialization: 'System design for AI products', bio: 'Decides where the model belongs, where it does not, and how to prove it works.', capabilities: ['planning', 'architecture', 'llm', 'docs'], kinds: [], deskId: 'desk-pm', look: { outfit: 'blazer', accessory: 'glasses' } },
  { role: 'lead_dev', title: 'AI Engineer', specialization: 'LLM features, agents and tool use', bio: 'Ships model-powered features behind clean adapters, with timeouts and fallbacks.', capabilities: ['llm', 'backend', 'api', 'architecture', 'frontend', 'ui-design', 'testing', 'security'], kinds: ['code', 'design'], deskId: 'desk-dev', look: { outfit: 'hoodie', accessory: 'headphones' } },
  { role: 'engineer', title: 'ML Engineer', specialization: 'Models, training and inference', bio: 'Trains what should be trained and serves it fast.', capabilities: ['ml', 'data', 'performance', 'testing'], kinds: ['code'], deskId: 'desk-5', look: { outfit: 'sweater', accessory: 'none' } },
  { role: 'engineer', title: 'Data Engineer', specialization: 'Pipelines, datasets and quality', bio: 'Moves data reliably and can tell you where every row came from.', capabilities: ['data-pipelines', 'data', 'backend', 'testing'], kinds: ['code'], deskId: 'desk-6', look: { outfit: 'overshirt', accessory: 'glasses' } },
  { role: 'engineer', title: 'Research Engineer', specialization: 'Prompting, retrieval and experiments', bio: 'Runs the experiment before the debate, and writes up what it showed.', capabilities: ['llm', 'ml', 'evaluation', 'docs'], kinds: ['code'], deskId: 'desk-7', look: { outfit: 'sweater', accessory: 'glasses' } },
  { role: 'engineer', title: 'MLOps Engineer', specialization: 'Serving, monitoring and reproducibility', bio: 'Makes models deployable, observable and boring to run.', capabilities: ['mlops', 'devops', 'performance', 'security'], kinds: ['code'], deskId: 'desk-8', look: { outfit: 'overshirt', accessory: 'beanie' } },
  { role: 'qa', title: 'AI Evaluation Engineer', specialization: 'Evals, regressions and safety checks', bio: 'Turns “it seems better” into a number you can trust.', capabilities: ['evaluation', 'qa', 'testing', 'llm'], kinds: ['qa', 'code'], deskId: 'desk-qa', look: { outfit: 'blazer', accessory: 'earrings' } }
]

export const OFFICE_TYPES: Record<OfficeType, OfficeTypeDef> = {
  startup: {
    id: 'startup',
    name: 'Tech Startup',
    tagline: 'A bright, warm software company',
    purpose: 'Websites, SaaS products, web apps, APIs and dashboards.',
    highlights: ['Engineering floor', 'Glass boardroom', 'Design studio', 'Coffee bar', 'Game corner'],
    accent: '#F7C66B',
    roles: startupRoles,
    names: ['Ava Brooks', 'Ethan Cole', 'Zoe Martin', 'Liam Novak', 'Chloe Dubois', 'Arjun Mehta', 'Grace Kim', 'Felix Wagner', 'Nora Quinn', 'Omar Haddad'],
    shirts: ['#3f6f8f', '#8a4f7d', '#4f7a4a', '#b6603f', '#5a5f9e', '#2f7c7c', '#9a7a2f'],
    workGuidance: '',
    planGuidance: ''
  },
  studio: {
    id: 'studio',
    name: 'Game Studio',
    tagline: 'A creative indie game company',
    purpose: '2D and 3D games, simulations, management games and interactive experiences.',
    highlights: ['Dev pit with playtest screens', 'Concept-art studio', 'Greenlight room', 'Arcade & couch co-op', 'Level-design war room'],
    accent: '#FF5CA8',
    roles: studioRoles,
    names: ['Rio Takahashi', 'Zara Blake', 'Milo Petrov', 'Nia Okonkwo', 'Kai Andersen', 'Luna Ferreira', 'Ezra Cohen', 'Yuki Mori', 'Tomas Silva', 'Ivy Laurent', 'Sami Virtanen', 'Juno Park'],
    shirts: ['#e0457b', '#7b4fd6', '#1fa3a3', '#e8833a', '#3a6fe0', '#2e2a3d', '#b93a8f'],
    workGuidance: [
      'This is a game studio. Build games the way good studios do:',
      '- Find the engine or framework the project already uses (Phaser, PixiJS, Three.js, Godot, Unity, plain canvas, …) and follow its conventions; if there is none yet, pick the lightest one that fits.',
      '- Keep a fixed-timestep loop that separates input, update and render; keep tuning values (speeds, costs, timers) in one config, not scattered through code.',
      '- Put game rules, scoring, collision and progression in plain logic that can be tested without a renderer, and add deterministic tests for them (seeded randomness).',
      '- Keep assets organized (e.g. assets/sprites, assets/audio) and reference them by name; never block the frame on loading.',
      '- Aim for something playable early (a vertical slice), and say in your summary how to run and play it.'
    ].join('\n'),
    planGuidance: 'Plan in playable milestones: first a vertical slice (core loop, controls, one level), then systems, content and polish. Give gameplay code to the Gameplay Programmer, rules and balance to the Game Systems Designer, maps and worlds to the World and Level Designers, sprites, UI and effects to the Game Artist, and playtesting to Game QA.'
  },
  lab: {
    id: 'lab',
    name: 'AI Lab',
    tagline: 'A cutting-edge AI research and engineering company',
    purpose: 'AI-powered products, agents, automation, data pipelines and ML applications.',
    highlights: ['Research floor', 'Data-visualization wall', 'Model experimentation bay', 'Server room', 'Evaluation room'],
    accent: '#5CE1E6',
    roles: labRoles,
    names: ['Ada Whitfield', 'Ravi Menon', 'Elena Kovacs', 'Samir Haddad', 'Mei Chen', 'Noah Fischer', 'Leila Rahimi', 'Owen Park', 'Iris Varga', 'Tariq Aziz', 'Freya Holm', 'Dev Patel'],
    shirts: ['#2f5d7c', '#3d4a8f', '#1f7a72', '#5b6b7a', '#6a4f8a', '#24323f', '#3f7f9f'],
    workGuidance: [
      'This is an AI lab. Build AI features the way careful teams do:',
      '- Never put API keys or secrets in code or commits; read them from the environment and document the variable names.',
      '- Put every model or provider call behind one small adapter with a timeout, retries with backoff and clear errors, so it can be swapped or mocked.',
      '- Tests never call a live model: use recorded fixtures or a fake adapter so they are deterministic and free.',
      '- Keep prompts in versioned files or constants, not inline strings scattered through code.',
      '- For model-powered behaviour, add a small evaluation set (inputs with expected properties) and a script that scores it, and report the score.',
      '- For data work, validate inputs and keep pipelines re-runnable (idempotent) with clear lineage.'
    ].join('\n'),
    planGuidance: 'Plan so it can be measured: data and adapters first, then the model-powered feature, then an evaluation set and regression check. Give LLM features to the AI Engineer, models to the ML Engineer, pipelines to the Data Engineer, prompting and retrieval experiments to the Research Engineer, serving and monitoring to MLOps, and evals to the AI Evaluation Engineer.'
  }
}

export const OFFICE_ORDER: OfficeType[] = ['startup', 'studio', 'lab']

export const isOfficeType = (v: unknown): v is OfficeType => v === 'startup' || v === 'studio' || v === 'lab'

const GAME = /\b(game|games|gaming|gameplay|platformer|roguelike|rpg|puzzle|arcade|shooter|simulat\w*|tycoon|idle game|level|sprite|phaser|godot|unity|unreal|pixi|three\.js|multiplayer|leaderboard|player)\b/i
const AI = /\b(ai|a\.i\.|llm|gpt|claude|chatbot|agent\w*|automation|automate|machine learning|ml|model training|neural|embedding\w*|rag|retrieval|classif\w*|recommend\w*|sentiment|nlp|vision model|prediction|data pipeline|etl|scrap\w*|summari[sz]\w*|transcri\w*)\b/i

/** The office that fits what you want to build, and why (deterministic, from your words). */
export function recommendOffice(goal: string): { type: OfficeType; reason: string } {
  const game = goal.match(new RegExp(GAME, 'gi'))?.length ?? 0
  const ai = goal.match(new RegExp(AI, 'gi'))?.length ?? 0
  if (game && game >= ai) return { type: 'studio', reason: 'It sounds like a game, so a game studio with gameplay, level and art specialists fits best.' }
  if (ai) return { type: 'lab', reason: 'It is AI or automation work, so an AI lab with model, data and evaluation specialists fits best.' }
  return { type: 'startup', reason: 'It is general software, so a tech startup with web, backend and design specialists fits best.' }
}

function hash(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#9a6440', '#6d442b', '#f4d7bd', '#d9a07a', '#8d5a3b']
const HAIRS = ['#1f1612', '#3a2a1f', '#6b4428', '#a8743f', '#d6b16a', '#8e3b2f', '#2c2f3a', '#c9c3bd']
const STYLES: Appearance['hairStyle'][] = ['short', 'long', 'curly', 'bun', 'buzz']

/**
 * A new, independent team for one project: the office type's roles, staffed by people whose names
 * and looks come deterministically from the project id (so the same project always has the same
 * team, and two projects of one type have different people).
 */
export function teamFor(type: OfficeType, projectId: string, now: number): Employee[] {
  const def = OFFICE_TYPES[type]
  // the Tech Startup is the original Autopia office: its own copy of the original people (same look and
  // personality, separate memory), plus a front-end and a back-end developer
  if (type === 'startup') {
    const tag = projectId.slice(0, 8)
    const founder = (id: string, title?: string) => {
      const f = FOUNDING_TEAM.find((x) => x.id === id)!
      return { ...f, id: `${f.id}@${tag}`, title: title ?? f.title, hiredAt: now }
    }
    const extra = (i: number, name: string): Employee => {
      const r = def.roles[i]
      return { id: `emp-${tag}-${i}`, role: r.role, name, title: r.title, bio: r.bio, deskId: r.deskId, specialization: r.specialization, capabilities: r.capabilities, kinds: r.kinds, hiredAt: now + i, appearance: { ...appearanceFor(name), outfit: r.look.outfit, accessory: r.look.accessory } }
    }
    return [founder('emp-maya', 'Tech Lead'), founder('emp-theo', 'Full-Stack Developer'), extra(2, 'Priya Raman'), extra(3, 'Lucas Moreau'), founder('emp-ines'), founder('emp-kenji')]
  }
  const seed = hash(projectId)
  const names = [...def.names].sort((a, b) => hash(`${a}${seed}`) - hash(`${b}${seed}`))
  return distinctLooks(def.roles.map((r, i) => {
    const name = names[i % names.length]
    const h = hash(`${projectId}:${name}`)
    const shirt = def.shirts[(h >>> 3) % def.shirts.length]
    return {
      id: `emp-${projectId.slice(0, 8)}-${i}`,
      role: r.role,
      name,
      title: r.title,
      bio: r.bio,
      deskId: r.deskId,
      specialization: r.specialization,
      capabilities: r.capabilities,
      kinds: r.kinds,
      hiredAt: now + i,
      appearance: {
        skin: SKINS[h % SKINS.length],
        hair: HAIRS[(h >>> 5) % HAIRS.length],
        hairStyle: STYLES[(h >>> 9) % STYLES.length],
        shirt,
        shirtAccent: '#e8e4dc',
        pants: ['#2c3446', '#3a3f4f', '#2a2a2e', '#3b4f73', '#4a3f3a'][(h >>> 13) % 5],
        shoes: ['#1a1a1f', '#eeeeef', '#7a4a2a', '#3d3d44'][(h >>> 17) % 4],
        accessory: r.look.accessory,
        outfit: r.look.outfit,
        inner: type === 'studio' ? '#1f1d26' : '#f2efe8'
      }
    }
  }), def.shirts)
}

/**
 * A team you can tell apart at a glance: nobody shares a shirt while another colour is free, or the same hair as a
 * teammate. The first person with a look keeps it, so only real duplicates change, and always the same way.
 */
export function distinctLooks<T extends { appearance: Employee['appearance'] }>(team: T[], shirts: string[]): T[] {
  const usedShirts = new Set<string>()
  const usedHair = new Set<string>()
  return team.map((e) => {
    const a = e.appearance
    const shirt = usedShirts.has(a.shirt) ? (shirts.find((c) => !usedShirts.has(c)) ?? a.shirt) : a.shirt
    const look = (hair: string) => `${hair}|${a.hairStyle}`
    const hair = usedHair.has(look(a.hair)) ? (HAIRS.find((c) => !usedHair.has(look(c))) ?? a.hair) : a.hair
    usedShirts.add(shirt)
    usedHair.add(look(hair))
    return shirt === a.shirt && hair === a.hair ? e : { ...e, appearance: { ...a, shirt, hair } }
  })
}

/**
 * The original office's full roster: the founders plus the Tech Startup roles they don't cover
 * (a front-end and a back-end developer). Returns only who is missing, so it is safe on every launch
 * and never duplicates someone already on the team (by role title or name).
 */
export function missingOriginalTeam(existing: Pick<Employee, 'name' | 'title' | 'projectId'>[], now: number): Employee[] {
  const original = existing.filter((e) => !e.projectId)
  const out: Employee[] = []
  for (const [i, name] of [
    [2, 'Priya Raman'],
    [3, 'Lucas Moreau']
  ] as const) {
    const r = OFFICE_TYPES.startup.roles[i]
    if (original.some((e) => e.title === r.title || e.name === name)) continue
    out.push({ id: `emp-${name.split(' ')[0].toLowerCase()}`, role: r.role, name, title: r.title, bio: r.bio, deskId: r.deskId, specialization: r.specialization, capabilities: r.capabilities, kinds: r.kinds, hiredAt: now + i, appearance: { ...appearanceFor(name), outfit: r.look.outfit, accessory: r.look.accessory }, projectId: null })
  }
  return out
}
