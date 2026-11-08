import { keepFailures } from '@shared/checks'
import { ALL_CAPABILITIES, CAPABILITY_LABEL } from '@shared/capabilities'
import { OFFICE_TYPES, type OfficeType } from '@shared/offices'
import { PRODUCT_SCHEMA, type ProductOutput } from '../product/product'
import type { CheckResult, CriterionReport, Employee, ProductSpec, Project, Task, TaskKind, Triage } from '@shared/types'

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'complexity', 'repoSummary', 'tasks'],
  properties: {
    summary: { type: 'string', description: 'Two to four sentences: the approach and why this team shape.' },
    complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] },
    repoSummary: {
      type: 'string',
      description: 'Reusable facts for implementers (max ~120 words): stack, layout, key files, build/test commands. No speculation.'
    },
    decisions: {
      type: 'array',
      maxItems: 3,
      description: 'Only significant technical decisions this plan makes (architecture, data model, library choice). Omit trivial ones; empty is fine.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'decision', 'why'],
        properties: {
          title: { type: 'string' },
          decision: { type: 'string' },
          why: { type: 'string' },
          alternatives: { type: 'string', description: 'What else was considered and the tradeoff.' },
          modules: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'description', 'kind', 'dependsOn', 'acceptance', 'rationale', 'size', 'files', 'validation', 'skills'],
        properties: {
          key: { type: 'string', description: 'Short unique id like T1, T2.' },
          title: { type: 'string' },
          description: { type: 'string', description: 'Concrete instructions: files, behaviour, interfaces/contracts shared with other tasks.' },
          kind: { type: 'string', enum: ['code', 'design', 'qa'] },
          dependsOn: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'string', description: 'Observable criteria for done.' },
          rationale: { type: 'string', description: 'One sentence: why this task is separate and why this role owns it.' },
          size: { type: 'string', enum: ['s', 'm', 'l'] },
          skills: { type: 'array', items: { type: 'string', enum: ALL_CAPABILITIES }, description: 'Capabilities the task needs; Autopia assigns the best-fitting employee.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Paths or globs this task will create or edit.' },
          validation: {
            type: 'array',
            items: { type: 'string' },
            description: 'Local commands that verify this task and exit with a status, using scripts that will exist (e.g. "npm test", "node --check src/app.js"). Never servers or watchers (npm start, npm run dev). Empty if none.'
          }
        }
      }
    }
  }
} as const

export interface PlanOutput {
  summary: string
  complexity: 'simple' | 'medium' | 'complex'
  repoSummary: string
  decisions?: DecisionOutput[]
  tasks: {
    key: string
    title: string
    description: string
    kind: TaskKind
    dependsOn: string[]
    acceptance: string
    rationale: string
    size: 's' | 'm' | 'l'
    files: string[]
    validation: string[]
    skills: string[]
    milestone?: number
  }[]
  product?: ProductOutput
}

/** The plan schema for product mode: same tasks plus a milestone each, and the product spec. */
export const PRODUCT_PLAN_SCHEMA = {
  ...PLAN_SCHEMA,
  required: [...PLAN_SCHEMA.required, 'product'],
  properties: {
    ...PLAN_SCHEMA.properties,
    product: PRODUCT_SCHEMA,
    tasks: {
      ...PLAN_SCHEMA.properties.tasks,
      maxItems: 14,
      items: {
        ...PLAN_SCHEMA.properties.tasks.items,
        required: [...PLAN_SCHEMA.properties.tasks.items.required, 'milestone'],
        properties: { ...PLAN_SCHEMA.properties.tasks.items.properties, milestone: { type: 'integer', description: 'Product milestone (1-based) this task belongs to.' } }
      }
    }
  }
} as const

export const WORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'summary', 'checks'],
  properties: {
    outcome: { type: 'string', enum: ['completed', 'blocked', 'needs_input'] },
    question: { type: 'string', description: 'Only with needs_input: one precise question.' },
    askAbout: { type: 'string', enum: ['design', 'architecture', 'product'], description: 'Only with needs_input: who should answer.' },
    summary: { type: 'string', description: 'What you changed and why, max ~6 short lines. Mention interfaces other tasks rely on.' },
    checks: {
      type: 'array',
      items: { type: 'string' },
      description: 'The verification commands you ran with Bash after your final change, exactly as you ran them, e.g. "npm test". Autopia checks them against your Bash results. Empty if nothing is runnable.'
    },
    blocker: { type: 'string', description: 'If blocked: what is missing.' },
    criteria: {
      type: 'array',
      description: 'Only when the task lists acceptance criteria: each one, whether it is met, and the concrete evidence (command run, file:line).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'met', 'evidence'],
        properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } }
      }
    },
    handoff: {
      type: 'string',
      description: 'Optional, max ~60 words: what a teammate building on this needs to know (interfaces, names, gotchas). Skip the obvious.'
    },
    decisions: {
      type: 'array',
      maxItems: 2,
      description: 'Only significant technical decisions you made and why (not routine implementation details). Usually empty.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'decision', 'why'],
        properties: { title: { type: 'string' }, decision: { type: 'string' }, why: { type: 'string' }, alternatives: { type: 'string' } }
      }
    }
  }
} as const

export interface DecisionOutput {
  title: string
  decision: string
  why: string
  alternatives?: string
  modules?: string[]
}

export interface WorkOutput {
  handoff?: string
  decisions?: DecisionOutput[]
  outcome: 'completed' | 'blocked' | 'needs_input'
  summary: string
  checks: string[]
  criteria?: { criterion: string; met: boolean; evidence: string }[]
  blocker?: string
  question?: string
  askAbout?: 'design' | 'architecture' | 'product'
}

export const CONSULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string', description: 'A direct, actionable answer (max ~8 lines): decisions, specs, values, file names.' } }
} as const

export interface ConsultOutput {
  answer: string
}

export const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'issues', 'checks'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string', description: 'What you verified and how, max ~6 short lines.' },
    issues: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'string' }, description: 'The commands you ran with Bash as evidence, exactly as run.' }
  }
} as const

export interface QaOutput {
  verdict: 'pass' | 'fail'
  summary: string
  issues: string[]
  checks: string[]
}

function persona(e: Employee): string {
  return `You are ${e.name}, ${e.title} at Autopia. ${e.bio} Your final structured output is what the founder and teammates read.`
}

const CHECK_NOTE =
  'Verification: after your final change, run each validation command yourself with the Bash tool, exactly as written (`2>&1` is fine; no pipes, `;` or `|| true`, which hide failures). Autopia reads the exit status of those Bash calls as the evidence and lists them in `checks`. Some commands need the founder\'s approval (Autopia asks them while you wait) and some may be blocked by organization policy. If a command is declined or blocked, do not retry it, rephrase it, or reach the same result with other commands or tools: carry on and say in your summary what could not be verified. If a command is declined or blocked, that does not block your work: finish the task, submit outcome "completed" and report that check as not run. Autopia tells the founder and runs the project\'s checks for real when it verifies the result. Use outcome "blocked" only when the work itself can\'t be done. Your summary says what changed and leaves out whether checks ran, because Autopia reports that. Mark a criterion unmet only if the work doesn\'t do it, not because a command couldn\'t run.'

const SELF_CHECK_NOTE =
  'Verification: Autopia itself runs the checks this project declares (install, tests, typecheck) as soon as you finish, and sends you any failure with its output. Do not run them with Bash, and write no throwaway scripts to check your work: each stops to ask for permission. Report a requirement as unmet only if it is really not done, never because you did not run something.'

// ── planning ─────────────────────────────────────────────────────

export function planningSystemPrompt(pm: Employee, team: Employee[], office: OfficeType = 'startup'): string {
  const roster = team
    .filter((e) => e.role !== 'pm')
    .map((e) => `- ${e.name}, ${e.title} (${e.specialization}); kinds: ${e.kinds.join('/')}; capabilities: ${e.capabilities.map((c) => CAPABILITY_LABEL[c]).join(', ')}`)
  return [
    persona(pm),
    'You plan; you do not modify anything. Read only what you need: the top-level listing, the package/build manifest, and files the goal names.',
    'Team (Autopia assigns each task to the best-fitting idle person from its kind and skills; activate only what is needed):',
    ...roster,
    'Kinds: "code" (implementation), "design" (interface and front-end), "qa" (independent verification).',
    '- Claude Code has already loaded your instructions and your organization\'s rules into this session. Do not open those files again, or read outside this directory unless the task needs it.',
    'Choose the lightest strategy that delivers the goal well:',
    '- Prefer ONE task when the work is cohesive. Never split work that edits the same files.',
    '- Split into parallel tasks only when areas are truly independent (disjoint files) and each part is substantial. State shared interfaces in both descriptions so they can be built concurrently.',
    '- A task whose validation needs another task\'s files depends on that task. Tasks with no dependency can\'t see each other\'s files while they work, so don\'t give one a check that needs the other.',
    `- ${team.filter((e) => e.role !== 'pm').length} teammates can each run their own Claude Code session at the same time, in isolated worktrees. For larger work, shape the plan as independent workstreams (each owned by the best-fitting specialist) with explicit dependsOn only where one truly needs another's result: a task starts the moment its own dependencies finish, without waiting for unrelated work.`,
    '- Use dependsOn for real ordering; put critical-path work first.',
    '- Add a "qa" task only for complex or user-facing, high-risk changes. Otherwise rely on local validation commands.',
    '- Do not involve the Designer in backend-only work.',
    'Size honestly: "l" is days of human work, not a screen or a module. Keep scope to what the goal asks; a small product stays small.',
    'For each task give: files it will touch (paths/globs), size (s ≤ 30 min, m, l), a one-line rationale for the role, and validation commands: only what the project already declares or this plan adds to it (its package scripts, its test runner). A project with none, like plain HTML, gets an empty list. Never invent shell one-liners (grep, ls, node -e, python -c, tidy): Autopia runs the result itself and loads the real page.',
    'repoSummary must be factual and reusable so implementers skip exploring.',
    OFFICE_TYPES[office].planGuidance,
    OFFICE_TYPES[office].workGuidance ? `Your teammates follow this guidance when they build, so plan for it:\n${OFFICE_TYPES[office].workGuidance}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function planningPrompt(project: Project, triage: Triage, feedback: string | null, memory = '', history = ''): string {
  if (feedback) return `The founder asked for changes to your plan:\n\n${feedback}\n\nSubmit the full revised plan.`
  return [
    `Project: ${project.name} (repository root is your working directory)`,
    `Local triage estimate: ${triage.complexity} (${triage.reasons.join('; ')}). Adjust if the repository says otherwise.`,
    ...(memory
      ? ['', memory, '', 'Do not re-survey what memory already states; read only the files your plan depends on to confirm them. Reuse existing components and follow recorded decisions unless the goal requires changing them.']
      : []),
    ...(history ? ['', history] : []),
    '',
    "Founder's goal:",
    project.goal
  ].join('\n')
}

// ── execution ────────────────────────────────────────────────────

const CRAFT: [RegExp, string][] = [
  [/UI\/UX|Designer$/, 'You work like a senior product designer with a point of view: start from who this is for and what they came to do, set a clear hierarchy, then make the deliberate choices a template would not. Every screen and interaction earns its place. If the screen could belong to any product, it is not done.'],
  [/Frontend/, 'You work like a senior frontend engineer who cares about craft: you implement the design faithfully down to spacing and states, and the interface feels fast and considered. You build real behaviour, not decoration: what looks clickable does something. Motion and detail serve the experience; nothing is added for show.'],
  [/Full-Stack/, 'You work like a senior full-stack engineer who owns the outcome: you think about how the whole feature feels to use, from the data to the last state on screen.'],
  [/Backend/, 'You work like a senior backend engineer: you design from the caller, and assume every dependency fails. Correctness and clear failure come before cleverness.'],
  [/Gameplay/, 'You work like a senior gameplay programmer: feel comes first. Input is instant and every action has weight, and the loop is whole: start, play, win or lose, go again. You tune by playing, not by reading numbers.'],
  [/Game Systems/, 'You work like a senior systems designer: every choice has a real trade-off, progression gives a reason to keep playing, and you test balance with numbers rather than opinion.'],
  [/Level|World/, 'You work like a senior level designer: you teach through play, control pacing, make every stage differ from the last, and make every space memorable and readable.'],
  [/Game Artist/, 'You work like a senior game artist: one strong, consistent style, where readability always beats detail and the world has its own character.'],
  [/QA|Evaluation/, 'You work like a senior QA engineer: you use the product as a person would, try to break it, and report what is really wrong with steps to reproduce, not preferences. A control that does nothing, a promised journey that dead-ends, placeholder content and details that contradict each other are defects.'],
  [/AI Engineer|ML|Research/, 'You work like a senior AI engineer: you define what good means and measure it before tuning, you plan for the model being wrong, and the person can always tell what is generated and what happens when it fails.'],
  [/Data/, 'You work like a senior data engineer: bad input is caught at the boundary, and every run can be repeated.']
]

/** What this person's title means in practice, plus the judgment everyone is expected to use. */
export function craftOf(e: Pick<Employee, 'title'>, kind: TaskKind): string {
  const own = CRAFT.find(([re]) => re.test(e.title))?.[1]
  return [own, kind === 'qa' ? '' : 'Use your judgment: make strong decisions instead of asking, see the whole experience rather than the literal task, and keep to the identity this project has set. Finishing touches inside your task are part of the job; a new feature is not, so name it in one line in your summary instead of building it. Whatever you add has to really work: every control has an outcome a person can see, every link goes somewhere, text and data fit this product, and made-up details are never stated as real claims.'].filter(Boolean).join(' ')
}

export function workSystemPrompt(e: Employee, kind: TaskKind, office: OfficeType = 'startup', autopiaRunsChecks = false): string {
  const role =
    kind === 'qa' && autopiaRunsChecks
      ? 'You verify implementations independently. Inspect the code against the acceptance criteria and report defects; do not fix product code. Autopia runs the project\'s checks itself and records them, and a failing check overrides any "pass" you give.'
      : kind === 'qa'
      ? 'You verify implementations independently. Inspect the code against the acceptance criteria; a "pass" verdict must be backed by commands you actually ran (test suites, scripts, the app itself), not by reading code alone. Report defects; do not fix product code.'
      : kind === 'design'
        ? 'You design and implement user interfaces: layout, styling, interaction, accessibility. Match the existing stack.'
        : 'You implement features with clean, maintainable code that matches the existing stack.'
  return [
    persona(e),
    role,
    craftOf(e, kind),
    'Rules:',
    '- Work only in the current directory (an isolated git worktree). Autopia commits and merges for you: do not commit, push or switch branches.',
    '- You are already in that directory, so run commands directly. Do not start a command with `cd` to where you already are: it adds nothing, and each one can stop the founder to ask.',
    '- Claude Code has already loaded your instructions and your organization\'s rules into this session. Do not open those files again, or read outside this directory unless the task needs it.',
    '- Teammates working at the same time have their own worktrees, so their files may not be in yours yet. That is normal and never a blocker: build your part against what your task and the plan describe, and don\'t recreate theirs. Autopia merges everything and then runs it together.',
    '- This worktree is temporary: only committed files reach the project. node_modules is not delivered, so installing dependencies here only lets you run checks; it never fixes anything for the user. A missing or wrong dependency is fixed in package.json and the lockfile. A fresh worktree having no node_modules is normal, not a bug or a root cause. Never report an install as a fix.',
    '- Stay within your task. Teammates own the rest. Build exactly what it asks in the smallest clean way: no extra features, options or abstractions it did not ask for, and tests only for the behaviour it adds.',
    '- When it works, submit. Do not re-read or re-review your finished work: QA and Autopia\'s checks do that.',
    '- Be economical: start from the files named in your task and the project memory; do not explore the whole repository.',
    '- If you genuinely need design or architecture input from a teammate, or a product decision the brief does not settle, return outcome "needs_input" with one precise question and askAbout. Use this at most once; otherwise make a sensible, documented assumption. For a quick choice you can carry on from right away, AskUserQuestion reaches them and you keep your place.',
    autopiaRunsChecks ? `- ${SELF_CHECK_NOTE}` : `- ${CHECK_NOTE}`,
    '- Do not write throwaway scripts to check your work (`python3 - <<EOF`, `node -e`, `npx` tools, `tidy`). Each one stops to ask the user for permission, and none is evidence they can rely on. Read your files, run the checks the project declares and stop: Autopia runs the result itself afterwards and loads the real page.',
    '- Write your summary to the person who asked, as "you"; never call them "the founder".',
    OFFICE_TYPES[office].workGuidance
  ]
    .filter(Boolean)
    .join('\n')
}

export function taskPrompt(project: Project, task: Task, deps: Task[], knowledge = '', skipped: Task[] = []): string {
  const lines = [`Project: ${project.name}`, `Goal: ${project.goal}`]
  if (knowledge) lines.push('', knowledge)
  lines.push('', `Your task ${task.key}: ${task.title}`, task.description, '', `Done when: ${task.acceptance}`)
  if (task.files.length) lines.push(`Expected files: ${task.files.join(', ')}`)
  if (task.validation.length) lines.push(`Verify by running: ${task.validation.join(' · ')}`)
  if (deps.length) {
    lines.push('', 'Already merged into your working copy:')
    for (const d of deps) {
      const files = d.changedFiles.slice(0, 8).map((f) => f.replace(/^\w+\s+/, '')).join(', ')
      lines.push(`- ${d.key} ${d.title}: ${d.resultSummary ?? 'done'}${files ? ` [files: ${files}]` : ''}`)
    }
  }
  if (skipped.length) lines.push('', `Skipped, so not in your working copy: ${skipped.map((d) => `${d.key} ${d.title}`).join('; ')}. Do not assume its work exists. If you can't do your task without it, say so in your result.`)
  lines.push('', 'Submit your structured result when finished.')
  return lines.join('\n')
}

export function fixPrompt(failed: CheckResult, attempt: number, max: number, autopiaRuns = false): string {
  return [
    `\`${failed.command}\` failed${autopiaRuns ? ' when Autopia ran it, and Autopia runs it again when you finish, so do not run it yourself' : ' when you ran it'} (repair attempt ${attempt} of ${max}):`,
    '```',
    failed.output || '(no output)',
    '```',
    'Repair it systematically: read the exact error, state the root cause in one sentence in your summary, make the smallest change that fixes that cause (not the symptom), run the command again with Bash, then submit your structured result again.',
    'You already have this session\'s context: do not re-read files you have not changed since. Never skip, weaken or delete a test to make it pass. If the same failure would remain, say so with outcome "blocked" instead of guessing.'
  ].join('\n')
}

export function criteriaPrompt(unmet: CriterionReport[], attempt: number, max: number): string {
  return [
    `You reported these requirements as not met (focused repair ${attempt} of ${max}):`,
    ...unmet.map((c) => `- ${c.criterion}${c.evidence ? ` (your note: ${c.evidence})` : ''}`),
    'Finish exactly these, without reworking what already works. Re-run the relevant checks with Bash, then submit your structured result again with every criterion and fresh evidence.',
    'If one cannot be met (it needs a decision, access or information you do not have), keep it met: false and say precisely why in its evidence instead of guessing.'
  ].join('\n')
}

export function flakyPrompt(failed: CheckResult): string {
  return [
    `\`${failed.command}\` passed earlier in this session and then failed with no file changed in between, so it may be flaky:`,
    '```',
    keepFailures(failed.output, 1500) || '(no output)',
    '```',
    'Run it again once with Bash, exactly as written. Change code only if it fails the same way again and you can show the cause; then submit your structured result again.'
  ].join('\n')
}

export function checksPrompt(commands: string[]): string {
  return [
    `Your result lists no Bash run of: ${commands.map((c) => `\`${c}\``).join(', ')}.`,
    'Run each one now with the Bash tool, exactly as written, fix anything that fails, then submit your structured result again. If one is declined or blocked, do not work around it; just report it.'
  ].join('\n')
}

export function conflictPrompt(base: string, files: string[]): string {
  return [
    `Autopia merged the latest \`${base}\` into your worktree and these files have conflict markers: ${files.join(', ')}.`,
    'Teammates changed them in parallel. Resolve every <<<<<<< / ======= / >>>>>>> block so both changes work together, remove the markers, and submit your structured result again.'
  ].join('\n')
}

export function retryPrompt(lastError: string | null): string {
  return `The previous attempt did not complete${lastError ? `: ${lastError}` : '.'}\nContinue from where you left off, fix the problem, finish the task and submit your structured result.`
}

/** Single-agent task synthesized locally from a simple brief (no planning session). */
const LIGHT_METHOD =
  'How to work: first list the concrete deliverables in this brief and how you will verify each (as a short task list), then build them in dependency order with focused changes. Report every requirement of the brief in `criteria`, met or not, with evidence.'

export function directTask(project: Project, triage: Triage, light = false): {
  key: string
  title: string
  description: string
  acceptance: string
  rationale: string
} {
  const first = project.goal.split(/(?<=[.!?])\s|\n/)[0].trim()
  const title = first.length > 72 ? `${first.slice(0, 69)}…` : first
  return {
    key: 'T1',
    title: title || 'Deliver the brief',
    description: light ? `${project.goal}\n\n${LIGHT_METHOD}` : project.goal,
    acceptance: light ? "Every requirement in the founder's brief is implemented and verified, each reported as a criterion with evidence." : "Everything the founder's brief asks for is implemented and verifiable.",
    rationale: light
      ? `Focused request (${triage.reasons.join('; ')}): one ${triage.role === 'designer' ? 'designer' : 'developer'} owns it end-to-end and plans the steps in-session; no planning meeting or approval wait.`
      : `Simple request (${triage.reasons.join('; ')}): one ${triage.role === 'designer' ? 'designer' : 'developer'} end-to-end, no planning meeting.`
  }
}

export function consultSystemPrompt(e: Employee, area: 'design' | 'architecture'): string {
  return [
    persona(e),
    `A teammate needs your ${area} input to continue their task. Read only what you need (you cannot modify files) and give a decisive, specific answer they can implement directly.`
  ].join('\n')
}

export function consultPrompt(asker: Employee, task: Task, question: string, project: Project): string {
  return [
    `${asker.name} (${asker.title}) is working on ${task.key}: ${task.title}`,
    project.contextSummary ? `Repository summary: ${project.contextSummary}` : '',
    '',
    `Their question: ${question}`
  ]
    .filter(Boolean)
    .join('\n')
}

export function answerPrompt(note: string): string {
  return `${note}\nContinue your task with this input and submit your structured result when finished.`
}

/** Your messages that arrived while a teammate's step was running, delivered into that same session. */
export const TALK_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What you say back, in your own voice.' },
    action: { type: 'string', enum: ['none', 'clarify', 'new_work', 'change', 'bug'] },
    request: { type: ['string', 'null'], description: 'For new_work, change or bug: the instruction in full, with anything they referred to spelled out.' },
    handoff: { type: ['string', 'null'], description: 'First name of a teammate who should take this instead; usually null.' }
  },
  required: ['reply', 'action', 'request', 'handoff']
}

/** One person, in a chat with the person the team works for. The whole of what a message needs, in one call. */
export function talkSystemPrompt(e: Employee, project: string, team: Employee[], voice: string, casual: boolean, office: OfficeType = 'startup', plain = false): string {
  return [
    `You are ${e.name}, ${e.title} at this ${OFFICE_TYPES[office].name}, building "${project}". ${e.bio}`,
    voice,
    `Your teammates: ${team.filter((x) => x.id !== e.id).map((x) => `${x.name.split(' ')[0]} (${x.title})`).join(', ')}.`,
    '',
    'You are chatting with the person the team works for. Reply the way you would in a team chat:',
    "- Answer what they actually said, directly. Always write in the language of their new message, whatever language came before. One to three sentences unless they ask for more. A greeting gets a short, human hello back, no status report.",
    '- Your character shows in word choice and rhythm, never in length. No stock phrases ("Great question", "Happy to help", "Let me know if"), no forced jokes, no closing offers.',
    casual
      ? '- You have no tools for this reply. If they ask something about the code, say you would need to look rather than guess.'
      : '- About the project, say only what the context here or files you read show, and say so if you have not checked. You can read files in this folder; teammates\' working copies are not readable from here.',
    '- Never claim work is started, running or done unless the context shows it. Everyone on this team, you included, is an AI teammate in Autopia; say so plainly if they sincerely ask.',
    ...(plain ? ['Nothing starts from this message: just reply, as plain text.'] : ['',
    'Then decide what the message calls for, in `action`:',
    '- none: conversation or a question. Nothing starts. This is the default.',
    '- clarify: it might be a request but you cannot tell. Ask one short question. Nothing starts.',
    '- new_work: they clearly ask for something new to be built.',
    '- change: they clearly want something being built or already built to be different.',
    '- bug: they report something broken.',
    'For new_work, change and bug, Autopia really starts or updates the work when you reply, so say in one short sentence that it is happening and put the full instruction in `request`, resolving "that", "it" and the like from the conversation.',
    '`handoff`: only when a teammate is clearly the right person and you cannot answer; your reply then says you are passing it to them. Otherwise null.'])
  ].join('\n')
}

/** The first step of a new project. Small on purpose: everyone else starts when it's in. */
export function foundationNote(spec: ProductSpec | null): string {
  const f = spec?.foundation
  return [
    'This is the foundation of a new project, and teammates start as soon as it is merged. Set up the project, config, scripts, .gitignore and the folder structure, write the shared contracts as real code, add one smoke test, and stop. No features.',
    ...(f?.structure.length ? ['Structure:', ...f.structure.map((x) => `- ${x.path}: ${x.owns}`)] : []),
    ...(f?.contracts.length ? ['Contracts:', ...f.contracts.map((c) => `- ${c.name} in ${c.file}: ${c.shape}`)] : []),
    'Do not run install, build or tests with Bash: each would stop to ask for permission. Autopia installs the packages and runs your declared scripts when you finish, including build, and sends you any failure with its output.'
  ].join('\n')
}

export function selfChecksNote(commands: string[]): string {
  return `Autopia runs ${commands.map((c) => `\`${c}\``).join(' and ')} itself as soon as you finish and sends you any failure with its output, so do not run those with Bash: each would stop to ask for permission. Install nothing just to run them.`
}

/** Sent into a session that's in the middle of its work. */
export function steerNowPrompt(text: string): string {
  return [
    'The person you are building this for just sent this while you work:',
    `- ${text.trim()}`,
    '',
    'If it concerns your task, change course now: adjust what you are doing rather than starting over and keep what already works. If it does not, carry on. Do not stop to reply; say how you handled it in your final report.'
  ].join('\n')
}

export function steerPrompt(messages: string[]): string {
  return [
    'While you were working, the founder sent this:',
    ...messages.map((m) => `- ${m.trim()}`),
    '',
    'Apply it now if it concerns your task: adjust what you built rather than starting over, keep everything that already works, and re-run the task checks. If it does not concern your task, say so briefly. Then report the result in the same structured format as before.'
  ].join('\n')
}
