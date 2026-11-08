// Product mode: a high-level idea becomes a concise product spec (vision, users, journeys, scoped
// features, architecture, design direction, milestones) produced by the same single planning session
// that staffs the work. Everything else here is deterministic: no extra AI calls.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { environmentOf } from '../environment'
import type { KnowledgeEntry, Project, ProductDeliverable, ProductMilestone, ProductSpec, Run, Task } from '@shared/types'
export { currentMilestone, milestoneStatus } from '@shared/product'

export const COMPLETENESS_ON = process.env.AUTOPIA_COMPLETENESS !== 'off'

const IDEA = /\b(landing page|home ?page|site|portfolio|app|application|product|platform|tool|website|web ?site|dashboard|portal|tracker|manager|marketplace|saas|service|game|planner|journal|crm|shop|store|blog)\b/i
const SKIP = new Set(['node_modules', '.git', '.autopia', 'dist', 'build', '.next', 'coverage', '.venv', '__pycache__'])

/** Counts source-ish files (bounded) to tell a new product from work on an existing codebase. */
export function sourceFileCount(root: string, cap = 60): number {
  let n = 0
  const walk = (dir: string, depth: number) => {
    if (n >= cap || depth > 4) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP.has(name) || name.startsWith('.')) continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (/\.(m?[jt]sx?|py|go|rs|html|css|vue|svelte|rb|java|kt|swift)$/.test(name)) n++
      if (n >= cap) return
    }
  }
  walk(root, 0)
  return n
}

/**
 * Product mode applies to ideas for something new: an existing product spec, or a product-like brief
 * on a (nearly) empty repository. Changes to an existing codebase keep the lighter plan.
 */
export function isProductIdea(goal: string, sourceFiles: number, hasSpec: boolean): boolean {
  if (hasSpec) return true
  return sourceFiles <= 5 && IDEA.test(goal) && goal.trim().split(/\s+/).length >= 4
}

const STR = { type: 'string' } as const
const STRS = { type: 'array', items: STR } as const

export const PRODUCT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vision', 'users', 'journeys', 'features', 'assumptions', 'constraints', 'architecture', 'design', 'milestones', 'risks', 'questions', 'foundation', ...(process.env.AUTOPIA_EXPERTISE === 'off' ? [] : ['direction']), ...(COMPLETENESS_ON ? ['completeness'] : [])],
  properties: {
    completeness: {
      type: 'object',
      additionalProperties: false,
      required: ['essentials', 'content', 'notBuilding'],
      description: 'What makes this particular product feel finished rather than just good-looking.',
      properties: {
        essentials: { ...STRS, maxItems: 6, description: 'What someone using it would expect to work though nobody said so. Only what the request implies; short.' },
        content: { type: 'string', description: 'The fictional facts every screen shares: names, people, prices, places, dates. Under 80 words.' },
        notBuilding: { ...STRS, maxItems: 4, description: 'Tempting extras deliberately left out.' }
      }
    },
    direction: {
      type: 'object',
      additionalProperties: false,
      required: ['audience', 'personality', 'concept', 'explored', 'standards', 'avoid', 'assets'],
      description: 'The quality bar for this product, specific enough that it could not describe another one.',
      properties: {
        audience: STR,
        personality: { type: 'string', description: 'What it should feel like, in a sentence.' },
        concept: { type: 'string', description: 'The one idea that shapes it. For a game: the core fantasy and feel. For a backend: what it must never get wrong.' },
        explored: { ...STRS, maxItems: 3, description: 'The other concepts you seriously weighed, each with why it lost.' },
        standards: { ...STRS, maxItems: 6, description: 'What excellent means here: type, colour, layout, motion and assets for visual products; reliability, performance, gameplay or evaluation for others.' },
        avoid: { ...STRS, maxItems: 4, description: 'The generic version of this product that it must not become.' },
        assets: { ...STRS, maxItems: 5, description: 'The visual assets it really needs and where each goes; empty if none.' }
      }
    },
    foundation: {
      type: 'object',
      additionalProperties: false,
      required: ['taskKey', 'structure', 'contracts'],
      properties: {
        taskKey: { type: 'string', description: 'Key of the foundation task every other task builds on.' },
        structure: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['path', 'owns'], properties: { path: STR, owns: STR } } },
        contracts: { type: 'array', maxItems: 6, description: 'Only what several tasks really share: data shapes, module interfaces, API routes.', items: { type: 'object', additionalProperties: false, required: ['name', 'file', 'shape'], properties: { name: STR, file: STR, shape: STR } } }
      }
    },
    vision: { type: 'string', description: 'One or two sentences: what the product is and for whom.' },
    users: { ...STRS, maxItems: 4, description: 'Target users, most important first.' },
    journeys: {
      type: 'array',
      maxItems: 4,
      description: 'Core user journeys the MVP must support end to end.',
      items: { type: 'object', additionalProperties: false, required: ['name', 'steps'], properties: { name: STR, steps: { ...STRS, maxItems: 7 } } }
    },
    features: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description', 'scope', 'basis', 'milestone'],
        properties: {
          id: { type: 'string', description: 'Short id like F1.' },
          name: STR,
          description: STR,
          scope: { type: 'string', enum: ['mvp', 'later'] },
          basis: { type: 'string', enum: ['confirmed', 'assumption'], description: 'confirmed only if the founder asked for it; otherwise assumption.' },
          milestone: { type: ['integer', 'null'], description: 'Milestone that delivers it (MVP features only).' }
        }
      }
    },
    assumptions: { ...STRS, maxItems: 8, description: 'Defaults you chose for minor decisions, stated plainly so the founder can change them.' },
    constraints: { ...STRS, maxItems: 6 },
    architecture: {
      type: 'object',
      additionalProperties: false,
      required: ['stack', 'rationale', 'data', 'api'],
      properties: {
        stack: { type: 'string', description: 'The smallest proven stack that fits; no microservices or extra infrastructure without need.' },
        rationale: STR,
        data: { type: 'string', description: 'How data is persisted locally (real persistence, not in-memory only).' },
        api: { type: 'string', description: 'Backend endpoints or "none".' }
      }
    },
    design: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'typography', 'colors', 'layout', 'components', 'accessibility'],
      properties: {
        direction: { type: 'string', description: 'A specific visual direction for this product and audience; avoid generic gradients, glassmorphism and stock "AI app" looks.' },
        typography: STR,
        colors: {
          type: 'array',
          maxItems: 8,
          items: { type: 'object', additionalProperties: false, required: ['name', 'value'], properties: { name: STR, value: { type: 'string', description: 'Hex colour.' } } }
        },
        layout: STR,
        components: STR,
        accessibility: STR
      }
    },
    milestones: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      description: 'Working vertical slices in order. Milestone 1 delivers the first usable journey end to end.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'title', 'goal', 'acceptance'],
        properties: { n: { type: 'integer' }, title: STR, goal: STR, acceptance: { ...STRS, maxItems: 6, description: 'Observable, testable criteria.' } }
      }
    },
    risks: { ...STRS, maxItems: 5 },
    questions: {
      type: 'array',
      maxItems: 3,
      description:
        'Only decisions that materially change the product and that you cannot settle with a sensible default (scope, paid services, accounts/credentials, publication). Usually empty. Each has a default you will use if unanswered.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'question', 'why', 'options', 'defaultAnswer'],
        properties: { id: STR, question: STR, why: STR, options: { ...STRS, maxItems: 4 }, defaultAnswer: STR }
      }
    }
  }
} as const

export type ProductOutput = Omit<ProductSpec, 'projectId' | 'milestones' | 'questions' | 'changes' | 'createdAt' | 'updatedAt'> & {
  milestones: { n: number; title: string; goal: string; acceptance: string[] }[]
  questions: { id: string; question: string; why: string; options: string[]; defaultAnswer: string }[]
}

export const PRODUCT_PLANNING_RULES = [
  'Product mode: the founder gave an idea for a new product. In addition to the task plan, fill `product`:',
  '- Separate what the founder asked for (basis "confirmed") from defaults you chose (basis "assumption"); list those defaults in `assumptions`.',
  '- Keep the MVP small and complete: every MVP feature must really work (real navigation, real persistence, validation, loading/empty/error states). No fake data or dead buttons; label any seed/demo data as such.',
  '- Pick the smallest proven stack that fits and that runs locally with `npm` (or the existing toolchain). Use local persistence (e.g. a JSON or SQLite file behind a small API) unless the idea needs more. No accounts with external services unless the founder asked.',
  '- Define a specific design direction (type, colours, layout, components, accessibility) and give the first design task the job of creating the shared tokens/styles.',
  process.env.AUTOPIA_EXPERTISE === 'off' ? '' : '- Set `direction` from this product\'s own world: who it\'s for, one concept, and what would make it generic. A coffee roaster and a law firm should not end up with the same page. Weigh two or three real concepts, pick the strongest and record why the others lost. Keep it short and decided; no templates. For anything visual, put the design tokens (colours, type, spacing) in `foundation.contracts` so independently built parts stay one product.',
  '- Write the structured plan tight: every text field one or two short sentences, task descriptions under 60 words, and no code in it. A long plan can fail to submit at all.',
  '- Be concise: the repository is empty, so there is nothing to explore. Decide, do not survey. Choose the simplest architecture that fits; no speculative layers or infrastructure.',
  '- Put one small foundation task first and name it in `foundation.taskKey`: project setup, config, scripts (dev, build, test), .gitignore, the folder structure and the shared contracts as real code, plus one smoke test. No features in it.',
  '- Every other task depends on the foundation and on nothing else unless it truly needs another task\'s result, and owns its own folder from `foundation.structure` (disjoint `files`), so they run in parallel from the moment the foundation is in. A contract several tasks share goes in `foundation.contracts` and in the foundation task.',
  '- Split the work into 1–4 milestones, each a working vertical slice. Every task has `milestone`. Milestone 1 delivers the first usable journey end to end with tests.',
  '- Start the repository with a .gitignore for installed dependencies and build output (node_modules, dist, .env).',
  '- Include automated tests (the project test script) for API/logic, and a final-milestone task that writes README run instructions and verifies the core journeys with real commands.',
  '- Ask `questions` only for decisions that materially change the result and have no safe default (paid services, credentials, publication, major scope forks). Never ask about implementation details.'
].filter(Boolean).join('\n')

export function specFromPlan(projectId: string, p: ProductOutput, previous: ProductSpec | null): ProductSpec {
  const now = Date.now()
  const milestones: ProductMilestone[] = p.milestones
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((m, i) => ({ n: i + 1, title: m.title, goal: m.goal, acceptance: m.acceptance, status: 'pending', gate: null }))
  return {
    projectId,
    vision: p.vision,
    users: p.users,
    journeys: p.journeys,
    features: p.features.map((f) => ({ ...f, milestone: f.scope === 'mvp' ? (f.milestone ?? null) : null })),
    assumptions: p.assumptions,
    constraints: p.constraints,
    architecture: p.architecture,
    foundation: p.foundation,
    direction: p.direction,
    completeness: p.completeness ?? previous?.completeness,
    design: p.design,
    milestones,
    risks: p.risks,
    questions: p.questions.map((q) => ({ ...q, answer: previous?.questions.find((x) => x.id === q.id || x.question === q.question)?.answer ?? null })),
    changes: previous?.changes ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  }
}

/** The concise brief every implementer gets in product mode (well under 2k characters). */
export function productContext(spec: ProductSpec, milestone: number | null): string {
  const m = milestone ? spec.milestones.find((x) => x.n === milestone) : null
  const decided = spec.questions.map((q) => `- ${q.question} → ${q.answer ?? `${q.defaultAnswer} (default)`}`)
  const lines = [
    'Product brief (agreed with the founder):',
    `Vision: ${spec.vision}`,
    `Stack: ${spec.architecture.stack}. Data: ${spec.architecture.data}. API: ${spec.architecture.api}`,
    `Design: ${spec.design.direction}. Type: ${spec.design.typography}. Colours: ${spec.design.colors.map((c) => `${c.name} ${c.value}`).join(', ')}. Layout: ${spec.design.layout}`,
    ...(decided.length ? ['Founder decisions:', ...decided] : []),
    ...(spec.journeys.length ? [`Journeys that must work end to end: ${spec.journeys.map((j) => `${j.name} (${j.steps.join(' > ')})`).join('; ').slice(0, 500)}`] : []),
    ...(spec.completeness ? [`Complete means: ${spec.completeness.essentials.join('; ')}`, `Shared content, use these facts and don't invent others: ${spec.completeness.content}`, ...(spec.completeness.notBuilding.length ? [`Not building: ${spec.completeness.notBuilding.join('; ')}`] : [])] : []),
    ...(m ? [`This task is part of milestone ${m.n} "${m.title}": ${m.goal}`, `Milestone acceptance: ${m.acceptance.join('; ')}`] : []),
    'Build real, working functionality: no placeholder screens, fake data presented as real, or buttons that do nothing. Autopia will really click every control, submit every form and read every page.'
  ]
  if (spec.changes.length) lines.push(`Recent founder feedback: ${spec.changes.slice(-2).map((c) => c.request.split('\n')[0].slice(0, 160)).join(' | ')}`)
  return lines.join('\n').slice(0, 3200)
}

/** Environment variables the code reads, so the hand-over names what must be configured. */
export function envVars(root: string): string[] {
  const out = new Set<string>()
  const example = ['.env.example', '.env.sample', '.env.template'].map((f) => join(root, f)).find(existsSync)
  if (example) for (const l of readFileSync(example, 'utf8').split('\n')) if (/^[A-Z][A-Z0-9_]+=/.test(l)) out.add(l.split('=')[0])
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.size > 30) return
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name) || name.startsWith('.')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p, depth + 1)
      else if (/\.(m?[jt]sx?|cjs|py)$/.test(name) && st.size < 300_000 && !/\.test\.|\.spec\./.test(name)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|os\.environ(?:\.get)?\(?\[?['"]([A-Z][A-Z0-9_]+)/g)) out.add(m[1] ?? m[2])
      }
    }
  }
  try {
    walk(root, 0)
  } catch {
    // unreadable tree: report what we have
  }
  for (const v of ['NODE_ENV', 'PORT', 'HOST', 'CI']) out.delete(v)
  return [...out].sort()
}

export function deliverable(project: Project, tasks: Task[], runs: Run[], knowledge: KnowledgeEntry[], limitations: string[], previewable: boolean, commits: number): ProductDeliverable {
  // the project's own commands, in its own package manager
  const environment = environmentOf(project.path)
  const run: ProductDeliverable['run'] = [
    ...(environment.install ? [{ label: environment.install.label, command: environment.install.command }] : []),
    ...environment.run.map((r) => ({ label: r.label, command: r.command })),
    ...environment.checks.map((c) => ({ label: c.label, command: c.command }))
  ]
  const latest = new Map<string, ProductDeliverable['checks'][number]>()
  for (const t of tasks) for (const c of t.checks) if (!latest.has(c.command) || latest.get(c.command)!.at < c.at) latest.set(c.command, { command: c.command, status: c.status, at: c.at })
  const own = runs.filter((r) => r.projectId === project.id)
  const started = Math.min(...own.map((r) => r.startedAt))
  const ended = Math.max(...own.map((r) => r.endedAt ?? r.startedAt))
  return {
    run,
    env: envVars(project.path),
    checks: [...latest.values()].sort((a, b) => b.at - a.at).slice(0, 8),
    limitations,
    decisions: knowledge.filter((k) => k.kind === 'decision' && k.status !== 'archived').slice(0, 8).map((k) => ({ title: k.title, text: k.text })),
    commits,
    files: new Set(tasks.flatMap((t) => t.changedFiles.map((c) => c.replace(/^\S+\s+/, '')))).size,
    previewable,
    tokens: own.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0), 0),
    costUsd: own.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    elapsedMs: own.length ? ended - started : 0
  }
}
