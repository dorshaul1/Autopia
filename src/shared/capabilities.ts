import type { Appearance, Capability, Employee, RoleId, Task, TaskKind } from './types'

// Capability-based staffing. Everything here is deterministic: no AI is involved in deciding who works.

export const CAPABILITY_LABEL: Record<Capability, string> = {
  planning: 'Planning',
  architecture: 'Architecture',
  backend: 'Backend',
  api: 'APIs',
  data: 'Data',
  frontend: 'Front-end',
  'ui-design': 'UI design',
  styling: 'Styling',
  accessibility: 'Accessibility',
  testing: 'Testing',
  qa: 'QA',
  docs: 'Docs',
  devops: 'DevOps',
  performance: 'Performance',
  security: 'Security',
  gameplay: 'Gameplay code',
  'game-design': 'Game systems',
  'level-design': 'Levels & worlds',
  'game-art': 'Game art',
  llm: 'LLMs & agents',
  ml: 'Machine learning',
  'data-pipelines': 'Data pipelines',
  evaluation: 'Evaluation',
  mlops: 'MLOps'
}

export const ALL_CAPABILITIES = Object.keys(CAPABILITY_LABEL) as Capability[]

const HINTS: [Capability, RegExp][] = [
  ['frontend', /\b(front-?end|browser|react|vue|svelte|dom|client|public\/|\.(tsx|jsx|vue|svelte)\b|app\.js)/i],
  ['ui-design', /\b(ui|ux|design|layout|landing|hero|page|component|visual)\b/i],
  ['styling', /\b(css|style|styles|theme|responsive|tailwind|\.s?css\b)/i],
  ['accessibility', /\b(a11y|accessib\w*|aria|keyboard navigation)\b/i],
  ['backend', /\b(server|backend|back-end|node:http|express|service|worker|cli)\b/i],
  ['api', /\b(api|endpoint|rest|graphql|route|http)\b/i],
  ['data', /\b(database|db|sql|schema|migration|store|persist\w*|json file|storage)\b/i],
  ['testing', /\b(tests?|node:test|jest|vitest|pytest|spec|coverage)\b/i],
  ['qa', /\b(qa|verify|verification|regression|acceptance)\b/i],
  ['docs', /\b(readme|docs?|documentation|guide)\b/i],
  ['devops', /\b(docker|ci|deploy|pipeline|build system|github actions)\b/i],
  ['architecture', /\b(architecture|refactor|module boundaries|design the system|interfaces?)\b/i],
  ['performance', /\b(performance|latency|optimi[sz]e|benchmark)\b/i],
  ['security', /\b(auth\w*|security|sanitiz\w*|permission|token|secret)\b/i],
  ['gameplay', /\b(game ?loop|gameplay|player|physics|collision|input handling|phaser|godot|unity|three\.js|pixi|canvas game|sprite|controls?)\b/i],
  ['game-design', /\b(mechanic\w*|game systems?|economy|progression curve|balanc\w*|rules|scoring|difficulty)\b/i],
  ['level-design', /\b(levels?|world|map|tilemap|terrain|stage|quest|encounter)\b/i],
  ['game-art', /\b(sprites?heet|pixel art|animation frames?|tileset|particles?|shaders?|vfx|art assets?)\b/i],
  ['llm', /\b(llm|prompt\w*|agent\w*|claude|openai|anthropic|rag|retriev\w*|embedding\w*|chatbot|tool use)\b/i],
  ['ml', /\b(model training|train\w*|classifier|regression model|neural|pytorch|tensorflow|scikit|sklearn|inference|fine-?tun\w*)\b/i],
  ['data-pipelines', /\b(etl|ingest\w*|pipeline|dataset|data ?loader|scrap\w*|batch job|airflow|dbt)\b/i],
  ['evaluation', /\b(evals?|evaluation|benchmark|golden set|accuracy|precision|recall|metrics?)\b/i],
  ['mlops', /\b(mlops|model serving|deploy model|monitoring|drift|experiment tracking|mlflow|weights & biases)\b/i]
]

/** Capabilities a task needs: the planner's list when given, otherwise inferred from its text and files. */
export function taskSkills(t: Pick<Task, 'kind' | 'title' | 'description' | 'files'> & { skills?: Capability[] }): Capability[] {
  if (t.skills?.length) return t.skills
  const text = `${t.title}\n${t.description}\n${t.files.join(' ')}`
  const found = HINTS.filter(([, re]) => re.test(text)).map(([c]) => c)
  if (t.kind === 'qa' && !found.includes('qa')) found.push('qa')
  if (t.kind === 'design' && !found.includes('ui-design')) found.push('ui-design')
  return found.length ? [...new Set(found)] : t.kind === 'design' ? ['ui-design', 'frontend'] : ['backend']
}

/** Share of the task's needed capabilities the employee has (0..1). 0 if they cannot own this kind. */
export function fitScore(e: Pick<Employee, 'capabilities' | 'kinds'>, kind: TaskKind, skills: Capability[]): number {
  if (!e.kinds.includes(kind)) return 0
  if (!skills.length) return 0.5
  return skills.filter((s) => e.capabilities.includes(s)).length / skills.length
}

export interface AssignChoice {
  employee: Employee
  score: number
  reason: string
}

/**
 * Picks the best owner for a task: highest capability fit, then lighter current load, then the
 * employee whose specialization covers the most of the task. Never selects the PM for build work.
 */
export function chooseAssignee(employees: Employee[], kind: TaskKind, skills: Capability[], load: (id: string) => number, exclude: string[] = []): AssignChoice | null {
  const ranked = employees
    .filter((e) => e.role !== 'pm' && !exclude.includes(e.id))
    .map((e) => ({ e, score: fitScore(e, kind, skills), load: load(e.id) }))
    .filter((x) => x.e.kinds.includes(kind))
    .sort((a, b) => b.score - a.score || a.load - b.load || b.e.capabilities.length - a.e.capabilities.length)
  // Nobody listing the requested skills is still no reason to drop the work: anyone who owns this
  // kind of task can take it (score 0 = no specialist match).
  const best = ranked[0]
  if (!best) return null
  const matched = skills.filter((s) => best.e.capabilities.includes(s)).map((s) => CAPABILITY_LABEL[s])
  return {
    employee: best.e,
    score: best.score,
    reason: matched.length ? `${best.e.name.split(' ')[0]} covers ${matched.join(', ')}` : `${best.e.name.split(' ')[0]} can own ${kind} work`
  }
}

// ── hiring ─────────────────────────────────────────────────────────

export interface HireTemplate {
  id: string
  role: RoleId
  title: string
  specialization: string
  capabilities: Capability[]
  kinds: TaskKind[]
  bio: string
}

export const HIRE_TEMPLATES: HireTemplate[] = [
  {
    id: 'backend',
    role: 'engineer',
    title: 'Backend Engineer',
    specialization: 'Services, APIs and data',
    capabilities: ['backend', 'api', 'data', 'testing', 'docs'],
    kinds: ['code'],
    bio: 'Builds reliable services and the tests that keep them that way.'
  },
  {
    id: 'frontend',
    role: 'engineer',
    title: 'Front-end Engineer',
    specialization: 'Browser apps and interaction',
    capabilities: ['frontend', 'styling', 'accessibility', 'testing'],
    kinds: ['code', 'design'],
    bio: 'Turns designs into fast, accessible interfaces.'
  },
  {
    id: 'devops',
    role: 'engineer',
    title: 'Platform Engineer',
    specialization: 'Build, CI and delivery',
    capabilities: ['devops', 'backend', 'performance', 'security', 'docs'],
    kinds: ['code'],
    bio: 'Makes builds fast, deployments boring and systems secure.'
  }
]

/** Analyses the real backlog: recommends a hire only when tasks repeatedly waited for a busy owner. */
export function hiringSignal(waitsByEmployee: Map<string, number>, employees: Employee[]): { template: HireTemplate; reason: string } | null {
  const busiest = [...waitsByEmployee.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!busiest || busiest[1] < 2) return null
  const e = employees.find((x) => x.id === busiest[0])
  if (!e) return null
  const template = e.capabilities.includes('frontend') ? HIRE_TEMPLATES[1] : e.capabilities.includes('devops') ? HIRE_TEMPLATES[2] : HIRE_TEMPLATES[0]
  return { template, reason: `${busiest[1]} ready tasks waited for ${e.name.split(' ')[0]} while they were busy.` }
}

const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#9a6440', '#6d442b', '#f4d7bd']
const HAIRS = ['#1f1612', '#3a2a1f', '#6b4428', '#a8743f', '#d6b16a', '#8e3b2f', '#2c2f3a']
const SHIRTS = ['#3f6f8f', '#8a4f7d', '#4f7a4a', '#b6603f', '#5a5f9e', '#2f7c7c', '#9a7a2f']
const STYLES: Appearance['hairStyle'][] = ['short', 'long', 'curly', 'bun', 'buzz']
const OUTFITS: Appearance['outfit'][] = ['hoodie', 'sweater', 'overshirt', 'blazer']
const ACCESSORIES: Appearance['accessory'][] = ['none', 'glasses', 'none', 'earrings', 'headphones']

/** Deterministic, distinct look for a new hire derived from their name. */
export function appearanceFor(seed: string): Appearance {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const pick = <T>(xs: T[], salt: number) => xs[Math.abs((h >> salt) ^ (h * (salt + 1))) % xs.length]
  const shirt = pick(SHIRTS, 3)
  return {
    skin: pick(SKINS, 1),
    hair: pick(HAIRS, 5),
    hairStyle: pick(STYLES, 7),
    shirt,
    shirtAccent: '#e8e4dc',
    pants: pick(['#2c3446', '#3a3f4f', '#2a2a2e', '#3b4f73'], 9),
    shoes: pick(['#1a1a1f', '#eeeeef', '#7a4a2a', '#3d3d44'], 11),
    accessory: pick(ACCESSORIES, 13),
    outfit: pick(OUTFITS, 15),
    inner: '#f2efe8'
  }
}

export const HIRE_NAMES = ['Priya Raman', 'Lucas Moreau', 'Amara Osei', 'Jonas Becker', 'Sofia Lindgren', 'Mateo Rossi', 'Hana Sato', 'Diego Alvarez']
